// Veškerý statický český text stránky. Slova převzatá z odsouhlaseného náhledu
// (docs/superpowers/mockups/senat-mockup.html); texty bannerů a pár doplňků jsou
// označené „doplněno“. Pravidlo (spec §5): žádné rodově ohebné označení osoby
// (kandidát, zvolen, podporovaný, postoupil …) — viz text.test.js.
// Registrové údaje (jména, tituly, povolání, názvy na lístku) se zobrazují
// doslova tak, jak je publikuje ČSÚ, a tento soubor se jich netýká.

export const HOME_URL = 'https://volby.dg12.cz'
export const SOURCE_URL = 'https://volby.gov.cz/app/senat/20261009/cs/home'
export const CONTACT_TEL = '+420777954389'

export const REL = { ticket: 'Kandiduje za Piráty', endorsed: 'S podporou Pirátů' }

export const CHIP = {
  elected: 'Mandát získán',
  advancing: 'Postup do 2. kola',
  notAdvancing: 'Nepostupuje',
  runoffLost: 'Mandát nezískán',
  runoffTie: 'Shoda hlasů, mandát nezískal nikdo',
  leading: 'Vede',
  second: '2. místo',
  behind: 'Mimo postupové pozice',
  runoffLeading: 'Vede ve 2. kole',
  runoffBehind: 'Zaostává ve 2. kole',
  waiting: 'Čeká na sčítání',
  early: 'Sčítá se', // příliš málo sečtených okrsků: žádné tvrzení o pořadí
}

export const STATE = {
  waiting: 'Čeká na sčítání',
  counting: 'Sčítá se',
  counted: 'Sečteno, čeká na potvrzení',
  runoff: '2. kolo',
  'runoff-counting': '2. kolo, sčítá se',
  'runoff-counted': '2. kolo sečteno, čeká na potvrzení',
  elected: 'Mandát získán',
  tie: 'Shoda hlasů',
}

export const T = {
  pageTitle: 'Senát 2026 · Piráti',
  headlineName: 'Senát', // hlavička: „SENÁT 2026“ (velká písmena a žluté 2026 řeší CSS)
  headlineYear: '2026',
  subtitle: 'Volí se 27 ze 81 obvodů. 1. kolo 9.–10. října, případné 2. kolo 16.–17. října. Sledujeme 18 kandidatur, které Piráti podali nebo podporují.',

  // hlavička
  pillWaiting: 'ČEKÁ SE NA VÝSLEDKY',
  pillWaitingR2: 'ČEKÁ SE NA VÝSLEDKY 2. KOLA', // doplněno: 2. kolo ještě nemá sečtený okrsek
  pillLive: (round) => `ŽIVĚ · ${round}. KOLO`,
  pillDone: (round) => `SČÍTÁNÍ UKONČENO · ${round}. KOLO`, // doplněno (fáze idle/final nejsou v náhledu)
  csuFrom: (when) => `ČSÚ data z ${when}`,
  agoWaiting: 'předvolební stav, sčítání ještě nezačalo',
  agoWaitingR2: 'sčítání 2. kola ještě nezačalo', // doplněno
  ago: (age) => `před ${age}`,
  nextCheck: (mmss) => `další kontrola za ${mmss}`,
  // odpočet do zavření místností (jako na praha.dg12.cz) — doplněno; číslo se v hlavičce zvýrazní, proto dvě části
  closesBefore: (date) => `Volební místnosti se zavírají v sobotu ${date} ve 14:00 — za `,
  closesBeforeR2: (date) => `Druhé kolo: volební místnosti se zavírají v sobotu ${date} ve 14:00 — za `, // doplněno (odpočet mezi koly)
  logoAlt: 'Česká pirátská strana', // doplněno

  // bannery — doplněno (v náhledu nejsou)
  bannerStale: 'ČSÚ se teď nepodařilo načíst čerstvá data. Zobrazujeme poslední platný stav.',
  bannerOffline: 'Nepodařilo se spojit s naším serverem. Zobrazujeme poslední načtený stav a zkusíme to znovu.',
  loading: 'Načítám výsledky…',
  loadFailed: 'Výsledky se zatím nepodařilo načíst. Zkusíme to znovu.',

  // stav voleb
  eyebrowOverview: 'Stav voleb',
  tileLabelOverview: 'Senátní obvody', // doplněno: žlutý štítek černé dlaždice
  tileLabelPirates: 'Kandidatury Pirátů', // doplněno: žlutý štítek černé dlaždice
  tileDecided: 'obvodů rozhodnuto (mandát získán)',
  tileRunoff: 'obvodů jde do 2. kola nebo v něm rozhoduje',
  tileAwaiting: 'sečteno, čeká na potvrzení ČSÚ',
  tileCounting: 'se právě sčítá',
  tileWaiting: 'čeká na první okrsky',
  tileTies: 'obvodů se shodou hlasů ve 2. kole (opakované volby)', // doplněno: shoda hlasů má vlastní dlaždici
  ofTotal: (n) => ` z ${n}`,

  // pás obvodů
  eyebrowStrip: '27 obvodů podle čísla · klepnutím nebo kliknutím otevřete detail',
  legendElected: 'mandát získán (oficiálně)',
  legendRunoff: '2. kolo',
  legendCounted: 'sečteno, čeká na potvrzení ČSÚ',
  legendProgress: 'podíl sečtených okrsků',
  legendPirate: 'obvod s kandidaturou Pirátů',
  cellAria: (n, name, state, hasPirate) => `Obvod ${n} ${name}, ${state}${hasPirate ? ', kandidatura Pirátů' : ''}`,
  cellTitle: (n, name, state) => `${n} ${name} · ${state}`,
  // popisek pod pásem na mobilu (buňky tam ukazují jen číslo): „30 · Kladno · sčítá se 64 %“; pct jen u obvodu, který se sčítá
  cellCaption: (n, name, state, pct, hasPirate) => {
    const s = String(state)
    return [n, name, `${s.charAt(0).toLowerCase()}${s.slice(1)}${pct == null ? '' : ` ${pct} %`}`, hasPirate && 'kandidatura Pirátů']
      .filter(Boolean)
      .join(' · ')
  },

  // kandidatury Pirátů
  eyebrowPirates: (n) => `Kandidatury Pirátů a kandidatury s jejich podporou · ${n}`,
  pTileElected: 'kandidatur má mandát (oficiálně)',
  pTileAdvancing: 'postupuje do 2. kola (oficiálně)',
  pTileTop: 'předběžně vede nebo je na 2. místě', // náhled: „…vede nebo je druhý“ (rodový tvar) — doplněno
  pTileBehind: 'předběžně bez postupu nebo bez náskoku', // náhled: „mimo postupové pozice“ (platí jen pro 1. kolo) — doplněno
  pTileOut: 'bez postupu nebo bez mandátu',
  pTileEarly: 'sčítá se, zatím málo okrsků',
  pTileWaiting: 'čeká na sčítání',
  legendSolid: 'Plná barva',
  legendSolidNote: 'oficiální stav od ČSÚ',
  legendDashed: 'Čárkovaně',
  legendDashedNote: 'předběžně podle sečtených okrsků',
  legendRelNote: 'vždy s navrhující stranou a názvem na lístku',
  provisional: ' · předběžně', // jen záloha pro starší snapshot bez outlook/gap

  // rank a „kam to směřuje“ (náhled v4); text vychází z outlook/gap ze serveru, viz outlook.js
  noRank: 'bez pořadí',
  prelim: 'Předběžně: ', // Z < C
  counted: 'Sečteno: ', // Z = C, čeká na ČSÚ
  outMandate: 'mandát',
  outAdvance: 'postup do 2. kola',
  outOut: 'bez postupu',
  outLead: 'vede 2. kolo',
  outTrail: 'zaostává ve 2. kole',
  outTie: 'shoda hlasů ve 2. kole',
  whyElectedR2: 'Ve 2. kole nejvíce hlasů',
  whyElectedR1: 'Nad 50 % platných hlasů, 2. kolo se nekoná',
  whyAdvancing: 'Nikdo nezískal přes 50 %: postupují dvě kandidatury s nejvíce hlasy',
  whyNotAdvancingDecided: 'Mandát získala jiná kandidatura',
  whyNotAdvancing: 'Mimo dvě kandidatury s nejvíce hlasy',
  whyRunoffLost: 'Ve 2. kole měla kandidatura méně hlasů',
  whyRunoffTie: 'Shoda hlasů: nikdo mandát nezískal, konají se opakované volby',
  whyLead: (gap) => `Náskok ${gap}.`,
  whyTrail: (gap) => `Ztráta ${gap}.`,
  whyMandate: (pct) => `Má ${pct} sečtených hlasů, tedy nad 50 %: 2. kolo by odpadlo.`,
  whyOtherMajority: 'Jiná kandidatura má nad 50 % sečtených hlasů.',
  whyAdvLead: (pct, gap) => `Vede s ${pct}, pod 50 %: do 2. kola jdou dvě kandidatury s nejvíce hlasy. Náskok ${gap}.`,
  whyAdvTie: 'Shoda hlasů na 1. místě: do 2. kola jdou všechny kandidatury s nejvyšším počtem hlasů.',
  whyAdvSecond: (gap) => `Nikdo nemá přes 50 %. Ztráta na 1. místo: ${gap}.`,
  whyEarly: (z, c, pct) => `Sečteno ${z} z ${c} okrsků (${pct} %): pořadí zatím nevypovídá.`,
  whyOut: (tieFirst, gap) => `${tieFirst ? 'Ztráta na 1. místo (shoda): ' : 'Ztráta na 2. místo: '}${gap}.`,

  // karta
  backHome: '← volby.dg12.cz',
  backHomeTitle: 'Zpět na volby.dg12.cz',
  jumpLabel: 'Přejít na část stránky', // mobilní lišta odkazů pod hlavičkou
  jumpCandidacies: 'Kandidatury',
  jumpDistricts: 'Obvody',
  jumpDetail: 'Detail',
  cardAria: (n, name) => `Otevřít detail obvodu ${n} ${name}`,
  party: (p) => `Navrhující strana: ${p}`,
  cardMeta: (no, age) => `č. ${no} na lístku${age == null ? '' : ` · ${age} let`}`,
  ballot: (label) => `Na lístku: ${label}`,
  rank: (r) => `${r}. místo`,
  roundTwoPrefix: '2. kolo: ',
  roundOnePrefix: '1. kolo: ', // doplněno: kandidatura, která do 2. kola nepostoupila
  rankRound1: (r) => `1. kolo: ${r}. místo`,
  progress: (z, c, pct) => `sečteno ${z} z ${c} okrsků (${pct} %)`,
  progressNone: 'sečteno –', // 2. kolo má hlasy, ale server k němu neposlal počty okrsků

  // detail
  eyebrowDetail: 'Detail obvodu',
  districtNo: (n) => `Senátní obvod č. ${n}`,
  decidedIn: (r) => ` · ve ${r}. kole`,
  round1Progress: (z, c, pct) => `1. kolo: sečteno ${z} z ${c} okrsků (${pct})`,
  round2Progress: (z, c, pct) => `2. kolo: sečteno ${z} z ${c} okrsků (${pct})`,
  round2ProgressNone: '2. kolo: sečteno –',
  otherDistrict: 'Jiný obvod',
  ballotNoTitle: 'Číslo na hlasovacím lístku',
  membership: (m) => ` · členství: ${m}`,
  noJob: 'povolání neuvedeno',
  majority: 'nad 50 % sečtených hlasů, čeká na potvrzení ČSÚ',
  inRound2: ' ve 2. kole',
  inRound1: ' v 1. kole', // doplněno
  round2None: '2. kolo: –', // doplněno: kandidatura mimo 2. kolo nemá hlasy 2. kola
  round1Votes: (v, pct) => `1. kolo: ${v} · ${pct}`,
  note1: 'Pořadí a podíly se počítají ze sečtených okrsků. ČSÚ publikuje oficiální stav (mandát získán, postup do 2. kola) až po uzavření obvodu.',
  note2: 'Číslo v kroužku je pořadí na hlasovacím lístku. Tituly, věk, povolání a bydliště pocházejí z registru kandidatur ČSÚ.',

  // jak číst
  eyebrowGuide: 'Jak výsledky číst',
  guide1Head: 'Mandát získá kandidatura s více než polovinou platných hlasů v obvodu.',
  guide1Body: ' Pokud to nikdo nesplní, postupují do 2. kola dvě kandidatury s nejvíce hlasy (při shodě i více). Ve 2. kole mandát získá kandidatura s více hlasy; při shodě hlasů ho nezíská nikdo.',
  guide2Head: 'Oficiální stav přichází později než čísla.',
  guide2Body: ' ČSÚ označí „mandát získán“ nebo „postup do 2. kola“ až po uzavření obvodu a podpisu zápisu. Do té doby ukazujeme jen pořadí podle sečtených okrsků a píšeme to.',
  guide3Head: 'Žádné odhady.',
  guide3Body: ' Stránka zobrazuje jen sečtené hlasy a oficiální stavy ČSÚ. Neodhaduje, kdo vyhraje, ani kolik křesel strana získá.',

  // patička
  footSourceBefore: 'Zdroj dat: Český statistický úřad, ',
  footSourceLink: 'volby.gov.cz',
  footSourceAfter: '. Seznam kandidatur Pirátů: správa stránky.',
  footContactBefore: 'Záložní kopie · správce: Václav Vislous · tel. ',
  footContactPhone: '777 954 389',
  footContactAfter: ' (spravuje tuto kopii a její úpravy)',
}
