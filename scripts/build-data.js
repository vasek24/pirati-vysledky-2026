// Statická data pro všechna zastupitelstva z src/councils.js:
//
//   public/data/<slug>/lists.json      kandidátky 2026 (barva, loga, předchůdci 2022)
//   public/data/<slug>/kandidati.json  kandidáti (jména, povolání, fotky)
//   public/data/<slug>/results2022.json výsledky KV 2022 po okrscích
//   public/data/<slug>/okrsky.geojson  hranice okrsků (WGS84, zjednodušené)
//   public/media/<slug>/logos|photos   loga stran a fotky z programydovoleb.cz
//   public/data/prehled.json           podklady přehledu (/) za všechna zastupitelstva
//
// Zdroje: open data ČSÚ (registry KV 2026, výsledky + registry KV 2022),
// hranice okrsků 2025 (ČSÚ, zrcadlo programydovoleb.cz), programydovoleb.cz
// (loga, barvy, fotky kandidátů), volby.gov.cz (jmenné seznamy).
//
// Použití:  npm run data                  (všechna zastupitelstva)
//           npm run data -- praha-6        (jen jedno)
//           npm run data -- --fresh        (ignorovat .cache/)
//
// Produkt „mesta“ (opt-in, Praha se nemění):
//           node scripts/build-data.js --product=mesta [slug…] [--fresh] [--maps-only]
//   zapisuje do public-mesta/data/<slug>/ (lists, kandidati, results2022,
//   okrsky.geojson: hranice okrsků u měst s mapou (`map`), jinak prázdná kolekce;
//   `--maps-only` přegeneruje jen ty hranice z cache, bez ostatních stahování) a public-mesta/media/<slug>/logos; bez fotek
//   kandidátů a bez prehled.json; selhání jednoho města nezastaví ostatní
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import simplify from '@turf/simplify';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { COUNCILS, KV_BASE_URL, PIRATES_CODE } from '../src/councils.js';
import { ROOT, cacheFile, codes, csvFromZip, download, downloadJson, slugify, writeJson } from './lib/util.js';
import { precinctDistrictsOf, precinctIdsOf } from './mesta/registryCore.js';

const URLS = {
    reg2026: 'https://volby.gov.cz/opendata/kv2026/KV2026reg20261002_csv.zip',
    // Produkt „mesta“: nejnovější registr (stejný jako generátor scripts/mesta-registry.js)
    reg2026mesta: 'https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip',
    data2022: 'https://volby.gov.cz/opendata/kv2022/KV2022_data_20260328_csv.zip',
    reg2022: 'https://volby.gov.cz/opendata/kv2022/KV2022reg20260328_csv.zip',
    okrsky: 'https://static.programydovoleb.cz/2025/vol_okrsky_2025_g100_20250701.geojson',
    pdvElection: (zastup) => `https://programydovoleb.cz/api.php?action=/elections/fetch/176:${zastup}`,
    pdvParty: (code) => `https://programydovoleb.cz/api.php?action=/parties/${code}`,
    jmsez: (okres, zastup) => `${KV_BASE_URL}/jmsez/${okres}/${zastup}.json`,
};
const DATE_2022 = '20220923';
const NK = 80; // nezávislý kandidát
const PDV_DELAY = 150; // ms mezi dotazy na programydovoleb.cz — jsme slušní
const JMSEZ_DELAY = 1000; // ms mezi jmennými seznamy na volby.gov.cz (jen produkt „mesta“, 1 soubor na město)
const FALLBACK_COLORS = ['#0EA5E9', '#F97316', '#14B8A6', '#E11D48', '#84CC16', '#A855F7', '#F59E0B', '#64748B', '#06B6D4', '#DB2777', '#65A30D', '#7C3AED'];

// S-JTSK / Křovák (EPSG:5514) → WGS84
proj4.defs('EPSG:5514', '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs');
const toWgs = proj4('EPSG:5514', 'WGS84');

export function parseArgs(argv) {
    const product = argv.find((a) => a.startsWith('--product='))?.slice('--product='.length);
    if (product !== undefined && product !== 'mesta') throw new Error(`Neznámý --product=${product} (jen mesta)`);
    const mapsOnly = argv.includes('--maps-only');
    if (mapsOnly && product !== 'mesta') throw new Error('--maps-only jen s --product=mesta');
    return {
        mesta: product === 'mesta',
        fresh: argv.includes('--fresh'),
        mapsOnly,
        only: argv.filter((a) => !a.startsWith('--')),
    };
}

const { mesta: MESTA, fresh, mapsOnly: MAPS_ONLY, only } = parseArgs(process.argv.slice(2));
const log = (...a) => console.log('·', ...a);
// Kam se zapisuje: Praha public/…, produkt „mesta“ public-mesta/…
export function outputDirs(council, mesta) {
    if (mesta && !/^[a-z0-9-]+$/.test(council?.slug ?? '')) throw new Error(`Neplatný slug: ${JSON.stringify(council?.slug)}`);
    const root = mesta ? 'public-mesta' : 'public';
    return {
        dataDir: path.join(ROOT, `${root}/data`, council.slug),
        mediaDir: path.join(ROOT, `${root}/media`, council.slug),
    };
}
// Loga města se nejdřív stahují do logos.tmp; stávající logos se smaže a nahradí
// až po úspěšném výpočtu celého města (neúspěšné město nechá předchozí data)
export async function stageLogosDir(mediaDir) {
    const tmp = path.join(mediaDir, 'logos.tmp');
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    return tmp;
}
export async function commitLogosDir(mediaDir) {
    await fs.rm(path.join(mediaDir, 'logos'), { recursive: true, force: true });
    await fs.rename(path.join(mediaDir, 'logos.tmp'), path.join(mediaDir, 'logos'));
}
export async function discardLogosDir(mediaDir) {
    await fs.rm(path.join(mediaDir, 'logos.tmp'), { recursive: true, force: true });
}
export const emptyGeo = () => ({ type: 'FeatureCollection', features: [] });

// Produkt „mesta“: hranice okrsků jednoho města z celostátní vrstvy ČSÚ (kod_obec = KODZASTUP),
// stejně převedené a zjednodušené jako u Prahy. `precinctIds` = okrsky 2026 ze seznamu v registru
// (kvrzcoco), `districtOf` = Map okrsek → kod_mco jeho městské části (ze stejného seznamu).
// Vrstva je z roku 2025 a některé okrsky se změnily (zaniklé polygony, nové okrsky 2026 bez polygonu).
// Rozhodnutí majitele: městská část, ve které je zaniklý polygon NEBO okrsek 2026 bez polygonu, se
// z mapy vynechá CELÁ (jinak by na mapě zůstaly navždy šedé okrsky, nebo díry); v součtech „sečteno X z N“
// a v seznamu okrsků zůstávají. Vynechané části vrací `droppedDistricts` (do geojsonu, stránka z nich
// složí větu). Bez spolehlivého seznamu okrsků (prázdný / chybí) se nic nevynechává a výsledek je
// `verified: false`. Okrsek bez polygonu, který nejde přiřadit k městské části (bez `districtOf`),
// jen skončí v `missing`.
export function townMapFeatures(geo, council, precinctIds, districtOf = null) {
    const known = precinctIds && precinctIds.size ? precinctIds : null;
    const all = geo.features.filter((f) => String(f.properties.kod_obec) === String(council.zastup));
    const layerIds = new Set(all.map((f) => Number(f.properties.cislo)));
    if (layerIds.size !== all.length) {
        const seen = new Set();
        for (const f of all) {
            const id = Number(f.properties.cislo);
            if (seen.has(id)) throw new Error(`${council.slug}: okrsek ${id} je ve vrstvě hranic dvakrát`);
            seen.add(id);
        }
    }
    const mcoOf = (f) => String(f.properties.kod_mco ?? '');
    const dropped = known ? all.filter((f) => !known.has(Number(f.properties.cislo))).map((f) => Number(f.properties.cislo)).sort((a, b) => a - b) : [];
    const missing = known ? [...known].filter((id) => !layerIds.has(id)).sort((a, b) => a - b) : [];

    // městské části k vynechání: s některým zaniklým polygonem, nebo s okrskem 2026 bez polygonu
    const bad = new Map(); // kod_mco → reason
    for (const f of all) if (known && !known.has(Number(f.properties.cislo))) bad.set(mcoOf(f), 'extinct');
    for (const id of missing) {
        const kod = districtOf?.get(id);
        if (kod !== undefined && !bad.has(String(kod))) bad.set(String(kod), 'missing');
    }

    const droppedDistricts = [];
    for (const [kod, reason] of bad) {
        const polys = all.filter((f) => mcoOf(f) === kod);
        const precincts = districtOf ? [...known].filter((id) => String(districtOf.get(id)) === kod).length : polys.filter((f) => known.has(Number(f.properties.cislo))).length;
        droppedDistricts.push({ kod, name: polys[0]?.properties.naz_mco || kod, reason, polygons: polys.length, precincts });
    }
    droppedDistricts.sort((a, b) => Number(a.kod) - Number(b.kod) || a.name.localeCompare(b.name, 'cs'));

    const features = all
        .filter((f) => !bad.has(mcoOf(f)))
        .map((f) => simplify({
            type: 'Feature',
            properties: { cislo: Number(f.properties.cislo), mco: f.properties.naz_mco || null },
            geometry: reproject(f.geometry),
        }, { tolerance: 0.00003, highQuality: true }));
    if (!all.length) throw new Error(`${council.slug}: ve vrstvě hranic není žádný polygon okrsku (kod_obec ${council.zastup})`);
    if (!features.length) throw new Error(`${council.slug}: po vynechání městských částí s neshodnými okrsky nezbyde žádný polygon`);
    return { features, dropped, missing, droppedDistricts, verified: !!known };
}

// okrsky.geojson města: FeatureCollection (+ `droppedDistricts` jen když se něco vynechalo)
export const mapGeoFile = (r) => ({
    type: 'FeatureCollection',
    features: r.features,
    ...(r.droppedDistricts.length ? { droppedDistricts: r.droppedDistricts } : {}),
});

const mapWarnings = (r) => [
    ...(r.verified ? [] : ['okrsky 2026 neznámé: mapa ponechala všechny polygony']),
    ...(r.dropped.length ? [`mapa: ${r.dropped.length} zaniklých polygonů (${r.dropped.join(',')})`] : []),
    ...(r.missing.length ? [`mapa: ${r.missing.length} okrsků 2026 bez polygonu (${r.missing.join(',')})`] : []),
    ...r.droppedDistricts.map((d) => `mapa: vynechána městská část ${d.name} (${d.reason}, ${d.polygons} polygonů, ${d.precincts} okrsků 2026)`),
];

const pick = (data, key) => (data && Array.isArray(data[key]) && data[key][0]?.value) || null;

// Produkt „mesta“: všechna publikovaná města (i skrytá — majitel je může
// uvolnit) z vygenerovaných JSON přes fs (Node neimportuje JSON) + overrides
export async function loadMestaCouncils(slugs = []) {
    const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, 'src/mesta', f), 'utf8'));
    const [towns, specifics] = await Promise.all([read('towns.generated.json'), read('specifics.generated.json')]);
    const overrides = (await import('../src/mesta/overrides.js')).default;
    const { buildCouncils } = await import('../src/mesta/buildCouncils.js');
    const all = buildCouncils(towns, specifics, overrides);
    const unknown = slugs.filter((s) => !all.some((c) => c.slug === s));
    if (unknown.length) throw new Error(`Neznámé město: ${unknown.join(', ')}`);
    return slugs.length ? all.filter((c) => slugs.includes(c.slug)) : all;
}

// Město po městě; výjimka jednoho nezastaví ostatní. Exit 1 jen když nevyšlo žádné
export async function runMesta(councils, buildOne, { log: out = console.log, error = console.error } = {}) {
    const failed = [];
    let ok = 0;
    for (const council of councils) {
        try {
            await buildOne(council);
            ok++;
        } catch (err) {
            failed.push({ slug: council.slug, reason: err.message });
            error(`  ✗ ${council.slug}: ${err.message}`);
        }
    }
    out(`mesta data: OK ${ok}/${councils.length}, failed: [${failed.map((f) => f.slug).join(', ')}]`);
    return { ok, total: councils.length, failed, exitCode: ok === 0 ? 1 : 0 };
}

let isNearWhite = () => false; // jen produkt „mesta“ (main() načte src/mesta/color.js)

async function main() {
    if (MESTA) ({ isNearWhite } = await import('../src/mesta/color.js'));
    const councils = MESTA
        ? await loadMestaCouncils(only)
        : (only.length ? COUNCILS.filter((c) => only.includes(c.slug)) : COUNCILS);
    if (!councils.length) throw new Error(`Neznámé zastupitelstvo: ${only.join(', ')}`);

    log('Registry KV 2026…');
    const reg2026 = await download(MESTA ? URLS.reg2026mesta : URLS.reg2026, { fresh });
    if (MAPS_ONLY) {
        await mapsOnlyMain(councils, reg2026);
        return;
    }
    const ros2026 = csvFromZip(reg2026, 'kvros.csv');
    const rk2026 = csvFromZip(reg2026, 'kvrk.csv');

    log('Výsledky a registry KV 2022…');
    const reg2022 = await download(URLS.reg2022, { fresh });
    const data2022 = await download(URLS.data2022, { fresh });
    const ros2022 = csvFromZip(reg2022, 'kvros.csv');
    const t3 = csvFromZip(data2022, 'kvt3.csv');
    const hl = csvFromZip(data2022, 'kvhl.csv', { raw: true });

    // Produkt „mesta“: hranice jen když je v běhu aspoň jedno město s mapou (jinak se nestahují)
    let geo = null;
    if (!MESTA || councils.some((c) => c.map)) {
        log('Hranice okrsků…');
        geo = JSON.parse((await download(URLS.okrsky, { fresh })).toString('utf8'));
    }
    const rzc2026 = MESTA && geo ? csvFromZip(reg2026, 'kvrzcoco.csv') : null;

    const partyCache = new Map();
    const partyInfo = async (code) => {
        if (!partyCache.has(code)) {
            let p = null;
            try {
                const res = await downloadJson(URLS.pdvParty(code), { fresh, delayMs: PDV_DELAY });
                p = res.list?.[0] || null;
            } catch (err) {
                console.warn(`  ! strana ${code}: ${err.message}`);
            }
            partyCache.set(code, p);
        }
        return partyCache.get(code);
    };

    const shared = { ros2026, rk2026, ros2022, t3, hl, geo, rzc2026, partyInfo };
    if (MESTA) {
        const warnings = {};
        const res = await runMesta(councils, async (council) => {
            console.log(`\n=== ${council.name} (${council.zastup}) ===`);
            try {
                warnings[council.slug] = await buildCouncil(council, shared);
            } catch (err) {
                await discardLogosDir(outputDirs(council, true).mediaDir);
                throw err;
            }
        });
        const withWarnings = Object.entries(warnings).filter(([, w]) => w.length);
        if (withWarnings.length) console.log('\nvarování:');
        for (const [slug, w] of withWarnings) console.log(`  ${slug}: ${w.join('; ')}`);
        for (const f of res.failed) console.log(`  SELHALO ${f.slug}: ${f.reason}`);
        process.exitCode = res.exitCode;
        return;
    }
    for (const council of councils) {
        console.log(`\n=== ${council.name} (${council.zastup}) ===`);
        await buildCouncil(council, shared);
    }
    await buildOverview();
}

// `--maps-only` (jen mesta): přegeneruje okrsky.geojson z cache (celostátní vrstva + registr), ostatní
// soubory měst ani média se nemění. Města s mapou dostanou polygony, města s `map: false` (vypínač,
// overrides.js) prázdnou kolekci, pokud mají v souboru polygony. Závislosti jsou vstřikované kvůli testům.
export async function buildMapsOnly(councils, { geo, rzc, read, write, log: out = log, error = console.error }) {
    const res = await runMesta(councils, async (council) => {
        if (!council.map) {
            const existing = await read(council);
            if (existing?.features?.length) {
                await write(council, emptyGeo());
                out(`${council.slug}: mapa vypnuta (map: false) — okrsky.geojson vyprázdněn`);
            }
            return;
        }
        const r = townMapFeatures(geo(), council, precinctIdsOf(rzc, council.zastup), precinctDistrictsOf(rzc, council.zastup));
        await write(council, mapGeoFile(r));
        out(`${council.slug}: ${r.features.length} polygonů z ${council.precincts} okrsků 2026${mapWarnings(r).map((w) => `; ${w}`).join('')}`);
    }, { log: out, error });
    return res;
}

async function mapsOnlyMain(councils, reg2026) {
    const rzc = csvFromZip(reg2026, 'kvrzcoco.csv');
    let layer = null;
    const geo = () => {
        layer ??= JSON.parse(readFileSync(cacheFile(URLS.okrsky), 'utf8'));
        return layer;
    };
    if (councils.some((c) => c.map)) await download(URLS.okrsky, { fresh }); // jen kvůli cache; nic dalšího se nestahuje
    const res = await buildMapsOnly(councils, {
        geo,
        rzc,
        read: async (c) => {
            try {
                return JSON.parse(await fs.readFile(path.join(outputDirs(c, true).dataDir, 'okrsky.geojson'), 'utf8'));
            } catch {
                return null;
            }
        },
        write: (c, data) => writeJson(path.join(outputDirs(c, true).dataDir, 'okrsky.geojson'), data),
    });
    process.exitCode = res.exitCode;
}

// Přehled (/) potřebuje za každé zastupitelstvo jen kandidátky (zkratky,
// barvy, počty kandidátů) a výchozí stav 2022 — skládá se z hotových
// lists.json, aby šel přegenerovat i po `npm run data -- <slug>`
async function buildOverview() {
    const out = {};
    for (const council of COUNCILS) {
        let data;
        try {
            data = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data', council.slug, 'lists.json'), 'utf8'));
        } catch {
            console.warn(`  ! přehled: chybí data ${council.slug}`);
            continue;
        }
        const votes2022 = data.lists2022.reduce((s, l) => s + l.votes, 0);
        const old = new Map(data.lists2022.map((l) => [l.id, l]));
        const owners = (id) => data.lists.filter((l) => l.split?.some((x) => x.id === id)).length || 1;
        out[council.zastup] = {
            votes2022,
            lists: data.lists.map((l) => {
                const ids = l.baseline?.ids || null;
                return {
                    id: l.id,
                    short30: l.short30,
                    short8: l.short8,
                    color: l.color,
                    members: l.members,
                    candidates: l.candidates,
                    baselineLabel: l.baseline?.label || null,
                    pct2022: ids && votes2022 ? round2((ids.reduce((s, id) => s + (old.get(id)?.votes || 0), 0) / votes2022) * 100) : null,
                    // jen pro demo: rozdělená kandidátka 2022 dílem mezi nástupce
                    est2022: !ids && l.split && votes2022
                        ? round2(l.split.reduce((s, x) => s + (old.get(x.id)?.votes || 0) / owners(x.id), 0) / votes2022 * 100)
                        : undefined,
                    seats2022: ids ? ids.reduce((s, id) => s + (old.get(id)?.seats || 0), 0) : null,
                };
            }),
        };
    }
    await writeJson(path.join(ROOT, 'public/data/prehled.json'), { generated: new Date().toISOString(), councils: out });
    log(`\npřehled: ${Object.keys(out).length} zastupitelstev`);
}

async function buildCouncil(council, { ros2026, rk2026, ros2022, t3, hl, geo, rzc2026, partyInfo }) {
    const z = String(council.zastup);
    const { dataDir, mediaDir } = outputDirs(council, MESTA);
    const warnings = []; // jen produkt „mesta“: co chybí / co se nahradilo
    // Vygenerovaná média smazat (vlastní fotky z councils.js zůstávají)
    // (mesta: logos.tmp, přepíše se až na konci — viz stageLogosDir)
    let logosDir = path.join(mediaDir, 'logos');
    if (MESTA) {
        logosDir = await stageLogosDir(mediaDir);
    } else {
        await fs.rm(logosDir, { recursive: true, force: true });
        await fs.mkdir(logosDir, { recursive: true });
    }
    if (!MESTA) {
        await fs.mkdir(path.join(mediaDir, 'photos'), { recursive: true });
        for (const f of await fs.readdir(path.join(mediaDir, 'photos'))) {
            if (f.startsWith('pdv-')) await fs.rm(path.join(mediaDir, 'photos', f));
        }
    }

    // --- programydovoleb.cz: loga/barvy kandidátek, fotky kandidátů
    // (mesta: výpadek programydovoleb.cz se toleruje — loga a barvy pak z palety)
    let pdv;
    if (MESTA) {
        try {
            pdv = (await downloadJson(URLS.pdvElection(z), { fresh, delayMs: PDV_DELAY })).list[0];
            if (!pdv) throw new Error('prázdná odpověď');
        } catch (err) {
            warnings.push(`programydovoleb.cz nedostupné (${err.message})`);
            console.warn(`  ! programydovoleb.cz: ${err.message}`);
            pdv = { $strany: [], $kandidati: [] };
        }
    } else {
        pdv = (await downloadJson(URLS.pdvElection(z), { fresh, delayMs: PDV_DELAY })).list[0];
    }
    const pdvLists = new Map(pdv.$strany.filter((s) => String(s.KODZASTUP) === z).map((s) => [Number(s.POR_STR_HL), s]));
    const pdvCands = pdv.$kandidati.filter((k) => String(k.KODZASTUP) === z);

    // --- kandidátky 2026
    const lists = ros2026
        .filter((r) => r.KODZASTUP === z)
        .map((r) => ({
            id: Number(r.POR_STR_HL),
            vstrana: Number(r.VSTRANA),
            name: r.NAZEVCELK,
            short30: r.ZKRATKAO30,
            short8: r.ZKRATKAO8,
            slozeni: codes(r.SLOZENI),
        }))
        .sort((a, b) => a.id - b.id);
    log(`${lists.length} kandidátek`);

    // --- KV 2022: kandidátky, mandáty, okrskové výsledky
    const lists2022 = ros2022
        .filter((r) => r.KODZASTUP === z && (!r.DATUMVOLEB || r.DATUMVOLEB === DATE_2022))
        .map((r) => ({
            id: r.POR_STR_HL,
            name: r.NAZEVCELK,
            short: r.ZKRATKAO30,
            slozeni: codes(r.SLOZENI),
            votes: Number(r.HLASY_STR) || 0,
            pct: Number(String(r.PROCHLSTR).replace(',', '.')) || 0,
            seats: Number(r.MAND_STR) || 0,
        }));
    const seatsTotal2022 = lists2022.reduce((s, l) => s + l.seats, 0);

    const meta = t3.filter((r) => r.KODZASTUP === z && r.DATUMVOLEB === DATE_2022);
    const keyOf = (obec, okrsek, typ) => `${obec}|${okrsek}|${typ}`;
    const okrsky2022 = {};
    const metaKeys = new Map();
    for (const m of meta) {
        okrsky2022[m.OKRSEK] = {
            voters: Number(m.VOL_SEZNAM) || 0,
            envelopes: Number(m.VYD_OBALKY) || 0,
            validVotes: Number(m.PL_HL_CELK) || 0,
            votes: {},
        };
        metaKeys.set(keyOf(m.OBEC, m.OKRSEK, m.TYPZASTUP), m.OKRSEK);
    }
    const col = (name) => hl.header.indexOf(name);
    const [cDate, cObec, cOkrsek, cTyp, cList, cVotes] = ['DATUMVOLEB', 'OBEC', 'OKRSEK', 'TYPZASTUP', 'POR_STR_HL', 'POC_HLASU'].map(col);
    for (const row of hl.rows) {
        if (row[cDate] !== DATE_2022) continue;
        const okrsek = metaKeys.get(keyOf(row[cObec], row[cOkrsek], row[cTyp]));
        if (!okrsek) continue;
        okrsky2022[okrsek].votes[row[cList]] = Number(row[cVotes]) || 0;
    }
    log(`KV 2022: ${lists2022.length} kandidátek, ${seatsTotal2022} mandátů, ${Object.keys(okrsky2022).length} okrsků`);
    for (const l of lists2022) if (l.seats) log(`  2022 ${l.id.padStart(2)} ${l.short.padEnd(32)} ${l.seats} mand.`);

    if (MESTA) {
        if (!lists2022.length) warnings.push('chybí kandidátky KV 2022');
        if (!Object.keys(okrsky2022).length) warnings.push('chybí okrskové výsledky KV 2022');
    }
    mapPredecessors(lists, lists2022);
    if (MESTA) {
        for (const l of lists) {
            if (!l.baseline && l.slozeni.includes(PIRATES_CODE)) warnings.push(`kandidátka ${l.id} (Piráti): bez přímého srovnání s 2022 (${l.split ? 'rozdělená' : 'nová'})`);
        }
    }
    for (const l of lists) {
        const how = l.baseline ? `${l.baseline.exact ? '=' : '≈'} ${l.baseline.label}${l.baseline.byName ? ' (podle názvu)' : ''}` : l.split ? `rozdělené: ${l.split.map((s) => s.label).join(' / ')}` : 'nová';
        log(`  2026 ${String(l.id).padStart(2)} ← ${how}`);
    }

    // Barvy a loga. Barvy se přidělují podle váhy kandidátky (Piráti první,
    // pak podle hlasů předchůdce v roce 2022) — velké strany si tak nechají
    // svou barvu a podobné barvy dostanou až malé kandidátky. Ruční barvy
    // z councils.js mají přednost.
    const weight = (l) => (l.slozeni.includes(PIRATES_CODE) || council.lists?.[l.id]?.color ? Infinity
        : (l.baseline?.ids || l.split?.map((s) => s.id) || [])
            .reduce((s, id) => s + (lists2022.find((k) => k.id === id)?.votes || 0), 0));
    const usedColors = [];
    let generated = 0;
    for (const l of [...lists].sort((a, b) => weight(b) - weight(a) || a.id - b.id)) {
        const p = pdvLists.get(l.id);
        const memberCodes = l.slozeni.filter((c) => c !== NK);
        const members = [];
        for (const code of l.slozeni) {
            const info = await partyInfo(code);
            members.push({ code, short: code === NK ? 'NK' : info?.ZKRATKA || String(code) });
        }

        // Barva: ruční výjimka → Piráti černí → kandidátka → členská strana → paleta
        // (mesta: téměř bílá barva z programydovoleb.cz se zahodí → další zdroj, nakonec paleta)
        const dropWhite = (c) => {
            if (MESTA && c && isNearWhite(normalizeColor(c))) {
                warnings.push(`kandidátka ${l.id}: světlá barva ${c} nahrazena`);
                return null;
            }
            return c;
        };
        let color = council.lists?.[l.id]?.color
            || (l.slozeni.includes(PIRATES_CODE) ? '#000000' : dropWhite(pick(p?.$data, 'color')));
        if (!color) {
            for (const code of memberCodes) {
                color = dropWhite(pick((await partyInfo(code))?.$data, 'color'));
                if (color) break;
            }
        }
        color = normalizeColor(color);
        const free = (c) => !usedColors.some((u) => colorDistance(u, c) < 55);
        if (!color || !free(color)) {
            color = FALLBACK_COLORS.find(free) || null;
            // Paleta došla (Magistrát, 24 kandidátek) → další odstíny dopočítat
            while (!color) {
                const c = hslToHex((generated++ * 137.5) % 360, 45, 55);
                if (free(c)) color = c;
            }
        }
        usedColors.push(color);

        // Loga: vlastní logo kandidátky z programydovoleb.cz (i u společných
        // kandidátek s Piráty — EDITA PRO PRAHU 3, MY pro Prahu 14…) → loga
        // členských stran (max 3, Piráti první: Piráti + STAN). Čistě pirátská
        // kandidátka bez vlastního loga tak dostane pirátskou vlajku.
        let logoUrls = [pick(p?.$data, 'logo')].filter(Boolean);
        if (!logoUrls.length) {
            const byPirates = [...memberCodes].sort((a, b) => (b === PIRATES_CODE) - (a === PIRATES_CODE));
            for (const code of byPirates.slice(0, 3)) {
                const url = pick((await partyInfo(code))?.$data, 'logo');
                if (url) logoUrls.push(url);
            }
        }
        l.logos = [];
        for (const [i, url] of logoUrls.entries()) {
            const file = await saveMedia(url, logosDir, `${l.id}-${i}`, 'logo');
            if (file) l.logos.push(`/media/${council.slug}/logos/${file}`);
        }
        l.color = color;
        l.members = members;
        l.web = pick(p?.$data, 'web');
    }
    for (const l of lists) log(`  ${String(l.id).padStart(2)} ${l.short30.slice(0, 32).padEnd(32)} ${l.color} loga: ${l.logos.length}`);
    if (MESTA) {
        const noLogo = lists.filter((l) => !l.logos.length).map((l) => l.id);
        if (noLogo.length) warnings.push(`bez loga: kandidátky ${noLogo.join(',')} z ${lists.length}`);
    }

    // --- kandidáti (jména z registru, štítky stran z jmenného seznamu)
    let jmsez = null;
    try {
        jmsez = await downloadJson(URLS.jmsez(council.okres, z), { fresh, delayMs: MESTA ? JMSEZ_DELAY : 0 });
    } catch (err) {
        console.warn(`  ! jmenný seznam: ${err.message}`);
        if (MESTA) warnings.push(`jmenný seznam nedostupný (${err.message})`);
    }
    const parties = {};
    let photos = 0;
    for (const l of lists) {
        const labels = new Map((jmsez?.platni?.[l.id]?.seznam || []).map((r) => [Number(r[0]), r]));
        const candidates = [];
        for (const c of rk2026.filter((r) => r.KODZASTUP === z && Number(r.POR_STR_HL) === l.id && r.PLATNOST === 'A')) {
            const n = Number(c.PORCISLO);
            const own = council.photos?.[l.id]?.[n];
            let photo = own ? `/media/${council.slug}/photos/${own}` : null;
            if (!photo && !(MESTA && council.candidatePhotos === false)) {
                const k = pdvCands.find((x) => Number(x.POR_STR_HL) === l.id && Number(x.PORCISLO) === n);
                const url = pick(k?.$data, 'photo');
                const file = url ? await saveMedia(url, path.join(mediaDir, 'photos'), `pdv-${l.id}-${n}`, 'photo') : null;
                if (file) photo = `/media/${council.slug}/photos/${file}`;
            }
            if (photo) photos++;
            candidates.push({
                n,
                jmeno: c.JMENO,
                prijmeni: c.PRIJMENI,
                titulPred: c.TITULPRED || '',
                titulZa: c.TITULZA || '',
                vek: Number(c.VEK),
                povolani: c.POVOLANI,
                navrh: labels.get(n)?.[3] || '',
                prislusnost: labels.get(n)?.[4] || '',
                photo,
            });
        }
        parties[l.id] = { candidates: candidates.sort((a, b) => a.n - b.n) };
        l.candidates = candidates.length;
    }
    log(`kandidáti: ${Object.values(parties).reduce((s, p) => s + p.candidates.length, 0)}, s fotkou ${photos}`);

    // --- hranice okrsků (mesta: jen města s mapou, ostatní prázdná kolekce)
    let mapResult = null;
    let features;
    if (MESTA) {
        mapResult = council.map ? townMapFeatures(geo, council, precinctIdsOf(rzc2026, council.zastup), precinctDistrictsOf(rzc2026, council.zastup)) : null;
        features = mapResult ? mapResult.features : [];
    } else {
        features = geo.features
            .filter((f) => (council.magistrat
                ? String(f.properties.kod_obec) === z
                : String(f.properties.kod_mco) === z))
            .map((f) => simplify({
                type: 'Feature',
                properties: { cislo: Number(f.properties.cislo), mco: f.properties.naz_mco || null },
                geometry: reproject(f.geometry),
            }, { tolerance: 0.00003, highQuality: true }));
    }
    if (MESTA) {
        const n2022 = Object.keys(okrsky2022).length;
        if (n2022 && n2022 !== council.precincts) warnings.push(`okrsků 2022: ${n2022}, 2026: ${council.precincts}`);
        if (mapResult) warnings.push(...mapWarnings(mapResult));
    } else {
        const missing = Object.keys(okrsky2022).length && council.precincts !== features.length
            ? ` (ČSÚ 2026 uvádí ${council.precincts})` : '';
        log(`okrsky: ${features.length} polygonů${missing}`);
    }

    // mesta: všechno je spočítané → teprve teď nahradit staré logos novými
    if (MESTA) await commitLogosDir(mediaDir);
    await writeJson(path.join(dataDir, 'lists.json'), {
        generated: new Date().toISOString(),
        zastup: council.zastup,
        slug: council.slug,
        name: council.name,
        lists,
        lists2022,
        seatsTotal2022,
    });
    await writeJson(path.join(dataDir, 'kandidati.json'), { parties });
    await writeJson(path.join(dataDir, 'results2022.json'), { okrsky: okrsky2022 });
    await writeJson(path.join(dataDir, 'okrsky.geojson'), MESTA ? (mapResult ? mapGeoFile(mapResult) : emptyGeo()) : { type: 'FeatureCollection', features });
    return warnings;
}

// Předchůdci kandidátek: kandidátka 2026 ← kandidátky 2022 se společnou
// stranou (podle složení, bez nezávislých). Když se strana 2022 rozdělila
// mezi víc kandidátek 2026 (KDU-ČSL + ODS → letos každá jinde), srovnání
// v p. b. by lhalo — kandidátka dostane jen informační „split".
// Sdružení nezávislých stranu nemají (PRAHA 7 SOBĚ, SOS Suchdol…) — ta se
// párují podle stejného názvu s kandidátkou 2022, kterou nikdo jiný nemá.
function mapPredecessors(lists, lists2022) {
    const set = (codesList) => new Set(codesList.filter((c) => c !== NK));
    const sets26 = new Map(lists.map((l) => [l.id, set(l.slozeni)]));
    const olds = lists2022.map((k) => ({ ...k, set: set(k.slozeni) }));
    const shares = (a, b) => [...a].some((c) => b.has(c));
    const owners = new Map(olds.map((k) => [k.id, [...sets26].filter(([, S]) => shares(k.set, S)).map(([id]) => id)]));

    for (const l of lists) {
        const S = sets26.get(l.id);
        const related = olds.filter((k) => shares(k.set, S));
        l.baseline = null;
        l.split = null;
        if (!related.length) continue;
        if (related.some((k) => owners.get(k.id).length > 1)) {
            l.split = related.map((k) => ({ id: k.id, label: k.short }));
            continue;
        }
        const covered = new Set(related.flatMap((k) => [...k.set]));
        const exact = [...S].every((c) => covered.has(c)) && related.every((k) => [...k.set].every((c) => S.has(c)));
        l.baseline = { ids: related.map((k) => k.id), label: related.map((k) => k.short).join(' + '), exact };
    }

    // Jen jednoznačné páry: kandidátka 2026 se jménem shoduje s jedinou volnou
    // kandidátkou 2022 a tu jménem nechce žádná jiná kandidátka 2026
    const taken = new Set(lists.flatMap((l) => [...(l.baseline?.ids || []), ...(l.split || []).map((s) => s.id)]));
    const norm = (s) => slugify(s).replace(/-/g, ' ');
    const byName = new Map(lists.filter((l) => !l.baseline && !l.split).map((l) => {
        const names = new Set([norm(l.name), norm(l.short30)]);
        return [l, olds.filter((k) => !taken.has(k.id) && (names.has(norm(k.name)) || names.has(norm(k.short))))];
    }));
    const wanted = (id) => [...byName.values()].filter((same) => same.some((k) => k.id === id)).length;
    for (const [l, same] of byName) {
        if (same.length !== 1 || wanted(same[0].id) !== 1) continue;
        l.baseline = { ids: [same[0].id], label: same[0].short, exact: false, byName: true };
    }
}

const round2 = (n) => Math.round(n * 100) / 100;

function reproject(geometry) {
    const ring = (coords) => coords.map(([x, y]) => toWgs.forward([x, y]).map((v) => Math.round(v * 1e5) / 1e5));
    if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: geometry.coordinates.map(ring) };
    if (geometry.type === 'MultiPolygon') {
        return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(ring)) };
    }
    throw new Error(`Neznámý typ geometrie ${geometry.type}`);
}

// Média se zmenší a převedou na WebP — originály z programydovoleb.cz mají
// stovky kB, na mobilu ve volební noc zbytečně
async function saveMedia(url, dir, base, kind) {
    try {
        const file = `${base}.webp`;
        const input = await download(url, { fresh, delayMs: PDV_DELAY });
        const img = sharp(input, { density: 200 });
        const out = kind === 'logo'
            ? img.resize({ width: 320, height: 160, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 })
            : img.resize({ width: 240, height: 360, fit: 'cover', position: 'top' }).webp({ quality: 78 });
        const buf = await out.toBuffer();
        await fs.writeFile(path.join(dir, file), buf);
        // Logo se může vyměnit pod stejným jménem (1-0.webp) a /media/* se
        // cachuje den — otisk obsahu v adrese, ať prohlížeč nevezme staré
        return kind === 'logo' ? `${file}?v=${createHash('sha1').update(buf).digest('hex').slice(0, 8)}` : file;
    } catch (err) {
        console.warn(`  ! ${url}: ${err.message}`);
        return null;
    }
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function normalizeColor(c) {
    if (!c) return null;
    let h = String(c).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : null;
}

function colorDistance(a, b) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [rgb(a), rgb(b)];
    return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
}

// Spustit jen při přímém volání (testy importují runMesta, parseArgs… bez side-effectů)
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
