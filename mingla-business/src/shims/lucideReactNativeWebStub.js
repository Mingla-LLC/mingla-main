/**
 * ORCH-1137 — business-WEB lucide icon shim (total real-icon resolver).
 *
 * The business app imports icons from `lucide-react-native`. On NATIVE
 * (ios/android) that resolves to the real `lucide-react-native` (react-native-svg
 * backed) and is UNTOUCHED. On WEB, `metro.config.js` aliases
 * `lucide-react-native` -> THIS file (platform === "web" only).
 *
 * BEFORE (the bug this ORCH fixes): this file exported 12 named icons each
 * defined as `const IconStub = () => null`. Effect on business web ONLY:
 *   - EVERY lucide glyph rendered BLANK (the Ari empty-state "+" chip Seth
 *     reported, the send-arrow, the header Menu/Settings gear, etc.).
 *   - Any icon name NOT in the 12-entry list (6 are actually used in Ari
 *     conversation cards: AlertTriangle, Check, CheckSquare, Pencil, Play,
 *     Square) resolved to `undefined` -> React "type is invalid" CRASH the
 *     moment such a card rendered on web.
 *
 * NOW: this is a TOTAL Proxy resolver backed by the real `lucide-react`
 * (the pure-DOM React/SVG sibling of lucide-react-native, zero runtime deps,
 * version-pinned to 0.577.0 to byte-match the native lib's icon roster). Every
 * icon name the app imports renders a REAL inline <svg> glyph on web, and NO
 * icon-shaped name EVER resolves to `undefined` (the Proxy returns a real
 * fallback component instead). This structurally kills both the blank-glyph
 * class and the F-3 undefined-crash class for all current AND future icon names.
 *
 * lucide-react renders DOM <svg>; under react-native-web a raw <svg> inside a
 * <View>/<Text> (which compile to <div>/<span>) renders correctly. It has NO
 * react-native / react-native-svg / Flow / import.meta surface, so it bundles
 * clean under the Metro web resolver and does NOT regress the ORCH-1085
 * web-build fix the old null-stub was created to dodge.
 *
 * Provider docs: https://lucide.dev/guide/packages/lucide-react ,
 * https://www.npmjs.com/package/lucide-react , icon roster https://lucide.dev/icons/
 *
 * Do NOT restore the `() => null` null-stub. See SPEC_ORCH-1137 §4.2 / §9 +
 * the invariant I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL.
 */

const React = require("react");

// lucide-react ships both CJS (`main`) and ESM (`module`). Metro web resolves
// the CJS build via `require`. If the resolved value nests its icons under
// `.default` (an interop wrapper), unwrap to the real namespace. Either way the
// named icon components (Plus, ArrowUp, Menu, Settings, Check, ...) live on the
// resolved object as React components.
const LucideRaw = require("lucide-react");
const Lucide =
  LucideRaw && LucideRaw.Plus === undefined && LucideRaw.default
    ? LucideRaw.default
    : LucideRaw;

// Hard, always-real fallback used ONLY when an unknown icon-name key is
// requested. `HelpCircle` is a stable, long-lived Lucide icon (a recognizable
// "unknown" affordance). If a future roster ever lacks it, fall back to a
// locally-defined real component so the Proxy can NEVER return `undefined` for
// an icon-shaped name. (Per SPEC Q-B, a non-undefined component is the
// load-bearing contract; a blank-but-real glyph beats an undefined-typed crash.)
const HardFallback = React.forwardRef(function LucideUnknownIcon(_props, _ref) {
  return null;
});
const FallbackIcon =
  Lucide && typeof Lucide.HelpCircle !== "undefined"
    ? Lucide.HelpCircle
    : HardFallback;

// A value is render-capable if React can mount it: a function component, a
// forwardRef/memo object (typeof "object" with a non-null body), etc. lucide
// icons are forwardRef objects.
const isRenderable = (v) =>
  typeof v === "function" || (typeof v === "object" && v !== null);

const handler = {
  get(_target, key) {
    // Interop / introspection keys: return the namespace's own value, never a
    // faux icon. `then` MUST stay undefined so the module is never mistaken for
    // a thenable (Promise-detection guard during async import).
    if (key === "then") return undefined;
    if (key === "__esModule") return true;
    if (key === "default") return proxy;
    if (typeof key === "symbol") return Lucide ? Lucide[key] : undefined;

    const candidate = Lucide ? Lucide[key] : undefined;
    if (isRenderable(candidate)) {
      return candidate;
    }
    // Any other string key that does NOT resolve to a real icon -> the real
    // fallback component. THIS branch is the F-3 crash-kill: the get trap NEVER
    // returns `undefined` for a (capitalized) icon-name key.
    return FallbackIcon;
  },
  has(_target, key) {
    if (key === "then") return false;
    return true;
  },
};

const proxy = new Proxy({}, handler);

module.exports = proxy;
module.exports.default = proxy;
