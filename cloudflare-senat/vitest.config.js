import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['cloudflare-senat/**/*.test.js', 'senat/**/*.test.js'],
    exclude: [...configDefaults.exclude],
  },
})
