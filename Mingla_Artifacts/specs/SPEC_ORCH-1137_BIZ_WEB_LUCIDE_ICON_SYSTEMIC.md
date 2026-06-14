# SPEC — ORCH-1137 · Business-web lucide icon systemic fix

**Skill:** mingla-forensics (SPEC)
**Date:** 2026-06-14
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1137-[ari-emptystate-plus-glyph]/` on branch `ORCH-1137-ari-emptystate-plus-glyph` (rebased onto origin/main)
**Input investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1137_ARI_EMPTYSTATE_PLUS_GLYPH.md` (commit `f15acfaef`) — root cause PROVEN, web-only.
**Confidence basis:** Root cause is a deterministic build-config fact (web Metro alias → `() => null` stub). This SPEC defines the fix contract; it adds NO new investigation.

---

## Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. Acked this turn:

- **COMMS-0034** (WARN, `ORCH-1136,ALL`, OPEN) — ORCH-1137 OWNS the systemic biz-web lucide fix; ORCH-1136 [biz-web-shell-bugs] must NOT duplicate web-icon work and must coordinate here if its shell work touches `metro.config.js` icon aliasing or `lucideReactNativeWebStub.js`. This SPEC is the systemic fix COMMS-0034 references. Factored: scope is the lucide-on-web icon system ONLY; no web-shell bugs touched.
- **COMMS-0027** (WARN, `ALL`, OPEN) — OTA shared-cache poisoning from symlinked worktrees. Relevant ONLY at CLOSE/OTA time, not at IMPLEMENT/TEST. Carried forward for the eventual OTA step (per-platform `--clear-cache` + isolated `TMPDIR`). No business-web OTA exists (web is a Vercel export, not an EAS OTA channel) — but the runbook note is preserved for any native re-publish.
- **COMMS-0003** (WARN, `ALL`, OPEN) — external-API integration ORCHs must cite provider-doc URLs inline at SPEC time. This SPEC adds one external dependency (`lucide-react`); its provider doc is cited inline in §4.1 and §4.4.

No `BLOCK`+`OPEN` entry targets `mingla-forensics`, `ORCH-1137`, or an unaddressed `ALL`.

---

## 1. Executive summary

On the business **web** preview, every icon imported from `lucide-react-native` renders blank — the Ari empty-state "+" chip Seth reported, the Ari send-arrow, the header Menu/Settings gear, and any other lucide glyph on a web-reachable screen. The cause: `mingla-business/metro.config.js` aliases `lucide-react-native` to `src/shims/lucideReactNativeWebStub.js` on the web platform, and that stub exports 12 icons each defined as `() => null`. Worse, any icon name NOT in those 12 (six are actually used in Ari conversation cards) resolves to `undefined`, which crashes React with "type is invalid" the moment such a card renders on web.

This SPEC replaces the null-stub with a **total, real-rendering web shim**: a thin module that re-exports `lucide-react` (the pure-DOM React/SVG sibling of `lucide-react-native`, zero react-native dependencies, version-pinned to `0.577.0` to byte-match the native lib's icon roster) behind a `Proxy` so that (a) every icon name the app imports renders a real SVG glyph on web, (b) any unknown/future icon name resolves to a guaranteed-real fallback glyph and NEVER returns `undefined`, and (c) the web bundle still builds clean (no react-native-svg, no Flow types, no `import.meta` — the exact hazards ORCH-1085 created the stub to dodge). iOS and Android are untouched: the Metro alias fires only on `platform === "web"`, and native keeps importing the real `lucide-react-native`.

The fix touches exactly two product files (the shim + a one-line comment in metro.config.js, no resolution-logic change), one package.json dependency add, plus test/gate scaffolding. No source `.tsx` component changes — the Ari component imports stay byte-identical, so the existing source-assertion tests stay green automatically.

---

## 2. Scope & non-goals

### In scope
- Replace `mingla-business/src/shims/lucideReactNativeWebStub.js` with a total real-icon shim backed by `lucide-react@0.577.0`.
- Add `lucide-react@0.577.0` as a `mingla-business` dependency.
- Guarantee: on web, every lucide icon name the app imports renders a real glyph; no icon name (current or future) ever resolves to `undefined`.
- A new strict-grep + render-proof gate (`I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL`) and an `expo export -p web` build-proof extension.
- Keep `orch_1057_ari_composer_icons_emptystate.test.ts` and the `orch_1101_*` tests green (no source-component edits, so they pass unchanged).

### Non-goals (explicitly OUT)
- **No source-component edits.** `EmptyState.tsx`, `InputBar.tsx`, `AriChatScreen.tsx`, `ToolProposalCard.tsx`, `MultiSelectPrompt.tsx`, `ClarifyingCard.tsx`, `MessageList.tsx`, `QuickReplyChips.tsx` are NOT touched. They keep importing `lucide-react-native`; the web alias does the work. (Editing them would risk regressing the source-assertion tests for zero benefit.)
- **No native behavior change.** iOS/Android resolution path is untouched; they load the real `lucide-react-native@0.577.0` via react-native-svg exactly as today.
- **No web-shell bug work** (route firewall, glass fallback, nav, auth gates) — that surface is ORCH-1136's per COMMS-0034. This SPEC touches ONLY the lucide-on-web icon system.
- **No change to the other web shims** (`lottieReactNativeWebStub.js`, `reactNativeCompressorWebStub.js`, `reactNativeReanimatedWebStub.js`, `stripeConnectNativeStub.js`) or the zustand-CJS web override.
- **No change to `app-mobile`** (the consumer app has its own lucide handling, out of scope).

### Assumptions
- `lucide-react@0.577.0` exists on npm (verified: npm registry `dist-tags` + version list both confirm `0.577.0`) and shares the exact icon name roster of `lucide-react-native@0.577.0` (same Lucide monorepo release train — verified the native lib in `node_modules` is `0.577.0`).
- Vercel's web build command is `npx expo export -p web && node scripts/inject-mobile-blur-css.mjs` (confirmed `vercel.json`). The CI `web-build-check.yml` runs the same `expo export -p web`. Both exercise the Metro web resolver, so both load the new shim.
- `lucide-react` renders a DOM `<svg>`; under react-native-web a raw `<svg>` inside a `<View>` (which becomes a `<div>`) renders correctly. The icons accept the same `size` (number), `color` (string), `strokeWidth` (number) props the Ari code already passes.

---

## 3. Cross-Surface Impact Declaration (per-surface)

| # | Surface | Covered? | User-visible behavior demanded | Files touched on this surface | Parity |
|---|---------|----------|-------------------------------|-------------------------------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | NOT covered | — (different app; out of scope) | none | n/a |
| 2 | Consumer Android (`app-mobile` Android) | NOT covered | — (different app; out of scope) | none | n/a |
| 3 | Buyer/anon Web (mingla-business public routes) | Covered (incidentally) | Any lucide glyph on a public web route now renders a real icon instead of blank (was a latent gap; no public route is in the reported symptom, but the systemic fix covers it) | the shared web shim | Automatic (shared web alias) |
| 4 | Business iOS | NOT covered (no change) | Unchanged — real lucide renders via react-native-svg exactly as today (must stay byte-identical) | none (native resolution untouched) | n/a |
| 5 | Business Android | NOT covered (no change) | Unchanged — real lucide renders via react-native-svg exactly as today | none | n/a |
| 6 | Admin Web (`mingla-admin`) | NOT covered | — (separate app; already uses `lucide-react`, not the RN lib) | none | n/a |
| 7 | **Business Web preview** (adjacent — THE target) | **Covered** | Every lucide glyph renders a real SVG: the Ari empty-state "+" chip is a visible plus, the send-arrow, header Menu/Settings, and every other in-app lucide icon. An Ari conversation rendering tool-proposal / multi-select / clarifying cards on web no longer crashes (the 6 previously-missing icons now resolve). | `mingla-business/src/shims/lucideReactNativeWebStub.js`, `mingla-business/metro.config.js` (comment only), `mingla-business/package.json` (dep add) | Automatic (web alias) |

This is a HARD gate: the only surface whose behavior changes is **Business Web preview** (#7). Native (#4/#5) MUST remain byte-identical (proven by: the Metro override is `platform === "web"`-gated and this SPEC does not touch that condition).

---

## 4. Layered specification

This is a pure build/bundler-config + presentational-shim fix. No Database, Edge function, Service, Hook, Realtime, or RLS layer is touched. Only the **Bundler / web-shim** layer and **dependency** are in play.

### 4.1 Dependency add (`mingla-business/package.json`)

Add to `dependencies`:

```json
"lucide-react": "0.577.0"
```

- **Why this package:** `lucide-react` is the official pure-DOM React/SVG build of Lucide (provider docs: https://lucide.dev/guide/packages/lucide-react and npm https://www.npmjs.com/package/lucide-react). It renders real inline `<svg>` and has **zero** runtime dependencies (verified: `dependencies: {}`) and only a `react` peer dependency (`^16.5.1 || ^17 || ^18 || ^19`) — no `react-native`, no `react-native-svg`, no Flow types, no `import.meta`. Therefore it bundles clean under react-native-web / Metro web — it cannot reproduce the ORCH-1085 parse break that the original null-stub was created to dodge.
- **Why pinned EXACT `0.577.0` (no caret):** the icon name roster must byte-match `lucide-react-native@0.577.0` already in `dependencies` (verified in `node_modules`). Lucide ships `lucide-react` and `lucide-react-native` from one monorepo on a shared version train; `0.577.0` of both expose the identical named exports (`Plus`, `ArrowUp`, `Menu`, `Settings`, `Check`, `CheckSquare`, `Square`, `AlertTriangle`, `Pencil`, `Play`, `X`, …). An exact pin prevents a future `npm install` from drifting the web roster off the native roster (e.g. an icon renamed/removed between minor versions rendering blank again). `lucide-react@latest` is `1.18.0` — explicitly NOT used (major-version roster drift risk).
- **COMMS-0003 compliance:** provider doc URLs cited inline above for the new external dependency.

### 4.2 Web shim — total real-icon resolver (`mingla-business/src/shims/lucideReactNativeWebStub.js`)

Replace the file's entire body. The new module:

1. Imports `lucide-react`'s full icon namespace (`import * as LucideReact from "lucide-react"` — or the CommonJS `require("lucide-react")` to match the existing shim's `require` style; either is fine since the shim is the resolved module). It also imports one guaranteed-present fallback icon to use when an unknown name is requested (use `HelpCircle`, a stable long-lived Lucide icon; if absent in a future roster the Proxy still must not throw — see step 3).
2. Exports a **`Proxy`** over the icon namespace as the module's value (both `module.exports = proxy` and `module.exports.default = proxy` to satisfy ESM-interop default imports, mirroring the lottie shim's dual export). The Proxy's `get` trap:
   - For a requested string key that exists on the `lucide-react` namespace AND is a render-capable value (function/object component) → return that real icon component.
   - For `default` / `__esModule` / `Symbol` keys / `then` (Promise-detection guard) → return the namespace's own value or `undefined` for `then` as appropriate (so the module isn't mistaken for a thenable), NOT a fake icon.
   - For any other string key that does NOT resolve to a real icon → return the fallback icon component (`HelpCircle` if present, else a tiny inline always-real `forwardRef` SVG component the shim defines locally). **This branch is the F-3 crash-kill: the Proxy NEVER returns `undefined` for an icon-shaped name.**
3. The locally-defined hard fallback (used only if even `HelpCircle` is somehow absent) is a `React.forwardRef` component that returns a minimal real `<svg>` (or `null` is acceptable as the absolute last resort — a blank glyph is strictly better than an `undefined`-typed crash). The contract that MUST hold: **the `get` trap never returns `undefined` for a capitalized icon-name key.**

Illustrative shape (≤3 lines, NOT the implementation):
```js
const Lucide = require("lucide-react");
const Fallback = Lucide.HelpCircle || React.forwardRef((_p, _r) => null);
module.exports = new Proxy({}, { get: (_t, k) => /* real icon | Fallback, never undefined */ });
```

- **Prop pass-through:** lucide-react icons accept `size` (number), `color` (string), `strokeWidth` (number), `absoluteStrokeWidth`, plus standard SVG props — the same API the Ari code passes (`<Plus size={13} color={textTokens.tertiary} strokeWidth={2.25} />`, `<ArrowUp size={18} color="#ffffff" strokeWidth={2.75} />`, `<Menu size={24} .../>`). No prop adaptation needed; the Proxy returns the icon component and props flow straight through.
- **Rendering context:** these glyphs render inside RN `<View>`/`<Text>` siblings which react-native-web compiles to `<div>`/`<span>`; a DOM `<svg>` child renders correctly there. No `react-native-svg` involvement on web.

### 4.3 Metro config (`mingla-business/metro.config.js`) — comment only, NO logic change

The existing web alias (lines 192-197) already routes `lucide-react-native` → `LUCIDE_REACT_NATIVE_WEB_STUB` on `platform === "web"`. That mapping is correct and UNCHANGED — the shim it points to is what changes. Update ONLY the surrounding comment to record that the target now renders real `lucide-react` icons (was a null-stub) per ORCH-1137, so a future reader doesn't "restore" the null-stub. Do not alter the `if (platform === "web")` guard, the `moduleName === "lucide-react-native"` check, or the return shape. (Adding a comment keeps native resolution provably untouched.)

### 4.4 Icon-name set — total resolver chosen over enumeration

The investigation's live audit found exactly 11 lucide names imported across all of `mingla-business/src` (non-test): `AlertTriangle, ArrowUp, Check, CheckSquare, Menu, Pencil, Play, Plus, Settings, Square, X`. The old stub's 12 entries included 7 dead social icons (`AtSign, Facebook, Globe2, Instagram, Linkedin, Music2, Youtube`) with NO current importer, and was MISSING 6 live ones (`AlertTriangle, Check, CheckSquare, Pencil, Play, Square`) — proof that hand-maintained enumeration drifts and silently blanks/crashes.

**Decision: a TOTAL Proxy resolver, not an enumerated list.** Rationale: (a) it covers all 11 current names with zero maintenance; (b) any future `import { NewIcon } from "lucide-react-native"` renders on web automatically — no stub edit, no silent blank, no crash; (c) it structurally kills the F-3 `undefined`-crash class for all time. Provider API reference for the icon set: https://lucide.dev/icons/ (full roster, shared between `lucide-react` and `lucide-react-native` at a given version).

---

## 5. Success criteria

All criteria are Business-Web-only behavior changes (the sole covered surface); native is verified UNCHANGED.

- **SC-1-Web** — On the Ari empty state in the business web preview, the 22×22 bordered hint chip renders a **visible lucide Plus glyph** (a real `<svg>` with the two plus paths), not an empty circle. (Seth's reported symptom; the acceptance bar.)
- **SC-2-Web** — Every other in-app lucide glyph renders a real icon on web: the Ari send-arrow (`ArrowUp`), the AriChatScreen header `Menu` + `Settings`, and `X`. None render blank.
- **SC-3-Web** — Rendering an Ari conversation that mounts tool-proposal / multi-select / clarifying cards on web does NOT crash: `AlertTriangle, Check, CheckSquare, Pencil, Play, Square` all resolve to real components, never `undefined` (kills the F-3 "type is invalid" crash).
- **SC-4-Web** — Requesting an icon name that does NOT exist in `lucide-react` (e.g. a typo or a future-only name) returns a real fallback component, never `undefined` and never a thrown error. (Adversarial / future-proofing.)
- **SC-5-Web** — `npx expo export -p web` completes successfully (exit 0) with the new shim and dependency — the ORCH-1085 build-fix is NOT regressed (no `import.meta` / Flow / react-native-svg parse error introduced by `lucide-react`).
- **SC-6-Native** (verify-unchanged) — iOS and Android still load the real `lucide-react-native` and render all glyphs identically to before. No native resolution path or component source changed. (Proven structurally: the `platform === "web"` guard is untouched and no `.tsx` is edited.)
- **SC-7** — `orch_1057_ari_composer_icons_emptystate.test.ts`, `orch_1101_ari_chat_composer_overhaul.test.ts`, `orch_1101_*` (all four) stay GREEN with no `[TEST-MOD-APPROVED]` amendment (the fix touches no source they assert against).

---

## 6. Invariants

### Preserved
- **ORCH-1085 web-build integrity** (no registry ID; established by `f65f43ca8` + guarded by `web-build-check.yml`): the business web bundle must build via `expo export -p web`. Preserved by choosing `lucide-react` (zero RN deps, no `import.meta`/Flow) and verified by SC-5 + the existing Web Build Check CI job.
- **Native lucide rendering** (de-facto): iOS/Android render real lucide via react-native-svg. Preserved by leaving the `platform === "web"` guard and all native resolution untouched (SC-6).
- The two existing source-assertion test suites (SC-7) — preserved by not editing the asserted source files.

### New (proposed — DRAFT; orchestrator flips ACTIVE on CLOSE)
- **`I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL`** — DRAFT.
  - **Rule:** the business-web `lucide-react-native` shim MUST render real icons (back by `lucide-react`) and MUST NEVER return `undefined` for any requested icon-name key. The Metro web alias for `lucide-react-native` MUST continue to point at that shim. The null-stub pattern (`const IconStub = () => null` exporting a fixed enumerated list) MUST NOT be reintroduced.
  - **Enforcement:** strict-grep gate `i-proposed-1137-biz-web-lucide-real.mjs` (source-structure: shim `require`s/imports `lucide-react`, exports a `Proxy`, contains NO `IconStub = () => null` enumerated map; metro.config.js still aliases `lucide-react-native` → the shim path) PLUS a render/build proof (web export + post-export assertion — see §7/§9).
  - **Regression test:** the gate + render-proof must FAIL when the shim is reverted to the null-stub and PASS when the real-icon shim is restored (fails-on-revert, §9).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | Shim resolves a used icon | `require("lucide-react-native").Plus` via the shim under node | a render-capable component (function/object), NOT `() => null`, NOT undefined; rendering it yields a real `<svg>` element | Shim unit (node/jest) |
| T-2 (happy) | All 11 live names resolve | each of `AlertTriangle, ArrowUp, Check, CheckSquare, Menu, Pencil, Play, Plus, Settings, Square, X` read off the shim | every one is a real component (typeof function/object), none `undefined` | Shim unit |
| T-3 (error/adversarial) | Unknown icon name | `shim.ThisIconDoesNotExist1137` | returns the real fallback component, NOT `undefined`, NO throw | Shim unit |
| T-4 (adversarial) | Promise/thenable guard | `shim.then` | does not return a faux-icon that would make the module look thenable (returns undefined for `then` only) | Shim unit |
| T-5 (edge) | default + esModule interop | `shim.default`, `shim.__esModule` | `default` is the proxy/namespace (default-import works), `__esModule` not coerced into a fake icon | Shim unit |
| T-6 (build proof) | Web export builds | `npx expo export -p web` with the new shim + dep | exit 0, bundle produced (ORCH-1085 not regressed) | Web build (CI `web-build-check.yml`) |
| T-7 (render proof) | Real SVG in web bundle | post-export grep of the web bundle for a lucide path signature (e.g. the Plus path `M5 12h14` / `M12 5v14`, present in `lucide-react`'s Plus, ABSENT in the null-stub) | the path signature is PRESENT in the exported web JS (proves real glyphs shipped, not `() => null`) | Web build proof |
| T-8 (source-assert regress) | Existing Ari tests | run `orch_1057_*` + `orch_1101_*` | all green, unchanged | Source-assertion (jest) |
| T-9 (native-unchanged) | Native resolution untouched | `metro.config.js` still gates the alias on `platform === "web"`; no `.tsx` edited | gate asserts the web-only guard + alias intact | Strict-grep |

T-1..T-5 run as a jest suite that `require`s the shim directly (node testEnvironment, matching the existing CI pattern). T-6/T-7 run in `web-build-check.yml`. T-8 is the existing suites. T-9 is part of the new strict-grep gate.

---

## 8. Implementation order

1. **Dependency** — add `"lucide-react": "0.577.0"` to `mingla-business/package.json` `dependencies`; run `npm install` in `mingla-business` to update the lockfile (commit the lockfile change).
2. **Shim** — rewrite `mingla-business/src/shims/lucideReactNativeWebStub.js` as the total `lucide-react`-backed Proxy resolver (§4.2), with the never-undefined fallback contract.
3. **Metro comment** — update the comment above the `lucide-react-native` web alias in `metro.config.js` (§4.3); NO logic change.
4. **Shim unit test** — add `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim.test.ts` covering T-1..T-5 (require the shim, assert real components + never-undefined + fallback + interop). fails-on-revert against the null-stub.
5. **Strict-grep gate** — add `.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs` (with `--self-test`) covering T-9 + the shim-structure rule; register one job in `.github/workflows/strict-grep-mingla-business.yml` and add the registry comment line.
6. **Web build-proof extension** — extend `.github/workflows/web-build-check.yml` with a post-export step asserting the lucide Plus path signature is present in the exported web bundle (T-7). (The export itself, T-6, already runs.)
7. **Run gates locally** — `npx expo export -p web` (T-6), the post-export grep (T-7), the shim jest suite (T-1..T-5), `orch_1057`/`orch_1101` suites (T-8), the new strict-grep `--self-test` + run (T-9).

---

## 9. Regression prevention (fails-on-revert)

**Structural safeguard:** the total Proxy shim makes the failure class structurally impossible — there is no enumerated list to drift and no path that returns `undefined` for an icon name.

**Fails-on-revert contract (two independent catchers):**
1. **Shim unit test** (`orch_1137_lucide_web_shim.test.ts`): asserts (a) `shim.Plus` is a real render-capable component whose render output contains the Plus SVG path, (b) all 11 live names resolve, (c) an unknown name returns a non-undefined fallback. Reverting the file to `const IconStub = () => null` + the 12-entry map flips T-1 (Plus renders an SVG path) and T-3 (unknown name) RED, and re-applying the real shim flips them GREEN. The test carries a protective comment: *"ORCH-1137 — the business-web lucide shim renders REAL lucide-react icons and NEVER returns undefined for any name. Do not restore the `() => null` null-stub: it blanks every web glyph (Ari + chrome) and crashes any web Ari conversation that mounts an icon name outside the old 12-entry list."*
2. **Strict-grep gate** (`i-proposed-1137-biz-web-lucide-real.mjs`): asserts the shim source `require`s/imports `lucide-react` + exports a `Proxy` + contains NO `IconStub = () => null`, AND `metro.config.js` still aliases `lucide-react-native` → the shim on the web platform. The gate ships with `--self-test` (a synthetic null-stub fixture must FAIL the gate; the real shim must PASS), satisfying the established gate convention.
3. **Web render-proof** (`web-build-check.yml` post-export step): the lucide Plus path signature must appear in the exported web bundle. Reverting to the null-stub removes all real glyphs → the signature vanishes → the check fails.

---

## 10. Open questions

None blocking. Two notes for the implementor (not decisions to make blindly):

- **Q-A (CommonJS vs ESM in the shim):** the current shim uses `require`/`module.exports`. `lucide-react@0.577.0` ships both `main` (CJS `dist/cjs/lucide-react.js`) and `module` (ESM). Metro web will resolve whichever the shim's `require("lucide-react")` picks (CJS via `main`). Keep the shim CJS (`require` + `module.exports`) to match the sibling shims and avoid an ESM/CJS interop surprise in the resolver. If `require("lucide-react")` returns an object whose icons are under `.default`, unwrap it in the Proxy target. The implementor verifies the resolved shape at IMPLEMENT (a 2-line node probe), not by guessing.
- **Q-B (fallback icon choice):** `HelpCircle` is the suggested unknown-name fallback (stable, recognizable "unknown" affordance). If the implementor prefers `null` for unknown names (blank but never a crash), that ALSO satisfies SC-3/SC-4 — the load-bearing contract is "never `undefined`", not "always a visible glyph for unknown names". Either is acceptable; document the choice in the implementation report.

---

## 11. Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY change ONLY these)
- `mingla-business/package.json` (add `lucide-react@0.577.0` dependency)
- `mingla-business/package-lock.json` (lockfile update from the install)
- `mingla-business/src/shims/lucideReactNativeWebStub.js` (full rewrite — the fix)
- `mingla-business/metro.config.js` (comment ONLY, above the existing lucide alias)
- `mingla-business/src/shims/__tests__/orch_1137_lucide_web_shim.test.ts` (NEW)
- `.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (add ONE job + registry comment line)
- `.github/workflows/web-build-check.yml` (add ONE post-export render-proof step)

### DO-NOT-TOUCH
- Any `.tsx`/`.ts` source under `mingla-business/src/components/ari/` or `mingla-business/src/screens/ari/` — the components keep importing `lucide-react-native` unchanged. (Editing them would risk the source-assertion tests for no benefit.)
- The `platform === "web"` guard, the `moduleName === "lucide-react-native"` branch logic, and any other shim mapping in `metro.config.js` (zustand, lottie, compressor, reanimated, stripe-connect).
- The other web shims (`lottieReactNativeWebStub.js`, `reactNativeCompressorWebStub.js`, `reactNativeReanimatedWebStub.js`, `stripeConnectNativeStub.js`).
- `app-mobile/`, `mingla-admin/`, `supabase/`, `packages/`.
- The existing `orch_1057_*` / `orch_1101_*` test files (must pass UNMODIFIED — a change there is a red flag the fix widened wrongly).

If the implementor finds the fix needs anything outside this allowlist, STOP and request a SPEC amendment (`SPEC_AMENDMENT_ORCH-1137_*.md` or in-file append). Do not silently widen.

#### SPEC AMENDMENT — 2026-06-14 (implementor, REWORK)

**+ `mingla-business/jest.config.cjs` (transform + transformIgnorePatterns ONLY).**

The original SPEC assumed the shim could back its Proxy with a `require("lucide-react")`
barrel import (the form the first IMPLEMENT shipped). The REWORK proved that import
DEFEATS Metro tree-shaking — the `"lucide-react"` barrel entry statically references all
~1700 icons (`sideEffects:false` notwithstanding), so the whole roster lands in the eager
web `__common` boot chunk (4,030,203 bytes, ~1.78MB over the ORCH-1083 2.25MB cap → the
RED CI check this rework fixes). The only import form Metro CAN tree-shake is the DEEP
per-icon module path `lucide-react/dist/esm/icons/<kebab>.js`. Those deep modules use ESM
`export` syntax, which jest-runtime cannot load as bare CJS (the default jest config
ignores all of `node_modules` for transforms). Making the shim testable under jest
therefore requires a NARROWLY-SCOPED transform of ONLY `lucide-react` in
`jest.config.cjs` (a `lucide-react/.+\.js$` → babel-jest entry + a
`transformIgnorePatterns: ["/node_modules/(?!lucide-react/)"]`). babel-preset-expo is
already a dependency; no new dep is added. Verified beneficial-only: the full business
jest suite goes from 82 failing suites to 80 (the two ORCH-1137 shim suites flip GREEN),
with ZERO newly-failing suites — the 153 pre-existing unrelated failures are unchanged.
This is a test-infra adjustment strictly required by the budget-driven import-form change,
not a product-scope widening.

---

## Downstream routing

- **Next:** `mingla-implementor` (IMPLEMENT) — build per this SPEC in the ORCH-1137 worktree.
- **Then:** `mingla-tester` — verify SC-1..SC-7, including a REAL `expo export -p web` web-build proof + the render-proof grep, and ideally a live web render of the Ari empty state showing the visible "+". Native unchanged is a structural verify.
- **Then:** `mingla-orchestrator` CLOSE — flip `I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL` to ACTIVE, resolve COMMS-0034, and apply COMMS-0027 OTA hygiene only if any native re-publish is performed (web ships via Vercel export, not an EAS OTA).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1137-[ari-emptystate-plus-glyph]/` on branch `ORCH-1137-ari-emptystate-plus-glyph`.
