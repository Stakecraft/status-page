require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const yaml = require('js-yaml'); // For parsing YAML
const fs = require('fs');         // For reading files
const path = require('path');

const app = express();
const PROXY_SERVER_PORT = process.env.PROXY_PORT || 3000; // Can still use .env for this if you like
const ACTUAL_PROMETHEUS_URL = process.env.ACTUAL_PROMETHEUS_URL || 'http://127.0.0.1:9090'; // Or this

// GitHub API Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME;
const GITHUB_INCIDENT_LABEL = process.env.GITHUB_INCIDENT_LABEL || 'incident'; // Default to 'incident'

// CORS configuration
const corsOptions = {
  origin: 'https://status.stakecraft.com'
};

// --- Detailed Service Configuration (Loaded from YAML file) ---
let DETAILED_SERVICES_CONFIG = {}; // This will be populated from YAML
const CONFIG_FILE_PATH = path.join(__dirname, 'proxy-services-config.yaml');

try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
        const fileContents = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        const yamlConfig = yaml.load(fileContents);

        if (yamlConfig && Array.isArray(yamlConfig.services)) {
            yamlConfig.services.forEach(service => {
                if (service.serviceId && service.metricName && service.jobLabel && service.healthCondition && service.displayName) {
                    DETAILED_SERVICES_CONFIG[service.serviceId] = service;
                } else {
                    console.warn('[Proxy Startup] Invalid service entry in YAML config, missing required fields:', service);
                }
            });
        } else {
            console.error('[Proxy Startup] CRITICAL: YAML config file is not structured correctly. Expected a `services` array.');
        }
    } else {
        console.error(`[Proxy Startup] CRITICAL: Configuration file not found at ${CONFIG_FILE_PATH}. No services will be loaded.`);
    }
} catch (e) {
    console.error('[Proxy Startup] CRITICAL: Error loading or parsing YAML configuration file:', e);
}

// app.use(cors(corsOptions)); // Use specific origin for production
app.use(cors()); // Allow all origins for local development
app.use(express.json());

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

// --- GitHub Incidents Endpoint ---
app.get('/api/github-incidents', async (req, res) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
        console.error('[GitHub Incidents] Missing GITHUB_TOKEN, GITHUB_REPO_OWNER, or GITHUB_REPO_NAME in environment variables.');
        return res.status(500).json({ error: 'GitHub integration not configured on server.' });
    }

    const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`;
    const params = new URLSearchParams({
        labels: GITHUB_INCIDENT_LABEL,
        state: 'all', // Fetch both open and closed issues
        sort: 'created',
        direction: 'desc', // Most recent first
        per_page: 10 // Fetch latest 10 incidents, adjust as needed
    });

    try {
        console.log(`[GitHub Incidents] Fetching incidents from ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME} with label ${GITHUB_INCIDENT_LABEL}`);
        const response = await fetch(`${GITHUB_API_URL}?${params.toString()}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error(`[GitHub Incidents] GitHub API request failed: ${response.status}`, errorData);
            throw new Error(`GitHub API request failed: ${response.status}`);
        }

        const issues = await response.json();
        
        const incidents = issues.map(issue => {
            let severity = null;
            const severityLabel = issue.labels.find(label => label.name.startsWith('severity:') || label.name.startsWith('sev:'));
            if (severityLabel) {
                severity = severityLabel.name.split(':')[1]; // Get value after ':'
            }

            let affectedServices = [];
            issue.labels.forEach(label => {
                if (label.name.startsWith('service:')) {
                    affectedServices.push(label.name.split(':')[1]);
                }
            });

            return {
                id: issue.id,
                title: issue.title,
                url: issue.html_url,      
                number: issue.number,
                createdAt: issue.created_at, 
                updatedAt: issue.updated_at, 
                closedAt: issue.closed_at,   
                state: issue.state, 
                labels: issue.labels.map(label => label.name),
                body: issue.body, 
                statusText: issue.state === 'closed' ? 'Resolved' : (issue.labels.find(l => l.name.startsWith('status:'))?.name.split(':')[1] || 'Open'),
                severity: severity, // Add severity
                affectedServices: affectedServices // Add affected services
            };
        });

        res.json(incidents);

    } catch (error) {
        console.error('[GitHub Incidents] Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents from GitHub.' });
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
    console.log(`Local Prometheus Proxy server (v4 - YAML config) running on http://localhost:${PROXY_SERVER_PORT}`);
    console.log(`Proxying to Prometheus at: ${ACTUAL_PROMETHEUS_URL}`);
    if (GITHUB_TOKEN && GITHUB_REPO_OWNER && GITHUB_REPO_NAME) {
        console.log(`GitHub Incident Integration: Enabled for ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}, label: '${GITHUB_INCIDENT_LABEL}'`);
    } else {
        console.warn('[Proxy Startup] GitHub Incident Integration: DISABLED due to missing GITHUB_TOKEN, GITHUB_REPO_OWNER, or GITHUB_REPO_NAME.');
    }
    if (Object.keys(DETAILED_SERVICES_CONFIG).length > 0) {
        console.log('--- Services Configured in Proxy (from proxy-services-config.yaml) ---');
        for (const id in DETAILED_SERVICES_CONFIG) {
            console.log(`- ID: ${id}, Name: ${DETAILED_SERVICES_CONFIG[id].displayName}, Metric: ${DETAILED_SERVICES_CONFIG[id].metricName}, Labels: ${DETAILED_SERVICES_CONFIG[id].jobLabel}, Condition: ${DETAILED_SERVICES_CONFIG[id].healthCondition}`);
        }
    } else {
        console.warn('[Proxy Startup] WARNING: No services were successfully loaded from YAML config. Proxy might not function as expected.');
    }
    console.log('----------------------------------------------------------');
});

process.on('SIGINT', () => { console.log("\nGracefully shutting down from SIGINT (Ctrl-C)"); process.exit(0); }); 