document.addEventListener('DOMContentLoaded', function () {
    if (typeof API_BASE_URL === 'undefined') {
        showFatalError('API_BASE_URL is not defined in config.js');
        return;
    }

    const useV2 = typeof USE_API_V2 !== 'undefined' ? USE_API_V2 : true;
    const pollInterval = typeof STATUS_POLL_INTERVAL_SECONDS !== 'undefined'
        ? STATUS_POLL_INTERVAL_SECONDS
        : 60;

    const statusListEl = document.getElementById('status-list');
    const tooltip = document.getElementById('status-tooltip');
    const tooltipContent = {
        date: tooltip.querySelector('.tooltip-date'),
        uptime: tooltip.querySelector('.tooltip-uptime strong'),
        downtime: tooltip.querySelector('.tooltip-downtime'),
        incidents: tooltip.querySelector('.tooltip-incidents'),
    };
    const tooltipArrow = tooltip.querySelector('.tooltip-arrow');
    const overallStatusIcon = document.querySelector('.overall-status .status-icon');
    const overallStatusH1 = document.querySelector('.overall-status h1');
    const outageList = document.getElementById('outage-list');
    const outageServicesList = document.getElementById('outage-services');
    const nodeCounter = document.getElementById('node-counter');
    const lastUpdatedEl = document.getElementById('last-updated');

    let globalServiceStates = {};
    let categoriesConfig = [];
    let pollTimer = null;
    let activeRange = '30d';
    let activeTab = 'nodes';
    let lastStatusPayload = null;
    let incidentsCache = [];

    const themeToggle = document.getElementById('theme-toggle');
    const rssFeedLink = document.getElementById('rss-feed-link');
    const rssHeadLink = document.getElementById('rss-link');

    function initTheme() {
        if (document.documentElement.dataset.theme) {
            return;
        }
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    }

    function toggleTheme() {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('stakecraft-theme', next);
    }

    function initRssLink() {
        const rssUrl = typeof RSS_FEED_URL !== 'undefined' ? RSS_FEED_URL : `${API_BASE_URL}/api/rss`;
        if (rssFeedLink) {
            rssFeedLink.href = rssUrl;
        }
        if (rssHeadLink) {
            rssHeadLink.href = rssUrl;
        }
    }

    function incidentAffectsService(incident, serviceId) {
        if (!incident || !serviceId) {
            return false;
        }
        if (incident.affectedServices?.includes(serviceId)) {
            return true;
        }
        return incident.labels?.includes(`service:${serviceId}`) ?? false;
    }

    function incidentOverlapsDay(incident, dayTimestampSec) {
        if (!incident?.createdAt) {
            return false;
        }
        const dayStart = dayTimestampSec * 1000;
        const dayEnd = dayStart + 86400000;
        const incidentStart = new Date(incident.createdAt).getTime();
        const incidentEnd = incident.closedAt
            ? new Date(incident.closedAt).getTime()
            : Date.now();
        return incidentStart < dayEnd && incidentEnd >= dayStart;
    }

    function enrichHistoryWithIncidents(historicalData, serviceId) {
        return (historicalData || []).map((point) => ({
            ...point,
            incidents: incidentsCache
                .filter(
                    (incident) => incidentAffectsService(incident, serviceId)
                        && incidentOverlapsDay(incident, point.timestamp),
                )
                .map((incident) => ({
                    title: incident.title,
                    url: incident.url,
                    number: incident.number,
                    statusText: incident.statusText,
                })),
        }));
    }

    async function loadIncidents() {
        const incidents = await fetchFromProxy('/api/github-incidents');
        if (Array.isArray(incidents)) {
            incidentsCache = incidents;
        }
    }

    function getRangeDayCount(range) {
        switch (range) {
            case '7d': return 7;
            case '90d': return 90;
            case '30d':
            default: return 30;
        }
    }

    const TAB_CATEGORIES = {
        nodes: ['node', 'collator'],
        services: ['website', 'indexer', 'oracle'],
    };

    function getTabForCategory(category) {
        if (TAB_CATEGORIES.nodes.includes(category)) {
            return 'nodes';
        }
        return 'services';
    }

    function updateTabCounter() {
        if (!nodeCounter) {
            return;
        }
        const count = flattenCategories(categoriesConfig).filter(
            (service) => getTabForCategory(service.category) === activeTab,
        ).length;
        nodeCounter.textContent = `(${count})`;
    }

    function switchTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.tab-button').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.tabPanel === tab);
        });
        updateTabCounter();
    }

    function showFatalError(message) {
        console.error(message);
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.innerHTML = `<h1 style="color: red; text-align: center;">Configuration Error: ${message}</h1>`;
        }
    }

    async function fetchFromProxy(endpointPath) {
        const url = `${API_BASE_URL}${endpointPath}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Error fetching from API:', error, url);
            return null;
        }
    }

    function formatStatusLabel(status) {
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function formatUptimePercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) {
            return 'N/A';
        }
        return `${value.toFixed(3)}%`;
    }

    function defaultServiceIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.innerHTML = '<path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z" fill="currentColor"/>';
        svg.setAttribute('aria-label', name);
        return svg;
    }

    function createServiceIcon(service) {
        const wrapper = document.createElement('div');
        wrapper.className = 'service-icon';

        if (service.icon) {
            const img = document.createElement('img');
            img.src = service.icon;
            img.alt = service.name;
            img.width = 24;
            img.height = 24;
            wrapper.appendChild(img);
        } else {
            wrapper.appendChild(defaultServiceIcon(service.name));
        }

        return wrapper;
    }

    function createServiceElement(service) {
        const element = document.createElement('div');
        element.className = 'service-status';
        element.dataset.serviceId = service.id;

        const serviceRow = document.createElement('div');
        serviceRow.className = 'service-row';

        const serviceInfo = document.createElement('div');
        serviceInfo.className = 'service-info';
        serviceInfo.appendChild(createServiceIcon(service));

        const title = document.createElement('h3');
        title.textContent = service.name;
        serviceInfo.appendChild(title);

        const serviceMeta = document.createElement('div');
        serviceMeta.className = 'service-meta';

        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge unknown';
        statusBadge.textContent = 'Loading';
        serviceMeta.appendChild(statusBadge);

        const uptimePercentage = document.createElement('span');
        uptimePercentage.className = 'uptime-compact';
        uptimePercentage.textContent = 'N/A';
        serviceMeta.appendChild(uptimePercentage);

        serviceRow.appendChild(serviceInfo);
        serviceRow.appendChild(serviceMeta);

        const barsWrap = document.createElement('div');
        barsWrap.className = 'status-bars-wrap';

        const statusBars = document.createElement('div');
        statusBars.className = 'status-bars';

        const barsFooter = document.createElement('div');
        barsFooter.className = 'bars-footer';
        barsFooter.innerHTML = '<span class="bars-footer-start"></span><span class="bars-footer-end">Today</span>';

        barsWrap.appendChild(statusBars);
        barsWrap.appendChild(barsFooter);

        element.appendChild(serviceRow);
        element.appendChild(barsWrap);

        return element;
    }

    function renderLoadingSkeleton() {
        statusListEl.innerHTML = '';
        ['nodes', 'services'].forEach((tab, index) => {
            const panel = document.createElement('div');
            panel.className = `tab-panel${index === 0 ? ' active' : ''}`;
            panel.dataset.tabPanel = tab;
            panel.innerHTML = Array.from({ length: 4 }, () => `
                <div class="service-status skeleton-card">
                    <div class="service-info">
                        <div class="skeleton skeleton-icon"></div>
                        <div class="skeleton-lines">
                            <div class="skeleton skeleton-line"></div>
                            <div class="skeleton skeleton-line short"></div>
                        </div>
                    </div>
                    <div class="skeleton skeleton-uptime"></div>
                    <div class="skeleton skeleton-bars"></div>
                </div>
            `).join('');
            statusListEl.appendChild(panel);
        });
    }

    function renderServiceList(categories) {
        statusListEl.innerHTML = '';

        const panels = {};
        ['nodes', 'services'].forEach((tab) => {
            const panel = document.createElement('div');
            panel.className = `tab-panel${tab === activeTab ? ' active' : ''}`;
            panel.dataset.tabPanel = tab;
            panels[tab] = panel;
            statusListEl.appendChild(panel);
        });

        categories.forEach((category) => {
            category.services.forEach((service) => {
                service.category = category.id;
                const tab = getTabForCategory(category.id);
                const element = createServiceElement(service);
                service.element = element;
                globalServiceStates[service.id] = {
                    currentStatus: 'unknown',
                    historicalData: [],
                    overallUptime: null,
                };
                panels[tab].appendChild(element);
            });
        });

        Object.values(panels).forEach((panel) => {
            const cards = Array.from(panel.children);
            cards.sort((a, b) => {
                const nameA = a.querySelector('h3')?.textContent || '';
                const nameB = b.querySelector('h3')?.textContent || '';
                return nameA.localeCompare(nameB);
            });
            cards.forEach((card) => panel.appendChild(card));
        });

        updateTabCounter();
    }

    function updateOverallPageStatus(statusPayload) {
        lastStatusPayload = statusPayload;
        const outageServices = statusPayload.services.filter((service) => service.status === 'outage');
        const degradedServices = statusPayload.services.filter((service) =>
            service.status === 'degraded' || service.status === 'unknown',
        );

        outageServicesList.innerHTML = '';
        outageList.style.display = 'none';

        if (statusPayload.overall === 'outage') {
            overallStatusIcon.className = 'status-icon outage';
            overallStatusH1.textContent = 'Major Outage';
            setOverallIconPath('M18 6L6 18M6 6l12 12');
            outageList.className = 'outage-list';

            outageServices.forEach((service) => {
                const item = document.createElement('li');
                item.textContent = service.name;
                outageServicesList.appendChild(item);
            });
            outageList.style.display = 'block';
            return;
        }

        if (statusPayload.overall === 'degraded') {
            overallStatusIcon.className = 'status-icon degraded';
            overallStatusH1.textContent = 'Degraded Performance';
            setOverallIconPath('M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z');
            outageList.className = 'outage-list degraded-list';

            degradedServices.forEach((service) => {
                const item = document.createElement('li');
                item.textContent = `${service.name} (${formatStatusLabel(service.status)})`;
                outageServicesList.appendChild(item);
            });
            outageList.style.display = degradedServices.length > 0 ? 'block' : 'none';
            return;
        }

        overallStatusIcon.className = 'status-icon operational';
        overallStatusH1.textContent = 'All Systems Operational';
        setOverallIconPath('M20 6L9 17L4 12');
        outageList.className = 'outage-list';
    }

    function setOverallIconPath(pathData) {
        const path = overallStatusIcon.querySelector('svg path');
        if (path) {
            path.setAttribute('d', pathData);
        }
    }

    function getServiceElement(serviceId) {
        return document.querySelector(`.service-status[data-service-id="${serviceId}"]`);
    }

    function updateServiceUI(service) {
        const state = globalServiceStates[service.id];
        const element = service.element || getServiceElement(service.id);
        if (!element || !state) {
            return;
        }

        const status = service.status || state.currentStatus || 'unknown';
        const statusBadge = element.querySelector('.status-badge');
        if (statusBadge) {
            statusBadge.className = `status-badge ${status}`;
            statusBadge.textContent = formatStatusLabel(status);
        }

        const uptimeEl = element.querySelector('.uptime-compact');
        if (uptimeEl) {
            uptimeEl.textContent = formatUptimePercent(state.overallUptime);
        }

        const barsFooterStart = element.querySelector('.bars-footer-start');
        if (barsFooterStart) {
            barsFooterStart.textContent = `${getRangeDayCount(activeRange)} days ago`;
        }

        const barsContainer = element.querySelector('.status-bars');
        if (!state.historicalData || state.historicalData.length === 0) {
            barsContainer.innerHTML = '<div class="bars-loading">Loading history...</div>';
            return;
        }

        generateBars(barsContainer, service.id);
    }

    function generateBars(container, serviceId) {
        const state = globalServiceStates[serviceId];
        const historicalData = state?.historicalData || [];
        container.innerHTML = '';

        historicalData.forEach((dataPoint) => {
            const bar = document.createElement('div');
            bar.classList.add('status-bar');

            if (!dataPoint.hasData) {
                bar.classList.add('no-data');
            } else {
                const ratio = dataPoint.uptimeRatio ?? 0;
                const downtimeMinutes = Math.round((1 - ratio) * 24 * 60);
                if (downtimeMinutes < 5) {
                    bar.classList.add('operational');
                } else if (ratio >= 0.9) {
                    bar.classList.add('degraded');
                } else {
                    bar.classList.add('outage');
                }
            }

            if (dataPoint.incidents?.length) {
                bar.classList.add('has-incident');
                bar.dataset.incidentCount = String(dataPoint.incidents.length);
            }

            bar.addEventListener('mouseover', (event) => showTooltip(event, bar, dataPoint));
            bar.addEventListener('mouseout', hideTooltip);
            container.appendChild(bar);
        });
    }

    function showTooltip(event, barElement, dataPoint) {
        tooltipContent.incidents.innerHTML = '';
        tooltip.classList.remove('tooltip-interactive');

        if (!dataPoint || !dataPoint.hasData) {
            tooltipContent.date.textContent = dataPoint
                ? new Date(dataPoint.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Unknown Date';
            tooltipContent.uptime.textContent = 'No historical data';
            tooltipContent.downtime.style.display = 'none';
        } else {
            const date = new Date(dataPoint.timestamp * 1000);
            tooltipContent.date.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            const ratio = dataPoint.uptimeRatio ?? 0;
            tooltipContent.uptime.textContent = `${(ratio * 100).toFixed(1)}%`;

            const downtimeMinutes = Math.round((1 - ratio) * 24 * 60);
            if (downtimeMinutes < 5) {
                tooltipContent.downtime.style.display = 'none';
            } else {
                tooltipContent.downtime.textContent = `Est. downtime: ${downtimeMinutes} min`;
                tooltipContent.downtime.style.display = 'block';
            }

            if (dataPoint.incidents?.length) {
                tooltip.classList.add('tooltip-interactive');
                dataPoint.incidents.forEach((incident) => {
                    const item = document.createElement('li');
                    const link = document.createElement('a');
                    link.href = incident.url || 'incident-history.html';
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = incident.title || `Incident #${incident.number}`;
                    item.appendChild(link);
                    tooltipContent.incidents.appendChild(item);
                });
            }
        }

        tooltip.style.display = 'block';
        const barRect = barElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        let top = barRect.top - tooltipRect.height - 10;
        let left = barRect.left + (barRect.width / 2) - (tooltipRect.width / 2);

        if (left < 0) left = 5;
        if (left + tooltipRect.width > window.innerWidth) {
            left = window.innerWidth - tooltipRect.width - 5;
        }

        if (top < 0) {
            top = barRect.bottom + 10;
            tooltipArrow.style.bottom = '100%';
            tooltipArrow.style.top = 'auto';
            tooltipArrow.style.borderWidth = '0 5px 5px 5px';
            tooltipArrow.style.borderColor = 'transparent transparent #212529 transparent';
        } else {
            tooltipArrow.style.top = '100%';
            tooltipArrow.style.bottom = 'auto';
            tooltipArrow.style.borderWidth = '5px 5px 0 5px';
            tooltipArrow.style.borderColor = '#212529 transparent transparent transparent';
        }

        tooltipArrow.style.left = '50%';
        tooltipArrow.style.transform = 'translateX(-50%)';
        tooltip.style.left = `${left + window.scrollX}px`;
        tooltip.style.top = `${top + window.scrollY}px`;
    }

    function hideTooltip() {
        tooltip.style.display = 'none';
    }

    function flattenCategories(categories) {
        return categories.flatMap((category) =>
            category.services.map((service) => ({ ...service, category: category.id })),
        );
    }

    async function loadHistory(range) {
        const historyData = await fetchFromProxy(`/api/v2/history?range=${range}`);
        if (!historyData?.histories) {
            console.error('[History] No history data returned from API');
            return;
        }

        flattenCategories(categoriesConfig).forEach((service) => {
            const history = historyData.histories[service.id];
            if (!history) {
                return;
            }

            if (!globalServiceStates[service.id]) {
                globalServiceStates[service.id] = {
                    currentStatus: 'unknown',
                    historicalData: [],
                    overallUptime: null,
                };
            }

            globalServiceStates[service.id].historicalData = enrichHistoryWithIncidents(
                history.historicalData || [],
                service.id,
            );
            globalServiceStates[service.id].overallUptime = history.overallUptime;
            updateServiceUI(service);
        });
    }

    async function loadV2Data(range, { statusOnly = false } = {}) {
        if (categoriesConfig.length === 0) {
            renderLoadingSkeleton();
        }

        const [configData, statusData] = await Promise.all([
            fetchFromProxy('/api/v2/config'),
            fetchFromProxy('/api/v2/status'),
        ]);

        if (!configData || !statusData) {
            showFatalError('Unable to load status data from API v2.');
            return;
        }

        if (categoriesConfig.length === 0) {
            categoriesConfig = configData.categories;
            renderServiceList(categoriesConfig);
        }

        if (nodeCounter) {
            updateTabCounter();
        }

        if (lastUpdatedEl && statusData.lastChecked) {
            const updated = new Date(statusData.lastChecked);
            lastUpdatedEl.textContent = `Last updated: ${updated.toLocaleTimeString()}`;
        }

        const servicesById = Object.fromEntries(statusData.services.map((service) => [service.id, service]));

        flattenCategories(categoriesConfig).forEach((service) => {
            const live = servicesById[service.id];
            if (!live) {
                return;
            }

            service.status = live.status;
            globalServiceStates[service.id].currentStatus = live.status;
            updateServiceUI(service);
        });

        updateOverallPageStatus(statusData);

        if (!statusOnly) {
            await Promise.all([
                loadHistory(range),
                loadIncidents(),
            ]);
            // Re-render bars with incident overlays after incidents load
            flattenCategories(categoriesConfig).forEach((service) => {
                const state = globalServiceStates[service.id];
                if (state?.historicalData?.length) {
                    state.historicalData = enrichHistoryWithIncidents(state.historicalData, service.id);
                    updateServiceUI(service);
                }
            });
        }
    }

    async function refreshData({ historyOnly = false } = {}) {
        try {
            if (useV2) {
                if (historyOnly && categoriesConfig.length > 0) {
                    await Promise.all([loadIncidents(), loadHistory(activeRange)]);
                    flattenCategories(categoriesConfig).forEach((service) => {
                        const state = globalServiceStates[service.id];
                        if (state?.historicalData?.length) {
                            state.historicalData = enrichHistoryWithIncidents(state.historicalData, service.id);
                            updateServiceUI(service);
                        }
                    });
                    return;
                }
                await loadV2Data(activeRange);
                return;
            }

            showFatalError('Legacy v1 API is no longer supported by this frontend. Enable USE_API_V2 in config.js.');
        } catch (error) {
            console.error('[Status Page] Failed to refresh data:', error);
        }
    }

    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab);
        });
    });

    document.querySelectorAll('.time-button').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.time-button').forEach((btn) => btn.classList.remove('active'));
            button.classList.add('active');
            activeRange = button.dataset.range;
            refreshData({ historyOnly: true });
        });
    });

    initTheme();
    initRssLink();
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    refreshData();

    if (pollInterval > 0) {
        pollTimer = setInterval(refreshData, pollInterval * 1000);
        window.addEventListener('beforeunload', () => clearInterval(pollTimer));
    }
});
