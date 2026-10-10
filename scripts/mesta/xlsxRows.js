// Minimální čtečka xlsx (adm-zip + regulární výrazy): sharedStrings + list sheet1 -> pole řádků (pole textů).
// Stačí na tabulku ČSÚ "Počet obyvatel v obcích" (spec §2); vzorce, styly ani datumy se nevyhodnocují.
import AdmZip from 'adm-zip';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
});

// Text uvnitř <si>/<is>: všechny <t> (i z rich-text běhů <r>), bez fonetických <rPh>
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)].map((m) => unescapeXml(m[1] ?? '')).join('');

function sharedStrings(zip) {
    const entry = zip.getEntry('xl/sharedStrings.xml');
    if (!entry) return [];
    return [...entry.getData().toString('utf8').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
}

const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// buffer xlsx -> string[][] (řádek = pole buněk od sloupce A; prázdné buňky ''; chybějící řádky [])
export function xlsxRows(buffer) {
    const zip = new AdmZip(buffer);
    const sheet = zip.getEntry('xl/worksheets/sheet1.xml');
    if (!sheet) throw new Error('xlsx: chybí xl/worksheets/sheet1.xml (sheet1)');
    const strings = sharedStrings(zip);
    const rows = [];
    for (const rm of sheet.getData().toString('utf8').matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
        const cells = [];
        for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])?.[1];
            const type = /\bt="([^"]+)"/.exec(cm[1])?.[1];
            const body = cm[2] ?? '';
            const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
            let text = '';
            if (type === 's') text = strings[Number(v)] ?? '';
            else if (type === 'inlineStr') text = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
            else if (v !== undefined) text = unescapeXml(v);
            const at = ref ? colIndex(ref) : cells.length;
            while (cells.length < at) cells.push('');
            cells[at] = text;
        }
        while (rows.length < r) rows.push([]);
        rows[r] = cells;
    }
    return rows;
}

// Tabulka ČSÚ 1300722503: A kód okresu, B kód obce (= KODZASTUP), C název, D počet obyvatel; data od řádku 7.
// -> Map<kód obce, { name, population }>
export function csuPopulation(rows) {
    const out = new Map();
    // texty uložené jako řetězec: mezery/NBSP jako oddělovač tisíců, desetinná čárka
    const clean = (v) => String(v ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    for (const row of rows.slice(6)) {
        const codeText = clean(row[1]);
        const popText = clean(row[3]);
        if (!/^\d+$/.test(codeText) || !/^\d+(\.\d+)?$/.test(popText) || !(Number(codeText) > 0)) continue;
        out.set(Number(codeText), { name: row[2] ?? '', population: Number(popText) });
    }
    return out;
}

// zip (např. 13007225_data.zip) -> řádky sešitu `name` uvnitř (1300722503.xlsx)
export function xlsxFromZip(zipBuffer, name) {
    const entry = new AdmZip(zipBuffer).getEntry(name);
    if (!entry) throw new Error(`${name} v archivu chybí`);
    return xlsxRows(entry.getData());
}
