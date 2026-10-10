// Cloudflare Worker: statika z ../dist (assets) + /api/volby, /api/prehled,
// /api/bug (nahlášení chyby → GitHub issue) a /hlaseni/* (screenshoty z KV).
//
// Jedna instance Durable Objectu na zastupitelstvo (volby?z=<kód>) a jedna
// na přehled (prehled) je JEDINÝ obnovovatel dat: drží poslední ověřený
// snapshot (cloudflare/refresh.js), obsluhuje ho okamžitě a na pozadí ho
// obnovuje z volby.gov.cz (jedno stahování na celý svět, bez ohledu na počet
// datacenter a diváků). Serverové funkce z api/ zůstávají jen pro Vercel.
//
// Před DO je Cache API (per datacentrum) s TTL 1–5 s (a v pre/final fázi
// 300/600 s) podle nextRefreshAt (cloudflare/edge.js), k tomu 20min záložní
// kopie, kterou Worker vydá, když DO selže. Hlavička x-cache:
// HIT/MISS/LASTRESORT/BYPASS slouží k ověření (obdoba x-vercel-cache).
//
// Návštěvnost: anonymní počty do Workers Analytics Engine (viz track()) —
// bez IP, cookies a jakýchkoli identifikátorů.
import { DurableObject } from 'cloudflare:workers';
import volby from '../api/volby.js';
import { createBugHandler } from '../api/bug.js';
import { COUNCILS, KV_BASE_URL, councilByZastup } from '../src/councils.js';
import { LAST_RESORT_TTL, cacheControlFor, edgeTtl, lastResortRequest, markStale, withTimeout } from './edge.js';
import { FIRST_CLASS_KEYS, isFirstClass } from './feedClasses.js';
import { buildFeed, feedKind, makeLog, phaseOfSnapshot } from './feedWiring.js';
import { createRefresher } from './refresh.js';
import { feedTarget, runWarmup } from './warmup.js';

// jen pro 400 na neznámé zastupitelstvo (DO se nezakládá) — feedy samotné
// běží v Feed DO přes refresher
const HANDLERS = { volby };
// stejné jako rewrite ve vercel.json (tam je výčet ručně, tady z registru)
const SLUGS = new Set(COUNCILS.map((c) => c.slug));
const APP_ROUTE = { test: (pathname) => SLUGS.has(pathname.replace(/^\/+/, '')) };
const JSON_TYPE = 'application/json; charset=utf-8';

// Spustí Node-style handler z api/ (req.method, req.url, res.statusCode,
// res.setHeader, res.end) a vrátí { status, headers, body }
function runHandler(name, url, req = {}) {
    return runWith(HANDLERS[name], { method: 'GET', url, ...req });
}

function runWith(handler, req) {
    return new Promise((resolve, reject) => {
        const headers = {};
        const res = {
            statusCode: 200,
            setHeader: (key, value) => {
                headers[key.toLowerCase()] = String(value);
            },
            end: (body = '') => resolve({ status: res.statusCode, headers, body }),
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

const SCREENSHOT_EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Návštěvnost (Workers Analytics Engine, binding STATS). Aplikace posílá
// s každým dotazem na /api/volby a /api/prehled hlavičku X-Kv26-View
// (src/hooks/useLiveResults.js viewHeader): s = kolik sekund od minulého
// dotazu byla stránka otevřená a viditelná, v=1 = první dotaz po načtení
// stránky (návštěva), r = odkud přišla, t=1 = dotykové ovládání. Bez
// hlavičky (roboti, curl, monitoring) se nic nezapisuje. Jeden bod:
//   index   slug zastupitelstva / prehled (vzorkování zvlášť pro každé)
//   blob1   volby | prehled        blob2 slug ('' = přehled)
//   blob3   dotyk | mys            blob4 odkud ('' = přímo, '(web)' = z webu)
//   double1 sekundy sledování      double2 návštěva (1/0)
// Diváci v úseku = Σ sekund / délka úseku.
const REF = /^(\(web\)|[a-z0-9.-]{1,80})$/;

function track(env, request, kind, slug) {
    const raw = request.headers.get('x-kv26-view');
    if (!raw || request.method !== 'GET' || !env.STATS) return;
    try {
        const q = new URLSearchParams(raw);
        const seconds = Math.min(1800, Math.max(0, Number(q.get('s')) || 0));
        const visit = q.get('v') === '1';
        const ref = (visit && q.get('r')?.toLowerCase()) || '';
        env.STATS.writeDataPoint({
            indexes: [slug || 'prehled'],
            blobs: [kind, slug, q.get('t') === '1' ? 'dotyk' : 'mys', REF.test(ref) || !ref ? ref : '(jiné)'],
            doubles: [seconds, visit ? 1 : 0],
        });
    } catch (error) {
        // statistiky nesmí shodit odpověď
        console.warn('stats', error);
    }
}

export class Feed extends DurableObject {
    // Odpověď feedu ze stored snapshotu: { status, body, cacheControl, stale, phase }.
    // `body` je hotový JSON řetězec z refresheru (neparsuje se ani nestringifikuje
    // znovu). Refresher a feed se stavějí líně při prvním volání podle `name`/`url`
    // z RPC (jméno DO i klíč feedu odvozuje callFeed z téhož feedTarget) a žijí
    // do vyhození instance; rehydrate z ctx.storage je v refresheru single-flight.
    //
    // Obnova na pozadí přežije odeslání odpovědi, protože DO zůstává živý,
    // dokud má rozpracované I/O (stahování z ČSÚ); ctx.waitUntil je v DO no-op
    // (L14) — nepřepisovat ho na něco „funkčního".
    async run(name, url) {
        const key = name === 'prehled' ? 'prehled' : new URL(url, 'http://x').searchParams.get('z');
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
            feed: buildFeed(key, this.env),
            kind: feedKind(key),
            phaseOf: phaseOfSnapshot,
            firstClass: isFirstClass(key),
            base,
            log: makeLog(console),
            waitUntil: (p) => this.ctx.waitUntil(p),
        });
    }

    // Nahlášení chyby — jeden DO „bug" pro celý svět, takže limit hlášení na
    // IP drží jeden stav. Token GitHubu je secret Workeru (GITHUB_TOKEN),
    // screenshoty jdou do KV HLASENI a worker je servíruje na /hlaseni/*.
    bug(req) {
        this.bugHandler ||= createBugHandler({
            getEnv: () => this.env,
            storeScreenshot: async (bytes, contentType) => {
                const now = new Date();
                const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${SCREENSHOT_EXT[contentType] || 'jpg'}`;
                await this.env.HLASENI.put(key, bytes, { metadata: { contentType } });
                return `/hlaseni/${key}`;
            },
        });
        return runWith(this.bugHandler, req);
    }
}

// JEDINÝ vstup do Durable Objectu pro feedy (HTTP route i cron): klíč feedu =
// kód zastupitelstva nebo 'prehled'. Feed nemá fetch(), volá se RPC run().
// Vrací { status, body, cacheControl, stale, phase }.
function callFeed(env, key) {
    const { name, path, doName } = feedTarget(key);
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

async function api(request, env, ctx, url) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
            status: 405,
            headers: { Allow: 'GET', 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' },
        });
    }
    const name = url.pathname === '/api/volby' ? 'volby' : 'prehled';
    // Normalizovaná cesta: klíč cache i jméno DO, ostatní parametry se
    // zahodí (náhodný ?x= nesmí obejít cache)
    let key = 'prehled';
    if (name === 'volby') {
        const council = councilByZastup(url.searchParams.get('z'));
        // neznámé zastupitelstvo: 400 rovnou z handleru, DO se nezakládá
        if (!council) return reply(request, await runHandler('volby', url.pathname + url.search), 'BYPASS');
        key = String(council.zastup);
        track(env, request, name, council.slug);
    } else {
        track(env, request, name, '');
    }

    const { path } = feedTarget(key);
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

async function bug(request, env, url) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
            status: 405,
            headers: { Allow: 'POST', 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' },
        });
    }
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 6 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Hlášení je moc velké.' }), { status: 413, headers: { 'Content-Type': JSON_TYPE } });
    }
    const stub = env.FEED.get(env.FEED.idFromName('bug'), { locationHint: 'weur' });
    const out = await stub.bug({
        method: 'POST',
        url: url.pathname,
        body: await request.text(),
        headers: {
            host: url.host,
            'x-forwarded-proto': url.protocol.replace(':', ''),
            'cf-connecting-ip': request.headers.get('cf-connecting-ip') || '',
        },
    });
    return reply(request, out, 'BYPASS');
}

// Screenshot z hlášení (klíč je náhodné UUID, obsah se nemění)
async function screenshot(request, env, url) {
    const key = decodeURIComponent(url.pathname.slice('/hlaseni/'.length));
    if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(key)) return new Response('Not found', { status: 404 });
    const { value, metadata } = await env.HLASENI.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!value) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : value, {
        headers: {
            'Content-Type': metadata?.contentType || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/api/volby' || url.pathname === '/api/prehled') return api(request, env, ctx, url);
        if (url.pathname === '/api/bug') return bug(request, env, url);
        if (url.pathname.startsWith('/hlaseni/')) return screenshot(request, env, url);
        // Sem chodí jen dotazy, pro které neexistuje soubor v dist/
        if (APP_ROUTE.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
        return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    },

    // Cron každou minutu: udržuje první třídu feedů (feedClasses.js) čerstvou
    // bez diváků. Nikdy nevyhazuje — selhání jen zaloguje runWarmup (úspěch =
    // status 200 z DO). Vypršení 15 s lhůty RPC nezruší práci v DO: obnova tam
    // běží dál a výsledek se uloží (jen cron na ni přestane čekat).
    async scheduled(controller, env) {
        await runWarmup(FIRST_CLASS_KEYS, (key) => callFeed(env, key), { concurrency: 4, timeoutMs: 15000 });
    },
};
