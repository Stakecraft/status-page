function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }

    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

module.exports = {
    envInt,
};
