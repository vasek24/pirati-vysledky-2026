// Porovná naše API s API původního trackeru (jsemfast) pro 11 radnic + přehled.
// Použití: node scripts/compare-original.mjs [naseUrl] [puvodniUrl]
// Výchozí: https://praha.dg12.cz vs. původní produkce z README.
// Vypíše u každého feedu: počet sečtených okrsků, čas dat (generated), součty hlasů stran
// a rozdíly. Menší rozdíl v čase dat (do ~1 min) je normální: každý ze serverů se ptá ČSÚ
// v jiný okamžik. Rozdíl v hlasech při STEJNÉM `generated` je chyba.
const ours = process.argv[2] || 'https://praha.dg12.cz';
const orig = process.argv[3] || 'https://pirati-vysledky-2026.pirati-vysledky-2026-cloudflare.workers.dev';
const KEYS = [554782, 500119, 500224, 500208, 500178, 500143, 547034, 500097, 539694, 547107, 500216];

async function get(base, path) {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${base}${path} -> ${res.status}`);
    return res.json();
}

const partyVotes = (d) => Object.fromEntries((d.parties || []).map((p) => [p.id ?? p.name, p.votes ?? p.hlasy ?? 0]));

let problems = 0;
for (const z of KEYS) {
    const path = `/api/volby?z=${z}`;
    try {
        const [a, b] = await Promise.all([get(ours, path), get(orig, path)]);
        const sameGenerated = a.generated === b.generated;
        const va = partyVotes(a);
        const vb = partyVotes(b);
        const diffs = Object.keys({ ...va, ...vb }).filter((k) => (va[k] || 0) !== (vb[k] || 0));
        const flag = sameGenerated && (diffs.length || a.precincts?.counted !== b.precincts?.counted) ? 'CHYBA' : 'ok';
        if (flag === 'CHYBA') problems++;
        console.log(`${String(z).padEnd(7)} ${flag.padEnd(6)} counted ${a.precincts?.counted}/${a.precincts?.total} vs ${b.precincts?.counted}/${b.precincts?.total}`
            + ` · generated ${a.generated} vs ${b.generated}${sameGenerated ? '' : ' (různý čas dat)'}`
            + (diffs.length ? ` · stran s rozdílem: ${diffs.length}` : ''));
    } catch (e) {
        problems++;
        console.log(`${String(z).padEnd(7)} ERR    ${e.message}`);
    }
}
try {
    const [a, b] = await Promise.all([get(ours, '/api/prehled'), get(orig, '/api/prehled')]);
    const same = a.generated === b.generated;
    const flag = same && a.precincts?.counted !== b.precincts?.counted ? 'CHYBA' : 'ok';
    if (flag === 'CHYBA') problems++;
    console.log(`prehled ${flag.padEnd(6)} counted ${a.precincts?.counted}/${a.precincts?.total} vs ${b.precincts?.counted}/${b.precincts?.total} · generated ${a.generated} vs ${b.generated}`);
} catch (e) {
    problems++;
    console.log(`prehled ERR    ${e.message}`);
}
console.log(problems ? `\n${problems} problém(ů)` : '\nvše sedí');
process.exit(problems ? 1 : 0);
