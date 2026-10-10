// Cloudflare Worker mesta.dg12.cz (pirati-mesta): statika z ../.cache/dist-mesta
// (assets) + /api/volby?z=<kód města> a /api/kraj?s=<id shardu>.
//
// Stejná architektura jako worker.js (Praha): jedna instance Durable Objectu na
// město a na shard je JEDINÝ obnovovatel dat (cloudflare/refresh.js), před DO je
// Cache API s TTL podle nextRefreshAt (edge.js) a 20min záložní kopie.
//
// POZOR, držet v synchronu s worker.js: sMaxAge, reply, lastResort,
// logFeedFailure a konstanty JSON_TYPE, RPC_TIMEOUT_MS, FAIL_LOG_EVERY_MS jsou
// ZKOPÍROVANÉ (cloudflare/mestaWorker.drift.test.js hlídá, že se text neliší).
// Routování, klíče feedů a stavba feedů jsou v mestaWiring.js. Z pražského
// registru se sem nesmí importovat nic (ani buildFeed/feedKind z feedWiring.js,
// ani feedTarget z warmup.js, ani feedClasses.js) — registr měst je ALL_COUNCILS.
// Nasazovat jen přes scripts/mesta.sh (viz hlavička wrangler.mesta.jsonc).
import { DurableObject } from 'cloudflare:workers';
import { ALL_COUNCILS, KV_BASE_URL, SHARDS } from '../src/mesta/councils.js';
import { LAST_RESORT_TTL, cacheControlFor, edgeTtl, lastResortRequest, markStale, withTimeout } from './edge.js';
import { makeLog, phaseOfSnapshot } from './feedWiring.js';
import { createMestaWiring } from './mestaWiring.js';
import { createRefresher } from './refresh.js';
import { runWarmup } from './warmup.js';

const wiring = createMestaWiring({ councils: ALL_COUNCILS, shards: SHARDS, baseUrl: KV_BASE_URL });
const JSON_TYPE = 'application/json; charset=utf-8';

export class Feed extends DurableObject {
    // Odpověď feedu ze stored snapshotu: { status, body, cacheControl, stale, phase }.
    // Refresher a feed se stavějí líně při prvním volání podle `name`/`url` z RPC
    // (jméno DO i klíč feedu odvozuje callFeed z téhož wiring.feedTarget) a žijí
    // do vyhození instance. Obnova na pozadí přežije odeslání odpovědi, protože
    // DO zůstává živý, dokud má rozpracované I/O; ctx.waitUntil je v DO no-op (L14).
    async run(name, url) {
        const params = new URL(url, 'http://x').searchParams;
        const key = name === 'kraj' ? 'kraj-' + params.get('s') : params.get('z');
        if (!this.refresher) {
            this.feedKey = key;
            this.refresher = this.makeRefresher(key);
        } else if (key !== this.feedKey) {
            // jedna DO instance = jeden feed; jiný klíč by otrávil cizí snapshot
            throw new Error(`feed key mismatch: ${key} vs ${this.feedKey}`);
        }
        const { status, body, meta } = await this.refresher.get();
        const ok = status === 200;
        return {
            status,
            body,
            cacheControl: ok ? cacheControlFor(edgeTtl({ nextRefreshAt: meta.nextRefreshAt, now: Date.now(), stale: meta.stale, phase: meta.phase })) : 'no-store',
            stale: meta.stale,
            phase: meta.phase,
        };
    }

    makeRefresher(key) {
        const base = this.env.CSU_BASE || KV_BASE_URL;
        return createRefresher({
            now: Date.now,
            random: Math.random,
            storage: { get: (k) => this.ctx.storage.get(k), put: (o) => this.ctx.storage.put(o) },
            feed: wiring.buildFeed(key, this.env),
            kind: wiring.feedKind(key),
            phaseOf: phaseOfSnapshot,
            firstClass: wiring.isFirstClass(key),
            base,
            log: makeLog(console),
            waitUntil: (p) => this.ctx.waitUntil(p),
        });
    }
}

// JEDINÝ vstup do Durable Objectu pro feedy (HTTP route i cron): klíč feedu =
// kód města nebo kraj-<id shardu>. Feed nemá fetch(), volá se RPC run().
// Vrací { status, body, cacheControl, stale, phase }.
function callFeed(env, key) {
    const { name, path, doName } = wiring.feedTarget(key);
    const stub = env.FEED.get(env.FEED.idFromName(doName), { locationHint: 'weur' });
    return stub.run(name, path);
}

const sMaxAge = (cacheControl) => Number(/s-maxage=(\d+)/.exec(cacheControl || '')?.[1]) || 0;

// JEDINÝ výstup odpovědí API (HIT, MISS, LASTRESORT, 503): x-server-now je
// čas serveru pro korekci hodin klienta
function reply(request, { status, headers, body }, cacheState) {
    return new Response(request.method === 'HEAD' ? null : body, {
        status,
        headers: { ...headers, 'x-cache': cacheState, 'x-server-now': String(Date.now()) },
    });
}

const RPC_TIMEOUT_MS = 13000; // nad 12s lhůtou buildu v refresheru, pod 25s timeoutem klienta
const FAIL_LOG_EVERY_MS = 10000;
let failLoggedAt = 0;

// V poruše by log na každý požadavek diváka byl neomezený — nejvýš jednou za 10 s na isolate
function logFeedFailure(key, reason) {
    const t = Date.now();
    if (t - failLoggedAt < FAIL_LOG_EVERY_MS) return;
    failLoggedAt = t;
    console.warn('feed-failed', key, reason);
}

// DO selhal (výjimka, timeout nebo 5xx): poslední dobrá odpověď ze záložní
// kopie jako stale:true, jinak 503 JSON (necachuje se). Označená kopie se
// vloží do HLAVNÍ cache na ≤ 5 s, aby se v poruše každý požadavek nevracel
// do přetíženého DO (zpětná vazba blokující zotavení). Do záložního klíče se
// označené tělo nevrací.
async function lastResort(request, ctx, cache, cacheKey, lastResortKey) {
    const copy = await cache.match(lastResortKey).catch(() => null);
    if (!copy) {
        return reply(request, {
            status: 503,
            headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' },
            body: JSON.stringify({ error: 'unavailable' }),
        }, 'UNAVAILABLE');
    }
    const body = markStale(await copy.text());
    const clientCache = 'public, max-age=0, s-maxage=5';
    ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        status: 200,
        headers: {
            'content-type': JSON_TYPE,
            'cache-control': 'public, max-age=5, s-maxage=5',
            'x-client-cache-control': clientCache,
            'x-lastresort': '1',
        },
    })).catch(() => {}));
    return reply(request, { status: 200, headers: { 'content-type': JSON_TYPE, 'cache-control': clientCache, 'x-lastresort': '1' }, body }, 'LASTRESORT');
}

// route() už vybral klíč feedu a normalizovanou cestu (klíč cache, ostatní
// parametry zahozené — náhodné ?x= nesmí obejít cache)
async function api(request, env, ctx, url, { key, path }) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(path, url.origin));
    const lastResortKey = lastResortRequest(cacheKey.url);
    const hit = await cache.match(cacheKey);
    if (hit) {
        const headers = Object.fromEntries(hit.headers);
        headers['cache-control'] = headers['x-client-cache-control'];
        delete headers['x-client-cache-control'];
        return reply(request, { status: hit.status, headers, body: hit.body }, 'HIT');
    }

    let out = null;
    try {
        // zaseknuté DO nesmí držet diváky až do 25s timeoutu klienta
        out = await withTimeout(callFeed(env, key), RPC_TIMEOUT_MS);
    } catch (error) {
        logFeedFailure(key, error?.message || error);
    }
    // klient po 503 nechá poslední snapshot a znovu zkouší náš server; 5xx se
    // nikdy necachuje
    if (!out || out.status >= 500) {
        if (out) logFeedFailure(key, `status ${out.status}`);
        return lastResort(request, ctx, cache, cacheKey, lastResortKey);
    }

    const headers = { 'content-type': JSON_TYPE, 'cache-control': out.cacheControl };
    const ttl = sMaxAge(out.cacheControl);
    if (out.status === 200 && ttl > 0) {
        // Cache API bere TTL spolehlivě z max-age, proto stejná hodnota i tam;
        // klient dostane původní hlavičku z x-client-cache-control (HIT cesta)
        ctx.waitUntil(cache.put(cacheKey, new Response(out.body, {
            status: 200,
            headers: {
                'content-type': JSON_TYPE,
                'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}`,
                'x-client-cache-control': out.cacheControl,
            },
        })));
        // 20min záložní kopie pod samostatným klíčem (C2: fragment by hlavní klíč přepsal)
        ctx.waitUntil(cache.put(lastResortKey, new Response(out.body, {
            status: 200,
            headers: {
                'content-type': JSON_TYPE,
                'cache-control': `public, max-age=${LAST_RESORT_TTL}, s-maxage=${LAST_RESORT_TTL}`,
            },
        })));
    }
    return reply(request, { status: out.status, headers, body: out.body }, 'MISS');
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const target = wiring.route(url, request.method);
        switch (target.kind) {
            case 'api':
                return api(request, env, ctx, url, target);
            case 'app':
                // Sem chodí jen dotazy, pro které neexistuje soubor v assets:
                // neznámé i skryté město vykreslí index
                return env.ASSETS.fetch(new Request(new URL('/', url), request));
            case 'bad':
                return reply(request, {
                    status: target.status,
                    headers: {
                        'content-type': JSON_TYPE,
                        'cache-control': 'no-store',
                        ...(target.status === 405 ? { allow: 'GET, HEAD' } : {}),
                    },
                    body: target.body,
                }, 'BYPASS');
            default:
                return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
    },

    // Cron každou minutu: udržuje první třídu feedů (všechny shardy + největší
    // města) čerstvou bez diváků. Nikdy nevyhazuje — selhání jen zaloguje
    // runWarmup. Vypršení 15 s lhůty RPC nezruší práci v DO.
    async scheduled(controller, env) {
        await runWarmup(wiring.firstClassKeys, (key) => callFeed(env, key), { concurrency: 8, timeoutMs: 15000 });
    },
};
