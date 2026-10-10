import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { ROOT } from './lib/util.js';
import { parseArgs, outputDirs, runMesta, loadMestaCouncils, emptyGeo, stageLogosDir, commitLogosDir, discardLogosDir } from './build-data.js';

describe('parseArgs', () => {
    it('Praha: bez --product, slugy a --fresh', () => {
        expect(parseArgs(['praha-6', '--fresh'])).toEqual({ mesta: false, fresh: true, only: ['praha-6'] });
        expect(parseArgs([])).toEqual({ mesta: false, fresh: false, only: [] });
    });
    it('--product=mesta [slug…]', () => {
        expect(parseArgs(['--product=mesta', 'brno', 'plzen'])).toEqual({ mesta: true, fresh: false, only: ['brno', 'plzen'] });
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
        expect(plzen).toMatchObject({ zastup: 554791, map: false, candidatePhotos: false, pirates: 11 });
    });
    it('filtr slugů; neznámý slug je chyba', async () => {
        expect((await loadMestaCouncils(['brno'])).map((c) => c.slug)).toEqual(['brno']);
        await expect(loadMestaCouncils(['neexistuje'])).rejects.toThrow(/neexistuje/);
    });
});
