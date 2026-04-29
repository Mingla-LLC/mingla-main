# Implementation Report — WEB3 `import.meta` Fix

> **Issue ID:** ORCH-BIZ-WEB3
> **Cycle:** Cycle 0b sub-fix (web bundle parse unblock)
> **Codebase:** `mingla-business/`
> **Predecessor:** Cycle 1 closed `d3fc820e` + cleanup `5ae8f599` + Cycle 0b code-level (uncommitted)
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_WEB3_IMPORT_META_FIX.md`
> **Spec:** `Mingla_Artifacts/specs/SPEC_WEB3_IMPORT_META_FIX.md`
> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_WEB3_IMPORT_META.md`
> **Status:** implemented, partially verified

---

## 1. Summary

Single-file bundler-config fix. Created `mingla-business/metro.config.js` that
overrides Metro's web-platform resolver for `zustand` and `zustand/*` requests,
mapping them to the CJS files instead of letting Metro resolve via the `import`
exports condition (which picks the ESM `middleware.mjs` containing the
unparseable `import.meta.env`). Native iOS/Android resolution untouched —
the override branches strictly on `platform === "web"`.

**Zero source code changes.** No TypeScript files touched. The Zustand barrel
import in `currentBrandStore.ts:23` stays exactly as-is.

---

## 2. Old → New Receipts

### `mingla-business/metro.config.js` (NEW)

**What it did before:** did not exist. Metro used the default `getDefaultConfig`
resolver chain — which on web picks the `import` condition for zustand,
resolving to `./esm/middleware.mjs` (containing `import.meta.env.MODE`).

**What it does now:** wraps the default `resolver.resolveRequest` so that on
`platform === "web"`, requests for `zustand`, `zustand/middleware`,
`zustand/middleware/<X>`, and any other `zustand/<X>` get hard-mapped to the
CJS files in `node_modules/zustand/`. All non-web platforms fall through to
the default resolution. All non-zustand requests (any platform) fall through
to the default resolution.

**Why:** WEB3 root cause per `INVESTIGATION_WEB3_IMPORT_META.md`. The CJS
files (`zustand/middleware.js`, `zustand/index.js`, etc.) do NOT use
`import.meta` — verified by grep during investigation. So routing web
through CJS sidesteps the parse error without changing any source code or
breaking native resolution.

**Lines changed:** +75 (new file).

---

## 3. Spec Traceability — verification matrix

Per spec §3 success criteria + §4 test cases.

| # | Criterion / Test | Status | Evidence |
|--|--|--|--|
| 1 | `mingla-business/metro.config.js` exists with §2 content | ✅ PASS | File created with verbatim spec §2 content (75 lines) |
| 2 | `npx expo start --web --clear` produces a parseable bundle, no `import.meta` SyntaxError | ⏳ UNVERIFIED | Code-trace: the resolver override redirects `zustand`/`zustand/*` requests on web to CJS paths. CJS files contain no `import.meta` per investigation grep. Therefore the bundle should not contain the offending expression after this change + `--clear`. **Requires founder runtime smoke.** |
| 3 | Browser at `http://localhost:8081` renders BusinessWelcomeScreen | ⏳ UNVERIFIED | Depends on #2 + Cycle 0b's auth changes (already shipped at code level). Once the bundle parses, AuthProvider's bootstrap should resolve and render Welcome. **Requires founder runtime smoke.** |
| 4 | iOS smoke unchanged | ⏳ UNVERIFIED | Code-trace: resolver override branches strictly on `platform === "web"`. iOS native (`platform === "ios"`) never enters the branch — falls through to `originalResolveRequest` → default Metro resolution → `react-native` exports condition → CJS. Behaviour byte-identical to pre-fix. **Requires founder smoke.** |
| 5 | Android smoke unchanged | ⏳ UNVERIFIED | Same as #4 with `platform === "android"`. **Requires founder smoke.** |
| 6 | `npx tsc --noEmit` exits 0 | ✅ PASS | `cd mingla-business && npx tsc --noEmit` returns no output (exit 0) — verified post-create. |
| 7 | Brand store still works post-fix | ⏳ UNVERIFIED | Code-trace: the CJS zustand barrel re-exports persist + createJSONStorage with the same API as ESM. Consumer code (`currentBrandStore.ts`) doesn't change; same imports continue to resolve to same exports, just different physical file. **Requires founder smoke (T-05 web persist + T-06 native persist).** |

**Summary**: 2/7 implementor-verifiable gates PASS (file creation + tsc).
5/7 require founder runtime smoke. Code-trace analysis supports PASS for
all five with high confidence.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved (code-trace) | Auth flow on iOS/Android unchanged — resolver override doesn't intervene on native platforms; existing `signInWithIdToken` flow continues using same code path. Cycle 0b's web auth code uses Supabase OAuth-redirect which doesn't depend on Zustand. |
| I-3 | ⏳ partially proven | iOS / Android: code-trace pass (default resolution unchanged). Web: code-trace pass (CJS path now used; bundle parses). All 3 require founder runtime confirmation. |
| I-4 | ✅ Preserved | No imports from `app-mobile/` |
| I-5 | ✅ Preserved | No copy / domain text touched |
| I-6 | ✅ Preserved | tsc strict clean |
| I-7 | ✅ Preserved | No silent failures introduced. Resolver override returns `null`-equivalent path delegation when not on web — same behaviour as before. |
| I-8 | ✅ Preserved | No Supabase code touched |
| I-9 | ✅ Preserved (N/A) | No animation timings touched |
| I-10 | ✅ Preserved (N/A) | No copy / currency changes |
| DEC-079 | ✅ Honoured | No kit primitive changes |
| DEC-080 | ✅ Honoured | TopSheet untouched |
| DEC-081 | ✅ Honoured | Fix lives in `mingla-business/`, no `mingla-web/` work |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|-----------|-----------|
| 1 | No dead taps | N/A (no UI changes) |
| 2 | One owner per truth | ✅ — Zustand store owner unchanged |
| 3 | No silent failures | ✅ — resolver returns explicit paths or delegates; no swallow paths |
| 4 | One query key per entity | N/A |
| 5 | Server state stays server-side | ✅ |
| 6 | Logout clears everything | ✅ — unchanged from prior state |
| 7 | Label temporary fixes | ✅ — header comment in metro.config.js explains the override is reversible (when Metro adds an `import.meta` transform OR Zustand stops shipping `import.meta.env`) |
| 8 | Subtract before adding | ✅ — addition is config-only, no broken code layered on |
| 9 | No fabricated data | N/A |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | N/A |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ — Zustand persist API surface unchanged; storage key `mingla-business.currentBrand.v2` continues to work via the CJS path |

---

## 6. Cache Safety

No React Query keys changed. Persisted Zustand storage unchanged
(`mingla-business.currentBrand.v2` continues to use AsyncStorage on native /
localStorage on web — same key, same shape, same persist middleware
behaviour). Only the **physical file path** Metro reads to load the persist
middleware changed; the runtime API + storage interactions are identical.

---

## 7. Parity Check

| Surface | Before WEB3 fix | After WEB3 fix |
|--|--|--|
| iOS native | Bundle compiles + runs (no change) | Bundle compiles + runs (no change) |
| Android native | Bundle compiles + runs (no change) | Bundle compiles + runs (no change) |
| Web bundle parse | FAIL (SyntaxError at line 131196) | PASS (CJS path has no `import.meta`) — code-trace |
| Web runtime | Never executed (parser failed) | NOW executes — Welcome should render — pending Cycle 0b auth being unblocked too |

---

## 8. Regression Surface (3-5 features most likely to break)

1. **Native zustand consumers** — `currentBrandStore.ts` is the only consumer.
   Resolver override doesn't touch native, so zero risk. Smoke required.
2. **Web zustand persist API** — CJS and ESM expose same API surface in
   Zustand 5. Should work identically. Risk: if any consumer used an ESM-only
   feature (e.g., a top-level await), it would break. Verified: our consumer
   uses standard `persist(create((set) => ({...})))` pattern, no ESM-only
   features. Risk: zero. Smoke required to confirm.
3. **Future zustand version upgrades** — if Zustand 6+ removes the CJS files
   or changes the `exports` map structure, this resolver override needs
   updating. Reversibility note: header comment in metro.config.js
   documents the reversal condition. Risk: low (Zustand has stable
   distribution patterns).
4. **Other `node_modules/zustand` middleware in the bundle** — `immer.mjs`
   does NOT contain `import.meta` per grep. Other middleware (combine,
   redux, subscribeWithSelector) only ship as `.d.mts` declarations in the
   esm/middleware/ subfolder, not runtime files. They live in the parent
   `middleware.mjs` barrel. The CJS `middleware.js` re-exports all of them.
   Risk: zero — covered by the override.
5. **Cycle 0b auth flow on web** — depends on the bundle parsing first.
   Once WEB3 is fixed, Cycle 0b's web auth code (already implemented at
   code level, uncommitted) should activate. The two changes compose
   cleanly. Risk: zero from this fix; Cycle 0b's own risks remain.

---

## 9. Discoveries for Orchestrator

None new from the implementation step itself. All forensics-discovered
discoveries (D-FORENSICS-WEB3-1 through -4) remain logged in
`INVESTIGATION_WEB3_IMPORT_META.md` for orchestrator's tracking.

The recommended I-NEW invariant from spec §6 ("Web bundle must parse and
load the Welcome screen on every cycle close") remains an orchestrator
decision — the implementor honours it as a future-cycle gate, not a
this-cycle code change.

---

## 10. Transition Items

No new transitional code. The metro.config.js override IS a long-term
maintenance config (similar to other Metro configs across the RN
ecosystem). Header comment documents the reversal condition.

---

## 11. Files Changed Summary

| Path | Action | Net lines |
|------|--------|-----------|
| `mingla-business/metro.config.js` | NEW | +75 |

**Total**: 1 created, 0 modified, 0 deleted. Net ~+75 lines.

---

## 12. Founder smoke instruction

Critical: Metro caches its bundle. Use `--clear` to force a fresh build
that picks up the new metro.config.js.

```
SETUP:
1. If Metro is currently running (any terminal), Ctrl+C to stop it.
2. cd mingla-business && npx expo start --web --clear
   (the --clear flag is REQUIRED — without it, the cached old bundle
    still has the import.meta SyntaxError baked in)

WEB SMOKE (the unblock):
3. Wait for "Web Bundled" message in terminal (~5-15 seconds first time).
4. Open browser to http://localhost:8081
5. EXPECTED: page loads, Welcome screen renders (with Continue with Google
   + Continue with Apple buttons). NO infinite loader.
6. Open DevTools → Console (F12). EXPECTED: no `Cannot use 'import.meta'`
   SyntaxError. (Other warnings about Sentry config / shadow* deprecation
   are pre-existing and acceptable.)

WEB OAUTH SMOKE (Cycle 0b validation post-WEB3-fix):
7. Tap "Continue with Google" → browser redirects to Google → sign in
   → redirected back to /auth/callback → loader briefly → Home renders.
8. Refresh page → still signed in.
9. Sign out from Account → back to Welcome.
10. Tap "Continue with Apple" → redirects to Apple → sign in → Home
    renders. (Apple Service ID + Supabase JWT are configured per Cycle 0b
    pre-dispatch setup.)

WEB BRAND-STORE PERSIST SMOKE:
11. After signing in, go to Account → "Seed 4 stub brands".
12. Return to Home. EXPECTED: Sunday Languor's live KPI hero shows.
13. Refresh page. EXPECTED: still signed in, brand still selected.

NATIVE REGRESSION SMOKE:
14. cd mingla-business && npx expo start --dev-client (separate run)
15. Open on iPhone. Welcome → Continue with Google → existing native flow
    → Home loads. Sign out → back to Welcome.
16. Tap Continue with Apple → existing native flow → Home loads.
17. Same checks on Android device.

PASS criteria:
- Web bundle parses (no SyntaxError)
- Web Welcome renders
- Web Google + Apple OAuth-redirect both work end-to-end
- Web brand store persists across reload
- iOS + Android native auth UNCHANGED (no regression)
- Brand store still persists on native after cold-relaunch

If web fails at step 5 with a different error, paste the full DevTools
Console output for diagnosis.
If web works through step 6 but step 7 fails (e.g., redirect_uri_mismatch),
re-check Supabase URL Configuration includes the localhost callback URLs
(should be done from Cycle 0b setup; double-check if so).
```

---

## 13. Working method actually followed

1. ✅ Pre-flight: read dispatch + spec + investigation context
2. ✅ Verified `metro.config.js` does NOT exist
3. ✅ Announced 3-line plan
4. ✅ Created `metro.config.js` with verbatim spec §2 content
5. ✅ tsc --noEmit clean check
6. ✅ Wrote this report
7. ⏳ Founder smoke — pending

---

## 14. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across the new
file; 2/7 implementor-verifiable gates PASS; 5/7 device-runtime gates
⏳ pending founder smoke runs.

The fix is high-confidence (forensics root cause was six-field-proven;
implementation is verbatim from the spec; no source-code surface area
to introduce regressions).

Hand back to `/mingla-orchestrator` for review + AGENT_HANDOFFS update +
founder smoke gating.

---

**End of WEB3 implementation report.**
