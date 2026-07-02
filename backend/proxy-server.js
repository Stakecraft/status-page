require('dotenv').config();

const express = require('express');
const cors = require('cors');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

const { loadServicesConfig } = require('./lib/services-config');
const { createPrometheusClient } = require('./lib/prometheus-client');
const { createV2Router } = require('./lib/v2-routes');
const { fetchGitHubIncidents } = require('./lib/incidents');
const { buildRssFeed } = require('./lib/rss');
const {
    buildStatusQuery,
    computeOverallStatus,
    getHealthCondition,
    parseInstantValue,
    valueToStatus,
} = require('./lib/health');

const app = express();
// Trust exactly one proxy hop (the bundled nginx). req.ip then comes from the
// X-Forwarded-For entry nginx appends, which the rate limiter keys on. Do not
// publish the app port directly — a direct client could spoof X-Forwarded-For
// and rotate rate-limit buckets at will.
app.set('trust proxy', 1);
const PROXY_SERVER_PORT = process.env.PROXY_PORT || 3333;
const ACTUAL_PROMETHEUS_URL = process.env.ACTUAL_PROMETHEUS_URL || 'http://127.0.0.1:9090';
const API_V2_ENABLED = process.env.API_V2_ENABLED !== 'false';
const USE_RECORDING_RULES = process.env.USE_RECORDING_RULES === 'true';
const SERVICES_CONFIG_PATH = process.env.SERVICES_CONFIG_PATH;

// GitHub API Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const GITHUB_INCIDENT_LABEL = process.env.GITHUB_INCIDENT_LABEL || 'incident';
const STATUS_PAGE_URL = process.env.STATUS_PAGE_URL || 'https://status.stakecraft.com';

const corsOptions = {
    origin: process.env.CORS_ORIGIN || 'https://status.stakecraft.com',
};

// --- v1 Service Configuration (legacy YAML) ---
let DETAILED_SERVICES_CONFIG = {};
const LEGACY_CONFIG_FILE_PATH = path.join(__dirname, 'proxy-services-config.yaml');

try {
    if (fs.existsSync(LEGACY_CONFIG_FILE_PATH)) {
        const fileContents = fs.readFileSync(LEGACY_CONFIG_FILE_PATH, 'utf8');
        const yamlConfig = yaml.load(fileContents);

        if (yamlConfig && Array.isArray(yamlConfig.services)) {
            yamlConfig.services.forEach((service) => {
                if (service.serviceId && service.metricName && service.jobLabel && service.healthCondition && service.displayName) {
                    DETAILED_SERVICES_CONFIG[service.serviceId] = service;
                } else {
                    console.warn('[Proxy Startup] Invalid legacy service entry:', service);
                }
            });
        }
    }
} catch (e) {
    console.error('[Proxy Startup] Error loading legacy YAML config:', e);
}

// --- v2 Service Configuration ---
const servicesConfig = loadServicesConfig(SERVICES_CONFIG_PATH);
const prometheus = createPrometheusClient(ACTUAL_PROMETHEUS_URL);

if (process.env.NODE_ENV === 'production') {
    app.use(cors(corsOptions));
} else {
    app.use(cors());
}
app.use(express.json());

// --- Health Check ---
app.get('/api/health', async (req, res) => {
    const checks = {
        prometheus: 'unknown',
        servicesLoaded: servicesConfig.services.length,
        legacyServicesLoaded: Object.keys(DETAILED_SERVICES_CONFIG).length,
        apiV2Enabled: API_V2_ENABLED,
        useRecordingRules: USE_RECORDING_RULES,
    };

    try {
        const result = await prometheus.query('up');
        checks.prometheus = result ? 'ok' : 'error';
    } catch {
        checks.prometheus = 'error';
    }

    const healthy = checks.prometheus === 'ok' && checks.servicesLoaded > 0;
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        lastChecked: new Date().toISOString(),
        checks,
    });
});

// --- v2 API ---
if (API_V2_ENABLED) {
    app.use('/api/v2', createV2Router({
        servicesConfig,
        prometheus,
        useRecordingRules: USE_RECORDING_RULES,
    }));
}

// Helper to evaluate health conditions
function evaluateHealthCondition(currentValue, healthCondition) {
    const numValue = parseFloat(currentValue);
    if (isNaN(numValue)) {
        return false;
    }
    
    // Parse the health condition (e.g., "> 0", "== 1", "< 100", ">= 50")
    const conditionMatch = healthCondition.match(/^(>=|<=|>|<|==|!=)\s*(.+)$/);
    if (!conditionMatch) {
        console.warn(`[Health Check] Invalid health condition format: ${healthCondition}`);
        return false;
    }
    
    const operator = conditionMatch[1];
    const threshold = parseFloat(conditionMatch[2]);
    
    if (isNaN(threshold)) {
        console.warn(`[Health Check] Invalid threshold value in condition: ${healthCondition}`);
        return false;
    }
    
    switch (operator) {
        case '>': return numValue > threshold;
        case '>=': return numValue >= threshold;
        case '<': return numValue < threshold;
        case '<=': return numValue <= threshold;
        case '==': return numValue === threshold;
        case '!=': return numValue !== threshold;
        default:
            console.warn(`[Health Check] Unsupported operator in condition: ${healthCondition}`);
            return false;
    }
}

// Helper to fetch from the actual Prometheus instance
async function queryPrometheus(prometheusQueryPath) {
    const targetUrl = `${ACTUAL_PROMETHEUS_URL}${prometheusQueryPath}`;
    // console.log(`[Proxy Backend] Querying Prometheus: ${targetUrl}`);
    try {
        const response = await fetch(targetUrl);
        if (!response.ok) {
            console.error(`[Proxy Backend] Prometheus request failed: ${response.status} for URL: ${targetUrl}`);
            throw new Error(`Prometheus request failed: ${response.status}`);
        }
        const data = await response.json();
        if (data.status !== 'success') {
            console.error(`[Proxy Backend] Prometheus API error: ${data.errorType || 'N/A'} - ${data.error || 'Unknown error'} for URL: ${targetUrl}`);
            throw new Error(`Prometheus API error: ${data.errorType} - ${data.error}`);
        }
        return data.data.result;
    } catch (error) {
        console.error('[Proxy Backend] Error fetching from Prometheus:', error, `URL: ${targetUrl}`);
        return null;
    }
}

async function getGitHubIncidents() {
    return fetchGitHubIncidents({
        token: GITHUB_TOKEN,
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        label: GITHUB_INCIDENT_LABEL,
        perPage: 100,
    });
}

async function getV2ServiceStatuses() {
    const summary = { operational: 0, degraded: 0, outage: 0, unknown: 0 };
    const services = [];

    await Promise.all(servicesConfig.services.map(async (service) => {
        const condition = getHealthCondition(service);
        const statusQuery = buildStatusQuery(service, USE_RECORDING_RULES);
        let currentValue = null;

        if (statusQuery) {
            const statusResult = await prometheus.query(statusQuery);
            currentValue = parseInstantValue(
                statusResult,
                USE_RECORDING_RULES ? { service: service.id } : null,
            );
        }

        const status = valueToStatus(currentValue, condition);
        summary[status] += 1;
        services.push({
            id: service.id,
            name: service.name,
            status,
        });
    }));

    return {
        overall: computeOverallStatus(summary),
        summary,
        services,
    };
}

// --- GitHub Incidents Endpoint ---
app.get('/api/github-incidents', async (req, res) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
        console.error('[GitHub Incidents] Missing GITHUB_TOKEN, GITHUB_REPO_OWNER, or GITHUB_REPO_NAME in environment variables.');
        return res.status(500).json({ error: 'GitHub integration not configured on server.' });
    }

    try {
        const incidents = await getGitHubIncidents();
        res.json(incidents);
    } catch (error) {
        console.error('[GitHub Incidents] Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents from GitHub.' });
    }
});

app.get('/api/rss', async (req, res) => {
    try {
        const [statusPayload, incidents] = await Promise.all([
            getV2ServiceStatuses(),
            getGitHubIncidents().catch(() => []),
        ]);

        const feedUrl = `${req.protocol}://${req.get('host')}/api/rss`;
        const xml = buildRssFeed({
            siteUrl: STATUS_PAGE_URL,
            feedUrl,
            title: 'Stakecraft Status',
            description: 'Service status and incident updates for Stakecraft infrastructure.',
            overallStatus: statusPayload.overall,
            services: statusPayload.services,
            incidents,
        });

        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(xml);
    } catch (error) {
        console.error('[RSS] Error building feed:', error);
        res.status(500).send('Failed to build RSS feed');
    }
});

// --- Prometheus Proxy Endpoints ---

// Endpoint for current status
app.get('/api/status/:serviceId', async (req, res) => {
    const { serviceId } = req.params;
    const serviceConfig = DETAILED_SERVICES_CONFIG[serviceId];

    if (!serviceConfig) {
        return res.status(404).json({ error: 'Service not found or not configured in proxy' });
    }

    console.log(`[Proxy] Request for current status of serviceId: ${serviceId} (${serviceConfig.displayName})`);

    const promQuery = `${serviceConfig.metricName}{${serviceConfig.jobLabel}}`;
    const prometheusQueryPath = `/api/v1/query?query=${encodeURIComponent(promQuery)}`;
    
    const result = await queryPrometheus(prometheusQueryPath);

    if (result && result.length > 0 && result[0].value) {
        const currentValue = result[0].value[1];
        const isHealthy = evaluateHealthCondition(currentValue, serviceConfig.healthCondition);
        res.json({ 
            serviceId: serviceId,
            status: isHealthy ? 'operational' : 'outage',
            currentValue: currentValue,
            healthCondition: serviceConfig.healthCondition,
            lastChecked: new Date().toISOString() 
        });
    } else {
        console.warn(`[Proxy] No current status data for ${serviceId} from Prometheus query: ${promQuery}`);
        res.json({ 
            serviceId: serviceId,
            status: 'unknown', // Or 'outage' if no data means outage
            message: 'No data from Prometheus or malformed result.',
            lastChecked: new Date().toISOString()
        });
    }
});

// Endpoint for historical data
app.get('/api/history/:serviceId', async (req, res) => {
    const { serviceId } = req.params;
    const timeRange = req.query.range || '30d'; // Default to 30d if not specified
    const serviceConfig = DETAILED_SERVICES_CONFIG[serviceId];

    if (!serviceConfig) {
        return res.status(404).json({ error: 'Service not found or not configured in proxy' });
    }

    console.log(`[Proxy] Request for history of serviceId: ${serviceId} (${serviceConfig.displayName}), range: ${timeRange}`);

    let stepSeconds = '1d';
    // Note: The historical query for avg_over_time already implies a daily average.
    // The start/end dates for Prometheus query_range will depend on the 'timeRange' query param.
    const now = new Date();
    let startDate = new Date();
    switch (timeRange) {
        case '7d': startDate.setDate(now.getDate() - (7 -1) ); break;
        case '15d': startDate.setDate(now.getDate() - (15-1)); break;
        case '30d':
        default: startDate.setDate(now.getDate() - (30-1)); break;
    }
    startDate.setUTCHours(0, 0, 0, 0);

    const promQuery = `avg_over_time(${serviceConfig.metricName}{${serviceConfig.jobLabel}}[1d])`;
    const prometheusQueryPath = `/api/v1/query_range?query=${encodeURIComponent(promQuery)}&start=${startDate.toISOString()}&end=${now.toISOString()}&step=${stepSeconds}`;

    const result = await queryPrometheus(prometheusQueryPath);

    if (result && result.length > 0 && result[0].values) {
        const processedData = result[0].values.sort((a,b) => a[0] - b[0]).map(val => ({
            timestamp: val[0],
            uptimeRatio: parseFloat(val[1]),
            hasData: true // Assuming all points from avg_over_time have data
        }));
        res.json({ 
            serviceId: serviceId,
            historicalData: processedData 
        });
    } else {
        console.warn(`[Proxy] No historical data for ${serviceId} from Prometheus query: ${promQuery}`);
        res.json({ 
            serviceId: serviceId, 
            historicalData: [], 
            message: 'No historical data from Prometheus or malformed result.' 
        });
    }
});

app.listen(PROXY_SERVER_PORT, () => {
    console.log(`Status Page API running on http://localhost:${PROXY_SERVER_PORT}`);
    console.log(`Prometheus: ${ACTUAL_PROMETHEUS_URL}`);
    console.log(`API v2: ${API_V2_ENABLED ? 'enabled' : 'disabled'} | Recording rules: ${USE_RECORDING_RULES ? 'yes' : 'no (direct queries)'}`);
    console.log(`Services config: ${servicesConfig.path} (${servicesConfig.services.length} services)`);

    if (GITHUB_TOKEN && GITHUB_REPO_OWNER && GITHUB_REPO_NAME) {
        console.log(`GitHub incidents: ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME} [${GITHUB_INCIDENT_LABEL}]`);
    } else {
        console.warn('[Startup] GitHub incidents: disabled (missing token/repo config)');
    }

    if (Object.keys(DETAILED_SERVICES_CONFIG).length > 0) {
        console.log(`Legacy v1 API: ${Object.keys(DETAILED_SERVICES_CONFIG).length} services from proxy-services-config.yaml`);
    } else {
        console.warn('[Startup] Legacy v1 API: no services loaded (proxy-services-config.yaml missing)');
    }
});

process.on('SIGINT', () => { console.log("\nGracefully shutting down from SIGINT (Ctrl-C)"); process.exit(0); }); 