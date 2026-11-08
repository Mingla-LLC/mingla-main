// issue #1023 wave 2 — node/ts-jest stand-in for expo-linear-gradient (see
// jest.config.cjs moduleNameMapper). The package's ESM build cannot run under
// node, and the shared offering bodies now import it for gradient fills. Renders
// a plain `LinearGradient` host element carrying its props and children; a
// suite's own jest.mock("expo-linear-gradient") still wins.
const React = require("react");

const LinearGradient = (props) =>
  React.createElement("LinearGradient", props, props.children);

module.exports = { __esModule: true, LinearGradient };
