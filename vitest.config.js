import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js', 'cloudflare/*.test.js', 'scripts/**/*.test.js', 'tools/**/*.test.js'],
    exclude: [...configDefaults.exclude],
  },
})
