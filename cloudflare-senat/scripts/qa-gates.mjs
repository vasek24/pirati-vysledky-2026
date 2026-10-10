#!/usr/bin/env node
// Release gates for the Senate product. Run from anywhere after `npm run build:senat`:
//   node cloudflare-senat/scripts/qa-gates.mjs [--skip-wrangler] [--json]     (env SENAT_DIST=<dir> checks another build)
// Exit 1 when any gate FAILs (WARN is informational). No dependencies, no network, no deploy
// (the two wrangler runs are --dry-run: they bundle and validate, upload nothing).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIST = process.env.SENAT_DIST || join(ROOT, 'senat/dist') // SENAT_DIST: check another build output
const WORKER_DIR = join(ROOT, 'cloudflare-senat')
export const ACCOUNT_ID = '741febb7a315a409b83e5a9a1b62954d'
export const BUDGET = { jsGzipKB: 120, cssGzipKB: 20 }
const FORBIDDEN_ROOT = ['cloudflare/', 'src/', 'public/', 'api/', 'index.html', 'vitest.config.js', '.github/']
const ALLOWED_ROOT = ['package.json', 'eslint.config.js']

// ---- pure helpers (unit-tested in qa-gates.test.js) -----------------------------------------------

// Remove // and /* */ comments outside strings and trailing commas; tolerant, not a validator.
export function stripJsonc(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}
export const parseJsonc = (text) => JSON.parse(stripJsonc(text))

export const gzipKB = (buf) => gzipSync(buf, { level: 9 }).length / 1024

export function parseSecurityTxt(text, now = Date.now()) {
  const problems = []
  const field = (name) => text.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim()
  const contact = field('Contact')
  const expires = field('Expires')
  if (!contact || !/^tel:\+?\d[\d\s-]{7,}$/.test(contact)) problems.push(`Contact is not a tel: URI (${contact ?? 'missing'})`)
  const ms = Date.parse(expires ?? '')
  if (!Number.isFinite(ms)) problems.push(`Expires missing or unparsable (${expires ?? 'missing'})`)
  else if (ms <= now) problems.push(`Expires is in the past (${expires})`)
  return problems
}

// Cloudflare Workers Assets `_headers`: unindented line = path pattern, indented `Name: value` = header
export function parseHeadersFile(text) {
  const rules = []
  const problems = []
  let cur = null
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim() || line.trim().startsWith('#')) return
    if (line.length > 2000) problems.push(`line ${idx + 1} longer than 2000 characters`)
    if (/^\s/.test(line)) {
      const m = /^\s+(!\s*)?([A-Za-z][\w-]*)(?::\s*(.*))?$/.exec(line)
      if (!cur) problems.push(`line ${idx + 1}: header before any path`)
      else if (!m) problems.push(`line ${idx + 1}: not a header line`)
      else if (!m[1] && !m[3]) problems.push(`line ${idx + 1}: header ${m[2]} has no value`)
      else cur.headers.push({ name: m[2], value: m[3] ?? '', detach: Boolean(m[1]) })
    } else {
      if (!/^(\/|https:\/\/)/.test(line)) problems.push(`line ${idx + 1}: path must start with / or https://`)
      cur = { pattern: line, headers: [] }
      rules.push(cur)
    }
  })
  if (rules.length > 100) problems.push(`${rules.length} rules (limit 100)`)
  return { rules, problems }
}

export function parseCsp(value) {
  const out = {}
  for (const part of value.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/)
    if (name) out[name.toLowerCase()] = vals
  }
  return out
}

const hostOf = (u) => { try { return new URL(u).origin } catch { return null } }

// The CSP in `_headers` must (a) carry the directives we rely on and (b) allow everything index.html loads.
export function checkCsp(headersText, html) {
  const problems = []
  const { rules, problems: syntax } = parseHeadersFile(headersText)
  problems.push(...syntax)
  const all = rules.find((r) => r.pattern === '/*')
  const cspRaw = all?.headers.find((h) => h.name.toLowerCase() === 'content-security-policy')?.value
  if (!cspRaw) return [...problems, 'no Content-Security-Policy under /*']
  const csp = parseCsp(cspRaw)
  const want = {
    'default-src': ["'none'", "'self'"], 'script-src': ["'self'"], 'connect-src': ["'self'"],
    'base-uri': ["'none'"], 'form-action': ["'none'"], 'object-src': ["'none'"], 'frame-ancestors': ["'none'"],
  }
  for (const [d, any] of Object.entries(want)) {
    if (!csp[d]) problems.push(`CSP lacks ${d}`)
    else if (!any.some((v) => csp[d].includes(v))) problems.push(`CSP ${d} is ${csp[d].join(' ')}, expected one of ${any.join(' ')}`)
  }
  if (csp['script-src']?.some((v) => /unsafe-inline|unsafe-eval|\*/.test(v))) problems.push("CSP script-src must not contain 'unsafe-inline', 'unsafe-eval' or *")
  const allows = (directive, origin) => (csp[directive] ?? csp['default-src'] ?? []).includes(origin)
  // scripts
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc=["']([^"']+)["']/.exec(m[1])?.[1]
    if (!src && m[2].trim() && m[1].indexOf('application/ld+json') === -1) problems.push('index.html has an inline <script> (blocked by script-src)')
    if (src && /^https?:/.test(src) && !allows('script-src', hostOf(src))) problems.push(`script ${src} not allowed by script-src`)
  }
  // stylesheets and fonts
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const href = /\bhref=["']([^"']+)["']/.exec(m[1])?.[1]
    if (href && /^https?:/.test(href) && /rel=["']stylesheet["']/i.test(m[1]) && !allows('style-src', hostOf(href))) problems.push(`stylesheet ${href} not allowed by style-src`)
  }
  const bodyNoNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '')
  if (/<style\b|\sstyle=/i.test(bodyNoNoscript) && !csp['style-src']?.includes("'unsafe-inline'")) problems.push("index.html has inline styles but style-src lacks 'unsafe-inline'")
  if (/fonts\.googleapis\.com/.test(html) && !allows('font-src', 'https://fonts.gstatic.com')) problems.push('Google Fonts stylesheet used but font-src lacks https://fonts.gstatic.com')
  return problems
}

export function checkWrangler(cfg) {
  const p = []
  const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`${label}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`) }
  const staging = cfg.env?.staging
  eq('name', cfg.name, 'pirati-senat-zaloha')
  eq('env.staging.name', staging?.name, 'pirati-senat-zaloha-staging')
  eq('account_id', cfg.account_id, ACCOUNT_ID)
  if (staging?.account_id !== undefined) eq('env.staging.account_id', staging.account_id, ACCOUNT_ID)
  eq('main', cfg.main, 'src/worker.js')
  const prodRoutes = cfg.routes ?? []
  if (!prodRoutes.some((r) => r.pattern === 'senat.dg12.cz' && r.custom_domain === true)) p.push('routes lacks {pattern: "senat.dg12.cz", custom_domain: true}')
  const other = prodRoutes.filter((r) => r.pattern !== 'senat.dg12.cz').map((r) => r.pattern)
  if (other.length) p.push(`routes touch other hosts: ${other.join(', ')}`)
  eq('env.staging.routes', staging?.routes, [])
  eq('env.staging.triggers.crons', staging?.triggers?.crons, [])
  eq('workers_dev (production)', cfg.workers_dev, false)
  eq('env.staging.workers_dev', staging?.workers_dev, true)
  eq('assets.directory', cfg.assets?.directory, '../senat/dist')
  eq('env.staging.assets.directory', staging?.assets?.directory, '../senat/dist')
  eq('durable object', cfg.durable_objects?.bindings, [{ name: 'SENAT_FEED', class_name: 'SenatFeed' }])
  for (const [label, scope] of [['top level', cfg], ['env.staging', staging ?? {}]]) {
    for (const key of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'secrets', 'queues', 'services', 'hyperdrive', 'ai']) {
      if (scope[key] !== undefined) p.push(`${label}: unexpected ${key}`)
    }
    for (const [k, v] of Object.entries(scope.vars ?? {})) {
      if (!['CSU_BASE', 'POLLS_CLOSE_R2'].includes(k)) p.push(`${label}: unexpected var ${k}`)
      if (/token|secret|key|passw/i.test(k) || /^[A-Za-z0-9_-]{32,}$/.test(String(v)) || /^(ghp|gho|github_pat|sk)[-_]/.test(String(v))) p.push(`${label}: var ${k} looks like a secret`)
    }
  }
  return p
}

export function classifyChanged(paths) {
  const bad = []
  const warn = []
  for (const f of paths) {
    if (FORBIDDEN_ROOT.some((x) => (x.endsWith('/') ? f.startsWith(x) : f === x))) bad.push(f)
    else if (!f.includes('/') && !ALLOWED_ROOT.includes(f)) warn.push(f)
  }
  return { bad, warn }
}

export function scanText(text, patterns) {
  return patterns.filter(([, re]) => re.test(text)).map(([name]) => name)
}

// ---- file helpers ------------------------------------------------------------------------------------------
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.wrangler') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const TEXT = /\.(js|mjs|css|html|txt|json|jsonc|svg|xml|map|webmanifest|md)$|^_headers$/i
const textFiles = (dir) => walk(dir).filter((f) => TEXT.test(f.split('/').pop()))
const rel = (f) => relative(ROOT, f)
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })

// ---- gates ---------------------------------------------------------------------------------------------------------
const pass = (detail = []) => ({ status: 'PASS', detail })
const fail = (detail) => ({ status: 'FAIL', detail })
const verdict = (problems, ok = []) => (problems.length ? fail(problems) : pass(ok))

const read = (p) => readFileSync(p, 'utf8')

function wranglerDry(args) {
  const outdir = mkdtempSync(join(tmpdir(), 'senat-dry-'))
  const r = spawnSync('npx', ['wrangler', 'deploy', '--dry-run', ...args, '--outdir', outdir], { cwd: WORKER_DIR, encoding: 'utf8', timeout: 180000, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } })
  rmSync(outdir, { recursive: true, force: true })
  const text = `${r.stdout}${r.stderr}`
  const name = /Name:\s*(\S+)|worker "?([\w-]+)"?/i.exec(text)
  return { ok: r.status === 0 && /dry-run: exiting now/i.test(text), text, name: name?.[1] ?? name?.[2] }
}

export function gates({ skipWrangler = false } = {}) {
  const list = []
  const add = (id, title, run) => list.push({ id, title, run })

  add('dist', 'senat/dist exists with index.html, JS and CSS', () => {
    const p = []
    if (!existsSync(join(DIST, 'index.html'))) return fail(['senat/dist/index.html missing: run `npm run build:senat`'])
    const assets = walk(join(DIST, 'assets'))
    if (!assets.some((f) => f.endsWith('.js'))) p.push('no JS in dist/assets')
    if (!assets.some((f) => f.endsWith('.css'))) p.push('no CSS in dist/assets')
    return verdict(p, [`${walk(DIST).length} files`])
  })

  add('dist-files', 'dist has security.txt (tel + future Expires), humans.txt, kontakt.txt, _headers', () => {
    const p = []
    for (const f of ['humans.txt', 'kontakt.txt', '_headers']) if (!existsSync(join(DIST, f))) p.push(`dist/${f} missing`)
    const sec = join(DIST, '.well-known/security.txt')
    if (!existsSync(sec)) p.push('dist/.well-known/security.txt missing')
    else p.push(...parseSecurityTxt(read(sec)).map((x) => `security.txt: ${x}`))
    const k = join(DIST, 'kontakt.txt')
    if (existsSync(k) && !/777\s?954\s?389/.test(read(k))) p.push('kontakt.txt lacks the maintainer phone')
    return verdict(p)
  })

  add('no-volby-requests', 'browser code never requests volby.gov.cz/appdata (dist/assets + index.html)', () => {
    const re = /volby\.gov\.cz\/appdata|appdata\/senat|appdata\/kv2026/
    const hits = [join(DIST, 'index.html'), ...textFiles(join(DIST, 'assets'))].filter((f) => existsSync(f) && re.test(read(f))).map(rel)
    return verdict(hits.map((f) => `${f} references the upstream feed`))
  })

  add('forbidden-strings', 'no pirati.cz / jsemfast / GITHUB_TOKEN in dist, Worker src, wrangler config (comments ignored)', () => {
    const patterns = [['pirati.cz', /pirati\.cz/i], ['jsemfast', /jsemfast/i], ['GITHUB_TOKEN', /GITHUB_TOKEN/]]
    const p = []
    const files = [...textFiles(DIST), ...walk(join(WORKER_DIR, 'src')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))]
    for (const f of files) for (const n of scanText(read(f), patterns)) p.push(`${rel(f)} contains ${n}`)
    const cfg = join(WORKER_DIR, 'wrangler.jsonc')
    for (const n of scanText(stripJsonc(read(cfg)), patterns)) p.push(`${rel(cfg)} (code, not comments) contains ${n}`)
    return verdict(p, [`${files.length + 1} files scanned`])
  })

  add('secrets-scan', 'no token-looking strings in dist, senat/src, Worker src/scripts, wrangler config', () => {
    const patterns = [
      ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
      ['AWS key id', /\bAKIA[0-9A-Z]{16}\b/],
      ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
      ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['Cloudflare token assignment', /(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/],
      ['Anthropic/OpenAI key', /\bsk-(ant-)?[A-Za-z0-9_-]{30,}/],
    ]
    const dirs = [DIST, join(ROOT, 'senat/src'), join(ROOT, 'senat/public'), join(WORKER_DIR, 'src'), join(WORKER_DIR, 'scripts')]
    const files = [...dirs.flatMap((d) => textFiles(d)), join(WORKER_DIR, 'wrangler.jsonc')]
    const p = []
    for (const f of files) for (const n of scanText(read(f), patterns)) p.push(`${rel(f)}: ${n}`)
    return verdict(p, [`${files.length} files scanned`])
  })

  add('bundle-budget', `gzip budget: JS <= ${BUDGET.jsGzipKB} KB, CSS <= ${BUDGET.cssGzipKB} KB`, () => {
    const assets = walk(join(DIST, 'assets'))
    const size = (ext) => assets.filter((f) => f.endsWith(ext)).reduce((a, f) => a + gzipKB(readFileSync(f)), 0)
    const js = size('.js')
    const css = size('.css')
    const p = []
    if (js > BUDGET.jsGzipKB) p.push(`JS ${js.toFixed(1)} KB gzip > ${BUDGET.jsGzipKB}`)
    if (css > BUDGET.cssGzipKB) p.push(`CSS ${css.toFixed(1)} KB gzip > ${BUDGET.cssGzipKB}`)
    return verdict(p, [`JS ${js.toFixed(1)} KB, CSS ${css.toFixed(1)} KB gzip`])
  })

  add('headers-csp', '_headers is well-formed and its CSP allows exactly what index.html loads', () => {
    const f = join(DIST, '_headers')
    if (!existsSync(f)) return fail(['dist/_headers missing (senat/public/_headers, then rebuild)'])
    const html = read(join(DIST, 'index.html'))
    const p = checkCsp(read(f), html)
    const { rules } = parseHeadersFile(read(f))
    const must = ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy', 'Content-Security-Policy']
    const have = new Set(rules.find((r) => r.pattern === '/*')?.headers.map((h) => h.name.toLowerCase()))
    for (const h of must) if (!have.has(h.toLowerCase())) p.push(`/* lacks ${h}`)
    return verdict(p, [`${rules.length} rules`])
  })

  add('wrangler-config', 'wrangler.jsonc invariants (names, account, routes, staging isolation, no KV/secrets)', () => {
    const f = join(WORKER_DIR, 'wrangler.jsonc')
    let cfg
    try { cfg = parseJsonc(read(f)) } catch (e) { return fail([`wrangler.jsonc does not parse: ${e.message}`]) }
    const p = checkWrangler(cfg)
    if (!existsSync(join(WORKER_DIR, cfg.main ?? 'src/worker.js'))) p.push(`main ${cfg.main} does not exist`)
    return verdict(p)
  })

  add('prague-untouched', 'Prague config untouched vs main (cloudflare/, src/, public/, api/, index.html, vitest.config.js, .github/)', () => {
    const base = git('merge-base', 'HEAD', 'main')
    if (base.status !== 0) return fail(['git merge-base HEAD main failed: ' + base.stderr.trim()])
    const sha = base.stdout.trim()
    const committed = git('diff', '--name-only', sha, 'HEAD').stdout.split('\n').filter(Boolean)
    const dirty = git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''))
    const { bad, warn } = classifyChanged([...new Set([...committed, ...dirty])])
    const r = verdict(bad.map((f) => `Prague path changed: ${f}`), [`merge-base ${sha.slice(0, 9)}, ${committed.length} committed + ${dirty.length} uncommitted paths`])
    if (r.status === 'PASS' && warn.length) return { status: 'WARN', detail: [`other root files changed (allowed: ${ALLOWED_ROOT.join(', ')}): ${warn.join(', ')}`] }
    return r
  })

  for (const [id, label, args] of [['wrangler-dry-prod', 'wrangler deploy --dry-run --env=""', ['--env=']], ['wrangler-dry-staging', 'wrangler deploy --dry-run --env staging', ['--env', 'staging']]]) {
    add(id, label, () => {
      if (skipWrangler) return { status: 'SKIP', detail: ['--skip-wrangler'] }
      const r = wranglerDry(args)
      if (!r.ok) return fail(r.text.split('\n').filter((l) => /error|✘|warn/i.test(l)).slice(0, 8).concat(['(see `npx wrangler deploy --dry-run` for the full output)']))
      return pass([`${r.text.match(/Total Upload: [^\n]+/)?.[0] ?? 'dry run ok'}`])
    })
  }
  return list
}

export function runGates(opts) {
  return gates(opts).map(({ id, title, run }) => {
    let r
    try { r = run() } catch (e) { r = fail([`gate crashed: ${e.stack || e}`]) }
    return { id, title, ...r }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runGates({ skipWrangler: process.argv.includes('--skip-wrangler') })
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
  else {
    const w = Math.max(...results.map((r) => r.id.length))
    console.log(`Senate QA gates  (${new Date().toISOString()})\n`)
    for (const r of results) console.log(`${r.status.padEnd(5)} ${r.id.padEnd(w)}  ${r.title}${r.status === 'PASS' && r.detail[0] ? `  [${r.detail[0]}]` : ''}`)
    const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'WARN')
    for (const r of bad) {
      console.log(`\n${r.status} ${r.id}`)
      for (const d of r.detail) console.log(`  - ${d}`)
    }
    const n = (s) => results.filter((r) => r.status === s).length
    console.log(`\n${n('PASS')} passed, ${n('FAIL')} failed, ${n('WARN')} warnings, ${n('SKIP')} skipped`)
  }
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0)
}
