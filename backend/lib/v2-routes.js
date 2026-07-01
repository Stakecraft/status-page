const express = require('express');
const {
    buildHistoryQuery,
    buildStatusQuery,
    computeOverallStatus,
    computeOverallUptimePercent,
    getHealthCondition,
    getRangeStartDate,
    alignHistoricalPoints,
    historyValueToRatio,
    parseInstantValue,
    valueToStatus,
} = require('./health');
const { groupServicesByCategory } = require('./services-config');

function createV2Router({ servicesConfig, prometheus, useRecordingRules = false }) {
    const router = express.Router();

    router.get('/config', (req, res) => {
        res.json({
            version: servicesConfig.version,
            categories: groupServicesByCategory(servicesConfig),
            serviceCount: servicesConfig.services.length,
        });
    });

    router.get('/status', async (req, res) => {
        const lastChecked = new Date().toISOString();
        const summary = { operational: 0, degraded: 0, outage: 0, unknown: 0 };
        const services = [];

        await Promise.all(servicesConfig.services.map(async (service) => {
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
            summary[status] += 1;

            services.push({
                id: service.id,
                name: service.name,
                category: service.category,
                icon: service.icon || null,
                status,
                lastChecked,
            });
        }));

        services.sort((a, b) => a.name.localeCompare(b.name));

        res.json({
            overall: computeOverallStatus(summary),
            summary,
            services,
            lastChecked,
        });
    });

    router.get('/history/:serviceId', async (req, res) => {
        const { serviceId } = req.params;
        const range = req.query.range || '30d';
        const service = servicesConfig.servicesById[serviceId];

        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        const historyQuery = buildHistoryQuery(service, useRecordingRules);
        if (!historyQuery) {
            return res.status(500).json({ error: 'No history query configured for service' });
        }

        const now = new Date();
        const startDate = getRangeStartDate(range);
        const result = await prometheus.queryRange(historyQuery, startDate, now, '1d');

        const condition = getHealthCondition(service);
        let rawPoints = [];
        if (result && result.length > 0 && result[0].values) {
            rawPoints = result[0].values.map(([timestamp, value]) => ({
                timestamp,
                uptimeRatio: historyValueToRatio(value, condition),
                hasData: true,
            }));
        }

        const historicalData = alignHistoricalPoints(rawPoints, range);
        const overallUptime = computeOverallUptimePercent(historicalData);

        res.json({
            serviceId,
            range,
            historicalData,
            overallUptime,
        });
    });

    router.get('/history', async (req, res) => {
        const range = req.query.range || '30d';
        const histories = {};

        await Promise.all(servicesConfig.services.map(async (service) => {
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
                rawPoints = result[0].values.map(([timestamp, value]) => ({
                    timestamp,
                    uptimeRatio: historyValueToRatio(value, condition),
                    hasData: true,
                }));
            }

            const historicalData = alignHistoricalPoints(rawPoints, range);
            histories[service.id] = {
                historicalData,
                overallUptime: computeOverallUptimePercent(historicalData),
            };
        }));

        res.json({ range, histories });
    });

    return router;
}

module.exports = {
    createV2Router,
};
