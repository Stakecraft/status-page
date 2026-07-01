const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function resolveConfigPath(configPath) {
    if (configPath) {
        return path.resolve(configPath);
    }

    const candidates = [
        path.join(__dirname, '../../config/services.yaml'),
        path.join(__dirname, '../../config/services.yaml.example'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0];
}

function mergeDefaults(service, defaults) {
    return {
        category: defaults.category,
        network: defaults.network,
        public: defaults.public,
        ...service,
        health: {
            type: defaults.health?.type || 'up',
            ...service.health,
        },
    };
}

function loadServicesConfig(configPath) {
    const resolvedPath = resolveConfigPath(configPath);
    const result = {
        path: resolvedPath,
        version: null,
        categories: {},
        services: [],
        servicesById: {},
    };

    if (!fs.existsSync(resolvedPath)) {
        console.warn(`[Services Config] File not found: ${resolvedPath}`);
        return result;
    }

    try {
        const parsed = yaml.load(fs.readFileSync(resolvedPath, 'utf8'));
        const defaults = parsed.defaults || {};
        result.version = parsed.version || 1;
        result.categories = parsed.categories || {};

        if (!Array.isArray(parsed.services)) {
            console.error('[Services Config] Expected `services` array in config file.');
            return result;
        }

        result.services = parsed.services
            .map((service) => mergeDefaults(service, defaults))
            .filter((service) => {
                if (!service.id || !service.name) {
                    console.warn('[Services Config] Skipping service missing id or name:', service);
                    return false;
                }
                return service.public !== false;
            });

        result.services.forEach((service) => {
            result.servicesById[service.id] = service;
        });
    } catch (error) {
        console.error('[Services Config] Failed to load config:', error);
    }

    return result;
}

function getCategoryOrder(categories, categoryId) {
    return categories[categoryId]?.order ?? 99;
}

function getCategoryLabel(categories, categoryId) {
    return categories[categoryId]?.label || categoryId;
}

function groupServicesByCategory(servicesConfig) {
    const grouped = new Map();

    servicesConfig.services.forEach((service) => {
        const categoryId = service.category || 'other';
        if (!grouped.has(categoryId)) {
            grouped.set(categoryId, []);
        }
        grouped.get(categoryId).push(service);
    });

    return Array.from(grouped.entries())
        .sort(([a], [b]) => getCategoryOrder(servicesConfig.categories, a) - getCategoryOrder(servicesConfig.categories, b))
        .map(([categoryId, services]) => ({
            id: categoryId,
            label: getCategoryLabel(servicesConfig.categories, categoryId),
            services: services.sort((a, b) => a.name.localeCompare(b.name)),
        }));
}

function toPublicService(service) {
    return {
        id: service.id,
        name: service.name,
        category: service.category,
        icon: service.icon || null,
    };
}

function groupPublicServicesByCategory(servicesConfig) {
    return groupServicesByCategory(servicesConfig).map((category) => ({
        id: category.id,
        label: category.label,
        services: category.services.map(toPublicService),
    }));
}

module.exports = {
    loadServicesConfig,
    groupServicesByCategory,
    groupPublicServicesByCategory,
    toPublicService,
    getCategoryLabel,
};
