// Stahování průběžných výsledků KV 2026 jednoho zastupitelstva z volby.gov.cz a jejich
// převod na kompaktní „snapshot". Běží ve dvou prostředích:
//  - server (api/volby.js): podmíněné dotazy přes If-None-Match, výsledek
//    sdílí všichni klienti přes CDN cache,
//  - prohlížeč (záloha, když /api/volby neodpovídá): revalidaci přes ETag
//    obstará HTTP cache prohlížeče (cache: 'no-cache' — vlastní hlavička
//    If-None-Match by spustila CORS preflight).
//
// Šetrnost k volby.gov.cz: každý soubor se stahuje nejvýš jednou za
// minIntervalMs, okrskové soubory jen pro nově sečtené okrsky (nebo když se
// jejich řádek v přehledu účasti změní — ČSÚ občas data okrsku pošle znovu).
import { KV_BASE_URL, POLLS_CLOSE } from '../councils.js';

export const SNAPSHOT_VERSION = 1;

export const pathsFor = ({ okres, zastup }) => ({
    results: `vysled/${okres}/${zastup}.json`,
    turnout: `ucast/obec/${okres}/${zastup}.json`,
    precinct: (id) => `vysled/okrsek/${okres}/${zastup}_${id}.json`,
});

const num = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

export class FeedError extends Error {
    constructor(status, path) {
        super(`volby.gov.cz ${status} (${path})`);
        this.status = status;
    }
}

// pre = před uzavřením místností, waiting = zavřeno, ale ještě žádný okrsek,
// counting = sčítá se, final = ČSÚ rozdělil mandáty (zvoleno)
export function phaseOf({ counted, official }, now = Date.now()) {
    if (official) return 'final';
    if (counted > 0) return 'counting';
    return now < POLLS_CLOSE ? 'pre' : 'waiting';
}

// Mandát kandidáta — ČSÚ ho v tabulce značí textem (typicky „*"), ne číslem
function electedFlag(v) {
    return v !== null && v !== undefined && v !== '' && v !== 0 && v !== false && v !== '0';
}

// vysled/<okres>/<zastup>.json — průběžný výsledek za zastupitelstvo.
// prehled: [mandátů, obvodů, okrsků, zpracováno, % zpracováno, voličů,
//           vydaných obálek, účast %, voličských průkazů, odevzdaných obálek,
//           platných lístků, % platných lístků, platných hlasů]
// vysledky: [č., název, hlasy, %, kandidátů, přepočtený základ,
//            přepočtené %, mandátů, % mandátů, …]
// hlasy[strana]: [pořadí, jméno, věk, hlasy, %, mandát, pořadí zvolení]
export function normalizeResults(json, council) {
    const p = json.prehled || [];
    const fullNames = new Map((json.plne_nazvy_stran || []).map((r) => [r[0], r[1]]));
    const official = json.zvoleno === true;
    return {
        generated: json.generovano || null,
        seats: num(p[0]) || council.seats,
        precincts: { total: num(p[2]) || council.precincts, counted: num(p[3]), pct: num(p[4]) },
        turnout: {
            voters: num(p[5]),
            envelopes: num(p[6]),
            pct: num(p[7]),
            returned: num(p[9]),
            validBallots: num(p[10]),
            validVotes: num(p[12]),
        },
        official,
        parties: (json.vysledky || []).map((r) => ({
            id: num(r[0]),
            name: r[1],
            fullName: fullNames.get(r[0]) || r[1],
            votes: num(r[2]),
            pct: num(r[3]),
            candidates: num(r[4]),
            recalcPct: r[6] === undefined || r[6] === null ? null : num(r[6]),
            seats: official && r[7] !== undefined && r[7] !== null ? num(r[7]) : null,
        })),
        candidates: Object.fromEntries(Object.entries(json.hlasy || {}).map(([pid, rows]) => [
            pid,
            rows.map((c) => ({
                n: num(c[0]),
                name: c[1],
                age: num(c[2]),
                votes: num(c[3]),
                pct: num(c[4]),
                elected: official ? electedFlag(c[5]) : null,
                rank: official && c[6] ? num(c[6]) : null,
            })),
        ])),
        // hranice pro posun kandidáta preferenčními hlasy (110 % průměru)
        limits: Object.fromEntries(Object.entries(json.hranice || {}).map(([k, v]) => [k, num(v)])),
    };
}

// ucast/obec/<okres>/<zastup>.json — řádek okrsku:
// [okrsek, voličů, obálek, účast %, průkazů, odevzdaných obálek,
//  platných lístků, % platných, platných hlasů, MČ]
function normalizeTurnout(json) {
    const rows = new Map();
    for (const r of json.okrsky || []) {
        if (!Array.isArray(r) || !(num(r[1]) > 0)) continue; // jen sečtené okrsky
        rows.set(String(r[0]), {
            sig: r.slice(1, 9).join('|'),
            voters: num(r[1]),
            envelopes: num(r[2]),
            turnout: num(r[3]),
            validVotes: num(r[8]),
        });
    }
    return { generated: json.generovano || null, rows };
}

// vysled/okrsek/<okres>/<zastup>_<okrsek>.json — prehled: [voličů, obálek,
// účast %, průkazů, odevzdaných, platných lístků, % platných, platných hlasů]
function normalizePrecinct(json) {
    const rows = json.vysledky || [];
    if (!rows.length) return null; // okrsek ještě není vygenerovaný
    const votes = {};
    for (const r of rows) votes[num(r[0])] = num(r[2]);
    return { generated: json.generovano || null, votes };
}

// Časový limit dotazu: přetížený volby.gov.cz nesmí držet funkci (ani
// prohlížeč) minuty — radši chyba a poslední známá data
function timeoutSignal(ms) {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(ms)
        : undefined;
}

// Jednoduchý limiter souběžných dotazů sdílený napříč běhy build()
export function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || !queue.length) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve, reject).finally(() => {
            active--;
            next();
        });
    };
    return (fn) => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameVotes = (a, b) => !!a && !!b && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((k) => a[k] === b[k]);

// Podmíněné stahování JSONů z volby.gov.cz s pamětí: každý soubor nejvýš
// jednou za minIntervalMs (maxAgeMs), po chybě se soubor chvíli nezkouší
// a souběžné dotazy na stejný soubor se sdílí. Vrací getJson(path).
export function createJsonCache({
    fetchImpl = (...args) => fetch(...args),
    conditional = true,
    baseUrl = KV_BASE_URL,
    minIntervalMs = 20000,
    timeoutMs = 8000,
    headers = {},
} = {}) {
    const files = new Map(); // path -> { etag, lastModified, json, checkedAt }
    const failures = new Map(); // path -> { at, error } — po chybě chvíli nezkoušet
    const fetching = new Map(); // path -> běžící dotaz (souběžná volání ho sdílí)
    const versions = new Map(); // path -> počet HTTP 200 odpovědí (304 ani paměť se nepočítá)

    async function getJson(path, { maxAgeMs = minIntervalMs } = {}) {
        const entry = files.get(path);
        const now = Date.now();
        if (entry && now - entry.checkedAt < maxAgeMs) return entry.json;
        // Chyba zdroje se nezkouší znovu dřív než za minIntervalMs —
        // když volby.gov.cz trpí, nepřidáváme mu zátěž
        const failed = failures.get(path);
        if (failed && now - failed.at < minIntervalMs) throw failed.error;
        if (fetching.has(path)) return fetching.get(path);
        const job = fetchJson(path, entry, now).finally(() => fetching.delete(path));
        fetching.set(path, job);
        return job;
    }

    async function fetchJson(path, entry, now) {
        let init;
        if (conditional) {
            const h = { Accept: 'application/json', ...headers };
            if (entry?.etag) h['If-None-Match'] = entry.etag;
            if (entry?.lastModified) h['If-Modified-Since'] = entry.lastModified;
            init = { headers: h, signal: timeoutSignal(timeoutMs) };
        } else {
            init = { cache: 'no-cache', signal: timeoutSignal(timeoutMs) };
        }

        try {
            const res = await fetchImpl(`${baseUrl}/${path}`, init);
            if (res.status === 304 && entry) {
                entry.checkedAt = now;
                failures.delete(path);
                return entry.json;
            }
            if (!res.ok) throw new FeedError(res.status, path);
            const json = await res.json();
            files.set(path, {
                etag: res.headers.get('etag'),
                lastModified: res.headers.get('last-modified'),
                json,
                checkedAt: now,
            });
            versions.set(path, (versions.get(path) || 0) + 1);
            failures.delete(path);
            return json;
        } catch (error) {
            failures.set(path, { at: Date.now(), error });
            throw error;
        }
    }

    // Zapomene soubor: příští getJson(path) stahuje hned a bez If-None-Match
    getJson.invalidate = (path) => {
        files.delete(path);
    };
    getJson.version = (path) => versions.get(path) || 0;
    return getJson;
}

// council = položka z src/councils.js (zastup, okres, seats, precincts,
// precinctFiles — u Magistrátu se okrskové soubory nestahují)
export function createKvFeed({
    council,
    fetchImpl = (...args) => fetch(...args),
    conditional = true,
    baseUrl = KV_BASE_URL,
    minIntervalMs = 20000,
    concurrency = 6,
    timeoutMs = 8000,
    // jak dlouho build() čeká na okrskové soubory, než vrátí snapshot bez
    // nich (dotahují se dál na pozadí a přibudou v dalším běhu)
    precinctWaitMs = 3000,
    headers = {},
} = {}) {
    const getJson = createJsonCache({ fetchImpl, conditional, baseUrl, minIntervalMs, timeoutMs, headers });
    const precincts = new Map(); // okrsek -> { sig, votes }
    const pending = new Map(); // okrsek -> běžící stažení
    const attempts = new Map(); // okrsek -> počet pokusů o změněný okrsek
    const limit = createLimiter(concurrency);
    const PATHS = pathsFor(council);
    let last = null;
    let inflight = null;

    // Stažení jednoho okrsku. Uloží se jen data, která odpovídají aktuálnímu
    // řádku v přehledu účasti: součet hlasů = platné hlasy, a u okrsku
    // poslaného znovu (změněný řádek) se čeká, až se změní i okrskový soubor
    // (webcache ČSÚ může chvíli vracet starou verzi) — nejvýš 5 pokusů.
    function fetchPrecinct(id, row) {
        if (pending.has(id)) return pending.get(id);
        const job = limit(async () => {
            const data = normalizePrecinct(await getJson(PATHS.precinct(id), { maxAgeMs: 0 }));
            if (!data) return;
            const sum = Object.values(data.votes).reduce((s, v) => s + v, 0);
            if (row.validVotes > 0 && sum !== row.validVotes) return;
            const prev = precincts.get(id);
            if (prev && sameVotes(prev.votes, data.votes)) {
                const n = (attempts.get(id) || 0) + 1;
                attempts.set(id, n);
                if (n < 5) return; // nejspíš ještě stará verze souboru
            }
            attempts.delete(id);
            precincts.set(id, { sig: row.sig, votes: data.votes });
        })
            .catch(() => {
                /* příští kolo */
            })
            .finally(() => pending.delete(id));
        pending.set(id, job);
        return job;
    }

    // Vnitřní build: hodí chybu při jakémkoli selhání, `last` nemění
    async function buildSnapshot() {
        const [resultsJson, turnoutJson] = await Promise.all([
            getJson(PATHS.results),
            getJson(PATHS.turnout),
        ]);
        const results = normalizeResults(resultsJson, council);
        const turnout = normalizeTurnout(turnoutJson);

        // Okrskové soubory: jen nové/změněné okrsky. Na stažení se čeká nejvýš
        // precinctWaitMs — studený start uprostřed sčítání (desítky okrsků)
        // tak nezdrží odpověď; zbytek doběhne na pozadí a přibude příště.
        const jobs = council.precinctFiles === false ? [] : [...turnout.rows]
            .filter(([id, row]) => precincts.get(id)?.sig !== row.sig)
            .map(([id, row]) => fetchPrecinct(id, row));
        if (jobs.length) await Promise.race([Promise.all(jobs), sleep(precinctWaitMs)]);

        const okrsky = {};
        for (const [id, row] of turnout.rows) {
            okrsky[id] = {
                voters: row.voters,
                envelopes: row.envelopes,
                turnout: row.turnout,
                validVotes: row.validVotes,
                votes: precincts.get(id)?.votes || null,
            };
        }

        const counted = Math.max(results.precincts.counted, turnout.rows.size);
        const snapshot = {
            v: SNAPSHOT_VERSION,
            zastup: council.zastup,
            fetchedAt: new Date().toISOString(),
            generated: [results.generated, turnout.generated].filter(Boolean).sort().pop() || null,
            phase: phaseOf({ counted, official: results.official }),
            ...results,
            precincts: {
                ...results.precincts,
                counted,
                pct: results.precincts.total ? (counted / results.precincts.total) * 100 : 0,
            },
            okrsky,
        };
        return snapshot;
    }

    // Pro obnovu v Durable Objectu: na rozdíl od snapshot() selhání nepřekryje
    // starými daty, `last` nemění a výsledek nese fetchId (mění se jen novým HTTP 200)
    async function build() {
        const snap = await buildSnapshot();
        return { ...snap, fetchId: `${getJson.version(PATHS.results)}.${getJson.version(PATHS.turnout)}` };
    }

    function invalidate() {
        getJson.invalidate(PATHS.results);
        getJson.invalidate(PATHS.turnout);
    }

    // Vrací { snapshot, stale, error }. Souběžná volání sdílí jeden běh.
    // Když volby.gov.cz selže, vrátí poslední úspěšný snapshot jako stale.
    async function snapshot() {
        if (!inflight) {
            inflight = buildSnapshot().then((snap) => {
                last = snap;
                return snap;
            }).finally(() => {
                inflight = null;
            });
        }
        try {
            return { snapshot: await inflight, stale: false, error: null };
        } catch (error) {
            if (last) return { snapshot: last, stale: true, error };
            throw error;
        }
    }

    return { snapshot, build, invalidate };
}
