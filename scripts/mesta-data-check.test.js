import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkData } from './mesta-data-check.mjs';

// FeatureCollection s polygony s danými čísly okrsků (tvar nevadí, kontroluje se jen cislo)
const geo = (...ids) => ({
    type: 'FeatureCollection',
    features: ids.map((cislo) => ({ type: 'Feature', properties: { cislo }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })),
});
const towns = [{ slug: 'brno', zastup: 582786 }, { slug: 'plzen', zastup: 554791 }];
let dir;

async function put(slug, file, content) {
    await fs.mkdir(path.join(dir, 'data', slug), { recursive: true });
    await fs.writeFile(path.join(dir, 'data', slug, file), typeof content === 'string' ? content : JSON.stringify(content));
}
async function putTown(t, over = {}) {
    await put(t.slug, 'lists.json', { slug: t.slug, zastup: t.zastup, lists: [], ...over });
    await put(t.slug, 'kandidati.json', { parties: {} });
    await put(t.slug, 'results2022.json', { okrsky: {} });
    await put(t.slug, 'okrsky.geojson', t.map ? geo(...(t.polygons || [1, 2, 3])) : geo());
}

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mesta-check-'));
    for (const t of towns) await putTown(t);
});

describe('checkData', () => {
    it('vše v pořádku: žádné problémy', async () => {
        expect(await checkData({ dir, towns })).toEqual([]);
    });
    it('chybějící město', async () => {
        await fs.rm(path.join(dir, 'data', 'plzen'), { recursive: true });
        const problems = await checkData({ dir, towns });
        expect(problems.length).toBe(4);
        expect(problems.every((p) => p.includes('plzen'))).toBe(true);
    });
    it('chybí jediný soubor', async () => {
        await fs.rm(path.join(dir, 'data', 'brno', 'kandidati.json'));
        const problems = await checkData({ dir, towns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/brno.*kandidati\.json/);
    });
    it('nečitelný JSON', async () => {
        await put('brno', 'results2022.json', '{oops');
        const problems = await checkData({ dir, towns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/brno.*results2022\.json/);
    });
    it('nesedí slug nebo zastup', async () => {
        await putTown(towns[0], { slug: 'jiny' });
        await putTown(towns[1], { zastup: 1 });
        const problems = await checkData({ dir, towns });
        expect(problems).toHaveLength(2);
        expect(problems[0]).toMatch(/slug/);
        expect(problems[1]).toMatch(/zastup/);
    });
    it('zastup se porovnává jako řetězec', async () => {
        await putTown(towns[0], { zastup: '582786' });
        expect(await checkData({ dir, towns })).toEqual([]);
    });
    it('vlastní readJson (bez disku)', async () => {
        const readJson = async (f) => (f.endsWith('lists.json') ? { slug: 'brno', zastup: 582786 } : f.endsWith('okrsky.geojson') ? geo() : {});
        expect(await checkData({ dir: 'x', towns: [towns[0]], readJson })).toEqual([]);
    });
});

describe('checkData: okrsky.geojson (mapa okrsků)', () => {
    const mapTowns = [{ ...towns[0], map: true }, { ...towns[1], map: false }];
    beforeEach(async () => {
        await putTown(mapTowns[0]);
        await putTown(mapTowns[1]);
    });

    it('město s mapou: neprázdná FeatureCollection s jedinečnými čísly okrsků; město bez mapy: prázdná', async () => {
        expect(await checkData({ dir, towns: mapTowns })).toEqual([]);
    });
    it('město s mapou a prázdnou kolekcí je chyba', async () => {
        await put('brno', 'okrsky.geojson', geo());
        const problems = await checkData({ dir, towns: mapTowns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/brno.*okrsky\.geojson.*(prázdn|alespoň)/);
    });
    it('město bez mapy s polygony je chyba (zůstat prázdné)', async () => {
        await put('plzen', 'okrsky.geojson', geo(1));
        const problems = await checkData({ dir, towns: mapTowns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/plzen.*okrsky\.geojson.*prázdn/);
    });
    it('město bez příznaku map se bere jako město bez mapy', async () => {
        await put('plzen', 'okrsky.geojson', geo(1));
        const problems = await checkData({ dir, towns: [towns[1]] });
        expect(problems).toHaveLength(1);
    });
    it('duplicitní cislo je chyba', async () => {
        await put('brno', 'okrsky.geojson', geo(1, 2, 2));
        const problems = await checkData({ dir, towns: mapTowns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/brno.*2.*(dvakrát|duplic)/);
    });
    it('cislo musí být celé číslo (ne řetězec, ne NaN, ne chybějící)', async () => {
        for (const bad of ['5', null, 1.5, undefined, Number.NaN]) {
            await put('brno', 'okrsky.geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { cislo: bad }, geometry: null }, ...geo(7).features] }));
            const problems = await checkData({ dir, towns: mapTowns });
            expect(problems, String(bad)).toHaveLength(1);
            expect(problems[0]).toMatch(/brno.*cislo/);
        }
    });
    it('není FeatureCollection', async () => {
        await put('brno', 'okrsky.geojson', { type: 'Feature' });
        const problems = await checkData({ dir, towns: mapTowns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/brno.*FeatureCollection/);
    });
    it('chybějící okrsky.geojson je chyba i u města bez mapy', async () => {
        await fs.rm(path.join(dir, 'data', 'plzen', 'okrsky.geojson'));
        const problems = await checkData({ dir, towns: mapTowns });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/plzen.*okrsky\.geojson/);
    });
});
