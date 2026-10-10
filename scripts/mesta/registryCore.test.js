import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';
import {
    normName, parseOwnerList, wholeCouncils, matchOwnerTowns, classifyTown, borderlineReasons,
    decideInclusion, assignShards, assignFeatured, disambiguateSlugs, confidenceOf, buildExcluded,
    excludedReason, validateOverrides, cleanName,
} from './registryCore.js';

const csv = (header, lines) => parse([header, ...lines].join('\n'), { columns: true, skip_empty_lines: true });

// Řádky ve tvaru registru KV 2026 (KV2026reg20261007), viz spec §2. Kódy, názvy, počty obyvatel a čísla kandidátek jsou převzaté
// ze skutečných řádků; syntetické jsou rozsahy okrsků Brna (upraveno na součet 95), druhý řádek Brna a vymyšlení kandidáti
// (Jan Novák, Eva Malá, Petr Dvořák, Karel Sedlák…).
const RZC_HEADER = 'KRAJ,OKRES,TYPZASTUP,DRUHZASTUP,KODZASTUP,NAZEVZAST,OBEC,NAZEVOBCE,ORP,CPOU,REGURAD,OBVODY,COBVODU,MANDATY,POCOBYV,'
    + 'MINOKRSEK1,MAXOKRSEK1,MINOKRSEK2,MAXOKRSEK2,MINOKRSEK3,MAXOKRSEK3,MINOKRSEK4,MAXOKRSEK4,MINOKRSEK5,MAXOKRSEK5,'
    + 'MINOKRSEK6,MAXOKRSEK6,MINOKRSEK7,MAXOKRSEK7,MINOKRSEK8,MAXOKRSEK8,MINOKRSEK9,MAXOKRSEK9,MINOKRSE10,MAXOKRSE10,'
    + 'TYPDUVODU,POCET_VS,STAV_OBCE';
const Z = '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0'; // MINOKRSEK2..MAXOKRSE10 = 0
const rzc = (lines) => csv(RZC_HEADER, lines);

const RZC = rzc([
    // Brno: dva řádky (50 + 45 = 95 okrsků) a jeden řádek TYPZASTUP 2 (městská část)
    `6200,6202,1,3,582786,Brno,583000,Brno-střed,6203,1,582786,0,1,55,404296,1,50,${Z},1,29,0`,
    `6200,6202,1,3,582786,Brno,583001,Brno-sever,6203,2,582786,0,1,55,404296,51,95,${Z},1,29,0`,
    `6200,6202,2,5,583000,Brno-střed,583000,Brno-střed,6203,1,582786,0,1,37,76000,1,30,${Z},1,8,0`,
    '2100,2109,1,2,538094,Brandýs nad Labem-Stará Boleslav,538094,Brandýs nad Labem-Stará Boleslav,2103,175,538094,0,1,21,20926,1,15,' + Z + ',1,8,0',
    '2100,2101,1,2,529303,Benešov,529303,Benešov,2101,101,529303,0,1,27,17025,1,23,' + Z + ',1,8,0',
    '6200,6201,1,1,581330,Benešov,581330,Benešov,6202,593,581372,0,1,15,676,1,1,' + Z + ',1,3,0',
    '3200,3203,1,3,554791,Plzeň,545970,Plzeň 1,3209,331,554791,0,1,47,187863,1001,1046,' + Z + ',1,13,0',
    '3200,3203,1,3,554791,Plzeň,545988,Plzeň 2-Slovany,3209,332,554791,0,1,47,187863,2001,2034,' + Z + ',1,13,0',
    '1100,1100,2,5,500054,Praha 1,500054,Praha 1,1000,1,500054,0,1,27,28850,1001,1021,' + Z + ',1,14,0',
    '1100,1100,1,4,554782,Praha hl.m.,500054,Praha 1,1000,1,554782,0,1,65,1407084,1001,1021,' + Z + ',1,24,0',
    '8100,8103,1,3,555088,Havířov,555088,Havířov,8108,780,555088,0,1,43,67998,1,62,' + Z + ',1,8,0',
]);

describe('normName / parseOwnerList', () => {
    it('normalizes dashes, spaces and case', () => {
        expect(normName('Brandýs nad Labem–Stará Boleslav')).toBe(normName('Brandýs nad Labem-Stará Boleslav'));
        expect(normName('  Plzeň ')).toBe('plzeň');
        expect(normName('Brandýs  nad Labem — Stará Boleslav')).toBe('brandýs nad labem-stará boleslav');
    });

    it('parses the owner list, skipping comments', () => {
        const text = '# comment\n# other: not a region\nCentral Bohemia: Benešov · Brandýs nad Labem–Stará Boleslav · Kladno\nZlín Region: Zlín\n';
        expect(parseOwnerList(text)).toEqual([
            { region: 'Central Bohemia', name: 'Benešov' },
            { region: 'Central Bohemia', name: 'Brandýs nad Labem–Stará Boleslav' },
            { region: 'Central Bohemia', name: 'Kladno' },
            { region: 'Zlín Region', name: 'Zlín' },
        ]);
    });
});

describe('wholeCouncils', () => {
    const councils = wholeCouncils(RZC);

    it('merges the rows of a city into one entry (Brno 95 precincts, 404 296 inhabitants)', () => {
        const brno = councils.get(582786);
        expect(brno).toEqual({
            zastup: 582786, name: 'Brno', kraj: 6200, okres: 6202, druh: 3, population: 404296, precincts: 95, seats: 55,
        });
    });

    it('sums the precinct ranges of a multi-row city (Plzeň 46 + 34 = 80)', () => {
        expect(councils.get(554791).precincts).toBe(80);
        expect(councils.get(554791).seats).toBe(47);
    });

    it('drops TYPZASTUP 2 and DRUHZASTUP 4', () => {
        expect(councils.has(583000)).toBe(false);
        expect(councils.has(554782)).toBe(false);
        expect(councils.has(500054)).toBe(false);
    });

    it('keeps both Benešovs, keyed by KODZASTUP', () => {
        expect(councils.get(529303).population).toBe(17025);
        expect(councils.get(581330).druh).toBe(1);
        expect(councils.size).toBe(6);
    });
});

describe('matchOwnerTowns', () => {
    const councils = wholeCouncils(RZC);
    const owner = parseOwnerList('Central Bohemia: Benešov · Brandýs nad Labem–Stará Boleslav\nSouth Moravia: Brno\nNowhere Region: Nowhere\n');

    it('matches after dash normalisation and reports unmatched names', () => {
        const res = matchOwnerTowns(owner, councils);
        const brandys = res.matched.find((m) => m.zastup === 538094);
        expect(brandys.flags).toContain('dash-normalized');
        expect(res.matched.find((m) => m.zastup === 582786).flags).toEqual([]);
        expect(res.unmatched).toEqual([{ region: 'Nowhere Region', name: 'Nowhere' }]);
        expect(res.ambiguous).toEqual([]);
    });

    it('disambiguates Benešov 529303 vs 581330 by druh', () => {
        const res = matchOwnerTowns(owner, councils);
        const benesov = res.matched.filter((m) => m.name === 'Benešov');
        expect(benesov).toHaveLength(1);
        expect(benesov[0].zastup).toBe(529303);
        expect(benesov[0].flags).toContain('disambiguated-by-druh');
    });

    it('reports ambiguous when druh does not decide', () => {
        const twin = new Map([
            [1, { zastup: 1, name: 'Mikulov', kraj: 6200, okres: 6201, druh: 2, population: 7552, precincts: 5, seats: 21 }],
            [2, { zastup: 2, name: 'Mikulov', kraj: 4200, okres: 4203, druh: 2, population: 400, precincts: 1, seats: 9 }],
        ]);
        const res = matchOwnerTowns([{ region: 'South Moravia', name: 'Mikulov' }], twin);
        expect(res.matched).toEqual([]);
        expect(res.ambiguous).toEqual([{ region: 'South Moravia', name: 'Mikulov', candidates: [1, 2] }]);
    });

    it('flags a kraj that differs from the owner list section', () => {
        const jicin = new Map([[572659, { zastup: 572659, name: 'Jičín', kraj: 5200, okres: 5202, druh: 2, population: 16052, precincts: 20, seats: 25 }]]);
        const res = matchOwnerTowns([{ region: 'Liberec Region', name: 'Jičín' }], jicin);
        expect(res.matched[0].flags).toContain('kraj-differs-from-owner-list');
    });
});

// kvros / cvs / cns: zkrácené skutečné řádky; kvrk: skutečná jména jen u Plzně, Hradce, Jablonce a Sokolova, ostatní syntetická
const ROS_H = 'OKRES,KODZASTUP,NAZEVZAST,COBVODU,POR_STR_HL,OSTRANA,VSTRANA,NAZEVCELK,ZKRATKAO30,ZKRATKAO8,POCSTR_SLO,SLOZENI,HLASY_STR,PROCHLSTR,MAND_STR';
const RK_H = 'OKRES,KODZASTUP,COBVODU,POR_STR_HL,OSTRANA,PORCISLO,JMENO,PRIJMENI,TITULPRED,TITULZA,VEK,POVOLANI,BYDLISTEN,PSTRANA,NSTRANA,PLATNOST,POCHLASU,PRESKOCENI,POCPROCVSE,MANDAT,PORADIMAND,PORADINAHR';
const CVS_H = 'VSTRANA,NAZEVCELK,NAZEV_STRV,ZKRATKAV30,ZKRATKAV8,POCSTR_SLO,SLOZENI,ZKRATKA_OF,TYPVS,NAZEVPLNY';
const CNS_H = 'NSTRANA,NAZEV_STRN,ZKRATKAN30,ZKRATKAN8';

const cvs = csv(CVS_H, [
    '541,"Sdružení Piráti, NK","Sdružení Piráti, NK","Sdružení Piráti, NK",Piráti+NK,2,"080,720",,D,',
    '720,Česká pirátská strana,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,Piráti,S,',
    '1350,Koalice STAN a Piráti,Koalice STAN a Piráti,"Koalice STAN, Piráti",STAN+Piráti,2,"166,720",,K,',
]);
const cns = csv(CNS_H, [
    '80,Nezávislý kandidát,Nezávislý kandidát,NK',
    '166,STAROSTOVÉ A NEZÁVISLÍ,STAROSTOVÉ A NEZÁVISLÍ,STAN',
    '720,Česká pirátská strana,Česká pirátská strana,Piráti',
]);

const LISTS = csv(ROS_H, [
    '3203,554791,Plzeň,1,4,532,532,ANO 2011 a nezávislí,ANO 2011 a nezávislí,ANO+NK,2,"080,768",,,',
    '3203,554791,Plzeň,1,11,720,720,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,,,',
    '5201,569810,Hradec Králové,1,3,53,53,Občanská demokratická strana,Občanská demokratická strana,ODS,1,053,,,',
    '5201,569810,Hradec Králové,1,4,1350,1350,PIRÁTI a STAROSTOVÉ,PIRÁTI a STAROSTOVÉ,STAN+Piráti,2,"166,720",,,',
    '5102,563510,Jablonec nad Nisou,1,4,541,541,Piráti a nezávislí,Piráti a nezávislí,Piráti+NK,2,"080,720",,,',
    '7102,505587,Uničov,1,6,541,541,Česká pirátská strana,Česká pirátská strana,Piráti+NK,2,"080,720",,,',
    '4103,560286,Sokolov,1,5,768,768,ANO 2011,ANO 2011,ANO,1,768,,,',
    '4103,560286,Sokolov,1,7,470,470,SOKOLOV NA PLNÝ ÚVAZEK - STAROSTOVÉ S PODPOROU MÍSTNÍCH OSOBNOSTÍ,SOKOLOV NA PLNÝ ÚVAZEK,STAN+NK,2,"080,166",,,',
    '8103,555088,Havířov,1,1,114,114,Hnutí pro Havířov,Hnutí pro Havířov,HPH,1,114,,,',
    '8103,555088,Havířov,1,2,1531,1531,"SPOLEČNĚ PRO HAVÍŘOV (koalice ODS, KDU-ČSL, STAN, TOP 09)","SPOLEČNĚ PRO HAVÍŘOV (ODS, KDU-ČSL, STAN, TOP 09)",KDU+ODS+STA+TOP,4,"001,053,166,721",,,',
]);

const CANDS = csv(RK_H, [
    '3203,554791,1,11,720,1,Pavel,Bosák,,,56,"grafik, náměstek primátora","Plzeň 6-Litice",720,720,A,0,N,0,N,0,0',
    '3203,554791,1,11,720,2,Marek,Habruň,Ing.,,37,stavební projektant,Plzeň 3,720,720,A,0,N,0,N,0,0',
    '3203,554791,1,4,532,3,Jan,Novák,,,40,x,Plzeň,768,768,A,0,N,0,N,0,0',
    '5201,569810,1,4,1350,1,Kamil,Kubica,,,28,produkční,Slezské Předměstí,720,720,A,0,N,0,N,0,0',
    '5201,569810,1,4,1350,2,Dominik,Žilka,Bc.,,31,vývojář,Pražské Předměstí,166,166,A,0,N,0,N,0,0',
    '5201,569810,1,4,1350,6,Aleš,Dohnal,,,37,radní,Slezské Předměstí,720,720,A,0,N,0,N,0,0',
    '5201,569810,1,4,1350,7,Vít,Luštinec,Bc.,,38,designér,Pražské Předměstí,720,720,N,0,N,0,N,0,0', // neplatný (PLATNOST N)
    '5102,563510,1,4,541,3,Jaroslav,Šída,Mgr.,,47,právník,Mšeno nad Nisou,720,720,A,0,N,0,N,0,0',
    '7102,505587,1,6,541,2,Eva,Malá,,,30,y,Uničov,720,720,A,0,N,0,N,0,0',
    '4103,560286,1,7,470,5,Lukáš,Zykán,,,44,"OSVČ, správce",Sokolov,720,166,A,0,N,0,N,0,0',
    '4103,560286,1,7,470,6,Petr,Dvořák,,,44,z,Sokolov,166,166,A,0,N,0,N,0,0',
    '4103,560286,1,7,470,12,Tereza,Zykánová,Bc.,,39,k,Sokolov,720,166,N,0,N,0,N,0,0', // neplatný
    '4103,560286,1,5,768,1,Karel,Sedlák,,,50,k,Sokolov,720,,A,0,N,0,N,0,0', // prázdné NSTRANA, jiná kandidátka bez 720 -> others, nominatedBy ''
    '1100,500224,1,3,1690,1,Registrační úřad ponechal pozici volnou,Kandidát v registraci škrtnut,,,,,,,,N,0,N,0,N,0,0',
    '8103,555088,1,1,114,1,Jiří,Starý,,,50,q,Havířov,53,53,A,0,N,0,N,0,0',
]);

const ctx = { lists: LISTS, candidates: CANDS, cvs, cns };

describe('classifyTown', () => {
    it('Plzeň = a (own list, VSTRANA 720)', () => {
        const r = classifyTown(554791, ctx);
        expect(r.type).toBe('a');
        expect(r.list).toEqual({
            id: 11, name: 'Česká pirátská strana', short: 'Česká pirátská strana', short8: 'Piráti', vstrana: 720,
            kind: 'party', partners: [], independents: false, nominatedNonMembers: 0,
        });
        expect(r.members).toEqual([{ list: 11, n: 1, name: 'Pavel Bosák' }, { list: 11, n: 2, name: 'Marek Habruň' }]);
        expect(r.others).toEqual([]);
        expect(r.flags).toEqual([]);
    });

    it('Hradec Králové = b coalition with partner STAN; only valid 720 members', () => {
        const r = classifyTown(569810, ctx);
        expect(r.type).toBe('b');
        expect(r.list).toMatchObject({ id: 4, vstrana: 1350, kind: 'coalition', short8: 'STAN+Piráti', independents: false });
        expect(r.list.partners).toEqual([{ code: 166, short: 'STAN' }]);
        expect(r.members).toEqual([{ list: 4, n: 1, name: 'Kamil Kubica' }, { list: 4, n: 6, name: 'Aleš Dohnal' }]);
    });

    it('VSTRANA 541 = association with independents; named-ČPS list is flagged', () => {
        const jab = classifyTown(563510, ctx);
        expect(jab.type).toBe('b');
        expect(jab.list).toMatchObject({ kind: 'association', independents: true, partners: [], vstrana: 541 });
        expect(jab.flags).not.toContain('named-cps-but-association');
        const unicov = classifyTown(505587, ctx);
        expect(unicov.list.name).toBe('Česká pirátská strana');
        expect(unicov.list).toMatchObject({ kind: 'association', independents: true });
        expect(unicov.flags).toContain('named-cps-but-association');
    });

    it('Sokolov = c: Pirate member on another list, nominated by STAN', () => {
        const r = classifyTown(560286, ctx);
        expect(r.type).toBe('c');
        expect(r.list).toBeNull();
        expect(r.members).toEqual([]);
        expect(r.others).toContainEqual({ list: 7, listName: 'SOKOLOV NA PLNÝ ÚVAZEK - STAROSTOVÉ S PODPOROU MÍSTNÍCH OSOBNOSTÍ', n: 5, name: 'Lukáš Zykán', nominatedBy: 'STAN' });
        expect(r.others.some((o) => o.name === 'Tereza Zykánová')).toBe(false); // PLATNOST N
        expect(r.others.some((o) => o.name === 'Petr Dvořák')).toBe(false); // není Pirát
    });

    it('blank NSTRANA/PSTRANA rows do not break classification', () => {
        const r = classifyTown(560286, ctx);
        expect(r.others.find((o) => o.name === 'Karel Sedlák').nominatedBy).toBe('');
        const lists = csv(ROS_H, ['1100,500224,X,1,3,720,720,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,,,']);
        const candidates = csv(RK_H, ['1100,500224,1,3,1690,1,Registrační úřad ponechal pozici volnou,Kandidát v registraci škrtnut,,,,,,,,N,0,N,0,N,0,0']);
        const blank = classifyTown(500224, { lists, candidates, cvs, cns });
        expect(blank).toMatchObject({ type: 'a', members: [], others: [] });
    });

    it('Havířov-like = d (no 720 anywhere)', () => {
        const r = classifyTown(555088, ctx);
        expect(r).toMatchObject({ type: 'd', list: null, members: [], others: [] });
    });

    it('two Pirate lists: lowest list number wins + multiple-pirate-lists', () => {
        const lists = csv(ROS_H, [
            '1,900,X,1,9,720,720,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,,,',
            '1,900,X,1,3,1350,1350,PIRÁTI a STAROSTOVÉ,PIRÁTI a STAROSTOVÉ,STAN+Piráti,2,"166,720",,,',
        ]);
        const r = classifyTown(900, { lists, candidates: [], cvs, cns });
        expect(r.type).toBe('b');
        expect(r.list.id).toBe(3);
        expect(r.flags).toContain('multiple-pirate-lists');
        expect(r.flags).toContain('no-members-on-pirate-list');
    });

    it('unknown SLOZENI partner code is flagged', () => {
        const lists = csv(ROS_H, ['1,901,Y,1,2,9999,1350,Koalice,Koalice,K,2,"5555,720",,,']);
        const r = classifyTown(901, { lists, candidates: [], cvs, cns });
        expect(r.list.partners).toEqual([{ code: 5555, short: '5555' }]);
        expect(r.flags).toContain('unknown-partner-code');
    });

    it('type a/b with Pirates also on another list gets also-on-other-lists', () => {
        const lists = csv(ROS_H, [
            '1,902,Z,1,1,720,720,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,,,',
            '1,902,Z,1,2,166,166,STAN,STAN,STAN,1,166,,,',
        ]);
        const candidates = csv(RK_H, [
            '1,902,1,1,720,1,A,B,,,30,x,Z,720,720,A,0,N,0,N,0,0',
            '1,902,1,2,166,4,C,D,,,30,x,Z,720,166,A,0,N,0,N,0,0',
        ]);
        const r = classifyTown(902, { lists, candidates, cvs, cns });
        expect(r.type).toBe('a');
        expect(r.flags).toContain('also-on-other-lists');
        expect(r.others).toHaveLength(1);
    });
});

describe('classifyTown: reported edge cases', () => {
    it('a Pirate candidate whose list row is missing is flagged, not silently dropped', () => {
        const lists = csv(ROS_H, ['1,903,W,1,1,720,720,Česká pirátská strana,Česká pirátská strana,Piráti,1,720,,,']);
        const candidates = csv(RK_H, [
            '1,903,1,1,720,1,A,B,,,30,x,W,720,720,A,0,N,0,N,0,0',
            '1,903,1,7,999,2,C,D,,,30,x,W,720,720,A,0,N,0,N,0,0', // list 7 není v kvros
        ]);
        const r = classifyTown(903, { lists, candidates, cvs, cns });
        expect(r.type).toBe('a');
        expect(r.members).toHaveLength(1);
        expect(r.flags).toEqual(['candidate-without-list']);
    });

    it('counts Pirate-nominated non-members on the Pirate list without making them members', () => {
        const lists = csv(ROS_H, ['1,904,V,1,4,1350,1350,PIRÁTI a STAROSTOVÉ,PIRÁTI a STAROSTOVÉ,STAN+Piráti,2,"166,720",,,']);
        const candidates = csv(RK_H, [
            '1,904,1,4,1350,1,A,B,,,30,x,V,720,720,A,0,N,0,N,0,0', // člen
            '1,904,1,4,1350,2,C,D,,,30,x,V,99,720,A,0,N,0,N,0,0', // navržen Piráty, bez členství
            '1,904,1,4,1350,3,E,F,,,30,x,V,99,720,A,0,N,0,N,0,0',
            '1,904,1,4,1350,4,G,H,,,30,x,V,99,720,N,0,N,0,N,0,0', // neplatný
            '1,904,1,4,1350,5,I,J,,,30,x,V,166,166,A,0,N,0,N,0,0', // STAN
        ]);
        const r = classifyTown(904, { lists, candidates, cvs, cns });
        expect(r.members.map((m) => m.n)).toEqual([1]);
        expect(r.list.nominatedNonMembers).toBe(2);
    });

    it('cleans displayed list names (Rychvald: „ Opozice 26 ”)', () => {
        const lists = csv(ROS_H, ['8103,599107,Rychvald,1,2,1820,1820,"„ Opozice 26 ”  s Piráty","„ Opozice 26 ”",Piráti+NK,2,"080,720",,,']);
        const r = classifyTown(599107, { lists, candidates: [], cvs, cns });
        expect(r.list.name).toBe('„Opozice 26“ s Piráty');
        expect(r.list.short).toBe('„Opozice 26“');
    });
});

describe('cleanName', () => {
    it('trims, collapses whitespace, tightens typographic quotes', () => {
        expect(cleanName('  PIRÁTI   a  STAROSTOVÉ ')).toBe('PIRÁTI a STAROSTOVÉ');
        expect(cleanName('„ Opozice 26 ”')).toBe('„Opozice 26“');
        expect(cleanName('„Opozice 26“')).toBe('„Opozice 26“');
        expect(cleanName('NÁŠ HRADEC: koalice (MY, RH)')).toBe('NÁŠ HRADEC: koalice (MY, RH)');
        expect(cleanName(undefined)).toBe('');
    });
});

describe('borderlineReasons', () => {
    const base = { zastup: 596230, name: 'Nové Město na Moravě', okres: 6205 };
    const bctx = {
        ownerList: new Set([596230]),
        okresNames: new Map([[6205, 'Žďár nad Sázavou'], [7101, 'Přerov']]),
        senateNames: new Set(['Přerov', 'Litovel']),
        pirates2022: new Map(),
    };

    it('owner list is a non-automatic reason', () => {
        expect(borderlineReasons(base, bctx)).toEqual([{ code: 'owner-list', text: expect.any(String), automatic: false }]);
    });

    it('okres seat and 2026 Senate seat are automatic', () => {
        const prerov = { zastup: 7, name: 'Přerov', okres: 7101, druh: 3 };
        const codes = borderlineReasons(prerov, bctx).map((r) => [r.code, r.automatic]);
        expect(codes).toEqual([['okres-seat', true], ['senate-seat-2026', true]]);
        const litovel = borderlineReasons({ zastup: 8, name: 'Litovel', okres: 7102, druh: 2 }, bctx);
        expect(litovel.map((r) => r.code)).toEqual(['senate-seat-2026']);
    });

    it('the Senate-seat reason needs a town (druh 2/3), not a village sharing the name', () => {
        const village = { zastup: 571580, name: 'Litovel', okres: 7102, druh: 1 };
        expect(borderlineReasons(village, bctx)).toEqual([]);
        expect(borderlineReasons({ ...village, druh: 6 }, bctx)).toEqual([]);
        expect(borderlineReasons({ ...village, druh: 3 }, bctx).map((r) => r.code)).toEqual(['senate-seat-2026']);
    });

    it('pirates-2022 needs >= 10 % or a seat; text uses a decimal comma', () => {
        const t = { zastup: 99, name: 'Rychvald', okres: 8103 };
        const r1 = borderlineReasons(t, { ...bctx, pirates2022: new Map([[99, { pct: 11.68, seats: 2 }]]) });
        expect(r1).toEqual([{ code: 'pirates-2022', text: 'Piráti 2022: 11,7 %, 2 mand.', automatic: true }]);
        expect(borderlineReasons(t, { ...bctx, pirates2022: new Map([[99, { pct: 6, seats: 1 }]]) })).toHaveLength(1);
        const text = (pct) => borderlineReasons(t, { ...bctx, pirates2022: new Map([[99, { pct, seats: 1 }]]) })[0].text;
        expect(text(8.35)).toBe('Piráti 2022: 8,4 %, 1 mand.'); // toFixed(1) by dalo 8,3
        expect(text(6.65)).toBe('Piráti 2022: 6,7 %, 1 mand.');
        expect(text(10)).toBe('Piráti 2022: 10,0 %, 1 mand.');
        expect(text(11.68)).toBe('Piráti 2022: 11,7 %, 1 mand.');
        expect(borderlineReasons(t, { ...bctx, pirates2022: new Map([[99, { pct: 9.9, seats: 0 }]]) })).toEqual([]);
    });

    it('manual borderlineReason from the override is non-automatic', () => {
        const t = { zastup: 99, name: 'Mikulov', okres: 6201 };
        const r = borderlineReasons(t, { ...bctx, override: { name: 'Mikulov', borderlineReason: 'Domov kandidáta' } });
        expect(r).toEqual([{ code: 'manual', text: 'Domov kandidáta', automatic: false }]);
    });
});

describe('decideInclusion', () => {
    const t = (population, extra = {}) => ({ zastup: 1, name: 'T', population, ...extra });
    const own = [{ code: 'owner-list', text: 'na seznamu', automatic: false }];
    const auto = [{ code: 'pirates-2022', text: 'Piráti 2022: 11,7 %, 2 mand.', automatic: true }];

    it('9 716 b with the owner-list reason is borderline-included with normal confidence', () => {
        const d = decideInclusion(t(9716), { type: 'b', reasons: own });
        expect(d.inclusion).toBe('borderline-included');
        expect(d.flags).toEqual([]);
        expect(confidenceOf(d.flags)).toBe('high');
    });

    it('7 823 b with only an automatic reason is borderline-included + borderline-auto (low)', () => {
        const d = decideInclusion(t(7823), { type: 'b', reasons: auto });
        expect(d.inclusion).toBe('borderline-included');
        expect(d.flags).toContain('borderline-auto');
        expect(d.reason).toContain('Piráti 2022');
        expect(confidenceOf(d.flags)).toBe('low');
    });

    it('a mix of automatic and non-automatic reasons is not borderline-auto', () => {
        expect(decideInclusion(t(8000), { type: 'a', reasons: [...auto, ...own] }).flags).toEqual([]);
    });

    it('9 270 b without a reason is borderline-excluded', () => {
        expect(decideInclusion(t(9270), { type: 'b', reasons: [] })).toMatchObject({ inclusion: 'borderline-excluded', flags: [] });
    });

    it('type c / d are excluded with the type as reason', () => {
        expect(decideInclusion(t(22007), { type: 'c', reasons: [] })).toMatchObject({ inclusion: 'excluded', reason: 'type c' });
        expect(decideInclusion(t(9448), { type: 'd', reasons: auto })).toMatchObject({ inclusion: 'excluded', reason: 'type d' });
    });

    it('below 7 000 is excluded with the population as reason', () => {
        expect(decideInclusion(t(5000), { type: 'a', reasons: own })).toMatchObject({ inclusion: 'excluded', reason: 'population 5000' });
    });

    it('override include:true forces any town; include:false excludes any town', () => {
        const forced = decideInclusion(t(2000), { type: 'c', reasons: [], override: { include: true, reason: 'majitel chce' } });
        expect(forced).toMatchObject({ inclusion: 'forced' });
        expect(forced.reason).toContain('majitel chce');
        const off = decideInclusion(t(50000), { type: 'a', reasons: [], override: { include: false, reason: 'chyba v registru' } });
        expect(off).toMatchObject({ inclusion: 'excluded', reason: 'override include:false: chyba v registru' });
    });

    it('10 050 a/b is auto regardless of other data (reasons, band-differs flag)', () => {
        expect(decideInclusion(t(10050), { type: 'b', reasons: [] }).inclusion).toBe('auto');
        expect(decideInclusion(t(10050), { type: 'a', reasons: auto }).flags).toEqual([]);
        expect(decideInclusion(t(10000), { type: 'a', reasons: [] }).inclusion).toBe('auto');
        expect(decideInclusion(t(9999), { type: 'a', reasons: [] }).inclusion).toBe('borderline-excluded');
        expect(decideInclusion(t(7000), { type: 'a', reasons: own }).inclusion).toBe('borderline-included');
    });
});

describe('confidenceOf', () => {
    it('low only for the generator low flags', () => {
        for (const f of ['multiple-pirate-lists', 'jmsez-mismatch', 'unknown-partner-code', 'population-band-differs', 'borderline-auto']) {
            expect(confidenceOf(['dash-normalized', f])).toBe('low');
        }
        expect(confidenceOf(['dash-normalized', 'slug-disambiguated', 'also-on-other-lists', 'named-cps-but-association'])).toBe('high');
        expect(confidenceOf([])).toBe('high');
    });
});

const town = (name, extra = {}) => ({ name, kraj: 2100, okres: 2101, population: 10000, ...extra });

describe('assignShards', () => {
    it('splits 10 towns of one kraj into 21-1 / 21-2 (5 + 5) in Czech order (Č after C, Ch after H)', () => {
        const names = ['Čelákovice', 'Cheb', 'Kolín', 'Benešov', 'Kladno', 'Říčany', 'Vlašim', 'Mělník', 'Příbram', 'Roztoky'];
        const out = assignShards(names.map((n, i) => town(n, { zastup: i + 1 })));
        const byShard = (s) => out.filter((t) => t.shard === s).map((t) => t.name);
        expect(byShard('21-1')).toHaveLength(5);
        expect(byShard('21-2')).toHaveLength(5);
        const order = out.map((t) => t.name);
        expect(order.indexOf('Benešov')).toBeLessThan(order.indexOf('Čelákovice'));
        expect(order.indexOf('Čelákovice')).toBeLessThan(order.indexOf('Kladno'));
        expect(byShard('21-1')).toEqual(['Benešov', 'Čelákovice', 'Cheb', 'Kladno', 'Kolín']);
    });

    it('a region with <= 8 towns is one shard; 9 towns are 5 + 4; other kraje get their own id', () => {
        const nine = Array.from({ length: 9 }, (_, i) => town(`M${i}`, { zastup: i, kraj: 8100 }));
        const out = assignShards([...nine, town('Plzeň', { zastup: 100, kraj: 3200 })]);
        expect(out.filter((t) => t.shard === '81-1')).toHaveLength(5);
        expect(out.filter((t) => t.shard === '81-2')).toHaveLength(4);
        expect(out.find((t) => t.name === 'Plzeň').shard).toBe('32-1');
    });

    it('does not mutate its input', () => {
        const input = [town('A', { zastup: 1 })];
        assignShards(input);
        expect(input[0].shard).toBeUndefined();
    });
});

describe('assignFeatured', () => {
    it('marks the 12 most populous towns top-1 (6 largest) and top-2', () => {
        const towns = Array.from({ length: 20 }, (_, i) => town(`T${String(i).padStart(2, '0')}`, { zastup: i, population: 1000 * (i + 1) }));
        const out = assignFeatured(towns, 12);
        const f = (v) => out.filter((t) => t.featured === v).map((t) => t.population);
        expect(f('top-1')).toHaveLength(6);
        expect(f('top-2')).toHaveLength(6);
        expect(Math.min(...f('top-1'))).toBeGreaterThan(Math.max(...f('top-2')));
        expect(Math.min(...f('top-2'))).toBe(9000);
        expect(out.filter((t) => t.featured === null)).toHaveLength(8);
    });

    it('hidden (low-confidence) towns never take a featured slot', () => {
        const towns = Array.from({ length: 14 }, (_, i) => town(`T${i}`, {
            zastup: i, population: 1000 * (i + 1), confidence: i >= 12 ? 'low' : 'high',
        }));
        const out = assignFeatured(towns, 12);
        expect(out.filter((t) => t.featured).map((t) => t.name).sort()).toEqual(towns.slice(0, 12).map((t) => t.name).sort());
        expect(out.filter((t) => t.confidence === 'low').every((t) => t.featured === null)).toBe(true);
        expect(out.filter((t) => t.featured === 'top-1').map((t) => t.name).sort()).toEqual(['T11', 'T10', 'T9', 'T8', 'T7', 'T6'].sort());
    });
});

describe('disambiguateSlugs', () => {
    const okresNames = new Map([[6201, 'Břeclav'], [6202, 'Brno-venkov']]);

    it('duplicate mikulov gets the okres suffix + slug-disambiguated flag', () => {
        const out = disambiguateSlugs([
            { name: 'Mikulov', okres: 6201, zastup: 584649, flags: [] },
            { name: 'Mikulov', okres: 6202, zastup: 584650, flags: ['x'] },
            { name: 'Brno', okres: 6202, zastup: 1, flags: [] },
        ], okresNames);
        expect(out.map((t) => t.slug)).toEqual(['mikulov-breclav', 'mikulov-brno-venkov', 'brno']);
        expect(out[0].flags).toEqual(['slug-disambiguated']);
        expect(out[1].flags).toEqual(['x', 'slug-disambiguated']);
        expect(out[2].flags).toEqual([]);
    });

    it('throws on reserved slugs and on duplicates the okres cannot resolve', () => {
        expect(() => disambiguateSlugs([{ name: 'API', okres: 6201, flags: [] }], okresNames)).toThrow(/reserved/i);
        expect(() => disambiguateSlugs([
            { name: 'Mikulov', okres: 6201, flags: [] }, { name: 'Mikulov', okres: 6201, flags: [] },
        ], okresNames)).toThrow(/duplicate/i);
    });
});

describe('excluded.generated.json helpers', () => {
    const c = (name, population, extra = {}) => ({ zastup: population, name, okres: 8103, kraj: 8100, krajName: 'Moravskoslezský kraj', population, ...extra });

    it('excludedReason: contract code + Czech sentence (spec §4.2)', () => {
        const r = (type, population, inclusion, reason) => excludedReason({ type, population, inclusion, reason });
        expect(r('d', 67998, 'excluded', 'type d')).toEqual({ reason: 'no-pirate-list', text: 'Piráti tu nekandidují (podle registru ČSÚ)' });
        expect(r('c', 21908, 'excluded', 'type c')).toEqual({ reason: 'other-lists-only', text: 'Piráti tu jsou jen na kandidátkách jiných stran' });
        expect(r('b', 9270, 'borderline-excluded', 'borderline, no reason')).toEqual({
            reason: 'borderline-no-reason',
            text: 'Piráti tu kandidují, ale město má méně než 10 000 obyvatel (9 270) a nezařadili jsme ho',
        });
        expect(r('a', 5000, 'excluded', 'population 5000')).toEqual({ reason: 'below-10k', text: 'Piráti tu kandidují, ale město má jen 5 000 obyvatel' });
        expect(r('a', 20000, 'excluded', 'override include:false: chyba v registru')).toEqual({ reason: 'override', text: 'Vyřazeno ručně: chyba v registru' });
    });

    it('buildExcluded: Havířov and Litovel-like rows, Czech sort, only >= 7 000 or owner-list', () => {
        const entries = [
            { council: c('Sokolov', 21908), type: 'c', inclusion: 'excluded', reason: 'type c', onOwnerList: true },
            { council: c('Havířov', 67998), type: 'd', inclusion: 'excluded', reason: 'type d', onOwnerList: true },
            { council: c('Litovel', 9448), type: 'd', inclusion: 'excluded', reason: 'type d', onOwnerList: true },
            { council: c('Čkyně', 3000), type: 'd', inclusion: 'excluded', reason: 'population 3000', onOwnerList: false },
            { council: c('Cheb', 32892), type: 'b', inclusion: 'auto', reason: 'x', onOwnerList: true },
            { council: c('Tišnov', 9270), type: 'b', inclusion: 'borderline-excluded', reason: 'borderline, no reason', onOwnerList: false },
            { council: c('Černošice', 7781), type: 'd', inclusion: 'excluded', reason: 'type d', onOwnerList: false },
            { council: c('Malá obec', 1200), type: 'a', inclusion: 'excluded', reason: 'population 1200', onOwnerList: true },
        ];
        const out = buildExcluded(entries);
        expect(out.map((e) => e.name)).toEqual(['Černošice', 'Havířov', 'Litovel', 'Malá obec', 'Sokolov', 'Tišnov']);
        expect(out.find((e) => e.name === 'Havířov')).toEqual({
            zastup: 67998, name: 'Havířov', okres: 8103, reason: 'no-pirate-list', text: 'Piráti tu nekandidují (podle registru ČSÚ)',
            kraj: 8100, krajName: 'Moravskoslezský kraj', population: 67998, inclusion: 'excluded',
        });
        expect(out.find((e) => e.name === 'Litovel')).toMatchObject({ reason: 'no-pirate-list', text: 'Piráti tu nekandidují (podle registru ČSÚ)' });
        expect(out.find((e) => e.name === 'Sokolov')).toMatchObject({ reason: 'other-lists-only', text: 'Piráti tu jsou jen na kandidátkách jiných stran' });
        expect(out.find((e) => e.name === 'Tišnov').inclusion).toBe('borderline-excluded');
    });
});

describe('validateOverrides (used by the generator and overrides.test.js)', () => {
    it('accepts the empty default', () => {
        expect(validateOverrides({ reviewedAt: null, towns: {} })).toEqual([]);
    });
    it('checks names against the registry when councils are given', () => {
        const councils = wholeCouncils(RZC);
        expect(validateOverrides({ reviewedAt: null, towns: { 582786: { name: 'Brno' } } }, { councils })).toEqual([]);
        expect(validateOverrides({ reviewedAt: null, towns: { 582786: { name: 'Brnno' } } }, { councils })[0]).toMatch(/name/);
        expect(validateOverrides({ reviewedAt: null, towns: { 1: { name: 'X' } } }, { councils })[0]).toMatch(/unknown/i);
    });
});
