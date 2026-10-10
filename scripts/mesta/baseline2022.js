// Výsledek Pirátů (nebo kandidátky, která je dnes nahrazuje) v KV 2022 pro řádky
// indexu mesta.dg12.cz — počítá se stejně jako na stránce města (src/volby/model.js:
// baselineShare přes všechny okrsky, mandáty ze `lists2022`), ale předem, aby index
// nestahoval 81 souborů. Výstup: src/mesta/baseline2022.generated.json
//   { [zastup]: { pct, seats, label } | null }
//   pct    % platných hlasů v celém zastupitelstvu 2022 (2 desetinná místa)
//   seats  mandáty v roce 2022 (součet za sloučené kandidátky) nebo null
//   label  null = stejná kandidátka jako dnes („přesná" shoda);
//          jinak název kandidátky z roku 2022, ze které dnešní vznikla / kterou Piráti tehdy
//          podporovali (nepřesná shoda), nebo „Česká pirátská strana" při rozdělení
//   null   bez srovnatelného výsledku (nová kandidátka, Piráti nekandidují)
//
//   node scripts/mesta/baseline2022.js           zapíše JSON
//   node scripts/mesta/baseline2022.js --check   jen porovná s uloženým (exit 1 při rozdílu)
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/util.js';
import { baselineShare } from '../../src/volby/compute.js';

export const OUT = path.join(ROOT, 'src/mesta/baseline2022.generated.json');
const PIRATES_CODE = 720;
const round2 = (n) => Math.round(n * 100) / 100;

const seatsOf = (lists2022, ids) => {
    if (!Array.isArray(lists2022)) return null;
    return ids.reduce((s, id) => s + (lists2022.find((l) => String(l.id) === String(id))?.seats || 0), 0);
};

// lists = lists.json, results2022 = results2022.json, pirates = kód kandidátky Pirátů (council.pirates)
export function baselineFor({ pirates, lists, results2022 }) {
    if (pirates === null || pirates === undefined) return null;
    const list = lists?.lists?.find((l) => l.id === pirates);
    if (!list) return null;
    const lists2022 = lists.lists2022;
    const entry = (ids, label) => {
        const pct = baselineShare(results2022, ids);
        return pct === null ? null : { pct: round2(pct), seats: seatsOf(lists2022, ids), label };
    };
    if (list.baseline?.ids?.length) return entry(list.baseline.ids, list.baseline.exact ? null : list.baseline.label);
    // kandidátky se letos spojily: ukáže se, co tehdy získali samotní Piráti
    const own = (list.split || []).find((s) => lists2022?.find((l) => String(l.id) === String(s.id))?.slozeni?.includes(PIRATES_CODE));
    return own ? entry([own.id], own.label) : null;
}

export function buildBaselines(councils, readData) {
    const out = {};
    for (const c of [...councils].sort((a, b) => a.zastup - b.zastup)) {
        const { lists, results2022 } = readData(c.slug);
        out[c.zastup] = baselineFor({ pirates: c.pirates, lists, results2022 });
    }
    return out;
}

export const serialize = (obj) => `${JSON.stringify(obj, null, 1)}\n`;

async function main() {
    const { loadMestaCouncils } = await import('../build-data.js');
    const councils = await loadMestaCouncils();
    const cache = new Map();
    for (const c of councils) {
        const dir = path.join(ROOT, 'public-mesta/data', c.slug);
        const [lists, results2022] = await Promise.all(['lists.json', 'results2022.json'].map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))));
        cache.set(c.slug, { lists, results2022 });
    }
    const text = serialize(buildBaselines(councils, (slug) => cache.get(slug)));
    if (process.argv.includes('--check')) {
        const current = await fs.readFile(OUT, 'utf8').catch(() => '');
        if (current !== text) {
            console.error('baseline2022.generated.json je zastaralý — spusťte: node scripts/mesta/baseline2022.js');
            process.exit(1);
        }
        console.log('baseline2022 OK');
        return;
    }
    await fs.writeFile(OUT, text);
    console.log(`baseline2022: ${councils.length} měst → ${path.relative(ROOT, OUT)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) main();
