// #4420 — node/ts-jest stand-in for expo-blur (see jest.config.cjs
// moduleNameMapper). Graphite Glass routes every blur through
// src/components/ui/Material.tsx, which imports expo-blur at module scope; the
// package's ESM build cannot run under node, so any suite that renders a
// Material-backed primitive (GlassCard, sheets, dialogs, toasts) crashed on
// load. Renders a plain `BlurView` host element carrying its props and
// children, so suites can still assert on the iOS blur branch; a suite's own
// jest.mock("expo-blur") still wins.
const React = require("react");

const BlurView = (props) => React.createElement("BlurView", props, props.children);

module.exports = { __esModule: true, BlurView, default: BlurView };
