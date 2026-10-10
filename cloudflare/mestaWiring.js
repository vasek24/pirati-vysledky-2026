// Čisté lepidlo mesta Workeru (bez importu cloudflare:workers, aby šlo testovat):
// routování, klíče feedů, jména Durable Objectů a stavba feedů pro města
// a shardy. Registr měst (ALL_COUNCILS) a shardy dostává zvenku — z pražského
// registru bere jen konstantu KV_BASE_URL (stejná hodnota jako v src/mesta/
// councils.js) a nesmí používat feedWiring.buildFeed/feedKind ani
// warmup.feedTarget (ty se vážou na pražský registr). Spec mesta §3.1–3.3.
import { KV_BASE_URL } from '../src/councils.js';
import { createKvFeed } from '../src/volby/feed.js';
import { composeOverview, createOverviewFeed } from '../src/volby/overview.js';

export const MESTA_USER_AGENT = 'pirati-mesta/1.0 (+https://mesta.dg12.cz/kontakt.txt)';

const SHARD_ID = /^(\d{2}-\d|top-\d)$/;
const APP_PATH = /^\/[a-z0-9-]*\/?$/;
const JSON_BODY = (error) => JSON.stringify({ error });

/**
 * FNV-1a (32 bit) jako 8 hex znaků. Vstup jen ASCII (kódy zastupitelstev
 * spojené čárkou); kód znaku = bajt.
 */
export function fnv1a8(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

const bad = (status, error) => ({ kind: 'bad', status, body: JSON_BODY(error) });

/**
 * Shard feed s „keep-good" po městech (M4): přehledu, který by validate.js
 * odmítl absolutně (město s prázdnými stranami, counted > total), se odeberou
 * vadné souhrny — počítají se do `missing`, ostatní města se publikují a
 * mergeOverview doplní vadné město z posledního dobrého snapshotu. Hodí jen
 * když nezbude žádné město.
 */
function withKeepGood(feed, townCount) {
    const isBad = (s) => !s.parties?.length || s.counted > s.total;
    return {
        snapshot: feed.snapshot,
        invalidate: feed.invalidate,
        async build() {
            const snap = await feed.build();
            const kept = {};
            let dropped = 0;
            for (const [z, s] of Object.entries(snap.councils)) {
                if (isBad(s)) dropped++;
                else kept[z] = s;
            }
            if (!dropped) return snap;
            if (!Object.keys(kept).length) throw new Error('no-valid-council');
            // součty a `official` se odvozují jen z ponechaných měst
            return {
                ...snap,
                ...composeOverview(kept, { now: Date.parse(snap.fetchedAt) || Date.now(), expected: townCount }),
                missing: Math.min(townCount, snap.missing + dropped),
            };
        },
    };
}

/**
 * @param {object} opts
 * @param {object[]} opts.councils ALL_COUNCILS (publikovaná města včetně skrytých)
 * @param {{id:string, kind:string, zastups:number[]}[]} opts.shards SHARDS
 * @param {string} [opts.baseUrl] výchozí zdroj dat (jinak env.CSU_BASE, jinak KV_BASE_URL)
 */
export function createMestaWiring({ councils, shards, baseUrl = KV_BASE_URL }) {
    const townByZastup = new Map(councils.map((c) => [String(c.zastup), c]));
    const shardById = new Map();
    for (const shard of shards) {
        const towns = shard.zastups.map((z) => {
            const council = townByZastup.get(String(z));
            if (!council) throw new Error(`shard ${shard.id}: unknown zastup ${z}`);
            return council;
        });
        const sorted = [...shard.zastups].sort((a, b) => a - b).join(',');
        shardById.set(shard.id, { id: shard.id, towns, doName: `kraj?s=${shard.id}-${fnv1a8(sorted)}` });
    }

    const shardKey = (id) => `kraj-${id}`;
    const shardOfKey = (key) => (String(key).startsWith('kraj-') ? shardById.get(String(key).slice(5)) : null);

    // první třída (cron warm-up): všechny shardy + vlastní feedy featured měst
    const featured = councils
        .filter((c) => c.featured)
        .sort((a, b) => b.population - a.population || a.zastup - b.zastup);
    const firstClassKeys = [...shards.map((s) => shardKey(s.id)), ...featured.map((c) => String(c.zastup))];
    const firstClass = new Set(firstClassKeys);

    function route(url, method) {
        const path = url.pathname;
        if (method !== 'GET' && method !== 'HEAD') return bad(405, 'method-not-allowed');
        if (path === '/api' || path.startsWith('/api/')) {
            if (path === '/api/volby') {
                const z = url.searchParams.get('z');
                const council = /^\d+$/.test(z || '') ? townByZastup.get(String(Number(z))) : null;
                // neznámé město: 400 rovnou z Workeru, DO se nezakládá
                if (!council) return bad(400, 'unknown-council');
                return { kind: 'api', key: String(council.zastup), path: `/api/volby?z=${council.zastup}` };
            }
            if (path === '/api/kraj') {
                const s = url.searchParams.get('s') || '';
                if (!SHARD_ID.test(s) || !shardById.has(s)) return bad(400, 'unknown-shard');
                return { kind: 'api', key: shardKey(s), path: `/api/kraj?s=${s}` };
            }
            return bad(404, 'not-found');
        }
        if (APP_PATH.test(path)) return { kind: 'app' };
        return { kind: 'notfound' };
    }

    // klíč feedu → { name (RPC), path (normalizovaná cesta = klíč cache), doName }
    function feedTarget(key) {
        const shard = shardOfKey(key);
        if (shard) return { name: 'kraj', path: `/api/kraj?s=${shard.id}`, doName: shard.doName };
        const council = townByZastup.get(String(key));
        if (!council) throw new Error(`unknown mesta feed key: ${key}`);
        const path = `/api/volby?z=${council.zastup}`;
        return { name: 'volby', path, doName: path.slice(5) };
    }

    const feedKind = (key) => (shardOfKey(key) ? 'overview' : 'council');
    const isFirstClass = (key) => firstClass.has(String(key));

    /**
     * Feed pro klíč (kód města nebo kraj-<id>). Zdroj dat jen z env (CSU_BASE),
     * nikdy z požadavku. `extra` (např. fetchImpl) jen pro testy.
     */
    function buildFeed(key, env, extra = {}) {
        const base = env.CSU_BASE || baseUrl;
        const common = {
            conditional: true,
            minIntervalMs: 20e3,
            baseUrl: base,
            headers: { 'User-Agent': MESTA_USER_AGENT },
            ...extra,
        };
        const shard = shardOfKey(key);
        if (shard) {
            return withKeepGood(
                createOverviewFeed({ councils: shard.towns, concurrency: 8, waitMs: 8000, timeoutMs: 8000, ...common }),
                shard.towns.length,
            );
        }
        const council = townByZastup.get(String(key));
        if (!council) throw new Error(`unknown mesta feed key: ${key}`);
        // 2 soubory ČSÚ na obnovu; okrskové soubory (hlasy po okrscích pro mapu) jen u měst s
        // `precinctFiles` (= mapa, buildCouncils: featured + overrides `map`) a jen pro nově sečtené okrsky
        // Souběžnost okrskových souborů 3 (výchozí 6): po vyhození DO / nasazení se stahují všechny sečtené okrsky
        // znovu — 12 měst × 3 = nejvýš 36 souběžných dotazů na volby.gov.cz místo 72
        return createKvFeed({ council, concurrency: 3, ...common });
    }

    return { route, feedTarget, buildFeed, feedKind, isFirstClass, firstClassKeys };
}
