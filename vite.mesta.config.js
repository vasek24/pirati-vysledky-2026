// Build produktu „mesta“ (mesta.dg12.cz). Praha se nemění: tahle konfigurace
// bere vite.config.js jako základ a přidává přepínač modulů + záplaty (spec §3.1).
// Použití: `npx vite build -c vite.mesta.config.js` (nebo `bash scripts/mesta.sh build`).
// Výstup jde do .cache/dist-mesta (gitignorovaný, Tailwind ho neskenuje).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vite'
import base from './vite.config.js'
import { PATCHED_FILES, applyHtmlPatches, applyPatches } from './src/mesta/patches.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const abs = (rel) => path.join(ROOT, rel)
const clean = (id) => id.split('?')[0]

// Verze buildu = git sha + 6 hex z hashe tří datových souborů. Mění se s každým
// novým commitem i s každou změnou dat/přepisů, takže otevřené záložky se obnoví.
const DATA_FILES = ['src/mesta/towns.generated.json', 'src/mesta/specifics.generated.json', 'src/mesta/overrides.js']

function buildId() {
  let sha = 'nogit'
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // mimo git (export bez .git) — zůstane 'nogit'
  }
  const hash = createHash('sha256')
  for (const f of DATA_FILES) if (existsSync(abs(f))) hash.update(f).update(readFileSync(abs(f)))
  return `${sha}-${hash.digest('hex').slice(0, 6)}`
}

const BUILD = buildId()
export const MESTA_VERSION = `mesta-${BUILD}`

// (1) src/councils.js -> src/mesta/councils.js, src/changelog.js -> src/mesta/changelog.js
// pro VŠECHNY importéry (obě podoby '../councils' i '../councils.js'). Výjimka:
// src/mesta/councils.js sám re-exportuje konstanty z Prahy — ten dostane originál.
const SWAPS = new Map([
  [abs('src/councils.js'), abs('src/mesta/councils.js')],
  [abs('src/changelog.js'), abs('src/mesta/changelog.js')],
])

function swapModules() {
  return {
    name: 'mesta-swap-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      const target = resolved && SWAPS.get(clean(resolved.id))
      if (!target || clean(importer) === target) return null
      return target
    },
  }
}

// (2) Záplaty zdrojů Prahy. `enforce: 'pre'`: transform musí vidět JSX dřív než
// ho přeloží esbuild/oxc (jinak kotvy nesedí). HTML hook `order: 'pre'`: musí
// proběhnout dřív, než Vite zparsuje vstupní skript (jinak se zabalí main.jsx
// a Landing Prahy).
function mestaPatches() {
  const seen = new Set()
  return {
    name: 'mesta-patches',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const file = clean(id)
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (rel.startsWith('..') || !PATCHED_FILES.includes(rel)) return null
      seen.add(rel)
      return { code: applyPatches(rel, code), map: null }
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => applyHtmlPatches(html),
    },
    buildEnd(error) {
      if (error) return
      const missing = PATCHED_FILES.filter((f) => !seen.has(f))
      if (missing.length) this.error(`mesta patches: file(s) never reached the bundle, patches not applied: ${missing.join(', ')}`)
    },
  }
}

// (3) Vlastní version.json (základní plugin 'version-json' z Prahy je odfiltrovaný).
function mestaVersion() {
  return {
    name: 'mesta-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: MESTA_VERSION }) })
    },
  }
}

// (4) Sdílené statické soubory z public/ Prahy (publicDir je public-mesta): jen brand/.
//     humans.txt a kontakt.txt jsou vlastní, v public-mesta/ (správce všech tří přehledů).
const SHARED = ['brand'] // humans.txt a kontakt.txt jsou vlastní: public-mesta/

function* walk(rel) {
  const full = abs(path.join('public', rel))
  if (!existsSync(full)) return
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full).sort()) yield* walk(path.posix.join(rel, name))
  } else {
    yield rel
  }
}

function copyShared() {
  return {
    name: 'mesta-copy-shared',
    apply: 'build',
    generateBundle() {
      for (const entry of SHARED) {
        for (const rel of walk(entry)) {
          this.emitFile({ type: 'asset', fileName: rel, source: readFileSync(abs(path.join('public', rel))) })
        }
      }
    },
  }
}

const basePlugins = [base.plugins].flat(Infinity).filter((p) => p?.name !== 'version-json')

export default mergeConfig(
  { ...base, plugins: basePlugins },
  {
    publicDir: 'public-mesta',
    build: { outDir: '.cache/dist-mesta', emptyOutDir: true },
    define: { __MESTA_BUILD__: JSON.stringify(BUILD) },
    plugins: [swapModules(), mestaPatches(), mestaVersion(), copyShared()],
  },
)
