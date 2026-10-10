// Pomocné funkce build skriptů: stahování s cache, rozbalení zipů, CSV
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(ROOT, '.cache');
const UA = 'pirati-vysledky-2026 (jednorazovy build dat)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stažení s diskovou cache v .cache/ (velké zipy ČSÚ se tahají jen jednou;
// `npm run data -- --fresh` cache ignoruje)
export const cacheFile = (url) => path.join(CACHE_DIR, createHash('sha1').update(url).digest('hex').slice(0, 16) + path.extname(new URL(url).pathname));

export async function download(url, { fresh = false, delayMs = 0 } = {}) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = cacheFile(url);
    if (!fresh) {
        try {
            return await fs.readFile(file);
        } catch {
            /* není v cache */
        }
    }
    if (delayMs) await sleep(delayMs);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(file, buf);
    return buf;
}

export async function downloadJson(url, opts) {
    return JSON.parse((await download(url, opts)).toString('utf8'));
}

// CSV z open dat ČSÚ: preferuje variantu csv_od/ (UTF-8, čárky).
// raw: true vrací { header, rows } s poli místo objektů (šetří paměť u kvhl.csv)
export function csvFromZip(buf, name, { raw = false } = {}) {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries();
    const entry = entries.find((e) => e.entryName.endsWith(`csv_od/${name}`))
        || entries.find((e) => e.entryName.endsWith(`/${name}`) || e.entryName === name);
    if (!entry) throw new Error(`${name} v archivu chybí`);
    const text = entry.getData().toString('utf8');
    const delimiter = text.split('\n', 1)[0].includes(';') ? ';' : ',';
    if (raw) {
        const rows = parse(text, { skip_empty_lines: true, bom: true, delimiter });
        return { header: rows[0], rows: rows.slice(1) };
    }
    return parse(text, { columns: true, skip_empty_lines: true, bom: true, delimiter });
}

export async function writeJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
}

export const codes = (slozeni) => String(slozeni || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

export function slugify(s) {
    return String(s)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
