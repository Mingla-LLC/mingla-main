# TEST — META-ORCH-1187 Phase 2 — WEB analytics gap-fixes (mingla-tester, adversarial)

**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[p2-web-events]/`
**Branch:** `META-ORCH-1187-p2-web-events` @ `8a469e158` (rebased on `origin/main`)
**PR:** #597 (OPEN) — `META-ORCH-1187 Phase 2: web analytics gap-fixes ... [deploy]`
**Mode:** TARGETED + SPEC-COMPLIANCE. Web-only analytics instrumentation; **Phase 0.A live-fire sim gate EXEMPT** — no native/runtime UI behavior change (the trip/exp checkout imports resolve to the native NO-OP `webAnalytics.ts` stub on iOS/Android; the marketing change is Next-web-only). Verification basis = forensic diff read + executable test reverts + strict-grep gates + CI build-gate confirmation.

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

The #1 dispatch risk (consent-capture ordering) is **PROVEN correct at source-and-execution level**: in BOTH banners the PostHog opt-in runs strictly before the `consent_granted` capture, and the opt-in calls (`posthog.opt_in_capturing()` directly; `posthogOptIn()` → same, synchronous) are NOT async — there is no race that could drop the capture. Reject fires ZERO PostHog captures on both surfaces. `web_checkout_started` on trip/experience uses the correct event name, the correct id field, the correct `offering_type` (not copy-paste "event"), is ref-latched against double-fire, and is null-id-gated. Consent gate + replay masking are untouched. Diff = exactly the listed web files + tests + report. All 10 I-PROPOSED-1187 strict-grep gates pass locally; the COMMS-0052 build gates that could not run locally **DID run and passed in CI** on PR #597 (227 pass / 1 skip / 0 fail).

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| FIX-1-trip | trip checkout fires `web_checkout_started` (offering_type `trip`) + GA `begin_checkout` | **PASS** | `checkout-trip/[tripEventId]/index.tsx:185-189`; event name + `offering_type: "trip"` + `event_id: tripEventId`; mirrors event ref `checkout/[eventId]/index.tsx:118` |
| FIX-1-exp | experience checkout fires `web_checkout_started` (offering_type `experience`) + GA `begin_checkout` | **PASS** | `checkout-experience/[experienceEventId]/index.tsx:134-140`; `offering_type: "experience"` + `event_id: experienceEventId` |
| FIX-1-no-double-fire | start event fires AT MOST once (ref latch + null-id gate) | **PASS** | both files: `checkoutStartedRef = useRef(false)` → `if (current) return` → `current = true` BEFORE capture; `if (<id> === null) return`. Adversarial Angle 3, fails-on-revert proven |
| FIX-2-buyer-order | buyer-web Accept fires `consent_granted` AFTER `opt_in_capturing()` | **PASS** | `webAnalytics.web.ts` `grantConsent()`: L245 `opt_in_capturing()` → L262 `captureWeb("consent_granted")`. opt-in is SYNC (posthog-js `opt_in_capturing` returns void). Scope-bounded ordering proven (Angle 1) |
| FIX-2-buyer-deny | buyer-web Reject fires NO PostHog capture | **PASS** | `denyConsent()` body L267-280 contains zero `captureWeb(`/`.capture(`. Adversarial Angle 2, fails-on-revert proven |
| FIX-2-mkt-order | marketing Accept fires `consent_granted` AFTER opt-in | **PASS** | `consent-banner.tsx` `choose()`: L115 `applyConsent(value)` (→ `posthogOptIn()` → sync `posthog.opt_in_capturing()`) → L124 `captureMarketing('consent_granted')`. Scope-bounded ordering proven |
| FIX-2-mkt-deny | marketing Reject fires NO PostHog capture (cookieless GA ping only) | **PASS** | `choose()` deny branch L127 fires only `getGtag()?.('event','consent_denied')`; exactly ONE `captureMarketing(` in `choose` and it is the grant. Adversarial Angle 2 |
| Consent gate untouched | `opt_out_capturing_by_default:true` + GA default-denied unchanged | **PASS** | `git diff origin/main` touches no `opt_out_capturing_by_default` / GA `consent default` config line (only report/test/comment text matches) |
| Masking untouched | `maskAllInputs:true` unchanged on both surfaces | **PASS** | diff touches no `maskAllInputs` / `session_recording` line; `i-proposed-1187-replay-masks-pii` OK |
| Native safety | trip/exp imports resolve to native no-op | **PASS** | `src/analytics/webAnalytics.ts` exports `captureWeb`/`gaEvent` as `noopVoid`; bare specifier `../../../src/analytics/webAnalytics` → Metro picks `.web.ts` on web, `.ts` on native |
| Web-only diff | only the listed web files + tests + report changed | **PASS** | `git diff --name-only origin/main` = 5 web files + report (+ this test, to be committed) |
| Gates | 10 × I-PROPOSED-1187 strict-grep | **PASS** | all OK locally (§6) |
| Build gates (COMMS-0052) | expo-export / 1083 budget / marketing next-build + 0891 | **PASS (CI)** | local BLOCKED by missing `posthog-js`/`expo-tracking-transparency`/marketing node_modules; **CI ran + passed**: "mingla-business: web build (expo export)" pass 1m57s, "ORCH-0891 ... performance budget" pass, "META-ORCH-1187 ... consent-gate-before-cookies" pass |

---

## 3. ORDERING RESULT (explicit — the #1 dispatch risk)

**RESULT: PASS — no reorder, no async race, on BOTH banners.**

- **Buyer-web (`webAnalytics.web.ts` `grantConsent`)**: `posthogClient?.opt_in_capturing()` (L245) executes, then GA consent-update (L250-255), then `captureWeb("consent_granted")` (L262). `opt_in_capturing()` in posthog-js is synchronous (returns `void`, mutates persisted opt-in state in-process), so by the time `captureWeb`→`posthog.capture()` runs the client is already opted-in. No promise, no microtask gap. PROVEN by a scope-bounded assertion that fails when the capture is hoisted above the opt-in inside `grantConsent` (see §5, revert A1).
- **Marketing (`consent-banner.tsx` `choose`)**: `applyConsent(value)` (L115) calls `posthogOptIn()` → `posthog.opt_in_capturing()` (sync), fully returns, THEN `captureMarketing('consent_granted')` (L124) runs on the next statement. `captureMarketing` guards on `initialized` and calls `posthog.capture()` synchronously. No race.

I attacked the implementor's ordering proof as too weak: their test uses GLOBAL `indexOf` over the whole comment-stripped file, which would still pass if the opt-in and capture lived in different functions or if a stray earlier `opt_in_capturing` token kept the index happy. My adversarial test extracts the `grantConsent`/`choose` function bodies by brace-matching and asserts the ordering **within that single scope** — strictly stronger, and it fails-on-revert when the capture is moved above the opt-in inside the function.

---

## 4. Findings

**P4-1 (praise):** Both fixes mirror the shipped event-checkout pattern (`checkout/[eventId]/index.tsx`) byte-for-byte in structure (ref latch, null-id gate, deps `[id]`), and `offering_type` is correctly differentiated. Clean, copy-paste-hazard-aware work.

**P4-2 (note, not a defect):** The buyer-web `grantConsent` effect-equivalent has no dep-driven re-fire risk because it is a plain handler (not an effect); the trip/exp checkout effects use `[<id>]` deps but the ref latch makes a dep change a no-op after the first fire. If the id ever toggled null→value→null→value in one session (it cannot for a single checkout route), the latch still holds (it never resets). No action.

No P0/P1/P2/P3.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert + my adversarial fails-on-revert

All reverts were done on temp copies, run, then restored; `git diff --stat` confirmed ZERO residual product change after each.

**Implementor happy-path test** (`metaOrch1187P2WebEvents.test.ts`) re-run at `8a469e158`:
- Revert: true line-deletion of the trip `captureWeb("web_checkout_started", {...})` block.
- Result: `META-ORCH-1187 P2 FIX 1 — trip ...` → **FAIL** at `expect(trip).toContain('captureWeb("web_checkout_started"')` (`Tests: 1 failed`). Restored → 6/6 pass. **Confirmed.**

**Tester adversarial test** (`metaOrch1187P2WebEvents.adversarial.test.ts`, NEW) — 3 independent reverts:
- A1 (move `captureWeb("consent_granted")` ABOVE `opt_in_capturing()` inside `grantConsent`) → "opt_in_capturing precedes ... WITHIN grantConsent's own body" **FAIL**. Restored → pass.
- A2 (leak `captureWeb("consent_denied")` into `denyConsent`) → "denyConsent body contains NO PostHog capture of ANY name" **FAIL**. Restored → pass.
- A3 (delete the `if (checkoutStartedRef.current) return;` latch in the trip effect) → "trip checkout latches the start event" **FAIL**. Restored → pass.

Full suite after all restores: **2 suites, 13 tests pass.** Product `git diff --stat` clean.

---

## 6. Adversarial test added

- **Path:** `mingla-business/src/analytics/__tests__/metaOrch1187P2WebEvents.adversarial.test.ts` (NEW, append-only).
- **Angle (different from implementor):** scope-bounded ordering (function-body brace extraction, not global indexOf) + deny-path-emits-nothing (any-name capture) + double-fire ref-latch + null-id gate + offering_type copy-paste guard. The implementor tested presence + global ordering; this tests scoped ordering, single-fire, and deny-leak — angles the implementor did not cover.
- **fails-on-revert verified at `8a469e158`** (3 distinct assertions, §5).
- Both the implementor happy-path test and this adversarial test appear in `git diff origin/main...HEAD --name-only` once committed (this report's commit stages it).

Strict-grep gates (all OK locally):
```
i-proposed-1187-analytics-web-only-via-web-ts ...... OK
i-proposed-1187-consent-gate-before-cookies ........ OK
i-proposed-1187-marketing-layout-mounts-analytics .. OK
i-proposed-1187-native-mounts-analytics ............ OK
i-proposed-1187-no-phx-in-client ................... OK
i-proposed-1187-posthog-host-us .................... OK
i-proposed-1187-posthog-key-static-read ............ OK
i-proposed-1187-replay-masks-pii ................... OK
orch-1187-leg2-buyer-web-analytics-wired ........... OK
orch-1187-tester-consent-gate-deletion-robust ...... OK
```

---

## 7. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | no new tap targets; reuses existing Accept/Reject + checkout mount |
| 2 | One owner per truth | PASS | analytics facades (`captureWeb`/`captureMarketing`) are the single emit owners; no duplicate emitters |
| 3 | No silent failures | PASS | all captures wrapped in try/catch that `console.warn`; analytics-fail must never break page (intended) |
| 4 | One query key per entity | N/A | no React Query |
| 5 | Server state stays server-side | N/A | no Zustand/server-state change |
| 6 | Logout clears everything | N/A | unchanged |
| 7 | Label `[TRANSITIONAL]` | N/A | no transitional code |
| 8 | Subtract before adding | PASS | additive instrumentation only; mirrors existing pattern, no parallel new path |
| 9 | No fabricated data | PASS | events carry only the real `event_id` + literal `offering_type`; no fake values |
| 10 | Currency-aware | N/A | no price rendering changed |
| 11 | One auth instance | PASS | buyer-web/marketing paths anon-tolerant; no `useAuth` introduced |
| 12 | Validate at the right time | N/A | no datetime logic |
| 13 | Exclusion consistency | N/A | unchanged |
| 14 | Persisted-state startup | PASS | consent `_hasHydrated`-equivalent (localStorage re-apply on init/mount) unchanged; capture only on active choose, not on the mount re-apply |

Zero violations.

---

## 8. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS | N/A (skip) | app-mobile untouched |
| Consumer Android | N/A (skip) | app-mobile untouched |
| Buyer / anonymous Web | **PASS (CI build + source)** | trip+exp checkout fire `web_checkout_started`; Accept fires `consent_granted` after opt-in. expo-export web build green in CI |
| Business iOS | **PASS (no-op)** | imports resolve to native no-op stub; zero behavior change |
| Business Android | **PASS (no-op)** | same |
| Admin Web (adjacent) | N/A (skip) | not touched |
| Marketing Web (adjacent) | **PASS (CI build + source)** | Accept fires `consent_granted` (PostHog+GA4); Reject fires cookieless GA `consent_denied` only. marketing perf-budget gate (0891) + consent-gate-before-cookies gate green in CI |

**Live-fire sim:** EXEMPT (web-only analytics, native no-op). No physical-iPhone step required — no native runtime behavior changes. **CI build gates (the COMMS-0052 local blocker) ran and PASSED on PR #597** — this is the authoritative replacement for the local export/budget runs the implementor flagged PENDING.

---

## 9. Discoveries for orchestrator

- **The implementor's "PENDING CI" build gates (COMMS-0052) are now GREEN in CI** on PR #597: "mingla-business: web build (expo export)" pass (1m57s), "ORCH-0891 marketing performance budget" pass, "META-ORCH-1187 ... consent-gate-before-cookies" pass. The local blocker (anchor node_modules missing `posthog-js` + `expo-tracking-transparency`; marketing has no node_modules) is real but CI's clean install resolved it. Total checks: **227 pass / 1 skip (Supabase Preview, no migration) / 0 fail.**
- **Deploy-gate watch (from prior memory):** "Vercel – mingla-marketing" shows "Canceled by Ignored Build Step" — expected for a `[deploy]`-gated branch when the ignored-build-step logic short-circuits; confirm the marketing Vercel build actually fires on merge to main (the known `[deploy]`-gate cancel trap: a later non-`[deploy]` commit can cancel the web build). Web buyer + marketing both deploy via Vercel from merged main; no OTA.
- COMMS-0052 (BLOCK, business OTA frozen) acknowledged as factored-in: this change is web-Vercel only, NOT an OTA, so it is unaffected by the OTA freeze.

---

## 10. Routing

**PASS → CLOSE (orchestrator).** No rework. No accepted conditions (clean PASS). Both regression tests on-branch + in-diff; build gates green in CI.
