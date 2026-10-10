import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { ROOT } from './lib/util.js';
import { parseArgs, outputDirs, runMesta, loadMestaCouncils, emptyGeo, stageLogosDir, commitLogosDir, discardLogosDir, townMapFeatures, buildMapsOnly } from './build-data.js';

describe('parseArgs', () => {
    it('Praha: bez --product, slugy a --fresh', () => {
        expect(parseArgs(['praha-6', '--fresh'])).toEqual({ mesta: false, fresh: true, mapsOnly: false, only: ['praha-6'] });
        expect(parseArgs([])).toEqual({ mesta: false, fresh: false, mapsOnly: false, only: [] });
    });
    it('--product=mesta [slug…]', () => {
        expect(parseArgs(['--product=mesta', 'brno', 'plzen'])).toEqual({ mesta: true, fresh: false, mapsOnly: false, only: ['brno', 'plzen'] });
    });
    it('--maps-only (jen mesta): přegeneruje jen okrsky.geojson měst s mapou', () => {
        expect(parseArgs(['--product=mesta', '--maps-only', 'brno'])).toEqual({ mesta: true, fresh: false, mapsOnly: true, only: ['brno'] });
        expect(() => parseArgs(['--maps-only'])).toThrow(/maps-only/);
    });
    it('neznámý produkt je chyba', () => {
        expect(() => parseArgs(['--product=senat'])).toThrow(/product/);
    });
});

describe('outputDirs', () => {
    const c = { slug: 'praha-6' };
    it('Praha zůstává beze změny: public/data/<slug>, public/media/<slug>', () => {
        expect(outputDirs(c, false)).toEqual({
            dataDir: path.join(ROOT, 'public/data', 'praha-6'),
            mediaDir: path.join(ROOT, 'public/media', 'praha-6'),
        });
    });
    it('mesta: public-mesta/data/<slug>, public-mesta/media/<slug>', () => {
        expect(outputDirs({ slug: 'brno' }, true)).toEqual({
            dataDir: path.join(ROOT, 'public-mesta/data', 'brno'),
            mediaDir: path.join(ROOT, 'public-mesta/media', 'brno'),
        });
    });
});

describe('outputDirs slug guard (mesta)', () => {
    it.each(['', '../x', 'a/b', 'Brno', 'a b', undefined])('odmítne slug %j', (slug) => {
        expect(() => outputDirs({ slug }, true)).toThrow(/slug/);
    });
    it('povolí a-z, 0-9 a pomlčku', () => {
        expect(() => outputDirs({ slug: 'usti-nad-labem' }, true)).not.toThrow();
    });
});

describe('logos staging (neúspěšné město nechá stará data)', () => {
    const mk = async () => {
        const media = await fs.mkdtemp(path.join(os.tmpdir(), 'mesta-logos-'));
        await fs.mkdir(path.join(media, 'logos'));
        await fs.writeFile(path.join(media, 'logos', '1-0.webp'), 'old');
        return media;
    };
    it('stage + discard: staré logos zůstanou, tmp zmizí', async () => {
        const media = await mk();
        const tmp = await stageLogosDir(media);
        await fs.writeFile(path.join(tmp, '1-0.webp'), 'new');
        expect(await fs.readFile(path.join(media, 'logos', '1-0.webp'), 'utf8')).toBe('old');
        await discardLogosDir(media);
        expect(await fs.readdir(media)).toEqual(['logos']);
        expect(await fs.readFile(path.join(media, 'logos', '1-0.webp'), 'utf8')).toBe('old');
    });
    it('stage + commit: logos nahrazena novými (staré soubory pryč)', async () => {
        const media = await mk();
        const tmp = await stageLogosDir(media);
        await fs.writeFile(path.join(tmp, '2-0.webp'), 'new');
        await commitLogosDir(media);
        expect(await fs.readdir(path.join(media, 'logos'))).toEqual(['2-0.webp']);
        expect(await fs.readdir(media)).toEqual(['logos']);
    });
    it('stage vytvoří i chybějící adresář média', async () => {
        const media = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mesta-logos-')), 'x', 'y');
        await stageLogosDir(media);
        await commitLogosDir(media);
        expect(await fs.readdir(path.join(media, 'logos'))).toEqual([]);
    });
});

describe('emptyGeo', () => {
    it('prázdná FeatureCollection', () => {
        expect(emptyGeo()).toEqual({ type: 'FeatureCollection', features: [] });
    });
});

describe('townMapFeatures (hranice okrsků města ze celostátní vrstvy ČSÚ)', () => {
    // čtverec 400 × 400 m v S-JTSK (EPSG:5514) kolem Brna, posunutý o (dx, 0)
    const sq = (dx) => {
        const x = -598000 + dx;
        const y = -1160000;
        return { type: 'Polygon', coordinates: [[[x, y], [x + 400, y], [x + 400, y + 400], [x, y + 400], [x, y]]] };
    };
    const f = (kod_obec, cislo, dx, kod_mco = 10, naz_mco = `MČ ${kod_mco}`) => ({ type: 'Feature', properties: { kod_obec, cislo, naz_mco, kod_mco }, geometry: sq(dx) });
    const layer = {
        type: 'FeatureCollection',
        features: [
            f(582786, 1, 0, 10), f(582786, 2, 500, 10), // MČ 10: v pořádku
            f(582786, 3, 1000, 20), f(582786, 999, 1500, 20), // MČ 20: 999 je zaniklý okrsek
            f(582786, 4, 2000, 30), // MČ 30: okrsek 2026 č. 5 nemá polygon
            f(554791, 1, 2500, 10), f('582786', 6, 3000, 40),
        ],
    };
    const brno = { slug: 'brno', zastup: 582786 };
    const ids = new Set([1, 2, 3, 4, 5, 6]);
    const districtOf = new Map([[1, '10'], [2, '10'], [3, '20'], [4, '30'], [5, '30'], [6, '40']]);
    const cisla = (r) => r.features.map((x) => x.properties.cislo).sort((a, b) => a - b);

    it('filtruje podle kod_obec, převede na WGS84, ponechá cislo (číslo) a mco', () => {
        const r = townMapFeatures(layer, brno, new Set([1, 2, 3, 4, 6, 999]));
        expect(cisla(r)).toEqual([1, 2, 3, 4, 6, 999]);
        const [lon, lat] = r.features[0].geometry.coordinates[0][0];
        expect(lon).toBeGreaterThan(16.4);
        expect(lon).toBeLessThan(16.8);
        expect(lat).toBeGreaterThan(49.0);
        expect(lat).toBeLessThan(49.4);
        expect(r.features[0].properties).toEqual({ cislo: 1, mco: 'MČ 10' });
        expect(r.droppedDistricts).toEqual([]);
    });

    it('městská část se zaniklým polygonem nebo okrskem 2026 bez polygonu se zahodí CELÁ (všechny její polygony)', () => {
        const r = townMapFeatures(layer, brno, ids, districtOf);
        expect(cisla(r)).toEqual([1, 2, 6]); // zůstává MČ 10 a 40; MČ 20 (zaniklý 999) a 30 (chybí polygon č. 5) pryč
        expect(r.dropped).toEqual([999]);
        expect(r.missing).toEqual([5]);
        expect(r.droppedDistricts).toEqual([
            { kod: '20', name: 'MČ 20', reason: 'extinct', polygons: 2, precincts: 1 },
            { kod: '30', name: 'MČ 30', reason: 'missing', polygons: 1, precincts: 2 },
        ]);
        expect(r.verified).toBe(true);
    });

    it('okrsek 2026 bez polygonu se bez mapování na městské části jen ohlásí (nedá se přiřadit)', () => {
        const r = townMapFeatures(layer, brno, new Set([1, 2, 3, 4, 5, 6]));
        expect(r.missing).toEqual([5]);
        expect(cisla(r)).toEqual([1, 2, 4, 6]); // MČ 20 pryč kvůli zaniklému 999
    });

    it('bez spolehlivého seznamu okrsků 2026 ponechá všechny polygony a označí je za neověřené', () => {
        for (const set of [new Set(), null, undefined]) {
            const r = townMapFeatures(layer, brno, set);
            expect(r.features).toHaveLength(6);
            expect(r.verified).toBe(false);
            expect(r.droppedDistricts).toEqual([]);
        }
    });

    it('město bez jediného polygonu, nebo kde by zbylo prázdno, je chyba (mapa nesmí zůstat prázdná)', () => {
        expect(() => townMapFeatures(layer, { slug: 'x', zastup: 1 }, new Set([1]))).toThrow(/x: .*polygon/);
        expect(() => townMapFeatures(layer, brno, new Set([123456]))).toThrow(/polygon/);
        // jediná městská část s problémem → nezbyde nic
        const single = { type: 'FeatureCollection', features: [f(582786, 1, 0, 10), f(582786, 999, 500, 10)] };
        expect(() => townMapFeatures(single, brno, new Set([1]))).toThrow(/nezbyde|polygon/);
    });

    it('jedno cislo víckrát je chyba (jednoznačné cislo je podmínka mapy)', () => {
        const dup = { type: 'FeatureCollection', features: [f(582786, 1, 0), f(582786, 1, 500)] };
        expect(() => townMapFeatures(dup, brno, new Set([1]))).toThrow(/dvakrát/);
    });
});

describe('buildMapsOnly (--maps-only)', () => {
    const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kod_obec: 5, cislo: 1, naz_mco: 'A', kod_mco: 1 }, geometry: { type: 'Polygon', coordinates: [[[-598000, -1160000], [-597600, -1160000], [-597600, -1159600], [-598000, -1160000]]] } }] };
    const rzc = [{ TYPZASTUP: '1', KODZASTUP: '5', OBEC: '1', MINOKRSEK1: '1', MAXOKRSEK1: '1', MINOKRSEK2: '0', MAXOKRSEK2: '0', MINOKRSEK3: '0', MAXOKRSEK3: '0', MINOKRSEK4: '0', MAXOKRSEK4: '0', MINOKRSEK5: '0', MAXOKRSEK5: '0', MINOKRSEK6: '0', MAXOKRSEK6: '0', MINOKRSEK7: '0', MAXOKRSEK7: '0', MINOKRSEK8: '0', MAXOKRSEK8: '0', MINOKRSEK9: '0', MAXOKRSEK9: '0', MINOKRSE10: '0', MAXOKRSE10: '0' }];
    const run = async (councils, existing) => {
        const written = {};
        const res = await buildMapsOnly(councils, {
            geo: () => geo, rzc, log: () => {}, error: () => {},
            read: async (c) => existing[c.slug] ?? emptyGeo(),
            write: async (c, data) => { written[c.slug] = data; },
        });
        return { res, written };
    };

    it('město s mapou dostane polygony, město s map:false s neprázdným souborem dostane prázdnou kolekci (kill switch)', async () => {
        const on = { slug: 'a', zastup: 5, map: true, precincts: 1 };
        const off = { slug: 'b', zastup: 6, map: false, precincts: 1 };
        const stale = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cislo: 1 }, geometry: null }] };
        const { res, written } = await run([on, off], { b: stale });
        expect(res.failed).toEqual([]);
        expect(written.a.features).toHaveLength(1);
        expect(written.b).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('město s map:false a už prázdným souborem se nepřepisuje; samé vypnuté město nepotřebuje vrstvu hranic', async () => {
        const off = { slug: 'b', zastup: 6, map: false, precincts: 1 };
        const { res, written } = await run([off], {});
        expect(written).toEqual({});
        expect(res.exitCode).toBe(0);
    });

    it('poznámka o vynechaných městských částech jde do geojsonu (droppedDistricts) jen když něco vynecháno', async () => {
        const on = { slug: 'a', zastup: 5, map: true, precincts: 1 };
        const { written } = await run([on], {});
        expect(written.a.droppedDistricts).toBeUndefined();
    });
});

describe('runMesta', () => {
    const councils = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
    const quiet = { log: vi.fn(), error: vi.fn() };

    it('jedno město spadne: exit 0 a souhrn se seznamem selhání', async () => {
        const log = vi.fn();
        const res = await runMesta(councils, async (c) => { if (c.slug === 'b') throw new Error('boom'); }, { log, error: vi.fn() });
        expect(res.ok).toBe(2);
        expect(res.total).toBe(3);
        expect(res.failed).toEqual([{ slug: 'b', reason: 'boom' }]);
        expect(res.exitCode).toBe(0);
        expect(log).toHaveBeenLastCalledWith('mesta data: OK 2/3, failed: [b]');
    });
    it('všechna OK: prázdný seznam', async () => {
        const log = vi.fn();
        const res = await runMesta(councils, async () => {}, { log, error: vi.fn() });
        expect(res.exitCode).toBe(0);
        expect(log).toHaveBeenLastCalledWith('mesta data: OK 3/3, failed: []');
    });
    it('nic nevyšlo: exit 1', async () => {
        const res = await runMesta(councils, async () => { throw new Error('x'); }, quiet);
        expect(res.ok).toBe(0);
        expect(res.exitCode).toBe(1);
    });
    it('města se zpracují po jednom a v pořadí', async () => {
        const seen = [];
        await runMesta(councils, async (c) => { seen.push(`start ${c.slug}`); await Promise.resolve(); seen.push(`end ${c.slug}`); }, quiet);
        expect(seen).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    });
});

describe('loadMestaCouncils', () => {
    it('sestaví všechna publikovaná města (i skrytá) z vygenerovaných JSON přes fs', async () => {
        const all = await loadMestaCouncils();
        expect(all.length).toBeGreaterThan(70);
        const plzen = all.find((c) => c.slug === 'plzen');
        expect(plzen).toMatchObject({ zastup: 554791, map: true, precinctFiles: true, candidatePhotos: false, pirates: 11 });
    });
    it('filtr slugů; neznámý slug je chyba', async () => {
        expect((await loadMestaCouncils(['brno'])).map((c) => c.slug)).toEqual(['brno']);
        await expect(loadMestaCouncils(['neexistuje'])).rejects.toThrow(/neexistuje/);
    });
});
