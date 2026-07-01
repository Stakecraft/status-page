#!/usr/bin/env node
/**
 * Migrate backend/proxy-services-config.yaml (v1) to config/services.yaml (v2).
 *
 * Usage: node scripts/sync-services-config.js [--output config/services.yaml]
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const LEGACY_PATH = path.join(ROOT, 'backend/proxy-services-config.yaml');
const OUTPUT_PATH = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : path.join(ROOT, 'config/services.yaml');

const ID_MAP = {
    stakecraftCom: 'stakecraft-com',
    solanaNodeStakecraft: 'solana',
    walrusNodeStakecraft: 'walrus',
    kavaNodeStakecraft: 'kava',
    koiiNodeStakecraft: 'koii',
    supraNodeStakecraft: 'supra',
    bandNodeStakecraft: 'band',
    moonriverNodeStakecraft: 'moonriver',
    qprotocolNodeStakecraft: 'qprotocol',
    thegraphNodeStakecraft: 'thegraph',
    polygonNodeStakecraft: 'polygon',
    altairNodeStakecraft: 'altair',
    centrifugeNodeStakecraft: 'centrifuge',
    kiNodeStakecraft: 'ki',
    agoricNodeStakecraft: 'agoric',
    zetachainNodeStakecraft: 'zetachain',
    covalentNodeStakecraft: 'covalent',
    stafiNodeStakecraft: 'stafi',
    subqueryNodeStakecraft: 'subquery',
    stargazeNodeStakecraft: 'stargaze',
    bitsongNodeStakecraft: 'bitsong',
    bitscrunchNodeStakecraft: 'bitscrunch',
    redbellyNodeStakecraft: 'redbelly',
    nearNodeStakecraft: 'near',
    spacetimeNodeStakecraft: 'spacetime',
};

const CATEGORY_MAP = {
    stakecraftCom: 'website',
    thegraphNodeStakecraft: 'indexer',
    subqueryNodeStakecraft: 'indexer',
    supraNodeStakecraft: 'oracle',
    bandNodeStakecraft: 'oracle',
    moonriverNodeStakecraft: 'collator',
    altairNodeStakecraft: 'collator',
    centrifugeNodeStakecraft: 'collator',
};

function legacyLabelsToQuery(metricName, jobLabel) {
    const selector = jobLabel.trim();
    return `${metricName}{${selector}}`;
}

function main() {
    if (!fs.existsSync(LEGACY_PATH)) {
        console.error(`Legacy config not found: ${LEGACY_PATH}`);
        process.exit(1);
    }

    const legacy = yaml.load(fs.readFileSync(LEGACY_PATH, 'utf8'));
    const services = (legacy.services || []).map((entry) => {
        const id = ID_MAP[entry.serviceId] || entry.serviceId.replace(/NodeStakecraft$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
        const condition = entry.healthCondition || (entry.healthyValue ? `== ${entry.healthyValue}` : '> 0');

        return {
            id,
            name: entry.displayName,
            category: CATEGORY_MAP[entry.serviceId] || 'node',
            health: {
                type: 'threshold',
                query: legacyLabelsToQuery(entry.metricName, entry.jobLabel),
                condition,
            },
        };
    });

    const output = {
        version: 2,
        defaults: {
            category: 'node',
            network: 'mainnet',
            public: true,
            health: {
                type: 'threshold',
                condition: '> 0',
            },
        },
        categories: {
            website: { label: 'Websites', order: 1 },
            node: { label: 'Nodes', order: 2 },
            indexer: { label: 'Indexers', order: 3 },
            oracle: { label: 'Oracles', order: 4 },
            collator: { label: 'Collators', order: 5 },
        },
        services,
    };

    fs.writeFileSync(OUTPUT_PATH, yaml.dump(output, { lineWidth: 120, noRefs: true }));
    console.log(`Wrote ${services.length} services to ${OUTPUT_PATH}`);
}

main();
