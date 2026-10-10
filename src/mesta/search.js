// Hledání měst na indexu mesta.dg12.cz (čistá logika, bez Reactu a bez importu
// ./councils.js — město, seznam obcí mimo přehled i tabulku tvarů dostává jako
// argument). Port ověřeného prototypu docs/analysis/mesta-index-prototype.
//
// Normalizace: NFD, bez diakritiky, malá písmena, oddělovače → mezera. Dotaz se
// zkouší tak, jak je, i bez jedné úvodní předložky („v Plzni" → „plzni").
// Pořadí: 0 přesný název · 1 začátek názvu nebo přesný tvar z aliasů · 2 začátek slova · 3 začátek
// tvaru z aliasů / zkratka z počátečních písmen (jen přesná shoda) · 4 slovo okresu ·
// 5 podřetězec (od 3 znaků) · 6 překlep (jen když nic lepšího není). Při shodě
// pořadí: zobrazené město před obcí mimo přehled, pak víc obyvatel. Za města se
// přidá jeden kraj, jehož slovo začíná dotazem (od 3 znaků).

export const MAX_QUERY = 60;
export const PRAGUE_URL = 'https://praha.dg12.cz';
export const praguePageUrl = PRAGUE_URL;

export const norm = (s) =>
    String(s ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[‐-―\-_.,/()"'„“”‚‘’]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export const foldCz = norm;

const PREP = /^(?:v|ve|z|ze|do|na|u|k|ke|pro|o|po|za)\s+(?=\S{2})/;
export const stripPrep = (q) => q.replace(PREP, '');

// Damerau (optimal string alignment) vzdálenost
export function osa(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const c = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

const INITIAL_STOP = new Set(['nad', 'pod', 'na', 'u', 'v']);
export const VERIFY_NOTE = 'Způsob kandidatury Pirátů ještě ověřujeme';

// Důvod, proč obec není v přehledu: `text` z excluded.generated.json, jinak podle
// `reason` ('no-pirate-list' | 'other-lists-only' | 'below-10k' | 'borderline-no-reason'
// | 'override'; tolerantně i 'type d' / 'type c' / 'population N')
const NO_LIST_NOTE = 'Piráti tu letos nemají vlastní ani koaliční kandidátku';
const OTHER_LISTS_NOTE = 'Piráti tu jsou jen na kandidátkách jiných stran — přehled je nezahrnuje';
const BELOW_NOTE = 'Pod 10 000 obyvatel — přehled je zatím nezahrnuje';
export function excludedNote(e) {
    if (e.text) return e.text;
    const r = String(e.reason ?? '');
    if (/no-pirate-list|type d/.test(r)) return NO_LIST_NOTE;
    if (/other-lists-only|type c/.test(r)) return OTHER_LISTS_NOTE;
    if (/below-10k|borderline|population/.test(r)) return BELOW_NOTE;
    return 'Přehled tuto obec zatím nezahrnuje';
}

const words = (n) => ` ${n}`;

function base(name, extra) {
    const n = norm(name);
    return { name, n, words: words(n), aliases: [], initials: null, okresName: null, on: '', onWords: ' ', population: 0, ...extra };
}

// towns = COUNCILS (jen zobrazená města) · aliases = default z aliases.js ·
// excluded = excluded.generated.json · unverified = skrytá města (ALL_COUNCILS
// bez zobrazených): vyhledají se jen jako neklikací „ověřujeme"
export function buildIndex(towns, aliases = {}, excluded = [], { unverified = [], praha = true } = {}) {
    const entries = [];
    const krajMap = new Map();
    for (const c of towns) {
        const a = aliases[String(c.zastup)];
        const own = a && norm(a.name) === norm(c.name) ? a : null; // `name` hlídá překlep v klíči
        const okresName = own?.okres ?? null;
        entries.push(
            base(c.name, {
                kind: 'town',
                zastup: c.zastup,
                slug: c.slug,
                kraj: c.kraj,
                krajName: c.krajName,
                okresName,
                on: okresName ? norm(okresName) : '',
                onWords: okresName ? words(norm(okresName)) : ' ',
                aliases: (own?.forms ?? []).map(norm),
                population: c.population ?? 0,
            }),
        );
        if (!krajMap.has(c.kraj)) {
            const n = norm(c.krajName);
            krajMap.set(c.kraj, { kraj: c.kraj, name: c.krajName, n, words: n.split(' ').filter((w) => w !== 'kraj'), count: 0 });
        }
        krajMap.get(c.kraj).count += 1;
    }
    // zkratky z počátečních písmen (ČB, HK, KV…): 2–3 významná slova, jen jednoznačné
    const seen = new Map();
    for (const e of entries) {
        const w = e.n.split(' ').filter((x) => !INITIAL_STOP.has(x));
        if (w.length >= 2 && w.length <= 3) {
            e.initials = w.map((x) => x[0]).join('');
            seen.set(e.initials, (seen.get(e.initials) || 0) + 1);
        }
    }
    for (const e of entries) if (e.initials && seen.get(e.initials) > 1) e.initials = null;

    for (const x of excluded) {
        entries.push(base(x.name, { kind: 'other', zastup: x.zastup, note: excludedNote(x), population: x.population ?? 0, krajName: x.krajName ?? null }));
    }
    for (const x of unverified) entries.push(base(x.name, { kind: 'verify', zastup: x.zastup, note: VERIFY_NOTE }));
    if (praha) {
        entries.push(base('Praha', { kind: 'other', note: 'Praha má vlastní přehled', url: PRAGUE_URL, aliases: ['praze', 'prahy'].map(norm) }));
    }
    return { entries, kraje: [...krajMap.values()].sort((a, b) => a.kraj - b.kraj) };
}
export const buildSearchIndex = buildIndex;

function tierOf(e, q) {
    if (e.n === q) return 0;
    if (e.kind === 'other' && e.url && e.name === 'Praha' && /^praha (\d|[a-z]{1,3}$)/.test(q)) return 0;
    // přesný tvar z tabulky („Brna", „Mostě") je jistější než slovo uvnitř jiného názvu („Slavkov u Brna")
    if (e.n.startsWith(q) || e.aliases.includes(q)) return 1;
    if (q.length >= 2 && e.words.includes(` ${q}`)) return 2;
    if (e.aliases.some((a) => (a.length > 3 && q.length >= 3 && a.startsWith(q))) || (e.initials && e.initials === q)) return 3;
    if (e.kind === 'town' && q.length >= 3 && e.onWords.includes(` ${q}`)) return 4;
    if (q.length >= 3 && e.n.includes(q)) return 5;
    if (q.length >= 4) {
        const max = q.length >= 7 ? 2 : 1;
        for (const L of [q.length - 1, q.length, q.length + 1]) {
            const part = e.n.slice(0, L);
            // vzdálenost je aspoň rozdíl délek — drahý výpočet jen pro možné shody
            if (L > 0 && Math.abs(q.length - part.length) <= max && osa(q, part) <= max) return 6;
        }
    }
    return 99;
}

const rank = (e) => (e.kind === 'town' ? 0 : 1);

function toItem(e, tier) {
    if (e.kind === 'town') {
        return {
            kind: 'town', tier, zastup: e.zastup, slug: e.slug, name: e.name, kraj: e.kraj, krajName: e.krajName, okres: e.okresName, population: e.population,
            label: e.okresName ? `${e.name} (${e.okresName})` : e.name,
            sub: [e.okresName && `okres ${e.okresName}`, e.krajName].filter(Boolean).join(' · '),
        };
    }
    if (e.kind === 'verify') return { kind: 'verify', tier, zastup: e.zastup, name: e.name, note: e.note };
    return { kind: 'other', tier, zastup: e.zastup, name: e.name, note: e.note, ...(e.url ? { url: e.url } : {}) };
}

// → { items, total, fuzzy }; items ≤ limit včetně jednoho kraje na konci
export const DISTRICT_NOTE = 'výsledky zastupitelstva celého města; městské části nesledujeme';

// Nic nenalezeno a dotaz začíná celým názvem města („Brno-střed", „Ostrava Poruba"):
// ukáže se to město s poznámkou, že sledujeme zastupitelstvo celého města
function districtFallback(index, qs) {
    for (const q of qs) {
        const w = q.split(' ');
        for (let k = w.length - 1; k >= 1; k--) {
            const head = w.slice(0, k).join(' ');
            const e = index.entries.find((x) => x.kind === 'town' && (x.n === head || x.aliases.includes(head)));
            if (e) return { ...toItem(e, 0), sub: DISTRICT_NOTE, district: true };
        }
    }
    return null;
}

export function search(index, input, { limit = 6 } = {}) {
    const q0 = norm(input).slice(0, MAX_QUERY).trim();
    if (!q0) return { items: [], total: 0, fuzzy: false };
    const qs = [q0];
    const q1 = stripPrep(q0);
    if (q1 !== q0) qs.push(q1);
    const hits = [];
    for (const e of index.entries) {
        const tier = Math.min(...qs.map((q) => tierOf(e, q)));
        if (tier < 99) hits.push({ e, tier });
    }
    hits.sort((a, b) => a.tier - b.tier || rank(a.e) - rank(b.e) || b.e.population - a.e.population || a.e.name.localeCompare(b.e.name, 'cs'));
    // překlepy jen, když nic lepšího není
    const best = hits.length ? hits[0].tier : 99;
    const pool = best < 6 ? hits.filter((h) => h.tier < 6) : hits;
    const kq = qs[qs.length - 1];
    const kraj = kq.length >= 3 ? index.kraje.find((r) => r.n.startsWith(kq) || r.words.some((w) => w.startsWith(kq))) : null;
    const items = pool.slice(0, limit - (kraj ? 1 : 0)).map((h) => toItem(h.e, h.tier));
    if (kraj) items.push({ kind: 'kraj', tier: 7, kraj: kraj.kraj, name: kraj.name, count: kraj.count });
    // nic (nebo jen překlep) a dotaz začíná celým názvem města → to město s poznámkou
    if (!items.length || best === 6) {
        const d = districtFallback(index, qs);
        if (d) return { items: [d], total: 1, fuzzy: false, district: true };
    }
    return { items, total: pool.length + (kraj ? 1 : 0), fuzzy: best === 6 };
}
export const searchTowns = (index, query, limit = 6) => search(index, query, { limit });
