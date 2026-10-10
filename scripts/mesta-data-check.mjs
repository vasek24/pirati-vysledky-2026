// Kontrola dat produktu „mesta“: každé publikované město musí mít v public-mesta/data/<slug>/
// čitelné lists.json, kandidati.json a results2022.json se shodným slugem a zastupem.
//   node scripts/mesta-data-check.mjs     (exit 1 při jakémkoli problému)
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/util.js';

const FILES = ['lists.json', 'kandidati.json', 'results2022.json'];
const diskRead = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

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
        const lists = parsed['lists.json'];
        if (lists) {
            if (lists.slug !== t.slug) problems.push(`${t.slug}: lists.json má slug ${JSON.stringify(lists.slug)}`);
            if (String(lists.zastup) !== String(t.zastup)) problems.push(`${t.slug}: lists.json má zastup ${JSON.stringify(lists.zastup)}, čekáno ${t.zastup}`);
        }
    }
    return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    const towns = JSON.parse(await fs.readFile(path.join(ROOT, 'src/mesta/towns.generated.json'), 'utf8'));
    const problems = await checkData({ dir: path.join(ROOT, 'public-mesta'), towns });
    if (problems.length) {
        for (const p of problems) console.error(`  ✗ ${p}`);
        console.error(`mesta data check: ${problems.length} problémů`);
        process.exit(1);
    }
    console.log(`mesta data check: OK ${towns.length} towns`);
}
