/**
 * ORCH-1137 — business-WEB lucide icon shim (tree-shakeable real-icon resolver).
 *
 * The business app imports icons from `lucide-react-native`. On NATIVE
 * (ios/android) that resolves to the real `lucide-react-native` (react-native-svg
 * backed) and is UNTOUCHED. On WEB, `metro.config.js` aliases
 * `lucide-react-native` -> THIS file (platform === "web" only).
 *
 * BEFORE (the original bug this ORCH fixes): this file exported 12 named icons
 * each defined as `const IconStub = () => null`. Effect on business web ONLY:
 *   - EVERY lucide glyph rendered BLANK (the Ari empty-state "+" chip Seth
 *     reported, the send-arrow, the header Menu/Settings gear, etc.).
 *   - Any icon name NOT in the 12-entry list resolved to `undefined` -> React
 *     "type is invalid" CRASH the moment such a card rendered on web (F-3).
 *
 * FIRST FIX ATTEMPT (reverted in this rework): backed a total `Proxy` with a
 * FULL `lucide-react` BARREL import (`require("lucide-react")` returns the whole
 * ~1700-icon module object; named destructuring off the barrel still drags the
 * whole barrel in). That defeated tree-shaking and landed the entire icon library
 * (~1.8MB) in the eager boot `__common` chunk, blowing the ORCH-1083 initial-
 * bundle budget (4.03MB, ~1.8MB over the 2.25MB cap).
 *
 * NOW (tree-shakeable): we require EXACTLY the icon modules mingla-business
 * actually uses (the authoritative used-set, enumerated from every
 * `lucide-react-native` import under mingla-business/src + app/) from their
 * INDIVIDUAL deep module paths (`lucide-react/dist/esm/icons/<kebab>.js`). Each
 * deep require pulls ONLY that one icon module — NOT the barrel — so the bundler
 * ships ~12 tiny icon modules instead of the whole library. We build a
 * name->component map and keep a total `Proxy` whose `get` returns the mapped
 * real component for any used name and a single real fallback (`HelpCircle`, also
 * deep-required) for ANY unmapped name, and whose `has` returns true. So NO icon
 * name EVER resolves to `undefined` and nothing crashes — the never-undefined /
 * never-blank-crash guarantee is preserved — while the bundle stays small.
 *
 * Why deep paths and not `const { Plus } = require("lucide-react")`: the
 * lucide-react CJS/ESM ENTRY is a barrel that statically references every icon;
 * Metro's production minifier could not eliminate the unreferenced ones, so the
 * whole roster (1714 `lucide-*` refs) re-entered __common. Requiring the
 * per-icon module path sidesteps the barrel entirely. The deep modules carry
 * `__esModule`, so `.default` is the component under both node (jest) and Metro.
 *
 * Drift guard: the used-set below MUST stay in sync with the real imports. If a
 * mingla-business component starts importing a NEW `lucide-react-native` icon not
 * in the map, that icon renders the HelpCircle fallback on web (still safe, never
 * crashes) — and the gate `i-proposed-1137-biz-web-lucide-real.mjs` INV-4 FAILS
 * CI, telling the dev to add the new name here. The same gate's INV-3 FORBIDS a
 * barrel / namespace / `import * as` import from `lucide-react` (the bloat
 * regression).
 *
 * lucide renders DOM <svg>; under react-native-web a raw <svg> inside a
 * <View>/<Text> (which compile to <div>/<span>) renders correctly. It has NO
 * react-native / react-native-svg / Flow / import.meta surface, so it bundles
 * clean under the Metro web resolver and does NOT regress the ORCH-1085
 * web-build fix the old null-stub was created to dodge.
 *
 * Provider docs: https://lucide.dev/guide/packages/lucide-react ,
 * https://www.npmjs.com/package/lucide-react , icon roster https://lucide.dev/icons/
 *
 * Do NOT restore the `() => null` null-stub and do NOT switch to a barrel /
 * namespace / `import * as` import (it re-bloats __common). See SPEC_ORCH-1137
 * §4.2 / §9 + the invariant I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL.
 */

const React = require("react");

// Resolve the component out of a deep-required lucide icon module. Each deep
// module sets `__esModule` and exports the component as `default`.
const iconOf = (mod) => (mod && mod.__esModule ? mod.default : mod) || null;

// Authoritative used-set — every icon imported from `lucide-react-native`
// anywhere under mingla-business/src + app/ (live audit). Each is deep-required
// from its OWN module path so the bundler tree-shakes the rest of lucide away.
// Keep this map in lockstep with the real imports; the INV-4 drift gate fails CI
// if a `lucide-react-native` import names an icon missing from this map.
//
//   AlertTriangle    src/components/ari/ToolProposalCard.tsx
//   ArrowLeft        src/components/venue/* (ORCH-1196)
//   ArrowUp          src/components/ari/InputBar.tsx
//   Calendar         src/components/venue/* (ORCH-1196)
//   Check            src/components/ari/{QuickReplyChips,MessageList,ClarifyingCard}.tsx
//   CheckSquare      src/components/ari/MultiSelectPrompt.tsx
//   ChevronDown      src/components/venue/* (ORCH-1196)
//   ChevronRight     src/components/venue/* (ORCH-1196)
//   ChevronUp        src/components/venue/* (ORCH-1196)
//   Clock            src/components/venue/* (ORCH-1196)
//   Flag             src/components/venue/* (ORCH-1196)
//   LayoutGrid       src/components/venue/* (ORCH-1196)
//   List             src/components/venue/* (ORCH-1196)
//   Menu             src/screens/ari/AriChatScreen.tsx
//   MessageSquare    src/components/venue/* (ORCH-1196)
//   Pencil           src/components/ari/ToolProposalCard.tsx
//   Play             src/components/ari/ToolProposalCard.tsx
//   Plus             src/components/ari/{ToolProposalCard,EmptyState}.tsx
//   Settings         src/screens/ari/AriChatScreen.tsx
//   Square           src/components/ari/MultiSelectPrompt.tsx
//   UtensilsCrossed  src/components/venue/* (ORCH-1196)
//   X                src/components/ari/ToolProposalCard.tsx
//   HelpCircle       (fallback only — the always-real "unknown icon" affordance)
const USED_ICONS = {
  AlertTriangle: iconOf(require("lucide-react/dist/esm/icons/alert-triangle.js")),
  ArrowLeft: iconOf(require("lucide-react/dist/esm/icons/arrow-left.js")),
  ArrowUp: iconOf(require("lucide-react/dist/esm/icons/arrow-up.js")),
  Calendar: iconOf(require("lucide-react/dist/esm/icons/calendar.js")),
  Check: iconOf(require("lucide-react/dist/esm/icons/check.js")),
  CheckSquare: iconOf(require("lucide-react/dist/esm/icons/check-square.js")),
  ChevronDown: iconOf(require("lucide-react/dist/esm/icons/chevron-down.js")),
  ChevronRight: iconOf(require("lucide-react/dist/esm/icons/chevron-right.js")),
  ChevronUp: iconOf(require("lucide-react/dist/esm/icons/chevron-up.js")),
  Clock: iconOf(require("lucide-react/dist/esm/icons/clock.js")),
  Flag: iconOf(require("lucide-react/dist/esm/icons/flag.js")),
  LayoutGrid: iconOf(require("lucide-react/dist/esm/icons/layout-grid.js")),
  List: iconOf(require("lucide-react/dist/esm/icons/list.js")),
  Menu: iconOf(require("lucide-react/dist/esm/icons/menu.js")),
  MessageSquare: iconOf(require("lucide-react/dist/esm/icons/message-square.js")),
  Pencil: iconOf(require("lucide-react/dist/esm/icons/pencil.js")),
  Play: iconOf(require("lucide-react/dist/esm/icons/play.js")),
  Plus: iconOf(require("lucide-react/dist/esm/icons/plus.js")),
  Settings: iconOf(require("lucide-react/dist/esm/icons/settings.js")),
  Square: iconOf(require("lucide-react/dist/esm/icons/square.js")),
  UtensilsCrossed: iconOf(require("lucide-react/dist/esm/icons/utensils-crossed.js")),
  X: iconOf(require("lucide-react/dist/esm/icons/x.js")),
  HelpCircle: iconOf(require("lucide-react/dist/esm/icons/help-circle.js")),
};

// Hard, always-real fallback used when an unmapped icon-name key is requested.
// `HelpCircle` is a stable, long-lived Lucide icon (a recognizable "unknown"
// affordance). If it ever fails to resolve, fall back to a locally-defined real
// component so the Proxy can NEVER return `undefined` for an icon-shaped name.
// (Per SPEC Q-B, a non-undefined component is the load-bearing contract; a
// blank-but-real glyph beats an undefined-typed crash.)
const HardFallback = React.forwardRef(function LucideUnknownIcon(_props, _ref) {
  return null;
});
const FallbackIcon = USED_ICONS.HelpCircle || HardFallback;

// A value is render-capable if React can mount it: a function component, a
// forwardRef/memo object (typeof "object" with a non-null body), etc. lucide
// icons are forwardRef objects.
const isRenderable = (v) =>
  typeof v === "function" || (typeof v === "object" && v !== null);

const handler = {
  get(_target, key) {
    // Interop / introspection keys: never a faux icon. `then` MUST stay
    // undefined so the module is never mistaken for a thenable (Promise-detection
    // guard during async import).
    if (key === "then") return undefined;
    if (key === "__esModule") return true;
    if (key === "default") return proxy;
    if (typeof key === "symbol") return undefined;

    const candidate = USED_ICONS[key];
    if (isRenderable(candidate)) {
      return candidate;
    }
    // Any other string key (an unmapped icon name) -> the real fallback
    // component. THIS branch is the F-3 crash-kill: the get trap NEVER returns
    // `undefined` for a (capitalized) icon-name key.
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
