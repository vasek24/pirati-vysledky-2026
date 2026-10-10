import './test-jsx.js'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'
import Board from './components/Board.jsx'
import Header from './components/Header.jsx'
import Footer from './components/Footer.jsx'
import Banner from './components/Banner.jsx'
import { readFileSync } from 'node:fs'
import { CHIP, HOME_URL, REL, STATE, T } from './text.js'
import { POLLS_CLOSE } from './closing.js'
import { betweenRounds, counting, finalR2, runoff, runoffEliminatedPirate, waiting, withVotes } from './fixtures/scenarios.js'
import { nf, pc } from './format.js'
import { derive } from '../../cloudflare-senat/src/derive.js'
import { currentRound } from './view.js'

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

const sp = (x) => x.replace(/\s/g, ' ') // nbsp -> space (cs-CZ number format)
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
    expect(out).toContain('Vede s 36,00 %, pod 50 %: do 2. kola jdou dvě kandidatury s nejvíce hlasy. Náskok 1 400 hlasů.')
    expect(out).toContain('class="snt-rk">1. místo<')
    // card + detail row both carry the reason line
    expect(out.match(/class="snt-why"/g).length).toBeGreaterThanOrEqual(2)
  })

  // ČSÚ procenta ořezává: 49,96 se nikdy nesmí ukázat jako „50,0 %“ (karta, věta důvodu, detail)
  test('share 49.96 % is shown as 49,96 %, never as 50,0 % (cards, reason line, detail)', () => {
    const s = withVotes(counting(), 30, 1, 150, { 2: 4996, 6: 3000, 3: 2004 }, {}, 200)
    const sucharda = s.obvody.find((o) => o.n === 30).candidates.find((c) => c.no === 2)
    expect(sucharda.pct1).toBe(49.96)
    expect(sucharda.outlook).toBe('advance')
    const out = sp(html(s, 30))
    expect(out).not.toMatch(/50,0 %/)
    expect(out).not.toMatch(/50,00 %/)
    expect(out).toContain('<span class="snt-num">49,96 %</span>') // card
    expect(out).toContain('Vede s 49,96 %, pod 50 %: do 2. kola jdou dvě kandidatury') // reason line reads consistently
    expect(out).toContain('<span>49,96 %</span>') // detail row
    expect(out).toContain('30,00 %') // 3000 / 10000
    expect(out).toContain('20,04 %')
  })

  test('the Pirate card of a race at 50.04 % shows 50,04 % and the majority note, not "50,0 %"', () => {
    const s = withVotes(counting(), 30, 1, 200, { 2: 5004, 6: 3000, 3: 1996 }, {}, 200)
    const out = sp(html(s, 30))
    expect(out).toContain('<span class="snt-num">50,04 %</span>')
    expect(out).not.toMatch(/50,0 %/)
  })

  test('round 2 finalists at 49.96 / 50.04 are told apart (no pair of "50,0 %")', () => {
    const s = withVotes(runoff(), 30, 2, 50, { 2: 4996, 6: 5004 })
    const o = s.obvody.find((x) => x.n === 30)
    expect(o.candidates.find((c) => c.no === 2).pct2).toBe(49.96)
    expect(o.candidates.find((c) => c.no === 6).pct2).toBe(50.04)
    const out = sp(html(s, 30))
    expect(out).toContain('<span class="snt-num">49,96 %</span>') // the Pirate finalist's card
    expect(out).toContain('<span>49,96 %') // detail rows of both finalists
    expect(out).toContain('<span>50,04 %')
    expect(out).not.toMatch(/50,0 %/)
  })

  // 199 z 200 okrsků nesmí ukázat „100 %“ (karta, popisek pásu, hlavička detailu)
  test('precinct progress rounds down: 199 of 200 is 99 %, never 100 %', () => {
    const votes = { 2: 4000, 6: 3000, 3: 3000 }
    for (const [z, shown] of [[199, 99], [1, 0], [200, 100], [0, 0]]) {
      const s = withVotes(counting(), 30, 1, z, votes, {}, 200)
      const out = sp(html(s, 30))
      expect(out, `${z}`).toContain(`1. kolo: sečteno ${z} z 200 okrsků (${shown} %)`) // detail header
      expect(out, `${z}`).toContain(`sečteno ${z} z 200 okrsků (${shown} %)`) // card
      if (z > 0 && z < 200) {
        expect(out, `${z}`).not.toContain(`sečteno ${z} z 200 okrsků (100 %)`)
        expect(out, `${z}`).toMatch(new RegExp(`30 · .+ · sčítá se ${shown} %`)) // strip caption
      }
    }
    // the 100 % case really is z === c
    expect(sp(html(withVotes(counting(), 30, 1, 200, votes, {}, 200), 30))).toContain('(100 %)')
  })

  test('waiting cards show "bez pořadí" and no extra reason line when outlook is null', () => {
    const w = waiting()
    for (const o of w.obvody) for (const c of o.candidates) { c.outlook = null; c.gap = null }
    const out = html(w, 3)
    expect(out.match(/class="snt-rk">bez pořadí</g)).toHaveLength(18)
    expect(out).not.toContain('class="snt-why"') // chip + „sečteno 0 z N“ stačí
    expect(out).not.toContain('Sčítání zatím nezačalo.')
  })

  test('mobile jump row: three anchors that point at existing section ids (only with a snapshot)', () => {
    const s = waiting()
    const out = html(s, 3)
    const hrefs = [...out.matchAll(/<nav class="snt-jump"[^>]*>(.*?)<\/nav>/g)][0][1].match(/href="#[^"]+"/g).map((x) => x.slice(7, -1))
    expect(hrefs).toEqual(['h-pir', 'h-strip', 'h-det'])
    for (const id of hrefs) expect(out).toContain(`id="${id}"`)
    expect(out).toContain(`>${T.jumpCandidacies}<`)
    expect(out).toContain(`aria-label="${T.jumpLabel}"`)
    expect(renderToStaticMarkup(h(Header, { snapshot: null, serverNow: 0, nextAt: null }))).not.toContain('snt-jump')
  })

  test('board sections carry the classes the mobile CSS `order` relies on', () => {
    const out = html(waiting(), 3)
    for (const c of ['snt-s-over', 'snt-s-strip', 'snt-s-pir', 'snt-s-det', 'snt-s-how']) expect(out).toContain(`class="${c}"`)
  })

  test('mobile CSS: strip comes before the Pirate section; jump row is sticky and clears the anchors', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
    const mobile = css.slice(css.indexOf('@media (max-width:520px)'))
    const order = (c) => Number(mobile.match(new RegExp(`\\.${c}\\{order:(\\d)\\}`))[1])
    expect([order('snt-s-over'), order('snt-s-strip'), order('snt-s-pir'), order('snt-s-det'), order('snt-s-how')]).toEqual([1, 2, 3, 4, 5])
    expect(mobile).toMatch(/\.snt-jump\{[^}]*position:sticky;top:env\(safe-area-inset-top,0px\);z-index:20;height:44px/)
    expect(mobile).toMatch(/\.snt-eyebrow\{scroll-margin-top:56px\}/)
    expect(mobile).toMatch(/\.snt-cell i\{display:none\}/)
  })

  test('jump row is a sibling of <header> (sticky needs the page-wide parent)', () => {
    const out = renderToStaticMarkup(h(Header, { snapshot: waiting(), serverNow: 0, nextAt: null }))
    expect(out).toMatch(/<\/header><nav class="snt-jump"/)
  })

  test('strip caption names the selected obvod: number, name, state, progress only while counting, Pirate mark', () => {
    const s = counting()
    const o = s.obvody.find((x) => x.state === 'counting' && x.hasPirate)
    const cap = (n) => html(s, n).match(/<p class="snt-cap"[^>]*>(.*?)<\/p>/)[1]
    expect(cap(o.n)).toMatch(new RegExp(`^${o.n} · .+ · sčítá se \\d+ % · kandidatura Pirátů$`))
    const w = s.obvody.find((x) => x.state === 'waiting')
    if (w) expect(cap(w.n)).toContain('čeká na sčítání')
    expect(html(s, o.n)).toContain(`<i>${o.name}</i>`) // desktop still shows the name; mobile hides it in CSS
    expect(T.cellCaption(30, 'Kladno', 'Sčítá se', 64, false)).toBe('30 · Kladno · sčítá se 64 %')
    expect(T.cellCaption(5, 'Karlovy Vary', 'Mandát získán', null, true)).toBe('5 · Karlovy Vary · mandát získán · kandidatura Pirátů')
  })

  test('runoff scenario shows round-2 progress, round-1 line and a tie', () => {
    const s = runoff()
    const out = everyObvod(s)
    expect(html(s, 30)).toContain(T.pillLive(2))
    expect(out).toContain(T.inRound2.trim())
    expect(out).toContain('1. kolo: ')
    expect(html(s, 57)).toContain(CHIP.runoffTie)
  })

  test('round 2: a Pirate candidacy that missed the runoff keeps its round-1 numbers (card)', () => {
    const s = runoffEliminatedPirate()
    const cards = html(s, 30).split('class="snt-card').slice(1)
    const card = cards.find((x) => x.includes('Jan Klas')).replace(/\s/g, ' ')
    expect(card).toContain(`<b class="snt-num">${sp(nf(4221))}</b>`)
    expect(card).toContain(`<span class="snt-num">${sp(pc(s.obvody.find((o) => o.n === 30).candidates.find((c) => c.no === 1).pct1))}</span>`)
    expect(card).toContain(`class="snt-rk">${T.rankRound1(3)}<`)
    expect(card).toContain(`snt-chip snt-notAdvancing">${CHIP.notAdvancing}<`)
    expect(card).toContain(`${T.roundOnePrefix}${sp(T.progress(nf(150), nf(150), 100))}`)
    expect(card).not.toContain(T.roundTwoPrefix)
    expect(card).not.toContain(T.noRank)
    // the finalist next to it still shows round-2 numbers
    const fin = cards.find((x) => x.includes('Sucharda')).replace(/\s/g, ' ')
    expect(fin).toContain(`<b class="snt-num">${sp(nf(2000))}</b>`)
    expect(fin).toContain(T.roundTwoPrefix)
    expect(fin).toContain('class="snt-rk">1. místo<')
  })

  test('round 2: detail row of a non-finalist shows round-1 votes and share, "–" for round 2', () => {
    const s = runoffEliminatedPirate()
    const out = html(s, 30).replace(/\s/g, ' ')
    const row = out.split('class="snt-row').slice(1).find((x) => x.includes('Jan Klas'))
    expect(row).toContain(`<b>${sp(nf(4221))}</b>`)
    expect(row).toContain(`${T.inRound1.trim()}`)
    expect(row).toContain(T.round2None)
    expect(row).not.toContain('0,00 %')
    expect(row).toContain(`title="${T.rankRound1(3)}"`)
    // round-2 finalist rows keep the round-1 line instead
    const fin = out.split('class="snt-row').slice(1).find((x) => x.includes('Sucharda'))
    expect(fin).toContain(T.inRound2.trim())
    expect(fin).not.toContain(T.round2None)
    // finalists first, then the rest by round-1 votes
    const order = [...out.matchAll(/class="snt-bn"[^>]*>(\d)</g)].map((m) => Number(m[1]))
    expect(order).toEqual([2, 6, 1, 5, 4, 3])
  })

  // obvod 30 jako ČSÚ ho může poslat: HLASY_2KOLO u finalistek, ale bez UCAST 2. kola (rounds[2] chybí)
  const withoutUcast2 = (s, n) => {
    const x = structuredClone(s)
    delete x.obvody.find((o) => o.n === n).rounds[2]
    return { ...derive(x), phase: s.phase, round: s.round }
  }

  test('round 2 votes without a round-2 UCAST: card and detail show round-2 numbers, no crash', () => {
    const s = withoutUcast2(runoff(), 30)
    const o = s.obvody.find((x) => x.n === 30)
    expect(o.rounds[2]).toBeUndefined()
    expect(currentRound(o)).toBe(2)
    const sucharda = o.candidates.find((c) => c.no === 2)
    const out = html(s, 30).replace(/\s/g, ' ')

    const card = out.split('class="snt-card').slice(1).find((x) => x.includes('Sucharda'))
    expect(card).toContain(`<b class="snt-num">${sp(nf(2000))}</b>`) // round-2 votes, not the 3 600 of round 1
    expect(card).not.toContain(`<b class="snt-num">${sp(nf(3600))}</b>`)
    expect(card).toContain(`<span class="snt-num">${sp(pc(sucharda.pct2))}</span>`)
    expect(card).toContain('class="snt-rk">1. místo<') // the server rank (from round-2 votes) next to round-2 votes
    expect(card).toContain(`${T.roundTwoPrefix}${T.progressNone}`)

    const row = out.split('class="snt-row').slice(1).find((x) => x.includes('Sucharda'))
    expect(row).toContain(`<b>${sp(nf(2000))}</b>`)
    expect(row).toContain(sp(pc(sucharda.pct2, 2)))
    expect(row).toContain(T.inRound2.trim())
    expect(out).toContain(T.round2ProgressNone)
    expect(out).toContain(T.round1Progress(nf(150), nf(150), '100 %').replace(/\s/g, ' '))
    // the strip and the overall header render too
    expect(out).toMatch(/class="snt-cell /)
  })

  test('a missing share (null pct2) is shown as a dash, never as 0,00 %', () => {
    const s = patch(withoutUcast2(runoff(), 30), 30, 2, { pct2: null })
    const out = html(s, 30).replace(/\s/g, ' ')
    const card = out.split('class="snt-card').slice(1).find((x) => x.includes('Sucharda'))
    expect(card).toContain(`<b class="snt-num">${sp(nf(2000))}</b>`)
    expect(card).toContain('<span class="snt-num">–</span>')
    expect(card).not.toContain(sp(pc(0)))
    const row = out.split('class="snt-row').slice(1).find((x) => x.includes('Sucharda'))
    expect(row).toContain(`<b>${sp(nf(2000))}</b><span>–`)
    expect(row).not.toContain(sp(pc(0)))
  })

  test('a Worker close override shows up in the header countdown (round 2 closes 24. 10.)', () => {
    const R2b = Date.parse('2026-10-24T14:00:00+02:00')
    const b = { ...betweenRounds(), closes: { 1: POLLS_CLOSE[1], 2: R2b } }
    const out = renderToStaticMarkup(h(Header, { snapshot: b, serverNow: POLLS_CLOSE[2] - 3600_000, nextAt: null }))
    expect(out).toContain('Druhé kolo: volební místnosti se zavírají v sobotu 24. 10. ve 14:00 — za <b class="snt-left">7 d 1 h</b>')
  })

  test('round 2 without a UCAST: outlook text does not crash', () => {
    const s = withoutUcast2(runoff(), 30)
    const o = s.obvody.find((x) => x.n === 30)
    for (const kind of ['lead', 'trail', 'tie']) {
      const x = structuredClone(s)
      const c = x.obvody.find((q) => q.n === 30).candidates.find((q) => q.no === 2)
      Object.assign(c, { official: false, outlook: kind, gap: 100 })
      expect(() => html(x, 30)).not.toThrow()
    }
    expect(o.candidates.length).toBeGreaterThan(0)
  })

  test('idle round 2 with no counted precinct: header shows the waiting pill', () => {
    const s = runoff()
    s.phase = 'idle'
    for (const o of s.obvody) if (o.rounds[2]) o.rounds[2].okrskyZprac = 0
    const out = html(s, 30)
    expect(out).toContain(T.pillWaitingR2)
    expect(out).toContain(T.agoWaitingR2)
    expect(out).not.toContain('SČÍTÁNÍ UKONČENO')
  })

  test('tiles: ties get their own tile only when there are some; behind tile uses the neutral label', () => {
    const s = runoff()
    expect(s.summary.ties).toBeGreaterThan(0)
    const out = html(s, 30)
    expect(out).toContain(T.tileTies)
    expect(out).toContain(T.pTileBehind)
    expect(out).toContain(`<b class="snt-num">${s.summary.runoff}</b><span>${T.tileRunoff}</span>`)
    expect(html(counting(), 30)).not.toContain(T.tileTies)
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

  const head = (s, serverNow) => renderToStaticMarkup(h(Header, { snapshot: s, serverNow, nextAt: null }))

  test('header (Prague style): logo, back-link to the splitter, headline with the year, pill', () => {
    const out = head(waiting(), POLLS_CLOSE[1] - 60000)
    expect(out).toContain('<img class="snt-logo" src="/brand/logo-full-white.svg"')
    expect(out).toContain(`alt="${T.logoAlt}"`)
    expect(out).toContain(`href="${HOME_URL}"`)
    expect(out).toContain(`<h1>${T.headlineName} <span class="snt-year">${T.headlineYear}</span></h1>`)
    expect(out).toContain(`<span>${T.pillWaiting}</span>`)
    expect(out).not.toContain('snt-dot') // the pulsing dot only belongs to the live pill
    expect(head(counting(), counting().generatedMs + 14000)).toContain('snt-pill snt-live"><i class="snt-dot"></i>')
  })

  test('header: before the polls close of the CURRENT round it shows the countdown with a highlighted figure', () => {
    const w = waiting()
    const before = head(w, POLLS_CLOSE[1] - 43 * 60000)
    expect(before).toContain('<p class="snt-closes">Volební místnosti se zavírají v sobotu 10. 10. ve 14:00 — za <b class="snt-left">43 min</b></p>')
    expect(head(w, POLLS_CLOSE[1] - (5 * 60 + 12) * 60000)).toContain('<b class="snt-left">5 h 12 min</b>')
    // the freshness line stays under it
    expect(before).toContain(`<p class="snt-fresh">${T.csuFrom('8. 10. 16:40:15')}`)
    // after the round-1 close the round-1 countdown is gone (see below for the round-2 one)
    expect(head(w, POLLS_CLOSE[1] + 1000)).not.toContain('Volební místnosti se zavírají')
    // between the rounds: REAL server shape (round 1, phase idle, obvody in state runoff)
    const b = betweenRounds()
    expect(b.round).toBe(1)
    expect(b.phase).toBe('idle')
    expect(head(b, POLLS_CLOSE[1] + 3600_000)).toContain('<p class="snt-closes">Druhé kolo: volební místnosti se zavírají v sobotu 17. 10. ve 14:00 — za <b class="snt-left">6 d 23 h</b></p>')
    expect(head(b, POLLS_CLOSE[1] + 3600_000)).toContain('snt-fresh') // the freshness line stays under it
    expect(head(b, POLLS_CLOSE[2] - 90 * 60000)).toContain('<b class="snt-left">1 h 30 min</b>')
    // nothing decided yet (no official runoff flag): NO round-2 countdown, it would suggest a runoff exists
    expect(head(w, POLLS_CLOSE[1] + 3600_000)).not.toContain('Druhé kolo: volební místnosti')
    // after the round-2 close only the freshness line
    expect(head(b, POLLS_CLOSE[2] + 1)).not.toContain('snt-closes')
    // a decided final has no countdown
    expect(head(finalR2(), POLLS_CLOSE[1] + 3600_000)).not.toContain('snt-closes')
    // no snapshot yet: round 1 countdown
    expect(renderToStaticMarkup(h(Header, { snapshot: null, serverNow: POLLS_CLOSE[1] - 60000, nextAt: null }))).toContain('<b class="snt-left">1 min</b>')
  })

  test('hero tiles: the first tile of each block is the black card with a yellow label', () => {
    const out = html(waiting(), 3)
    expect(out.match(/class="snt-tile snt-main/g)).toHaveLength(2)
    expect(out).toContain(`<div class="snt-tl">${T.tileLabelOverview}</div>`)
    expect(out).toContain(`<div class="snt-tl">${T.tileLabelPirates}</div>`)
  })

  test('only snt- class names (the root Tailwind scans senat/ too)', () => {
    const w = waiting()
    const out = [html(w, 3), html(counting(), 30), html(runoff(), 30), renderToStaticMarkup(h(Footer)), renderToStaticMarkup(h(Banner, { notice: 'stale' }))].join('\n')
    const names = new Set([...out.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))
    expect(names.size).toBeGreaterThan(40)
    expect([...names].filter((c) => !c.startsWith('snt-'))).toEqual([])
  })

  test('Prague look: fonts, light page, Pirate yellow, no dark-mode block', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
    const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(page).toContain('family=Bebas+Neue&family=Roboto+Condensed:wght@400;700&family=Roboto:wght@400;500;700')
    expect(page).toContain('/brand/favicon.svg')
    expect(page).not.toMatch(/Bricolage|Schibsted/)
    expect(css).toMatch(/color-scheme:light/)
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/)
    expect(css).toMatch(/--page:#f3f3f1/)
    expect(css).toMatch(/--yellow:#fec900/)
    expect(css).toMatch(/--f-display:"Bebas Neue"/)
    expect(css).toMatch(/--f-cond:"Roboto Condensed"/)
    for (const f of ['logo-full-white.svg', 'favicon.svg']) expect(readFileSync(new URL(`../public/brand/${f}`, import.meta.url), 'utf8')).toContain('<svg')
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
