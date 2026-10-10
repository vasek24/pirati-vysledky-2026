// Generátor registru produktu "mesta": z open dat ČSÚ spočítá, která města se zveřejní a jak v nich Piráti kandidují.
//   node scripts/mesta-registry.js [--fresh] [--no-jmsez]
// Zapisuje src/mesta/{towns,specifics,excluded}.generated.json, docs/analysis/mesta-{specifics,list-verification}.md a
// docs/analysis/mesta-extract/** (deterministicky). Kontroly: tabulka ČSÚ s počty obyvatel 2025 (population-band-differs)
// a jmenné seznamy jmsez zveřejněných měst (jmsez-mismatch, ≥ 1 s mezi dotazy; při nedostupnosti se přeskočí a označí "not run"). Exit 1 při nenalezených/nejednoznačných
// názvech ze seznamu majitele, neplatných overrides nebo kolizi slugů. Pravidla: docs/superpowers/specs/2026-10-10-mesta-design.md §4.1, §6.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { download, downloadJson, cacheFile, csvFromZip, codes, ROOT } from './lib/util.js';
import { KV_BASE_URL } from '../src/councils.js';
import {
    PIRATES_CODE, BAND_BORDERLINE, czechCompare, parseOwnerList, wholeCouncils, matchOwnerTowns, classifyTown,
    borderlineReasons, decideInclusion, confidenceOf, disambiguateSlugs, assignShards, assignFeatured, buildExcluded,
    validateOverrides, spaced,
} from './mesta/registryCore.js';
import { xlsxFromZip, csuPopulation } from './mesta/xlsxRows.js';
import {
    bandOf, jmsezMismatch, flagLabel, reportRows, renderSpecificsTable, renderVerification, extractFiles,
} from './mesta/reports.js';
import overrides from '../src/mesta/overrides.js';

const OPENDATA = 'https://volby.gov.cz/opendata';
// Nejnovější registr a číselníky k 2026-10-10 (stránka https://volby.gov.cz/opendata/kv2026/kv2026_opendata.htm: nic novějšího než 20261007)
export const SOURCES = {
    reg: `${OPENDATA}/kv2026/KV2026reg20261007_csv.zip`, // csv_od/{kvrzcoco,kvros,kvrk}.csv
    cis: `${OPENDATA}/kv2026/KV2026ciselniky20261007_csv.zip`, // csv_od/{cvs,cns,cnumnuts}.csv
    reg2022: `${OPENDATA}/kv2022/KV2022reg20260328_csv.zip`, // csv_od/kvros.csv, DATUMVOLEB 20220923
    senate: 'https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json',
    // ČSÚ 130072-25 "Počet obyvatel v obcích k 1. 1. 2025" (spec §2): list 1 sešitu 1300722503.xlsx, B = kód obce, D = obyvatel
    pop: 'https://csu.gov.cz/docs/107508/31d73e49-141b-ecbc-3bcc-4089cac638c3/13007225_data.zip?version=1.1',
};
const POP_XLSX = '1300722503.xlsx';
const jmsezUrl = (okres, zastup) => `${KV_BASE_URL}/jmsez/${okres}/${zastup}.json`;
const JMSEZ_PATTERN = `${KV_BASE_URL}/jmsez/<okres>/<zastup>.json`;
const JMSEZ_GAP_MS = 1000; // ≥ 1 s mezi dotazy na jmsez
const JMSEZ_TIMEOUT_MS = 30000;
const JMSEZ_BUDGET_MS = 5 * 60 * 1000;
const JMSEZ_MAX_CONSECUTIVE_FAILS = 3;
const SOURCE_LABELS = {
    reg: 'ČSÚ registr kandidátů KV 2026 (kvrzcoco, kvros, kvrk)',
    cis: 'ČSÚ číselníky KV 2026 (cvs, cns, cnumnuts)',
    reg2022: 'ČSÚ registr a výsledky KV 2022 (kvros)',
    senate: 'ČSÚ senátní obvody 2026 (obvody.json)',
    pop: 'ČSÚ Počet obyvatel v obcích k 1. 1. 2025 (13007225_data.zip)',
};
export const DATUMVOLEB_2022 = '20220923';
const OWNER_LIST = path.join(ROOT, 'docs/analysis/mesta-towns.txt');
const PROBE_TSV = path.join(ROOT, 'docs/analysis/mesta-registry-extract/qualifying-nationwide.tsv');
const OUT = {
    towns: path.join(ROOT, 'src/mesta/towns.generated.json'),
    specifics: path.join(ROOT, 'src/mesta/specifics.generated.json'),
    excluded: path.join(ROOT, 'src/mesta/excluded.generated.json'),
};
const DOCS = 'docs/analysis';
const EXTRACT_DIR = `${DOCS}/mesta-extract`;
// Města mimo soubor seznamu, která majitel zmínil a zpráva o ověření je má uvést s důvodem (Litovel: jeho příklad)
const MENTIONED = [{ zastup: 503444, name: 'Litovel', senateName: 'Litovel' }];
const EXCLUDED_MAX_BYTES = 60 * 1024;
const PUBLISHED = ['auto', 'borderline-included', 'forced'];

const groupBy = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
        const k = r[key];
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
    }
    return m;
};

// Nejlepší výsledek 2022 pro kandidátku s 720 ve složení: Map<zastup, { pct, seats }>
export function pirates2022(rows) {
    const out = new Map();
    for (const r of rows) {
        if (r.DATUMVOLEB !== DATUMVOLEB_2022 || !codes(r.SLOZENI).includes(PIRATES_CODE)) continue;
        const pct = Number(r.PROCHLSTR) || 0;
        const seats = Number(r.MAND_STR) || 0;
        const z = Number(r.KODZASTUP);
        const prev = out.get(z);
        if (!prev || pct > prev.pct) out.set(z, { pct, seats });
    }
    return out;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fetchedAt = (url) => {
    try {
        return fs.statSync(cacheFile(url)).mtime.toISOString();
    } catch {
        return null;
    }
};

// Tabulka ČSÚ 2025 je jen kontrola pásma: když se nepodaří stáhnout/přečíst, jde se dál (příznak se nepočítá)
async function loadPopulation(fresh) {
    try {
        const buf = await download(SOURCES.pop, { fresh });
        const map = csuPopulation(xlsxFromZip(buf, POP_XLSX));
        if (map.size < 5000) throw new Error(`jen ${map.size} obcí v tabulce`);
        return { buf, map, ok: true };
    } catch (e) {
        return { buf: null, map: null, ok: false, reason: e.message };
    }
}

async function loadSources(fresh) {
    const [reg, cis, reg2022, senate] = await Promise.all(['reg', 'cis', 'reg2022', 'senate'].map((k) => download(SOURCES[k], { fresh })));
    const pop = await loadPopulation(fresh);
    const bufs = { reg, cis, reg2022, senate, ...(pop.buf ? { pop: pop.buf } : {}) };
    const sources = Object.entries(bufs).map(([key, b]) => ({
        key, label: SOURCE_LABELS[key], url: SOURCES[key], sha256: sha256(b), bytes: b.length, fetchedAt: fetchedAt(SOURCES[key]),
    }));
    return {
        hashes: Object.fromEntries(sources.map((x) => [x.key, x.sha256])),
        meta: {
            fetchedAt: sources.map((x) => x.fetchedAt).filter(Boolean).sort().at(-1) ?? null,
            sources,
            pop2025: { ok: pop.ok, reason: pop.reason, sourceName: POP_XLSX },
            jmsez: { status: 'not-run', reason: 'nespuštěno' },
        },
        pop2025: pop.map,
        jmsez: null,
        kvrzcoco: csvFromZip(reg, 'kvrzcoco.csv'),
        kvros: csvFromZip(reg, 'kvros.csv'),
        kvrk: csvFromZip(reg, 'kvrk.csv'),
        cvs: csvFromZip(cis, 'cvs.csv'),
        cns: csvFromZip(cis, 'cns.csv'),
        cnumnuts: csvFromZip(cis, 'cnumnuts.csv'),
        kvros2022: csvFromZip(reg2022, 'kvros.csv'),
        senate: JSON.parse(senate.toString('utf8')),
    };
}

const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: timeout ${ms} ms`)), ms).unref())]);

// jmsez zveřejněných měst, ≥ 1 s mezi dotazy (download() čeká před každým nestaženým souborem). Nedostupné/pomalé -> "not-run".
export async function fetchJmsez(towns, { fresh = false, get = (url) => downloadJson(url, { fresh, delayMs: JMSEZ_GAP_MS }), warn = console.error, budgetMs = JMSEZ_BUDGET_MS } = {}) {
    const map = new Map();
    const failed = [];
    const started = Date.now();
    let streak = 0;
    for (const t of towns) {
        if (Date.now() - started > budgetMs) return notRun(`pomalé: ${Math.round(budgetMs / 1000)} s nestačilo (${map.size}/${towns.length} měst)`, warn);
        try {
            map.set(t.zastup, await withTimeout(get(jmsezUrl(t.okres, t.zastup)), JMSEZ_TIMEOUT_MS, `jmsez ${t.name}`));
            streak = 0;
        } catch (e) {
            failed.push(t.zastup);
            warn(`WARNING: jmsez ${t.name} (${t.zastup}): ${e.message}`);
            if (++streak >= JMSEZ_MAX_CONSECUTIVE_FAILS) return notRun(`nedostupné: ${streak} chyb po sobě (poslední: ${e.message})`, warn);
        }
    }
    return { map, meta: { status: failed.length ? 'partial' : 'ok', fetched: map.size, failed, urlPattern: JMSEZ_PATTERN } };
}

function notRun(reason, warn) {
    warn(`WARNING: kontrola jmsez PŘESKOČENA (${reason}); jmsez-mismatch se nepočítá, v extraktu je "not-run"`);
    return { map: null, meta: { status: 'not-run', reason } };
}

// Čistá část CLI (vstup = načtené CSV, výstup = výsledek bez zápisu) kvůli čitelnosti a případnému testu
export function compute(src, ownerText, ovr = overrides) {
    const councils = wholeCouncils(src.kvrzcoco);
    const nuts = new Map(src.cnumnuts.map((r) => [Number(r.NUMNUTS), r.NAZEVNUTS]));
    const pop25 = src.pop2025 instanceof Map ? src.pop2025 : null;
    const jmsez = src.jmsez instanceof Map ? src.jmsez : null;
    const problems = [];
    const warnings = [];
    for (const e of validateOverrides(ovr, { councils })) problems.push(`overrides: ${e}`);

    const owner = parseOwnerList(ownerText);
    const match = matchOwnerTowns(owner, councils);
    for (const u of match.unmatched) problems.push(`owner list: unmatched "${u.name}" (${u.region})`);
    for (const a of match.ambiguous) problems.push(`owner list: ambiguous "${a.name}" (${a.region}): ${a.candidates.join(', ')}`);
    const ownerBy = new Map(match.matched.map((m) => [m.zastup, m]));

    const listsBy = groupBy(src.kvros, 'KODZASTUP');
    const candsBy = groupBy(src.kvrk, 'KODZASTUP');
    const with720 = new Set();
    for (const r of src.kvros) if (codes(r.SLOZENI).includes(PIRATES_CODE)) with720.add(Number(r.KODZASTUP));
    const forced = new Set(Object.entries(ovr.towns).filter(([, o]) => o.include === true).map(([k]) => Number(k)));

    const reasonCtx = {
        ownerList: new Set(ownerBy.keys()),
        okresNames: nuts,
        senateNames: new Set(src.senate.obvody.map((o) => o.nazevObvodu)),
        pirates2022: pirates2022(src.kvros2022),
    };

    const records = [];
    for (const c of councils.values()) {
        if (!(with720.has(c.zastup) || c.population >= BAND_BORDERLINE || ownerBy.has(c.zastup) || forced.has(c.zastup))) continue;
        const z = String(c.zastup);
        const cls = classifyTown(c.zastup, { lists: listsBy.get(z) || [], candidates: candsBy.get(z) || [], cvs: src.cvs, cns: src.cns });
        const override = ovr.towns[z];
        const reasons = borderlineReasons(c, { ...reasonCtx, override });
        const dec = decideInclusion(c, { type: cls.type, reasons, override });
        const flags = [...(ownerBy.get(c.zastup)?.flags || []), ...cls.flags, ...dec.flags];
        if (pop25 && PUBLISHED.includes(dec.inclusion)) {
            // Pásmo podle POCOBYV rozhoduje o zařazení; jiné pásmo v tabulce 2025 jen sníží důvěru (spec §2, §4.1)
            const p = pop25.get(c.zastup);
            if (!p) warnings.push(`${c.name} (${c.zastup}): not in the ČSÚ 1. 1. 2025 population table`);
            else if (bandOf(p.population) !== bandOf(c.population)) flags.push('population-band-differs');
        }
        const listRow = cls.list ? (listsBy.get(z) || []).find((r) => Number(r.POR_STR_HL) === cls.list.id && codes(r.SLOZENI).includes(PIRATES_CODE)) ?? null : null;
        if (cls.flags.includes('candidate-without-list')) warnings.push(`${c.name} (${c.zastup}): Pirate candidate whose list row is missing in kvros`);
        records.push({
            council: { ...c, krajName: nuts.get(c.kraj) ?? String(c.kraj) },
            cls, reasons, dec, flags, onOwnerList: ownerBy.has(c.zastup), listRow,
        });
    }

    const published = records.filter((r) => PUBLISHED.includes(r.dec.inclusion));
    let slugged;
    try {
        slugged = disambiguateSlugs(published.map((r) => ({ zastup: r.council.zastup, name: r.council.name, okres: r.council.okres, flags: r.flags })), nuts);
    } catch (e) {
        problems.push(`slugs: ${e.message}`);
        slugged = [];
    }
    const pubBy = new Map(published.map((r) => [r.council.zastup, r]));
    const items = slugged.map((s) => {
        const r = pubBy.get(s.zastup);
        const flags = jmsez?.has(s.zastup) && jmsezMismatch(jmsez.get(s.zastup), r.cls) ? [...s.flags, 'jmsez-mismatch'] : s.flags;
        return {
            ...r.council, slug: s.slug, inclusion: r.dec.inclusion, inclusionReason: r.dec.reason, onOwnerList: r.onOwnerList,
            flags, cls: r.cls, confidence: confidenceOf(flags),
        };
    });
    const placed = assignFeatured(assignShards(items), 12).sort((a, b) => a.kraj - b.kraj || czechCompare(a.name, b.name) || a.zastup - b.zastup);

    const towns = placed.map((t) => ({
        slug: t.slug, name: t.name, zastup: t.zastup, okres: t.okres, kraj: t.kraj, krajName: t.krajName, druh: t.druh, seats: t.seats,
        precincts: t.precincts, population: t.population, populationCsu2025: pop25?.get(t.zastup)?.population ?? null, shard: t.shard, featured: t.featured,
        inclusion: t.inclusion, inclusionReason: t.inclusionReason, onOwnerList: t.onOwnerList,
    }));
    const specifics = placed.map((t) => ({
        zastup: t.zastup, type: t.cls.type, confidence: t.confidence, list: t.cls.list, members: t.cls.members,
        others: t.cls.others, flags: t.flags,
    }));
    const excluded = buildExcluded(records.map((r) => ({
        council: r.council, type: r.cls.type, inclusion: r.dec.inclusion, reason: r.dec.reason, onOwnerList: r.onOwnerList,
    })));
    return {
        councils, records, owner, match, towns, specifics, excluded, problems, warnings, pop2025: pop25, pirates2022: reasonCtx.pirates2022,
    };
}

const line = (items) => `[\n${items.map((i) => JSON.stringify(i)).join(',\n')}\n]\n`;

function probeDiff(records) {
    if (!fs.existsSync(PROBE_TSV)) return null;
    const probe = new Map();
    for (const l of fs.readFileSync(PROBE_TSV, 'utf8').split('\n').slice(1)) {
        const f = l.split('\t');
        if (f.length > 6) probe.set(Number(f[4]), { name: f[2], pop: Number(f[3]), type: f[6] });
    }
    const gen = new Map(records.filter((r) => (r.cls.type === 'a' || r.cls.type === 'b') && r.council.population >= BAND_BORDERLINE)
        .map((r) => [r.council.zastup, { name: r.council.name, pop: r.council.population, type: r.cls.type }]));
    const diff = [];
    for (const [z, p] of probe) {
        const g = gen.get(z);
        if (!g) diff.push(`only in probe: ${p.name} ${z}`);
        else if (g.type !== p.type || g.pop !== p.pop) diff.push(`differs: ${p.name} ${z} probe ${p.type}/${p.pop} generated ${g.type}/${g.pop}`);
    }
    for (const [z, g] of gen) if (!probe.has(z)) diff.push(`only generated: ${g.name} ${z} (${g.type}, ${g.pop})`);
    return { probe: probe.size, generated: gen.size, diff };
}

function summary(res, hashes, meta = {}) {
    const { towns, specifics, excluded, records, owner, match } = res;
    const out = [];
    const names = (ts) => ts.map((t) => t.name).join(', ') || '-';
    const by = (inc) => towns.filter((t) => t.inclusion === inc);
    const typeOf = new Map(specifics.map((s) => [s.zastup, s.type]));
    const reasonOf = new Map(records.map((r) => [r.council.zastup, r.dec.reason]));
    const count = (ts, ty) => ts.filter((t) => typeOf.get(t.zastup) === ty).length;
    const bi = by('borderline-included');
    out.push(`sources: ${Object.entries(hashes).map(([k, h]) => `${k} sha256:${String(h).slice(0, 12)}`).join(' · ')}`);
    out.push(`published ${towns.length}: auto ${by('auto').length} (a ${count(by('auto'), 'a')}, b ${count(by('auto'), 'b')}), `
        + `borderline-included ${bi.length}, forced ${by('forced').length}`);
    for (const t of bi) out.push(`  borderline-included: ${t.name} (${t.population}) - ${reasonOf.get(t.zastup)} [${specifics.find((s) => s.zastup === t.zastup).confidence}]`);
    for (const t of by('forced')) out.push(`  forced: ${t.name} (${t.population}) - ${reasonOf.get(t.zastup)}`);
    const be = records.filter((r) => r.dec.inclusion === 'borderline-excluded').map((r) => r.council);
    out.push(`borderline-excluded ${be.length}: ${names(be)}`);
    const rejected = match.matched.filter((m) => !towns.some((t) => t.zastup === m.zastup));
    const byZ = new Map(records.map((r) => [r.council.zastup, r]));
    out.push(`owner list: ${owner.length} names, confirmed ${match.matched.length - rejected.length}, rejected ${rejected.length}, `
        + `unmatched ${match.unmatched.length}, ambiguous ${match.ambiguous.length}`);
    for (const m of rejected) out.push(`  rejected: ${m.name} (${byZ.get(m.zastup).council.population}) - ${byZ.get(m.zastup).dec.reason}`);
    const added = towns.filter((t) => !t.onOwnerList);
    out.push(`added (not on the owner list) ${added.length}: ${names(added)}`);
    out.push(`types: ${['a', 'b', 'c', 'd'].map((ty) => `${ty} ${count(towns, ty)}`).join(', ')} (published)`);
    const shards = new Map();
    for (const t of towns) shards.set(t.shard, (shards.get(t.shard) || 0) + 1);
    out.push(`shards ${shards.size}: ${[...shards].map(([s, n]) => `${s}=${n}`).join(' ')}; featured: ${names(towns.filter((t) => t.featured))}`);
    const low = specifics.filter((s) => s.confidence === 'low');
    out.push(`low-confidence ${low.length}: ${low.map((s) => `${towns.find((t) => t.zastup === s.zastup).name} [${s.flags.join(',')}]`).join('; ') || '-'}`);
    const flagged = specifics.filter((s) => s.flags.length && s.confidence !== 'low');
    out.push(`other flags: ${flagged.map((s) => `${towns.find((t) => t.zastup === s.zastup).name} [${s.flags.join(',')}]`).join('; ') || '-'}`);
    const differs = specifics.filter((s) => s.flags.includes('population-band-differs'));
    out.push(`population 2025 cross-check: ${meta.pop2025?.ok ? `${towns.filter((t) => t.populationCsu2025 !== null).length}/${towns.length} towns matched, band differs: ${differs.map((s) => towns.find((t) => t.zastup === s.zastup).name).join(', ') || 'none'}` : `NOT RUN (${meta.pop2025?.reason ?? 'no data'})`}`);
    const mism = specifics.filter((s) => s.flags.includes('jmsez-mismatch'));
    out.push(`jmsez cross-check: ${meta.jmsez?.status ?? 'not-run'}${meta.jmsez?.reason ? ` (${meta.jmsez.reason})` : ''}${meta.jmsez?.fetched !== undefined ? `, ${meta.jmsez.fetched} towns` : ''}, mismatch: ${mism.map((s) => towns.find((t) => t.zastup === s.zastup).name).join(', ') || 'none'}`);
    out.push(`excluded.generated.json: ${excluded.length} towns`);
    return out.join('\n');
}

// Klíče textů: towns/specifics/excluded (OUT) nebo cesta souboru relativně ke kořeni repozitáře (reporty, extrakt)
const writeOut = (texts) => {
    for (const [k, text] of Object.entries(texts)) {
        const file = OUT[k] ?? path.join(ROOT, k);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
};

// Poznámky k ověření seznamu a zmínění majitelé (Litovel): texty pro reporty
function mentionedNotes(res, src) {
    const extra = {};
    for (const m of MENTIONED) {
        const rec = res.records.find((r) => r.council.zastup === m.zastup);
        if (!rec || rec.council.name !== m.name) continue;
        const ob = (src.senate?.obvody || []).find((o) => o.nazevObvodu === m.senateName);
        const hasPirate = rec.cls.type === 'a' || rec.cls.type === 'b' || rec.cls.members.length || rec.cls.others.length;
        extra[m.zastup] = [
            hasPirate ? 'v registru tu pirátská kandidatura je (zkontrolujte)' : null,
            ob ? `${ob.nazevObvodu} je senátní obvod ${ob.obvod} (volby 2026); případná pirátská vazba patří do Senátu, ne do tohoto produktu` : 'senátní obvod tohoto jména v roce 2026 nehlasuje',
            'není na vašem seznamu, uvedli jste ho jako příklad',
        ].filter(Boolean).join('; ');
    }
    return extra;
}

export function buildDocs(res, src, ovr, ownerCount) {
    const meta = { ...(src.meta || {}), ownerCount, extraZastups: MENTIONED.map((m) => m.zastup) };
    const extra = mentionedNotes(res, src);
    const rows = reportRows(res, { overrides: ovr, extra });
    const confirmed = rows.filter((r) => r.published && r.onOwnerList);
    const added = rows.filter((r) => r.published && !r.onOwnerList);
    const rejected = rows.filter((r) => !r.published && (r.onOwnerList || r.zastup in extra));
    const borderlineExcluded = rows.filter((r) => r.inclusion === 'borderline-excluded');
    const notes = [];
    const hidden = rows.filter((r) => r.hidden);
    if (hidden.length) notes.push(`Skryto, dokud je nepotvrdíte (nízká jistota): ${hidden.map((r) => `${r.name} [${r.flags.map(flagLabel).join(', ')}]`).join('; ')}.`);
    if (!meta.pop2025?.ok) notes.push(`Kontrola počtu obyvatel 2025 NEPROBĚHLA (${meta.pop2025?.reason ?? 'bez dat'}): u měst chybí počet z tabulky 2025 a nezjišťovalo se, zda spadají do jiného pásma.`);
    if (!meta.jmsez || meta.jmsez.status === 'not-run') notes.push(`Kontrola jmenným seznamem kandidátů (jmsez) NEPROBĚHLA${meta.jmsez?.reason ? ` (${meta.jmsez.reason})` : ''}: nezjišťovalo se, zda pirátské štítky sedí s registrem.`);
    // Nezveřejněná města těsně pod hranicí 7 000 (registr 2026) a nad ní (ČSÚ 2025): zařazení rozhoduje registr 2026, rozhodnutí je ve skupině 4 přehledu
    const offBand = rows.filter((r) => r.offBand);
    if (offBand.length) {
        notes.push(`Města, kde Piráti kandidují a registr 2026 uvádí méně než 7 000 obyvatel, ale tabulka ČSÚ 2025 už 7 000 a víc, nejsou zveřejněna (zařazení rozhoduje registr 2026): ${offBand.map((r) => `${r.name} (${spaced(r.population)} / ${spaced(r.population2025)})`).join(', ')}. K rozhodnutí je skupina 4 v \`docs/analysis/mesta-specifics.md\` (kapitola „K rozhodnutí vlastníka“).`);
    }
    for (const w of res.warnings) notes.push(`Varování generátoru: ${w}`);
    const files = {
        [`${DOCS}/mesta-specifics.md`]: renderSpecificsTable(rows, meta),
        [`${DOCS}/mesta-list-verification.md`]: renderVerification({ confirmed, rejected, added, borderlineExcluded, notes }, meta),
    };
    for (const [name, text] of Object.entries(extractFiles({ src, res, meta }))) files[`${EXTRACT_DIR}/${name}`] = text;
    return files;
}

// Vše po načtení dat: výpočet, výpis, kontroly, zápis. Vrací exit code (0 / 1); IO je injektovatelné pro testy.
export function execute(src, ownerText, { ovr = overrides, write = writeOut, log = console.log, err = console.error } = {}) {
    const res = compute(src, ownerText, ovr);
    log(summary(res, src.hashes, src.meta));
    const pd = probeDiff(res.records);
    if (pd) log(`probe diff (${PROBE_TSV.replace(`${ROOT}/`, '')}, ${pd.probe} rows vs ${pd.generated} generated a/b >= ${BAND_BORDERLINE}): ${pd.diff.length ? `\n  ${pd.diff.join('\n  ')}` : 'identical'}`);
    for (const w of res.warnings) err(`WARNING: ${w}`);
    if (res.problems.length) {
        err(`\nSTOP (nothing written):\n  ${res.problems.join('\n  ')}`);
        return 1;
    }
    const texts = { towns: line(res.towns), specifics: line(res.specifics), excluded: line(res.excluded) };
    if (Buffer.byteLength(texts.excluded) > EXCLUDED_MAX_BYTES) {
        err(`\nSTOP: excluded.generated.json is ${Buffer.byteLength(texts.excluded)} B (limit ${EXCLUDED_MAX_BYTES})`);
        return 1;
    }
    Object.assign(texts, buildDocs(res, src, ovr, res.owner.length));
    write(texts);
    const total = Object.values(texts).reduce((n, t) => n + Buffer.byteLength(t), 0);
    log(`\nwritten: ${Object.keys(OUT).map((k) => `${OUT[k].replace(`${ROOT}/`, '')} (${Buffer.byteLength(texts[k])} B)`).join(', ')}`);
    log(`reports + extract: ${Object.keys(texts).length - 3} files, ${Object.entries(texts).filter(([k]) => k.startsWith(EXTRACT_DIR)).reduce((n, [, t]) => n + Buffer.byteLength(t), 0)} B in ${EXTRACT_DIR} (all outputs ${total} B)`);
    return 0;
}

export async function main(argv = process.argv.slice(2)) {
    const fresh = argv.includes('--fresh');
    const src = await loadSources(fresh);
    const ownerText = fs.readFileSync(OWNER_LIST, 'utf8');
    if (argv.includes('--no-jmsez')) {
        src.meta.jmsez = { status: 'not-run', reason: 'vypnuto přepínačem --no-jmsez' };
    } else {
        // 1. průchod určí zveřejněná města (jmsez jen pro ně; příznak jen sníží důvěru, množinu nemění), 2. průchod (execute) příznaky započítá
        const first = compute(src, ownerText);
        const jm = first.problems.length ? { map: null, meta: { status: 'not-run', reason: 'generátor má chyby' } } : await fetchJmsez(first.towns, { fresh });
        src.jmsez = jm.map;
        src.meta.jmsez = jm.meta;
    }
    return execute(src, ownerText);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
