// Reporty a extrakt generátoru registru "mesta" (čisté funkce: vstup = data, výstup = texty; zápis na disk dělá CLI).
//   - docs/analysis/mesta-specifics.md        přehledová tabulka pro majitele (česky) + body k rozhodnutí
//   - docs/analysis/mesta-list-verification.md ověření seznamu měst majitele (potvrzená / zamítnutá / navíc)
//   - docs/analysis/mesta-extract/*            podklady, podle kterých Codex offline ověří generátor (spec §4.2, §6.2)
import { codes } from '../lib/util.js';
import {
    PIRATES_CODE, NK_CODE, BAND_AUTO, BAND_BORDERLINE, czechCompare, wholeCouncils, excludedReason, commaDecimal, spaced,
} from './registryCore.js';
import { isShown } from '../../src/mesta/buildCouncils.js';

const PIRATES_LABEL = 'Piráti';

// ---------------------------------------------------------------- malé pomocné funkce

// Pásmo počtu obyvatel podle spec §4.1 (vstup pro příznak population-band-differs)
export function bandOf(n) {
    if (n >= BAND_AUTO) return 'ge10k';
    if (n >= BAND_BORDERLINE) return '7to10k';
    return 'lt7k';
}

// Řádky jmenného seznamu (jmsez) se štítkem příslušnosti "Piráti": [{ list, n, name, age, navrh, prislusnost }]
export function jmsezPirates(jmsez) {
    const out = [];
    for (const [list, entry] of Object.entries(jmsez?.platni || {})) {
        for (const r of entry?.seznam || []) {
            if (r[4] === PIRATES_LABEL) out.push({ list: Number(list), n: Number(r[0]), name: r[1], age: r[2], navrh: r[3], prislusnost: r[4] });
        }
    }
    return out.sort((a, b) => a.list - b.list || a.n - b.n);
}

// true, když některý štítek "Piráti" z jmsez chybí v members ∪ others generátoru (nezávislý druhý zdroj, spec §2)
export function jmsezMismatch(jmsez, spec) {
    const have = new Set([...(spec?.members || []), ...(spec?.others || [])].map((m) => `${m.list}:${m.n}`));
    return jmsezPirates(jmsez).some((r) => !have.has(`${r.list}:${r.n}`));
}

const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (columns, rows) => `${[columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n')}\n`;

const num = (v) => Number(v) || 0;
const byNum = (...keys) => (a, b) => {
    for (const k of keys) if (num(a[k]) !== num(b[k])) return num(a[k]) - num(b[k]);
    return 0;
};
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n`;
const rowKey = (a, b) => a.kraj - b.kraj || czechCompare(a.name, b.name) || a.zastup - b.zastup;
const when = (iso) => (iso ? String(iso) : 'neznámo');
// ---------------------------------------------------------------- řádky pro reporty

/**
 * Z výsledku `compute` poskládá řádky reportů: zveřejněná města, města ze seznamu majitele, hraniční nezařazená,
 * města těsně pod hranicí 7 000 (`offBand`: registr 2026 pod hranicí, tabulka ČSÚ 2025 nad ní, Piráti kandidují) a `extra`
 * ({ [KODZASTUP]: poznámka } – např. Litovel). Pořadí = pořadí `res.records`; řadí si až vykreslení.
 */
export function reportRows(res, { overrides = { reviewedAt: null, towns: {} }, extra = {} } = {}) {
    const townBy = new Map(res.towns.map((t) => [t.zastup, t]));
    const specBy = new Map(res.specifics.map((s) => [s.zastup, s]));
    const out = [];
    for (const r of res.records) {
        const z = r.council.zastup;
        const published = townBy.has(z);
        const pop25 = res.pop2025?.get(z)?.population ?? null;
        const offBand = !published && (r.cls.type === 'a' || r.cls.type === 'b') && pop25 !== null
            && bandOf(r.council.population) === 'lt7k' && bandOf(pop25) !== 'lt7k';
        if (!(published || r.onOwnerList || r.dec.inclusion === 'borderline-excluded' || offBand || z in extra)) continue;
        const sp = specBy.get(z);
        const inc = r.dec.inclusion;
        const list = sp ? sp.list : r.cls.list;
        const p2022 = res.pirates2022?.get(z) ?? null;
        out.push({
            kraj: r.council.kraj, krajName: r.council.krajName, name: r.council.name, zastup: z, okres: r.council.okres, druh: r.council.druh,
            population: r.council.population,
            population2025: published ? townBy.get(z).populationCsu2025 ?? null : pop25,
            onOwnerList: r.onOwnerList, published, inclusion: inc, reason: r.dec.reason, offBand, p2022,
            borderlineReason: published && inc === 'borderline-included' ? r.dec.reason.replace('na seznamu majitele', 'na vašem seznamu') : '',
            reasonText: published ? '' : rejectedText(r, p2022),
            type: sp ? sp.type : r.cls.type, list, members: sp ? sp.members : r.cls.members, others: sp ? sp.others : r.cls.others,
            flags: sp ? sp.flags : r.flags, confidence: sp ? sp.confidence : null,
            hidden: published ? !isShown(sp, overrides.towns?.[String(z)], overrides.reviewedAt) : false,
            slozeni: r.listRow?.SLOZENI ?? '', vstrana: r.listRow?.VSTRANA ? Number(r.listRow.VSTRANA) : list?.vstrana ?? null,
            note: extra[z] ?? '',
        });
    }
    return out;
}

const p2022Text = (p) => (p ? `Piráti 2022: ${commaDecimal(p.pct)} %, ${p.seats} mand.` : 'Piráti 2022: bez pirátské kandidátky');

// Proč město není zveřejněno (česky, s číslem obyvatel)
function rejectedText(r, p2022) {
    const n = r.council.population;
    const ex = excludedReason({ type: r.cls.type, population: n, inclusion: r.dec.inclusion, reason: r.dec.reason });
    if (ex.reason === 'override') return ex.text;
    if (r.cls.type === 'c' || r.cls.type === 'd') return `typ ${r.cls.type}: ${ex.text}; ${spaced(n)} obyvatel`;
    if (r.dec.inclusion === 'borderline-excluded') return `${spaced(n)} obyvatel, bez důvodu k zařazení; ${p2022Text(p2022)}`;
    return `${spaced(n)} obyvatel (pod hranicí ${spaced(BAND_BORDERLINE)})`;
}

// ---------------------------------------------------------------- společné části tabulek

const KIND_CZ = { party: 'strana', coalition: 'koalice', association: 'sdružení' };
const FLAG_CZ = {
    'disambiguated-by-druh': 'jméno má víc obcí, vybráno město',
    'dash-normalized': 'název z vašeho seznamu upraven (pomlčka)',
    'slug-disambiguated': 'adresa rozlišena okresem',
    'kraj-differs-from-owner-list': 'kraj se liší od vašeho seznamu',
    'named-cps-but-association': 'jmenuje se „Česká pirátská strana“, ale je to sdružení',
    'no-members-on-pirate-list': 'na pirátské kandidátce není žádný člen Pirátů',
    'population-band-differs': 'počet obyvatel 2025 spadá do jiného pásma',
    'borderline-auto': 'hraniční, zařazeno jen automaticky',
    'jmsez-mismatch': 'nesedí s jmenným seznamem ČSÚ',
    'unknown-partner-code': 'neznámý koaliční partner',
    'multiple-pirate-lists': 'víc pirátských kandidátek',
    'also-on-other-lists': 'Piráti kandidují i na jiných kandidátkách',
    'candidate-without-list': 'kandidát bez kandidátky v registru',
};
export const flagLabel = (f) => FLAG_CZ[f] ?? f;
const flagsCell = (r) => r.flags.map(flagLabel).join('; ') || '–';
const th = (cz, raw) => `${cz}<br><sub>${raw}</sub>`;
const INCLUSION_CZ = {
    auto: 'zařazeno automaticky', 'borderline-included': 'zařazeno podle úsudku', forced: 'ručně vynuceno',
    excluded: 'vyřazeno', 'borderline-excluded': 'hraniční, nezařazeno',
};

const listCell = (r) => (r.list ? `${r.list.id}` : '–');
const partnersOf = (r) => (r.list ? [...r.list.partners.map((p) => p.short), ...(r.list.independents ? ['NK'] : [])].join(', ') || '–' : '–');
const nominated = (r) => r.list?.nominatedNonMembers ?? 0;
const membersCell = (r) => {
    const m = r.members;
    const base = m.length ? `${m.length} (${m.slice(0, 3).map((x) => x.name).join(', ')}${m.length > 3 ? `, +${m.length - 3}` : ''})` : '0';
    if (!nominated(r)) return base;
    return m.length ? `${base} · nominovaných nečlenů: ${nominated(r)}` : `0 (nominovaných nečlenů: ${nominated(r)})`;
};
const othersCell = (r) => {
    const o = r.others;
    if (!o.length) return '–';
    const first = o.slice(0, 3).map((x) => `${x.name} (č. ${x.list}/${x.n}${x.nominatedBy ? `, navrhl ${x.nominatedBy}` : ''})`).join('; ');
    return `${o.length}: ${first}${o.length > 3 ? `; +${o.length - 3}` : ''}`;
};
const popCell = (r) => `${spaced(r.population)} / ${r.population2025 === null || r.population2025 === undefined ? '–' : spaced(r.population2025)}`;
const confidenceCell = (r) => {
    if (!r.published) return '–';
    return r.confidence === 'low' ? `nízká (${r.hidden ? 'skryto' : 'odkryto'})` : 'vysoká';
};
const sourceCell = (r) => `${r.zastup} / ${r.okres}${r.vstrana ? ` / ${r.vstrana}` : ''}${r.slozeni ? ` / ${r.slozeni}` : ''}`;
const inclusionCell = (r) => {
    const base = INCLUSION_CZ[r.inclusion] ?? r.inclusion;
    return r.onOwnerList ? base : `${base}; spočteno, není na vašem seznamu`;
};
const countBy = (rows, fn) => {
    const m = new Map();
    for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + 1);
    return m;
};

function sourcesBlock(meta) {
    const lines = [`- Stav dat: soubory v cache k ${when(meta.fetchedAt)} (UTC). Vše vzniká automaticky příkazem \`node scripts/mesta-registry.js\`, ručně se neupravuje.`];
    for (const s of meta.sources || []) lines.push(`- ${s.label}: ${s.url} (čas souboru v cache ${when(s.fetchedAt)}, sha256 \`${String(s.sha256).slice(0, 16)}…\`)`);
    lines.push(`- Počty obyvatel k 1. 1. 2025 (kontrola pásma): ${meta.pop2025?.ok ? 'načteno z tabulky ČSÚ' : `NEPROBĚHLO${meta.pop2025?.reason ? ` (${meta.pop2025.reason})` : ''}`}`);
    const j = meta.jmsez;
    lines.push(`- Kontrola jmenným seznamem kandidátů (jmsez): ${!j || j.status === 'not-run' ? `NEPROBĚHLA${j?.reason ? ` (${j.reason})` : ''}` : `${j.fetched} měst${j.failed?.length ? `, nenačteno ${j.failed.length}` : ''}`}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- mesta-specifics.md

const INTRO = `## Co to je

Tato tabulka ukazuje, **která města se na webu „města“ zveřejní** a **jak v nich Piráti kandidují**. Vznikla automaticky z otevřených dat ČSÚ (registr kandidátů pro komunální volby 2026), ne z ruky. Cílem je, abyste ji za pár minut prošel(a) a u sporných měst rozhodl(a). Co v tabulce nesedí, opravíte v souboru \`src/mesta/overrides.js\` (návod níže), ne v tomto dokumentu.

## Jak číst sloupce

Pod českým názvem sloupce je malým písmem původní technický název (hodí se jen pro vývojáře).

- **kraj, město** – kraj a název obce.
- **zařazení** – proč je město na webu: *zařazeno automaticky* = má aspoň 10 000 obyvatel a Piráti kandidují (typ a nebo b); *zařazeno podle úsudku* = 7 000–9 999 obyvatel a máme důvod (viz **důvod zařazení**); *ručně vynuceno* = zařazeno vaším zásahem v \`overrides.js\`; *vyřazeno* = na webu nebude.
- **důvod zařazení** – u malých (hraničních) měst důvod, proč je přesto zařazeno (např. „na vašem seznamu“, „Piráti 2022: 11,7 %, 2 mand.“, „sídlo okresu“).
- **obyvatel (2026 / 2025)** – počet obyvatel z registru voleb 2026 (podle něj se rozhoduje) a z tabulky ČSÚ k 1. 1. 2025 (jen kontrola).
- **typ** – **a** = Piráti mají vlastní kandidátku; **b** = Piráti jsou ve společné kandidátce (koalice nebo sdružení); **c** = Piráti jsou jen jednotlivci na cizích kandidátkách; **d** = Piráti tu vůbec nekandidují. Na web se dávají typy a a b.
- **č., název, druh, partneři** – číslo a název kandidátky, druh (strana / koalice / sdružení) a koaliční partneři (NK = nezávislí kandidáti).
- **členové Pirátů na kandidátce** – počet kandidátů, kteří jsou členy Pirátů, a první tři jména. „Nominovaní nečlenové“ jsou lidé, které Piráti navrhli, ale členy nejsou.
- **Piráti na jiných kandidátkách** – členové Pirátů, kteří kandidují za jinou kandidátku.
- **kódy v registru ČSÚ** – čísla, podle kterých lze každý řádek dohledat v datech (kód obce, okres, kandidátka, složení).
- **poznámky generátoru** – upozornění, např. že na pirátské kandidátce není žádný člen Pirátů.
- **jistota** – *vysoká* = město se zveřejní hned; *nízká (skryto)* = viz níže.

## Co znamená „jistota nízká / skryto“

Když si generátor není jistý (hraniční město zařazené jen automatickým důvodem, rozdíl proti druhému zdroji, nejasná kandidátka), dá městu **nízkou jistotu**. Takové město je **skryto**: na webu nemá vlastní stránku a není v seznamu měst, dokud ho nepotvrdíte. Je to pojistka proti omylu, ne verdikt. Řádky „nízká (skryto)“ jsou ty, které je třeba schválit.

## Jak změnit město (\`src/mesta/overrides.js\`)

V souboru je objekt \`towns\`. Klíč je kód obce v uvozovkách (najdete ho ve sloupci „kódy v registru ČSÚ“, první číslo) a \`name\` musí být přesně název z registru. Zkopírujte vhodný příklad do \`towns: { … }\` (jsou to skutečná města; místo „důvod doplňte“ napište svůj důvod):

\`\`\`js
export default {
    reviewedAt: null,            // až budete mít vše projité: '2026-10-11' odkryje VŠECHNA skrytá města najednou
    towns: {
        // 1) Schválit skryté město (Mikulov): město se zobrazí
        '584649': { name: 'Mikulov', reviewed: true },

        // 2) Zveřejněné město vyřadit (důvod je povinný)
        '598933': { name: 'Český Těšín', include: false, reason: 'důvod doplňte' },

        // 3) Město zařadit i přes pravidla (důvod je povinný; u typu c/d se zobrazí vysvětlující text)
        '560286': { name: 'Sokolov', include: true, reason: 'důvod doplňte' },

        // 4) Hraniční město (7 000–9 999 obyvatel) zařadit ručním důvodem
        '584002': { name: 'Tišnov', borderlineReason: 'důvod doplňte' },
    },
};
\`\`\`

Pozor: kód obce a \`name\` musí sedět s registrem, jinak generátor skončí chybou. Po úpravě pusťte \`npm test\`; generované soubory se obnoví příkazem \`node scripts/mesta-registry.js\`.`;

const REASON_KIND = [[/^Piráti 2022/, 'výsledek Pirátů v roce 2022'], [/sídlo okresu/, 'sídlo okresu'], [/senátního obvodu/, 'sídlo senátního obvodu']];

function decisionRows(rows, meta = {}) {
    const nameOf = (r) => `**${r.name}**`;
    const sections = [];
    const sorted = [...rows].sort(rowKey);
    const codeH = 'Kód obce';

    const autoBorderline = sorted.filter((r) => r.published && r.inclusion === 'borderline-included' && r.flags.includes('borderline-auto'));
    const kinds = [...new Set(autoBorderline.map((r) => REASON_KIND.find(([re]) => re.test(r.borderlineReason))?.[1] ?? 'jiný automatický důvod'))];
    sections.push(`### 1. Hraniční města zařazená automaticky (skrytá)${kinds.length ? `: důvodem je ${kinds.join(', ')}` : ''}

Tato města mají pod 10 000 obyvatel; do výběru se dostala jen z automatického důvodu uvedeného v tabulce, ne kvůli vašemu seznamu. Proto jsou **skrytá**. **Otázka: zveřejnit?** Ano = do \`overrides.js\` přidat \`reviewed: true\` (příklad 1 výše), ne = \`include: false\` (příklad 2).

${autoBorderline.length ? table(['Město', codeH, 'Obyvatel', 'Typ', 'Důvod zařazení', 'Jistota'], autoBorderline.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.borderlineReason, confidenceCell(r)])) : '_Žádné._\n'}`);

    const ownerBorderline = sorted.filter((r) => r.published && r.inclusion === 'borderline-included' && !r.flags.includes('borderline-auto'));
    sections.push(`### 2. Hraniční města zařazená kvůli vašemu seznamu nebo ručnímu důvodu

${ownerBorderline.length ? table(['Město', codeH, 'Obyvatel', 'Typ', 'Důvod zařazení', 'Jistota'], ownerBorderline.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.borderlineReason, confidenceCell(r)])) : '_Žádné._\n'}
Zde stačí potvrdit, že je chcete mít zveřejněná.`);

    const be = sorted.filter((r) => r.inclusion === 'borderline-excluded');
    sections.push(`### 3. Hraniční města bez důvodu (nezveřejněna)

Piráti tu kandidují (typ a nebo b), ale město má 7 000–9 999 obyvatel a nic z pravidel ho nezařadilo. **Otázka: přidat některé?** Ano = přidat \`borderlineReason\` (příklad 4 výše).

${be.length ? table(['Město', codeH, 'Obyvatel', 'Typ', 'Poznámka'], be.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.reasonText])) : '_Žádné._\n'}`);

    const off = sorted.filter((r) => r.offBand);
    const offSnippets = off.map((r) => `    '${r.zastup}': { name: '${r.name.replace(/'/g, "\\'")}', include: true, reason: '${p2022Text(r.p2022)}; ${spaced(r.population2025)} obyvatel k 1. 1. 2025' },`);
    sections.push(`### 4. Těsně pod hranicí 7 000 podle registru 2026, ale nad ní podle ČSÚ 2025

U těchto měst Piráti kandidují (typ a nebo b). Registr voleb 2026 uvádí méně než 7 000 obyvatel, tabulka ČSÚ k 1. 1. 2025 už 7 000 a víc. Zařazení rozhoduje registr 2026, proto tato města **nejsou zveřejněna**. **Otázka: zařadit některé?** U města pod 7 000 obyvatel to jde jen přes \`include: true\` (samotný \`borderlineReason\` by nestačil). Hotový zápis do \`towns: { … }\`:

${off.length ? `${table(['Město', codeH, 'Obyvatel (2026 / 2025)', 'Typ', 'Kandidátka', 'Výsledek 2022'], off.map((r) => [nameOf(r), r.zastup, popCell(r), r.type, r.list ? `č. ${r.list.id} ${r.list.name}` : '–', p2022Text(r.p2022)]))}
\`\`\`js
${offSnippets.join('\n')}
\`\`\`
` : '_Žádné._\n'}`);

    const added = sorted.filter((r) => r.published && !r.onOwnerList && r.inclusion !== 'borderline-included');
    sections.push(`### 5. Spočítáno, ale není na vašem seznamu (už zveřejněno)

Město splňuje pravidla (aspoň 10 000 obyvatel, Piráti na kandidátce), i když ho váš seznam nemá. **Otázka: ponechat?** Ne = \`include: false\` s důvodem (příklad 2).

${added.length ? table(['Město', codeH, 'Obyvatel', 'Typ', 'Kandidátka'], added.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.list ? `č. ${r.list.id} ${r.list.name}` : '–'])) : '_Žádné._\n'}`);

    const rej = sorted.filter((r) => !r.published && r.onOwnerList);
    const mentioned = sorted.filter((r) => !r.published && !r.onOwnerList && r.note);
    sections.push(`### 6. Města z vašeho seznamu, která jsme zamítli (${rej.length})

**Otázka: souhlasíte?** Pokud některé chcete mít přesto, použijte \`include: true\` (příklad 3). Typ c/d se pak zobrazí s vysvětlením „Piráti tu nekandidují“ / „jen na cizích kandidátkách“.

${rej.length ? table(['Město', codeH, 'Obyvatel', 'Důvod zamítnutí'], rej.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.reasonText])) : '_Žádná._\n'}${mentioned.length ? `\nMimo soubor vašeho seznamu, zmíněno vámi: ${mentioned.map((r) => `**${r.name}** – ${r.reasonText}; ${r.note}`).join('; ')}.\n` : ''}`);

    const nn = sorted.filter((r) => r.published && r.members.length === 0 && nominated(r) > 0);
    const allNominated = rows.filter((r) => r.published).reduce((s, r) => s + nominated(r), 0);
    const townsWithNominated = rows.filter((r) => r.published && nominated(r) > 0).length;
    sections.push(`### 7. Zobrazit nominované nečleny?

V těchto městech je kandidátka označená jako pirátská (koalice nebo sdružení s Piráty), ale **z Pirátů jsou na ní jen lidé, které Piráti navrhli, ale nejsou členy**. Sama kandidátka je přesto stále označená jako pirátská. Dnes se na webu jako „kandidáti Pirátů“ zobrazují jen **členové**, takže u těchto měst nebude uveden nikdo. **Otázka: Zobrazit nominované nečleny?** (Obecně: ve všech zveřejněných městech je ${allNominated} nominovaných nečlenů v ${townsWithNominated} městech.)

${nn.length ? table(['Město', codeH, 'Kandidátka', 'Nominovaných nečlenů', 'Členů Pirátů'], nn.map((r) => [nameOf(r), r.zastup, r.list ? `č. ${r.list.id} ${r.list.name}` : '–', nominated(r), 0])) : '_Žádné město._\n'}`);

    const odd = sorted.filter((r) => r.published && r.flags.some((f) => ['jmsez-mismatch', 'population-band-differs', 'multiple-pirate-lists', 'unknown-partner-code'].includes(f)));
    const unchecked = [meta.pop2025?.ok ? null : 'počet obyvatel 2025', !meta.jmsez || meta.jmsez.status === 'not-run' ? 'jmenný seznam ČSÚ' : null].filter(Boolean);
    sections.push(`### 8. Zveřejněná města, u kterých se zdroje rozcházejí (skrytá)

Kontrola jmenným seznamem ČSÚ, počtem obyvatel 2025, více pirátskými kandidátkami a neznámým partnerem.

${odd.length ? table(['Město', codeH, 'Poznámky generátoru', 'Obyvatel (2026 / 2025)', 'Jistota'], odd.map((r) => [nameOf(r), r.zastup, flagsCell(r), popCell(r), confidenceCell(r)]))
        : `_U žádného zveřejněného města se zdroje nerozcházejí._${off.length ? ' Otevřená zůstává skupina 4 výše (města těsně pod hranicí 7 000).' : ''}${unchecked.length ? ` Pozor: neproběhla kontrola: ${unchecked.join(', ')}.` : ''}\n`}`);
    return `${sections.map((x) => x.trimEnd()).join('\n\n')}\n`;
}

export function renderSpecificsTable(rows, meta = {}) {
    const published = rows.filter((r) => r.published);
    const incCount = countBy(published, (r) => r.inclusion);
    const typeCount = countBy(published, (r) => r.type);
    const hidden = published.filter((r) => r.hidden).length;
    const rejected = rows.filter((r) => !r.published && r.onOwnerList);
    const be = rows.filter((r) => r.inclusion === 'borderline-excluded');

    const counts = `## Souhrn

${table(['Zařazení', 'Počet'], [
        [INCLUSION_CZ.auto, incCount.get('auto') || 0],
        [INCLUSION_CZ['borderline-included'], incCount.get('borderline-included') || 0],
        [INCLUSION_CZ.forced, incCount.get('forced') || 0],
        ['**zveřejněno celkem**', `**${published.length}**`],
        ['z toho skryto (nízká jistota, čeká na vaše potvrzení)', hidden],
        ['hraniční, nezařazeno (nezveřejněno)', be.length],
        ['zamítnuto z vašeho seznamu', rejected.length],
    ])}
${table(['Typ kandidatury (zveřejněná města)', 'Počet'], ['a', 'b', 'c', 'd'].map((t) => [`typ ${t}`, typeCount.get(t) || 0]))}`;

    const main = [...published].sort(rowKey).concat([...rejected].sort(rowKey));
    const head = ['kraj', 'město', th('zařazení', 'inclusion'), th('důvod zařazení', 'borderline_reason'), 'obyvatel (2026 / 2025)', 'typ', 'č.', 'název kandidátky', 'druh', 'partneři',
        'členové Pirátů na kandidátce', 'Piráti na jiných kandidátkách', th('kódy v registru ČSÚ', 'KODZASTUP / OKRES / VSTRANA / SLOZENI'), th('poznámky generátoru', 'flags'), th('jistota', 'confidence')];
    const body = main.map((r) => [
        r.krajName, r.name, r.published ? inclusionCell(r) : `vyřazeno: ${r.reasonText}`, r.borderlineReason || '–', popCell(r), r.type, listCell(r), r.list?.name ?? '–',
        r.list ? KIND_CZ[r.list.kind] ?? r.list.kind : '–', partnersOf(r), membersCell(r), othersCell(r), sourceCell(r), flagsCell(r), confidenceCell(r),
    ]);

    return `# Přehled měst a kandidatur Pirátů (review tabulka „města“)

${INTRO}

${counts}
## K rozhodnutí vlastníka

Níže je vše, co generátor nemůže rozhodnout sám. U každé skupiny je otázka a návod, jak odpovědět.

${decisionRows(rows, meta)}
## Zdroje a kontroly

${sourcesBlock(meta)}

## Tabulka všech měst

Nejdřív zveřejněná města (podle kraje a abecedy), na konci města z vašeho seznamu, která jsme vyřadili. Členy Pirátů registr ČSÚ vede u kandidáta; **příznivci bez členství se z dat poznat nedají** – ty byste doplnili v \`overrides.js\` (\`pirateCandidates\`).

${table(head, body)}`;
}

// ---------------------------------------------------------------- mesta-list-verification.md

function verifyTable(rows, { reason = false } = {}) {
    const head = ['Kraj', 'Město', 'Kód obce', 'Obyvatel (2026 / 2025)', 'Typ', 'Zařazení', th('Důvod zařazení', 'borderline_reason'), 'Poznámky generátoru', reason ? 'Důvod zamítnutí' : 'Na vašem seznamu'];
    return table(head, [...rows].sort(rowKey).map((r) => [
        r.krajName, `**${r.name}**`, r.zastup, popCell(r), r.type, INCLUSION_CZ[r.inclusion] ?? r.inclusion,
        r.borderlineReason || '–', flagsCell(r),
        reason ? [r.reasonText, r.note].filter(Boolean).join('; ') + (r.onOwnerList ? '' : ' (ne – mimo soubor seznamu)') : r.onOwnerList ? 'ano' : 'ne',
    ]));
}

export function renderVerification({ confirmed, rejected, added, borderlineExcluded, notes = [] }, meta = {}) {
    const fromList = rejected.filter((r) => r.onOwnerList);
    const outside = rejected.filter((r) => !r.onOwnerList);
    const total = confirmed.length + fromList.length;
    const ownerCheck = meta.ownerCount === undefined ? '' : ` (soubor \`docs/analysis/mesta-towns.txt\` má ${meta.ownerCount} jmen: ${total === meta.ownerCount ? 'součet sedí' : 'SOUČET NESEDÍ'})`;
    const borderMarked = [...confirmed, ...added].filter((r) => r.inclusion === 'borderline-included');

    return `# Ověření vašeho seznamu měst

Váš seznam (\`docs/analysis/mesta-towns.txt\`) jsme nebrali jako hotový: každé jméno jsme spárovali s obcí v registru ČSÚ podle kódu obce a pak podle pravidel rozhodli, zda město zveřejnit. Tři tabulky níže dohromady obsahují všechna jména z vašeho seznamu a všechna města navíc. Vyplněný sloupec **důvod zařazení** (technicky \`borderline_reason\`) znamená hraniční město (7 000–9 999 obyvatel), zařazené z uvedeného důvodu.

${sourcesBlock(meta)}

## Počty

- potvrzeno: ${confirmed.length}
- zamítnuto z vašeho seznamu: ${fromList.length}
- na vašem seznamu celkem: ${total}${ownerCheck}
- splňují pravidla, ale nejsou na vašem seznamu: ${added.length}
- hraniční města zařazená (důvod zařazení vyplněn): ${borderMarked.length}${borderMarked.length ? ` (${borderMarked.map((r) => r.name).join(', ')})` : ''}
- hraniční města bez důvodu, nezařazená: ${borderlineExcluded.length}
${outside.length ? `- mimo soubor seznamu, zmíněno vámi: ${outside.map((r) => r.name).join(', ')} – viz tabulka 2 (nepočítá se do ${total})\n` : ''}
## 1. Potvrzená města z vašeho seznamu (${confirmed.length})

${verifyTable(confirmed)}
## 2. Zamítnutá města z vašeho seznamu (${fromList.length}${outside.length ? ` + ${outside.length} mimo soubor seznamu` : ''})

${verifyTable(rejected, { reason: true })}
## 3. Splňují pravidla, ale nejsou na vašem seznamu (${added.length})

Spočteno z registru; v generovaných datech jsou zařazena (po vašem posouzení je lze odebrat přes \`include: false\`).

${verifyTable(added)}
## 4. Hraniční města bez důvodu, nezařazená (${borderlineExcluded.length})

${borderlineExcluded.length ? table(['Kraj', 'Město', 'Kód obce', 'Obyvatel (2026 / 2025)', 'Typ', th('Důvod zařazení', 'borderline_reason'), 'Poznámka'], [...borderlineExcluded].sort(rowKey).map((r) => [r.krajName, `**${r.name}**`, r.zastup, popCell(r), r.type, '– (žádný důvod)', r.reasonText])) : '_Žádná._\n'}
## Poznámky

${notes.length ? notes.map((n) => `- ${n}`).join('\n') : '_Žádné._'}
`;
}

// ---------------------------------------------------------------- extrakt (docs/analysis/mesta-extract)

const LIST_COLS = ['OKRES', 'KODZASTUP', 'NAZEVZAST', 'COBVODU', 'POR_STR_HL', 'OSTRANA', 'VSTRANA', 'NAZEVCELK', 'ZKRATKAO30', 'ZKRATKAO8', 'POCSTR_SLO', 'SLOZENI'];
const LIST22_COLS = ['DATUMVOLEB', 'OKRES', 'KODZASTUP', 'NAZEVZAST', 'COBVODU', 'POR_STR_HL', 'VSTRANA', 'NAZEVCELK', 'SLOZENI', 'HLASY_STR', 'PROCHLSTR', 'MAND_STR'];
const CAND_COLS = ['OKRES', 'KODZASTUP', 'COBVODU', 'POR_STR_HL', 'PORCISLO', 'JMENO', 'PRIJMENI', 'PSTRANA', 'NSTRANA', 'PLATNOST'];
const COUNCIL_COLS = ['KRAJ', 'OKRES', 'TYPZASTUP', 'DRUHZASTUP', 'KODZASTUP', 'NAZEVZAST', 'POCOBYV', 'precincts'];
export const DATUMVOLEB_2022 = '20220923';
const has720 = (r) => codes(r.SLOZENI).includes(PIRATES_CODE);
const unionKeys = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

function readme(ctx, scope, counts) {
    const { meta, src } = ctx;
    const srcRows = (meta.sources || []).map((s) => `| ${s.label} | ${s.url} | \`${s.sha256}\` | ${when(s.fetchedAt)} |`);
    const j = meta.jmsez;
    const jmsezLine = !j || j.status === 'not-run'
        ? `**not run**${j?.reason ? ` (${j.reason})` : ''} – \`jmsez-pirati.json\` only records that the cross-check did not run; check C10 cannot be verified.`
        : `fetched for ${j.fetched} published towns (${j.failed?.length ? `${j.failed.length} failed: ${j.failed.join(', ')}` : 'none failed'}), one request per second, URL pattern \`${j.urlPattern ?? '<KV_BASE_URL>/jmsez/<okres>/<zastup>.json'}\`.`;
    return `# mesta registry extract

Deterministic extract of the ČSÚ open data that \`scripts/mesta-registry.js\` used. It lets a reviewer verify the generated files (\`src/mesta/{towns,specifics,excluded}.generated.json\`, \`docs/analysis/mesta-specifics.md\`, \`docs/analysis/mesta-list-verification.md\`) offline. Regenerate with \`node scripts/mesta-registry.js\`; do not edit by hand. (The older Haiku probe in \`docs/analysis/mesta-registry-extract/\` is a different, independent artefact and is not part of this extract.)

Fetched: ${when(meta.fetchedAt)} UTC (per-source times are the modification times of the cached downloads; a cache copied from another worktree shows the copy time, not the original download time).

## Sources

| Source | URL | sha256 | Fetched |
|---|---|---|---|
${srcRows.join('\n')}

- Registry zip \`csv_od/\` files (UTF-8, comma): \`kvrzcoco.csv\`, \`kvros.csv\`, \`kvrk.csv\`. Code lists zip: \`cvs.csv\`, \`cns.csv\`, \`cnumnuts.csv\`.
- Population 2025: ${meta.pop2025?.ok ? `sheet 1 of \`${meta.pop2025.sourceName ?? '1300722503.xlsx'}\`, columns B (kód obce = KODZASTUP) and D (počet obyvatel), rows from 7.` : `**not run**${meta.pop2025?.reason ? ` (${meta.pop2025.reason})` : ''}; \`pop-csu-2025.csv\` is empty and \`population-band-differs\` was not computed.`}
- jmsez cross-check: ${jmsezLine}

## Files and filters

| File | Content | Filter applied | Rows |
|---|---|---|---|
| \`councils.csv\` | \`kvrzcoco\`: one row per municipality council | \`TYPZASTUP 1\` (whole municipality), Prague (\`DRUHZASTUP 4\`) kept for the check, district councils (\`TYPZASTUP 2\`) dropped; \`precincts\` = Σ over the council's rows of Σ(MAX−MIN+1) of \`MINOKRSEK1..9/MAXOKRSEK1..9, MINOKRSE10/MAXOKRSE10\`; \`POCOBYV\` as in the registry | ${counts.councils} |
| \`pop-csu-2025.csv\` | ČSÚ 1 Jan 2025 population | municipalities (not Prague) whose council has \`POCOBYV ≥ ${BAND_BORDERLINE}\` or whose 2025 population is ≥ ${BAND_BORDERLINE}, or that are in scope below | ${counts.pop} |
| \`lists-720.csv\` | \`kvros\`: candidate lists | all rows nationwide with 720 in \`SLOZENI\` (result columns dropped: registry has none) | ${counts.lists720} |
| \`lists.csv\` | \`kvros\`: all lists of the towns in scope | scope = published towns, all owner-list towns (confirmed and rejected), borderline-excluded towns and towns the owner mentioned (${scope.size} towns) | ${counts.lists} |
| \`candidates-720.csv\` | \`kvrk\`: candidates | all rows nationwide with \`PSTRANA\` or \`NSTRANA\` = 720, any \`PLATNOST\` (join to lists on KODZASTUP, COBVODU, POR_STR_HL) | ${counts.candidates} |
| \`lists-2022-720.csv\` | \`kvros\` of KV 2022 | \`DATUMVOLEB = ${DATUMVOLEB_2022}\` and 720 in \`SLOZENI\` (basis of the \`pirates-2022\` reason) | ${counts.lists2022} |
| \`cvs.csv\` | list code table | rows whose \`VSTRANA\` occurs in \`lists-720.csv\` or \`lists.csv\` | ${counts.cvs} |
| \`cns.csv\` | nominating-party table | rows whose \`NSTRANA\` is 720, 80 or occurs in a \`SLOZENI\` of \`lists-720.csv\`/\`lists.csv\` or as \`NSTRANA\` in \`candidates-720.csv\` | ${counts.cns} |
| \`regions-okresy.csv\` | \`cnumnuts\` | 4-digit \`NUMNUTS\` only (regions 2100…8100, okresy 2101…) | ${counts.regions} |
| \`senate-2026.json\` | Senate constituencies voting in 2026 (\`obvody.json\`) | \`obvod\` and \`nazevObvodu\` only | ${src.senate?.obvody?.length ?? 0} |
| \`jmsez-pirati.json\` | jmsez rows labelled \`Piráti\` | published towns only; per town the rows with \`prislusnost = Piráti\` and the generator's \`mismatch\` verdict | ${counts.jmsez} |

All CSV rows are sorted by KODZASTUP (then list number, position) so reruns are byte-identical for the same inputs.

## Reading hints

- \`KODZASTUP\` is the key everywhere (names repeat, e.g. two Mikulov and two Šlapanice).
- A Pirate is \`PSTRANA = 720\` (member); \`NSTRANA = 720\` with another \`PSTRANA\` is a nominated non-member (\`nominatedNonMembers\` in \`specifics.generated.json\`).
- \`SLOZENI\` is the list composition by nominating-party codes (720 = Piráti, 080 = NK, independents).
`;
}

// Jeden řádek na město a jeden na kandidáta (čitelný diff, malý soubor)
function jmsezText(j) {
    if (!j.towns) return `${JSON.stringify(j, null, 1)}\n`;
    const { towns, ...head } = j;
    const parts = Object.entries(towns).map(([z, { rows, ...t }]) => ` ${JSON.stringify(z)}: {${JSON.stringify(t).slice(1, -1)}, "rows": [${rows.length ? `\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ` : ''}]}`);
    return `${JSON.stringify(head, null, 1).replace(/\n}$/, '')},\n "towns": {\n${parts.join(',\n')}\n }\n}\n`;
}

/**
 * ctx: { src, res, meta }
 *   src  = { kvrzcoco, kvros, kvrk, cvs, cns, cnumnuts, kvros2022, senate, pop2025: Map|null, jmsez: Map|null }
 *   res  = výsledek `compute` ({ towns, specifics, records })
 *   meta = { fetchedAt, sources, pop2025:{ok,reason,sourceName}, jmsez:{status,fetched,failed,reason,urlPattern}, extraZastups?:number[] }
 * Vrací { [soubor]: text }.
 */
export function extractFiles({ src, res, meta = {} }) {
    const all = wholeCouncils(src.kvrzcoco, { includePrague: true });
    const councilRows = [...all.values()].sort((a, b) => a.zastup - b.zastup)
        .map((c) => ({ KRAJ: c.kraj, OKRES: c.okres, TYPZASTUP: 1, DRUHZASTUP: c.druh, KODZASTUP: c.zastup, NAZEVZAST: c.name, POCOBYV: c.population, precincts: c.precincts }));

    const scope = new Set(res.towns.map((t) => t.zastup));
    for (const r of res.records) if (r.onOwnerList || r.dec.inclusion === 'borderline-excluded') scope.add(r.council.zastup);
    for (const z of meta.extraZastups || []) scope.add(z);

    const sortList = (a, b) => num(a.KODZASTUP) - num(b.KODZASTUP) || num(a.POR_STR_HL) - num(b.POR_STR_HL) || num(a.COBVODU) - num(b.COBVODU);
    const lists720 = src.kvros.filter(has720).sort(sortList);
    const listsScope = src.kvros.filter((r) => scope.has(num(r.KODZASTUP))).sort(sortList);
    const cands = src.kvrk.filter((r) => r.PSTRANA === String(PIRATES_CODE) || r.NSTRANA === String(PIRATES_CODE))
        .sort((a, b) => num(a.KODZASTUP) - num(b.KODZASTUP) || num(a.POR_STR_HL) - num(b.POR_STR_HL) || num(a.PORCISLO) - num(b.PORCISLO));
    const lists2022 = src.kvros2022.filter((r) => r.DATUMVOLEB === DATUMVOLEB_2022 && has720(r)).sort(sortList);

    const vUsed = new Set([...lists720, ...listsScope].map((r) => num(r.VSTRANA)));
    const nUsed = new Set([PIRATES_CODE, NK_CODE]);
    for (const r of [...lists720, ...listsScope]) for (const c of codes(r.SLOZENI)) nUsed.add(c);
    for (const r of cands) if (r.NSTRANA) nUsed.add(num(r.NSTRANA));
    const cvsRows = src.cvs.filter((r) => vUsed.has(num(r.VSTRANA))).sort(byNum('VSTRANA'));
    const cnsRows = src.cns.filter((r) => nUsed.has(num(r.NSTRANA))).sort(byNum('NSTRANA'));
    const nutsRows = src.cnumnuts.filter((r) => /^\d{4}$/.test(String(r.NUMNUTS))).sort(byNum('NUMNUTS'));

    const popRows = [];
    for (const [code, p] of src.pop2025 instanceof Map ? src.pop2025 : []) {
        const c = all.get(code);
        if (c?.druh === 4) continue;
        if (p.population >= BAND_BORDERLINE || (c && c.population >= BAND_BORDERLINE) || scope.has(code)) {
            popRows.push({ KODOBCE: code, NAZEV: p.name, OBYVATEL: p.population });
        }
    }
    popRows.sort(byNum('KODOBCE'));

    const specBy = new Map(res.specifics.map((s) => [s.zastup, s]));
    let jmsezJson;
    if (!meta.jmsez || meta.jmsez.status === 'not-run' || !(src.jmsez instanceof Map)) {
        jmsezJson = { status: 'not-run', reason: meta.jmsez?.reason ?? 'not run' };
    } else {
        const towns = {};
        for (const t of res.towns) {
            const j = src.jmsez.get(t.zastup);
            if (!j) continue;
            towns[t.zastup] = {
                name: t.name, okres: t.okres, generated: j.generovano ?? null, mismatch: jmsezMismatch(j, specBy.get(t.zastup)), rows: jmsezPirates(j).map(({ list, n, name, prislusnost }) => ({ list, n, name, prislusnost })),
            };
        }
        jmsezJson = {
            status: meta.jmsez.failed?.length ? 'partial' : 'ok', source: meta.jmsez.urlPattern ?? null, fetched: Object.keys(towns).length,
            failed: meta.jmsez.failed ?? [], towns,
        };
    }

    const counts = {
        councils: councilRows.length, pop: popRows.length, lists720: lists720.length, lists: listsScope.length, candidates: cands.length,
        lists2022: lists2022.length, cvs: cvsRows.length, cns: cnsRows.length, regions: nutsRows.length, jmsez: jmsezJson.fetched ?? 0,
    };
    const listCols = LIST_COLS;
    return {
        'README.md': readme({ meta, src }, scope, counts),
        'councils.csv': toCsv(COUNCIL_COLS, councilRows),
        'pop-csu-2025.csv': toCsv(['KODOBCE', 'NAZEV', 'OBYVATEL'], popRows),
        'lists-720.csv': toCsv(listCols, lists720),
        'lists.csv': toCsv(listCols, listsScope),
        'candidates-720.csv': toCsv(CAND_COLS, cands),
        'lists-2022-720.csv': toCsv(LIST22_COLS, lists2022),
        'cvs.csv': toCsv(unionKeys(cvsRows), cvsRows),
        'cns.csv': toCsv(unionKeys(cnsRows), cnsRows),
        'regions-okresy.csv': toCsv(unionKeys(nutsRows), nutsRows),
        'senate-2026.json': `${JSON.stringify({ obvody: (src.senate?.obvody || []).map((o) => ({ obvod: o.obvod, nazevObvodu: o.nazevObvodu })) }, null, 2)}\n`,
        'jmsez-pirati.json': jmsezText(jmsezJson),
    };
}
