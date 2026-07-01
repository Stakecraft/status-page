const SWEEP_EVERY_N_REQUESTS = 1000;

function createRateLimiter({ windowMs, max }) {
    const hits = new Map();
    let requestsSinceSweep = 0;

    function sweepExpired(now) {
        for (const [key, bucket] of hits) {
            if (now >= bucket.resetAt) {
                hits.delete(key);
            }
        }
    }

    return (req, res, next) => {
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const now = Date.now();

        requestsSinceSweep += 1;
        if (requestsSinceSweep >= SWEEP_EVERY_N_REQUESTS) {
            requestsSinceSweep = 0;
            sweepExpired(now);
        }

        let bucket = hits.get(key);
        if (!bucket || now >= bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            hits.set(key, bucket);
        }

        bucket.count += 1;

        if (bucket.count > max) {
            const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
            res.set('Retry-After', String(retryAfterSec));
            return res.status(429).json({ error: 'Too many requests' });
        }

        return next();
    };
}

// Caches the in-flight promise so concurrent misses share one loader call.
// Entries are evicted when the loader rejects, or when shouldCache(value)
// returns false (e.g. Prometheus was unreachable and the payload is empty).
function createResponseCache({ ttlMs, shouldCache }) {
    const entries = new Map();

    return function getCached(key, loader) {
        const now = Date.now();
        const cached = entries.get(key);

        if (cached && cached.expiresAt > now) {
            return cached.value;
        }

        const value = Promise.resolve().then(loader);
        entries.set(key, { value, expiresAt: now + ttlMs });

        value.then(
            (resolved) => {
                if (shouldCache && !shouldCache(resolved) && entries.get(key)?.value === value) {
                    entries.delete(key);
                }
            },
            () => {
                if (entries.get(key)?.value === value) {
                    entries.delete(key);
                }
            },
        );

        return value;
    };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    if (items.length === 0) {
        return [];
    }

    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index], index);
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => worker(),
    );
    await Promise.all(workers);
    return results;
}

module.exports = {
    createRateLimiter,
    createResponseCache,
    mapWithConcurrency,
};
