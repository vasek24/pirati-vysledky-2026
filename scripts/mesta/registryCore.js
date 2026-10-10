// Jádro generátoru registru "mesta" (čisté funkce, bez sítě a bez zápisu na disk).
// Pravidla: docs/superpowers/specs/2026-10-10-mesta-design.md §4.1 (zařazení) a §6 (přiřazení Pirátů).
import { codes, slugify } from '../lib/util.js';

export const PIRATES_CODE = 720;
export const NK_CODE = 80; // nezávislí kandidáti
export const BAND_AUTO = 10000;
export const BAND_BORDERLINE = 7000;
export const RESERVED_SLUGS = ['api', 'data', 'media', 'assets', 'brand', 'maplibre'];
// Příznaky, které snižují důvěru (skrytí do ověření majitelem), spec §6 pravidlo 5
export const LOW_FLAGS = ['multiple-pirate-lists', 'jmsez-mismatch', 'unknown-partner-code', 'population-band-differs', 'borderline-auto'];

// Sekce seznamu majitele (docs/analysis/mesta-towns.txt) -> KRAJ v registru
export const OWNER_REGION_KRAJ = {
    'Central Bohemia': 2100,
    'South Bohemia': 3100,
    'Plzeň Region': 3200,
    'Karlovy Vary Region': 4100,
    'Ústí nad Labem Region': 4200,
    'Liberec Region': 5100,
    'Hradec Králové Region': 5200,
    'Pardubice Region': 5300,
    'Vysočina Region': 6100,
    'South Moravia': 6200,
    'Olomouc Region': 7100,
    'Zlín Region': 7200,
    'Moravian-Silesian Region': 8100,
};

const collator = new Intl.Collator('cs');
export const czechCompare = (a, b) => collator.compare(a, b);

export function normName(s) {
    return String(s ?? '')
        .normalize('NFC')
        .replace(/[‐‑‒–—―−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseOwnerList(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.includes(':')) continue;
        const i = line.indexOf(':');
        const region = line.slice(0, i).trim();
        for (const part of line.slice(i + 1).split('·')) {
            const name = part.trim();
            if (name) out.push({ region, name });
        }
    }
    return out;
}

// kvrzcoco -> Map<KODZASTUP (číslo), rada>; jen celá zastupitelstva (TYPZASTUP 1) mimo Prahu (DRUHZASTUP 4)
export function wholeCouncils(rows) {
    const out = new Map();
    for (const r of rows) {
        if (r.TYPZASTUP !== '1' || r.DRUHZASTUP === '4') continue;
        const zastup = Number(r.KODZASTUP);
        let c = out.get(zastup);
        if (!c) {
            c = {
                zastup, name: r.NAZEVZAST, kraj: Number(r.KRAJ), okres: Number(r.OKRES), druh: Number(r.DRUHZASTUP),
                population: Number(r.POCOBYV), precincts: 0, seats: Number(r.MANDATY),
            };
            out.set(zastup, c);
        }
        for (let i = 1; i <= 10; i++) {
            const suffix = i < 10 ? `EK${i}` : 'E10';
            const min = Number(r[`MINOKRS${suffix}`]);
            const max = Number(r[`MAXOKRS${suffix}`]);
            if (max > 0) c.precincts += max - min + 1;
        }
    }
    return out;
}

export function matchOwnerTowns(owner, councils) {
    const byName = new Map();
    for (const c of councils.values()) {
        const k = normName(c.name);
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(c);
    }
    const matched = [];
    const unmatched = [];
    const ambiguous = [];
    for (const { region, name } of owner) {
        let cands = byName.get(normName(name)) || [];
        const flags = [];
        if (cands.length > 1) {
            const cities = cands.filter((c) => c.druh === 2 || c.druh === 3);
            if (cities.length === 1) {
                cands = cities;
                flags.push('disambiguated-by-druh');
            }
        }
        if (cands.length === 0) {
            unmatched.push({ region, name });
        } else if (cands.length > 1) {
            ambiguous.push({ region, name, candidates: cands.map((c) => c.zastup).sort((a, b) => a - b) });
        } else {
            const c = cands[0];
            if (c.name !== name.trim()) flags.unshift('dash-normalized');
            const expected = OWNER_REGION_KRAJ[region];
            if (expected !== undefined && expected !== c.kraj) flags.push('kraj-differs-from-owner-list');
            matched.push({ name, region, zastup: c.zastup, flags });
        }
    }
    return { matched, unmatched, ambiguous };
}

// Zobrazované názvy: ořez, jedna mezera, bez mezer uvnitř typografických uvozovek („ X ” -> „X“)
export function cleanName(s) {
    return String(s ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/([„‚]) /g, '$1')
        .replace(/ ([“”‘’])/g, '$1')
        .replace(/([„‚][^„“”‚‘’]*)”/g, '$1“');
}

const KIND_BY_TYPVS = { K: 'coalition', D: 'association' };
const listKey = (r) => `${r.COBVODU}|${r.POR_STR_HL}`;
const personName = (c) => `${c.JMENO} ${c.PRIJMENI}`.trim();

// Spec §6. lists = řádky kvros, candidates = řádky kvrk, cvs/cns = číselníky (pole řádků)
export function classifyTown(zastup, { lists, candidates, cvs, cns }) {
    const z = String(zastup);
    const cvsBy = new Map(cvs.map((r) => [Number(r.VSTRANA), r]));
    const cnsBy = new Map(cns.map((r) => [Number(r.NSTRANA), r]));
    const shortOf = (code) => cnsBy.get(code)?.ZKRATKAN8;
    const flags = [];

    const mine = lists.filter((r) => r.KODZASTUP === z);
    const isPirate = (r) => codes(r.SLOZENI).includes(PIRATES_CODE);
    const pirateLists = mine.filter(isPirate).sort((a, b) => Number(a.POR_STR_HL) - Number(b.POR_STR_HL));
    const chosen = pirateLists[0] || null;
    if (pirateLists.length > 1) flags.push('multiple-pirate-lists');

    const listBy = new Map(mine.map((r) => [listKey(r), r]));
    const valid = candidates.filter((c) => c.KODZASTUP === z && c.PLATNOST === 'A' && c.PSTRANA === String(PIRATES_CODE));
    const members = [];
    const others = [];
    for (const c of valid) {
        const row = listBy.get(listKey(c));
        if (!row) {
            if (!flags.includes('candidate-without-list')) flags.push('candidate-without-list');
            continue;
        }
        if (chosen && row === chosen) {
            members.push({ list: Number(row.POR_STR_HL), n: Number(c.PORCISLO), name: personName(c) });
        } else {
            others.push({
                list: Number(row.POR_STR_HL), listName: cleanName(row.NAZEVCELK), n: Number(c.PORCISLO), name: personName(c),
                nominatedBy: c.NSTRANA ? shortOf(Number(c.NSTRANA)) ?? c.NSTRANA : '',
            });
        }
    }
    const nominatedNonMembers = chosen
        ? candidates.filter((c) => c.KODZASTUP === z && c.PLATNOST === 'A' && listKey(c) === listKey(chosen)
            && c.NSTRANA === String(PIRATES_CODE) && c.PSTRANA !== String(PIRATES_CODE)).length
        : 0;
    members.sort((a, b) => a.n - b.n);
    others.sort((a, b) => a.list - b.list || a.n - b.n);

    if (!chosen) return { type: others.length ? 'c' : 'd', list: null, members: [], others, flags };

    const vstrana = Number(chosen.VSTRANA);
    const comp = codes(chosen.SLOZENI);
    const partners = comp.filter((c) => c !== PIRATES_CODE && c !== NK_CODE).map((code) => {
        const short = shortOf(code);
        if (short === undefined) flags.push('unknown-partner-code');
        return { code, short: short ?? String(code) };
    });
    const independents = comp.includes(NK_CODE);
    const type = vstrana === PIRATES_CODE ? 'a' : 'b';
    const kind = type === 'a'
        ? 'party'
        : KIND_BY_TYPVS[cvsBy.get(vstrana)?.TYPVS] || (partners.length ? 'coalition' : 'association');
    if (type === 'b' && normName(chosen.NAZEVCELK) === 'česká pirátská strana') flags.push('named-cps-but-association');
    if (!members.length) flags.push('no-members-on-pirate-list');
    if (others.length) flags.push('also-on-other-lists');

    return {
        type,
        list: {
            id: Number(chosen.POR_STR_HL), name: cleanName(chosen.NAZEVCELK), short: cleanName(chosen.ZKRATKAO30), short8: cleanName(chosen.ZKRATKAO8),
            vstrana, kind, partners, independents, nominatedNonMembers,
        },
        members,
        others,
        flags,
    };
}

// Jedno desetinné místo, zaokrouhlení půl nahoru z (opraveného) zdrojového čísla: 8.35 -> '8,4', 6.65 -> '6,7'
function commaDecimal(v) {
    const tenths = Math.round(Number((v * 10).toFixed(6)));
    return `${Math.floor(tenths / 10)},${tenths % 10}`;
}

// ctx: { ownerList:Set<zastup>, okresNames:Map<okres,název>, senateNames:Set<název>, pirates2022:Map<zastup,{pct,seats}>, override? }
export function borderlineReasons(town, ctx) {
    const out = [];
    const name = normName(town.name);
    if (ctx.ownerList?.has(town.zastup)) out.push({ code: 'owner-list', text: 'na seznamu majitele', automatic: false });
    const okresName = ctx.okresNames?.get(town.okres);
    if (okresName && normName(okresName) === name) out.push({ code: 'okres-seat', text: `sídlo okresu ${okresName}`, automatic: true });
    if ((town.druh === 2 || town.druh === 3) && [...(ctx.senateNames || [])].some((n) => normName(n) === name)) {
        out.push({ code: 'senate-seat-2026', text: 'sídlo senátního obvodu (volby 2026)', automatic: true });
    }
    const p = ctx.pirates2022?.get(town.zastup);
    if (p && (p.pct >= 10 || p.seats >= 1)) {
        out.push({
            code: 'pirates-2022', text: `Piráti 2022: ${commaDecimal(p.pct)} %, ${p.seats} mand.`, automatic: true,
        });
    }
    if (ctx.override?.borderlineReason) out.push({ code: 'manual', text: ctx.override.borderlineReason, automatic: false });
    return out;
}

// Spec §4.1. Pásmo se bere jen z `town.population` (POCOBYV).
export function decideInclusion(town, { type, reasons = [], override }) {
    const flags = [];
    const n = town.population;
    if (override?.include === false) return { inclusion: 'excluded', reason: `override include:false: ${override.reason ?? override.note ?? ''}`.trim(), flags };
    if (override?.include === true) return { inclusion: 'forced', reason: `override include:true: ${override.reason ?? override.note ?? ''}`.trim(), flags };
    if (n < BAND_BORDERLINE) return { inclusion: 'excluded', reason: `population ${n}`, flags };
    if (type === 'c' || type === 'd') return { inclusion: 'excluded', reason: `type ${type}`, flags };
    if (n >= BAND_AUTO) return { inclusion: 'auto', reason: `population ${n}, type ${type}`, flags };
    if (!reasons.length) return { inclusion: 'borderline-excluded', reason: 'borderline, no reason', flags };
    if (reasons.every((r) => r.automatic)) flags.push('borderline-auto');
    return { inclusion: 'borderline-included', reason: reasons.map((r) => r.text).join('; '), flags };
}

export const confidenceOf = (flags) => (flags.some((f) => LOW_FLAGS.includes(f)) ? 'low' : 'high');

const byKrajName = (a, b) => a.kraj - b.kraj || czechCompare(a.name, b.name) || (a.zastup ?? 0) - (b.zastup ?? 0);

// Kraj s n městy -> ceil(n/8) téměř stejně velkých shardů `<kraj/100>-<i>`; města podle českého řazení
export function assignShards(published) {
    const sorted = [...published].sort(byKrajName);
    const out = [];
    const byKraj = new Map();
    for (const t of sorted) {
        if (!byKraj.has(t.kraj)) byKraj.set(t.kraj, []);
        byKraj.get(t.kraj).push(t);
    }
    for (const [kraj, towns] of byKraj) {
        const parts = Math.ceil(towns.length / 8);
        const base = Math.floor(towns.length / parts);
        const extra = towns.length % parts;
        let at = 0;
        for (let i = 0; i < parts; i++) {
            const size = base + (i < extra ? 1 : 0);
            for (const t of towns.slice(at, at + size)) out.push({ ...t, shard: `${kraj / 100}-${i + 1}` });
            at += size;
        }
    }
    return out;
}

// `count` nejlidnatějších měst: první polovina `top-1`, druhá `top-2`
export function assignFeatured(published, count = 12) {
    // skrytá (low) města by zabrala místo v top-1/top-2, které pak nikdo neuvidí
    const ranked = published.filter((t) => t.confidence !== 'low').sort((a, b) => b.population - a.population || czechCompare(a.name, b.name));
    const half = Math.ceil(count / 2);
    const feat = new Map(ranked.slice(0, count).map((t, i) => [t, i < half ? 'top-1' : 'top-2']));
    return published.map((t) => ({ ...t, featured: feat.get(t) ?? null }));
}

export function disambiguateSlugs(published, okresNames) {
    const base = published.map((t) => t.slug || slugify(t.name));
    const counts = new Map();
    for (const s of base) counts.set(s, (counts.get(s) || 0) + 1);
    const out = published.map((t, i) => {
        if (counts.get(base[i]) < 2) return { ...t, slug: base[i], flags: [...(t.flags || [])] };
        const okres = slugify(okresNames.get(t.okres) ?? String(t.okres));
        return { ...t, slug: `${base[i]}-${okres}`, flags: [...(t.flags || []), 'slug-disambiguated'] };
    });
    const seen = new Set();
    for (const t of out) {
        if (RESERVED_SLUGS.includes(t.slug)) throw new Error(`reserved slug "${t.slug}" (${t.name})`);
        if (seen.has(t.slug)) throw new Error(`duplicate slug "${t.slug}" (${t.name}) even with the okres suffix`);
        seen.add(t.slug);
    }
    return out;
}

const spaced = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Důvod pro vyhledávání na indexu (spec §4.2): { reason: kód, text: česká věta }
export function excludedReason({ type, population, inclusion, reason }) {
    const manual = /^override include:false: ?/.exec(reason || '');
    if (manual) return { reason: 'override', text: `Vyřazeno ručně: ${reason.slice(manual[0].length)}` };
    if (type === 'd') return { reason: 'no-pirate-list', text: 'Piráti tu nekandidují (podle registru ČSÚ)' };
    if (type === 'c') return { reason: 'other-lists-only', text: 'Piráti tu jsou jen na kandidátkách jiných stran' };
    if (inclusion === 'borderline-excluded') {
        return {
            reason: 'borderline-no-reason',
            text: `Piráti tu kandidují, ale město má méně než 10 000 obyvatel (${spaced(population)}) a nezařadili jsme ho`,
        };
    }
    return { reason: 'below-10k', text: `Piráti tu kandidují, ale město má jen ${spaced(population)} obyvatel` };
}

// entries: [{ council:{zastup,name,okres,kraj,krajName,population}, type, inclusion, reason, onOwnerList }]
export function buildExcluded(entries) {
    return entries
        .filter((e) => (e.inclusion === 'excluded' || e.inclusion === 'borderline-excluded')
            && (e.council.population >= BAND_BORDERLINE || e.onOwnerList))
        .map((e) => ({
            zastup: e.council.zastup, name: e.council.name, okres: e.council.okres,
            ...excludedReason({ type: e.type, population: e.council.population, inclusion: e.inclusion, reason: e.reason }),
            kraj: e.council.kraj, krajName: e.council.krajName, population: e.council.population, inclusion: e.inclusion,
        }))
        .sort((a, b) => czechCompare(a.name, b.name) || a.zastup - b.zastup);
}

const OVERRIDE_KEYS = ['name', 'include', 'reason', 'borderlineReason', 'type', 'pirates', 'list', 'pirateCandidates', 'note', 'lists', 'title', 'confidence', 'reviewed'];
const NEEDS_WHY = ['include', 'type', 'list', 'pirateCandidates'];
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const filled = (v) => typeof v === 'string' && v.trim() !== '';

// Vrací pole chyb (prázdné = platné). Spec §4.3. S `councils` se kontroluje i KODZASTUP a název.
export function validateOverrides(overrides, { councils } = {}) {
    const errors = [];
    const ra = overrides?.reviewedAt;
    if (ra !== null && !(typeof ra === 'string' && ISO.test(ra) && !Number.isNaN(Date.parse(ra)))) {
        errors.push('reviewedAt must be null or an ISO date');
    }
    const towns = overrides?.towns;
    if (!towns || typeof towns !== 'object' || Array.isArray(towns)) return [...errors, 'towns must be an object keyed by KODZASTUP'];
    for (const [key, o] of Object.entries(towns)) {
        const at = `towns[${key}]`;
        if (!/^\d+$/.test(key)) errors.push(`${at}: key must be a KODZASTUP string`);
        if (!o || typeof o !== 'object') { errors.push(`${at}: must be an object`); continue; }
        if (!filled(o.name)) errors.push(`${at}: name is required`);
        for (const k of Object.keys(o)) if (!OVERRIDE_KEYS.includes(k)) errors.push(`${at}: unknown key ${k}`);
        if ('pirates' in o) errors.push(`${at}: pirates must not be set (derived from list.id)`);
        if ('include' in o && typeof o.include !== 'boolean') errors.push(`${at}: include must be boolean`);
        if ('reviewed' in o && typeof o.reviewed !== 'boolean') errors.push(`${at}: reviewed must be boolean`);
        if ('borderlineReason' in o && !filled(o.borderlineReason)) errors.push(`${at}: borderlineReason must be a non-empty string`);
        if ('type' in o && !['a', 'b', 'c', 'd'].includes(o.type)) errors.push(`${at}: type must be a, b, c or d`);
        if (NEEDS_WHY.some((k) => k in o) && !filled(o.reason) && !filled(o.note)) {
            errors.push(`${at}: ${NEEDS_WHY.filter((k) => k in o).join('/')} needs a reason or note`);
        }
        if ('confidence' in o) {
            if (!['low', 'high'].includes(o.confidence)) errors.push(`${at}: confidence must be low or high`);
            else if (o.confidence === 'low' && !filled(o.note)) errors.push(`${at}: confidence low needs a note`);
        }
        if (councils && filled(o.name)) {
            const c = councils.get(Number(key));
            if (!c) errors.push(`${at}: unknown KODZASTUP`);
            else if (c.name !== o.name) errors.push(`${at}: name "${o.name}" differs from registry "${c.name}"`);
        }
    }
    return errors;
}
