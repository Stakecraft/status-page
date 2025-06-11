document.addEventListener('DOMContentLoaded', function() {
    // const PROMETHEUS_URL = 'http://localhost:3000'; // Defined in config.js
    // const SERVICES_CONFIG = [ ... ]; // Defined in config.js

    // Ensure SERVICES_CONFIG is available from config.js
    if (typeof SERVICES_CONFIG === 'undefined' || typeof API_BASE_URL === 'undefined') {
        console.error("CRITICAL: config.js is not loaded or API_BASE_URL/SERVICES_CONFIG are not defined.");
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.innerHTML = '<h1 style="color: red; text-align: center;">Configuration Error: Please check console.</h1>';
        }
        return; // Stop execution if config is missing
    }

    const serviceStatuses = document.querySelectorAll('.service-status');
    const tooltip = document.getElementById('status-tooltip');
    const tooltipContent = {
        date: tooltip.querySelector('.tooltip-date'),
        uptime: tooltip.querySelector('.tooltip-uptime strong'),
        downtime: tooltip.querySelector('.tooltip-downtime'),
    };
    const tooltipArrow = tooltip.querySelector('.tooltip-arrow');
    const overallStatusIcon = document.querySelector('.overall-status .status-icon');
    const overallStatusH1 = document.querySelector('.overall-status h1');

    let globalServiceStates = {};

    SERVICES_CONFIG.forEach(config => {
        config.element = Array.from(serviceStatuses).find(el => el.querySelector('h3').textContent.startsWith(config.name));
        if (!config.element) {
            console.warn(`HTML element for service '${config.name}' (ID: ${config.serviceId}) not found. Check H3 text. Service will be skipped.`);
        }
        globalServiceStates[config.serviceId] = { currentStatus: 'unknown', historicalData: [], overallUptime: 'N/A' };
    });

    async function fetchFromProxy(endpointPath) {
        const url = `${API_BASE_URL}${endpointPath}`;
        // console.log(`[fetchFromProxy] Attempting to fetch URL: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Proxy request failed: ${response.status} for URL: ${url}`);
                throw new Error(`Proxy request failed: ${response.status}`);
            }
            const data = await response.json();
            // Assuming proxy always returns success:true if HTTP 200, or handles errors by non-200 codes
            return data;
        } catch (error) {
            console.error('Error fetching from proxy:', error, `URL: ${url}`);
            return null;
        }
    }

    async function updateServiceData(serviceConfig) {
        if (!serviceConfig || !serviceConfig.element) return;

        const statusData = await fetchFromProxy(`/api/status/${serviceConfig.serviceId}`);
        // console.log(`[${serviceConfig.name}] Raw current status data from proxy:`, JSON.stringify(statusData));

        if (statusData && statusData.status) {
            globalServiceStates[serviceConfig.serviceId].currentStatus = statusData.status;
        } else {
            globalServiceStates[serviceConfig.serviceId].currentStatus = 'unknown';
            // console.log(`[${serviceConfig.name}] No current status data returned or malformed result from proxy for ID: ${serviceConfig.serviceId}`);
        }
        // console.log(`[${serviceConfig.name}] Determined current status: ${globalServiceStates[serviceConfig.serviceId].currentStatus}`);

        const activeTimeButton = document.querySelector('.time-button.active');
        const range = activeTimeButton ? activeTimeButton.dataset.range : '30d';
        await fetchHistoricalDataForService(serviceConfig, range);
        updateServiceUI(serviceConfig);
    }

    async function fetchHistoricalDataForService(serviceConfig, timeRange) {
        const historyData = await fetchFromProxy(`/api/history/${serviceConfig.serviceId}?range=${timeRange}`);
        // console.log(`[${serviceConfig.name}] Raw historical data from proxy:`, JSON.stringify(historyData));

        let processedData = [];
        let totalUptimeSum = 0;
        let actualDataPointsCount = 0;
        let numExpectedPoints;

        switch (timeRange) {
            case '7d': numExpectedPoints = 7; break;
            case '15d': numExpectedPoints = 15; break;
            case '30d': default: numExpectedPoints = 30; break;
        }

        if (historyData && historyData.historicalData && Array.isArray(historyData.historicalData)) {
            // Proxy already sorts and prepares data points with timestamp, uptimeRatio, hasData
            processedData = historyData.historicalData;
            actualDataPointsCount = processedData.filter(p => p.hasData).length;
            processedData.filter(p => p.hasData).forEach(point => totalUptimeSum += point.uptimeRatio);
        } else {
            // console.log(`[${serviceConfig.name}] No historical data array from proxy or malformed for ID: ${serviceConfig.serviceId}`);
        }
        
        // The proxy should ideally return data aligned to days already.
        // If not, the filling logic below might still be needed, but let's assume proxy handles alignment for now.
        // For simplicity, we'll trust the proxy to return the correct number of points or handle gaps.
        // If proxy returns fewer points than numExpectedPoints, UI will show fewer bars or we need to re-add filling logic.
        
        // For now, directly use what proxy gives, assuming it's aligned for the last numExpectedPoints days
        const filledData = [];
        const now = new Date();
        let startDate = new Date();
        switch (timeRange) {
            case '7d': startDate.setDate(now.getDate() - (7-1)); break;
            case '15d': startDate.setDate(now.getDate() - (15-1)); break;
            case '30d': default: startDate.setDate(now.getDate() - (30-1)); break;
        }
        startDate.setUTCHours(0,0,0,0);

        let promDataIndex = 0;
        for (let i = 0; i < numExpectedPoints; i++) {
            const barDate = new Date(startDate.valueOf());
            barDate.setUTCDate(startDate.getUTCDate() + i);
            // barDate.setUTCHours(0,0,0,0); // Already done for startDate, and UTCDate increments day correctly
            const barTimestampSec = Math.floor(barDate.getTime() / 1000);
            let pointToUse = null;

            if (promDataIndex < processedData.length) {
                const promDataPoint = processedData[promDataIndex];
                const promPointDate = new Date(promDataPoint.timestamp * 1000);
                promPointDate.setUTCHours(0, 0, 0, 0);

                if (promPointDate.getTime() === barDate.getTime()) {
                    pointToUse = promDataPoint;
                    promDataIndex++;
                } else if (promPointDate.getTime() < barDate.getTime()) {
                    promDataIndex++; i--; continue;
                }
            }
            if (pointToUse) {
                filledData.push(pointToUse);
            } else {
                filledData.push({ timestamp: barTimestampSec, uptimeRatio: 0, hasData: false, simulated: true });
            }
        }

        globalServiceStates[serviceConfig.serviceId].historicalData = filledData.slice(-numExpectedPoints);

        if (actualDataPointsCount > 0) {
            let overallUptimePercentage;
            const avgValue = totalUptimeSum / actualDataPointsCount;
            
            // Handle different metric types intelligently
            if (avgValue <= 1.0) {
                // Metric is a ratio (0-1), convert to percentage
                overallUptimePercentage = avgValue * 100;
            } else if (avgValue <= 100) {
                // Metric is already a percentage (0-100)
                overallUptimePercentage = avgValue;
            } else {
                // Metric is a large number (block height, timestamp, etc.)
                // For health metrics > 100, we assume if it's > 0 then it's "up"
                // Calculate uptime as percentage of non-zero values
                const uptimePointsCount = processedData.filter(p => p.hasData && p.uptimeRatio > 0).length;
                overallUptimePercentage = (uptimePointsCount / actualDataPointsCount) * 100;
            }
            
            globalServiceStates[serviceConfig.serviceId].overallUptime = `${overallUptimePercentage.toFixed(3)}%`;
        } else {
            globalServiceStates[serviceConfig.serviceId].overallUptime = 'N/A';
        }
    }

    function updateServiceUI(serviceConfig) {
        const { serviceId, element, name } = serviceConfig;
        if (!element) return;
        const state = globalServiceStates[serviceId];
        
        // Update status indicator inside the status text
        const statusIndicator = element.querySelector('.status-indicator');
        const statusText = element.querySelector('.status-text');
        if (statusIndicator && statusText) {
            statusIndicator.className = `status-indicator ${state.currentStatus}`;
            const statusDisplayText = state.currentStatus.charAt(0).toUpperCase() + state.currentStatus.slice(1);
            statusText.innerHTML = `<span class="status-indicator ${state.currentStatus}"></span>${statusDisplayText}`;
        }
        
        element.querySelector('.uptime-percentage').innerHTML = `${state.overallUptime} <span class="uptime-label">Uptime</span>`;
        generateBars(element.querySelector('.status-bars'), serviceId);
        updateOverallPageStatus();
    }

    function updateOverallPageStatus() {
        const outageServices = SERVICES_CONFIG.filter(cfg => globalServiceStates[cfg.serviceId].currentStatus === 'outage');
        const isAnyOutage = outageServices.length > 0;
        
        const outageList = document.getElementById('outage-list');
        const outageServicesList = document.getElementById('outage-services');
        
        if (isAnyOutage) {
            overallStatusIcon.className = 'status-icon outage';
            overallStatusH1.textContent = 'Major Outage';
            if (overallStatusIcon.querySelector('svg path')) overallStatusIcon.querySelector('svg path').setAttribute('d', 'M18 6L6 18M6 6l12 12');
            
            // Show outage list and populate with affected services
            outageServicesList.innerHTML = '';
            outageServices.forEach(service => {
                const listItem = document.createElement('li');
                listItem.textContent = service.name;
                outageServicesList.appendChild(listItem);
            });
            outageList.style.display = 'block';
        } else {
            overallStatusIcon.className = 'status-icon operational';
            overallStatusH1.textContent = 'All Systems Operational';
            if (overallStatusIcon.querySelector('svg path')) overallStatusIcon.querySelector('svg path').setAttribute('d', 'M20 6L9 17L4 12');
            
            // Hide outage list when no outages
            outageList.style.display = 'none';
        }
    }

    function generateBars(container, serviceId) {
        const state = globalServiceStates[serviceId];
        const historicalData = state.historicalData || [];
        const numBars = historicalData.length;
        container.innerHTML = '';
        for (let i = 0; i < numBars; i++) {
            const bar = document.createElement('div');
            bar.classList.add('status-bar');
            const dataPoint = historicalData[i];
            if (dataPoint) {
                if (!dataPoint.hasData) {
                    bar.classList.add('no-data');
                } else {
                    // Handle different metric scales
                    let normalizedRatio;
                    if (dataPoint.uptimeRatio <= 1.0) {
                        // Already a ratio (0-1)
                        normalizedRatio = dataPoint.uptimeRatio;
                    } else if (dataPoint.uptimeRatio <= 100) {
                        // Already a percentage (0-100), convert to ratio
                        normalizedRatio = dataPoint.uptimeRatio / 100;
                    } else {
                        // Large number - if > 0 then operational
                        normalizedRatio = dataPoint.uptimeRatio > 0 ? 1.0 : 0.0;
                    }
                    
                    const downtimeMinutesForColor = Math.round((1 - normalizedRatio) * 24 * 60);
                    if (downtimeMinutesForColor < 5) {
                        bar.classList.add('operational');
                    } else if (normalizedRatio >= 0.9) {
                        bar.classList.add('degraded');
                    } else {
                        bar.classList.add('outage');
                    }
                }
            } else {
                bar.classList.add('no-data');
            }
            bar.addEventListener('mouseover', (event) => showTooltip(event, bar, dataPoint));
            bar.addEventListener('mouseout', hideTooltip);
            container.appendChild(bar);
        }
    }

    function showTooltip(event, barElement, dataPoint) {
        if (!dataPoint || !dataPoint.hasData) {
            tooltipContent.date.textContent = dataPoint ? new Date(dataPoint.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown Date';
            tooltipContent.uptime.textContent = 'No historical data';
            tooltipContent.downtime.style.display = 'none';
        } else {
            const date = new Date(dataPoint.timestamp * 1000);
            tooltipContent.date.textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            
            // Handle different metric scales for tooltip display
            let uptimePercentage;
            let normalizedRatio;
            
            if (dataPoint.uptimeRatio <= 1.0) {
                // Already a ratio (0-1)
                normalizedRatio = dataPoint.uptimeRatio;
                uptimePercentage = dataPoint.uptimeRatio * 100;
            } else if (dataPoint.uptimeRatio <= 100) {
                // Already a percentage (0-100)
                uptimePercentage = dataPoint.uptimeRatio;
                normalizedRatio = dataPoint.uptimeRatio / 100;
            } else {
                // Large number - if > 0 then operational (100%), else 0%
                normalizedRatio = dataPoint.uptimeRatio > 0 ? 1.0 : 0.0;
                uptimePercentage = normalizedRatio * 100;
            }
            
            tooltipContent.uptime.textContent = `${uptimePercentage.toFixed(1)}%`;
            const downtimeMinutes = Math.round((1 - normalizedRatio) * 24 * 60);
            if (downtimeMinutes < 5) {
                tooltipContent.downtime.style.display = 'none';
            } else {
                tooltipContent.downtime.textContent = `Est. downtime: ${downtimeMinutes} min`;
                tooltipContent.downtime.style.display = 'block';
            }
        }
        tooltip.style.display = 'block';
        const barRect = barElement.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        let top = barRect.top - tooltipRect.height - 10;
        let left = barRect.left + (barRect.width / 2) - (tooltipRect.width / 2);
        if (left < 0) left = 5;
        if (left + tooltipRect.width > window.innerWidth) left = window.innerWidth - tooltipRect.width - 5;
        if (top < 0) {
            top = barRect.bottom + 10;
            tooltipArrow.style.bottom = '100%'; tooltipArrow.style.top = 'auto';
            tooltipArrow.style.borderWidth = '0 5px 5px 5px'; tooltipArrow.style.borderColor = 'transparent transparent #212529 transparent';
        } else {
            tooltipArrow.style.top = '100%'; tooltipArrow.style.bottom = 'auto';
            tooltipArrow.style.borderWidth = '5px 5px 0 5px'; tooltipArrow.style.borderColor = '#212529 transparent transparent transparent';
        }
        tooltipArrow.style.left = '50%'; tooltipArrow.style.transform = 'translateX(-50%)';
        tooltip.style.left = `${left + window.scrollX}px`;
        tooltip.style.top = `${top + window.scrollY}px`;
    }

    function hideTooltip() {
        tooltip.style.display = 'none';
    }

    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            const range = button.dataset.range;
            document.querySelectorAll('.time-button').forEach(tb => {
                tb.classList.remove('active');
                if (tb.dataset.range === range) tb.classList.add('active'); // Keep time range selection
            });
            SERVICES_CONFIG.forEach(updateServiceData);
        });
    });

    document.querySelectorAll('.time-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.time-button').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            SERVICES_CONFIG.forEach(updateServiceData); // Refetch data for the new range
        });
    });

    // Update the node counter in the Live Status heading
    function updateNodeCounter() {
        const nodeCounter = document.getElementById('node-counter');
        if (nodeCounter) {
            nodeCounter.textContent = `(${SERVICES_CONFIG.length})`;
        }
    }

    // Initial data fetch for all services
    async function initializeStatusPage() {
        updateNodeCounter(); // Update the counter first
        for (const serviceConfig of SERVICES_CONFIG) {
            if (serviceConfig.element) { // Only process if element was found
                await updateServiceData(serviceConfig);
            }
        }
        updateOverallPageStatus(); // Update overall status after all services are fetched
    }

    initializeStatusPage();
}); 