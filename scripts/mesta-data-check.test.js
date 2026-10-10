import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkData } from './mesta-data-check.mjs';

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
        expect(problems.length).toBe(3);
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
        const readJson = async (f) => (f.endsWith('lists.json') ? { slug: 'brno', zastup: 582786 } : {});
        expect(await checkData({ dir: 'x', towns: [towns[0]], readJson })).toEqual([]);
    });
});
