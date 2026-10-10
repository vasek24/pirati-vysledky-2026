// Kontakt na správce zálohy musí jít najít i bez fungujícího SPA / Workeru
// (statické soubory, <noscript>) a nikde nesmí tvrdit, že je autorem originálu.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const STATIC = {
    'public/humans.txt': 'manages this fork and its modifications',
    'public/kontakt.txt': 'spravuje tuto kopii',
    'public/.well-known/security.txt': 'manages this fork',
};

describe('kontakt na správce kopie', () => {
    for (const [file, phrase] of Object.entries(STATIC)) {
        describe(file, () => {
            const text = read(file);
            it('jmenuje správce', () => expect(text).toContain('Václav Vislous'));
            it('má telefon', () => {
                expect(text).toContain(file.endsWith('security.txt') ? 'tel:+420777954389' : '777 954 389');
            });
            it('říká, že kopii spravuje', () => expect(text).toContain(phrase));
            it('nenazývá ho autorem', () => expect(text).not.toMatch(/author|autor/i));
        });
    }

    it('security.txt má Contact a Expires', () => {
        const text = read('public/.well-known/security.txt');
        expect(text).toContain('Contact: tel:+420777954389');
        expect(text).toContain('Expires: 2027-10-10T00:00:00Z');
    });

    it('kontakt.txt je česky a odkazuje na originál', () => {
        expect(read('public/kontakt.txt')).toContain('jsemfast/pirati-vysledky-2026');
    });

    it('index.html má telefon i jméno (komentář + noscript)', () => {
        const html = read('index.html');
        expect(html).toContain('777 954 389');
        expect(html).toContain('Václav Vislous');
        expect(html).toContain('spravuje tuto kopii a její úpravy');
        expect(html).toMatch(/<noscript>[\s\S]*777 954 389[\s\S]*<\/noscript>/);
        expect(html).not.toMatch(/autor/i);
    });

    it('menu hlavičky odkazuje na rozcestník', () => {
        expect(read('src/components/ElectionHeader.jsx')).toContain('href="https://volby.dg12.cz"');
    });

    for (const file of ['src/pages/Landing.jsx', 'src/pages/CouncilApp.jsx']) {
        it(`${file} má patičku se správcem`, () => {
            const code = read(file);
            expect(code).toContain('správce kopie: Václav Vislous');
            expect(code).toContain('Záložní kopie originálu jsemfast/pirati-vysledky-2026');
            expect(code).toContain('tel:+420777954389');
        });
        it(`${file} odkazuje zpět na rozcestník volby.dg12.cz`, () => {
            expect(read(file)).toContain('href="https://volby.dg12.cz"');
        });
    }
});
