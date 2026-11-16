// ORCH-1118 render-proof — worktree-local babel config (NOT committed).
// Used ONLY by jest.orch1118.render.cjs to transform the RN .tsx screen for a
// real react-test-renderer mount. babel-preset-expo handles TS + RN JSX +
// flow-stripping of react-native source.
// #4420 — the screen now reaches its Review changes sheet through an on-intent
// `import()` (kept out of the eager web boot chunk). Lower it to require the
// same way Metro does, with the #2323 render-lane transform.
const path = require("path");

module.exports = {
  presets: [["babel-preset-expo", { jsxRuntime: "automatic" }]],
  plugins: [path.join(__dirname, "jest.issue2323.dynamic-import.cjs")],
};
