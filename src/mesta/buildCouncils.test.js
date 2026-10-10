import { existsSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import towns from './__fixtures__/towns.json'
import specifics from './__fixtures__/specifics.json'
import {
  TITLE_BY_DRUH,
  isShown,
  buildCouncils,
  deriveShards,
  deriveRegions,
} from './buildCouncils.js'

const NO_OVERRIDES = { reviewedAt: null, towns: {} }
const clone = (x) => JSON.parse(JSON.stringify(x))
const build = (overrides = NO_OVERRIDES) => buildCouncils(clone(towns), clone(specifics), overrides)
const bySlug = (list, slug) => list.find((c) => c.slug === slug)

describe('TITLE_BY_DRUH', () => {
  it('maps the DRUHZASTUP codes of whole municipalities', () => {
    expect(TITLE_BY_DRUH).toEqual({
      1: 'Zastupitelstvo obce',
      2: 'Zastupitelstvo města',
      3: 'Zastupitelstvo statutárního města',
      6: 'Zastupitelstvo městyse',
    })
  })
})

describe('isShown (spec 4.4 rule)', () => {
  const spec = (confidence) => ({ confidence })
  it('shows a high-confidence town', () => {
    expect(isShown(spec('high'), {}, null)).toBe(true)
    expect(isShown(spec('high'), undefined, null)).toBe(true)
  })
  it('hides a generator-low town until reviewedAt or its own reviewed:true', () => {
    expect(isShown(spec('low'), {}, null)).toBe(false)
    expect(isShown(spec('low'), {}, '2026-10-10T15:00:00Z')).toBe(true)
    expect(isShown(spec('low'), { reviewed: true }, null)).toBe(true)
  })
  it('keeps an override-low town hidden under reviewedAt and releases it only with reviewed:true', () => {
    expect(isShown(spec('high'), { confidence: 'low' }, null)).toBe(false)
    expect(isShown(spec('high'), { confidence: 'low' }, '2026-10-10T15:00:00Z')).toBe(false)
    expect(isShown(spec('low'), { confidence: 'low' }, '2026-10-10T15:00:00Z')).toBe(false)
    expect(isShown(spec('high'), { confidence: 'low', reviewed: true }, '2026-10-10T15:00:00Z')).toBe(true)
  })
  it('returns a strict boolean', () => {
    expect(isShown(spec('low'), {}, 'x')).toBe(true)
    expect(isShown(spec('high'), { confidence: 'low' }, 'x')).toBe(false)
  })
})

describe('buildCouncils', () => {
  it('returns every town (shown or not), in input order', () => {
    expect(build().map((c) => c.slug)).toEqual(['plzen', 'skrytov', 'sokolov', 'jablonec-nad-nisou', 'hradec-kralove'])
  })

  it('builds Plzeň: type a, Pirate list 11, title, no map/precinct files', () => {
    const c = bySlug(build(), 'plzen')
    expect(c).toMatchObject({
      slug: 'plzen',
      name: 'Plzeň',
      title: 'Zastupitelstvo statutárního města Plzeň',
      zastup: 554791,
      okres: 3203,
      kraj: 3200,
      krajName: 'Plzeňský kraj',
      shard: '32-1',
      featured: 'top-1',
      population: 187863,
      seats: 47,
      precincts: 174,
      pirates: 11,
      pirateCandidates: [],
      confidence: 'high',
      shown: true,
      map: false,
      precinctFiles: false,
      beta: false,
      candidatePhotos: false,
      magistrat: false,
      coalition: null,
      lists: {},
      photos: {},
    })
    expect(c.arrangement.type).toBe('a')
    expect(c.arrangement.list.id).toBe(11)
  })

  it('builds a coalition and an association (list id = pirates)', () => {
    const all = build()
    expect(bySlug(all, 'hradec-kralove')).toMatchObject({ pirates: 4, shown: true })
    expect(bySlug(all, 'hradec-kralove').arrangement.list.kind).toBe('coalition')
    expect(bySlug(all, 'jablonec-nad-nisou')).toMatchObject({ pirates: 4, shown: true })
    expect(bySlug(all, 'jablonec-nad-nisou').arrangement.list).toMatchObject({ kind: 'association', independents: true })
  })

  it('builds forced Sokolov (type c): no own list, candidates from others', () => {
    const c = bySlug(build(), 'sokolov')
    expect(c.title).toBe('Zastupitelstvo města Sokolov')
    expect(c.pirates).toBeNull()
    expect(c.pirateCandidates).toEqual([{ list: 7, n: 5, name: 'Lukáš Zykán' }])
    expect(c.arrangement.type).toBe('c')
  })

  it('does not mutate its inputs', () => {
    const t = clone(towns)
    const s = clone(specifics)
    const o = { reviewedAt: null, towns: { 554791: { name: 'Plzeň', lists: { 11: { tiny: 'X' } } } } }
    const o0 = clone(o)
    buildCouncils(t, s, o)
    expect(t).toEqual(towns)
    expect(s).toEqual(specifics)
    expect(o).toEqual(o0)
  })

  it('throws on a town without a specifics row or with an unmapped druh', () => {
    expect(() => buildCouncils(clone(towns), clone(specifics).slice(1), NO_OVERRIDES)).toThrow(/554791/)
    const t = clone(towns)
    t[0].druh = 5
    expect(() => buildCouncils(t, clone(specifics), NO_OVERRIDES)).toThrow(/druh/)
  })

  it('throws on a shard id that does not belong to the kraj', () => {
    const t = clone(towns)
    t[0].shard = '21-1'
    expect(() => buildCouncils(t, clone(specifics), NO_OVERRIDES)).toThrow(/shard/)
  })

  describe('overrides', () => {
    it('merges override lists per id', () => {
      const c = bySlug(
        build({ reviewedAt: null, towns: { 569810: { name: 'Hradec Králové', lists: { 4: { tiny: 'Piráti+STAN', color: '#000000' }, 2: { short: 'ANO' } } } } }),
        'hradec-kralove',
      )
      expect(c.lists).toEqual({ 4: { tiny: 'Piráti+STAN', color: '#000000' }, 2: { short: 'ANO' } })
    })

    it('override list.id changes pirates (pirates is never set directly)', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 554791: { name: 'Plzeň', list: { id: 9, note: 'x' } } } }), 'plzen')
      expect(c.pirates).toBe(9)
      expect(c.arrangement.list).toMatchObject({ id: 9, name: 'Česká pirátská strana', kind: 'party' })
    })

    it('ignores a direct pirates key', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 554791: { name: 'Plzeň', pirates: 99 } } }), 'plzen')
      expect(c.pirates).toBe(11)
    })

    it('override list short/kind/partners merge into the generated list', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 569810: { name: 'Hradec Králové', list: { short8: 'Piráti+STAN', partners: [{ code: 166, short: 'STAN' }, { code: 1, short: 'KDU' }] } } } }), 'hradec-kralove')
      expect(c.arrangement.list.short8).toBe('Piráti+STAN')
      expect(c.arrangement.list.partners).toHaveLength(2)
      expect(c.arrangement.list.id).toBe(4)
    })

    it('override list:null clears the Pirate list', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 554791: { name: 'Plzeň', type: 'd', list: null, note: 'x' } } }), 'plzen')
      expect(c.pirates).toBeNull()
      expect(c.arrangement.type).toBe('d')
    })

    it('override pirateCandidates replaces the derived ones; title is overridable', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 560286: { name: 'Sokolov', title: 'Zastupitelstvo města Sokolova', pirateCandidates: [{ list: 7, n: 6, name: 'Jiný Člen' }], note: 'x' } } }), 'sokolov')
      expect(c.title).toBe('Zastupitelstvo města Sokolova')
      expect(c.pirateCandidates).toEqual([{ list: 7, n: 6, name: 'Jiný Člen' }])
    })

    it('override type is applied to the arrangement', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 563510: { name: 'Jablonec nad Nisou', type: 'a', reason: 'x' } } }), 'jablonec-nad-nisou')
      expect(c.arrangement.type).toBe('a')
    })

    const withOv = (zastup, name, o) => build({ reviewedAt: null, towns: { [zastup]: { name, ...o } } })

    it('type d override forces list null and pirates null (Plzeň)', () => {
      const c = bySlug(withOv(554791, 'Plzeň', { type: 'd', note: 'x' }), 'plzen')
      expect(c).toMatchObject({ shown: true, pirates: null, pirateCandidates: [] })
      expect(c.arrangement).toMatchObject({ type: 'd', list: null })
    })

    it('type c override forces list null and pirates null (Hradec Králové)', () => {
      const c = bySlug(withOv(569810, 'Hradec Králové', { type: 'c', note: 'x' }), 'hradec-kralove')
      expect(c).toMatchObject({ shown: true, pirates: null, pirateCandidates: [] })
      expect(c.arrangement).toMatchObject({ type: 'c', list: null })
    })

    it('type c override keeps candidates derived from others', () => {
      const s = clone(specifics)
      s.find((x) => x.zastup === 569810).others = [{ list: 2, listName: 'X', n: 4, name: 'Jan Cizí', nominatedBy: 'STAN' }]
      const ovr = { reviewedAt: null, towns: { 569810: { name: 'Hradec Králové', type: 'c', note: 'x' } } }
      const c = bySlug(buildCouncils(clone(towns), s, ovr), 'hradec-kralove')
      expect(c.pirateCandidates).toEqual([{ list: 2, n: 4, name: 'Jan Cizí' }])
    })

    it('type d forces derived pirateCandidates [] even with non-empty others', () => {
      const s = clone(specifics)
      s.find((x) => x.zastup === 560286).type = 'd'
      const c = bySlug(buildCouncils(clone(towns), s, NO_OVERRIDES), 'sokolov')
      expect(c.arrangement.others).toHaveLength(1)
      expect(c).toMatchObject({ pirates: null, pirateCandidates: [] })
      const c2 = bySlug(withOv(560286, 'Sokolov', { type: 'd', note: 'x' }), 'sokolov')
      expect(c2).toMatchObject({ pirates: null, pirateCandidates: [] })
    })

    it('throws when an override sets pirateCandidates on a type d town', () => {
      expect(() => withOv(560286, 'Sokolov', { type: 'd', pirateCandidates: [{ list: 7, n: 5, name: 'X' }], note: 'x' })).toThrow(/pirateCandidates/)
      expect(() => withOv(554791, 'Plzeň', { type: 'd', pirateCandidates: [{ list: 1, n: 1, name: 'X' }], note: 'x' })).toThrow(/pirateCandidates/)
    })

    it('throws when the effective type is a/b and there is no list', () => {
      expect(() => withOv(554791, 'Plzeň', { list: null, note: 'x' })).toThrow(/list/)
      expect(() => withOv(560286, 'Sokolov', { type: 'b', reason: 'x' })).toThrow(/list/)
      const s = clone(specifics)
      s.find((x) => x.zastup === 554791).list = null
      expect(() => buildCouncils(clone(towns), s, NO_OVERRIDES)).toThrow(/list/)
    })

    it('throws when an override name differs from the town name (typo guard)', () => {
      expect(() => withOv(554791, 'Skrytov', { note: 'x' })).toThrow(/name/)
      expect(() => withOv(999001, 'Plzeň', { note: 'x' })).toThrow(/name/)
    })

    it('allows overrides keyed by a zastup that matches no town (excluded towns)', () => {
      expect(() => withOv(555088, 'Havířov', { include: false, reason: 'x' })).not.toThrow()
    })

    it('arrangement.note carries the override note for shown towns', () => {
      expect(bySlug(withOv(554791, 'Plzeň', { note: 'Ověřeno ručně' }), 'plzen').arrangement.note).toBe('Ověřeno ručně')
      expect(bySlug(build(), 'plzen').arrangement.note).toBeUndefined()
    })
  })

  describe('H1: hidden towns', () => {
    it('strips the arrangement of a hidden town but keeps its shape', () => {
      const a = bySlug(build(), 'skrytov').arrangement
      expect(a).toEqual({ type: 'b', list: null, members: [], others: [], flags: ['borderline-auto'] })
      expect(a.note).toBeUndefined()
    })

    it('strips an override-low town and does not leak the override note', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 554791: { name: 'Plzeň', confidence: 'low', note: 'interní' } } }), 'plzen')
      expect(c.arrangement).toMatchObject({ type: 'a', list: null, members: [], others: [] })
      expect(c.arrangement.note).toBeUndefined()
    })

    it('generator-low town without review: not shown, pirates null, candidates []', () => {
      const c = bySlug(build(), 'skrytov')
      expect(c).toMatchObject({ shown: false, pirates: null, pirateCandidates: [], confidence: 'low' })
    })

    it('generator-low town with others stays neutral when hidden', () => {
      const s = clone(specifics)
      const sk = s.find((x) => x.zastup === 999001)
      sk.others = [{ list: 5, listName: 'X', n: 3, name: 'Jan Cizí', nominatedBy: 'STAN' }]
      const c = bySlug(buildCouncils(clone(towns), s, NO_OVERRIDES), 'skrytov')
      expect(c.pirateCandidates).toEqual([])
      expect(c.pirates).toBeNull()
    })

    it('a hidden town is neutral even when an override carries pirateCandidates/list', () => {
      const c = bySlug(
        build({ reviewedAt: null, towns: { 999001: { name: 'Skrytov', list: { id: 8 }, pirateCandidates: [{ list: 1, n: 1, name: 'A' }], note: 'x' } } }),
        'skrytov',
      )
      expect(c).toMatchObject({ shown: false, pirates: null, pirateCandidates: [] })
    })

    it('generator-low town + global reviewedAt: shown with real attribution', () => {
      const c = bySlug(build({ reviewedAt: '2026-10-10T15:00:00Z', towns: {} }), 'skrytov')
      expect(c).toMatchObject({ shown: true, pirates: 3 })
    })

    it('generator-low town + own reviewed:true: shown', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 999001: { name: 'Skrytov', reviewed: true } } }), 'skrytov')
      expect(c).toMatchObject({ shown: true, pirates: 3 })
    })

    it('override confidence:low + reviewedAt: still hidden, neutral', () => {
      const c = bySlug(build({ reviewedAt: '2026-10-10T15:00:00Z', towns: { 554791: { name: 'Plzeň', confidence: 'low', note: 'Codex' } } }), 'plzen')
      expect(c).toMatchObject({ shown: false, pirates: null, pirateCandidates: [], confidence: 'low' })
    })

    it('override confidence:low + own reviewed:true: shown', () => {
      const c = bySlug(build({ reviewedAt: '2026-10-10T15:00:00Z', towns: { 554791: { name: 'Plzeň', confidence: 'low', note: 'Codex', reviewed: true } } }), 'plzen')
      expect(c).toMatchObject({ shown: true, pirates: 11 })
    })

    it('override-low type c town is neutral (candidates leak path)', () => {
      const c = bySlug(build({ reviewedAt: null, towns: { 560286: { name: 'Sokolov', confidence: 'low', note: 'x' } } }), 'sokolov')
      expect(c).toMatchObject({ shown: false, pirates: null, pirateCandidates: [] })
    })
  })
})

describe('deriveShards', () => {
  it('derives region shards (kraj order) then top-1 / top-2, hidden towns included', () => {
    const shards = deriveShards(build())
    expect(shards.map((s) => s.id)).toEqual(['32-1', '41-1', '51-1', '52-1', 'top-1', 'top-2'])
    expect(shards[0]).toEqual({ id: '32-1', kind: 'region', kraj: 3200, name: 'Plzeňský kraj', zastups: [554791, 999001] })
    expect(shards.find((s) => s.id === 'top-1')).toEqual({ id: 'top-1', kind: 'featured', kraj: null, name: 'Největší města', zastups: [554791] })
    expect(shards.find((s) => s.id === 'top-2').zastups).toEqual([569810])
  })

  it('keeps the hidden town in its region shard', () => {
    expect(deriveShards(build()).find((s) => s.id === '32-1').zastups).toContain(999001)
  })

  it('does not re-shard when a hidden town is released', () => {
    const hidden = deriveShards(build())
    const released = deriveShards(build({ reviewedAt: '2026-10-10T15:00:00Z', towns: {} }))
    expect(released).toEqual(hidden)
  })

  it('orders several shards of one region by index and featured members by population', () => {
    const all = build()
    const extra = { ...clone(all[1]), slug: 'druhy', zastup: 999002, shard: '32-2', featured: 'top-1', population: 300000 }
    const shards = deriveShards([...all, extra])
    expect(shards.map((s) => s.id).slice(0, 2)).toEqual(['32-1', '32-2'])
    expect(shards.find((s) => s.id === 'top-1').zastups).toEqual([999002, 554791])
  })

  it('produces no featured shards when no town is featured', () => {
    const shards = deriveShards(build().map((c) => ({ ...c, featured: null })))
    expect(shards.every((s) => s.kind === 'region')).toBe(true)
  })

  it('rejects a malformed featured value', () => {
    const all = build()
    all[0].featured = 'top'
    expect(() => deriveShards(all)).toThrow(/featured/)
  })
})

describe('deriveRegions', () => {
  it('is ordered by kraj with shard ids and zastups', () => {
    const all = build().filter((c) => c.shown)
    expect(deriveRegions(all)).toEqual([
      { kraj: 3200, name: 'Plzeňský kraj', shardIds: ['32-1'], zastups: [554791] },
      { kraj: 4100, name: 'Karlovarský kraj', shardIds: ['41-1'], zastups: [560286] },
      { kraj: 5100, name: 'Liberecký kraj', shardIds: ['51-1'], zastups: [563510] },
      { kraj: 5200, name: 'Královéhradecký kraj', shardIds: ['52-1'], zastups: [569810] },
    ])
  })

  it('is ordered by kraj even when the input is not', () => {
    const all = build().filter((c) => c.shown).reverse()
    expect(deriveRegions(all).map((r) => r.kraj)).toEqual([3200, 4100, 5100, 5200])
  })

  it('lists every shard of a multi-shard region once, in order', () => {
    const all = build()
    const extra = { ...clone(all[0]), slug: 'druhy', zastup: 999002, shard: '32-2' }
    const r = deriveRegions([extra, ...all.filter((c) => c.shown)])[0]
    expect(r.shardIds).toEqual(['32-1', '32-2'])
    expect(r.zastups).toEqual([999002, 554791])
  })
})

// councils.js wiring: the Prague module API plus the mesta additions, with the leak
// paths checked on every export. The data modules are mocked so these tests do not
// depend on the real generated files.
describe('councils.js exports contract and hidden-town gate', () => {
  const load = async (overrides = NO_OVERRIDES) => {
    vi.resetModules()
    vi.doMock('./towns.generated.json', () => ({ default: clone(towns) }))
    vi.doMock('./specifics.generated.json', () => ({ default: clone(specifics) }))
    vi.doMock('./overrides.js', () => ({ default: overrides }))
    return import('./councils.js')
  }
  const HIDDEN = { slug: 'skrytov', zastup: 999001 }

  beforeEach(() => {
    vi.resetModules()
  })

  it('exports the Prague API and the mesta additions', async () => {
    const m = await load()
    expect(Object.keys(m).sort()).toEqual(
      [
        'ALL_COUNCILS', 'COUNCILS', 'KV_BASE_URL', 'KV_DATE', 'PIRATES_CODE', 'POLLS_CLOSE', 'REGIONS', 'SHARDS',
        'allCouncilByZastup', 'councilBySlug', 'councilByZastup', 'majorityOf',
      ].sort(),
    )
    for (const k of ['COUNCILS', 'ALL_COUNCILS', 'SHARDS', 'REGIONS']) expect(Array.isArray(m[k])).toBe(true)
    for (const k of ['councilBySlug', 'councilByZastup', 'allCouncilByZastup', 'majorityOf']) expect(typeof m[k]).toBe('function')
  })

  it('re-exports the Prague constants unchanged', async () => {
    const m = await load()
    const prague = await import('../councils.js')
    expect(m.KV_DATE).toBe(prague.KV_DATE)
    expect(m.KV_BASE_URL).toBe(prague.KV_BASE_URL)
    expect(m.POLLS_CLOSE).toBe(prague.POLLS_CLOSE)
    expect(m.PIRATES_CODE).toBe(prague.PIRATES_CODE)
    expect(m.majorityOf).toBe(prague.majorityOf)
    expect(m.majorityOf(47)).toBe(24)
  })

  it('looks towns up like Prague (null when unknown, Number() on zastup)', async () => {
    const m = await load()
    expect(m.councilBySlug('plzen').zastup).toBe(554791)
    expect(m.councilBySlug('praha-1')).toBeNull()
    expect(m.councilByZastup('554791').slug).toBe('plzen')
    expect(m.councilByZastup(1)).toBeNull()
    expect(m.allCouncilByZastup('554791').slug).toBe('plzen')
  })

  describe('leak paths of a hidden town', () => {
    it('is absent from COUNCILS', async () => {
      const m = await load()
      expect(m.COUNCILS.map((c) => c.slug)).toEqual(['plzen', 'sokolov', 'jablonec-nad-nisou', 'hradec-kralove'])
      expect(m.COUNCILS.every((c) => c.shown)).toBe(true)
    })
    it('is absent from councilBySlug', async () => {
      const m = await load()
      expect(m.councilBySlug(HIDDEN.slug)).toBeNull()
    })
    it('is absent from councilByZastup (number and string)', async () => {
      const m = await load()
      expect(m.councilByZastup(HIDDEN.zastup)).toBeNull()
      expect(m.councilByZastup(String(HIDDEN.zastup))).toBeNull()
    })
    it('is present, neutral, in ALL_COUNCILS and allCouncilByZastup', async () => {
      const m = await load()
      const a = m.ALL_COUNCILS.find((c) => c.slug === HIDDEN.slug)
      expect(a).toMatchObject({ shown: false, pirates: null, pirateCandidates: [] })
      expect(m.allCouncilByZastup(HIDDEN.zastup)).toBe(a)
      expect(m.allCouncilByZastup(String(HIDDEN.zastup))).toBe(a)
    })
    it('is a member of SHARDS (never re-sharded) but not of REGIONS', async () => {
      const m = await load()
      expect(m.SHARDS.find((s) => s.id === '32-1').zastups).toContain(HIDDEN.zastup)
      expect(m.REGIONS.flatMap((r) => r.zastups)).not.toContain(HIDDEN.zastup)
      expect(m.REGIONS.find((r) => r.kraj === 3200).zastups).toEqual([554791])
    })
    it('SHARDS cover ALL_COUNCILS exactly once per region shard', async () => {
      const m = await load()
      const inRegions = m.SHARDS.filter((s) => s.kind === 'region').flatMap((s) => s.zastups).sort()
      expect(inRegions).toEqual(m.ALL_COUNCILS.map((c) => c.zastup).sort())
    })
    it('global reviewedAt releases a generator-low town everywhere, without re-sharding', async () => {
      const before = await load()
      const shardsBefore = before.SHARDS
      const m = await load({ reviewedAt: '2026-10-10T15:00:00Z', towns: {} })
      expect(m.councilBySlug(HIDDEN.slug)).toMatchObject({ pirates: 3, shown: true })
      expect(m.councilByZastup(HIDDEN.zastup).slug).toBe(HIDDEN.slug)
      expect(m.REGIONS.find((r) => r.kraj === 3200).zastups).toEqual([554791, 999001])
      expect(m.SHARDS).toEqual(shardsBefore)
    })
    it('global reviewedAt does not release an override-low town', async () => {
      const m = await load({ reviewedAt: '2026-10-10T15:00:00Z', towns: { 554791: { name: 'Plzeň', confidence: 'low', note: 'Codex' } } })
      expect(m.councilBySlug('plzen')).toBeNull()
      expect(m.councilByZastup(554791)).toBeNull()
      expect(m.COUNCILS.map((c) => c.slug)).not.toContain('plzen')
      expect(m.allCouncilByZastup(554791)).toMatchObject({ shown: false, pirates: null, pirateCandidates: [] })
      expect(m.REGIONS.flatMap((r) => r.zastups)).not.toContain(554791)
      expect(m.SHARDS.find((s) => s.id === 'top-1').zastups).toEqual([554791])
    })
    it('own reviewed:true releases an override-low town', async () => {
      const m = await load({ reviewedAt: null, towns: { 554791: { name: 'Plzeň', confidence: 'low', note: 'Codex', reviewed: true } } })
      expect(m.councilBySlug('plzen')).toMatchObject({ pirates: 11, shown: true })
    })
  })
})

// Invariants of the real generated data. Runs once T1a's files are on the branch.
const HAS_REAL_DATA = ['towns.generated.json', 'specifics.generated.json', 'overrides.js'].every((f) =>
  existsSync(new URL(f, import.meta.url)),
)
describe('real generated data', () => {
  it.skipIf(!HAS_REAL_DATA)('has a consistent council set', async () => {
    vi.resetModules()
    vi.doUnmock('./towns.generated.json')
    vi.doUnmock('./specifics.generated.json')
    vi.doUnmock('./overrides.js')
    const m = await import('./councils.js')
    const slugs = m.ALL_COUNCILS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(m.ALL_COUNCILS.map((c) => c.zastup)).size).toBe(slugs.length)
    for (const c of m.ALL_COUNCILS) {
      if (!c.shown) expect([c.pirates, c.pirateCandidates]).toEqual([null, []])
      expect(m.SHARDS.some((s) => s.kind === 'region' && s.zastups.includes(c.zastup))).toBe(true)
    }
    expect(m.COUNCILS).toEqual(m.ALL_COUNCILS.filter((c) => c.shown))
  })

  it.skipIf(!HAS_REAL_DATA)('keeps hidden towns out of REGIONS and shard ids consistent', async () => {
    vi.resetModules()
    vi.doUnmock('./towns.generated.json')
    vi.doUnmock('./specifics.generated.json')
    vi.doUnmock('./overrides.js')
    const m = await import('./councils.js')
    const inRegions = new Set(m.REGIONS.flatMap((r) => r.zastups))
    for (const c of m.ALL_COUNCILS) {
      if (!c.shown) expect(inRegions.has(c.zastup)).toBe(false)
      expect(c.shard).toMatch(/^\d{2}-\d+$/)
      expect(Number(c.shard.split('-')[0])).toBe(c.kraj / 100)
      if (c.shown && ['c', 'd'].includes(c.arrangement.type)) expect(c.pirates).toBeNull()
    }
    for (const s of m.SHARDS.filter((x) => x.kind === 'region')) expect(s.id).toMatch(/^\d{2}-\d+$/)
  })
})
