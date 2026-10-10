import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const LIB = resolve(__dirname, '../lib/codex-model.sh')
const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

// Runs codex_resolve_model against a fake `codex`. `catalog` is printed as JSON by
// `codex debug models`; every invocation is recorded in <dir>/calls.
// CODEX_HOME points at an empty dir so the real ~/.codex cache is never consulted.
function run(catalog, env = {}, override = '') {
  const dir = mkdtempSync(join(tmpdir(), 'codex-model-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'home'))
  writeFileSync(
    join(dir, 'bin/codex'),
    `#!/usr/bin/env bash\necho called >> "${join(dir, 'calls')}"\ncat <<'JSON'\n${JSON.stringify(catalog)}\nJSON\n`,
  )
  chmodSync(join(dir, 'bin/codex'), 0o755)
  const r = spawnSync('bash', ['-c', `. "${LIB}"; codex_resolve_model "${override}" t`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CODEX_HOME: join(dir, 'home'), CODEX_FALLBACK_MODEL: '', ...env },
  })
  return { out: r.stdout, called: existsSync(join(dir, 'calls')) }
}
const resolveWith = (...a) => run(...a).out

const m = (slug, visibility = 'list', supported_in_api = true) => ({ slug, visibility, supported_in_api })

describe('codex_resolve_model', () => {
  it('picks the numerically newest model of the line', () => {
    const catalog = { models: [m('gpt-5.6-sol'), m('gpt-6.1-sol'), m('gpt-6.10-sol'), m('gpt-6.2-sol'), m('gpt-9-luna')] }
    expect(resolveWith(catalog)).toBe('gpt-6.10-sol')
  })
  it('ignores hidden and non-API models', () => {
    const catalog = { models: [m('gpt-5.6-sol'), m('gpt-7-sol', 'hide'), m('gpt-8-sol', 'list', false)] }
    expect(resolveWith(catalog)).toBe('gpt-5.6-sol')
  })
  it('follows CODEX_MODEL_LINE', () => {
    const catalog = { models: [m('gpt-5.6-sol'), m('gpt-5.6-terra'), m('gpt-5.7-terra')] }
    expect(resolveWith(catalog, { CODEX_MODEL_LINE: 'terra' })).toBe('gpt-5.7-terra')
  })
  it('an explicit override wins and codex is never invoked', () => {
    const r = run({ models: [m('gpt-5.6-sol')] }, {}, 'manual-model')
    expect(r.out).toBe('manual-model')
    expect(r.called).toBe(false)
  })
  it('prints nothing when the line is absent', () => {
    expect(resolveWith({ models: [m('gpt-5.6-luna')] })).toBe('')
  })
  it('uses CODEX_FALLBACK_MODEL only when nothing resolves', () => {
    expect(resolveWith({ models: [m('gpt-5.6-luna')] }, { CODEX_FALLBACK_MODEL: 'fb-model' })).toBe('fb-model')
    expect(resolveWith({ models: [m('gpt-5.6-sol')] }, { CODEX_FALLBACK_MODEL: 'fb-model' })).toBe('gpt-5.6-sol')
  })
})
