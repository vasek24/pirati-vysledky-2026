// Precinct (okrsek) batches of the Senate feed: parser + accumulator. Pure, no I/O, no imports from the
// production snapshot pipeline (xml.js is hashed into CODE_REV and must not change, so the TAG/ATTR
// approach is copied here).
//
// Batch shape (odata/okrsky/K{round}/vysledky_okrsky_NNNNN.xml):
//   <VYSLEDKY_OKRSKY DATUM_CAS_GENEROVANI>
//     <DAVKA DATUMVOLEB KOLO PORADI_DAVKY OKRSKY_DAVKA OKRSKY_CELKEM OKRSKY_ZPRAC/>
//     <OKRSEK CIS_OBEC CIS_OKRSEK CIS_OBVOD PORADI_ZPRAC DATUM_CAS_ZPRAC OPAKOVANE>
//       <UCAST_OKRSEK ZAPSANI_VOLICI VYDANE_OBALKY ODEVZDANE_OBALKY PLATNE_HLASY/>
//       <HLASY_OKRSEK PORADOVE_CISLO HLASY/> ...
//     </OKRSEK> ...
//   or <VYSLEDKY_OKRSKY><CHYBA KOD_CHYBY/></VYSLEDKY_OKRSKY> (a batch that does not exist).
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s) {
  return s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, name) => {
    if (name) return ENTITIES[name]
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16)
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m
  })
}

const TAG = /<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>|<\/([A-Za-z_][\w.-]*)\s*>/g
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function attrs(src) {
  const out = {}
  for (const m of src.matchAll(ATTR)) out[m[1]] = decode(m[2] ?? m[3])
  return out
}

const INT = /^\d+$/
function int(a, key, where, { required = true } = {}) {
  const v = a[key]
  if (v === undefined || v === '') {
    if (required) throw new Error(`${where}: missing ${key}`)
    return null
  }
  if (!INT.test(v)) throw new Error(`${where}: non-numeric ${key}="${v}"`)
  return Number(v)
}

/**
 * Parse one batch. Attribute-only, throws on anything unusable (not XML, wrong root, truncated,
 * unparsed elements, missing/non-numeric attributes, duplicate HLASY_OKRSEK, OKRSEK without UCAST_OKRSEK).
 * `obvody` (optional Set of numbers): OKRSEK elements of other obvody are validated by the element
 * count check but not materialised (a nationwide batch is mostly noise for the map).
 * Returns { chyba: code, generated } for a CHYBA batch, else
 * { generated, kolo, batch, okrskyDavka, okrskyCelkem, okrskyZprac, precincts: [{obec, okrsek, obvod, seq,
 *   repeated, voters, valid, votes: {no: hlasy}}] }.
 */
export function parseBatchXml(text, { obvody = null } = {}) {
  const src = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  let root = false
  let closed = false
  let generated = null
  let davka = null
  let chyba = null
  const precincts = []
  let cur = null // the OKRSEK being read (materialised or skipped)
  let curSkipped = false
  const raw = { OKRSEK: 0, UCAST_OKRSEK: 0, HLASY_OKRSEK: 0 }
  const parsed = { OKRSEK: 0, UCAST_OKRSEK: 0, HLASY_OKRSEK: 0 }

  for (const m of src.matchAll(TAG)) {
    const [, name, attrSrc, closing] = m
    if (closed) throw new Error('content after </VYSLEDKY_OKRSKY>')
    if (closing) {
      if (closing === 'OKRSEK') {
        if (!cur) throw new Error('unexpected </OKRSEK>')
        if (!cur.hasUcast) throw new Error(`OKRSEK ${cur.obec}/${cur.okrsek}: missing UCAST_OKRSEK`)
        if (!curSkipped) precincts.push(cur.p)
        cur = null
      } else if (closing === 'VYSLEDKY_OKRSKY') {
        closed = true
        if (src.slice(m.index + m[0].length).trim() !== '') throw new Error('content after </VYSLEDKY_OKRSKY>')
      }
      continue
    }
    if (!root) {
      if (name !== 'VYSLEDKY_OKRSKY') throw new Error(`root element is ${name}, not VYSLEDKY_OKRSKY`)
      root = true
      generated = attrs(attrSrc).DATUM_CAS_GENEROVANI
      if (!generated) throw new Error('missing DATUM_CAS_GENEROVANI')
      continue
    }
    const a = attrs(attrSrc)
    const selfClosed = /\/>$/.test(m[0])
    if (name === 'CHYBA') {
      chyba = int(a, 'KOD_CHYBY', 'CHYBA', { required: false })
      if (chyba === null) chyba = 0
    } else if (name === 'DAVKA') {
      if (davka) throw new Error('duplicate DAVKA')
      const kolo = int(a, 'KOLO', 'DAVKA')
      if (kolo !== 1 && kolo !== 2) throw new Error(`DAVKA: bad KOLO ${kolo}`)
      davka = {
        kolo,
        batch: int(a, 'PORADI_DAVKY', 'DAVKA'),
        okrskyDavka: int(a, 'OKRSKY_DAVKA', 'DAVKA'),
        okrskyCelkem: int(a, 'OKRSKY_CELKEM', 'DAVKA'),
        okrskyZprac: int(a, 'OKRSKY_ZPRAC', 'DAVKA'),
      }
    } else if (name === 'OKRSEK') {
      if (cur) throw new Error('nested OKRSEK')
      if (!davka) throw new Error('OKRSEK before DAVKA')
      const where = 'OKRSEK'
      const obec = int(a, 'CIS_OBEC', where)
      const okrsek = int(a, 'CIS_OKRSEK', where)
      const obvod = int(a, 'CIS_OBVOD', where)
      const seq = int(a, 'PORADI_ZPRAC', where)
      if (obvod < 1 || obvod > 81) throw new Error(`${where}: bad CIS_OBVOD ${obvod}`)
      parsed.OKRSEK++
      curSkipped = obvody !== null && !obvody.has(obvod)
      cur = { obec, okrsek, hasUcast: false, p: { obec, okrsek, obvod, seq, repeated: a.OPAKOVANE === '1' || a.OPAKOVANE === 'true', voters: 0, valid: 0, votes: {} } }
      if (selfClosed) throw new Error(`OKRSEK ${obec}/${okrsek}: empty`)
    } else if (name === 'UCAST_OKRSEK') {
      if (!cur) throw new Error('UCAST_OKRSEK outside OKRSEK')
      if (cur.hasUcast) throw new Error(`OKRSEK ${cur.obec}/${cur.okrsek}: duplicate UCAST_OKRSEK`)
      const where = `OKRSEK ${cur.obec}/${cur.okrsek} UCAST_OKRSEK`
      cur.p.voters = int(a, 'ZAPSANI_VOLICI', where)
      cur.p.valid = int(a, 'PLATNE_HLASY', where)
      cur.hasUcast = true
      parsed.UCAST_OKRSEK++
    } else if (name === 'HLASY_OKRSEK') {
      if (!cur) throw new Error('HLASY_OKRSEK outside OKRSEK')
      const where = `OKRSEK ${cur.obec}/${cur.okrsek} HLASY_OKRSEK`
      const no = int(a, 'PORADOVE_CISLO', where)
      const votes = int(a, 'HLASY', where)
      if (no in cur.p.votes) throw new Error(`${where}: duplicate PORADOVE_CISLO ${no}`)
      cur.p.votes[no] = votes
      parsed.HLASY_OKRSEK++
    }
  }
  if (!root) throw new Error('no VYSLEDKY_OKRSKY root element')
  if (!closed) throw new Error('truncated document (no </VYSLEDKY_OKRSKY>)')
  if (chyba !== null) return { chyba, generated }
  if (!davka) throw new Error('no DAVKA element')
  if (cur) throw new Error('unclosed OKRSEK')
  // every opening tag of these must have been understood (one the tag regexp could not match would vanish)
  for (const m of src.matchAll(/<(OKRSEK|UCAST_OKRSEK|HLASY_OKRSEK)(?![\w.:-])/g)) raw[m[1]]++
  if (raw.OKRSEK !== parsed.OKRSEK || raw.UCAST_OKRSEK !== parsed.UCAST_OKRSEK || raw.HLASY_OKRSEK !== parsed.HLASY_OKRSEK) {
    throw new Error(`unparsed elements: OKRSEK ${raw.OKRSEK}/${parsed.OKRSEK}, UCAST_OKRSEK ${raw.UCAST_OKRSEK}/${parsed.UCAST_OKRSEK}, HLASY_OKRSEK ${raw.HLASY_OKRSEK}/${parsed.HLASY_OKRSEK}`)
  }
  if (parsed.OKRSEK === 0) throw new Error('no OKRSEK elements')
  return { generated, ...davka, precincts }
}

// ---- manifest helpers --------------------------------------------------------------

/** Map obvod → Pirate ballot number for constituencies with a DIRECT Pirate ticket (relation 'ticket'). */
export function wantedOf(manifest) {
  const wanted = new Map()
  for (const e of manifest.PIRATE_BACKED) {
    if (e.relation !== 'ticket') continue
    if (!manifest.CANDIDATES[`${e.obvod}:${e.no}`]) throw new Error(`manifest: ticket candidate ${e.obvod}:${e.no} is not in CANDIDATES`)
    wanted.set(e.obvod, e.no)
  }
  return wanted
}

/** Ballot numbers of one obvod from the manifest, ascending. */
export function candsOf(manifest, obvod) {
  const out = []
  for (const key of Object.keys(manifest.CANDIDATES)) {
    const [o, no] = key.split(':').map(Number)
    if (o === obvod) out.push(no)
  }
  return out.sort((x, y) => x - y)
}

// ---- accumulator ----------------------------------------------------------------------
// State of one round: { lastBatch, applied, generated, precincts } where
//   precincts = { "obec:okrsek": [obvod, seq, voters, valid, votes {no: hlasy}] }  (compact, JSON-safe)
// Batches are applied IN ORDER; a precinct can be re-sent with a higher PORADI_ZPRAC (a running sequence
// over ALL precincts, not per precinct): the highest wins, an equal or lower one is ignored.
export const emptyRound = () => ({ lastBatch: 0, applied: 0, generated: null, precincts: {} })

export function applyBatch(round, parsed, wanted) {
  let added = 0
  let replaced = 0
  let ignored = 0
  for (const p of parsed.precincts) {
    if (!wanted.has(p.obvod)) {
      ignored++
      continue
    }
    const key = `${p.obec}:${p.okrsek}`
    const prev = round.precincts[key]
    if (prev && prev[1] >= p.seq) {
      ignored++
      continue
    }
    round.precincts[key] = [p.obvod, p.seq, p.voters, p.valid, p.votes]
    if (prev) replaced++
    else added++
  }
  round.applied += 1
  round.generated = parsed.generated
  return { added, replaced, ignored }
}

/** Precincts of one obvod as rows [obec, okrsek, voters, valid, ...votes aligned with cands]. ČSÚ omits candidates with 0 votes (verified on the 2024 batches), so a missing entry is 0. */
export function rowsFor(round, obvod, cands) {
  const rows = []
  for (const [key, [o, , voters, valid, votes]] of Object.entries(round.precincts)) {
    if (o !== obvod) continue
    const [obec, okrsek] = key.split(':').map(Number)
    rows.push([obec, okrsek, voters, valid, ...cands.map((no) => votes[no] ?? 0)])
  }
  return rows.sort((x, y) => x[0] - y[0] || x[1] - y[1])
}
