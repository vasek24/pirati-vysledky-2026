// Konfigurace pražských zastupitelstev — JEDINÉ místo s ručně zadaným
// politickým kontextem (kdo jsou Piráti, kdo tvoří současnou koalici,
// zkrácené názvy kandidátek). Všechno ostatní (kandidátky, kandidáti, loga,
// barvy, okrsky, výsledky 2022, předchůdci kandidátek) generuje
// `npm run data` do public/data/<slug>/.
//
// Soubor je čisté JS bez závislostí — importuje ho prohlížeč, serverová
// funkce api/volby.js i skripty v scripts/.

// Komunální volby 9.–10. 10. 2026
export const KV_DATE = 20261009;
export const KV_BASE_URL = `https://volby.gov.cz/appdata/kv2026/${KV_DATE}`;
// Volební místnosti se zavírají v sobotu 10. 10. 2026 ve 14:00
export const POLLS_CLOSE = Date.parse('2026-10-10T14:00:00+02:00');
// Kód Pirátské strany v číselníku volebních stran ČSÚ (CVS)
export const PIRATES_CODE = 720;

/**
 * Všechna zastupitelstva v Praze: Magistrát + 57 městských částí. Řádky
 * vygenerované z registrů ČSÚ KV 2026 (navig/obce/1100.json, kvrzcoco.csv,
 * kvros.csv) — kandidátky jsou od 2. 10. 2026 konečné:
 *
 *   [slug, kód zastupitelstva (KODZASTUP), název, mandátů, okrsků,
 *    číslo kandidátky, na které kandidují Piráti (strana 720 ve složení);
 *    null = Piráti v MČ nekandidují]
 */
const PRAHA = [
    ['praha', 554782, 'Praha', 65, 1120, 7],
    ['praha-1', 500054, 'Praha 1', 27, 21, 13],
    ['praha-2', 500089, 'Praha 2', 35, 41, 8],
    ['praha-3', 500097, 'Praha 3', 35, 52, 1],
    ['praha-4', 500119, 'Praha 4', 45, 132, 2],
    ['praha-5', 500143, 'Praha 5', 41, 81, 8],
    ['praha-6', 500178, 'Praha 6', 45, 104, 4],
    ['praha-7', 500186, 'Praha 7', 29, 36, 6],
    ['praha-8', 500208, 'Praha 8', 45, 106, 6],
    ['praha-9', 500216, 'Praha 9', 33, 43, 7],
    ['praha-10', 500224, 'Praha 10', 45, 109, 7],
    ['praha-11', 547034, 'Praha 11', 35, 62, 6],
    ['praha-12', 547107, 'Praha 12', 35, 50, 9],
    ['praha-13', 539694, 'Praha 13', 35, 58, 5],
    ['praha-14', 547361, 'Praha 14', 31, 32, 7],
    ['praha-15', 547387, 'Praha 15', 31, 23, 9],
    ['praha-16', 539601, 'Praha 16', 15, 8, 4],
    ['praha-17', 547174, 'Praha 17', 23, 18, null],
    ['praha-18', 547417, 'Praha 18', 23, 12, 6],
    ['praha-19', 547344, 'Praha 19', 19, 6, null],
    ['praha-20', 538213, 'Praha 20', 25, 12, null],
    ['praha-21', 538949, 'Praha 21', 17, 8, null],
    ['praha-22', 538931, 'Praha 22', 25, 9, 4],
    ['praha-bechovice', 538060, 'Praha-Běchovice', 15, 2, null],
    ['praha-benice', 538078, 'Praha-Benice', 7, 1, null],
    ['praha-brezineves', 538124, 'Praha-Březiněves', 9, 1, null],
    ['praha-cakovice', 547310, 'Praha-Čakovice', 21, 8, null],
    ['praha-dablice', 547298, 'Praha-Ďáblice', 15, 2, null],
    ['praha-dolni-chabry', 547301, 'Praha-Dolní Chabry', 15, 4, null],
    ['praha-dolni-mecholupy', 547379, 'Praha-Dolní Měcholupy', 15, 2, null],
    ['praha-dolni-pocernice', 538175, 'Praha-Dolní Počernice', 15, 2, null],
    ['praha-dubec', 538205, 'Praha-Dubeč', 15, 2, null],
    ['praha-klanovice', 538302, 'Praha-Klánovice', 15, 2, null],
    ['praha-kolodeje', 538353, 'Praha-Koloděje', 7, 1, null],
    ['praha-kolovraty', 538361, 'Praha-Kolovraty', 15, 4, null],
    ['praha-kralovice', 538388, 'Praha-Královice', 5, 1, null],
    ['praha-kreslice', 538400, 'Praha-Křeslice', 7, 1, null],
    ['praha-kunratice', 547042, 'Praha-Kunratice', 15, 6, null],
    ['praha-libus', 547051, 'Praha-Libuš', 17, 6, null],
    ['praha-lipence', 539449, 'Praha-Lipence', 15, 1, null],
    ['praha-lochkov', 539465, 'Praha-Lochkov', 9, 1, null],
    ['praha-lysolaje', 547140, 'Praha-Lysolaje', 9, 1, null],
    ['praha-nebusice', 547158, 'Praha-Nebušice', 11, 2, null],
    ['praha-nedvezi', 538531, 'Praha-Nedvězí', 5, 1, null],
    ['praha-petrovice', 547395, 'Praha-Petrovice', 15, 4, 5],
    ['praha-predni-kopanina', 539589, 'Praha-Přední Kopanina', 9, 1, null],
    ['praha-reporyje', 539635, 'Praha-Řeporyje', 15, 3, 3],
    ['praha-satalice', 538736, 'Praha-Satalice', 11, 1, null],
    ['praha-slivenec', 539678, 'Praha-Slivenec', 15, 3, null],
    ['praha-suchdol', 547271, 'Praha-Suchdol', 15, 5, null],
    ['praha-seberov', 539724, 'Praha-Šeberov', 15, 2, null],
    ['praha-sterboholy', 547409, 'Praha-Štěrboholy', 9, 2, null],
    ['praha-troja', 547328, 'Praha-Troja', 9, 1, null],
    ['praha-ujezd', 539791, 'Praha-Újezd', 15, 3, null],
    ['praha-velka-chuchle', 547115, 'Praha-Velká Chuchle', 15, 3, null],
    ['praha-vinor', 539007, 'Praha-Vinoř', 15, 3, null],
    ['praha-zbraslav', 539864, 'Praha-Zbraslav', 17, 10, 2],
    ['praha-zlicin', 539899, 'Praha-Zličín', 15, 5, null],
];

/**
 * SPIKE: města mimo Prahu (jedno zastupitelstvo = jedno město, bez MČ).
 *   [slug, okres (NUTS), kód zastupitelstva, název, mandátů, okrsků, pirátská kandidátka]
 */
const MESTA = [
    ['brno', 6202, 582786, 'Brno', 55, 353, 15],
    ['ostrava', 8106, 554821, 'Ostrava', 55, 246, 12],
    ['plzen', 3203, 554791, 'Plzeň', 47, 174, 11],
];

const MAGISTRAT = 554782;

/**
 * Ruční politický kontext (klíč = slug). Co tu chybí, má výchozí hodnotu:
 * bez koalice, zkratky z registru ČSÚ, mapa okrsků zapnutá.
 *
 * title       – plný název zastupitelstva (výchozí „Zastupitelstvo městské části …")
 * coalition   – současná koalice (2022–2026) přepočtená na čísla kandidátek
 *               2026; seats2022 = kolik měla mandátů po volbách 2022
 * lists       – zkrácené názvy kandidátek (short = seznamy, tiny = mapa/čipy),
 *               volitelně barva; co tu chybí, vezme se z registru ČSÚ
 *               a programydovoleb.cz. Pirátské kandidátce short nepřepisovat —
 *               má se ukazovat celý název kandidátky z registru, jen tiny.
 * photos      – vlastní fotky kandidátů (public/media/<slug>/photos/),
 *               mají přednost před fotkami z programydovoleb.cz
 * map         – mapa okrsků (u Magistrátu zatím vypnutá, viz docs/MAGISTRAT.md)
 * precinctFiles – stahovat okrskové výsledky (1 soubor = 1 okrsek)
 * pirateCandidates – členové Pirátů na kandidátce jiného uskupení v MČ bez
 *               pirátské kandidátky: [{ list, n, name }] = číslo kandidátky,
 *               pořadí na listině, jméno. Přehled tyhle MČ ukazuje nad ostatními.
 */
const DETAIL = {
    // Členky Pirátů na kandidátkách místních uskupení (příslušnost „Piráti"
    // v jmenném seznamu ČSÚ, navržené jako nezávislé nebo za PRAHA SOBĚ)
    'praha-dolni-mecholupy': { pirateCandidates: [{ list: 3, n: 6, name: 'Maki Němečková' }] },
    'praha-klanovice': { pirateCandidates: [{ list: 2, n: 4, name: 'Zuzana Vyskočilová' }] },
    'praha-kunratice': { pirateCandidates: [{ list: 4, n: 6, name: 'Veronika Nürnbergerová' }] },
    'praha-suchdol': { pirateCandidates: [{ list: 2, n: 6, name: 'Gabriela Lněničková' }] },
    'praha-3': {
        coalition: {
            lists: [5, 1, 7],
            label: 'TOP 09 + STAN, Piráti a Zelení',
            seats2022: 19,
            seatsTotal2022: 35,
        },
        lists: {
            // název kandidátky z registru (Piráti, PRAHA 3 SOBĚ a Edita Janečková)
            1: { tiny: 'Piráti + P3 sobě' },
            2: { short: 'ANO', tiny: 'ANO' },
            3: { short: 'Motoristé + Patrioti', tiny: 'Motoristé' },
            4: { short: 'Praha 3 srdcem', tiny: 'P3 srdcem', note: 'KDU-ČSL + GEN' },
            5: { short: 'TOP 09 + STAN', tiny: 'TOP+STAN' },
            6: { short: 'ODS + Soukromníci', tiny: 'ODS' },
            7: { short: 'Zelení', tiny: 'Zelení' },
            8: { short: 'KSČM', tiny: 'KSČM' },
            9: { short: 'SPD + Trikolora', tiny: 'SPD' },
        },
        photos: {
            1: {
                1: 'Edita.webp',
                2: 'Jan.webp',
                3: 'Filip.webp',
                4: 'Denisa.webp',
                5: 'Konradova.webp',
                6: 'Jakub.webp',
                7: 'Musil.webp',
                8: 'Chab.webp',
                9: 'Gargulak.webp',
                10: 'Knoblochova.webp',
            },
        },
        map: true,
        precinctFiles: true,
    },
    'praha-6': {
        coalition: {
            // 2022: ODS + KDU-ČSL, STAN (s podporou Zelených), PRAHA 6 SOBĚ.
            // Letos jdou Zelení s PRAHA SOBĚ — proto kandidátka 6.
            lists: [7, 1, 6],
            label: 'ODS + KDU-ČSL, STAN a PRAHA SOBĚ',
            seats2022: 23,
            seatsTotal2022: 45,
        },
        lists: {
            1: { short: 'STAN', tiny: 'STAN' },
            2: { short: 'GEN', tiny: 'GEN' },
            3: { short: 'KSČM', tiny: 'KSČM' },
            4: { tiny: 'Piráti' },
            5: { short: 'SPD', tiny: 'SPD' },
            6: { short: 'PRAHA 6 SOBĚ', tiny: 'P6 sobě', note: 'PRAHA SOBĚ se Zelenými', color: '#FBDC02' },
            7: { short: 'ODS + KDU-ČSL', tiny: 'ODS+KDU', color: '#2868E6' },
            8: { short: 'ANO', tiny: 'ANO' },
            9: { short: 'TOP 09', tiny: 'TOP 09' },
            10: { short: 'Motoristé + Svobodní', tiny: 'Motoristé' },
            11: { short: 'JSME PRAHA 6', tiny: 'JSME P6' },
        },
        photos: {},
        map: true,
        precinctFiles: true,
    },
    'praha-11': {
        coalition: {
            // 2023–2026: Piráti (starosta), ANO, ODS a klub TOP 09 + STAN
            lists: [6, 10, 5, 2],
            label: 'Piráti, ANO, ODS a TOP 09 + STAN',
            seats2022: 20,
            seatsTotal2022: 35,
        },
        lists: {
            1: { short: 'Motoristé + Svobodní', tiny: 'Motoristé' },
            2: { short: 'TOP 09 + STAN', tiny: 'TOP+STAN' },
            3: { short: 'GEN', tiny: 'GEN' },
            4: { short: 'PRAHA 11 SOBĚ', tiny: 'P11 sobě' },
            5: { short: 'Spolu pro Prahu 11 (ODS)', tiny: 'ODS', color: '#2868E6' },
            6: { tiny: 'Piráti' },
            7: { short: 'Výzva pro Prahu 11', tiny: 'Výzva' },
            8: { short: 'Hnutí pro Prahu 11', tiny: 'HPP 11' },
            9: { short: 'SPD + Trikolora', tiny: 'SPD' },
            10: { short: 'ANO', tiny: 'ANO' },
        },
        photos: {},
        map: true,
        precinctFiles: true,
    },
    praha: {
        // Zastupitelstvo hl. m. Prahy — připravené v „lehkém" režimu: bez mapy
        // a bez okrskových souborů (1 120 okrsků), viz docs/MAGISTRAT.md
        title: 'Zastupitelstvo hlavního města Prahy',
        coalition: {
            // 2023–2026: SPOLU (ODS, TOP 09, KDU-ČSL), Piráti, STAN.
            // KDU-ČSL letos na Magistrátu s ODS + TOP 09 nekandiduje.
            lists: [12, 7, 9],
            label: 'ODS + TOP 09, Piráti a STAN',
            seats2022: 37,
            seatsTotal2022: 65,
        },
        lists: {
            5: { short: 'PRAHA SOBĚ', tiny: 'PS' },
            7: { tiny: 'Piráti' },
            9: { short: 'STAN', tiny: 'STAN' },
            10: { short: 'SPD', tiny: 'SPD' },
            11: { short: 'GEN', tiny: 'GEN' },
            12: { short: 'SPOLU (ODS + TOP 09)', tiny: 'SPOLU', color: '#2FD2D3' },
            14: { short: 'Motoristé', tiny: 'AUTO' },
            20: { short: 'KSČM + KSČ + ČSSD', tiny: 'KSČM' },
            22: { short: 'ANO', tiny: 'ANO' },
        },
        photos: {},
        map: false,
        precinctFiles: false,
        beta: true,
    },
};

/**
 * slug        – adresa stránky (/praha-6)
 * zastup      – kód zastupitelstva (KODZASTUP) v datech ČSÚ
 * okres       – NUTS okresu v datech ČSÚ (Praha = 1100, jinde viz MESTA)
 * seats       – počet mandátů 2026
 * precincts   – počet okrsků 2026
 * pirates     – číslo pirátské kandidátky (null = Piráti nekandidují)
 * pirateCandidates – Piráti na jiných kandidátkách, viz DETAIL
 * coalition   – viz DETAIL (null = neznámá / nezadaná)
 * magistrat   – Zastupitelstvo hl. m. Prahy (ne městská část)
 */
const BASE = {
    pirateCandidates: [],
    coalition: null,
    lists: {},
    photos: {},
    map: true,
    precinctFiles: true,
};

export const COUNCILS = [
    ...PRAHA.map(([slug, zastup, name, seats, precincts, pirates]) => ({
        ...BASE,
        slug,
        name,
        title: `Zastupitelstvo městské části ${name}`,
        zastup,
        okres: 1100,
        seats,
        precincts,
        pirates,
        magistrat: zastup === MAGISTRAT,
        ...DETAIL[slug],
    })),
    ...MESTA.map(([slug, okres, zastup, name, seats, precincts, pirates]) => ({
        ...BASE,
        slug,
        name,
        title: `Zastupitelstvo města ${name}`,
        zastup,
        okres,
        seats,
        precincts,
        pirates,
        magistrat: false,
        wholeObec: true, // okrsky se hledají podle kod_obec (celé město), ne kod_mco
        ...DETAIL[slug],
    })),
];

export const councilBySlug = (slug) => COUNCILS.find((c) => c.slug === slug) || null;
export const councilByZastup = (zastup) => COUNCILS.find((c) => c.zastup === Number(zastup)) || null;
export const majorityOf = (seats) => Math.floor(seats / 2) + 1;
