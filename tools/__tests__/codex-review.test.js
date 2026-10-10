import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Hermetic: a throwaway git repo, --dry-run only (codex is never invoked).
const SCRIPT = resolve(__dirname, '../codex-review.sh')
const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
}
let root, out

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (r.status !== 0) throw new Error(r.stderr)
}
const review = (args, env = {}) =>
  spawnSync('bash', [SCRIPT, ...args, '--spec', 'none', '--focus', 'f', '--dry-run', '--out-dir', out], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env },
  })
const DONE = 'finding\n\nVERDICT: 0 CRITICAL, 0 HIGH\n'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-review-repo-'))
  out = mkdtempSync(join(tmpdir(), 'codex-review-out-'))
  git('init', '-q', '-b', 'main')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.js'), '1\n')
  writeFileSync(join(root, 'src/b.txt'), '1\n')
  git('add', '-A'); git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feat')
  writeFileSync(join(root, 'src/a.js'), '2\n')
  writeFileSync(join(root, 'src/b.txt'), '2\n')
  writeFileSync(join(root, 'plan.md'), 'plan\n')
  git('add', '-A'); git('commit', '-q', '-m', 'change')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

describe('codex-review.sh round budget', () => {
  it('a completed plan review does not block the code review', () => {
    writeFileSync(join(out, 'codex-review-plan-r1.md'), DONE)
    const r = review(['--scope', 'code', '--base', 'main'])
    expect(r.status).toBe(0)
  })
  it('a second completed review of the same scope refuses unless approved', () => {
    writeFileSync(join(out, 'codex-review-code-r1.md'), DONE)
    const refused = review(['--scope', 'code', '--base', 'main'])
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('second round not approved')
    const ok = review(['--scope', 'code', '--base', 'main'], { CODEX_ROUND_APPROVED: '1' })
    expect(ok.status).toBe(0)
  })
  it('a truncated earlier run (no VERDICT) does not use up the budget', () => {
    writeFileSync(join(out, 'codex-review-code-r1.md'), 'cut off')
    expect(review(['--scope', 'code', '--base', 'main']).status).toBe(0)
  })
})

describe('codex-review.sh --paths', () => {
  it('limits the range and tells the reviewer', () => {
    const r = review(['--scope', 'code', '--base', 'main', '--paths', 'src/a.js'])
    expect(r.status).toBe(0)
    const prompt = readFileSync(join(out, 'codex-review-code-r1.prompt.md'), 'utf8')
    expect(prompt).toContain('src/a.js')
    expect(prompt).not.toContain('src/b.txt')
    expect(prompt).toContain('deliberately limited')
  })
  it('passes a glob to git literally instead of letting the shell expand it', () => {
    // An untracked root file would capture an unquoted `*.js` in the shell, giving git
    // a pathspec that matches nothing in the diff. Literal `*.js` matches src/a.js.
    writeFileSync(join(root, 'zzz.js'), 'x\n')
    const r = review(['--scope', 'code', '--base', 'main', '--paths', '*.js'])
    expect(r.status).toBe(0)
    const prompt = readFileSync(join(out, 'codex-review-code-r1.prompt.md'), 'utf8')
    expect(prompt).toContain('src/a.js')
    expect(prompt).not.toContain('src/b.txt')
  })
})
