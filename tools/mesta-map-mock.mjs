#!/usr/bin/env node
// Lokální náhled stránky města s mapou okrsků BEZ sítě a bez Workeru: servíruje .cache/dist-mesta
// (po `bash scripts/mesta.sh build`) a na /api/volby?z=<kód> vrací snapshot ze SKUTEČNÉHO feedu
// (createMestaWiring.buildFeed) nad falešným ČSÚ z tools/lib/fakeCsu.mjs.
//   node tools/mesta-map-mock.mjs [--port=4173] [--counted=0.3] [--pending=0.1] [--seed=1] [--geo=empty|missing]
//   --geo=empty    okrsky.geojson bez polygonů (stránka musí zůstat bez mapy, bez chyby v konzoli)
//   --geo=missing  okrsky.geojson vrací 404
// Neděláme nic jiného než čtení souborů a poslech na 127.0.0.1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCouncils } from '../src/mesta/buildCouncils.js';
import { createMestaWiring } from '../cloudflare/mestaWiring.js';
import { buildFakeCsu, fakeFetch } from './lib/fakeCsu.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const PORT = Number(arg('port', 4173));
const OPTS = { counted: Number(arg('counted', 0.3)), pending: Number(arg('pending', 0.1)), seed: Number(arg('seed', 1)) };
const GEO = arg('geo', '');
const DIST = path.join(ROOT, '.cache/dist-mesta');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain' };

const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));
const councils = buildCouncils(await readJson('src/mesta/towns.generated.json'), await readJson('src/mesta/specifics.generated.json'), (await import('../src/mesta/overrides.js')).default);
const wiring = createMestaWiring({ councils, shards: [] });
const feeds = new Map();

async function snapshotFor(zastup) {
    const council = councils.find((c) => String(c.zastup) === zastup);
    if (!council) return null;
    if (!feeds.has(zastup)) {
        const { files, stats } = buildFakeCsu({
            council,
            lists: await readJson(`public-mesta/data/${council.slug}/lists.json`),
            geo: await readJson(`public-mesta/data/${council.slug}/okrsky.geojson`),
        }, OPTS);
        console.log(`mock ${council.slug}:`, JSON.stringify(stats));
        feeds.set(zastup, wiring.buildFeed(zastup, {}, { fetchImpl: fakeFetch(files) }));
    }
    const snap = await feeds.get(zastup).build();
    const now = Date.now();
    return { refreshedAt: now, nextRefreshAt: now + 60_000, servedAt: now, stale: false, complete: true, refreshing: false, firstSeenAt: now, ...snap };
}

createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'x-server-now': String(Date.now()) }); res.end(body); };
    try {
        if (url.pathname === '/api/volby') {
            const snap = await snapshotFor(url.searchParams.get('z') || '');
            return snap ? send(200, TYPES['.json'], JSON.stringify(snap)) : send(400, TYPES['.json'], '{"error":"unknown-council"}');
        }
        if (url.pathname.endsWith('/okrsky.geojson') && GEO === 'missing') return send(404, 'text/plain', 'missing');
        if (url.pathname.endsWith('/okrsky.geojson') && GEO === 'empty') return send(200, TYPES['.json'], '{"type":"FeatureCollection","features":[]}');
        if (url.pathname.startsWith('/api/')) return send(404, TYPES['.json'], '{"error":"not-found"}');
        let file = path.join(DIST, decodeURIComponent(url.pathname));
        if (!file.startsWith(DIST)) return send(403, 'text/plain', 'no');
        try {
            const body = await readFile(file);
            return send(200, TYPES[path.extname(file)] || 'application/octet-stream', body);
        } catch {
            file = path.join(DIST, 'index.html'); // SPA: /<slug>
            return send(200, TYPES['.html'], await readFile(file));
        }
    } catch (error) {
        console.error(error);
        send(500, 'text/plain', String(error.message));
    }
}).listen(PORT, '127.0.0.1', () => console.log(`mock mesta on http://127.0.0.1:${PORT}/brno  (counted ${OPTS.counted}, pending ${OPTS.pending})`));
