# REVIEW — META-ORCH-0972 Sub-B Android rework #2

**Reviewer:** Claude `mingla-orchestrator`
**Mode:** REVIEW (post-implementation, pre-tester)
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Reviewed commit:** `19adf8004` ("META-ORCH-0972 Sub-B Android rework #2 — lazy-load native Stripe provider off Home startup")
**Baseline:** `c9741eb52`

---

## Verdict

**APPROVED — proceed to Claude `mingla-tester` Android retest #2 on a fresh AVD. Sub-C dispatch remains BLOCKED until tester captures the clean Home → Hub Android evidence independently.**

Two items must be carried into the CLOSE commit (see §Carry-forward at CLOSE below). They are NOT REVIEW blockers and NOT NEEDS-WORK items — they are forward-flagged for the closing orchestrator so the CI gates land green.

Confidence: HIGH. The chosen root cause matches the logcat evidence; the bounded fix touches a minimal blast radius (root layout + 2 checkout routes + 2 new payment-boundary files + 1 wrapper documentation tweak); all hard guards held; the new regression test is correctly shaped; refreshed live-fire evidence on `Pixel_8_Pro` shows zero ANR / zero `Loading brands` stall and Home + Hub render cleanly.

---

## Commit-hash verification (MANDATORY — codified DEC-179 / ORCH-0959)

All 11 production / test files claimed in the implementation report resolve to a single commit `19adf8004` on the per-ORCH branch. No file is modified-but-uncommitted. Working tree shows only the standard untracked artifacts (CODEX_RE_REVIEW audit preserved from Phase 1; this REVIEW file is the one new write).

| File | Commit |
|---|---|
| `mingla-business/app/_layout.tsx` | `19adf8004` |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | `19adf8004` |
| `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` | `19adf8004` |
| `mingla-business/src/payments/NativeCheckoutPaymentBoundary.native.tsx` | `19adf8004` |
| `mingla-business/src/payments/NativeCheckoutPaymentBoundary.tsx` | `19adf8004` |
| `mingla-business/src/payments/StripeProviderWrapper.native.tsx` | `19adf8004` |
| `mingla-business/src/payments/StripeProviderWrapper.tsx` | `19adf8004` |
| `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | `19adf8004` |
| `mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts` | `19adf8004` |
| `mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` | `19adf8004` |
| `mingla-business/__tests__/androidRootStripeProviderIsolation.test.ts` | `19adf8004` |

**Note on commit composition:** the diff against `c9741eb52` (the rework #2 baseline) also contains the rework #1 files — `connect-onboarding.tsx`, `connect-account-management.tsx`, `connect-tax-registrations/index.tsx`, their `.web.tsx` siblings, `metro.config.js`, `stripeConnectNativeStub.js`, `NativeConnectWebOnlyFallback.tsx`, `androidWebOnlyConnectRoutes.test.ts`. That's because the rework #1 work was never committed as its own commit and was carried in the working tree, then squashed into `19adf8004`. The functional content of rework #1 was already verified by the prior Android retest (web Connect SDK packages absent from native bundle, `document` ReferenceError gone) — re-verified here as still-in-place at HEAD. The implementor's report §7 "Metro rework #2 guard" claim that "this rework did not modify `mingla-business/metro.config.js`" is technically misleading — the file IS modified by commit `19adf8004` — but the modification IS the rework #1 alias they're describing, which is good and correct. Flag the wording for CLOSE-commit message accuracy; not a blocker.

---

## Dependency walk (MANDATORY — codified DEC-179 / ORCH-0959)

Config-layer changes in the rework #2 commit: **`mingla-business/metro.config.js`** (the only config-layer file touched). One block of 20 lines added inside the existing `config.resolver.resolveRequest` function.

**The change:** when `platform !== "web"`, intercept resolution of `@stripe/connect-js` and `@stripe/react-connect-js` and return the local `src/shims/stripeConnectNativeStub.js` path.

**Consumers of the changed key/value:**

| Consumer | Compatibility assessment |
|---|---|
| `mingla-business/app/connect-onboarding.web.tsx` (real Stripe Connect onboarding page) | UNAFFECTED — runs on web only; `platform === "web"` skips the new intercept; real `@stripe/react-connect-js` and `@stripe/connect-js` continue to resolve. |
| `mingla-business/app/connect-account-management.web.tsx` | UNAFFECTED — same web-only resolution path. |
| `mingla-business/app/connect-tax-registrations/index.web.tsx` | UNAFFECTED — same web-only resolution path. |
| `mingla-business/app/connect-onboarding.tsx` (native fallback) | UNAFFECTED — does not import the Stripe Connect web SDKs; renders only `NativeConnectWebOnlyFallback`. |
| `mingla-business/app/connect-account-management.tsx` (native fallback) | UNAFFECTED — same. |
| `mingla-business/app/connect-tax-registrations/index.tsx` (native fallback) | UNAFFECTED — same. |
| Existing web-platform resolver branch lower in the same `resolveRequest` function | UNAFFECTED — only runs when `platform === "web"`; the new native branch returns before reaching it for native builds and never matches on web. |
| Existing `extraNodeModules`, `disableHierarchicalLookup`, `ZUSTAND_CJS_ROOT`, and remaining native resolution path | UNAFFECTED — new intercept is scoped to two module names and returns early; everything else falls through to the original resolver. |
| `@stripe/stripe-react-native` (the OTHER Stripe SDK — payment sheet, not Connect) | UNAFFECTED — not in the intercept's name list; resolves normally. This is the SDK that the rework #2 lazy-load is taming via the JS-boundary fix, not via Metro. |
| `mingla-business/__tests__/androidWebOnlyConnectRoutes.test.ts` (regression coverage from rework #1) | UNAFFECTED — already asserts native Metro resolution returns the stub and web Metro resolution does not; still passes at HEAD. |

**Conclusion:** dependency walk PASSES. The new intercept is surgical, native-only, and matches the pattern of the existing web-only branch in the same file. Risk: very low.

---

## Hard-guard verification

| Guard | Status | Evidence |
|---|---|---|
| Zero DB / migrations | HELD | `git diff --name-only fee178634..HEAD -- supabase` empty. |
| Zero edge functions | HELD | No `supabase/functions/**` in diff. |
| No `PublicBrandPage.tsx`, `publicEventsService.ts`, `ExperienceMiniCard*`, `useUpcomingFeed*`, `EventMiniCard*`, `TripMiniCard*` | HELD | `git diff --name-only fee178634..HEAD \| rg '<forbidden>'` empty. |
| No `meta-orch-0972-*` strict-grep script | HELD | No file under `.github/scripts/strict-grep/meta-orch-0972-*` in diff. |
| No `Brand.kind` / `brand.kind` / `currentBrand.kind` reintroduction | HELD | `git diff --unified=0 fee178634..HEAD -- mingla-business mingla-admin \| rg '^\+.*(Brand\|currentBrand)\.kind'` empty. |
| No Sub-A rewrites | HELD | None of Sub-A's 32 files appear in the rework #2 diff. The `KeyboardRoot.adversarial.test.tsx` modification (originally ORCH-0892-A authorship) is NOT a Sub-A file. |
| No `@stripe/*` or other payment SDK version bump | HELD | `git diff --name-only c9741eb52..HEAD -- mingla-business/package.json mingla-business/package-lock.json package.json yarn.lock pnpm-lock.yaml` empty. |
| Preserved adversarial commit | HELD | `git merge-base --is-ancestor 411925909 HEAD` PASS. |
| No `metro.config.js` regression of the rework #1 native Connect alias | HELD | New native-only branch added; existing web-only branch + `extraNodeModules` + ZUSTAND_CJS_ROOT unchanged. |

---

## Root-cause proof inspection

The implementor proved Stripe root-mount cold-init as the actual blocker by citing specific logcat line numbers:

- `android-retest-final-post-bundle-logcat.txt:4805` → `Skipped 2120 frames`
- `android-retest-final-post-bundle-logcat.txt:5129-5134` → `ANR in com.sethogieva.minglabusiness`
- `android-retest-final-after-anr-wait-logcat.txt:11224` → `Running "main"` (React alive)
- `:12096-12097` → `StripePushProvisioning dependency not found` + Stripe `forwardRef` warning (Stripe SDK evaluating)
- `:12476-12501` → `INITIAL_SESSION hasUser: true` (auth bootstrap reached)
- `:12513` → `StripeResponse` (Stripe SDK still running on the critical path)

The fix logic flows from the proof: the StripeProvider was mounted at root layout (`app/_layout.tsx`), so every native cold-start evaluated the full Stripe React Native module graph before React could commit Home. Moving the provider into a route-scoped `NativeCheckoutPaymentBoundary` mounted only on the 2 checkout payment routes means Home/Hub never touch the payment SDK.

The refreshed logcat grep proves the symptom signature is gone:

| Pattern | Count at HEAD |
|---|---|
| `ANR in com.sethogieva.minglabusiness` | 0 |
| `Input dispatching timed out.*com.sethogieva.minglabusiness` | 0 |
| `Property 'document' doesn't exist` / `document` | 0 |
| `ReferenceError` | 0 |
| `forwardRef render functions accept exactly two parameters` | 0 |
| `StripeResponse` | 0 |
| `StripePushProvisioning` | 0 |
| `Loading brands` | 0 |

Worst frame-skip window dropped from 3,671 (pre-rework) to 171 (post-rework) — inside the prompt's < ~200 tolerance.

`INITIAL_SESSION hasSession: true, hasUser: true` reached at line 1014; `Running "main"` at line 929.

**Root cause assessment: proven, not plausible. The §3.2 hypothesis from the dispatch prompt is the correct one. Implementor disciplined itself to one cause and didn't speculate on the others.**

---

## Regression-test gate (Step 0.5 implementor half)

| Test path | Test count | Result at HEAD | Fails-on-revert annotation |
|---|---|---|---|
| `mingla-business/__tests__/androidRootStripeProviderIsolation.test.ts` | per source review | PASS | `fails-on-revert verified at c9741eb52: root layout still imported and mounted StripeProviderWrapper, while checkout payment routes did not own a scoped provider wrapper.` (verbatim from the test file's annotation, per report §6) |

**Live re-run at HEAD of the full Sub-B suite** (orchestrator independently executed):

```
PASS __tests__/androidRootStripeProviderIsolation.test.ts
PASS __tests__/androidWebOnlyConnectRoutes.test.ts
PASS __tests__/hooks/useHubVisibleTabs.test.tsx
PASS __tests__/components/BrandCreationFlow.test.tsx
PASS src/services/__tests__/venueClaimService.test.ts
PASS src/payments/__tests__/native_checkout_flow_parity.test.ts
PASS src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx
Test Suites: 7 passed, 7 total — Tests: 30 passed, 30 total — 3.285 s
```

The `KeyboardRoot.adversarial.test.tsx` TA-1 console.warn about the missing web export bundle is the pre-existing prerequisite skip (not a failure); the suite still PASSes its TA-2 / TA-3 / TA-4 assertions.

**Adversarial half (tester-side) is still required at CLOSE.** Tester must write the adversarial counterpart for rework #2 — recommended angle: assert that requiring `NativeCheckoutPaymentBoundary` from a route OTHER than the 2 checkout payment routes produces no Stripe provider eagerly (or assert that root layout's RootLayoutInner ErrorBoundary chain does not contain `StripeProviderWrapper` AST-wise). This is on the dispatch for the tester below.

---

## Test modifications (FLAG for CLOSE-commit body)

The rework #2 commit modifies 2 pre-existing test files because the production code intentionally changed the contract those tests encoded:

1. **`mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx`** — TA-2 changed from "mounts KeyboardRoot INSIDE StripeProviderWrapper" → "mounts OUTSIDE RootLayoutInner; StripeProviderWrapper is route-scoped". Justified: the production change moved StripeProvider out of root, so an assertion that root contains StripeProvider is now structurally wrong. Authored originally by ORCH-0892-A.
2. **`mingla-business/src/payments/__tests__/native_checkout_flow_parity.test.ts`** — Angle (1) flipped from "Business _layout.tsx mounts <StripeNativeProvider>" → "checkout routes mount StripeProviderWrapper while root stays free". Justified for the same reason. Asserts `rootLayout` does NOT contain `StripeProviderWrapper` AND `nativeBoundary` DOES contain it AND the wrapper still carries the merchantIdentifier + urlScheme — so the parity contract for I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY is preserved end-to-end, just at a different mount point.

Both modifications are LEGITIMATE — they are not weakening tests, they are realigning them to the new architectural truth, and they continue to assert the same invariants (provider config, mount order, error-boundary nesting) at the new correct mount site.

**Carry-forward at CLOSE:** the CLOSE commit body MUST include the `[TEST-MOD-APPROVED META-ORCH-0972]` tag per `feedback_close_commit_precommit_checks.md` (the gate triggers at CLOSE-commit time because the cumulative PR diff deletes lines from these 2 test files). The strict-grep `tests-append-only` CI gate will reject the PR merge without this tag. Flag this in the CLOSE handoff.

---

## Live-fire evidence inspection

Evidence under `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/`:

| File | Verified |
|---|---|
| `android-rework2-emulator-name.txt` | Pixel_8_Pro AVD, `emulator-5554`, Android 15, 1344x2992, dev-client URL via `10.0.2.2:8097`. SAME AVD as the prior FAIL — apples-to-apples comparison, which is the strongest possible signal. |
| `android-rework2-launch.png` | Dev-client launch on Pixel_8_Pro. |
| `android-rework2-auth.png` | Authenticated Home for `Travel Brand`; no ANR dialog visible, no `Loading brands` stall. |
| `android-rework2-home-clean.png` | Home retained for tester convenience. |
| `android-rework2-hub.png` | Hub reached; Trips tab + secondary filters visible; no ANR dialog. |
| `android-rework2-logcat-full.txt` | 1384 lines covering launch → auth → Home → Hub. |
| `android-rework2-logcat-grep.txt` | All 8 negative signals at count 0; `INITIAL_SESSION hasUser: true` at line 1014; max frame skip 171. |
| `android-rework2-export-grep.txt` | Dev export retains the web Connect/Stripe module name strings in source-map records; implementor correctly notes runtime is the authoritative signal. Tester must confirm independently on the fresh AVD. |

**Key validation:** the SAME Pixel 8 Pro AVD that failed retest #1 now passes on rework #2. That is the most rigorous proof shape possible for a perf-regression fix — eliminates AVD-headroom as a confound.

---

## Cross-ORCH / Comms-Ledger ack

Read on entry. No `BLOCK` rows. WARN entries scanned:

- **COMMS-0001** (→ ORCH-0955): N/A.
- **COMMS-0002** (ALL, ORCH-0863 backend strict-grep): N/A — rework #2 touches zero `supabase/**` and zero `.github/**`.
- **COMMS-0003** (ALL, external-API docs gate): N/A — no Stripe API contract, enum, payload, or SDK version change; this is JS-side mount-point relocation.
- **COMMS-0004** (ALL, INTAKE collision-scan SOP): N/A — REVIEW phase, no new ORCH-ID.
- **COMMS-0005** (→ ORCH-0964): N/A.

Acks for this REVIEW will be recorded as `mingla-orchestrator+claude (META-ORCH-0972 Sub-B Android REWORK 2 REVIEW)`. Same anchor-state caution as the prior REVIEW applies — the anchor checkout still showed dirty status at this session's start; not editing `acked_by` on `main` from this turn to avoid bundling unrelated work.

---

## Carry-forward at CLOSE (not REVIEW blockers; flag for the closing orchestrator)

1. **`[TEST-MOD-APPROVED META-ORCH-0972]` tag required in the CLOSE PR commit body** — cumulative diff deletes lines from `KeyboardRoot.adversarial.test.tsx` and `native_checkout_flow_parity.test.ts`. Tag the CLOSE commit (or amend the PR squash message) or `tests-append-only` CI gate will reject the merge.
2. **Tester's adversarial regression test** — still required per Step 0.5; recommended angle described in the test dispatch below.
3. **Doc accuracy** — implementor report §7 "Metro rework #2 guard" wording should be tightened in the CLOSE artifact updates to acknowledge that the commit DOES touch `metro.config.js` (carrying the rework #1 alias) — even though the change is good and unchanged from rework #1's intent.

---

## Routing

Forward → Claude `mingla-tester` for Android retest #2 on a fresh AVD with mandatory new adversarial test. Sub-C dispatch remains BLOCKED until tester captures clean Home → Hub Android evidence independently on a stable, ideally non-Pixel-8-Pro runner (to prove the fix is AVD-agnostic, not just Pixel-8-Pro-specific) AND tester writes the adversarial regression test required by Step 0.5.

**No NEEDS WORK, no REJECTED items.** Verdict stands: APPROVED with two flagged CLOSE-side prerequisites.
