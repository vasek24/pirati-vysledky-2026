import { test, expect } from 'vitest'
import { CODE_REV } from './rev.js'
import { computeRev } from '../scripts/gen-rev.mjs'

test('rev.js is up to date (run: node cloudflare-senat/scripts/gen-rev.mjs)', () => {
  expect(CODE_REV).toMatch(/^[0-9a-f]{12}$/)
  expect(CODE_REV).toBe(computeRev())
})
