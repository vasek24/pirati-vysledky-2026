import { test, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CODE_REV } from './rev.js'
import { computeRev } from '../scripts/gen-rev.mjs'

test('rev.js is up to date (run: node cloudflare-senat/scripts/gen-rev.mjs)', () => {
  expect(CODE_REV).toMatch(/^[0-9a-f]{12}$/)
  expect(CODE_REV).toBe(computeRev())
})

test('CODE_REV covers xml.js, time.js, normalize.js, derive.js and manifest.js', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rev-'))
  try {
    const files = ['xml.js', 'time.js', 'normalize.js', 'derive.js', 'manifest.js']
    for (const f of files) writeFileSync(join(dir, f), `// ${f}\n`)
    const base = computeRev(`${dir}/`)
    for (const f of files) {
      writeFileSync(join(dir, f), `// ${f} changed\n`)
      expect(computeRev(`${dir}/`), f).not.toBe(base)
      writeFileSync(join(dir, f), `// ${f}\n`)
    }
    expect(computeRev(`${dir}/`)).toBe(base)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
