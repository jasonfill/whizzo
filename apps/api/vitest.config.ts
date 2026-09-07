import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Only the sources. `tsc` compiles the test files into dist/ alongside
    // everything else, and a compiled copy from an earlier build is a test of
    // code that no longer exists.
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Count everything, not just what a test happened to import — otherwise
      // the percentage only describes the files already under test.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/server.ts',
        'src/cli/**',
        '**/*.test.ts',
        '**/*.config.*',
        'scripts/**',
        'dist/**',
      ],
    },
  },
})
