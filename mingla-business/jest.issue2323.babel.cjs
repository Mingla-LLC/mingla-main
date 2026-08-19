// #2323 + #2326 render-proof babel config.
//
// `jest.orch1118.babel.cjs` (the shared render-proof transform) plus ONE local
// plugin that lowers dynamic `import()` to `require` — see
// `jest.issue2323.dynamic-import.cjs` for why the lane cannot run without it.
const path = require("path");

module.exports = {
  presets: [["babel-preset-expo", { jsxRuntime: "automatic" }]],
  plugins: [path.join(__dirname, "jest.issue2323.dynamic-import.cjs")],
};
