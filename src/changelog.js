// Jediný zdroj pravdy o verzi aplikace.
//
// Nová verze = přidat záznam NA ZAČÁTEK pole. Verze prvního záznamu je
// aktuální verze aplikace — propíše se do version.json při buildu (viz
// vite.config.js) a klienti se podle ní samy obnoví po nasazení.
//
// type položky: 'new' (novinka) | 'improved' (vylepšení) | 'fixed' (oprava)

export const CHANGELOG = [
    {
        version: '1.5.1',
        date: '2026-10-07',
        title: 'Anonymní měření návštěvnosti',
        items: [
            { type: 'improved', text: 'Počítáme, kolik lidí výsledky sleduje a na které městské části — anonymně, bez cookies, IP adres a jakýchkoli identifikátorů' },
        ],
    },
    {
        version: '1.5.0',
        date: '2026-10-07',
        title: 'Piráti i na jiných kandidátkách',
        items: [
            { type: 'new', text: 'Přehled ukazuje nad ostatními městskými částmi i ty, kde naše členky kandidují na kandidátkách místních uskupení (Dolní Měcholupy, Klánovice, Kunratice, Suchdol) — jak si kandidátka vede a jestli by měly mandát' },
            { type: 'new', text: 'Stránky těchto MČ mají kartu s naší kandidátkou, jejími preferenčními hlasy a odhadem mandátu' },
            { type: 'new', text: 'Krátký průvodce při první návštěvě: stránka se obnovuje sama a ruční obnovení nic nezrychlí' },
            { type: 'improved', text: 'U odpočtu je napsané, za jak dlouho se stránka sama obnoví — i na telefonu' },
        ],
    },
    {
        version: '1.4.0',
        date: '2026-10-06',
        title: 'Pohodlnější ovládání na mobilu',
        items: [
            { type: 'fixed', text: 'Společné kandidátky s Piráty mají celý název a vlastní logo (např. Piráti, PRAHA 3 SOBĚ a Edita Janečková; Piráti a Starostové), ne jen „Piráti"' },
            { type: 'fixed', text: 'Karty městských částí na přehledu se vejdou na šířku telefonu — počet mandátů byl mimo obrazovku' },
            { type: 'fixed', text: 'Menu zastupitelstev přes celou obrazovku, s odkazem zpět na přehled nahoře a rovnou u aktuální MČ' },
            { type: 'improved', text: 'Telefon na šířku dostane mobilní rozložení se spodní lištou místo stísněné desktopové verze' },
            { type: 'improved', text: 'Detail okrsku nezakryje vybraný okrsek, zavře se klepnutím do mapy; klepnutí na stranu ji ukáže na mapě' },
            { type: 'improved', text: 'Větší tlačítka a odkazy pro prst, křesla v půlkruhu jde vybrat i přejetím prstem' },
            { type: 'improved', text: 'Záložky si pamatují, kam jsi odroloval/a; otevřená záložka a okrsek přežijí obnovení stránky' },
            { type: 'improved', text: 'Brouk při rolování uhne a nezakrývá čísla; čitelnější drobný text' },
            { type: 'new', text: 'Na telefonu je mapa okrsků vypnutá a šetří data (zhruba 1 MB) i baterii — zapneš ji jedním klepnutím v záložce Mapa nebo v menu, volba se pamatuje' },
            { type: 'improved', text: 'Přehled se načte zhruba čtyřikrát rychleji — mapa se stahuje, až když je potřeba' },
            { type: 'improved', text: 'Během volebního večera se po aktualizaci novinky neotevírají přes výsledky' },
        ],
    },
    {
        version: '1.3.0',
        date: '2026-10-06',
        title: 'Nahlášení chyby',
        items: [
            { type: 'new', text: 'Brouk vpravo dole — chybu nahlásíš přímo z aplikace, i se screenshotem (přetažením, výběrem nebo Ctrl+V)' },
            { type: 'improved', text: 'Každá změna se nasazuje automaticky, takže web vždy odpovídá aktuální verzi' },
        ],
    },
    {
        version: '1.2.0',
        date: '2026-10-06',
        title: 'Verzování a šetrnější obnovování',
        items: [
            { type: 'new', text: 'Automatická aktualizace — když vyjde nová verze, stránka se sama obnoví' },
            { type: 'new', text: 'Přehled novinek („Co je nové" v menu a v patičce přehledu); po aktualizaci se jednou ukáže sám' },
            { type: 'improved', text: 'Obnovit výsledky jde až po vypršení odpočtu — data se stejně mění jen po minutě a zbytečné dotazy zatěžují server' },
            { type: 'improved', text: 'Obnovení stránky před koncem odpočtu ukáže poslední načtená data a další kontrolu udělá až v plánovaný čas' },
        ],
    },
    {
        version: '1.1.0',
        date: '2026-10-06',
        title: 'Celá Praha',
        items: [
            { type: 'new', text: 'Všech 57 městských částí — každá má vlastní stránku s mapou okrsků, mandáty, zastupiteli a koalicemi' },
            { type: 'new', text: 'Přehled celé Prahy: kolik mandátů mají Piráti dohromady v MČ a na Magistrátu, karta každé MČ s průběžným procentem a mandáty už během sčítání' },
            { type: 'new', text: 'Řazení MČ podle čísla, procent nebo mandátů; čerstvě změněné MČ krátce zablikají' },
            { type: 'new', text: 'Demo sčítání celé Prahy na přehledu (?demo)' },
            { type: 'improved', text: 'Srovnání s rokem 2022 i u místních sdružení nezávislých (PRAHA 7 SOBĚ, SOS Suchdol…)' },
            { type: 'improved', text: 'Stránky MČ, kde Piráti nekandidují, ukazují výsledky všech kandidátek' },
        ],
    },
    {
        version: '1.0.0',
        date: '2026-10-06',
        title: 'Živé výsledky voleb 2026',
        items: [
            { type: 'new', text: 'Průběžné výsledky Prahy 3, 6, 11 a Magistrátu z volby.gov.cz přes náš server, samy se obnovují každou minutu' },
            { type: 'new', text: 'Odhad mandátů podle zákona (5% klauzule, d\'Hondt, preferenční hlasy) a půlkruh zastupitelstva' },
            { type: 'new', text: 'Mapa okrsků, zvolení zastupitelé, koalice a přehled okrsků v pořadí, jak je komise posílají' },
            { type: 'new', text: 'Demo sčítání na vyzkoušení (menu → Demo sčítání)' },
        ],
    },
];

export const APP_VERSION = CHANGELOG[0].version;
