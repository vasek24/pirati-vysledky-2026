// Kontrola výstupu buildu mesta (spec §3.1): spouští se po
// `npx vite build -c vite.mesta.config.js` (viz scripts/mesta.sh build).
// Použití: node scripts/mesta-build-check.mjs [dist-dir]   (výchozí .cache/dist-mesta)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_DIST = '.cache/dist-mesta'
// Značka mesta v entry chunku: titulek záznamu v src/mesta/changelog.js.
const MARKER = 'Piráti ve městech'
// Texty, které musí zbýt po záplatách (src/mesta/patches.js), a texty Prahy, které nesmí.
const PATCHED_TEXTS = ['Kandidátka s Piráty', 'pražských výsledcích 2022', 'Ostatní města', 'Postaveno na kódu']
const FORBIDDEN_JS = [
  ['Záložní kopie originálu', 'Prague footer wording'],
  ['pirati-vysledky-2026-cloudflare.workers.dev', 'Prague tracker fallback link ({původní web})'],
  ['appdata/kv2026', 'direct ČSÚ URL in browser code'],
  ['data ČSÚ (volby.gov.cz)', "Prague Landing content (Landing page bundled)"],
]

const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8')

export function checkDist(dir) {
  const problems = []
  if (!existsSync(path.join(dir, 'index.html'))) return [`${dir}: index.html not found (run the mesta build first)`]

  const assets = existsSync(path.join(dir, 'assets')) ? readdirSync(path.join(dir, 'assets')) : []
  const jsFiles = assets.filter((f) => f.endsWith('.js'))
  const bundle = jsFiles.map((f) => read(dir, `assets/${f}`)).join('\n')

  // Prahy: žádný chunk Landing
  const landing = jsFiles.filter((f) => /^Landing-/.test(f))
  if (landing.length) problems.push(`Prague Landing chunk present: ${landing.join(', ')}`)
  if (!jsFiles.some((f) => /^MestaIndex-/.test(f))) problems.push('no MestaIndex-*.js chunk (mesta entry not bundled?)')

  // index.html: entry skript, titulek
  const html = read(dir, 'index.html')
  if (!html.includes(`<title>Volby 2026 · ${MARKER}</title>`)) problems.push(`index.html: title is not "Volby 2026 · ${MARKER}"`)
  const entry = /<script[^>]*type="module"[^>]*src="\/(assets\/[^"]+\.js)"/.exec(html)
  if (!entry) problems.push('index.html: no module entry script found')
  else if (!existsSync(path.join(dir, entry[1]))) problems.push(`index.html: entry ${entry[1]} missing`)
  else if (!read(dir, entry[1]).includes(MARKER)) problems.push(`entry chunk ${entry[1]} does not contain "${MARKER}"`)

  for (const text of ['Záložní kopie', 'spravuje tuto kopii']) if (html.includes(text)) problems.push(`index.html contains Prague wording "${text}"`)

  // mesta mají vlastní humans.txt / kontakt.txt (jméno + telefon správce)
  for (const f of ['humans.txt', 'kontakt.txt']) {
    const body = existsSync(path.join(dir, f)) ? read(dir, f) : ''
    if (!body.includes('Václav Vislous') || !body.includes('+420 777 954 389')) problems.push(`${f} missing or lacks the maintainer name and phone`)
  }

  // version.json
  let version = ''
  try {
    version = JSON.parse(read(dir, 'version.json')).version || ''
  } catch {
    problems.push('version.json missing or not JSON')
  }
  if (version) {
    if (!version.startsWith('mesta-')) problems.push(`version.json: version "${version}" does not start with "mesta-"`)
    else if (!bundle.includes(version.slice('mesta-'.length))) problems.push(`version.json: build id "${version.slice(6)}" is not in the bundle`)
  }

  for (const [text, why] of FORBIDDEN_JS) if (bundle.includes(text)) problems.push(`JS contains "${text}" (${why})`)
  for (const text of PATCHED_TEXTS) if (!bundle.includes(text)) problems.push(`JS lacks patched text "${text}" (patch not applied?)`)

  return problems
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || DEFAULT_DIST
  const problems = checkDist(dir)
  if (problems.length) {
    console.error(`mesta build check FAILED (${dir}):`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(`mesta build check OK (${dir})`)
}
