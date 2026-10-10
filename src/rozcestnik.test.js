import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../placeholder/index.html', import.meta.url))
const html = readFileSync(file, 'utf8')
const HOSTS = ['praha.dg12.cz', 'mesta.dg12.cz', 'senat.dg12.cz']

describe('rozcestnik (volby.dg12.cz)', () => {
  it('odkazuje na tři cíle', () => {
    for (const h of HOSTS) expect(html).toContain(h)
  })

  it('nemá žádný skript ani cizí URL', () => {
    expect(html).not.toMatch(/<script/i)
    const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) ?? []
    for (const u of urls) expect(HOSTS).toContain(new URL(u).hostname)
    expect(html).not.toMatch(/http:\/\//)
  })

  it('má jazyk, viewport, kontakt a noindex', () => {
    expect(html).toContain('lang="cs"')
    expect(html).toContain('viewport')
    expect(html).toContain('tel:+420777954389')
    expect(html).toContain('<meta name="robots" content="noindex">')
  })

  it('Praha, Města a Senát jsou odkazy, žádná karta není neaktivní', () => {
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(anchors).toContain('https://praha.dg12.cz')
    expect(anchors).toContain('https://mesta.dg12.cz')
    expect(anchors).toContain('https://senat.dg12.cz')
    expect(html.match(/<div class="card"[^>]*aria-disabled="true"/g)).toBeNull()
  })

  it('je malý (< 15 KB)', () => {
    expect(statSync(file).size).toBeLessThan(15 * 1024)
  })
})
