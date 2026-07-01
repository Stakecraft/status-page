const { envInt } = require('./env');

const DEFAULT_TIMEOUT_MS = envInt('PROMETHEUS_FETCH_TIMEOUT_MS', 15000);

function createPrometheusClient(prometheusUrl, timeoutMs = DEFAULT_TIMEOUT_MS) {
    async function query(promql) {
        const queryPath = `/api/v1/query?query=${encodeURIComponent(promql)}`;
        return queryPrometheus(prometheusUrl, queryPath, timeoutMs);
    }

    async function queryRange(promql, start, end, step) {
        const startSec = Math.floor(start.getTime() / 1000);
        const endSec = Math.floor(end.getTime() / 1000);
        const queryPath = `/api/v1/query_range?query=${encodeURIComponent(promql)}&start=${startSec}&end=${endSec}&step=${step}`;
        return queryPrometheus(prometheusUrl, queryPath, timeoutMs);
    }

    return { query, queryRange };
}

async function queryPrometheus(prometheusUrl, prometheusQueryPath, timeoutMs) {
    const targetUrl = `${prometheusUrl}${prometheusQueryPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(targetUrl, { signal: controller.signal });
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
        if (error.name === 'AbortError') {
            console.error(`[Prometheus] Request timed out after ${timeoutMs}ms`);
        } else {
            console.error('[Prometheus] Error fetching metrics:', error.message);
        }
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    createPrometheusClient,
};
