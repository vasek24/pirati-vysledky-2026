#!/usr/bin/env node
// Export základu KV 2022 pro soukromou analýzu: analysis-private/2022/<slug>.json
//   node scripts/analysis/export-2022.mjs [--out <dir>]
// Zdroj: public/data/<slug>/results2022.json (okrskové výsledky 2022 z open dat
// ČSÚ, vytvořené `npm run data`) a lists.json (kandidátky 2026 + předchůdci
// z 2022) — stejné soubory, ze kterých čerpá aplikace i demo simulace.
// Stahuje se nic; všechno je v repu offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PIRATES_CODE, councilBySlug } from '../../src/councils.js';
import { baselineShare } from '../../src/volby/compute.js';
import { DEFAULT_OUT } from './record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TARGETS = [
    { out: 'magistrat', slug: 'praha' },
    { out: 'praha-9', slug: 'praha-9' },
];
const r2 = (n) => Math.round(n * 100) / 100;

// Čistá funkce: results2022 + lists.json (+ council z councils.js) -> baseline
export function buildBaseline({ council, lists, results2022, now = new Date() }) {
    const okrsky = results2022.okrsky || {};
    const lists2026 = lists.lists.map((l) => {
        const slozeni = l.slozeni || [];
        return {
            id: l.id,
            name: l.name,
            short: l.short8,
            vstrana: l.vstrana,
            candidates: l.candidates ?? null,
            slozeni,
            pirate: slozeni.includes(PIRATES_CODE) || l.vstrana === PIRATES_CODE || council.pirates === l.id,
            // předchůdci na kandidátkách 2022 (ids = čísla kandidátek 2022); null = bez přímého předchůdce
            predecessors2022: l.baseline ? { ids: l.baseline.ids.map(String), label: l.baseline.label, exact: !!l.baseline.exact } : null,
            split2022: l.split || null,
            share2022Pct: l.baseline ? r2(baselineShare(results2022, l.baseline.ids) ?? 0) : null,
        };
    });
    const lists2022 = lists.lists2022.map((l) => ({
        id: String(l.id), name: l.name, short: l.short, slozeni: l.slozeni, votes: l.votes, pct: l.pct, seats: l.seats,
    }));
    const partyVotes = {};
    let voters = 0;
    let envelopes = 0;
    let validVotes = 0;
    const precincts = {};
    for (const [id, o] of Object.entries(okrsky)) {
        voters += o.voters || 0;
        envelopes += o.envelopes || 0;
        validVotes += o.validVotes || 0;
        for (const [pid, v] of Object.entries(o.votes || {})) partyVotes[pid] = (partyVotes[pid] || 0) + v;
        // votes2026Equiv: hlasy předchůdců přepočtené na kandidátky 2026 (kde existuje předchůdce)
        const votes2026Equiv = {};
        for (const l of lists2026) {
            if (l.predecessors2022) votes2026Equiv[l.id] = l.predecessors2022.ids.reduce((s, p) => s + (o.votes?.[p] || 0), 0);
        }
        precincts[id] = {
            voters: o.voters ?? null,
            envelopes: o.envelopes ?? null,
            turnoutPct: o.voters ? r2((o.envelopes / o.voters) * 100) : null,
            validVotes: o.validVotes ?? null,
            votes: o.votes || {},
            votes2026Equiv,
        };
    }
    const piratesList = lists2026.find((l) => l.pirate);
    return {
        v: 1,
        what: 'Základ KV 2022 pro soukromou analýzu (nikdy nezveřejňovat)',
        source: `public/data/${council.slug}/{results2022,lists}.json (open data ČSÚ KV 2022), vytvořeno ${now.toISOString()}`,
        slug: council.slug,
        zastup: council.zastup,
        name: council.name,
        seats2026: council.seats,
        seats2022: lists.seatsTotal2022,
        precinctsCount2022: Object.keys(precincts).length,
        precinctsCount2026: council.precincts,
        notes: [
            'Okrsky 2022 a 2026 se nemusí shodovat 1:1 (počet okrsků je jiný) — okrsek přiřazuj podle klíče, chybějící/nové okrsky nemají základ.',
            'votes = hlasy pro kandidátku 2022 (klíč = číslo kandidátky 2022, ne 2026). votes2026Equiv = totéž sečtené podle předchůdců kandidátky 2026.',
            'validVotes = platné hlasy (u zastupitelstev s více hlasy na voliče násobek počtu voličů), turnoutPct = obálky / voliči.',
            'Kandidátky bez předchůdce (predecessors2022 = null) nemají srovnání s 2022.',
        ],
        totals2022: {
            voters,
            envelopes,
            turnoutPct: voters ? r2((envelopes / voters) * 100) : null,
            validVotes,
            partyVotes,
        },
        piratesList2026: piratesList ? { id: piratesList.id, predecessors2022: piratesList.predecessors2022 } : null,
        lists2026,
        lists2022,
        precincts,
    };
}

export function run({ outDir = DEFAULT_OUT, root = ROOT } = {}) {
    const dir = path.join(outDir, '2022');
    fs.mkdirSync(dir, { recursive: true });
    const written = [];
    for (const t of TARGETS) {
        const base = path.join(root, 'public/data', t.slug);
        const data = buildBaseline({
            council: councilBySlug(t.slug),
            lists: JSON.parse(fs.readFileSync(path.join(base, 'lists.json'), 'utf8')),
            results2022: JSON.parse(fs.readFileSync(path.join(base, 'results2022.json'), 'utf8')),
        });
        const file = path.join(dir, `${t.out}.json`);
        fs.writeFileSync(file, `${JSON.stringify(data)}\n`);
        written.push(`${file} (${data.precinctsCount2022} okrsků)`);
    }
    return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const i = process.argv.indexOf('--out');
    for (const w of run({ outDir: i > 0 ? path.resolve(process.argv[i + 1]) : DEFAULT_OUT })) console.log(w);
}
