const express = require('express');
const {
    buildHistoryQuery,
    buildStatusQuery,
    computeOverallStatus,
    computeOverallUptimePercent,
    getHealthCondition,
    isValidHistoryRange,
    getRangeStartDate,
    alignHistoricalPoints,
    mapHistoryRangeValues,
    parseInstantValue,
    valueToStatus,
} = require('./health');
const { groupPublicServicesByCategory } = require('./services-config');
const {
    createRateLimiter,
    createResponseCache,
    mapWithConcurrency,
} = require('./request-guard');
const { envInt } = require('./env');

const STATUS_CACHE_SEC = envInt('V2_STATUS_CACHE_SEC', 15);
const HISTORY_CACHE_SEC = envInt('V2_HISTORY_CACHE_SEC', 60);
const PROMETHEUS_CONCURRENCY = envInt('V2_PROMETHEUS_CONCURRENCY', 5);
const RATE_LIMIT_WINDOW_MS = envInt('V2_RATE_LIMIT_WINDOW_MS', 60000);
// Responses are cached, so requests are cheap; the limiter only guards the
// cold path. Keep the ceiling high enough for many users behind one NAT.
const RATE_LIMIT_MAX = envInt('V2_RATE_LIMIT_MAX', 120);

// Don't cache a status snapshot where every service is unknown — that means
// Prometheus was unreachable, and caching it would pin the outage for the TTL.
function statusPayloadWorthCaching(payload) {
    return payload.services.length === 0
        || payload.services.some((service) => service.status !== 'unknown');
}

// Same idea for history payloads (both the aggregate and per-service shapes):
// an entirely empty result set means the query failed, not that uptime is 0.
function historyPayloadWorthCaching(payload) {
    if (payload.histories) {
        return Object.values(payload.histories).some(
            (history) => history.historicalData.some((point) => point.hasData),
        );
    }
    return payload.historicalData.some((point) => point.hasData);
}

function createV2Router({ servicesConfig, prometheus, useRecordingRules = false }) {
    const router = express.Router();
    const publicCategories = groupPublicServicesByCategory(servicesConfig);
    const getStatusCached = createResponseCache({
        ttlMs: STATUS_CACHE_SEC * 1000,
        shouldCache: statusPayloadWorthCaching,
    });
    const getHistoryCached = createResponseCache({
        ttlMs: HISTORY_CACHE_SEC * 1000,
        shouldCache: historyPayloadWorthCaching,
    });
    const expensiveRouteLimiter = createRateLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: RATE_LIMIT_MAX,
    });

    router.get('/config', (req, res) => {
        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            version: servicesConfig.version,
            categories: publicCategories,
            serviceCount: servicesConfig.services.length,
        });
    });

    router.get('/status', expensiveRouteLimiter, async (req, res) => {
        const payload = await getStatusCached('status', async () => {
            const lastChecked = new Date().toISOString();

            const services = await mapWithConcurrency(
                servicesConfig.services,
                PROMETHEUS_CONCURRENCY,
                async (service) => {
                    const condition = getHealthCondition(service);
                    const statusQuery = buildStatusQuery(service, useRecordingRules);

                    let currentValue = null;

                    if (statusQuery) {
                        const statusResult = await prometheus.query(statusQuery);
                        currentValue = parseInstantValue(
                            statusResult,
                            useRecordingRules ? { service: service.id } : null,
                        );
                    }

                    const status = valueToStatus(currentValue, condition);

                    return {
                        id: service.id,
                        name: service.name,
                        category: service.category,
                        icon: service.icon || null,
                        status,
                        lastChecked,
                    };
                },
            );

            services.sort((a, b) => a.name.localeCompare(b.name));

            const summary = { operational: 0, degraded: 0, outage: 0, unknown: 0 };
            services.forEach((service) => {
                summary[service.status] += 1;
            });

            return {
                overall: computeOverallStatus(summary),
                summary,
                services,
                lastChecked,
            };
        });

        res.set('Cache-Control', `public, max-age=${STATUS_CACHE_SEC}`);
        res.json(payload);
    });

    router.get('/history/:serviceId', expensiveRouteLimiter, async (req, res) => {
        const { serviceId } = req.params;
        const range = req.query.range || '30d';

        if (!isValidHistoryRange(range)) {
            return res.status(400).json({ error: 'Invalid range' });
        }

        const service = servicesConfig.servicesById[serviceId];

        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        const historyQuery = buildHistoryQuery(service, useRecordingRules);
        if (!historyQuery) {
            return res.status(500).json({ error: 'No history query configured for service' });
        }

        // 'one:' prefix keeps a service literally named "all" from colliding
        // with the aggregate /history cache key below.
        const cacheKey = `history:one:${serviceId}:${range}`;
        const payload = await getHistoryCached(cacheKey, async () => {
            const now = new Date();
            const startDate = getRangeStartDate(range);
            const result = await prometheus.queryRange(historyQuery, startDate, now, '1d');

            const condition = getHealthCondition(service);
            let rawPoints = [];
            if (result && result.length > 0 && result[0].values) {
                rawPoints = mapHistoryRangeValues(result[0].values, condition);
            }

            const historicalData = alignHistoricalPoints(rawPoints, range);
            const overallUptime = computeOverallUptimePercent(historicalData);

            return {
                serviceId,
                range,
                historicalData,
                overallUptime,
            };
        });

        res.set('Cache-Control', `public, max-age=${HISTORY_CACHE_SEC}`);
        res.json(payload);
    });

    router.get('/history', expensiveRouteLimiter, async (req, res) => {
        const range = req.query.range || '30d';

        if (!isValidHistoryRange(range)) {
            return res.status(400).json({ error: 'Invalid range' });
        }

        const cacheKey = `history:all:${range}`;
        const payload = await getHistoryCached(cacheKey, async () => {
            const histories = {};

            await mapWithConcurrency(
                servicesConfig.services,
                PROMETHEUS_CONCURRENCY,
                async (service) => {
                    const historyQuery = buildHistoryQuery(service, useRecordingRules);
                    if (!historyQuery) {
                        histories[service.id] = { historicalData: [], overallUptime: null };
                        return;
                    }

                    const condition = getHealthCondition(service);
                    const now = new Date();
                    const startDate = getRangeStartDate(range);
                    const result = await prometheus.queryRange(historyQuery, startDate, now, '1d');

                    let rawPoints = [];
                    if (result && result.length > 0 && result[0].values) {
                        rawPoints = mapHistoryRangeValues(result[0].values, condition);
                    }

                    const historicalData = alignHistoricalPoints(rawPoints, range);
                    histories[service.id] = {
                        historicalData,
                        overallUptime: computeOverallUptimePercent(historicalData),
                    };
                },
            );

            return { range, histories };
        });

        res.set('Cache-Control', `public, max-age=${HISTORY_CACHE_SEC}`);
        res.json(payload);
    });

    return router;
}

module.exports = {
    createV2Router,
};
