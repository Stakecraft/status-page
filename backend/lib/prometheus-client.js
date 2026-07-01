const fetch = require('node-fetch');

function createPrometheusClient(prometheusUrl) {
    async function query(promql) {
        const queryPath = `/api/v1/query?query=${encodeURIComponent(promql)}`;
        return queryPrometheus(prometheusUrl, queryPath);
    }

    async function queryRange(promql, start, end, step) {
        const startSec = Math.floor(start.getTime() / 1000);
        const endSec = Math.floor(end.getTime() / 1000);
        const queryPath = `/api/v1/query_range?query=${encodeURIComponent(promql)}&start=${startSec}&end=${endSec}&step=${step}`;
        return queryPrometheus(prometheusUrl, queryPath);
    }

    return { query, queryRange };
}

async function queryPrometheus(prometheusUrl, prometheusQueryPath) {
    const targetUrl = `${prometheusUrl}${prometheusQueryPath}`;

    try {
        const response = await fetch(targetUrl);
        if (!response.ok) {
            console.error(`[Prometheus] Request failed: ${response.status} for URL: ${targetUrl}`);
            return null;
        }

        const data = await response.json();
        if (data.status !== 'success') {
            console.error(`[Prometheus] API error: ${data.errorType || 'N/A'} - ${data.error || 'Unknown error'}`);
            return null;
        }

        return data.data.result;
    } catch (error) {
        console.error('[Prometheus] Error fetching metrics:', error.message);
        return null;
    }
}

module.exports = {
    createPrometheusClient,
};
