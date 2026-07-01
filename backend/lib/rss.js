function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function formatRssDate(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
        return new Date().toUTCString();
    }
    return date.toUTCString();
}

function buildRssFeed({
    siteUrl,
    feedUrl,
    title,
    description,
    overallStatus,
    services = [],
    incidents = [],
}) {
    const items = [];

    items.push({
        title: `Overall status: ${overallStatus}`,
        link: siteUrl,
        pubDate: new Date(),
        description: `Stakecraft status page reports ${overallStatus}. ${services.length} services monitored.`,
        guid: `status-summary-${new Date().toISOString().slice(0, 13)}`,
    });

    services
        .filter((service) => service.status === 'outage' || service.status === 'degraded')
        .forEach((service) => {
            items.push({
                title: `${service.name}: ${service.status}`,
                link: siteUrl,
                pubDate: new Date(),
                description: `${service.name} is currently ${service.status}.`,
                guid: `service-${service.id}-${service.status}`,
            });
        });

    incidents.slice(0, 20).forEach((incident) => {
        items.push({
            title: incident.title,
            link: incident.url,
            pubDate: incident.createdAt,
            description: incident.statusText
                ? `${incident.statusText}${incident.severity ? ` · ${incident.severity}` : ''}`
                : 'Incident update',
            guid: `incident-${incident.number}`,
        });
    });

    const itemXml = items.map((item) => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${formatRssDate(item.pubDate)}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${formatRssDate(new Date())}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" xmlns="http://www.w3.org/2005/Atom"/>
    ${itemXml}
  </channel>
</rss>`;
}

module.exports = {
    buildRssFeed,
};
