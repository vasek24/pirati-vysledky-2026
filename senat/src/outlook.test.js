import { describe, expect, test } from 'vitest'
import { outlookView, votesText } from './outlook.js'

const rounds = (z, _c, r2) => ({ 1: { okrskyCelkem: 100, okrskyZprac: r2 ? 100 : z }, ...(r2 ? { 2: { okrskyCelkem: 100, okrskyZprac: z } } : {}) })
const cand = (no, o) => ({ no, status: 'leading', official: false, rank: 1, pct1: 36, pct2: null, outlook: null, gap: null, ...o })
const obvod = (z, candidates, over) => ({ n: 30, state: 'counting', decidedRound: 0, rounds: rounds(z), candidates, ...over })
const flat = (v) => ({ ...v, why: v.why.replace(/\s/g, ' ') })
const view = (z, candidates, i = 0, over) => flat(outlookView(obvod(z, candidates, over), candidates[i]))

describe('votesText', () => {
  test.each([[0, '0 hlasů'], [1, '1 hlas'], [2, '2 hlasy'], [4, '4 hlasy'], [5, '5 hlasů'], [12, '12 hlasů'], [22, '22 hlasy'], [111, '111 hlasů'], [3602, '3 602 hlasy'], [1400, '1 400 hlasů'], [-7, '7 hlasů']])('%s', (n, t) => {
    expect(votesText(n).replace(/\s/g, ' ')).toBe(t)
  })
})

describe('outlookView', () => {
  test('official candidates keep the status chip and the official reason', () => {
    const c = cand(1, { official: true, status: 'elected' })
    expect(view(100, [c], 0, { decidedRound: 1 })).toEqual({ cls: 'elected', chip: 'Mandát získán', why: 'Nad 50 % platných hlasů, 2. kolo se nekoná' })
    expect(view(100, [c], 0, { decidedRound: 2 }).why).toBe('Ve 2. kole nejvíce hlasů')
    const r = (status, o) => view(100, [cand(1, { official: true, status })], 0, o)
    expect(r('advancing')).toEqual({ cls: 'advancing', chip: 'Postup do 2. kola', why: 'Nikdo nezískal přes 50 %: postupují dvě kandidatury s nejvíce hlasy' })
    expect(r('notAdvancing', { state: 'elected' }).why).toBe('Mandát získala jiná kandidatura')
    expect(r('notAdvancing', { state: 'runoff' }).why).toBe('Mimo dvě kandidatury s nejvíce hlasy')
    expect(r('runoffLost')).toMatchObject({ chip: 'Mandát nezískán', why: 'Ve 2. kole měla kandidatura méně hlasů' })
    expect(r('runoffTie')).toMatchObject({ chip: 'Shoda hlasů, mandát nezískal nikdo', why: 'Shoda hlasů: nikdo mandát nezískal, konají se opakované volby' })
  })

  test('an official flag wins even if an outlook is present', () => {
    expect(view(50, [cand(1, { official: true, status: 'advancing', outlook: 'out', gap: 5 })]).chip).toBe('Postup do 2. kola')
  })

  test('waiting (outlook null, nothing counted)', () => {
    expect(view(0, [cand(1, { status: 'waiting' })])).toEqual({ cls: 'waiting', chip: 'Čeká na sčítání', why: 'Sčítání zatím nezačalo.' })
  })

  test('older snapshot (no outlook field): status chip with the provisional marker, no reason', () => {
    const c = cand(1)
    delete c.outlook
    delete c.gap
    expect(view(40, [c])).toEqual({ cls: 'leading', chip: 'Vede · předběžně', why: '' })
  })

  test('mandate / out behind a majority (counted, Z = C → "Sečteno")', () => {
    const a = cand(1, { outlook: 'mandate', pct1: 52.34 })
    const b = cand(2, { outlook: 'out', gap: 1200, rank: 2, status: 'second' })
    expect(view(100, [a, b], 0)).toEqual({ cls: 'leading', chip: 'Sečteno: mandát', why: 'Má 52,3 % sečtených hlasů, tedy nad 50 %: 2. kolo by odpadlo.' })
    expect(view(100, [a, b], 1)).toEqual({ cls: 'behind', chip: 'Sečteno: bez postupu', why: 'Jiná kandidatura má nad 50 % sečtených hlasů.' })
  })

  test('advance: unique leader, second, tie for first; out: behind second, behind a tie', () => {
    const lead = cand(1, { outlook: 'advance', gap: 3602, pct1: 36.04 })
    const second = cand(2, { outlook: 'advance', gap: 1, rank: 2, status: 'second' })
    const out = cand(3, { outlook: 'out', gap: 2, rank: 3, status: 'behind' })
    expect(view(60, [lead, second, out], 0)).toEqual({ cls: 'second', chip: 'Předběžně: postup do 2. kola', why: 'Vede s 36,0 %, pod 50 %: do 2. kola jdou dvě kandidatury s nejvíce hlasy. Náskok 3 602 hlasy.' })
    expect(view(60, [lead, second, out], 1).why).toBe('Nikdo nemá přes 50 %. Ztráta na 1. místo: 1 hlas.')
    expect(view(60, [lead, second, out], 2)).toMatchObject({ cls: 'behind', chip: 'Předběžně: bez postupu', why: 'Ztráta na 2. místo: 2 hlasy.' })
    // tie for first
    const t1 = cand(1, { outlook: 'advance', gap: 0 })
    const t2 = cand(2, { outlook: 'advance', gap: 0 })
    const t3 = cand(3, { outlook: 'out', gap: 40, rank: 3, status: 'behind' })
    expect(view(60, [t1, t2, t3], 0).why).toBe('Shoda hlasů na 1. místě: do 2. kola jdou všechny kandidatury s nejvyšším počtem hlasů.')
    expect(view(60, [t1, t2, t3], 2).why).toBe('Ztráta na 1. místo (shoda): 40 hlasů.')
  })

  test('round 2: lead / trail / tie, prefix by the round-2 progress', () => {
    const o = (z, cs) => flat(outlookView({ n: 30, state: 'runoff-counting', decidedRound: 0, rounds: rounds(z, 0, true), candidates: cs }, cs[0]))
    const lead = cand(1, { outlook: 'lead', gap: 100, status: 'runoffLeading' })
    const trail = cand(2, { outlook: 'trail', gap: 100, rank: 2, status: 'runoffBehind' })
    expect(o(50, [lead, trail])).toEqual({ cls: 'leading', chip: 'Předběžně: vede 2. kolo', why: 'Náskok 100 hlasů.' })
    expect(o(100, [lead, trail]).chip).toBe('Sečteno: vede 2. kolo')
    expect(o(50, [trail, lead])).toEqual({ cls: 'behind', chip: 'Předběžně: zaostává ve 2. kole', why: 'Ztráta 100 hlasů.' })
    expect(o(100, [cand(1, { outlook: 'tie', gap: 0, status: 'runoffLeading' })])).toEqual({ cls: 'second', chip: 'Sečteno: shoda hlasů ve 2. kole', why: '' })
  })

  test('unknown outlook value falls back to the status chip', () => {
    expect(view(40, [cand(1, { outlook: 'wat' })]).chip).toBe('Vede · předběžně')
  })
})
