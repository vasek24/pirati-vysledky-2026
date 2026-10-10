// Generátor registru produktu "mesta": z open dat ČSÚ spočítá, která města se zveřejní a jak v nich Piráti kandidují.
//   node scripts/mesta-registry.js [--fresh]
// Zapisuje src/mesta/{towns,specifics,excluded}.generated.json (deterministicky). Exit 1 při nenalezených/nejednoznačných
// názvech ze seznamu majitele, neplatných overrides nebo kolizi slugů. Pravidla: docs/superpowers/specs/2026-10-10-mesta-design.md §4.1, §6.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { download, csvFromZip, codes, ROOT } from './lib/util.js';
import {
    PIRATES_CODE, BAND_BORDERLINE, czechCompare, parseOwnerList, wholeCouncils, matchOwnerTowns, classifyTown,
    borderlineReasons, decideInclusion, confidenceOf, disambiguateSlugs, assignShards, assignFeatured, buildExcluded,
    validateOverrides,
} from './mesta/registryCore.js';
import overrides from '../src/mesta/overrides.js';

const OPENDATA = 'https://volby.gov.cz/opendata';
// Nejnovější registr a číselníky k 2026-10-10 (stránka https://volby.gov.cz/opendata/kv2026/kv2026_opendata.htm: nic novějšího než 20261007)
export const SOURCES = {
    reg: `${OPENDATA}/kv2026/KV2026reg20261007_csv.zip`, // csv_od/{kvrzcoco,kvros,kvrk}.csv
    cis: `${OPENDATA}/kv2026/KV2026ciselniky20261007_csv.zip`, // csv_od/{cvs,cns,cnumnuts}.csv
    reg2022: `${OPENDATA}/kv2022/KV2022reg20260328_csv.zip`, // csv_od/kvros.csv, DATUMVOLEB 20220923
    senate: 'https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json',
};
export const DATUMVOLEB_2022 = '20220923';
const OWNER_LIST = path.join(ROOT, 'docs/analysis/mesta-towns.txt');
const PROBE_TSV = path.join(ROOT, 'docs/analysis/mesta-registry-extract/qualifying-nationwide.tsv');
const OUT = {
    towns: path.join(ROOT, 'src/mesta/towns.generated.json'),
    specifics: path.join(ROOT, 'src/mesta/specifics.generated.json'),
    excluded: path.join(ROOT, 'src/mesta/excluded.generated.json'),
};
const EXCLUDED_MAX_BYTES = 60 * 1024;

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

async function loadSources(fresh) {
    const [reg, cis, reg2022, senate] = await Promise.all(Object.values(SOURCES).map((url) => download(url, { fresh })));
    return {
        hashes: Object.fromEntries(Object.entries({ reg, cis, reg2022, senate }).map(([k, b]) => [k, createHash('sha256').update(b).digest('hex').slice(0, 12)])),
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

// Čistá část CLI (vstup = načtené CSV, výstup = výsledek bez zápisu) kvůli čitelnosti a případnému testu
export function compute(src, ownerText, ovr = overrides) {
    const councils = wholeCouncils(src.kvrzcoco);
    const nuts = new Map(src.cnumnuts.map((r) => [Number(r.NUMNUTS), r.NAZEVNUTS]));
    const problems = [];
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
        records.push({
            council: { ...c, krajName: nuts.get(c.kraj) ?? String(c.kraj) },
            cls, reasons, dec, flags, onOwnerList: ownerBy.has(c.zastup),
        });
    }

    const published = records.filter((r) => ['auto', 'borderline-included', 'forced'].includes(r.dec.inclusion));
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
        return {
            ...r.council, slug: s.slug, inclusion: r.dec.inclusion, inclusionReason: r.dec.reason, onOwnerList: r.onOwnerList,
            flags: s.flags, cls: r.cls,
        };
    });
    const placed = assignFeatured(assignShards(items), 12).sort((a, b) => a.kraj - b.kraj || czechCompare(a.name, b.name) || a.zastup - b.zastup);

    const towns = placed.map((t) => ({
        slug: t.slug, name: t.name, zastup: t.zastup, okres: t.okres, kraj: t.kraj, krajName: t.krajName, druh: t.druh, seats: t.seats,
        precincts: t.precincts, population: t.population, populationCsu2025: null, shard: t.shard, featured: t.featured,
        inclusion: t.inclusion, inclusionReason: t.inclusionReason, onOwnerList: t.onOwnerList,
    }));
    const specifics = placed.map((t) => ({
        zastup: t.zastup, type: t.cls.type, confidence: confidenceOf(t.flags), list: t.cls.list, members: t.cls.members,
        others: t.cls.others, flags: t.flags,
    }));
    const excluded = buildExcluded(records.map((r) => ({
        council: r.council, type: r.cls.type, inclusion: r.dec.inclusion, reason: r.dec.reason, onOwnerList: r.onOwnerList,
    })));
    return { councils, records, owner, match, towns, specifics, excluded, problems };
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

function summary(res, hashes) {
    const { towns, specifics, excluded, records, owner, match } = res;
    const out = [];
    const names = (ts) => ts.map((t) => t.name).join(', ') || '-';
    const by = (inc) => towns.filter((t) => t.inclusion === inc);
    const typeOf = new Map(specifics.map((s) => [s.zastup, s.type]));
    const reasonOf = new Map(records.map((r) => [r.council.zastup, r.dec.reason]));
    const count = (ts, ty) => ts.filter((t) => typeOf.get(t.zastup) === ty).length;
    const bi = by('borderline-included');
    out.push(`sources: ${Object.entries(hashes).map(([k, h]) => `${k} sha256:${h}`).join(' · ')}`);
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
    out.push(`excluded.generated.json: ${excluded.length} towns`);
    return out.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
    const src = await loadSources(argv.includes('--fresh'));
    const res = compute(src, fs.readFileSync(OWNER_LIST, 'utf8'));
    console.log(summary(res, src.hashes));
    const pd = probeDiff(res.records);
    if (pd) console.log(`probe diff (${PROBE_TSV.replace(`${ROOT}/`, '')}, ${pd.probe} rows vs ${pd.generated} generated a/b >= ${BAND_BORDERLINE}): ${pd.diff.length ? `\n  ${pd.diff.join('\n  ')}` : 'identical'}`);
    if (res.problems.length) {
        console.error(`\nSTOP (nothing written):\n  ${res.problems.join('\n  ')}`);
        return 1;
    }
    const excludedText = line(res.excluded);
    if (Buffer.byteLength(excludedText) > EXCLUDED_MAX_BYTES) {
        console.error(`\nSTOP: excluded.generated.json is ${Buffer.byteLength(excludedText)} B (limit ${EXCLUDED_MAX_BYTES})`);
        return 1;
    }
    fs.writeFileSync(OUT.towns, line(res.towns));
    fs.writeFileSync(OUT.specifics, line(res.specifics));
    fs.writeFileSync(OUT.excluded, excludedText);
    console.log(`\nwritten: ${Object.values(OUT).map((f) => `${f.replace(`${ROOT}/`, '')} (${fs.statSync(f).size} B)`).join(', ')}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
