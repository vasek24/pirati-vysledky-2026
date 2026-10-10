// S1: žádný prohlížeč nesahá přímo na volby.gov.cz — klientský kód nesmí
// importovat feedy ani základní URL ČSÚ.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIRS = ['hooks', 'pages', 'components', 'lib'];
const FORBIDDEN = ['createKvFeed', 'createOverviewFeed', 'createJsonCache', 'KV_BASE_URL'];

function walk(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.(jsx?|mjs)$/.test(name) && !/\.test\.js$/.test(name) ? [p] : [];
    });
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// import { a, b } from ... | import a from ... | require('...') na jednom příkazu se jménem
const importsName = (code, name) => {
    const n = `\\b${name}\\b`;
    return [
        new RegExp(`\\bimport\\s*(?:[\\w$]+\\s*,\\s*)?\\{[^}]*${n}[^}]*\\}`),
        new RegExp(`\\bimport\\s+${n}`),
        new RegExp(`\\brequire\\s*\\([^)]*\\)[^;\\n]*${n}`),
        new RegExp(`${n}[^;\\n]*=\\s*require\\s*\\(`),
    ].some((re) => re.test(code));
};

describe('S1: žádný přímý přístup prohlížeče na ČSÚ', () => {
    const files = CLIENT_DIRS.flatMap((d) => walk(join(SRC, d)));

    it('hledá opravdu nějaké soubory', () => {
        expect(files.length).toBeGreaterThan(10);
    });

    it('klientské moduly neimportují feedy ani KV_BASE_URL', () => {
        const offenders = [];
        for (const file of files) {
            const code = stripComments(readFileSync(file, 'utf8'));
            for (const name of FORBIDDEN) if (importsName(code, name)) offenders.push(`${file}: ${name}`);
        }
        expect(offenders).toEqual([]);
    });

    it('useLiveResults.js nemá .direct( ani goDirect', () => {
        const code = readFileSync(join(SRC, 'hooks', 'useLiveResults.js'), 'utf8');
        expect(code).not.toContain('.direct(');
        expect(code).not.toContain('goDirect');
    });
});
