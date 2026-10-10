// Kontrast textu v styles.css (WCAG AA: 4,5:1 pro běžný text). Poměry se počítají z hodnot v CSS,
// takže změna barvy, která text zhorší, spadne tady.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const token = (name) => css.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`))[1]

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}
// bílý text s průhledností `a` na pozadí `bg`
const whiteOn = (a, bg) => '#' + rgb(bg).map((c) => Math.round(255 * a + c * (1 - a)).toString(16).padStart(2, '0')).join('')

const WHITE = token('card')
const PAGE = token('page')
const BLACK = token('black')
const T3 = token('ink-3')
const T2 = token('ink-2')
const FAINT = token('faint')
const YELLOW = token('yellow')

describe('text contrast', () => {
  test('--faint (#a3a3a3) is too weak for text: 2.5:1 on white', () => {
    expect(ratio(FAINT, WHITE)).toBeLessThan(3)
    expect(ratio(FAINT, PAGE)).toBeLessThan(3)
  })

  test('no rule uses --faint as a text colour (decoration only)', () => {
    expect(css).not.toMatch(/[^-]color:var\(--faint\)/)
    expect(css.match(/var\(--faint\)/g)).toHaveLength(1) // the empty detail bar
    expect(css).toMatch(/\.snt-rbar>i\{background:var\(--faint\)\}/)
  })

  test('informational greys are at least 4.5:1 on their backgrounds', () => {
    const track = token('track')
    const pirateRow = token('yellow-soft')
    for (const [fg, bg, what] of [
      [T3, WHITE, 'rank numeral / zero tile / unranked share on white'],
      [T3, PAGE, 'ink-3 on the page'],
      [T3, track, 'unranked rank badge'],
      [T3, pirateRow, 'rank numeral in a Pirate row'],
      [T2, WHITE, 'ink-2 on white'],
      [T2, pirateRow, 'ink-2 on a Pirate row'],
    ]) expect(ratio(fg, bg), what).toBeGreaterThanOrEqual(4.5)
    // zero count in the black hero tile: rgba(255,255,255,.65) on black
    expect(css).toMatch(/\.snt-tile\.snt-main\.snt-zero b\{color:rgba\(255,255,255,\.65\)\}/)
    expect(ratio(whiteOn(0.65, BLACK), BLACK)).toBeGreaterThanOrEqual(4.5)
  })

  test('the rules that carry those greys use the accessible tokens', () => {
    for (const re of [
      /\.snt-tile\.snt-zero b\{color:var\(--ink-3\)\}/,
      /\.snt-unranked span\.snt-num\{color:var\(--ink-3\)\}/,
      /\.snt-rk2\{[^}]*color:var\(--ink-3\)\}/,
    ]) expect(css).toMatch(re)
  })

  test('Pirate yellow is text only on black (it is 1.4:1 on white)', () => {
    expect(ratio(YELLOW, WHITE)).toBeLessThan(2)
    expect(ratio(YELLOW, BLACK)).toBeGreaterThanOrEqual(10)
    // every rule that sets color:var(--yellow) is one of these, each on a black background
    const onBlack = [
      'h1 .snt-year', // black header band
      '.snt-left', // countdown in the black header band
      '.snt-tile.snt-main .snt-tl', // label of the black hero tile
      '.snt-ob em', // obvod number badge (black background)
      '.snt-big .snt-rk', // rank badge (black background)
    ]
    const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /(^|[;{])color:var\(--yellow\)/.test(m[2]))
      .map((m) => m[1].trim())
    expect(found.sort()).toEqual([...onBlack].sort())
    expect(css).toMatch(/\.snt-ob em\{[^}]*background:var\(--black\)/)
    expect(css).toMatch(/\.snt-big \.snt-rk\{[^}]*background:var\(--black\)/)
  })
})
