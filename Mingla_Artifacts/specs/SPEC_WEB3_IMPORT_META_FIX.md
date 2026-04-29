# Spec — WEB3 Web Bundle `import.meta` Fix

> **Issue ID:** ORCH-BIZ-WEB3
> **Mode:** Forensics SPEC (companion to `Mingla_Artifacts/reports/INVESTIGATION_WEB3_IMPORT_META.md`)
> **Codebase:** `mingla-business/`
> **Confidence:** H
> **Authored:** 2026-04-29
> **Status:** READY-TO-DISPATCH (implementor)

---

## 1. Scope

**In scope:**
- Add `mingla-business/metro.config.js` with a surgical resolver override that forces Metro Web to resolve `zustand` and `zustand/*` to the CJS files (avoiding the ESM `import.meta.env` site).
- Verify the web bundle parses + executes after the change.
- Verify native iOS / Android bundles continue to resolve `zustand` via the `react-native` exports condition (no regression).

**Non-goals:**
- ❌ Touching Cycle 0b auth code — root cause is independent of auth (per investigation §5)
- ❌ Patching `node_modules/zustand/esm/middleware.mjs` directly (fragile across reinstalls — `patch-package` is overkill for this scoped fix)
- ❌ Adding `babel-plugin-transform-vite-meta-env` (Path B in investigation §7) — out of scope; Path A is surgical and sufficient
- ❌ Setting `resolver.unstable_enablePackageExports: false` (Path C in investigation §7) — too high blast radius
- ❌ Re-evaluating React Compiler experiment status (logged as D-FORENSICS-WEB3-1, deferred)

**Assumptions:**
- Expo SDK 54.0.33 + Metro bundled with `@expo/metro-config` is the active web bundler.
- `mingla-business/metro.config.js` does NOT currently exist (verified via `ls` during investigation). If it does exist post-investigation, the implementor must merge into it instead of overwriting.
- Zustand version stays at `^5.0.12` (or a similar version where the ESM/CJS split per package.json `exports` map is intact).

---

## 2. Layer-by-layer changes

### Layer: Metro bundler config

**File:** `mingla-business/metro.config.js` (NEW)

**Exact content:**

```javascript
// Copyright Mingla. Bundler config.
//
// Cycle 0b WEB3 fix (per Mingla_Artifacts/specs/SPEC_WEB3_IMPORT_META_FIX.md):
// Force Metro Web to resolve `zustand` to the CJS build instead of the ESM
// build. The ESM file `node_modules/zustand/esm/middleware.mjs` uses
// `import.meta.env.MODE` for Vite-style env detection (Zustand devtools
// middleware, lines 62 and 124). Metro Web does not transform `import.meta`,
// so the bundle fails to parse with `SyntaxError: Cannot use 'import.meta'
// outside a module` at runtime.
//
// Native iOS/Android resolve via the `react-native` exports condition →
// CJS path, no `import.meta`. This override only kicks in for the web
// platform, leaves native resolution untouched.
//
// Reversible: when Metro adds a built-in `import.meta` transform, OR when
// Zustand stops shipping `import.meta.env` in its ESM build, this override
// can be removed.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

const ZUSTAND_CJS_ROOT = path.join(__dirname, "node_modules", "zustand");

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only intervene on the web platform. Native (ios/android) keeps the
  // default resolution which picks the `react-native` exports condition.
  if (platform === "web") {
    if (moduleName === "zustand") {
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "index.js"),
        type: "sourceFile",
      };
    }
    if (moduleName === "zustand/middleware") {
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "middleware.js"),
        type: "sourceFile",
      };
    }
    if (moduleName.startsWith("zustand/middleware/")) {
      const subpath = moduleName.slice("zustand/middleware/".length);
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, "middleware", `${subpath}.js`),
        type: "sourceFile",
      };
    }
    if (moduleName.startsWith("zustand/")) {
      const subpath = moduleName.slice("zustand/".length);
      return {
        filePath: path.join(ZUSTAND_CJS_ROOT, `${subpath}.js`),
        type: "sourceFile",
      };
    }
  }

  // Fall through to default Metro resolution for everything else (and for
  // non-web platforms).
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

**What this does:**
1. Loads Expo's default Metro config via `getDefaultConfig(__dirname)`.
2. Wraps `config.resolver.resolveRequest` with a custom function.
3. When `platform === "web"` AND the module name starts with `zustand`, returns a hard-coded path to the CJS file in `node_modules/zustand/...`.
4. For all other resolves (native platforms, non-zustand requests), delegates to the original resolver (or Metro's `context.resolveRequest` if no original was set).

**Why type: "sourceFile":** Per Metro's `resolveRequest` API, this is the canonical return shape for a successful module-path resolution.

**Why use `node:path`:** Modern Node convention; resolves to `path` module without ambiguity.

### Layer: Source code

**No source code changes.** The fix is bundler-config only. `currentBrandStore.ts` continues to import `from "zustand/middleware"` exactly as it does today.

### Layer: Documentation

**No docs changes required for this spec.** Decision-log entries are orchestrator's domain post-PASS.

### Layer: Tests

No automated test added in this spec — the fix is verified via runtime smoke (bundle compiles + runs). A future cycle can add a CI gate that runs `npx expo export --platform web` and fails on parse errors; that's tracked as **D-FORENSICS-WEB3-2** (out of scope here).

---

## 3. Success criteria

1. **`mingla-business/metro.config.js` exists** with the exact content of §2 (or a structurally-equivalent merge if the file pre-exists).
2. **`cd mingla-business && npx expo start --web --clear`** produces a bundle that loads in the browser **WITHOUT** the `Cannot use 'import.meta' outside a module` SyntaxError.
3. **Browser at `http://localhost:8081` renders the BusinessWelcomeScreen** (the React app boots — even if WEB2 had been the issue, with WEB2 already addressed in Cycle 0b's auth changes, the Welcome screen should appear).
4. **iOS smoke unchanged:** `cd mingla-business && npx expo start --dev-client` on iPhone → existing native auth flow works, no regression.
5. **Android smoke unchanged:** same as iOS on Android device → existing native auth flow works, no regression.
6. **`npx tsc --noEmit`** still exits 0 — pure JS config file shouldn't affect TS, but verify.
7. **Brand store still works:** sign in (any platform) → Account → "Seed 4 stub brands" → Home shows Sunday Languor with the live KPI hero. Confirms Zustand persist still works post-CJS-resolution-on-web.

---

## 4. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Web bundle parses | `npx expo start --web --clear` + browser at `:8081` | No `import.meta` SyntaxError; React boots; Welcome screen renders | Bundle |
| T-02 | iOS native unaffected | `npx expo start --dev-client` on iPhone, sign in with Google | Existing flow works → Home loads → seed brands → switcher works | Mobile native |
| T-03 | Android native unaffected | Same as T-02 on Android | Same as T-02 | Mobile native |
| T-04 | tsc clean | `cd mingla-business && npx tsc --noEmit` | Exit code 0, no errors | Type check |
| T-05 | Zustand persist works on web | Web → sign in → seed → switch brand → refresh page | Brand selection persists across reload (localStorage rehydrates) | Bundle + runtime |
| T-06 | Zustand persist works on native | iOS / Android → seed → switch brand → kill + relaunch app | Brand selection persists (AsyncStorage rehydrates) | Mobile native + runtime |
| T-07 | metro.config.js merge case | If file already exists, merge instead of overwrite | Existing config preserved + zustand override layered on top | Implementor diligence |

---

## 5. Implementation order

1. **Verify `mingla-business/metro.config.js` does NOT exist** (`ls mingla-business/metro.config.js` → expect "No such file"). If it DOES exist, STOP and surface — implementor must merge instead of overwrite.
2. **Create `mingla-business/metro.config.js`** with the exact content from §2.
3. **Verify file exists + content matches.**
4. **Run** `cd mingla-business && npx tsc --noEmit` — must exit 0.
5. **Founder smoke gate** (T-01): `npx expo start --web --clear` → browser opens at `:8081` → Welcome screen renders → DevTools console clean of `import.meta` SyntaxError. **Founder runs, implementor cannot.**
6. **Founder smoke gate** (T-02 + T-03): iOS + Android dev clients still work for sign-in. **Founder runs.**
7. **Founder smoke gate** (T-05): on web, sign in (Google or Apple OAuth-redirect from Cycle 0b) → seed brands → switch brand → refresh page → brand persists.
8. **Founder smoke gate** (T-06): on iOS / Android, seed → switch → cold-relaunch → brand persists.
9. **Implementor writes report** at `Mingla_Artifacts/reports/IMPLEMENTATION_WEB3_IMPORT_META_FIX.md` covering the 6 tests + verification matrix.
10. **STOP** — hand back to orchestrator for review + close + commit.

---

## 6. Invariants (preserve + new)

| ID | Description | How preserved |
|--|--|--|
| I-1 | designSystem.ts not touched | Out of scope |
| I-2 | Auth flow on iOS/Android unchanged | metro.config.js only intervenes on `platform === "web"` — native paths bit-identical to pre-fix |
| I-3 | iOS / Android / web all render | T-01, T-02, T-03 |
| I-4 | No imports from `app-mobile/` | Out of scope |
| I-5 | Mingla = experience app | Out of scope |
| I-6 | tsc strict clean | T-04 |
| I-7 | No silent failures | The fix surfaces as either web bundle compiling OR breaking — no swallow paths added |
| I-8 | No Supabase code touched | Out of scope |
| I-9 | No animation timings touched | Out of scope |
| I-10 | No currency / copy changes | Out of scope |
| **I-NEW (proposed)** | Web bundle must parse and load the Welcome screen on every cycle close | Cycle close gate per orchestrator. Spec recommends it; orchestrator decides. |
| DEC-079 | Kit-closure carve-out | Out of scope (no kit changes) |
| DEC-080 | TopSheet primitive carve-out | Out of scope |
| DEC-081 | mingla-web discontinued | Honoured — fix lives entirely in `mingla-business/` |

---

## 7. Regression prevention

1. **Header comment in metro.config.js** explains WHY the resolver override exists, citing WEB3 + the investigation report. Future maintainers reading the file see the rationale.
2. **The override is reversible** — if Metro adds an `import.meta` transform OR Zustand stops shipping `import.meta.env` in its ESM build, the override block can be deleted with no other source changes.
3. **Orchestrator action (out of spec scope, recommended):** add the proposed I-NEW invariant to `INVARIANT_REGISTRY.md` so future cycles must verify web bundle parsing at code-level close.

---

## 8. Implementor handoff checklist

Before declaring this spec implemented, the implementor MUST confirm:

- [ ] `metro.config.js` exists with the §2 content
- [ ] `npx tsc --noEmit` exits 0
- [ ] T-01 passes (web bundle parses, Welcome renders)
- [ ] T-02 passes (iOS native unchanged)
- [ ] T-03 passes (Android native unchanged)
- [ ] T-05 passes (web persist works post-restart)
- [ ] T-06 passes (native persist works post-cold-launch)
- [ ] Report written at `Mingla_Artifacts/reports/IMPLEMENTATION_WEB3_IMPORT_META_FIX.md`
- [ ] AGENT_HANDOFFS.md entry pending for orchestrator (orchestrator does the entry)

---

**End of WEB3 fix spec.**
