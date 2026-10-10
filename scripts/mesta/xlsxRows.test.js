import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { xlsxRows, csuPopulation, xlsxFromZip } from './xlsxRows.js';

const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
const sstXml = (items) => `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="9" uniqueCount="${items.length}">${items.join('')}</sst>`;
const book = (files) => {
    const zip = new AdmZip();
    for (const [name, text] of Object.entries(files)) zip.addFile(name, Buffer.from(text, 'utf8'));
    return zip.toBuffer();
};

describe('xlsxRows', () => {
    const sst = sstXml(['<si><t>Kód okresu</t></si>', '<si><t>Brandýs &amp; Boleslav</t></si>', '<si><r><t>Rich </t></r><r><t>text</t></r></si>', '<si><t xml:space="preserve"> mezery </t></si>']);
    const rows = [
        '<row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="2"/><c r="C1" t="s"><v>2</v></c></row>',
        '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>554782</v></c><c r="D3"><v>41.5</v></c></row>', // řádek 2 chybí, buňka C chybí
        '<row r="4"><c r="A4" t="inlineStr"><is><t>inline</t></is></c><c r="B4" t="str"><v>vzorec</v></c><c r="C4" t="s"><v>3</v></c></row>',
    ].join('');

    it('reads shared strings, numbers, inline strings and keeps cell positions', () => {
        const out = xlsxRows(book({ 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheetXml(rows) }));
        expect(out[0]).toEqual(['Kód okresu', '', 'Rich text']);
        expect(out[1]).toEqual([]); // prázdný (chybějící) řádek
        expect(out[2]).toEqual(['Brandýs & Boleslav', '554782', '', '41.5']);
        expect(out[3]).toEqual(['inline', 'vzorec', ' mezery ']);
    });

    it('works without a sharedStrings part and rejects a workbook without sheet1', () => {
        const only = book({ 'xl/worksheets/sheet1.xml': sheetXml('<row r="1"><c r="A1"><v>7</v></c></row>') });
        expect(xlsxRows(only)).toEqual([['7']]);
        expect(() => xlsxRows(book({ 'xl/sharedStrings.xml': sst }))).toThrow(/sheet1/);
    });
});

describe('xlsxFromZip', () => {
    it('reads a workbook nested in a zip and rejects a missing one', () => {
        const inner = book({ 'xl/worksheets/sheet1.xml': sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>') });
        const outer = book({ 'a.docx': 'x' });
        const zip = new AdmZip(outer);
        zip.addFile('data.xlsx', inner);
        expect(xlsxFromZip(zip.toBuffer(), 'data.xlsx')).toEqual([['1']]);
        expect(() => xlsxFromZip(outer, 'data.xlsx')).toThrow(/data.xlsx/);
    });
});

describe('csuPopulation', () => {
    it('maps municipality rows (B = code, D = population) from row 7 on, skipping headings and totals', () => {
        const rows = [
            ['title'], [], [], [], ['kód okresu', 'kód obce'], [],
            ['CZ0100', '554782', 'Hlavní město Praha', '1397880'], // kraj/ČR řádek mimo obce nevadí, kód je 6místný: bere se
            ['Okres Benešov'], // záhlaví okresu bez kódu obce
            ['CZ0201', '529303', 'Benešov', '17043', '8058'],
            ['CZ0201', '532568', 'Bernartice', '223'],
            ['CZ0201', 'x', 'bez kódu', '5'],
            ['CZ0201', '532569', 'bez počtu', ''],
        ];
        const m = csuPopulation(rows);
        expect(m.get(529303)).toEqual({ name: 'Benešov', population: 17043 });
        expect(m.get(532568)).toEqual({ name: 'Bernartice', population: 223 });
        expect(m.has(532569)).toBe(false);
        expect(m.has(0)).toBe(false);
        expect(m.size).toBe(3);
    });
});
