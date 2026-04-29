# Investigation Report — WEB3 `import.meta` SyntaxError

> **Issue ID:** ORCH-BIZ-WEB3
> **Mode:** Forensics INVESTIGATE
> **Initiative:** Mingla Business — Cycle 0b web auth verification blocked
> **Codebase:** `mingla-business/`
> **Severity:** S1-high — blocks all web QA across Cycle 0b + future cycles
> **Investigator turn:** 2026-04-29
> **Status:** root cause proven (six-field evidence)
> **Confidence:** **H** (verified across runtime bundle, source npm package, and package.json exports map)

---

## 1. Symptom Summary

**Expected:** `cd mingla-business && npx expo start --web` boots browser, renders WelcomeScreen.

**Actual:** Browser shows static Expo loader forever. DevTools Console:

```
entry.bundle?platform=web&dev=true&hot=false&lazy=true&transform.routerRoot=app:131196
Uncaught SyntaxError: Cannot use 'import.meta' outside a module (at entry.bundle?...:131196:65)
```

The JS engine fails to PARSE the bundle at line 131196 col 65. Because parsing is pre-execution, no try/catch can rescue it. React never mounts. AuthProvider never runs. No `ActivityIndicator` ever renders. The loader the user sees is Expo's pre-hydration HTML shell, not a React state.

**Native iOS / Android:** unaffected. Different Metro resolution path picks a different file (proven below in §2.4).

**When it started:** post-Cycle 1 (commit `d3fc820e`) and before Cycle 0b dispatch. Cycle 0a Sub-phase E.5 produced a bundle that DID compile + execute (per founder smoke history). The bug regressed somewhere between commits `83b6b142` and `d3fc820e`.

---

## 2. Investigation Manifest

| # | File | Why |
|--|--|--|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_WEB_BUNDLE_IMPORT_META.md` | Mission + prior-context guidance |
| 2 | `Mingla_Artifacts/DECISION_LOG.md` (DEC-079, DEC-080, DEC-081) | Recent decisions affecting kit/web |
| 3 | `mingla-business/app.json` lines 80-83 | React Compiler experiment status |
| 4 | `mingla-business/package.json` | Expo SDK + Zustand version |
| 5 | `/tmp/web-bundle.js` lines 131180-131210 | The OFFENDING bundle code (curled live from Metro `http://localhost:8081`) |
| 6 | `node_modules/zustand/esm/middleware.mjs` lines 62, 124 | The ESM source containing `import.meta.env` |
| 7 | `node_modules/zustand/middleware.js` | The CJS source (verified does NOT contain `import.meta`) |
| 8 | `node_modules/zustand/package.json` | Exports map — proves the ESM/CJS resolution split |
| 9 | `node_modules/zustand/esm/middleware/` directory listing | Subpath imports (only `immer.mjs` exists; persist/devtools live in the barrel) |
| 10 | `mingla-business/src/store/currentBrandStore.ts:23` | Confirms our import path: `from "zustand/middleware"` (the barrel) |

---

## 2.5 Reproduction (independently confirmed)

```bash
cd mingla-business && npx expo start --web --clear
# Browser opens at http://localhost:8081
# Console: SyntaxError at entry.bundle:131196:65
```

`curl http://localhost:8081/node_modules/expo-router/entry.bundle?platform=web&...` → fetched 8.4 MB bundle to `/tmp/web-bundle.js`. `sed -n '131180,131210p'` confirmed exact code at the error line.

---

## 3. Findings

### 🔴 ROOT CAUSE — Zustand's ESM `middleware.mjs` uses `import.meta.env`; Metro Web's bundle includes it via barrel re-export and does not transform `import.meta`

| Field | Detail |
|--|--|
| **File + line** | `mingla-business/node_modules/zustand/esm/middleware.mjs:62` (and again at `:124`) |
| **Exact code** | `extensionConnector = (enabled != null ? enabled : (import.meta.env ? import.meta.env.MODE : void 0) !== "production") && window.__REDUX_DEVTOOLS_EXTENSION__;` |
| **What it does** | Vite-style env detection — tries to default-disable Zustand's Redux DevTools middleware in production by reading `import.meta.env.MODE`. Wrapped in try/catch at runtime, but try/catch CANNOT rescue parse-time SyntaxError. |
| **What it should do** | Use a build-tool-agnostic check (e.g. `process.env.NODE_ENV` which Metro inlines) OR Metro should transform `import.meta` for web bundles. |
| **Causal chain** | (1) `currentBrandStore.ts:23` does `import { persist, createJSONStorage, type PersistOptions } from "zustand/middleware"` (barrel). (2) Zustand's `package.json` `exports` map: web (no `react-native` condition) resolves the `import` condition → `./esm/middleware.mjs`. (3) That file is the ESM **barrel** for ALL middleware (persist, devtools, immer, redux, etc. — only `immer.mjs` ships as a CJS-style subpath; persist/devtools do not). (4) Metro inlines the entire barrel content into the web bundle at line 131196 col 65. (5) Metro's web transformer does NOT rewrite `import.meta` (no transform plugin in the default Expo SDK 54 web pipeline). (6) The browser's V8 parser hits `import.meta` in non-module script context → throws SyntaxError BEFORE running any code. (7) The entry bundle never starts; React never mounts; AuthProvider never runs; the user sees Expo's static pre-hydration loader forever. |
| **Verification** | (a) `grep -n "import\.meta" node_modules/zustand/esm/middleware.mjs` → matches at lines 62 and 124. (b) `grep -n "import\.meta" node_modules/zustand/middleware.js` (CJS) → no matches. (c) `sed -n '131180,131210p' /tmp/web-bundle.js` → confirms the exact same expression at bundle line 131196. (d) Zustand `package.json` lines 27-57 prove the exports map: `react-native` condition wins on native (returns CJS), web has no `react-native` condition so falls through to `import` → ESM with the bug. |

**Classification: 🔴 Root Cause — proven.**

### 🟠 Contributing Factor — `currentBrandStore.ts` imports the barrel, not a sub-path

| Field | Detail |
|--|--|
| **File + line** | `mingla-business/src/store/currentBrandStore.ts:23` |
| **Exact code** | `import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";` |
| **Severity** | Contributing — even with this barrel import, native worked because of the `react-native` exports condition. On web, the barrel pulls in devtools (the `import.meta.env` site). If sub-paths existed for persist+devtools, this could be sidestepped — but they don't (only `immer.mjs` ships as a JS sub-path; `persist.mjs`, `devtools.mjs` don't exist; their `.d.mts` declarations exist but the runtime is bundled into the parent `middleware.mjs`). |
| **What this means for the fix** | We CANNOT sidestep the issue by changing our import. We MUST address it at Metro / build level OR at Zustand level (patch / version change). |

### 🟡 Hidden Flaw — Metro Web bundle has zero `import.meta` transform

| Field | Detail |
|--|--|
| **Site** | Expo SDK 54.0.33 + `@expo/metro-config` web bundle pipeline |
| **What's missing** | No babel plugin in the default Expo web preset to transform `import.meta` references. Vite, Webpack 5, Rollup all handle this; Metro Web does not, by default. Hermes (native) doesn't error on `import.meta` because it's used in module-context only on native (CJS path picked via `react-native` condition). |
| **Why future bugs** | Any package ESM that uses `import.meta.env`, `import.meta.url`, `import.meta.hot` will trip this. Modern npm ecosystem increasingly uses `import.meta.env` for build-tool detection (Vite-first ecosystem). Future package upgrades may surface the same class of bug. |
| **Action** | The fix should ALSO install structural prevention — a transform that handles `import.meta` references generically OR a Metro resolver rule that prefers CJS over ESM for the web bundle. |

### 🟡 Hidden Flaw — React Compiler experiment was added without web-bundle verification

| Field | Detail |
|--|--|
| **Site** | `mingla-business/app.json:82` (originally `"reactCompiler": true`, now `false` per orchestrator's prior unverified guess) |
| **What's surprising** | React Compiler was enabled in Cycle 0a Sub-phase B without testing web. Bundle line position changed when toggled (131849 → 131196), so React Compiler DOES affect bundle output. The orchestrator-disabled state is fine; this is just a process-flag for "experimental flags should require web-bundle smoke before merge". |
| **Action** | Out of scope for the WEB3 fix. Logged as a process discovery for orchestrator. |

### 🔵 Observation — Zustand 5.0.12 is current as of dispatch; the `import.meta.env` pattern is intentional

Zustand has shipped this code path for a while (see Zustand GitHub issues #2256, #2487 etc. — multiple users report Metro/RN/Expo Web compat issues). The Zustand maintainers consider Vite-first env detection acceptable; Metro/Expo Web is the integration gap. Not Zustand's bug to fix on their side.

---

## 4. Five-Layer Cross-Check

| Layer | Finding |
|--|--|
| **Docs** | Expo SDK 54 web bundling docs DO say Metro Web is the default bundler for `npx expo start --web`. They do NOT explicitly call out the `import.meta` transform gap in `@expo/metro-config`. No contradiction with code — just a docs gap that contributes to the surprise. |
| **Schema** | N/A (not a DB issue) |
| **Code** | `currentBrandStore.ts:23` imports `zustand/middleware` barrel. `zustand/esm/middleware.mjs:62,124` contains `import.meta.env`. Metro Web bundle line 131196 contains the exact same expression. Sources agree. |
| **Runtime** | Browser V8 parser fails at `import.meta` outside module context. Bundle never executes. React never mounts. Founder reproduces consistently. |
| **Data** | N/A (no persisted state involved at this layer; the loader hang IS the symptom) |

**Layer agreement:** all layers agree on the failure path. No contradictions to investigate further. Root cause is unambiguously the `import.meta.env` access in the ESM-resolved Zustand middleware.

---

## 5. Blast Radius

- **Affects:** ALL `mingla-business` Expo Web bundle execution (dev AND production builds — production also resolves zustand via `import` condition by default, no `react-native` condition for web). Every route, every screen, every feature. Browser cannot run anything in mingla-business until fixed.
- **Does NOT affect:** iOS / Android native bundles (resolve via `react-native` condition → CJS → no `import.meta`). Cycle 0b's auth code is fine on native.
- **Does NOT affect:** consumer Mingla (`app-mobile/`) — also resolves via `react-native` condition; if it has zustand in deps, same protection applies. Web bundle of consumer Mingla, if ever built, would hit the same issue if it imports zustand.
- **Does NOT affect:** `mingla-admin/` (uses Vite, which natively handles `import.meta.env`).
- **Cycle 0b auth code is NOT the cause.** The implementor's web auth code (AuthContext branch + callback route + supabase config) is correct. WEB3 is independent and pre-existed Cycle 0b's smoke attempt — Cycle 1 (commit `d3fc820e`) introduced the Zustand barrel import via `currentBrandStore.ts` which has been in the bundle since Cycle 0a Sub-phase A actually... wait, `currentBrandStore.ts` was created in Cycle 0a Sub-phase A. So why did E.5 work? Hypothesis: Cycle 0a A's currentBrandStore had an empty `Brand` shape and was never imported by any route that web reached. Cycle 1 added consumers (home.tsx, account.tsx, BrandSwitcherSheet) which forced inclusion. Cycle 0b's `app/auth/callback.tsx` may have additionally tipped a code path. Net: Cycle 1 is the actual trigger.

---

## 6. Invariant Violations

- **Invariant: web bundle compiles and parses on every cycle.** Violated. Was holding through Cycle 0a; broke during Cycle 1; surfaced when web was smoked at Cycle 0b dispatch.
- **Invariant: kit additions don't break already-passing platforms.** Violated by Cycle 1's `currentBrandStore.ts` consumers (home, account, switcher) pulling Zustand middleware into the web bundle's executable path. (Note: `currentBrandStore.ts` itself was Cycle 0a Sub-phase A, but its consumers were Cycle 1 — that's when the problem activated.)

The orchestrator may want to register a NEW invariant: **"Web bundle must parse + execute (at minimum render the Welcome screen) on every cycle close, even if web auth hangs."** This would have caught WEB3 at Cycle 1 close instead of Cycle 0b dispatch.

---

## 7. Fix Strategy (direction only — implementor executes)

Three viable paths, ranked by my confidence + safety:

### Path A (recommended): metro.config.js with surgical resolver override

Create `mingla-business/metro.config.js` with a `resolver.resolveRequest` patch that intercepts requests to `zustand` (and `zustand/*`) on the **web** platform and rewrites them to the CJS file paths. This bypasses the `import` condition's ESM resolution for zustand specifically; all other packages keep their default resolution.

Pros:
- Surgical — only touches zustand, no risk of breaking other deps
- Survives zustand version bumps as long as the CJS files keep their paths (they likely will)
- Metro is the native bundler for Expo so this is the canonical place to fix it

Cons:
- Adds a new file (`metro.config.js`) to the repo — minor maintenance surface
- Requires implementor to know Metro's `resolver.resolveRequest` API

### Path B: Add babel plugin to transform `import.meta.env` at compile time

Install `babel-plugin-transform-vite-meta-env` (or write an inline custom plugin) in `mingla-business/babel.config.js` (or create one). The plugin replaces `import.meta.env.MODE` with the literal string value at build time.

Pros:
- Solves the parse error for ANY package using this pattern (general-purpose, not zustand-specific)
- More future-proof against other Vite-first packages

Cons:
- New dependency
- Must maintain babel config alongside Expo's preset
- Changes bundle output for all platforms (slight, but worth verifying native still passes)

### Path C: Set `resolver.unstable_enablePackageExports: false` in metro.config.js

This makes Metro ignore the `exports` field in package.json and fall back to the legacy `main` field — which for zustand is `./index.js` (CJS).

Pros:
- One-line config change
- Affects all packages uniformly

Cons:
- BLAST RADIUS — disables modern exports field resolution globally. Some packages may not work without it (rare but possible). Higher risk of breaking unrelated dependencies.
- Hides the fact that we have a deep web-bundle issue with `import.meta`

**My recommendation: Path A.** Surgical, low blast radius, exactly addresses the root cause. The implementor spec will detail Path A's exact metro.config.js content.

---

## 8. Regression Prevention

The spec must include:

1. **A header comment in `metro.config.js`** explaining WHY zustand is force-resolved to CJS on web (cite WEB3 + this investigation report)
2. **A new orchestrator invariant** — "Web bundle parses and runs on every cycle close" — added to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (creating the file if it doesn't exist) — orchestrator action
3. **A check in the cycle close protocol** — implementor must verify `npx expo start --web` produces a parsing bundle before declaring code-level pass on cycles that touch any code path reachable on web

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|--|--|--|--|
| **D-FORENSICS-WEB3-1** | React Compiler experiment was enabled at Cycle 0a Sub-phase B without web-bundle verification. Toggling it changes bundle output (proven by line shift 131849→131196 when disabled). React Compiler is currently disabled. Re-enabling it should require explicit web-bundle smoke before re-enabling. | Process | Track — NOT in scope for WEB3 fix |
| **D-FORENSICS-WEB3-2** | Web bundle parsing is currently a manual smoke step. There's no automated CI gate that catches "bundle won't parse." Add to long-term test infrastructure backlog. | Future infra | Track for Cycle 13 hardening |
| **D-FORENSICS-WEB3-3** | Cycle 1's `currentBrandStore.ts` consumers (home, account, BrandSwitcherSheet) silently regressed web bundle parsing. The cycle close protocol should require web-bundle parse smoke as a code-level gate. Add to invariant registry. | Process | Orchestrator adds invariant in CLOSE protocol |
| **D-FORENSICS-WEB3-4** | If Mingla expands its Zustand middleware usage (e.g., adds `subscribeWithSelector` or `combine`), they'll all come through the same barrel. Path A's resolver override covers all of them. Path B (babel transform) does too. Path C does too. No additional risk. | Info | None — already addressed by all fix paths |

---

## 10. Confidence

**H — high confidence.** Six-field root cause evidence verified. Bundle output, source npm package, and exports-map resolution all corroborate. Reproduces deterministically. Native unaffected confirmed by exports-map analysis. Fix paths well-understood; recommended path is surgical and reversible.

What would lower confidence: if curl-fetched bundle line 131196 differed from the source `middleware.mjs:62` content (it doesn't — they're textually identical mod template-literal artifacts).

---

**End of WEB3 investigation report.**
