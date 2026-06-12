// ORCH-1118 render-proof — worktree-local babel config (NOT committed).
// Used ONLY by jest.orch1118.render.cjs to transform the RN .tsx screen for a
// real react-test-renderer mount. babel-preset-expo handles TS + RN JSX +
// flow-stripping of react-native source.
module.exports = {
  presets: [["babel-preset-expo", { jsxRuntime: "automatic" }]],
};
