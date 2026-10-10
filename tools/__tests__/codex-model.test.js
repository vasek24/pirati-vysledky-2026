import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LIB = resolve(__dirname, '../lib/codex-model.sh')

// Runs codex_resolve_model against a fake `codex` that prints `catalog` as JSON.
// CODEX_HOME points at an empty dir so the real ~/.codex cache is never consulted.
function resolveWith(catalog, env = {}, override = '') {
  const dir = mkdtempSync(join(tmpdir(), 'codex-model-'))
  mkdirSync(join(dir, 'bin'))
  mkdirSync(join(dir, 'home'))
  writeFileSync(join(dir, 'bin/codex'), `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(catalog)}\nJSON\n`)
  chmodSync(join(dir, 'bin/codex'), 0o755)
  const r = spawnSync('bash', ['-c', `. "${LIB}"; codex_resolve_model "${override}" t`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CODEX_HOME: join(dir, 'home'), ...env },
  })
  return r.stdout
}

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
  it('an explicit override wins and the catalog is not consulted', () => {
    expect(resolveWith({ models: [m('gpt-5.6-sol')] }, {}, 'manual-model')).toBe('manual-model')
  })
  it('prints nothing when the line is absent', () => {
    expect(resolveWith({ models: [m('gpt-5.6-luna')] })).toBe('')
  })
})
