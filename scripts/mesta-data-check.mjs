// Kontrola dat produktu „mesta“: každé publikované město musí mít v public-mesta/data/<slug>/
// čitelné lists.json, kandidati.json a results2022.json se shodným slugem a zastupem a okrsky.geojson:
// město s mapou (`map`) neprázdnou FeatureCollection s jedinečnými celými čísly `cislo`,
// ostatní města prázdnou.
//   node scripts/mesta-data-check.mjs     (exit 1 při jakémkoli problému)
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/util.js';
import { buildCouncils } from '../src/mesta/buildCouncils.js';

const FILES = ['lists.json', 'kandidati.json', 'results2022.json', 'okrsky.geojson'];
const diskRead = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

function geoProblems(slug, geo, map) {
    if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) return [`${slug}: okrsky.geojson není FeatureCollection`];
    if (!map) return geo.features.length ? [`${slug}: okrsky.geojson má ${geo.features.length} polygonů, město nemá mapu — má být prázdný`] : [];
    if (!geo.features.length) return [`${slug}: okrsky.geojson je prázdný, město s mapou potřebuje alespoň 1 polygon okrsku`];
    const problems = [];
    const seen = new Set();
    for (const [i, f] of geo.features.entries()) {
        const id = f?.properties?.cislo;
        if (typeof id !== 'number' || !Number.isInteger(id)) {
            problems.push(`${slug}: okrsky.geojson polygon #${i} nemá celé číslo cislo (${JSON.stringify(id)})`);
        } else if (seen.has(id)) {
            problems.push(`${slug}: okrsky.geojson má okrsek ${id} dvakrát`);
        } else seen.add(id);
    }
    return problems;
}

/** @returns {Promise<string[]>} seznam problémů (prázdný = v pořádku) */
export async function checkData({ dir, towns, readJson = diskRead }) {
    const problems = [];
    for (const t of towns) {
        const parsed = {};
        for (const f of FILES) {
            const file = path.join(dir, 'data', t.slug, f);
            try {
                parsed[f] = await readJson(file);
            } catch (err) {
                problems.push(`${t.slug}: ${f} chybí nebo je nečitelný (${err.code || err.message})`);
            }
        }
        if (parsed['okrsky.geojson'] !== undefined) problems.push(...geoProblems(t.slug, parsed['okrsky.geojson'], t.map === true));
        const lists = parsed['lists.json'];
        if (lists) {
            if (lists.slug !== t.slug) problems.push(`${t.slug}: lists.json má slug ${JSON.stringify(lists.slug)}`);
            if (String(lists.zastup) !== String(t.zastup)) problems.push(`${t.slug}: lists.json má zastup ${JSON.stringify(lists.zastup)}, čekáno ${t.zastup}`);
        }
    }
    return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    // `map` bere z buildCouncils (featured + overrides), stejně jako Worker a aplikace
    const read = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, 'src/mesta', f), 'utf8'));
    const [generated, specifics] = await Promise.all([read('towns.generated.json'), read('specifics.generated.json')]);
    const overrides = (await import('../src/mesta/overrides.js')).default;
    const towns = buildCouncils(generated, specifics, overrides);
    const problems = await checkData({ dir: path.join(ROOT, 'public-mesta'), towns });
    if (problems.length) {
        for (const p of problems) console.error(`  ✗ ${p}`);
        console.error(`mesta data check: ${problems.length} problémů`);
        process.exit(1);
    }
    console.log(`mesta data check: OK ${towns.length} towns`);
}
