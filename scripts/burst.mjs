// Zátěžový test proti staging Workeru: N souběžných "diváků" po dobu T sekund.
// Použití: node scripts/burst.mjs <baseUrl> [concurrency=200] [seconds=45]
// Vypíše rozložení statusů, x-cache, p50/p95 latence a počet RŮZNÝCH refreshedAt
// na endpoint (= kolik skutečných refreshů z ČSÚ proběhlo).
// Nikdy nemiřte na produkci bez dohody; ČSÚ se netýká (tahá jen náš Worker).
const [base, c = '200', s = '45'] = process.argv.slice(2);
if (!base) {
    console.error('usage: node scripts/burst.mjs <baseUrl> [concurrency] [seconds]');
    process.exit(2);
}
const concurrency = Number(c);
const until = Date.now() + Number(s) * 1000;
const paths = ['/api/prehled', '/api/volby?z=500216', '/api/volby?z=554782'];
const lat = [];
const status = new Map();
const cache = new Map();
const refreshed = new Map(paths.map((p) => [p, new Set()]));
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

async function viewer(i) {
    while (Date.now() < until) {
        const path = paths[(i + lat.length) % paths.length];
        const t0 = performance.now();
        try {
            const res = await fetch(base + path, { signal: AbortSignal.timeout(25000) });
            const body = await res.text();
            lat.push(performance.now() - t0);
            bump(status, res.status);
            bump(cache, res.headers.get('x-cache') || '-');
            if (res.status === 200) {
                const m = body.match(/"refreshedAt":(\d+)/);
                if (m) refreshed.get(path).add(m[1]);
            }
        } catch {
            bump(status, 'ERR');
        }
        // jemný rozptyl, ať to nejsou jen dávky
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
    }
}

await Promise.all(Array.from({ length: concurrency }, (_, i) => viewer(i)));
lat.sort((a, b) => a - b);
const q = (p) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]) : null);
console.log(JSON.stringify({
    requests: lat.length,
    status: Object.fromEntries(status),
    xcache: Object.fromEntries(cache),
    p50ms: q(0.5),
    p95ms: q(0.95),
    distinctRefreshes: Object.fromEntries([...refreshed].map(([p, v]) => [p, v.size])),
}, null, 2));
