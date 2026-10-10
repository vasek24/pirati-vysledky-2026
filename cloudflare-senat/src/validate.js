// Kontrola kandidáta na snapshot před publikací (čisté ESM, bez závislosti na
// Cloudflare). Kandidát = normalizovaný + odvozený snapshot (spec §3); tento
// modul rozhoduje, jestli smí nahradit poslední dobrý snapshot ("good").
// Struktura vychází z cloudflare/refresh → src/volby/validate.js (Praha), ale
// kontroly jsou obvodové, ne seznamové. Měkké kontroly (Σ hlasů, jména) tu
// nejsou — žijí v normalize a končí ve `warnings`.
//
//  - validateCandidate: ok | older | rejected (+ quarantinable),
//  - snapshotHash: otisk obsahu bez proměnlivých polí (logy, detekce opakování).
//
// Pořadí (jako v Praze): absolutní kontroly (vždy) → jen při platné baseline:
// older → relativní strukturální změny → regrese obsahu.

const num = (x) => typeof x === 'number' && Number.isFinite(x);

const FUTURE_SKEW_MS = 5 * 60 * 1000;

const rejected = (reason, quarantinable) => ({ outcome: 'rejected', reason, quarantinable });
const OK = { outcome: 'ok', quarantinable: false };

// ---- baseline -----------------------------------------------------------------

/**
 * ctx (povinný, jakmile je good zadán, jinak TypeError):
 *   goodRefreshedAt  epoch ms, kdy byl good naposledy (znovu) ověřen/stažen
 *   pollsCloseR1     epoch ms uzavření místností 1. kola (2026-10-10T14:00+02:00)
 *   base             CSU_BASE tohoto běhu
 *   goodBase         CSU_BASE, se kterým vznikl good
 * ctx.now (nepovinný, epoch ms, čas tohoto stažení): je-li zadán, kandidát s
 *   generatedMs > now + 5 min je hard reject `generated-in-future` (jinak by jeden
 *   soubor s budoucím časem zablokoval všechny další jako `older`). Platí i bez good.
 */
function assertCtx(ctx) {
    if (!ctx || typeof ctx !== 'object'
        || !num(ctx.goodRefreshedAt) || !num(ctx.pollsCloseR1)
        || typeof ctx.base !== 'string' || typeof ctx.goodBase !== 'string') {
        throw new TypeError('validate: ctx { goodRefreshedAt, pollsCloseR1, base, goodBase } is required');
    }
}

// Relativní kontroly (older, počty, regrese) platí jen když good vznikl po
// uzavření místností (vygenerován i ověřen) a se stejnou základnou; jinak
// (testovací/zmrazená data před 14:00, jiná základna) nahradí good první platný
// kandidát.
export function baselineApplies(good, ctx) {
    assertCtx(ctx);
    return !!good && ctx.base === ctx.goodBase
        && ctx.goodRefreshedAt >= ctx.pollsCloseR1
        && num(good.generatedMs) && good.generatedMs >= ctx.pollsCloseR1;
}

// ---- absolutní kontroly (nikdy quarantine — smetí) ------------------------------

const bad = (x) => !num(x) || x < 0;
const badOpt = (x) => x != null && bad(x);

function hardReason(s) {
    if (!s || !num(s.generatedMs)) return 'generated-invalid';
    if (!Array.isArray(s.obvody) || !s.obvody.length) return 'obvody-empty';
    for (const o of s.obvody) {
        if (!Array.isArray(o.candidates) || !o.candidates.length) return 'obvod-no-candidates';
        if (!o.rounds?.[1]) return 'obvod-no-ucast';
        for (const r of [o.rounds[1], o.rounds[2]]) {
            if (!r) continue;
            if (bad(r.okrskyCelkem) || bad(r.okrskyZprac) || badOpt(r.platneHlasy)) return 'negative-or-invalid-number';
            if (r.okrskyZprac > r.okrskyCelkem) return 'counted-out-of-range';
        }
        for (const c of o.candidates) {
            if (bad(c.votes1) || badOpt(c.votes2)) return 'negative-or-invalid-number';
        }
    }
    return null;
}

// ---- relativní kontroly (jen při platné baseline; vše quarantinable) ------------

function structuralReason(s, good) {
    if (s.obvody.length < good.obvody.length) return 'obvody-fewer';
    const byN = new Map(s.obvody.map((o) => [o.n, o]));
    // množina, ne počet: nahrazený / přejmenovaný obvod nesmí projít
    if (good.obvody.some((g) => !byN.has(g.n))) return 'obvody-changed';
    for (const g of good.obvody) {
        const o = byN.get(g.n);
        if (o.candidates.length < g.candidates.length) return 'candidates-fewer';
    }
    return null;
}

// Chybějící údaj se bere jako 0 (zmizelé kolo 2 s hlasy v good je regrese).
const lower = (cand, prev) => (cand ?? 0) < (prev ?? 0);

function regressionReason(s, good) {
    const byN = new Map(s.obvody.map((o) => [o.n, o]));
    for (const g of good.obvody) {
        const o = byN.get(g.n);
        if (!o) continue; // chybějící obvod už zachytila strukturální kontrola
        for (const k of [1, 2]) {
            if (g.rounds?.[k] && lower(o.rounds?.[k]?.okrskyZprac, g.rounds[k].okrskyZprac)) return 'counted-decreased';
        }
        // spáruje se podle čísla na lístku; kandidát, který zmizel (stažení,
        // náhrada), se tu nehodnotí — to je věc strukturální kontroly
        const cands = new Map(o.candidates.map((c) => [c.no, c]));
        for (const gc of g.candidates) {
            const c = cands.get(gc.no);
            // zmizelý kandidát s oficiálním příznakem = zmizelý příznak
            if (!c) {
                if (gc.st1 != null || gc.st2 != null) return 'official-flag-changed';
                continue;
            }
            if (lower(c.votes1, gc.votes1) || lower(c.votes2, gc.votes2)) return 'votes-decreased';
            if ((gc.st1 != null && c.st1 !== gc.st1) || (gc.st2 != null && c.st2 !== gc.st2)) return 'official-flag-changed';
        }
    }
    return null;
}

/**
 * @param {object} candidate  normalizovaný + odvozený snapshot
 * @param {object|null} good  poslední publikovaný snapshot
 * @param {{ goodRefreshedAt: number, pollsCloseR1: number, base: string, goodBase: string, now?: number }} ctx
 * @returns {{ outcome: 'ok'|'older'|'rejected', reason?: string, quarantinable: boolean }}
 *   `quarantinable` je true jen u rejected, který smí po ≥ 3 odlišných stažených
 *   200 přes ≥ 2 min přijmout quarantine (skutečné stažení kandidatury, změna
 *   oficiálního příznaku po opravě ČSÚ); smetí (hard reject) nikdy.
 */
export function validateCandidate(candidate, good, ctx) {
    const hard = hardReason(candidate);
    if (hard) return rejected(hard, false);
    if (ctx && num(ctx.now) && candidate.generatedMs > ctx.now + FUTURE_SKEW_MS) return rejected('generated-in-future', false);
    if (!good) return OK; // studený start: ctx se nevyžaduje
    if (!baselineApplies(good, ctx)) return OK; // ověří i ctx (TypeError)

    if (candidate.generatedMs < good.generatedMs) return { outcome: 'older', quarantinable: false };
    const structural = structuralReason(candidate, good);
    if (structural) return rejected(structural, true);
    const regression = regressionReason(candidate, good);
    if (regression) return rejected(regression, true);
    return OK;
}

// ---- otisk --------------------------------------------------------------------

// Pole, která se mezi dvěma stejnými daty liší (čas generování, meta odpovědi)
const VOLATILE = new Set(['generated', 'generatedMs', 'meta']);

function canonical(v, key) {
    if (Array.isArray(v)) {
        // pořadí varování nesouvisí s daty
        const items = v.map((x) => canonical(x === undefined ? null : x));
        if (key === 'warnings') items.sort();
        return `[${items.join(',')}]`;
    }
    if (v && typeof v === 'object') {
        const keys = Object.keys(v).filter((k) => !VOLATILE.has(k) && v[k] !== undefined).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k], k)}`).join(',')}}`;
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

/** Stabilní otisk obsahu snapshotu bez `generated`/`generatedMs`, `meta` a pořadí `warnings`. */
export function snapshotHash(snapshot) {
    return hash53(canonical(snapshot));
}
