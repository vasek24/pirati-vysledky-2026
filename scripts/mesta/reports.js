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
const INCLUSION_CZ = {
    auto: 'auto (≥ 10 000, typ a/b)', 'borderline-included': 'hraniční, zařazeno', forced: 'vynuceno (override)',
    excluded: 'vyřazeno', 'borderline-excluded': 'hraniční, nezařazeno',
};

// ---------------------------------------------------------------- řádky pro reporty

/**
 * Z výsledku `compute` poskládá řádky reportů: zveřejněná města, města ze seznamu majitele, hraniční nezařazená a `extra`
 * ({ [KODZASTUP]: poznámka } – např. Litovel). Pořadí = pořadí `res.records`; řadí si až vykreslení.
 */
export function reportRows(res, { overrides = { reviewedAt: null, towns: {} }, extra = {} } = {}) {
    const townBy = new Map(res.towns.map((t) => [t.zastup, t]));
    const specBy = new Map(res.specifics.map((s) => [s.zastup, s]));
    const out = [];
    for (const r of res.records) {
        const z = r.council.zastup;
        const published = townBy.has(z);
        if (!(published || r.onOwnerList || r.dec.inclusion === 'borderline-excluded' || z in extra)) continue;
        const sp = specBy.get(z);
        const inc = r.dec.inclusion;
        const list = sp ? sp.list : r.cls.list;
        const borderline = published && inc === 'borderline-included' ? r.dec.reason : '';
        out.push({
            kraj: r.council.kraj, krajName: r.council.krajName, name: r.council.name, zastup: z, okres: r.council.okres, druh: r.council.druh,
            population: r.council.population,
            population2025: published ? townBy.get(z).populationCsu2025 ?? null : res.pop2025?.get(z)?.population ?? null,
            onOwnerList: r.onOwnerList, published, inclusion: inc, reason: r.dec.reason,
            borderlineReason: borderline,
            reasonText: published ? '' : rejectedText(r, res.pirates2022?.get(z)),
            type: sp ? sp.type : r.cls.type, list, members: sp ? sp.members : r.cls.members, others: sp ? sp.others : r.cls.others,
            flags: sp ? sp.flags : r.flags, confidence: sp ? sp.confidence : null,
            hidden: published ? !isShown(sp, overrides.towns?.[String(z)], overrides.reviewedAt) : false,
            slozeni: r.listRow?.SLOZENI ?? '', vstrana: r.listRow?.VSTRANA ? Number(r.listRow.VSTRANA) : list?.vstrana ?? null,
            note: extra[z] ?? '',
        });
    }
    return out;
}

// Proč město není zveřejněno (česky, s číslem obyvatel)
function rejectedText(r, p2022) {
    const n = r.council.population;
    const ex = excludedReason({ type: r.cls.type, population: n, inclusion: r.dec.inclusion, reason: r.dec.reason });
    if (ex.reason === 'override') return ex.text;
    if (r.cls.type === 'c' || r.cls.type === 'd') return `typ ${r.cls.type}: ${ex.text}; ${spaced(n)} obyvatel`;
    if (r.dec.inclusion === 'borderline-excluded') {
        const y = p2022 ? `Piráti 2022: ${commaDecimal(p2022.pct)} %, ${p2022.seats} mand.` : 'Piráti 2022: nekandidovali';
        return `${spaced(n)} obyvatel, bez důvodu k zařazení; ${y}`;
    }
    return `${spaced(n)} obyvatel (pod hranicí ${spaced(BAND_BORDERLINE)})`;
}

// ---------------------------------------------------------------- společné části tabulek

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
    return r.confidence === 'low' ? `low (${r.hidden ? 'skryto' : 'odkryto'})` : 'high';
};
const sourceCell = (r) => `${r.zastup} / ${r.okres}${r.vstrana ? ` / ${r.vstrana}` : ''}${r.slozeni ? ` / ${r.slozeni}` : ''}`;
const inclusionCell = (r) => {
    const base = INCLUSION_CZ[r.inclusion] ?? r.inclusion;
    return r.onOwnerList ? base : `${base}; vypočteno, není na seznamu majitele`;
};
const countBy = (rows, fn) => {
    const m = new Map();
    for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + 1);
    return m;
};

function sourcesBlock(meta) {
    const lines = [`- Čas stažení zdrojů: ${when(meta.fetchedAt)} (UTC). Generátor: \`node scripts/mesta-registry.js\` (výstup je deterministický, ručně se neupravuje).`];
    for (const s of meta.sources || []) lines.push(`- ${s.label}: ${s.url} (stažení ${when(s.fetchedAt)}, sha256 \`${String(s.sha256).slice(0, 16)}…\`)`);
    lines.push(`- Počty obyvatel 2025 (kontrola pásma): ${meta.pop2025?.ok ? 'načteno z tabulky ČSÚ' : `NEPROBĚHLO${meta.pop2025?.reason ? ` (${meta.pop2025.reason})` : ''}`}`);
    const j = meta.jmsez;
    lines.push(`- Kontrola jmenným seznamem (jmsez): ${!j || j.status === 'not-run' ? `NEPROBĚHLA${j?.reason ? ` (${j.reason})` : ''}` : `${j.fetched} měst${j.failed?.length ? `, nenačteno ${j.failed.length}` : ''}`}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- mesta-specifics.md

const INTRO = `## Co to je

Tato tabulka ukazuje, **která města se na webu „města“ zveřejní** a **jak v nich Piráti kandidují**. Vznikla automaticky z otevřených dat ČSÚ (registr kandidátů pro komunální volby 2026), ne z ruky. Cílem je, abyste ji za pár minut prošel(a) a rozhodl(a) u sporných měst. Co v tabulce nesedí, opravíte v souboru \`src/mesta/overrides.js\` (návod níže), nikoli v tomto dokumentu.

## Jak číst sloupce

- **kraj, město** – kraj a název; **KODZASTUP / OKRES / VSTRANA / SLOZENI** (sloupec „zdroj“) jsou kódy z registru ČSÚ, podle kterých lze vše dohledat.
- **inclusion** – proč je město zařazeno: \`auto\` = má ≥ 10 000 obyvatel a Piráti kandidují (typ a/b); \`hraniční, zařazeno\` = 7 000–9 999 obyvatel a máme důvod (viz **borderline_reason**); \`vyřazeno\` = nezveřejněno.
- **borderline_reason** – u malých (hraničních) měst důvod, proč je přesto zařazeno (např. „na seznamu majitele“, „Piráti 2022: 11,7 %, 2 mand.“, „sídlo okresu“).
- **obyvatel (2026 / 2025)** – počet obyvatel z registru voleb 2026 (rozhoduje o zařazení) a z tabulky ČSÚ k 1. 1. 2025 (jen kontrola pásma).
- **typ** – **a** = Piráti mají vlastní kandidátku; **b** = Piráti jsou ve společné kandidátce (koalice nebo sdružení); **c** = Piráti jsou jen jednotlivci na cizích kandidátkách; **d** = Piráti tu vůbec nekandidují. Zveřejňují se typy a a b.
- **č., název, druh, partneři** – číslo a název kandidátky, druh (strana / koalice / sdružení) a koaliční partneři (NK = nezávislí kandidáti).
- **členové Pirátů na kandidátce** – počet kandidátů, kteří jsou členy Pirátů, a první tři jména. „Nominovaní nečlenové“ jsou lidé, které navrhli Piráti, ale členy nejsou.
- **Piráti na jiných kandidátkách** – členové Pirátů, kteří kandidují za jinou kandidátku.
- **příznaky** – technické poznámky generátoru (např. \`borderline-auto\`, \`no-members-on-pirate-list\`, \`jmsez-mismatch\`).
- **confidence** – jistota generátoru: \`high\` = zveřejněno hned.

## Co znamená „confidence low / skryto“

Když si generátor není jistý (hraniční město zařazené jen automatickým důvodem, rozdíl proti druhému zdroji, nejasné složení kandidátky), dá městu **confidence low**. Takové město je **skryto**: na webu nemá vlastní stránku a není v seznamu měst, dokud ho nepotvrdíte. Je to pojistka proti omylu, ne verdikt. Řádky označené „low (skryto)“ jsou ty, které je třeba schválit.

## Jak změnit město (\`src/mesta/overrides.js\`)

V souboru je objekt \`towns\` (klíč = KODZASTUP v uvozovkách, vždy s \`name\` přesně jako v registru). Zkopírujte vhodný příklad do \`towns: { … }\`:

\`\`\`js
export default {
    reviewedAt: null,            // až budete mít vše projité: '2026-10-11' odkryje VŠECHNA skrytá (low) města najednou
    towns: {
        // 1) Schválit skryté město (např. Mikulov): město se zobrazí
        '584649': { name: 'Mikulov', reviewed: true },

        // 2) Město úplně vyřadit (důvod je povinný)
        '503444': { name: 'Litovel', include: false, reason: 'Piráti tu kandidují jen do Senátu' },

        // 3) Město zařadit i přes pravidla (důvod je povinný; u typu c/d se zobrazí vysvětlující text)
        '511111': { name: 'Příklad', include: true, reason: 'majitel: chceme ho mít' },

        // 4) Hraniční město zařadit ručním důvodem
        '999999': { name: 'Příklad', borderlineReason: 'Domov kandidáta na senátora' },
    },
};
\`\`\`

Pozor: KODZASTUP a \`name\` musí sedět s registrem (viz sloupec „zdroj“), jinak generátor skončí chybou. Po úpravě pusťte \`npm test\`; generované soubory se obnoví příkazem \`node scripts/mesta-registry.js\`.`;

function decisionRows(rows) {
    const nameOf = (r) => `**${r.name}**`;
    const sections = [];
    const sorted = [...rows].sort(rowKey);

    const autoBorderline = sorted.filter((r) => r.published && r.inclusion === 'borderline-included' && r.flags.includes('borderline-auto'));
    sections.push(`### 1. Hraniční města zveřejněná jen kvůli výsledku 2022 (skryta, dokud je nepotvrdíte)

Tato města mají pod 10 000 obyvatel; do výběru se dostala jen kvůli automatickému důvodu (výsledek Pirátů v roce 2022, sídlo okresu apod.), ne kvůli vašemu seznamu. Proto jsou **skryta**. **Otázka: zveřejnit?** Ano = do \`overrides.js\` přidat \`reviewed: true\` (příklad 1 výše), ne = \`include: false\`.

${autoBorderline.length ? table(['Město', 'KODZASTUP', 'Obyvatel', 'Typ', 'Důvod (borderline_reason)', 'Stav'], autoBorderline.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.borderlineReason, confidenceCell(r)])) : '_Žádné._\n'}`);

    const ownerBorderline = sorted.filter((r) => r.published && r.inclusion === 'borderline-included' && !r.flags.includes('borderline-auto'));
    sections.push(`### 2. Hraniční města zveřejněná kvůli seznamu majitele / ručnímu důvodu

${ownerBorderline.length ? table(['Město', 'KODZASTUP', 'Obyvatel', 'Typ', 'Důvod (borderline_reason)', 'Stav'], ownerBorderline.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.borderlineReason, confidenceCell(r)])) : '_Žádné._\n'}
Zde stačí potvrdit, že je chcete mít zveřejněná.`);

    const be = sorted.filter((r) => r.inclusion === 'borderline-excluded');
    sections.push(`### 3. Hraniční města bez důvodu (nezveřejněna)

Piráti tu kandidují (typ a/b), ale město má 7 000–9 999 obyvatel a nic z pravidel ho nezařadilo. **Otázka: přidat některé?** Ano = \`include: true\` s důvodem (příklad 3).

${be.length ? table(['Město', 'KODZASTUP', 'Obyvatel', 'Typ', 'Pozn.'], be.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.reasonText])) : '_Žádné._\n'}`);

    const added = sorted.filter((r) => r.published && !r.onOwnerList && r.inclusion !== 'borderline-included');
    sections.push(`### 4. Spočítáno, ale není na seznamu majitele (už zveřejněno)

Město splňuje pravidla (≥ 10 000 obyvatel, Piráti na kandidátce), i když ho seznam nemá. **Otázka: ponechat?** Ne = \`include: false\` s důvodem (příklad 2).

${added.length ? table(['Město', 'KODZASTUP', 'Obyvatel', 'Typ', 'Kandidátka'], added.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.type, r.list ? `č. ${r.list.id} ${r.list.name}` : '–'])) : '_Žádné._\n'}`);

    const rej = sorted.filter((r) => !r.published && r.onOwnerList);
    const mentioned = sorted.filter((r) => !r.published && !r.onOwnerList && r.note);
    sections.push(`### 5. Města ze seznamu majitele, která jsme zamítli (${rej.length})

**Otázka: souhlasíte?** Pokud některé chcete mít přesto, použijte \`include: true\` (příklad 3). Typ c/d se pak zobrazí s vysvětlením „Piráti tu nekandidují“ / „jen na cizích kandidátkách“.

${rej.length ? table(['Město', 'KODZASTUP', 'Obyvatel', 'Důvod zamítnutí'], rej.map((r) => [nameOf(r), r.zastup, spaced(r.population), r.reasonText])) : '_Žádná._\n'}${mentioned.length ? `\nMimo soubor seznamu, zmíněno majitelem: ${mentioned.map((r) => `**${r.name}** – ${r.reasonText}; ${r.note}`).join('; ')}.\n` : ''}`);

    const nn = sorted.filter((r) => r.published && r.members.length === 0 && nominated(r) > 0);
    const allNominated = rows.filter((r) => r.published).reduce((s, r) => s + nominated(r), 0);
    const townsWithNominated = rows.filter((r) => r.published && nominated(r) > 0).length;
    sections.push(`### 6. Zobrazit nominované nečleny?

V těchto městech je kandidátka označená jako Pirátská (koalice/sdružení s Piráty), ale **žádný z kandidátů není člen Pirátů** – na ní jsou jen lidé, které Piráti navrhli (nominovali). Dnes se na webu jako „kandidáti Pirátů“ zobrazují jen **členové**, takže tu nebude nikdo. **Otázka: Zobrazit nominované nečleny?** (Platí obecně: v celém výběru je ${allNominated} nominovaných nečlenů v ${townsWithNominated} městech.)

${nn.length ? table(['Město', 'KODZASTUP', 'Kandidátka', 'Nominovaných nečlenů', 'Členů Pirátů'], nn.map((r) => [nameOf(r), r.zastup, r.list ? `č. ${r.list.id} ${r.list.name}` : '–', nominated(r), 0])) : '_Žádné město._\n'}`);

    const odd = sorted.filter((r) => r.published && r.flags.some((f) => ['jmsez-mismatch', 'population-band-differs', 'multiple-pirate-lists', 'unknown-partner-code'].includes(f)));
    sections.push(`### 7. Města označená kontrolou (low, skryta)

Zde se zdroje rozcházejí (jmenný seznam, počet obyvatel 2025, více pirátských kandidátek, neznámý partner).

${odd.length ? table(['Město', 'KODZASTUP', 'Příznaky', 'Obyvatel (2026 / 2025)', 'Stav'], odd.map((r) => [nameOf(r), r.zastup, r.flags.join(', '), popCell(r), confidenceCell(r)])) : '_Žádná – kontroly sedí._\n'}`);
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
        ['auto', incCount.get('auto') || 0],
        ['borderline-included', incCount.get('borderline-included') || 0],
        ['forced', incCount.get('forced') || 0],
        ['**zveřejněno celkem**', `**${published.length}**`],
        ['z toho skryto (low, čeká na potvrzení)', hidden],
        ['borderline-excluded (nezveřejněno)', be.length],
        ['zamítnuto ze seznamu majitele', rejected.length],
    ])}
${table(['Typ kandidatury (zveřejněná města)', 'Počet'], ['a', 'b', 'c', 'd'].map((t) => [`typ ${t}`, typeCount.get(t) || 0]))}`;

    const main = [...published].sort(rowKey).concat([...rejected].sort(rowKey));
    const head = ['kraj', 'město', 'inclusion', 'borderline_reason', 'obyvatel (2026 / 2025)', 'typ', 'č.', 'název', 'druh', 'partneři', 'členové Pirátů na kandidátce', 'Piráti na jiných kandidátkách', 'zdroj (KODZASTUP / OKRES / VSTRANA / SLOZENI)', 'příznaky', 'confidence'];
    const body = main.map((r) => [
        r.krajName, r.name, r.published ? inclusionCell(r) : `vyřazeno: ${r.reasonText}`, r.borderlineReason || '–', popCell(r), r.type, listCell(r), r.list?.name ?? '–',
        r.list?.kind ?? '–', partnersOf(r), membersCell(r), othersCell(r), sourceCell(r), r.flags.join(', ') || '–', confidenceCell(r),
    ]);

    return `# Přehled měst a kandidatur Pirátů (review tabulka „města“)

${INTRO}

${counts}
## K rozhodnutí vlastníka

Níže je vše, co generátor nemůže rozhodnout sám. U každé skupiny je otázka a návod, jak odpovědět.

${decisionRows(rows)}
## Zdroje a kontroly

${sourcesBlock(meta)}

## Tabulka všech měst

Nejdřív zveřejněná města (podle kraje a abecedy), na konci města ze seznamu majitele, která jsme vyřadili. Členy Pirátů registr ČSÚ vede u kandidáta (PSTRANA 720); **příznivci bez členství se z dat poznat nedají** – ty by majitel doplnil v \`overrides.js\` (\`pirateCandidates\`).

${table(head, body)}`;
}

// ---------------------------------------------------------------- mesta-list-verification.md

function verifyTable(rows, { reason = false } = {}) {
    const head = ['Kraj', 'Město', 'KODZASTUP', 'Obyvatel (2026 / 2025)', 'Typ', 'Zařazení', 'borderline_reason', 'Příznaky', reason ? 'Důvod zamítnutí' : 'Na seznamu majitele'];
    return table(head, [...rows].sort(rowKey).map((r) => [
        r.krajName, `**${r.name}**`, r.zastup, popCell(r), r.type, INCLUSION_CZ[r.inclusion] ?? r.inclusion,
        r.borderlineReason || '–', r.flags.join(', ') || '–',
        reason ? [r.reasonText, r.note].filter(Boolean).join('; ') + (r.onOwnerList ? '' : ' (ne – mimo soubor seznamu)') : r.onOwnerList ? 'ano' : 'ne',
    ]));
}

export function renderVerification({ confirmed, rejected, added, borderlineExcluded, notes = [] }, meta = {}) {
    const fromList = rejected.filter((r) => r.onOwnerList);
    const outside = rejected.filter((r) => !r.onOwnerList);
    const total = confirmed.length + fromList.length;
    const ownerCheck = meta.ownerCount === undefined ? '' : ` (soubor \`docs/analysis/mesta-towns.txt\` má ${meta.ownerCount} jmen: ${total === meta.ownerCount ? 'součet sedí' : 'SOUČET NESEDÍ'})`;
    const borderMarked = [...confirmed, ...added].filter((r) => r.inclusion === 'borderline-included');

    return `# Ověření seznamu měst majitele

Seznam majitele (\`docs/analysis/mesta-towns.txt\`) se **nepovažuje za ověřený**: každé jméno se spáruje s radnicí v registru ČSÚ podle KODZASTUP a pak se pravidly (spec §4.1) rozhodne, zda město zveřejnit. Tři tabulky níže dohromady dávají všechna jména ze seznamu a všechna města navíc. Sloupec **borderline_reason** vyplněný = hraniční město (7 000–9 999 obyvatel), zařazené z uvedeného důvodu.

${sourcesBlock(meta)}

## Počty

- potvrzeno: ${confirmed.length}
- zamítnuto ze seznamu majitele: ${fromList.length}
- na seznamu majitele celkem: ${total}${ownerCheck}
- splňují pravidla, ale není na seznamu majitele: ${added.length}
- hraniční města zařazená (borderline_reason): ${borderMarked.length}${borderMarked.length ? ` (${borderMarked.map((r) => r.name).join(', ')})` : ''}
- hraniční města bez důvodu, nezařazená: ${borderlineExcluded.length}
${outside.length ? `- mimo soubor seznamu, zmíněno majitelem: ${outside.map((r) => r.name).join(', ')} – viz tabulka 2 (nepočítá se do ${total})\n` : ''}
## 1. Potvrzená města ze seznamu majitele (${confirmed.length})

${verifyTable(confirmed)}
## 2. Zamítnutá města ze seznamu majitele (${fromList.length}${outside.length ? ` + ${outside.length} mimo soubor seznamu` : ''})

${verifyTable(rejected, { reason: true })}
## 3. Splňují pravidla, ale není na seznamu majitele (${added.length})

Spočteno z registru; v generovaných datech jsou zařazena (po kontrole majitelem je lze odebrat přes \`include: false\`).

${verifyTable(added)}
## 4. Hraniční města bez důvodu, nezařazená (${borderlineExcluded.length})

${borderlineExcluded.length ? table(['Kraj', 'Město', 'KODZASTUP', 'Obyvatel (2026 / 2025)', 'Typ', 'borderline_reason', 'Poznámka'], [...borderlineExcluded].sort(rowKey).map((r) => [r.krajName, `**${r.name}**`, r.zastup, popCell(r), r.type, '– (žádný důvod)', r.reasonText])) : '_Žádná._\n'}
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
                name: t.name, okres: t.okres, generated: j.generovano ?? null, mismatch: jmsezMismatch(j, specBy.get(t.zastup)), rows: jmsezPirates(j),
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
