// config.js (Frontend Configuration)

// API_BASE_URL points to your backend server that proxies requests to Prometheus and GitHub.
// For local development, this will be your local proxy (e.g., http://localhost:3000).
// For production, this will be your deployed backend URL (e.g., https://api.status.stakecraft.com).
const API_BASE_URL = 'http://localhost:3000'; // <-- IMPORTANT: Set for local dev. Change for prod.

// SERVICES_CONFIG defines what services the frontend should display.
// Each 'serviceId' MUST correspond to a 'serviceId' defined in the proxy's .env configuration.
const SERVICES_CONFIG = [
    {
        name: 'Solana Mainnet Node',      // Name displayed on the status page UI
        serviceId: 'solanaNodeStakecraft',  // ID to fetch data from the proxy (must match proxy .env config)
        element: null                     // Populated by script.js
    },
    {
        name: 'Walrus Mainnet Node',
        serviceId: 'walrusNodeStakecraft',
        element: null
    },
    {
        name: 'Stakecraft.com',
        serviceId: 'stakecraftCom', // Must match the ID in your proxy YAML
        element: null
    },
    // To add another service to the UI:
    // 1. Ensure its full details are in the proxy's .env PROXY_DETAILED_SERVICES_JSON.
    // 2. Add its HTML structure in index.html.
    // 3. Add its entry here:
    // {
    //     name: 'My Awesome API',        // UI Display Name
    //     serviceId: 'myAwesomeApi',    // ID (must match proxy .env config for 'myAwesomeApi')
    //     element: null
    // }
];

// Note: script.js requires API_BASE_URL and SERVICES_CONFIG to be available globally
// when it loads. This setup achieves that if config.js is loaded before script.js. 