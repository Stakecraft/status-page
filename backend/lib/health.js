const RECORDING_RULE_UP = 'stakecraft:service:up';
const RECORDING_RULE_UPTIME_1D = 'stakecraft:service:uptime_ratio:1d';
const RECORDING_RULE_UPTIME_30D = 'stakecraft:service:uptime_ratio:30d';

function evaluateHealthCondition(currentValue, healthCondition) {
    const numValue = parseFloat(currentValue);
    if (Number.isNaN(numValue)) {
        return false;
    }

    const conditionMatch = healthCondition.match(/^(>=|<=|>|<|==|!=)\s*(.+)$/);
    if (!conditionMatch) {
        console.warn(`[Health] Invalid condition format: ${healthCondition}`);
        return false;
    }

    const operator = conditionMatch[1];
    const threshold = parseFloat(conditionMatch[2]);
    if (Number.isNaN(threshold)) {
        return false;
    }

    switch (operator) {
        case '>': return numValue > threshold;
        case '>=': return numValue >= threshold;
        case '<': return numValue < threshold;
        case '<=': return numValue <= threshold;
        case '==': return numValue === threshold;
        case '!=': return numValue !== threshold;
        default: return false;
    }
}

function buildHealthQuery(service) {
    const health = service.health || {};

    if (health.query) {
        return health.query;
    }

    if (health.prometheus_job) {
        return `up{job="${health.prometheus_job}"}`;
    }

    return null;
}

function getHealthCondition(service) {
    const health = service.health || {};
    return health.condition || '> 0';
}

function buildHealthExpression(service) {
    const health = service.health || {};
    const query = buildHealthQuery(service);
    if (!query) {
        return null;
    }

    const condition = getHealthCondition(service);
    const conditionMatch = condition.match(/^(>=|<=|>|<|==|!=)\s*(.+)$/);
    if (!conditionMatch) {
        return query;
    }

    const operator = conditionMatch[1];
    const threshold = conditionMatch[2].trim();
    return `${query} ${operator} ${threshold}`;
}

function valueToStatus(value, condition) {
    if (value === null || value === undefined) {
        return 'unknown';
    }

    const numValue = parseFloat(value);
    if (Number.isNaN(numValue)) {
        return 'unknown';
    }

    // Boolean PromQL expressions (e.g. metric > 0) return 0 or 1
    if (numValue === 0) {
        return 'outage';
    }
    if (numValue === 1) {
        return 'operational';
    }

    return evaluateHealthCondition(value, condition) ? 'operational' : 'outage';
}

function parseInstantValue(result, labelMatcher) {
    if (!result || result.length === 0) {
        return null;
    }

    if (labelMatcher) {
        const match = result.find((entry) => {
            const labels = entry.metric || {};
            return Object.entries(labelMatcher).every(([key, val]) => labels[key] === val);
        });
        return match?.value?.[1] ?? null;
    }

    return result[0]?.value?.[1] ?? null;
}

function buildStatusQuery(service, useRecordingRules) {
    if (useRecordingRules) {
        return `${RECORDING_RULE_UP}{service="${service.id}"}`;
    }

    return buildHealthExpression(service);
}

function buildUptime30dQuery(service, useRecordingRules) {
    if (useRecordingRules) {
        return `${RECORDING_RULE_UPTIME_30D}{service="${service.id}"}`;
    }

    const vectorQuery = buildHealthQuery(service);
    if (!vectorQuery) {
        return null;
    }

    // Range selectors must wrap a vector selector, not a boolean expression.
    return `avg_over_time(${vectorQuery}[30d]) * 100`;
}

function buildHistoryQuery(service, useRecordingRules) {
    if (useRecordingRules) {
        return `${RECORDING_RULE_UPTIME_1D}{service="${service.id}"}`;
    }

    const vectorQuery = buildHealthQuery(service);
    if (!vectorQuery) {
        return null;
    }

    // avg_over_time on the raw metric; 0/1 gauges yield uptime ratio directly.
    // Block-height gauges are normalized to 0/1 when mapping history points.
    return `avg_over_time(${vectorQuery}[1d])`;
}

function historyValueToRatio(rawValue, condition) {
    const normalized = normalizeUptimeRatio(rawValue);
    if (normalized === null) {
        return null;
    }

    if (normalized <= 1) {
        return normalized;
    }

    return evaluateHealthCondition(rawValue, condition) ? 1 : 0;
}

function normalizeUptimeRatio(rawValue) {
    const value = parseFloat(rawValue);
    if (Number.isNaN(value)) {
        return null;
    }

    if (value <= 1) {
        return value;
    }

    if (value <= 100) {
        return value / 100;
    }

    return value > 0 ? 1 : 0;
}

function ratioToBarClass(ratio) {
    if (ratio === null || ratio === undefined) {
        return 'no-data';
    }

    const downtimeMinutes = Math.round((1 - ratio) * 24 * 60);
    if (downtimeMinutes < 5) {
        return 'operational';
    }
    if (ratio >= 0.9) {
        return 'degraded';
    }
    return 'outage';
}

function computeOverallStatus(summary) {
    if (summary.outage > 0) {
        return 'outage';
    }
    if (summary.degraded > 0 || summary.unknown > 0) {
        return 'degraded';
    }
    return 'operational';
}

function getRangeDays(range) {
    switch (range) {
        case '7d': return 7;
        case '90d': return 90;
        case '30d':
        default: return 30;
    }
}

function getRangeStartDate(range) {
    const days = getRangeDays(range);
    const now = new Date();
    return new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - (days - 1),
        0, 0, 0, 0,
    ));
}

function utcDayTimestamp(date) {
    return Math.floor(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0, 0, 0, 0,
    ) / 1000);
}

function alignHistoricalPoints(rawPoints, range) {
    const numExpectedPoints = getRangeDays(range);
    const startDate = getRangeStartDate(range);
    const sortedPoints = [...rawPoints].sort((a, b) => a.timestamp - b.timestamp);

    const filledData = [];
    let promDataIndex = 0;

    for (let i = 0; i < numExpectedPoints; i++) {
        const barDate = new Date(Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate() + i,
            0, 0, 0, 0,
        ));
        const barTimestampSec = utcDayTimestamp(barDate);
        let pointToUse = null;

        if (promDataIndex < sortedPoints.length) {
            const promDataPoint = sortedPoints[promDataIndex];
            const promPointDate = new Date(promDataPoint.timestamp * 1000);
            const promDaySec = utcDayTimestamp(promPointDate);

            if (promDaySec === barTimestampSec) {
                pointToUse = {
                    ...promDataPoint,
                    timestamp: barTimestampSec,
                };
                promDataIndex++;
            } else if (promDaySec < barTimestampSec) {
                promDataIndex++;
                i -= 1;
                continue;
            }
        }

        if (pointToUse) {
            filledData.push(pointToUse);
        } else {
            filledData.push({
                timestamp: barTimestampSec,
                uptimeRatio: 0,
                hasData: false,
            });
        }
    }

    return filledData.slice(-numExpectedPoints);
}

function computeOverallUptimePercent(points) {
    const dataPoints = points.filter((point) => point.hasData);
    if (dataPoints.length === 0) {
        return null;
    }

    const total = dataPoints.reduce((sum, point) => sum + normalizeUptimeRatio(point.uptimeRatio), 0);
    return (total / dataPoints.length) * 100;
}

module.exports = {
    RECORDING_RULE_UP,
    buildHealthQuery,
    buildHealthExpression,
    buildHistoryQuery,
    buildStatusQuery,
    buildUptime30dQuery,
    historyValueToRatio,
    computeOverallStatus,
    computeOverallUptimePercent,
    getHealthCondition,
    getRangeDays,
    getRangeStartDate,
    alignHistoricalPoints,
    normalizeUptimeRatio,
    parseInstantValue,
    ratioToBarClass,
    valueToStatus,
};
