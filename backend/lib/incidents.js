async function fetchGitHubIncidents({
    token,
    owner,
    repo,
    label = 'incident',
    perPage = 100,
}) {
    if (!token || !owner || !repo) {
        return [];
    }

    const params = new URLSearchParams({
        labels: label,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: String(perPage),
    });

    const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues?${params.toString()}`,
        {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        },
    );

    if (!response.ok) {
        throw new Error(`GitHub API request failed: ${response.status}`);
    }

    const issues = await response.json();

    return issues.map((issue) => {
        let severity = null;
        const severityLabel = issue.labels.find(
            (entry) => entry.name.startsWith('severity:') || entry.name.startsWith('sev:'),
        );
        if (severityLabel) {
            severity = severityLabel.name.split(':')[1];
        }

        const affectedServices = issue.labels
            .filter((entry) => entry.name.startsWith('service:'))
            .map((entry) => entry.name.split(':')[1]);

        return {
            id: issue.id,
            title: issue.title,
            url: issue.html_url,
            number: issue.number,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            closedAt: issue.closed_at,
            state: issue.state,
            labels: issue.labels.map((entry) => entry.name),
            body: issue.body,
            statusText: issue.state === 'closed'
                ? 'Resolved'
                : (issue.labels.find((entry) => entry.name.startsWith('status:'))?.name.split(':')[1] || 'Open'),
            severity,
            affectedServices,
        };
    });
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

function incidentsForServiceDay(incidents, serviceId, dayTimestampSec) {
    return (incidents || [])
        .filter(
            (incident) => incidentAffectsService(incident, serviceId)
                && incidentOverlapsDay(incident, dayTimestampSec),
        )
        .map((incident) => ({
            title: incident.title,
            url: incident.url,
            number: incident.number,
            statusText: incident.statusText,
        }));
}

module.exports = {
    fetchGitHubIncidents,
    incidentAffectsService,
    incidentOverlapsDay,
    incidentsForServiceDay,
};
