// Moved to `packages/shared/src/adaptive.ts`, unchanged, so a round run
// server-side folds its attempts into mastery and ability with exactly the
// arithmetic the app uses (docs/mcp-tutor-spec.md). Re-exported here so the
// thirteen modules that import from this path keep working.
export * from '@whizzo/shared/adaptive'
