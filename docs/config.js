// config.js (Frontend Configuration)

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://api.status.stakecraft.com';

// Use v2 batch API (recommended). Set to false to fall back to legacy v1 per-service endpoints.
const USE_API_V2 = true;

// Auto-refresh interval in seconds (0 = disabled)
const STATUS_POLL_INTERVAL_SECONDS = 60;

// RSS feed served by the status API
const RSS_FEED_URL = `${API_BASE_URL}/api/rss`;
