/* eslint-disable react-refresh/only-export-components -- data a pomocné funkce, žádná komponenta */
// Testovací data indexu: 79 skutečných měst (z prototypu návrhu,
// docs/analysis/mesta-index-prototype) ve tvaru, který dodává src/mesta/councils.js
// (COUNCILS, ALL_COUNCILS, SHARDS, REGIONS). Importují ji jen testy; produkční
// build ji nenačítá. (Kontrola nad skutečnými daty: indexReal.test.js.)

// [název, obyvatel, KODZASTUP, kraj (2 číslice), název kandidátky, druh a|k|d, č. kandidátky]
const RAW = [
  ["Brno", 404296, 582786, 62, "Piráti a Fakt Brno TU!", 'k', 15],
  ["Ostrava", 280853, 554821, 81, "Česká pirátská strana", 'a', 12],
  ["Plzeň", 187863, 554791, 32, "Česká pirátská strana", 'a', 11],
  ["Liberec", 108214, 563889, 51, "Liberec otevřený lidem a Piráti", 'k', 6],
  ["Olomouc", 105297, 500496, 71, "MILUJEME OLOMOUC - Piráti, TOP 09, Zelení", 'k', 9],
  ["České Budějovice", 97128, 544256, 31, "Piráti a Budějčáci s podporou Zelených", 'k', 6],
  ["Hradec Králové", 93534, 569810, 52, "PIRÁTI a STAROSTOVÉ", 'k', 4],
  ["Pardubice", 92713, 555134, 53, "Progresivní Pardubice (Piráti a TOP 09 s podporou Zelených a nezávislých osobností)", 'k', 3],
  ["Ústí nad Labem", 90035, 554804, 42, "JEDNO ÚSTÍ", 'k', 5],
  ["Zlín", 74917, 585068, 72, "ZLÍN SRDCEM a Piráti", 'k', 5],
  ["Kladno", 69728, 532053, 21, "KLADEŇÁCI", 'k', 8],
  ["Most", 63160, 567027, 42, "Piráti, Zelení a Starostové", 'k', 6],
  ["Opava", 54881, 505927, 81, "VIZE PRO OPAVU", 'k', 7],
  ["Jihlava", 53686, 586846, 61, "Piráti a Fórum Jihlava s podporou Zelených", 'k', 1],
  ["Frýdek-Místek", 53164, 598003, 81, "Česká pirátská strana", 'a', 4],
  ["Teplice", 50856, 567442, 42, "Volba pro Teplice", 'k', 9],
  ["Karlovy Vary", 48788, 554961, 41, "VARY+", 'k', 4],
  ["Karviná", 48684, 598917, 81, "Srdcem pro Karvinou - koalice STAN, ODS, PIRÁTI a TOP 09", 'k', 4],
  ["Mladá Boleslav", 47874, 535419, 21, "Šance pro Mladou Boleslav", 'k', 4],
  ["Chomutov", 46560, 562971, 42, "JsmePRO! Chomutov", 'k', 5],
  ["Jablonec nad Nisou", 46206, 563510, 51, "Piráti a nezávislí", 'd', 4],
  ["Děčín", 46003, 562335, 42, "HLAS DĚČÍNA (Piráti Děčín + Hlas regionů)", 'k', 2],
  ["Prostějov", 43236, 589250, 71, "Prostějov 2:0", 'd', 1],
  ["Přerov", 40492, 511382, 71, "Změna pro Přerov", 'k', 2],
  ["Česká Lípa", 36364, 561380, 51, "Piráti a Zelení", 'k', 8],
  ["Třebíč", 34476, 590266, 61, "Piráti - Břehy - Zelení", 'k', 7],
  ["Tábor", 34339, 552046, 31, "Živý Tábor", 'k', 7],
  ["Znojmo", 33989, 593711, 62, "ZNOJMO JSI TY!", 'd', 7],
  ["Kolín", 33392, 533165, 21, "Česká pirátská strana", 'a', 6],
  ["Příbram", 32917, 539911, 21, "Příbram zdola - sdružení Pirátů, Zelených a nezávislých kandidátů", 'k', 1],
  ["Cheb", 32892, 554481, 41, "Koalice pro Cheb", 'k', 6],
  ["Písek", 31002, 549240, 31, "Česká pirátská strana", 'a', 6],
  ["Kroměříž", 27781, 588296, 72, "První volba pro Kroměříž a místní části", 'd', 7],
  ["Orlová", 27383, 599069, 81, "Sousedi Orlová", 'k', 9],
  ["Uherské Hradiště", 24852, 592005, 72, "TOŽ HRADIŠTĚ s podporou Pirátů", 'd', 2],
  ["Břeclav", 24583, 584291, 62, "MLADÍ A NEKLIDNÍ BŘECLAV", 'k', 1],
  ["Chrudim", 23562, 571164, 53, "Lidi z Chrudimi - Piráti a nezávislí", 'd', 7],
  ["Havlíčkův Brod", 23368, 568414, 61, "Česká pirátská strana", 'a', 7],
  ["Klatovy", 22921, 555771, 32, "KLATOVY21", 'k', 4],
  ["Český Těšín", 22870, 598933, 81, "TĚŠÍN 2.0", 'd', 2],
  ["Nový Jičín", 22740, 599191, 81, "Zelení/Piráti/TOP 09/STAN", 'k', 5],
  ["Litvínov", 22258, 567256, 42, "Litvínov DO TOHO!", 'k', 2],
  ["Kutná Hora", 21787, 533955, 21, "LIPISTAN - LIDOVCI, PIRÁTI, STAROSTOVÉ, NEZÁVISLÍ", 'k', 2],
  ["Kopřivnice", 21245, 599565, 81, "Pro Zdraví a Piráti", 'k', 4],
  ["Brandýs nad Labem-Stará Boleslav", 20926, 538094, 21, "Piráti a Nezávislí", 'd', 5],
  ["Jindřichův Hradec", 20369, 545881, 31, "Společně s Piráty", 'd', 1],
  ["Blansko", 19900, 581283, 62, "Česká pirátská strana", 'a', 1],
  ["Náchod", 19649, 573868, 52, "SOUSEDÉ za lepší Náchod", 'k', 5],
  ["Žatec", 18984, 566985, 42, "Piráti a nezávislí pro Žatec", 'd', 5],
  ["Kadaň", 18088, 563102, 42, "Spojení pro změnu", 'd', 3],
  ["Louny", 18061, 565971, 42, "LOUNY SPOLEČNĚ: Piráti, Zelení, nezávislí", 'k', 5],
  ["Říčany", 17314, 538728, 21, "Piráti se Zelení a nestranní", 'k', 4],
  ["Otrokovice", 17239, 585599, 72, "Občané OE s podporou Pirátů", 'd', 1],
  ["Benešov", 17025, 529303, 21, "Piráti s podporou lidovců pro Benešov", 'k', 3],
  ["Uherský Brod", 16280, 592731, 72, "Mladí Broďani - zlepsimebrod.cz", 'd', 3],
  ["Pelhřimov", 16233, 547492, 61, "Česká pirátská strana", 'a', 7],
  ["Jičín", 16052, 572659, 52, "JIČÍN SRDCEM s podporou Pirátů", 'd', 9],
  ["Rožnov pod Radhoštěm", 15916, 544841, 72, "Zdravý Rožnov s podporou Pirátů", 'd', 4],
  ["Dvůr Králové nad Labem", 15316, 579203, 52, "Klíč ke Dvoru", 'k', 1],
  ["Česká Třebová", 14982, 580031, 53, "Stateční & Piráti", 'k', 2],
  ["Varnsdorf", 14645, 562882, 42, "NÁŠ VARNSDORF", 'k', 6],
  ["Turnov", 14607, 577626, 51, "Česká pirátská strana", 'a', 2],
  ["Bílina", 14401, 567451, 42, "MOJE BÍLINA s podporou Pirátů", 'k', 10],
  ["Rokycany", 14248, 559717, 32, "Naše Rokycany", 'd', 1],
  ["Mariánské Lázně", 13921, 554642, 41, "Za lepší Mariánské Lázně", 'd', 9],
  ["Hlučín", 13245, 507016, 81, "Hlučíňáci", 'd', 7],
  ["Roudnice nad Labem", 12561, 565555, 42, "Tým Roudnice", 'd', 6],
  ["Čelákovice", 12507, 538132, 21, "SPOLEČNĚ pro Čelákovice", 'k', 3],
  ["Jaroměř", 12487, 574121, 52, "Nová vlna pro Jaroměř", 'k', 6],
  ["Rychnov nad Kněžnou", 11693, 576069, 52, "PROSTOR 516 01 s podporou Pirátů a Starostů", 'k', 3],
  ["Holešov", 11544, 588458, 72, "AKCE Holešovských Občanů", 'k', 2],
  ["Humpolec", 11487, 547999, 61, "Česká pirátská strana", 'a', 6],
  ["Vlašim", 11329, 530883, 21, "Piráti pro Vlašim", 'd', 6],
  ["Uničov", 11060, 505587, 71, "Česká pirátská strana", 'd', 6],
  ["Prachatice", 11036, 550094, 31, "Živé Prachatice", 'k', 7],
  ["Domažlice", 10973, 553425, 32, "Česká pirátská strana", 'a', 5],
  ["Sušice", 10689, 557153, 32, "Česká pirátská strana", 'a', 4],
  ["Veselí nad Moravou", 10574, 586722, 62, "ZA NAŠE VESELÍ", 'd', 2],
  ["Nové Město na Moravě", 9716, 596230, 61, "Piráti a nezávislí", 'd', 5],
];

const KRAJE = {
  21: 'Středočeský kraj', 31: 'Jihočeský kraj', 32: 'Plzeňský kraj', 41: 'Karlovarský kraj', 42: 'Ústecký kraj',
  51: 'Liberecký kraj', 52: 'Královéhradecký kraj', 53: 'Pardubický kraj', 61: 'Kraj Vysočina', 62: 'Jihomoravský kraj',
  71: 'Olomoucký kraj', 72: 'Zlínský kraj', 81: 'Moravskoslezský kraj',
};
const KIND = { a: 'party', k: 'coalition', d: 'association' };
const coll = new Intl.Collator('cs');
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const councilSize = (p) => (p > 300000 ? 55 : p > 150000 ? 47 : p > 90000 ? 39 : p > 50000 ? 35 : p > 20000 ? 27 : 21);

function council([name, population, zastup, kraj2, listName, kind, num]) {
  return {
    slug: slugify(name), name, zastup: Number(zastup), okres: kraj2 * 100 + 1, kraj: kraj2 * 100, krajName: KRAJE[kraj2],
    shard: null, featured: null, population, seats: councilSize(population), precincts: Math.max(6, Math.round(population / 1100)),
    pirates: num, pirateCandidates: [],
    arrangement: { type: kind === 'a' ? 'a' : 'b', list: { id: num, name: listName, short: listName, short8: listName.slice(0, 8), vstrana: 720, kind: KIND[kind], partners: [], independents: kind === 'd' }, members: [], others: [], flags: [] },
    confidence: 'high', shown: true, map: false, precinctFiles: false,
  };
}

// skrytá (nízká jistota) obec: je v shardech, ale ne v COUNCILS
const hidden = (zastup, name, kraj2, population) => ({
  ...council([name, population, String(zastup), kraj2, 'Neověřená kandidátka', 'k', 1]), pirates: null, pirateCandidates: [], shown: false, confidence: 'low',
});

// Stejné odvození jako src/mesta/councils.js: kraj o n obcích → ceil(n/8) téměř stejných shardů
// (obce podle českého abecedního pořadí), top-1/top-2 = 12 největších zobrazených obcí.
export function deriveFixtureShards(all) {
  const shards = [];
  const regions = [];
  const shown = all.filter((c) => c.shown);
  const featured = [...shown].sort((a, b) => b.population - a.population).slice(0, 12);
  featured.forEach((c, i) => { c.featured = i < 6 ? 'top-1' : 'top-2'; });
  for (const kraj of [...new Set(all.map((c) => c.kraj))].sort((a, b) => a - b)) {
    const towns = all.filter((c) => c.kraj === kraj).sort((a, b) => coll.compare(a.name, b.name));
    const k = Math.ceil(towns.length / 8);
    const base = Math.floor(towns.length / k);
    const extra = towns.length % k;
    const ids = [];
    for (let i = 0, from = 0; i < k; i++) {
      const len = base + (i < extra ? 1 : 0);
      const id = `${kraj / 100}-${i + 1}`;
      const part = towns.slice(from, from + len);
      from += len;
      part.forEach((c) => { c.shard = id; });
      shards.push({ id, kind: 'region', kraj, name: towns[0].krajName, zastups: part.map((c) => c.zastup) });
      ids.push(id);
    }
    regions.push({ kraj, name: towns[0].krajName, shardIds: ids, zastups: towns.map((c) => c.zastup) });
  }
  for (const id of ['top-1', 'top-2']) shards.push({ id, kind: 'featured', kraj: null, name: 'Největší města', zastups: featured.filter((c) => c.featured === id).map((c) => c.zastup) });
  return { shards, regions };
}

export const FIXTURE_HIDDEN = [hidden(999001, 'Skrytá Lhota', 81, 12000)];
export const FIXTURE_ALL = [...RAW.map(council), ...FIXTURE_HIDDEN];
const derived = deriveFixtureShards(FIXTURE_ALL);
export const FIXTURE_COUNCILS = FIXTURE_ALL.filter((c) => c.shown);
export const FIXTURE_SHARDS = derived.shards;
export const FIXTURE_REGIONS = derived.regions;

// obce mimo přehled (tvar excluded.generated.json: { zastup, name, okres, reason, text }); ilustrační
const NO_LIST = 'Piráti tu letos nemají vlastní ani koaliční kandidátku';
const OTHER_LISTS = 'Piráti tu jsou jen na kandidátkách jiných stran — přehled je nezahrnuje';
const BELOW = 'Pod 10 000 obyvatel — přehled je zatím nezahrnuje';
export const FIXTURE_EXCLUDED = [
  ...['Havířov', 'Kralupy nad Vltavou', 'Neratovice', 'Roztoky', 'Litovel'].map((name, i) => ({ zastup: 900000 + i, name, okres: null, reason: 'no-pirate-list', text: NO_LIST })),
  ...['Mělník', 'Slaný', 'Ostrov', 'Sokolov', 'Jirkov', 'Krupka', 'Litoměřice', 'Trutnov'].map((name, i) => ({ zastup: 900010 + i, name, okres: null, reason: 'other-lists-only', text: OTHER_LISTS })),
  ...['Tišnov', 'Hořovice', 'Šlapanice', 'Rychvald', 'Černošice', 'Mikulov', 'Slavkov u Brna', 'Moravské Budějovice'].map((name, i) => ({ zastup: 900020 + i, name, okres: null, reason: 'below-10k', text: BELOW })),
];
