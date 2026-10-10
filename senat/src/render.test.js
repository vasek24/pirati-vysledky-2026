import './test-jsx.js'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import Board from './components/Board.jsx'
import Header from './components/Header.jsx'
import Footer from './components/Footer.jsx'
import Banner from './components/Banner.jsx'
import { CHIP, REL, STATE, T } from './text.js'
import { counting, finalR2, runoff, waiting } from './fixtures/scenarios.js'

const html = (s, selected) =>
  renderToStaticMarkup(h(Board, { snapshot: s, selected, onSelect: () => {} })) +
  renderToStaticMarkup(h(Header, { snapshot: s, serverNow: s.generatedMs + 14000, nextAt: s.generatedMs + 60000 }))

// starší snapshot: bez outlook/gap
const strip = (s) => {
  const x = structuredClone(s)
  for (const o of x.obvody) for (const c of o.candidates) { delete c.outlook; delete c.gap }
  return x
}
const patch = (s, n, no, fields) => {
  const x = structuredClone(s)
  Object.assign(x.obvody.find((o) => o.n === n).candidates.find((c) => c.no === no), fields)
  return x
}

const everyObvod = (s) => s.obvody.map((o) => html(s, o.n)).join('\n')

describe('render', () => {
  test('waiting fixture: 18 cards sorted by obvod, 27 strip cells, tiles, header', () => {
    const s = waiting()
    const out = html(s, 3)
    expect(out.match(/class="snt-card[" ]/g)).toHaveLength(18)
    expect(out.match(/class="snt-cell /g)).toHaveLength(27)
    const nums = [...out.matchAll(/title="Otevřít detail obvodu (\d+) /g)].map((m) => Number(m[1]))
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
    expect(new Set(nums).size).toBe(18)
    expect(out).toContain(T.pillWaiting)
    expect(out).toContain(T.agoWaiting)
    expect(out).toContain(T.nextCheck('0:46'))
    expect(out).toContain(`${T.eyebrowPirates(18)}`)
    expect(out).toContain('Na lístku: Adéla do Senátu')
    expect(out).toContain(REL.ticket)
    expect(out).toContain(REL.endorsed)
  })

  test('counting scenario (older snapshot without outlook): status chip + provisional marker, no reason line', () => {
    const s = strip(counting())
    const out = everyObvod(s)
    expect(html(s, 30)).toContain(T.pillLive(1))
    expect(out).toContain(`${CHIP.leading}${T.provisional}`)
    expect(out).toContain(T.majority)
    expect(out).toContain(`snt-chip snt-elected">${CHIP.elected}<`) // official: no provisional suffix
    expect(out).toContain(`snt-chip snt-advancing">${CHIP.advancing}<`)
  })

  test('outlook from the server: rank badge, prefixed chip, one reason line (card and detail row)', () => {
    const s = patch(counting(), 30, 2, { outlook: 'advance', gap: 1400 })
    const out = html(s, 30).replace(/\s/g, ' ')
    expect(out).toContain('snt-chip snt-second">Předběžně: postup do 2. kola<')
    expect(out).toContain('Vede s 36,0 %, pod 50 %: do 2. kola jdou dvě kandidatury s nejvíce hlasy. Náskok 1 400 hlasů.')
    expect(out).toContain('class="snt-rk">1. místo<')
    // card + detail row both carry the reason line
    expect(out.match(/class="snt-why"/g).length).toBeGreaterThanOrEqual(2)
  })

  test('waiting cards show "bez pořadí" and the waiting reason when outlook is null', () => {
    const w = waiting()
    for (const o of w.obvody) for (const c of o.candidates) { c.outlook = null; c.gap = null }
    const out = html(w, 3)
    expect(out.match(/class="snt-rk">bez pořadí</g)).toHaveLength(18)
    expect(out).toContain(T.whyWaiting)
  })

  test('runoff scenario shows round-2 progress, round-1 line and a tie', () => {
    const s = runoff()
    const out = everyObvod(s)
    expect(html(s, 30)).toContain(T.pillLive(2))
    expect(out).toContain(T.inRound2.trim())
    expect(out).toContain('1. kolo: ')
    expect(html(s, 57)).toContain(CHIP.runoffTie)
  })

  test('final 2024 fixture: done pill, no provisional chips, no cards', () => {
    const s = finalR2()
    const out = everyObvod(s)
    expect(html(s, 5)).toContain(T.pillDone(2))
    expect(out).not.toContain(T.provisional)
    expect(out).not.toMatch(/class="snt-card[" ]/)
  })

  test('every status, state and chip wording is reachable in the rendered page', () => {
    const out = [counting(), runoff(), waiting(), finalR2()].map((x) => everyObvod(strip(x))).join('\n')
    for (const text of Object.values(CHIP)) expect(out, text).toContain(text)
    for (const text of Object.values(STATE)) expect(out, text).toContain(text)
  })

  test('footer links to the public ČSÚ app and the maintainer phone, nothing else', () => {
    const out = renderToStaticMarkup(h(Footer))
    expect(out).toContain('href="https://volby.gov.cz/app/senat/20261009/cs/home"')
    expect(out).toContain('href="tel:+420777954389"')
    expect(out).toContain('777 954 389')
    expect(out).not.toMatch(/appdata/)
  })

  test('banners', () => {
    expect(renderToStaticMarkup(h(Banner, { notice: 'stale' }))).toContain(T.bannerStale)
    expect(renderToStaticMarkup(h(Banner, { notice: 'offline' }))).toContain(T.bannerOffline)
    expect(renderToStaticMarkup(h(Banner, { notice: null }))).toBe('')
  })
})
