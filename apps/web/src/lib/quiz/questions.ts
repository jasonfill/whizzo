// Moved to `packages/shared/src/grading.ts` so the API can grade a tutor
// round's answers with the same rules the app uses — one grader, two callers
// (docs/mcp-tutor-spec.md). Re-exported here so every existing import in
// apps/web keeps working unchanged.
export * from '@whizzo/shared/grading'
