#!/usr/bin/env node
// Soukromý záznamník průběžných výsledků KV 2026 (Praha Magistrát + Praha 9).
// NIKDY se nenasazuje ani nebuildí; výstup jde do analysis-private/ (mimo git).
//
//   node scripts/analysis/record.mjs                       # jen náš veřejný API
//   node scripts/analysis/record.mjs --magistrat-precincts # + okrskové soubory ČSÚ (viz README)
//   volitelně: --once  --out <dir>  --interval <s>  (interval nejméně 60 s)
//
// Základ: každých 60 s GET https://praha.dg12.cz/api/volby?z=<zastup> pro obě
// zastupitelstva a append nového řádku do live/<slug>.jsonl při nové hodnotě
// `generated`. Append-only, po pádu se prostě spustí znovu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KV_BASE_URL, councilBySlug } from '../../src/councils.js';
import { pathsFor, createLimiter, sleep } from '../../src/volby/feed.js';
import {
    USER_AGENT, MIN_INTERVAL_MS, buildRecord, recordKey, readJsonl, appendJsonl, countedRows, reducePrecinct,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = path.resolve(HERE, '../../../../SyncThing/70_AI/pirati-elec-tracker/analysis-private');
export const API_BASE = 'https://praha.dg12.cz/api/volby';
export const TARGETS = [
    { slug: 'magistrat', zastup: 554782 },
    { slug: 'praha-9', zastup: 500216 },
];
const FETCH_TIMEOUT_MS = 15_000;

export function makeLogger(file, echo = true) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return (msg) => {
        const line = `${new Date().toISOString()} ${msg}`;
        if (echo) console.log(line);
        try {
            fs.appendFileSync(file, `${line}\n`);
        } catch {
            /* log nesmí shodit záznamník */
        }
    };
}

// Jeden dotaz na náš API pro jedno zastupitelstvo. Vrací stav pro log/testy.
export async function pollOnce({ slug, zastup, fetchImpl = fetch, outDir, log, state, now = () => new Date(), signal }) {
    const file = path.join(outDir, 'live', `${slug}.jsonl`);
    if (!state.keys) state.keys = new Set(readJsonl(file).map(recordKey));
    let res;
    try {
        res = await fetchImpl(`${API_BASE}?z=${zastup}`, {
            headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch (e) {
        log(`${slug}: dotaz selhal (${e.name}: ${e.message})`);
        return 'error';
    }
    if (!res.ok) {
        log(`${slug}: HTTP ${res.status}`);
        return 'error';
    }
    let snap;
    try {
        snap = await res.json();
    } catch (e) {
        log(`${slug}: neplatný JSON (${e.message})`);
        return 'error';
    }
    // nezměněná odpověď (stejné refreshedAt) — nic nového
    if (snap.refreshedAt && snap.refreshedAt === state.refreshedAt) return 'unchanged';
    state.refreshedAt = snap.refreshedAt;
    const rec = buildRecord(snap, slug, now());
    const key = recordKey(rec);
    if (state.keys.has(key)) return 'unchanged';
    appendJsonl(file, rec);
    state.keys.add(key);
    log(`${slug}: nový záznam generated=${rec.generated} sečteno ${rec.precincts.counted}/${rec.precincts.total}${snap.stale ? ' (API stale)' : ''}`);
    return 'appended';
}

// Volitelný režim: okrskové soubory ČSÚ pro Magistrát, každý nejvýš jednou.
export function createPrecinctCollector({
    fetchImpl = fetch, outDir, log, baseUrl = KV_BASE_URL, gapMs = 300, concurrency = 2, maxAttempts = 5, signal,
}) {
    const council = councilBySlug('praha');
    const P = pathsFor(council);
    const file = path.join(outDir, 'live', 'magistrat-precincts.jsonl');
    const done = new Set(readJsonl(file).map((r) => r.okrsek));
    const attempts = new Map();
    const limit = createLimiter(concurrency);
    let etag = null;
    let lastTurnout = null;
    let running = false;
    let nextSlot = 0; // globální rytmus: mezi zahájením dvou dotazů ≥ gapMs

    async function csuGet(p, headers = {}) {
        const wait = Math.max(0, nextSlot - Date.now());
        nextSlot = Math.max(nextSlot, Date.now()) + gapMs;
        if (wait) await sleep(wait);
        const t = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        return fetchImpl(`${baseUrl}/${p}`, {
            headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
            signal: signal ? AbortSignal.any([signal, t]) : t,
        });
    }

    async function loadTurnout() {
        const res = await csuGet(P.turnout, etag ? { 'If-None-Match': etag } : {});
        if (res.status === 304 && lastTurnout) return lastTurnout;
        if (!res.ok) throw new Error(`ČSÚ ${res.status} (${P.turnout})`);
        lastTurnout = await res.json();
        etag = res.headers.get('etag');
        return lastTurnout;
    }

    async function fetchOne(row) {
        try {
            const res = await csuGet(P.precinct(row.okrsek));
            if (!res.ok) throw new Error(`ČSÚ ${res.status}`);
            const rec = reducePrecinct(await res.json(), row);
            if (!rec) return; // soubor ještě není vygenerován
            const n = (attempts.get(row.okrsek) || 0) + 1;
            attempts.set(row.okrsek, n);
            // součet hlasů musí sedět s přehledem účasti; jinak zkusit příští kolo,
            // po maxAttempts uložit s consistent:false
            if (!rec.consistent && n < maxAttempts) return;
            appendJsonl(file, { v: 1, fetchedAt: new Date().toISOString(), ...rec });
            done.add(row.okrsek);
            log(`magistrat-precincts: okrsek ${row.okrsek} uložen${rec.consistent ? '' : ' (NESEDÍ součet hlasů)'}`);
        } catch (e) {
            log(`magistrat-precincts: okrsek ${row.okrsek} selhal (${e.message})`);
        }
    }

    // Jeden průchod; souběžné spuštění se ignoruje (běží na pozadí)
    async function runPass() {
        if (running) return 0;
        running = true;
        try {
            const rows = countedRows(await loadTurnout()).filter((r) => !done.has(r.okrsek));
            if (rows.length) log(`magistrat-precincts: ${rows.length} nových okrsků ke stažení`);
            await Promise.all(rows.map((r) => limit(async () => {
                if (signal?.aborted) return;
                await fetchOne(r);
            })));
            return rows.length;
        } catch (e) {
            log(`magistrat-precincts: přehled účasti selhal (${e.message})`);
            return 0;
        } finally {
            running = false;
        }
    }
    return { runPass, done };
}

export function parseArgs(argv) {
    const o = { once: false, magPrecincts: false, out: DEFAULT_OUT, intervalMs: MIN_INTERVAL_MS };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--once') o.once = true;
        else if (a === '--magistrat-precincts') o.magPrecincts = true;
        else if (a === '--out') o.out = path.resolve(argv[++i]);
        else if (a === '--interval') o.intervalMs = Math.max(MIN_INTERVAL_MS, Number(argv[++i]) * 1000 || MIN_INTERVAL_MS);
        else throw new Error(`neznámý argument ${a}`);
    }
    return o;
}

export async function main(argv = process.argv.slice(2)) {
    const opts = parseArgs(argv);
    const log = makeLogger(path.join(opts.out, 'record.log'));
    const ac = new AbortController();
    let stopping = false;
    const stop = (sig) => {
        if (stopping) return;
        stopping = true;
        log(`${sig}: ukončuji`);
        ac.abort();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));

    log(`start pid=${process.pid} out=${opts.out} interval=${opts.intervalMs / 1000}s magistrat-precincts=${opts.magPrecincts}`);
    const states = new Map(TARGETS.map((t) => [t.slug, {}]));
    const collector = opts.magPrecincts ? createPrecinctCollector({ outDir: opts.out, log, signal: ac.signal }) : null;

    while (!stopping) {
        const started = Date.now();
        await Promise.all(TARGETS.map((t) => pollOnce({ ...t, outDir: opts.out, log, state: states.get(t.slug), signal: ac.signal })
            .catch((e) => log(`${t.slug}: neočekávaná chyba ${e.message}`))));
        if (collector) collector.runPass().catch((e) => log(`magistrat-precincts: ${e.message}`)); // na pozadí
        if (opts.once) break;
        const wait = Math.max(0, opts.intervalMs - (Date.now() - started));
        await new Promise((r) => {
            const t = setTimeout(r, wait);
            ac.signal.addEventListener('abort', () => {
                clearTimeout(t);
                r();
            }, { once: true });
        });
    }
    log('konec');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
