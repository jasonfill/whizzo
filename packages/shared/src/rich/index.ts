// The rich-text core: math, MathML and figures inside card text.
//
// This lives in `shared` rather than in the web app because the API is where
// generated content arrives, and the server cannot tell a valid figure from a
// hallucinated one without it. Pure TypeScript — no DOM, no React.
//
// Rendering is deliberately *not* here. `layout.ts` (drawing arithmetic) and
// `templates.ts` (editor snippets) stay in apps/web, because validating a
// figure and drawing one are different jobs and only the first is the server's.
export * from './figures.js'
export * from './mathml.js'
export * from './parse.js'
export * from './tex.js'
