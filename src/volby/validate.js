// Sloučení a kontrola kandidáta na snapshot před publikací (čisté ESM, bez
// závislosti na Cloudflare — používá ho cloudflare/refresh.js). Kandidát
// vzniká během jednoho běhu feedu (feed.js / overview.js); tento modul
// rozhoduje, jestli smí nahradit poslední dobrý snapshot ("good").
//
//  - mergeCandidate: doplní z good to, co build jen dočasně nestihl
//    (okrskové hlasy, souhrny zastupitelstev), a řekne, jestli je výsledek úplný,
//  - validateCandidate: ok | older (zpožděná replika ČSÚ) | rejected,
//  - snapshotHash: otisk obsahu bez proměnlivých polí (logy, detekce opakování).
//
// Všechna porovnání `generated` jdou přes parseCsuTime (čas ČSÚ je bez zóny).
import { parseCsuTime } from './format.js';
import { composeOverview } from './overview.js';

const hasVotes = (o) => !!o && !!o.votes;
const sameRow = (a, b) => a.voters === b.voters && a.envelopes === b.envelopes && a.validVotes === b.validVotes;
const genMs = (s) => parseCsuTime(s)?.getTime() ?? null;

// ---- merge --------------------------------------------------------------------

function mergeCouncil(candidate, good) {
    const okrsky = { ...candidate.okrsky };
    let complete = true;
    for (const [id, g] of Object.entries(good.okrsky || {})) {
        const c = okrsky[id];
        if (c && !hasVotes(c) && hasVotes(g) && sameRow(c, g)) okrsky[id] = { ...c, votes: g.votes };
        // okrsek je v kandidátovi přítomen bez hlasů, v good je měl a doplnit
        // nešly (změněný řádek bez okrskového souboru) → nekompletní.
        // Okrsek, který z kandidáta ZMIZEL, se nedoplňuje ani není nekompletní:
        // padne na precincts-fewer (rejected), aby ho quarantine mohla přijmout
        // jako skutečné stažení okrsku.
        if (okrsky[id] && hasVotes(g) && !hasVotes(okrsky[id])) complete = false;
    }
    return { merged: { ...candidate, okrsky }, complete };
}

function mergeOverview(candidate, good) {
    const councils = { ...candidate.councils };
    let copied = 0;
    let complete = true;
    for (const [z, g] of Object.entries(good.councils || {})) {
        const c = councils[z];
        const cg = c && genMs(c.generated);
        const gg = genMs(g.generated);
        // chybějící souhrn, nebo souhrn ze zpožděné repliky (starší než v good):
        // drží se good, ostatní zastupitelstva se přesto publikují
        if (!c || (cg !== null && gg !== null && cg < gg)) {
            councils[z] = g;
            copied++;
        } else if (g.parties?.length && !c.parties?.length) {
            complete = false;
        }
    }
    if (!copied) return { merged: { ...candidate, councils }, complete };
    // Souhrny za přehled (okrsky, generated, phase) se odvozují ze všech
    // zastupitelstev; bez přepočtu by chybějící zastupitelstvo snížilo součet
    // a vypadalo by to jako regrese. `official` smí být true jen když byl
    // i kandidát, nebo good (ten obsahoval všechna očekávaná zastupitelstva a
    // sloučená množina je obsahuje také — jinak by `final` při zpožděné replice
    // jednoho souboru přeskočil zpět na counting). expected = Infinity jinak
    // official i phase 'final' vylučuje.
    const composed = composeOverview(councils, {
        now: Date.parse(candidate.fetchedAt) || Date.now(),
        expected: candidate.official || good.official ? Object.keys(councils).length : Infinity,
    });
    return {
        merged: {
            ...candidate,
            councils,
            generated: composed.generated,
            phase: composed.phase,
            precincts: composed.precincts,
            official: composed.official,
        },
        complete,
    };
}

// Monotónní (relativní) kontroly a doplňování z good platí jen když good
// vznikl po uzavření místností (stažen i vygenerován) a se stejným CSU_BASE; jinak (testovací data
// před 14:00, jiná základna) nahradí good první platný kandidát po 14:00.
function assertCtx(ctx) {
    if (!ctx || typeof ctx !== 'object'
        || !Number.isFinite(ctx.goodRefreshedAt) || !Number.isFinite(ctx.pollsClose)
        || typeof ctx.base !== 'string' || typeof ctx.goodBase !== 'string') {
        throw new TypeError('validate: ctx { goodRefreshedAt, pollsClose, base, goodBase } is required');
    }
}

export function baselineApplies(good, ctx) {
    assertCtx(ctx);
    if (!good || ctx.base !== ctx.goodBase || ctx.goodRefreshedAt < ctx.pollsClose) return false;
    // i vlastní čas generování good musí být po 14:00: webcache ČSÚ může po
    // 14:00 ještě chvíli vracet testovací data, která se nesmí stát baseline
    const generated = genMs(good.generated);
    return generated !== null && generated >= ctx.pollsClose;
}

/**
 * @param {object} candidate  snapshot z feedu
 * @param {object|null} good  poslední publikovaný snapshot
 * @param {'council'|'overview'} kind
 * @param {object} ctx  stejný ctx jako ve validateCandidate; povinný, když
 *   je good zadán (jinak TypeError). Když baseline neplatí, good se ignoruje
 *   (jinak by reset testovacích dat po 14:00 byl "nekompletní").
 * @returns {{ merged: object, complete: boolean }}
 */
export function mergeCandidate(candidate, good, kind, ctx) {
    if (!good) return { merged: candidate, complete: true };
    if (!baselineApplies(good, ctx)) return { merged: candidate, complete: true };
    return kind === 'overview' ? mergeOverview(candidate, good) : mergeCouncil(candidate, good);
}

// ---- validace -----------------------------------------------------------------

const reject = (reason) => ({ outcome: 'rejected', reason });
const OK = { outcome: 'ok' };

// Absolutní strukturální kontroly — platí vždy (i bez good a mimo baseline)
function structuralReason(s, overview) {
    if (!s.generated) return 'generated-null';
    if (genMs(s.generated) === null) return 'generated-invalid';
    const outOfRange = ({ counted, total }) => !(counted >= 0) || counted > total;
    if (overview) {
        const councils = Object.values(s.councils || {});
        if (!councils.length) return 'councils-empty';
        if (councils.some((c) => !c.parties?.length)) return 'council-parties-empty';
        if (outOfRange(s.precincts) || councils.some(outOfRange)) return 'counted-out-of-range';
        return null;
    }
    if (!s.parties?.length) return 'parties-empty';
    if (outOfRange(s.precincts)) return 'counted-out-of-range';
    return null;
}

// [id, hlasy, mandáty] (souhrn přehledu) nebo { id, votes } (zastupitelstvo)
const votesById = (parties, overview) => new Map(parties.map((p) => (overview ? [p[0], p[1]] : [p.id, p.votes])));

function regressedVotes(candParties, goodParties, overview) {
    const cand = votesById(candParties, overview);
    for (const [id, votes] of votesById(goodParties, overview)) {
        if ((cand.get(id) ?? 0) < votes) return true;
    }
    return false;
}

function validateCouncil(s, good) {
    if (s.parties.length < good.parties.length) return reject('parties-fewer');
    if (Object.keys(s.okrsky || {}).length < Object.keys(good.okrsky || {}).length) return reject('precincts-fewer');
    if (s.precincts.counted < good.precincts.counted) return reject('counted-decreased');
    if (regressedVotes(s.parties, good.parties, false)) return reject('votes-decreased');
    return OK;
}

function validateOverview(s, good) {
    // zpožděné repliky jednotlivých souhrnů řeší už mergeOverview (drží good)
    for (const [z, g] of Object.entries(good.councils || {})) {
        const c = s.councils[z];
        if (c && c.parties.length < g.parties.length) return reject('council-parties-fewer');
    }
    if (s.precincts.counted < good.precincts.counted) return reject('counted-decreased');
    for (const [z, g] of Object.entries(good.councils || {})) {
        const c = s.councils[z];
        if (!c) continue;
        if (c.counted < g.counted) return reject('counted-decreased');
        if (regressedVotes(c.parties, g.parties, true)) return reject('votes-decreased');
    }
    return OK;
}

/**
 * Pořadí: absolutní strukturální kontroly → (jen při platné baseline) older →
 * relativní strukturální kontroly a regrese obsahu. `older` jde před kontroly
 * "méně stran/okrsků než good", protože zpožděná replika má přirozeně méně
 * okrsků a nesmí skončit jako rejected (stale + backoff).
 * U přehledu se zpožděné souhrny řeší už v mergeOverview (drží se good), takže
 * `older` tam z top-level generated nikdy nevznikne (sloučené max >= good).
 *
 * @param {object} merged  výsledek mergeCandidate
 * @param {object|null} good
 * @param {{ now: number, pollsClose: number, goodRefreshedAt: number, base: string, goodBase: string }} ctx
 * @returns {{ outcome: 'ok'|'older'|'rejected', reason?: string }}
 */
export function validateCandidate(merged, good, ctx) {
    const overview = !!merged.councils;
    const structural = structuralReason(merged, overview);
    if (structural) return reject(structural);
    if (!good) return OK; // studený start: ctx se nevyžaduje (jako v mergeCandidate)
    if (!baselineApplies(good, ctx)) return OK; // ověří i ctx (TypeError)

    const cand = genMs(merged.generated);
    const prev = genMs(good.generated);
    if (cand !== null && prev !== null && cand < prev) return { outcome: 'older' };
    return overview ? validateOverview(merged, good) : validateCouncil(merged, good);
}

// ---- otisk --------------------------------------------------------------------

// Pole, která se mezi dvěma stejnými daty liší (čas generování/stažení, fáze,
// počítadla buildu) nebo patří k odpovědi, ne k datům
const VOLATILE = new Set([
    'generated', 'fetchedAt', 'phase', 'missing', 'fetchId',
    'refreshedAt', 'nextRefreshAt', 'servedAt', 'stale', 'complete', 'refreshing',
]);

function canonical(v) {
    if (Array.isArray(v)) return `[${v.map((x) => canonical(x === undefined ? null : x)).join(',')}]`;
    if (v && typeof v === 'object') {
        const keys = Object.keys(v).filter((k) => !VOLATILE.has(k) && v[k] !== undefined).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}

// cyrb53 — 53bitový nekryptografický otisk, na logy a detekci opakování stačí
function hash53(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Stabilní otisk obsahu snapshotu bez `generated` (na všech úrovních) a bez proměnlivých polí. */
export function snapshotHash(snapshot) {
    return hash53(canonical(snapshot));
}
