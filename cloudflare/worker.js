// Cloudflare Worker: statika z ../dist (assets) + /api/volby, /api/prehled,
// /api/bug (nahlášení chyby → GitHub issue) a /hlaseni/* (screenshoty z KV).
//
// Serverové funkce z api/ běží BEZE ZMĚNY uvnitř Durable Objectu — jedna
// instance na zastupitelstvo (volby:<kód>) a jedna na přehled (prehled).
// Stav feedu (ETagy, sečtené okrsky) je tak jen jeden na celý svět, stejně
// jako v jedné instanci Vercelu, a volby.gov.cz dostane stejnou zátěž bez
// ohledu na počet datacenter. DO navíc nechá doběhnout okrsky stahované na
// pozadí (bezstavový Worker by je po odeslání odpovědi zrušil).
//
// Před DO je Cache API (per datacentrum) s TTL podle s-maxage z odpovědi
// funkce — do DO jde zhruba jeden dotaz za 30 s na datacentrum
// a zastupitelstvo. Hlavička x-cache: HIT/MISS slouží k ověření (obdoba
// x-vercel-cache).
//
// Návštěvnost: anonymní počty do Workers Analytics Engine (viz track()) —
// bez IP, cookies a jakýchkoli identifikátorů.
import { DurableObject } from 'cloudflare:workers';
import volby from '../api/volby.js';
import prehled from '../api/prehled.js';
import { createBugHandler } from '../api/bug.js';
import { councilByZastup } from '../src/councils.js';

const HANDLERS = { volby, prehled };
// stejné jako rewrite ve vercel.json
const APP_ROUTE = /^\/(praha|praha-[a-z0-9-]+)$/;
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
    run(name, url) {
        return runHandler(name, url);
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

const sMaxAge = (cacheControl) => Number(/s-maxage=(\d+)/.exec(cacheControl || '')?.[1]) || 0;

function reply(request, { status, headers, body }, cacheState) {
    return new Response(request.method === 'HEAD' ? null : body, {
        status,
        headers: { ...headers, 'x-cache': cacheState },
    });
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
    let path = '/api/prehled';
    if (name === 'volby') {
        const council = councilByZastup(url.searchParams.get('z'));
        // neznámé zastupitelstvo: 400 rovnou z handleru, DO se nezakládá
        if (!council) return reply(request, await runHandler('volby', url.pathname + url.search), 'BYPASS');
        path = `/api/volby?z=${council.zastup}`;
        track(env, request, name, council.slug);
    } else {
        track(env, request, name, '');
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(path, url.origin));
    const hit = await cache.match(cacheKey);
    if (hit) {
        const headers = Object.fromEntries(hit.headers);
        headers['cache-control'] = headers['x-client-cache-control'];
        delete headers['x-client-cache-control'];
        return reply(request, { status: hit.status, headers, body: hit.body }, 'HIT');
    }

    let out;
    try {
        const stub = env.FEED.get(env.FEED.idFromName(path.slice(5)), { locationHint: 'weur' });
        out = await stub.run(name, path);
    } catch (error) {
        // klient po 502 nechá poslední snapshot a znovu zkouší náš server
        out = {
            status: 502,
            headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' },
            body: JSON.stringify({ error: String(error?.message || error) }),
        };
    }

    // Cache API nepodporuje stale-while-revalidate a s-maxage ani nemusí
    // brát přednostně — do cache jde explicitní max-age, klient dostane
    // původní hlavičku funkce
    const ttl = sMaxAge(out.headers['cache-control']);
    if (out.status === 200 && ttl > 0) {
        ctx.waitUntil(cache.put(cacheKey, new Response(out.body, {
            status: 200,
            headers: {
                ...out.headers,
                'cache-control': `public, max-age=${ttl}`,
                'x-client-cache-control': out.headers['cache-control'],
            },
        })));
    }
    return reply(request, out, 'MISS');
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
};
