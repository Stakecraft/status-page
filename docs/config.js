// config.js (Frontend Configuration)

// API_BASE_URL points to your backend server that proxies requests to Prometheus and GitHub.
// For local development, this will be your local proxy (e.g., http://localhost:3000).
// For production, this will be your deployed backend URL (e.g., https://api.status.stakecraft.com).
const API_BASE_URL = 'https://api.status.stakecraft.com'; // <-- IMPORTANT: Set for local dev. Change for prod.

// SERVICES_CONFIG defines what services the frontend should display.
// Each 'serviceId' MUST correspond to a 'serviceId' defined in the proxy's YAML configuration.
const SERVICES_CONFIG = [
    {
        name: 'Stakecraft.com',
        serviceId: 'stakecraftCom',
        element: null
    },
    {
        name: 'Solana Mainnet Node',
        serviceId: 'solanaNodeStakecraft',
        element: null
    },
    {
        name: 'Walrus Mainnet Node',
        serviceId: 'walrusNodeStakecraft',
        element: null
    },
    {
        name: 'Kava Mainnet Node',
        serviceId: 'kavaNodeStakecraft',
        element: null
    },
    {
        name: 'Koii Mainnet Node',
        serviceId: 'koiiNodeStakecraft',
        element: null
    },
    {
        name: 'Supra Oracles Mainnet Node',
        serviceId: 'supraNodeStakecraft',
        element: null
    },
    {
        name: 'Band Protocol Mainnet Node',
        serviceId: 'bandNodeStakecraft',
        element: null
    },
    {
        name: 'Moonriver Network Collator',
        serviceId: 'moonriverNodeStakecraft',
        element: null
    },
    {
        name: 'Q Protocol Mainnet Node',
        serviceId: 'qprotocolNodeStakecraft',
        element: null
    },
    {
        name: 'The Graph Indexer',
        serviceId: 'thegraphNodeStakecraft',
        element: null
    },
    {
        name: 'Polygon Network Mainnet Node',
        serviceId: 'polygonNodeStakecraft',
        element: null
    },
    {
        name: 'Altair Network Collator',
        serviceId: 'altairNodeStakecraft',
        element: null
    },
    {
        name: 'Centrifuge Network Collator',
        serviceId: 'centrifugeNodeStakecraft',
        element: null
    },
    {
        name: 'Ki Foundation Mainnet Node',
        serviceId: 'kiNodeStakecraft',
        element: null
    },
    {
        name: 'Agoric Mainnet Node',
        serviceId: 'agoricNodeStakecraft',
        element: null
    },
    {
        name: 'Zetachain Mainnet Node',
        serviceId: 'zetachainNodeStakecraft',
        element: null
    },
    {
        name: 'Covalent Mainnet Node',
        serviceId: 'covalentNodeStakecraft',
        element: null
    },
    {
        name: 'Stafi Mainnet Node',
        serviceId: 'stafiNodeStakecraft',
        element: null
    },
    {
        name: 'SubQuery Mainnet Node',
        serviceId: 'subqueryNodeStakecraft',
        element: null
    },
    {
        name: 'Stargaze Mainnet Node',
        serviceId: 'stargazeNodeStakecraft',
        element: null
    },
    {
        name: 'Bitsong Mainnet Node',
        serviceId: 'bitsongNodeStakecraft',
        element: null
    },
    {
        name: 'BitsCrunch Mainnet Node',
        serviceId: 'bitscrunchNodeStakecraft',
        element: null
    },
    {
        name: 'RedBelly Mainnet Node',
        serviceId: 'redbellyNodeStakecraft',
        element: null
    },
    {
        name: 'Near Protocol Mainnet Node',
        serviceId: 'nearNodeStakecraft',
        element: null
    }
];

// Note: script.js requires API_BASE_URL and SERVICES_CONFIG to be available globally
// when it loads. This setup achieves that if config.js is loaded before script.js. 