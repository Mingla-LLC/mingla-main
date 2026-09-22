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
 * NOW (tree-shakeable): we require EXACTLY the icon modules the web bundle
 * actually uses (the authoritative used-set, enumerated from every
 * `lucide-react-native` import under mingla-business/src + app/ AND under the
 * shared `packages/` workspaces the business web build pulls in) from their
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
 * per-icon module path sidesteps the barrel entirely. The five #1778 picker
 * icons below use the same pinned Lucide path nodes directly with
 * `createLucideIcon`; that preserves their rendered SVG exactly while avoiding
 * five repeated ESM module wrappers in the eager shared chunk. The deep modules carry
 * `__esModule`, so `.default` is the component under both node (jest) and Metro.
 *
 * Drift guard: the used-set below MUST stay in sync with the real imports. If a
 * component starts importing a NEW `lucide-react-native` icon not in the map,
 * that icon renders the HelpCircle fallback on web (still safe, never crashes)
 * — and the gate `i-proposed-1137-biz-web-lucide-real.mjs` INV-4 FAILS CI,
 * telling the dev to add the new name here. The same gate's INV-3 FORBIDS a
 * barrel / namespace / `import * as` import from `lucide-react` (the bloat
 * regression).
 *
 * Issue #2534 — that drift guard used to scan ONLY mingla-business/{src,app},
 * so `packages/brand-rendering/PublicBrandPage.tsx` (a SHARED workspace the
 * business web build renders at `/b/{brandSlug}`) drifted unseen: nine of the
 * ten icons it imports were absent from this map and shipped as the HelpCircle
 * placeholder on the live public brand page while INV-4 reported PASS. The gate
 * now walks `packages/` too, and the nine names are mapped below. The lesson is
 * the perimeter, not the icons: a used-set gate that does not cover every source
 * root in the web bundle is green by construction.
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
const createLucideIcon = iconOf(
  require("lucide-react/dist/esm/createLucideIcon.js"),
);

// Authoritative used-set — every icon imported from `lucide-react-native`
// anywhere under mingla-business/src + app/ AND under the shared `packages/`
// workspaces (live audit). Each is deep-required from its OWN module path so the
// bundler tree-shakes the rest of lucide away. Keep this map in lockstep with the
// real imports; the INV-4 drift gate fails CI if a `lucide-react-native` import
// names an icon missing from this map.
//
//   AlertCircle      src/components/ari/{AriActivity,AriAttachmentCards}.tsx (#3429)
//   AlertTriangle    src/components/ari/ToolProposalCard.tsx
//   ArrowLeft        src/components/venue/* (ORCH-1196)
//   ArrowUp          src/components/ari/InputBar.tsx
//   BedDouble        src/components/stay/StaySuiteShell.tsx
//   BookOpen         src/components/marketing/AudiencePickerSheet.tsx (#1778)
//   Calendar         src/components/venue/* (ORCH-1196)
//   CalendarDays     src/components/stay/StaySuiteShell.tsx
//   Check            src/components/ari/{QuickReplyChips,MessageList,ClarifyingCard}.tsx
//   CheckCircle2     src/components/ari/AriAttachmentCards.tsx (#3429)
//   CheckSquare      src/components/ari/MultiSelectPrompt.tsx
//   ChevronDown      src/components/venue/* (ORCH-1196)
//   ChevronLeft      src/components/venue/ReservationCalendarToolbar.tsx (#2737)
//   ChevronRight     src/components/venue/* (ORCH-1196)
//   ChevronUp        src/components/venue/* (ORCH-1196)
//   Circle           src/components/stay/StaySuiteShell.tsx
//   Clock            src/components/venue/* (ORCH-1196)
//   ClipboardList    src/components/venue/VenueOrdersModule.tsx (#1791)
//   Cloud            src/components/ari/AriActivity.tsx (#3429)
//   CreditCard       src/components/stay/StaySuiteShell.tsx
//   Ellipsis         src/components/ari/ConversationDrawer.tsx (#3429)
//   FileCheck2       src/components/stay/StaySuiteShell.tsx
//   FileText         src/components/ari/{AriAttachmentCards,AriAttachmentSourceSheet}.tsx (#3429)
//   Files            src/components/ari/AriActivity.tsx (#3429)
//   Flag             src/components/venue/* (ORCH-1196)
//   Home             src/components/stay/StaySuiteShell.tsx
//   Image            src/components/ari/{AriAttachmentCards,AriAttachmentSourceSheet}.tsx (#3429)
//   LayoutGrid       src/components/venue/* (ORCH-1196)
//   List             src/components/venue/* (ORCH-1196)
//   Menu             src/screens/ari/AriChatScreen.tsx
//   MessageSquare    src/components/venue/* (ORCH-1196)
//   Network          src/components/marketing/AudiencePickerSheet.tsx (#1778)
//   Pencil           src/components/ari/ToolProposalCard.tsx
//   Play             src/components/ari/ToolProposalCard.tsx
//   Plus             src/components/ari/{ToolProposalCard,EmptyState}.tsx
//   Radio            src/components/marketing/AudiencePickerSheet.tsx (#1778)
//   RotateCw         src/components/ari/{AriActivity,AriAttachmentCards}.tsx (#3429)
//   Search           src/components/ari/AriActivity.tsx (#3429)
//   Settings         src/screens/ari/AriChatScreen.tsx
//   ShoppingBag      src/components/marketing/AudiencePickerSheet.tsx (#1778)
//   Square           src/components/ari/MultiSelectPrompt.tsx
//   Utensils         src/components/stay/StaySuiteShell.tsx
//   UtensilsCrossed  src/components/venue/* (ORCH-1196)
//   UsersRound       src/components/marketing/AudiencePickerSheet.tsx (#1778)
//   X                src/components/ari/ToolProposalCard.tsx
//
// Shared workspaces under `packages/` — rendered by the business WEB build and
// therefore resolved through THIS shim, exactly like mingla-business/src. Issue
// #2534: these nine were missing, so the live public brand page
// `host.usemingla.com/b/{brandSlug}` drew a circled question mark for its ticket
// badge and every social chip except X.
//
//   AtSign           packages/brand-rendering/PublicBrandPage.tsx (#2534 — Threads chip)
//   CalendarCheck    packages/brand-rendering/PublicBrandPage.tsx (#2534 — RSVP badge)
//   Facebook         packages/brand-rendering/PublicBrandPage.tsx (#2534 — social chip)
//   Globe2           packages/brand-rendering/PublicBrandPage.tsx (#2534 — website chip)
//   Instagram        packages/brand-rendering/PublicBrandPage.tsx (#2534 — social chip)
//   Linkedin         packages/brand-rendering/PublicBrandPage.tsx (#2534 — social chip)
//   Music2           packages/brand-rendering/PublicBrandPage.tsx (#2534 — TikTok chip)
//   Ticket           packages/brand-rendering/PublicBrandPage.tsx (#2534 — TICKETS badge)
//   Youtube          packages/brand-rendering/PublicBrandPage.tsx (#2534 — social chip)
//   (X above is shared: PublicBrandPage's X/Twitter chip resolves the same entry.)
//
//   HelpCircle       (fallback only — the always-real "unknown icon" affordance)
const USED_ICONS = {
  // Issue #3429 — Ari activity/attachment failure glyph.
  AlertCircle: iconOf(require("lucide-react/dist/esm/icons/alert-circle.js")),
  AlertTriangle: iconOf(
    require("lucide-react/dist/esm/icons/alert-triangle.js"),
  ),
  ArrowLeft: iconOf(require("lucide-react/dist/esm/icons/arrow-left.js")),
  ArrowUp: iconOf(require("lucide-react/dist/esm/icons/arrow-up.js")),
  // Issue #2534 — packages/brand-rendering/PublicBrandPage.tsx (Threads chip).
  AtSign: iconOf(require("lucide-react/dist/esm/icons/at-sign.js")),
  BedDouble: iconOf(require("lucide-react/dist/esm/icons/bed-double.js")),
  BookOpen: createLucideIcon("book-open", [
    ["path", { d: "M12 7v14", key: "1akyts" }],
    [
      "path",
      {
        d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
        key: "ruj8y",
      },
    ],
  ]),
  Calendar: iconOf(require("lucide-react/dist/esm/icons/calendar.js")),
  // Issue #2534 — PublicBrandPage RSVP kind badge.
  CalendarCheck: iconOf(
    require("lucide-react/dist/esm/icons/calendar-check.js"),
  ),
  CalendarDays: iconOf(require("lucide-react/dist/esm/icons/calendar-days.js")),
  Check: iconOf(require("lucide-react/dist/esm/icons/check.js")),
  // Issue #3429 — Ari Ready and sent-file checks.
  CheckCircle2: iconOf(
    require("lucide-react/dist/esm/icons/check-circle-2.js"),
  ),
  CheckSquare: iconOf(require("lucide-react/dist/esm/icons/check-square.js")),
  ChevronDown: iconOf(require("lucide-react/dist/esm/icons/chevron-down.js")),
  ChevronLeft: iconOf(require("lucide-react/dist/esm/icons/chevron-left.js")),
  ChevronRight: iconOf(require("lucide-react/dist/esm/icons/chevron-right.js")),
  ChevronUp: iconOf(require("lucide-react/dist/esm/icons/chevron-up.js")),
  // Issue #1791 — the Orders queue's empty state (VenueOrdersModule).
  ClipboardList: iconOf(
    require("lucide-react/dist/esm/icons/clipboard-list.js"),
  ),
  Clock: iconOf(require("lucide-react/dist/esm/icons/clock.js")),
  // Issue #3429 — Ari "Reconnecting to Ari…" callout.
  Cloud: iconOf(require("lucide-react/dist/esm/icons/cloud.js")),
  // Issue #3429 — Ari conversation More control.
  Ellipsis: iconOf(require("lucide-react/dist/esm/icons/ellipsis.js")),
  // Issue #2534 — PublicBrandPage social chips.
  Facebook: iconOf(require("lucide-react/dist/esm/icons/facebook.js")),
  // Issue #3429 — Ari document tiles and the attachment-reading activity.
  FileText: iconOf(require("lucide-react/dist/esm/icons/file-text.js")),
  Files: iconOf(require("lucide-react/dist/esm/icons/files.js")),
  Flag: iconOf(require("lucide-react/dist/esm/icons/flag.js")),
  // Issue #2534 — PublicBrandPage website + Instagram chips.
  Globe2: iconOf(require("lucide-react/dist/esm/icons/globe-2.js")),
  Instagram: iconOf(require("lucide-react/dist/esm/icons/instagram.js")),
  // Issue #3429 — Ari photo tiles and the Add context Photos row.
  Image: iconOf(require("lucide-react/dist/esm/icons/image.js")),
  LayoutGrid: iconOf(require("lucide-react/dist/esm/icons/layout-grid.js")),
  // Issue #2534 — PublicBrandPage social chip.
  Linkedin: iconOf(require("lucide-react/dist/esm/icons/linkedin.js")),
  List: iconOf(require("lucide-react/dist/esm/icons/list.js")),
  Menu: iconOf(require("lucide-react/dist/esm/icons/menu.js")),
  MessageSquare: iconOf(
    require("lucide-react/dist/esm/icons/message-square.js"),
  ),
  // Issue #2534 — PublicBrandPage TikTok chip.
  Music2: iconOf(require("lucide-react/dist/esm/icons/music-2.js")),
  Network: createLucideIcon("network", [
    [
      "rect",
      { x: "16", y: "16", width: "6", height: "6", rx: "1", key: "4q2zg0" },
    ],
    [
      "rect",
      { x: "2", y: "16", width: "6", height: "6", rx: "1", key: "8cvhb9" },
    ],
    [
      "rect",
      { x: "9", y: "2", width: "6", height: "6", rx: "1", key: "1egb70" },
    ],
    ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", key: "1jsf9p" }],
    ["path", { d: "M12 12V8", key: "2874zd" }],
  ]),
  Pencil: iconOf(require("lucide-react/dist/esm/icons/pencil.js")),
  Play: iconOf(require("lucide-react/dist/esm/icons/play.js")),
  Plus: iconOf(require("lucide-react/dist/esm/icons/plus.js")),
  Radio: createLucideIcon("radio", [
    ["path", { d: "M16.247 7.761a6 6 0 0 1 0 8.478", key: "1fwjs5" }],
    ["path", { d: "M19.075 4.933a10 10 0 0 1 0 14.134", key: "ehdyv1" }],
    ["path", { d: "M4.925 19.067a10 10 0 0 1 0-14.134", key: "1q22gi" }],
    ["path", { d: "M7.753 16.239a6 6 0 0 1 0-8.478", key: "r2q7qm" }],
    ["circle", { cx: "12", cy: "12", r: "2", key: "1c9p78" }],
  ]),
  // Issue #3429 — Ari retry controls and the workspace-read activity.
  RotateCw: iconOf(require("lucide-react/dist/esm/icons/rotate-cw.js")),
  Search: iconOf(require("lucide-react/dist/esm/icons/search.js")),
  Settings: iconOf(require("lucide-react/dist/esm/icons/settings.js")),
  ShoppingBag: createLucideIcon("shopping-bag", [
    ["path", { d: "M16 10a4 4 0 0 1-8 0", key: "1ltviw" }],
    ["path", { d: "M3.103 6.034h17.794", key: "awc11p" }],
    [
      "path",
      {
        d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z",
        key: "o988cm",
      },
    ],
  ]),
  Sparkles: iconOf(require("lucide-react/dist/esm/icons/sparkles.js")),
  Square: iconOf(require("lucide-react/dist/esm/icons/square.js")),
  // Issue #2534 — PublicBrandPage TICKETS kind badge.
  Ticket: iconOf(require("lucide-react/dist/esm/icons/ticket.js")),
  UtensilsCrossed: iconOf(
    require("lucide-react/dist/esm/icons/utensils-crossed.js"),
  ),
  UsersRound: createLucideIcon("users-round", [
    ["path", { d: "M18 21a8 8 0 0 0-16 0", key: "3ypg7q" }],
    ["circle", { cx: "10", cy: "8", r: "5", key: "o932ke" }],
    ["path", { d: "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3", key: "10s06x" }],
  ]),
  X: iconOf(require("lucide-react/dist/esm/icons/x.js")),
  // Issue #2534 — PublicBrandPage social chip.
  Youtube: iconOf(require("lucide-react/dist/esm/icons/youtube.js")),
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
