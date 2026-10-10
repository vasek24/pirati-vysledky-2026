import './test-jsx.js'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import Board from './components/Board.jsx'
import Header from './components/Header.jsx'
import Footer from './components/Footer.jsx'
import Banner from './components/Banner.jsx'
import App from './App.jsx'
import * as text from './text.js'
import { counting, finalR2, runoff, runoffEliminatedPirate, scrubRegistry, waiting } from './fixtures/scenarios.js'

// Spec §5: žádné rodově ohebné označení osoby. Zákaz ze spec + přísnější varianta s Unicode
// (JS `\b` nezná „á“, takže `kandidát\b` samo o sobě „kandidát “ nechytí).
const DENY = /kandidát\b|kandidáti\b|kandidátů|zvolen\b|zvolena|podporovan|postoupil|navrhla|člen\/ka|nezvolen/i
const DENY_STRICT = /kandidát(?!\p{L})|kandidát[iůk]|zvolen(?!\p{L})|zvolen[aáéýo]|podporovan|postoup(?:il|ila)|navrhl|člen\/ka|nezvolen|senátor|vítěz|ten, kdo|ta, která|poskytl/iu

const SAMPLES = [1, 2, 30, 'X', 'Y', null, true]
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (typeof value === 'function') strings(value(...SAMPLES), out)
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out))
  return out
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('gender-neutral wording (deny-list)', () => {
  test('the deny-list itself catches the forbidden forms', () => {
    for (const bad of ['kandidát', 'kandidáti', 'kandidátů', 'zvolen', 'Zvolena', 'podporovaný', 'postoupil', 'navrhla', 'člen/ka', 'nezvolen', 'kandidátka'])
      expect(DENY_STRICT.test(bad) || DENY.test(bad), bad).toBe(true)
    expect(DENY_STRICT.test('kandidatura kandidatury kandidaturou')).toBe(false)
  })

  test('every string in text.js (templates called with sample args)', () => {
    const all = Object.values(text).flatMap((v) => strings(v))
    expect(all.length).toBeGreaterThan(100)
    for (const s of all) {
      expect(s, s).not.toMatch(DENY)
      expect(s, s).not.toMatch(DENY_STRICT)
    }
  })

  test('index.html static copy', () => {
    const html = read('../index.html')
    expect(html).not.toMatch(DENY)
    expect(html).not.toMatch(DENY_STRICT)
  })

  test('rendered page text for every scenario and every obvod (registry text scrubbed)', () => {
    const idleR2 = () => {
      const s = runoff()
      s.phase = 'idle'
      for (const o of s.obvody) if (o.rounds[2]) o.rounds[2].okrskyZprac = 0
      return s
    }
    for (const make of [waiting, counting, runoff, runoffEliminatedPirate, idleR2, finalR2]) {
      const s = scrubRegistry(make())
      for (const o of s.obvody) {
        const out =
          renderToStaticMarkup(h(Board, { snapshot: s, selected: o.n, onSelect: () => {} })) +
          renderToStaticMarkup(h(Header, { snapshot: s, serverNow: s.generatedMs + 5000, nextAt: s.generatedMs + 60000 }))
        expect(out).not.toMatch(DENY)
        expect(out).not.toMatch(DENY_STRICT)
      }
    }
    for (const part of [h(Footer), h(Banner, { notice: 'stale' }), h(Banner, { notice: 'offline' }), h(App)]) {
      const out = renderToStaticMarkup(part)
      expect(out).not.toMatch(DENY)
      expect(out).not.toMatch(DENY_STRICT)
    }
  })

  test('registry text stays verbatim (names are not altered, never a generated title)', () => {
    const page = (n) => renderToStaticMarkup(h(Board, { snapshot: waiting(), selected: n, onSelect: () => {} }))
    const out = page(75)
    expect(page(30)).toContain('Mgr. Adéla Sucharda Šípová')
    expect(out).toContain('MUDr. Mariam Szyja')
    expect(out).toContain('zubařka a digitální tvůrkyně') // registry job text, shown as published
  })
})
