// Attribute-only parser for ČSÚ Senate results (odata/vysledky.xml). Throws on anything unusable.
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

const NUM = /^-?\d+(\.\d+)?$/
function num(a, key, required, where) {
  const v = a[key]
  if (v === undefined || v === '') {
    if (required) throw new Error(`${where}: missing ${key}`)
    return null
  }
  if (!NUM.test(v)) throw new Error(`${where}: non-numeric ${key}="${v}"`)
  return Number(v)
}
const opt = (v) => (v === undefined || v === '' ? null : v)

function ucast(a, where) {
  const kolo = num(a, 'KOLO', true, where)
  if (kolo !== 1 && kolo !== 2) throw new Error(`${where}: bad KOLO ${kolo}`)
  return {
    kolo,
    okrskyCelkem: num(a, 'OKRSKY_CELKEM', true, where),
    okrskyZprac: num(a, 'OKRSKY_ZPRAC', true, where),
    okrskyZpracProc: num(a, 'OKRSKY_ZPRAC_PROC', false, where),
    ucastProc: num(a, 'UCAST_PROC', false, where),
    platneHlasy: num(a, 'PLATNE_HLASY', true, where),
    zapsaniVolici: num(a, 'ZAPSANI_VOLICI', false, where),
    odevzdaneObalky: num(a, 'ODEVZDANE_OBALKY', false, where),
  }
}

function kandidat(a, where) {
  return {
    no: num(a, 'PORADOVE_CISLO', true, where),
    first: a.JMENO ?? '',
    last: a.PRIJMENI ?? '',
    pre: a.TITULPRED ?? '',
    post: a.TITULZA ?? '',
    votes1: num(a, 'HLASY_1KOLO', true, where),
    pct1: num(a, 'HLASY_PROC_1KOLO', true, where),
    st1: opt(a.ZVOLEN_1KOLO),
    votes2: num(a, 'HLASY_2KOLO', false, where),
    pct2: num(a, 'HLASY_PROC_2KOLO', false, where),
    st2: opt(a.ZVOLEN_2KOLO),
  }
}

export function parseResultsXml(text) {
  const src = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  let root = null
  let generated = null
  const obvody = []
  const country = {}
  let obvod = null
  let celkem = false
  let closed = false
  for (const m of src.matchAll(TAG)) {
    const [, name, attrSrc, closing] = m
    if (closing) {
      if (closing === 'OBVOD') obvod = null
      else if (closing === 'CELKEM') celkem = false
      else if (closing === 'VYSLEDKY') closed = true
      continue
    }
    if (root === null) {
      if (name !== 'VYSLEDKY') throw new Error(`root element is ${name}, not VYSLEDKY`)
      root = name
      generated = opt(attrs(attrSrc).DATUM_CAS_GENEROVANI)
      continue
    }
    if (name === 'CHYBA') throw new Error('upstream returned CHYBA')
    const a = attrs(attrSrc)
    if (name === 'OBVOD') {
      obvod = { n: num(a, 'CISLO', true, 'OBVOD'), name: a.NAZEV ?? '', candidates: [], ucast: {} }
      obvody.push(obvod)
      if (/\/>$/.test(m[0])) obvod = null
    } else if (name === 'CELKEM') {
      celkem = !/\/>$/.test(m[0])
    } else if (name === 'KANDIDAT' && obvod) {
      obvod.candidates.push(kandidat(a, `OBVOD ${obvod.n} KANDIDAT`))
    } else if (name === 'UCAST') {
      const target = obvod ? obvod.ucast : celkem ? country : null
      if (target) {
        const u = ucast(a, obvod ? `OBVOD ${obvod.n} UCAST` : 'CELKEM UCAST')
        target[u.kolo] = u
      }
    }
  }
  if (root === null) throw new Error('no VYSLEDKY root element')
  if (!closed) throw new Error('truncated document (no </VYSLEDKY>)')
  if (obvody.length === 0) throw new Error('no OBVOD elements')
  for (const o of obvody) {
    if (o.candidates.length === 0) throw new Error(`OBVOD ${o.n} without candidates`)
    if (!o.ucast[1]) throw new Error(`OBVOD ${o.n} without UCAST KOLO=1`)
  }
  return { generated, obvody, country }
}
