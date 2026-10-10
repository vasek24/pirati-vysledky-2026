import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  checkCsp, checkWrangler, classifyChanged, gzipKB, parseCsp, parseHeadersFile, parseJsonc, parseSecurityTxt, scanText, stripJsonc,
} from './qa-gates.mjs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const wrangler = () => parseJsonc(read('../wrangler.jsonc'))
const HEADERS = read('../../senat/public/_headers')
const HTML = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto&display=swap" />
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-abc.css">
</head><body><div id="root"></div><noscript><p style="margin:16px">JS</p></noscript></body></html>`

describe('stripJsonc / parseJsonc', () => {
  it('drops comments and trailing commas but keeps // inside strings', () => {
    expect(parseJsonc('{ // c\n "a": "http://x//y", /* b */ "b": [1, 2,], }')).toEqual({ a: 'http://x//y', b: [1, 2] })
    expect(stripJsonc('{"a": "/* not a comment */"}')).toBe('{"a": "/* not a comment */"}')
  })
  it('parses the real wrangler.jsonc', () => {
    expect(wrangler().name).toBe('pirati-senat-zaloha')
  })
})

describe('checkWrangler', () => {
  it('the real config passes', () => expect(checkWrangler(wrangler())).toEqual([]))
  it.each([
    ['production name', (c) => { c.name = 'pirati-volby-zaloha' }, /name/],
    ['staging name', (c) => { c.env.staging.name = 'pirati-senat-zaloha' }, /env\.staging\.name/],
    ['account', (c) => { c.account_id = 'x' }, /account_id/],
    ['no custom domain', (c) => { c.routes = [] }, /routes lacks/],
    ['other host', (c) => { c.routes.push({ pattern: 'volby.dg12.cz', custom_domain: true }) }, /other hosts: volby\.dg12\.cz/],
    ['staging gets a route', (c) => { c.env.staging.routes = [{ pattern: 'senat.dg12.cz', custom_domain: true }] }, /env\.staging\.routes/],
    ['staging cron', (c) => { c.env.staging.triggers.crons = ['* * * * *'] }, /staging\.triggers/],
    ['main', (c) => { c.main = 'worker.js' }, /main/],
    ['KV', (c) => { c.kv_namespaces = [{ binding: 'KV', id: 'x' }] }, /kv_namespaces/],
    ['secret-looking var', (c) => { c.vars = { GITHUB_TOKEN: 'ghp_' + 'a'.repeat(36) } }, /unexpected var GITHUB_TOKEN/],
    ['unknown var in staging', (c) => { c.env.staging.vars = { CSU_BASE: 'a'.repeat(40) } }, /looks like a secret/],
  ])('fails on %s', (_n, mutate, re) => {
    const c = wrangler()
    mutate(c)
    expect(checkWrangler(c).join('\n')).toMatch(re)
  })
})

describe('parseSecurityTxt', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  it('accepts a tel contact and a future Expires', () => {
    expect(parseSecurityTxt('Contact: tel:+420777954389\nExpires: 2027-10-10T00:00:00Z\n', now)).toEqual([])
  })
  it('rejects a past Expires, a missing field and a non-tel contact', () => {
    expect(parseSecurityTxt('Contact: tel:+420777954389\nExpires: 2026-01-01T00:00:00Z', now)[0]).toMatch(/past/)
    expect(parseSecurityTxt('Contact: mailto:a@b.cz', now)).toHaveLength(2)
  })
  it('the real file passes', () => {
    expect(parseSecurityTxt(read('../../senat/public/.well-known/security.txt'))).toEqual([])
  })
})

describe('_headers', () => {
  it('the real file is well-formed and the CSP matches what index.html loads', () => {
    expect(parseHeadersFile(HEADERS).problems).toEqual([])
    expect(checkCsp(HEADERS, HTML)).toEqual([])
  })
  it('never sets Cache-Control under /* (merged with the specific rules otherwise)', () => {
    const all = parseHeadersFile(HEADERS).rules.find((r) => r.pattern === '/*')
    expect(all.headers.map((h) => h.name.toLowerCase())).not.toContain('cache-control')
  })
  it('assets are immutable, the document revalidates', () => {
    const { rules } = parseHeadersFile(HEADERS)
    const cc = (p) => rules.find((r) => r.pattern === p).headers.find((h) => h.name === 'Cache-Control').value
    expect(cc('/assets/*')).toBe('public, max-age=31536000, immutable')
    expect(cc('/')).toBe('no-cache')
    expect(cc('/index.html')).toBe('no-cache')
  })
  it('parseHeadersFile reports syntax problems', () => {
    expect(parseHeadersFile('  X-A: b\n').problems[0]).toMatch(/before any path/)
    expect(parseHeadersFile('nopath\n  X-A: b').problems[0]).toMatch(/must start with/)
    expect(parseHeadersFile('/a\n  X-A\n').problems[0]).toMatch(/no value/)
  })
  it('checkCsp flags drift between index.html and the policy', () => {
    const csp = (v) => `/*\n  Content-Security-Policy: ${v}\n`
    const good = parseHeadersFile(HEADERS).rules[0].headers.find((h) => h.name === 'Content-Security-Policy').value
    expect(checkCsp(csp(good.replace(' https://fonts.googleapis.com', '')), HTML).join()).toMatch(/stylesheet .* not allowed/)
    expect(checkCsp(csp(good.replace('https://fonts.gstatic.com', "'self'")), HTML).join()).toMatch(/font-src/)
    expect(checkCsp(csp(good.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")), HTML).join()).toMatch(/unsafe-inline/)
    expect(checkCsp(csp(good), HTML.replace('<body>', '<body><script>alert(1)</script>')).join()).toMatch(/inline <script>/)
    expect(checkCsp(csp(good), HTML.replace('<div id="root">', '<div style="x:y" id="root">')).join()).toMatch(/inline styles/)
    expect(checkCsp(csp(good), HTML.replace('/assets/index-abc.js', 'https://cdn.example/x.js')).join()).toMatch(/script https:\/\/cdn\.example/)
    expect(checkCsp('/*\n  X-A: b\n', HTML)).toContain('no Content-Security-Policy under /*')
  })
  it('parseCsp', () => {
    expect(parseCsp("default-src 'none'; img-src 'self' data:")).toEqual({ 'default-src': ["'none'"], 'img-src': ["'self'", 'data:'] })
  })
})

describe('classifyChanged', () => {
  it('flags Prague paths, warns on other root files, allows package.json and eslint.config.js', () => {
    const r = classifyChanged([
      'cloudflare/worker.js', 'src/volby/format.js', 'public/a.png', 'api/volby.js', 'index.html', 'vitest.config.js', '.github/workflows/ci.yml',
      'package.json', 'eslint.config.js', 'README.md', 'senat/public/_headers', 'cloudflare-senat/scripts/qa-gates.mjs', 'docs/ops/x.md',
    ])
    expect(r.bad).toEqual(['cloudflare/worker.js', 'src/volby/format.js', 'public/a.png', 'api/volby.js', 'index.html', 'vitest.config.js', '.github/workflows/ci.yml'])
    expect(r.warn).toEqual(['README.md'])
  })
})

describe('misc', () => {
  it('scanText names the patterns that hit', () => {
    expect(scanText('see jsemfast', [['jsemfast', /jsemfast/], ['x', /x{9}/]])).toEqual(['jsemfast'])
  })
  it('gzipKB measures compressed size', () => {
    expect(gzipKB(Buffer.from('a'.repeat(100000)))).toBeLessThan(1)
  })
})
