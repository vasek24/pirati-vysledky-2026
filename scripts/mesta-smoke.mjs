// Smoke / verifikace nasazeného produktu „mesta“ (živé výsledky komunálních voleb).
//   node scripts/mesta-smoke.mjs <baseUrl> [--towns=slug,slug] [--concurrency=4] [--json[=soubor]]
// Jen čtení (GET). Šetrné: nejvýš 4 souběžné požadavky a ≥ 100 ms mezi začátky
// požadavků. Proti praha.dg12.cz odmítne běžet. Exit 0 = PASS, 1 = FAIL, 2 = chyba použití.
// Výstup: tabulka po kontrolách (počty + každé selhání doslova) a závěrečný řádek PASS/FAIL.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsuTime } from '../src/volby/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_GAP_MS = 100;
const MAX_CONCURRENCY = 4;
const MAX_BYTES = 1_500_000;
const PHASES = ['pre', 'waiting', 'counting', 'final'];
const MAX_AGE_MS = 30 * 60_000; // starší snapshot = podezřelé (i když je stale)
const MAX_NEXT_MS = 15 * 60_000; // nejdelší plánovaný odstup v refresheru je 10 min
const CLOCK_SKEW_MS = 5 * 60_000;
const PRAGUE_WORDING = ['Magistrát', 'Záložní kopie', 'praha.dg12.cz'];

export const CHECK_NAMES = {
    1: 'Stránky a SPA',
    2: 'API /api/volby',
    3: 'API /api/kraj',
    4: 'Statická data a média',
    5: 'humans / kontakt / version',
    6: 'Pražská slovní zásoba',
    7: 'Odkaz na volby.dg12.cz',
};

// ---- čisté pomocné funkce (testované) ------------------------------------------

export function parseArgs(argv) {
    const out = { baseUrl: null, towns: null, concurrency: MAX_CONCURRENCY, json: false };
    for (const arg of argv) {
        if (arg.startsWith('--towns=')) out.towns = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
        else if (arg.startsWith('--concurrency=')) {
            const n = Number.parseInt(arg.slice(14), 10);
            out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number.isFinite(n) ? n : MAX_CONCURRENCY));
        } else if (arg === '--json') out.json = true;
        else if (arg.startsWith('--json=')) out.json = arg.slice(7) || true;
        else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
        else if (out.baseUrl === null) out.baseUrl = arg;
        else throw new Error(`unexpected argument ${arg}`);
    }
    if (!out.baseUrl) throw new Error('missing <baseUrl>');
    return out;
}

/** Vrátí origin bez lomítka; praha.dg12.cz (i podřízené názvy) a ne-http(s) odmítne. */
export function assertSafeBase(baseUrl) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`unsupported protocol ${url.protocol}`);
    const host = url.hostname.toLowerCase();
    if (host === 'praha.dg12.cz' || host.endsWith('.praha.dg12.cz')) throw new Error('refusing to smoke-test praha.dg12.cz');
    return url.origin;
}

/** Brána: začátky požadavků od sebe nejméně minGapMs, i při souběhu (rezervace slotu je synchronní). */
export function createGate({ minGapMs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    let next = 0;
    return async function gate() {
        const t = now();
        const start = Math.max(t, next);
        next = start + minGapMs;
        if (start > t) await sleep(start - t);
    };
}

/** Spustí fn nad položkami s nejvýš `concurrency` souběžnými voláními; pořadí výsledků = pořadí vstupu. */
export async function runPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let i = 0;
    const worker = async () => {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx], idx);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function checkServerNow(headers, nowMs, problems) {
    if (!('x-cache' in headers)) problems.push('missing x-cache header');
    if (!('x-server-now' in headers)) {
        problems.push('missing x-server-now header');
        return null;
    }
    const sn = Number(headers['x-server-now']);
    if (!Number.isFinite(sn)) {
        problems.push(`x-server-now "${headers['x-server-now']}" is not numeric`);
        return null;
    }
    if (Math.abs(sn - nowMs) > CLOCK_SKEW_MS) problems.push(`x-server-now differs from local clock by ${Math.round((sn - nowMs) / 1000)} s`);
    return sn;
}

/** Kontrola odpovědi /api/volby?z= pro zobrazené město. @returns {string[]} problémy */
export function checkVolby({ council, status, headers = {}, payload, bytes, nowMs = Date.now() }) {
    const problems = [];
    if (status !== 200) problems.push(`status ${status}, expected 200`);
    if (!/application\/json/i.test(headers['content-type'] || '')) problems.push(`content-type "${headers['content-type'] || ''}" is not JSON`);
    if (bytes >= MAX_BYTES) problems.push(`payload ${bytes} B >= ${MAX_BYTES} B`);
    const serverNow = checkServerNow(headers, nowMs, problems);
    if (!isObject(payload)) {
        problems.push('body is not a JSON object');
        return problems;
    }
    if (payload.zastup !== council.zastup) problems.push(`zastup ${payload.zastup} != ${council.zastup}`);
    if (payload.precincts?.total !== council.precincts) problems.push(`precincts.total ${payload.precincts?.total} != ${council.precincts} (towns.generated.json)`);
    if (payload.seats !== council.seats) problems.push(`seats ${payload.seats} != ${council.seats}`);
    if (!parseCsuTime(payload.generated)) problems.push(`generated "${payload.generated}" does not parse with parseCsuTime`);
    if (!PHASES.includes(payload.phase)) problems.push(`phase "${payload.phase}" is not one of ${PHASES.join('|')}`);
    const ref = serverNow ?? nowMs;
    const { refreshedAt, nextRefreshAt } = payload;
    if (!Number.isFinite(refreshedAt)) problems.push(`refreshedAt ${refreshedAt} is not a number`);
    else {
        if (refreshedAt > ref + 10_000) problems.push(`refreshedAt ${new Date(refreshedAt).toISOString()} is in the future`);
        if (ref - refreshedAt > MAX_AGE_MS) problems.push(`refreshedAt ${new Date(refreshedAt).toISOString()} is ${Math.round((ref - refreshedAt) / 60_000)} min old`);
    }
    if (!Number.isFinite(nextRefreshAt)) problems.push(`nextRefreshAt ${nextRefreshAt} is not a number`);
    else if (Number.isFinite(refreshedAt)) {
        if (nextRefreshAt < refreshedAt) problems.push(`nextRefreshAt ${nextRefreshAt} is before refreshedAt ${refreshedAt}`);
        else if (nextRefreshAt - refreshedAt > MAX_NEXT_MS) problems.push(`nextRefreshAt is ${Math.round((nextRefreshAt - refreshedAt) / 1000)} s after refreshedAt`);
    }
    return problems;
}

/** Kontrola /api/kraj?s=. `shard.zastups` = členství z SHARDS, `hidden` = kódy skrytých měst. */
export function checkKraj({ shard, hidden, status, headers = {}, payload, bytes, nowMs = Date.now() }) {
    const problems = [];
    if (status !== 200) problems.push(`status ${status}, expected 200`);
    if (!/application\/json/i.test(headers['content-type'] || '')) problems.push(`content-type "${headers['content-type'] || ''}" is not JSON`);
    if (bytes >= MAX_BYTES) problems.push(`payload ${bytes} B >= ${MAX_BYTES} B`);
    checkServerNow(headers, nowMs, problems);
    if (!isObject(payload) || !isObject(payload.councils)) {
        problems.push('body has no councils object');
        return problems;
    }
    const keys = new Set(Object.keys(payload.councils));
    const expected = new Set(shard.zastups.map(String));
    const missing = [...expected].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !expected.has(k));
    if (missing.length) problems.push(`councils missing: ${missing.join(', ')}`);
    if (extra.length) problems.push(`councils unexpected: ${extra.join(', ')}`);
    const hiddenPresent = hidden.map(String).filter((h) => keys.has(h));
    if (hiddenPresent.length) problems.push(`hidden towns present: ${hiddenPresent.join(', ')}`);
    for (const [z, s] of Object.entries(payload.councils)) {
        if (!isObject(s) || !Number.isFinite(s.counted) || !Number.isFinite(s.total)) problems.push(`council ${z}: summary lacks numeric counted/total`);
        else if (s.counted > s.total) problems.push(`council ${z}: counted ${s.counted} > total ${s.total}`);
    }
    return problems;
}

export function checkLists(council, lists) {
    if (!isObject(lists)) return ['lists.json is not a JSON object'];
    const problems = [];
    if (lists.slug !== council.slug) problems.push(`lists.slug ${JSON.stringify(lists.slug)} != ${JSON.stringify(council.slug)}`);
    if (String(lists.zastup) !== String(council.zastup)) problems.push(`lists.zastup ${lists.zastup} != ${council.zastup}`);
    return problems;
}

/** První logo pirátské kandidátky: { path } | { skip } | { error }. */
export function pirateLogo(council, lists) {
    if (council.pirates == null) return { skip: 'město nemá pirátskou kandidátku' };
    const list = lists?.lists?.find((l) => l.id === council.pirates);
    if (!list) return { error: `pirate list ${council.pirates} not found in lists.json` };
    if (!list.logos?.length) return { error: `pirate list ${council.pirates} has no logos` };
    return { path: list.logos[0] };
}

export function findPragueWording(text) {
    const lower = text.toLowerCase();
    return PRAGUE_WORDING.filter((w) => lower.includes(w.toLowerCase()));
}

export function checkContact(text) {
    return ['Václav Vislous', '+420 777 954 389'].filter((s) => !text.includes(s)).map((s) => `missing "${s}"`);
}

export function checkVersion(text) {
    let version;
    try {
        version = JSON.parse(text)?.version;
    } catch {
        return ['version.json is not JSON'];
    }
    return typeof version === 'string' && version.startsWith('mesta-') ? [] : [`version ${JSON.stringify(version)} does not start with "mesta-"`];
}

export function entryScript(html) {
    return /<script[^>]*type="module"[^>]*src="([^"]+\.js)"/.exec(html)?.[1] ?? null;
}

export function chunkRefs(js) {
    const out = { MestaIndex: [], CouncilApp: [] };
    for (const m of js.matchAll(/\b(MestaIndex|CouncilApp)-[A-Za-z0-9_-]+\.js/g)) if (!out[m[1]].includes(m[0])) out[m[1]].push(m[0]);
    return out;
}

/** Odkaz na front door ve zdroji JSX (`href="…"`) i v minifikovaném kódu (`href:"…"`). */
export function hasBacklink(js) {
    return /href(?:=|:)\s*["']https:\/\/volby\.dg12\.cz["']/.test(js);
}

/** @returns {{pass:boolean, ok:number, fail:number, info:number}} */
export function summarize(results) {
    const fail = results.filter((r) => r.ok === false).length;
    const ok = results.filter((r) => r.ok === true).length;
    return { pass: fail === 0, ok, fail, info: results.length - ok - fail };
}

export function formatReport(results, names = CHECK_NAMES) {
    const lines = [];
    const checks = [...new Set(results.map((r) => r.check))].sort((a, b) => a - b);
    for (const check of checks) {
        const rs = results.filter((r) => r.check === check);
        const s = summarize(rs);
        lines.push(`[${check}] ${(names[check] || '').padEnd(28)} OK ${String(s.ok).padStart(3)}  FAIL ${String(s.fail).padStart(3)}  INFO ${String(s.info).padStart(3)}`);
        for (const r of rs) {
            for (const p of r.problems || []) lines.push(`      FAIL ${r.subject}: ${p}`);
            for (const i of r.info || []) lines.push(`      INFO ${r.subject}: ${i}`);
        }
    }
    const total = summarize(results);
    lines.push('');
    lines.push(total.pass ? `PASS (${total.ok} OK, ${total.info} info)` : `FAIL (${total.fail} selhání, ${total.ok} OK, ${total.info} info)`);
    return lines.join('\n');
}

// ---- registr měst (stejné moduly jako aplikace) --------------------------------

/** ALL_COUNCILS a SHARDS stejně jako src/mesta/councils.js (Node neimportuje JSON, proto přes fs). */
export async function loadRegistry(root = ROOT) {
    const read = (f) => JSON.parse(readFileSync(path.join(root, 'src/mesta', f), 'utf8'));
    const overrides = (await import(pathToFileURL(path.join(root, 'src/mesta/overrides.js')).href)).default;
    const { buildCouncils, deriveShards } = await import(pathToFileURL(path.join(root, 'src/mesta/buildCouncils.js')).href);
    const all = buildCouncils(read('towns.generated.json'), read('specifics.generated.json'), overrides);
    return { all, shown: all.filter((c) => c.shown), hidden: all.filter((c) => !c.shown), shards: deriveShards(all) };
}

// ---- HTTP -----------------------------------------------------------------------

function makeHttp(base, gate) {
    return async function get(pathAndQuery) {
        await gate();
        try {
            const res = await fetch(base + pathAndQuery, {
                headers: { 'user-agent': 'pirati-mesta-smoke/1.0 (QA read-only smoke test)' },
                signal: AbortSignal.timeout(25_000),
            });
            const buf = Buffer.from(await res.arrayBuffer());
            return { status: res.status, headers: Object.fromEntries(res.headers), buf, bytes: buf.length, text: buf.toString('utf8') };
        } catch (error) {
            return { status: 0, headers: {}, buf: Buffer.alloc(0), bytes: 0, text: '', error: String(error?.cause?.code || error?.message || error) };
        }
    };
}

const parseJson = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const rec = (check, subject, problems = [], info = []) => ({ check, subject, ok: problems.length === 0, problems, info });
const infoRec = (check, subject, info) => ({ check, subject, ok: null, problems: [], info });
const reqProblem = (res) => (res.error ? [`request failed: ${res.error}`] : []);
const describe = (res) => (res.error ? `request failed: ${res.error}` : `status ${res.status} ${res.headers['content-type'] || '-'} ${res.bytes} B${res.headers['x-cache'] ? `, x-cache ${res.headers['x-cache']}` : ''}`);

// ---- běh --------------------------------------------------------------------------

export async function run({ baseUrl, towns: onlyTowns = null, concurrency = MAX_CONCURRENCY, root = ROOT, log = () => {} }) {
    const base = assertSafeBase(baseUrl);
    const reg = await loadRegistry(root);
    let shown = reg.shown;
    if (onlyTowns) {
        const unknown = onlyTowns.filter((s) => !reg.shown.some((c) => c.slug === s));
        if (unknown.length) throw new Error(`unknown or hidden town slug(s): ${unknown.join(', ')}`);
        shown = reg.shown.filter((c) => onlyTowns.includes(c.slug));
    }
    const hiddenZ = reg.hidden.map((c) => c.zastup);
    const get = makeHttp(base, createGate({ minGapMs: MIN_GAP_MS }));
    const results = [];
    const push = (r) => results.push(r);
    const startedAt = new Date().toISOString();
    const nowMs = () => Date.now();

    // 1) stránky
    log('1) stránky');
    const index = await get('/');
    push(rec(1, '/', [...reqProblem(index), ...(index.status === 200 ? [] : [`status ${index.status}, expected 200`]), ...(/text\/html/i.test(index.headers['content-type'] || '') ? [] : [`content-type "${index.headers['content-type'] || ''}" is not text/html`])]));
    const unknownPage = await get('/neexistuje-qa-smoke');
    push(rec(1, '/neexistuje-qa-smoke (SPA index)', [...reqProblem(unknownPage), ...(unknownPage.status === 200 ? [] : [`status ${unknownPage.status}, expected 200`]), ...(unknownPage.text === index.text ? [] : ['body differs from /'])]));
    const badApi = await get('/api/volby?z=1');
    push(rec(1, '/api/volby?z=1', [...reqProblem(badApi), ...(badApi.status === 400 ? [] : [`status ${badApi.status}, expected 400`])]));
    await runPool(shown, concurrency, async (c) => {
        const r = await get(`/${c.slug}`);
        const problems = [...reqProblem(r)];
        if (!r.error && r.status !== 200) problems.push(`status ${r.status}, expected 200`);
        if (!r.error && !/text\/html/i.test(r.headers['content-type'] || '')) problems.push(`content-type "${r.headers['content-type'] || ''}" is not text/html`);
        push(rec(1, `/${c.slug}`, problems));
    });
    if (!onlyTowns) {
        for (const c of reg.hidden) {
            const r = await get(`/${c.slug}`);
            // skryté město: stránka nesmí být samostatná (SPA index = nic zvláštního, nebo 404)
            const ok = r.status === 404 || (r.status === 200 && r.text === index.text);
            push({ check: 1, subject: `hidden /${c.slug}`, ok, problems: ok ? [] : [`${describe(r)}; body differs from the SPA index`], info: ok ? [`${describe(r)}; ${r.status === 200 ? 'identical to /' : '404'}`] : [] });
        }
    }

    // 2) /api/volby
    log('2) /api/volby');
    await runPool(shown, concurrency, async (c) => {
        const r = await get(`/api/volby?z=${c.zastup}`);
        const problems = r.error ? reqProblem(r) : checkVolby({ council: c, status: r.status, headers: r.headers, payload: parseJson(r.text), bytes: r.bytes, nowMs: nowMs() });
        push(rec(2, `${c.slug} (${c.zastup})`, problems));
    });
    if (!onlyTowns) {
        for (const c of reg.hidden) {
            const r = await get(`/api/volby?z=${c.zastup}`);
            const body = parseJson(r.text);
            push(infoRec(2, `hidden ${c.slug} (${c.zastup})`, [`${describe(r)}${body ? `, zastup ${body.zastup}, pirates ${JSON.stringify(body.pirates)}` : ''}`]));
        }
    }

    // 3) /api/kraj
    log('3) /api/kraj');
    const shards = onlyTowns ? reg.shards.filter((s) => s.zastups.some((z) => shown.some((c) => c.zastup === z))) : reg.shards;
    const krajTexts = [];
    await runPool(shards, concurrency, async (s) => {
        const r = await get(`/api/kraj?s=${s.id}`);
        krajTexts.push({ id: s.id, text: r.text });
        const problems = r.error ? reqProblem(r) : checkKraj({ shard: s, hidden: hiddenZ, status: r.status, headers: r.headers, payload: parseJson(r.text), bytes: r.bytes, nowMs: nowMs() });
        push(rec(3, `${s.id} (${s.zastups.length} měst)`, problems));
    });

    // 4) statická data a média
    log('4) statická data');
    await runPool(shown, concurrency, async (c) => {
        const problems = [];
        const lr = await get(`/data/${c.slug}/lists.json`);
        const lists = parseJson(lr.text);
        if (lr.status !== 200) problems.push(`lists.json: ${lr.error ? `request failed: ${lr.error}` : `status ${lr.status}`}`);
        else problems.push(...checkLists(c, lists));
        for (const f of ['kandidati.json', 'results2022.json']) {
            const r = await get(`/data/${c.slug}/${f}`);
            if (r.status !== 200) problems.push(`${f}: ${r.error ? `request failed: ${r.error}` : `status ${r.status}`}`);
            else if (!isObject(parseJson(r.text))) problems.push(`${f}: not a JSON object`);
        }
        const info = [];
        const logo = pirateLogo(c, lists);
        if (logo.skip) info.push(logo.skip);
        else if (logo.error) problems.push(`logo: ${logo.error}`);
        else {
            const r = await get(logo.path);
            if (r.status !== 200) problems.push(`logo ${logo.path}: ${r.error ? `request failed: ${r.error}` : `status ${r.status}`}`);
            else if (!/^image\//i.test(r.headers['content-type'] || '')) problems.push(`logo ${logo.path}: content-type "${r.headers['content-type'] || ''}" is not an image`);
        }
        push({ ...rec(4, c.slug, problems), info });
    });
    if (!onlyTowns) {
        for (const c of reg.hidden) {
            const r = await get(`/data/${c.slug}/lists.json`);
            push(infoRec(4, `hidden ${c.slug}`, [`/data/${c.slug}/lists.json: ${describe(r)}`]));
        }
    }

    // 5) humans.txt, kontakt.txt, version.json
    log('5) humans/kontakt/version');
    for (const f of ['humans.txt', 'kontakt.txt']) {
        const r = await get(`/${f}`);
        push(rec(5, `/${f}`, [...reqProblem(r), ...(r.status === 200 ? checkContact(r.text) : [`status ${r.status}, expected 200`])]));
    }
    const ver = await get('/version.json');
    push(rec(5, '/version.json', [...reqProblem(ver), ...(ver.status === 200 ? checkVersion(ver.text) : [`status ${ver.status}, expected 200`])]));

    // 6) pražská slovní zásoba
    push(rec(6, 'HTML /', findPragueWording(index.text).map((w) => `found "${w}"`)));
    for (const k of krajTexts.sort((a, b) => a.id.localeCompare(b.id))) push(rec(6, `/api/kraj?s=${k.id}`, findPragueWording(k.text).map((w) => `found "${w}"`)));

    // 7) odkaz na volby.dg12.cz v JS (SPA vykresluje na klientovi)
    log('7) backlink');
    const entry = entryScript(index.text);
    if (!entry) push(rec(7, 'index.html', ['no module entry script found']));
    else {
        const entryRes = await get(entry);
        if (entryRes.status !== 200) push(rec(7, entry, [`status ${entryRes.status}, expected 200`]));
        else {
            push(infoRec(7, entry, [`entry chunk ${hasBacklink(entryRes.text) ? 'contains' : 'does not contain'} the backlink (not required)`]));
            const refs = chunkRefs(entryRes.text);
            for (const kind of ['MestaIndex', 'CouncilApp']) {
                if (!refs[kind].length) {
                    push(rec(7, kind, [`no ${kind}-*.js chunk referenced from ${entry}`]));
                    continue;
                }
                for (const name of refs[kind]) {
                    const r = await get(`/assets/${name}`);
                    push(rec(7, `/assets/${name}`, r.status !== 200 ? [`status ${r.status}, expected 200`] : hasBacklink(r.text) ? [] : ['no href="https://volby.dg12.cz"']));
                }
            }
        }
    }

    return { baseUrl: base, startedAt, finishedAt: new Date().toISOString(), towns: shown.length, hiddenTowns: reg.hidden.map((c) => c.slug), shards: shards.length, summary: summarize(results), results };
}

// ---- CLI --------------------------------------------------------------------------

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
        assertSafeBase(args.baseUrl);
    } catch (error) {
        console.error(`${error.message}\nUsage: node scripts/mesta-smoke.mjs <baseUrl> [--towns=slug,slug] [--concurrency=4] [--json[=soubor]]`);
        process.exit(2);
    }
    const report = await run({ ...args, log: (m) => console.error(m) }).catch((error) => {
        console.error(error.message);
        process.exit(2);
    });
    const text = `Smoke ${report.baseUrl}: ${report.towns} měst, ${report.shards} shardů, skrytá: ${report.hiddenTowns.join(', ')}\n\n${formatReport(report.results)}`;
    const json = JSON.stringify({ ...report, checks: CHECK_NAMES }, null, 2);
    if (args.json === true) {
        console.error(text);
        console.log(json);
    } else {
        console.log(text);
        if (args.json) writeFileSync(args.json, `${json}\n`);
    }
    process.exit(report.summary.pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();
