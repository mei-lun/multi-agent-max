import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.smoke.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false
  }
})
