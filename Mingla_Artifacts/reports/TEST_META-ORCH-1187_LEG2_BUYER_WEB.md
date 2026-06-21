# TEST — META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (BUYER WEB)

**Skill:** mingla-tester (BRUTAL, adversarial)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-leg2-buyer-web`
**Tested commits:** `30f7120a8` (code) + `475b30966` (impl report), based on origin/main `120806a83`; tester adversarial test committed at `eba948129`.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md` (v2)
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1187_LEG2_BUYER_WEB.md`
**Mode:** SPEC-COMPLIANCE + SECURITY (source/build-level; live-fire capped per dispatch)

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 3 · P4: 2.

**Condition (single, pre-declared in the dispatch CAP):** live-fire is PENDING — events actually
landing in PostHog 479999 + GA4 Realtime, and an actual masked-replay recording inspection on
deployed `business.usemingla.com`, require Vercel env vars + a deploy and could NOT be performed at
source/build level. Per the dispatch this is an accepted deferral, not a defect. All source/build-level
criteria PASS. No P0/P1 found. Regression gate satisfied (implementor happy-path test + tester
adversarial test both on-branch, in-diff, fails-on-revert proven).

### §SC-Security (checkout replay masking) — the #1 check this leg — RESULT: **PASS (structural + architectural)**

The strongest possible result without a live recording. Reasoning, exhaustively:

- **Card / payment fields: CANNOT leak — architecturally impossible on web.** Web checkout does NOT
  render card fields on any mingla-business page. `app/checkout/[eventId]/payment.tsx:358-420`
  (`Platform.OS === "web"` branch) performs `createTicketCheckout({surface:"web"})` →
  `window.location.assign(hostedCheckoutUrl)` — a **full-page redirect to Stripe's hosted Checkout
  domain (`checkout.stripe.com`)**. PostHog session replay on the mingla-business origin stops at
  navigation and cannot record a cross-origin page. There is no in-DOM `<PaymentElement>`/CardField/
  iframe on the buyer-web surface to capture. The payment page itself shows only "You'll be redirected
  to Stripe…" copy + a truncated session id (`payment.tsx:681-692`) — no PII, no card.
- **Buyer email / name / phone (entered on `buyer.tsx`): masked.** These are `TextInput` fields
  (`buyer.tsx:574/594/613`) → react-native-web `<input>`. `session_recording.maskAllInputs: true`
  (set in `webAnalytics.web.ts:218`, the posthog-js global default kept ON) masks every input value in
  replay. The values are NOT echoed as plain `<Text>` anywhere on `buyer.tsx`/`payment.tsx`.
- **PII echo on the confirm screens: explicitly hard-tagged.** All 3 confirm routes render
  `Sent to {buyer.email} and {buyer.phone}.` as `<Text>` — each carries `{...phMaskProps()}` which
  emits `dataSet={{ phMask: "true" }}` → `data-ph-mask` DOM attr, matched by
  `maskTextSelector: "[data-ph-mask]"` so replay renders it as a masked block. Sites:
  `app/checkout/[eventId]/confirm.tsx:494`, `app/checkout-trip/[tripEventId]/confirm.tsx:464`,
  `app/checkout-experience/[experienceEventId]/confirm.tsx:403`.
- **Config never weakened:** `maskAllInputs: true` + `maskInputOptions:{password:true,email:true}` +
  `maskTextSelector:"[data-ph-mask]"` are the ACTUAL parsed config values (proven by my adversarial
  parse-and-assert test, not a text grep). Strict-grep gate `i-proposed-1187-replay-masks-pii` PASS;
  fails when flipped to false (verified).

**Residual (capped, NOT a fail):** the only proof not obtainable at source level is a live recording of
a real checkout showing the masked blocks (T-16 / SC-Security-Web runtime). Given the architecture
(card offsite, inputs masked, PII tagged), the live-fire is expected to confirm — but it MUST be run
before final close. Marked PENDING LIVE-FIRE.

---

## 2. SC-by-SC matrix (LEG-2 scope)

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-3-BuyerWeb | public page → PostHog `$pageview`+`web_public_offering_viewed`+GA4; native has no posthog-js/gtag | PASS (code+build); runtime PENDING LIVE-FIRE | `web_public_offering_viewed` wired in all 4 public routes (e/t/exp/b), one-shot ref-gated; native isolation proven below (T-6 analog) |
| SC-4-BuyerWeb | web checkout complete → PostHog `web_purchase_completed`+GA4 `purchase`(value+currency) | PASS (code); runtime PENDING LIVE-FIRE | `captureWeb("web_purchase_completed")`+`gaEvent("purchase",{value,currency})` at all 3 confirm routes, one-shot keyed on orderId |
| SC-9-SecretHygiene | no `phx_*` in source/bundle; only `phc_*`+`G-Z4W3B9900S` | PASS | grep: 0 `phx_` (only the word in a comment); the single `phc_…` is the public client key as app.config fallback; gate `no-phx-in-client` PASS (2941 files) |
| SC-11-Consent-BuyerWeb | no capture/no cookies until Accept; banner links usemingla.com/privacy-policy | PASS (code); runtime PENDING LIVE-FIRE | `opt_out_capturing_by_default:true` + GA4 consent-default-all-denied before config; banner `PRIVACY_POLICY_URL="https://usemingla.com/privacy-policy"` |
| SC-Security-Web | replay masks inputs/card/email/amount on checkout | PASS (structural+architectural); runtime recording PENDING LIVE-FIRE | see §1 §SC-Security analysis |
| SC-Security-Config | mask flags never false anywhere | PASS | gate `replay-masks-pii` PASS; my parsed-value test asserts `maskAllInputs===true` |
| SC-13-Flags | feature flag read resolves on a web surface | PASS (code) | `getFeatureFlagWeb()` exported, default-safe (try/catch → undefined) |
| SC-15-Errors | thrown error captured to PostHog error tracking (web) | PASS (code); runtime PENDING LIVE-FIRE | `capture_exceptions:true` in init |
| SC-16-CostGuard | replay sampling configured | PASS (code) | `sampleRate:0.2` (SESSION_REPLAY_SAMPLE_RATE); autocapture narrowed to click/submit. SA-1 ($0 cap) = Seth out-of-band |
| I-POSTHOG-HOST-US | US host at every init | PASS | gate `posthog-host-us` PASS (2 init sites, US); web-build false-positive is local-only (DISC-B, §7) |

Out-of-leg SCs (SC-1/2/5/6/7/8/10/12/14/SC-Security-Native): N/A to LEG 2 (marketing = LEG 1 merged;
native = LEG 3 not in this branch).

---

## 3. Findings (P-numbered)

No P0, no P1, no P2.

### P3-1 — Spec §4.H "payment container `ph-no-capture`" not applied (defensible / no live blast radius)
- **Evidence:** spec §4.H asks the checkout payment CONTAINER carry `ph-no-capture`. `payment.tsx` has
  no such tag; `phNoCaptureProps()` (the className-based helper) is exported but used nowhere in
  `app/`.
- **Impact:** none in practice — web card entry is on Stripe's hosted page (offsite, not in the
  recorded DOM); the payment.tsx page renders no card/PII. There is no container that could leak.
- **Required fix:** none required for LEG 2. If a future change ever renders an inline payment element
  on the mingla-business origin, the container MUST be tagged `ph-no-capture` then.
- **Retest:** re-audit if buyer-web ever moves card entry inline (Payment Element).

### P3-2 — `phNoCaptureProps()` relies on react-native-web `className` pass-through (untested at runtime here)
- **Evidence:** `phMask.web.ts:25` returns `{ dataSet:{phMask:"true"}, className:"ph-no-capture" }`.
  RNW `className` forwarding to non-text Views is version-dependent; only used on the consent banner
  host (`ConsentBanner.web.tsx:71`) to keep the banner OUT of replay. The PII-bearing confirm lines
  use `phMaskProps()` (dataSet → `data-ph-mask`), the RELIABLE path.
- **Impact:** if RNW drops `className`, only the consent banner itself might be recorded — the banner
  contains no PII (it's a cookie notice). Zero PII risk. The actual PII masking does not depend on
  `className` (it uses `data-ph-mask`).
- **Required fix:** none. Optionally switch the banner to `data-ph-mask` too for belt-and-suspenders.
- **Retest:** live replay inspection of the banner (LIVE-FIRE).

### P3-3 — DISC-B: LEG-1 1187 gates walk `web-build/` (local-only false-positive; CI unaffected)
- **Evidence:** `i-proposed-1187-{posthog-host-us,no-phx-in-client,replay-masks-pii}.mjs` `isExempt()`
  excludes `node_modules`/`.next`/`.github`/`Mingla_Artifacts`/tests but NOT `web-build/`/`dist/`.
  After a local `expo export`, the posthog-js SDK chunk (`module-112*.js`, which ships
  `eu.i.posthog.com` as an SDK default + mask config strings) trips all three gates as FALSE failures.
- **CI impact:** NONE — verified. `web-build/` is gitignored (`git check-ignore` confirms; 0 tracked
  files); CI runs on a fresh git checkout with no `web-build/`. I re-ran all 5 gates with `web-build/`
  ABSENT → all exit 0. The impl report's DISC-B is accurate; the only correction is that the gates DO
  have an `isExempt` list — it simply omits `web-build`.
- **Required fix:** none for LEG 2 (out of scope — these are LEG-1 gate files). Suggest the orchestrator
  add a `web-build/`/`dist/` exclusion to the three LEG-1 gates' `isExempt` as a hygiene follow-on so
  local runs after an export don't false-fail.
- **Retest:** `rm -rf web-build && node <gate>` → exit 0 (done, all green).

### P4-1 (praise) — Clean lazy-load architecture protects the bundle AND native isolation in one move
posthog-js loaded via `await import("posthog-js")` → the 216KB SDK + rrweb live entirely in lazy
chunk `module-112*.js`; ZERO `opt_in_capturing`/`rrweb` in the ~89 `index-*` entry chunks; the single
`posthog.com` token in the entry is just the US host literal. ORCH-1083 budget PASS with `__common`
within cap.

### P4-2 (praise) — Comment-stripped, deletion-robust gates + a real fails-on-revert posture
Both the new wiring gate and the consent-gate gate strip comments before matching, so a doc-comment
that mentions a guarded literal cannot mask a real-code deletion. Proven: deleting the real
`opt_out_capturing_by_default: true` line failed 2 gates + 1 unit test while the comment remained.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

Implementor claimed: deleting `opt_out_capturing_by_default: true,` from `webAnalytics.web.ts` (true
line deletion) → unit test `opts out of capturing by default` FAILS (1 failed/17 passed) + both
strict-grep gates FAIL; restore → 18/18 + gates green.

**I reproduced it independently** (backup → `perl -0pi` true line deletion → run → restore):
- Unit test: **`Tests: 1 failed, 17 passed, 18 total`** — failing assertion exactly
  `expect(src).toMatch(/opt_out_capturing_by_default\s*:\s*true/)` at test line 38. ✓ matches claim.
- `i-proposed-1187-consent-gate-before-cookies.mjs` → exit **1** (FAIL). ✓
- `orch-1187-leg2-buyer-web-analytics-wired.mjs` → exit **1** (FAIL). ✓
- After restore: 18/18 PASS, both gates exit 0, `git diff --stat` shows the file back to +313/-0 (the
  exact committed NEW-file state). ✓ tree clean.

Confirmed at the tested code state (branch HEAD `30f7120a8` for code; my run on the rebased worktree).

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle)

- **Path:** `mingla-business/src/analytics/__tests__/orch1187Leg2BuyerWebAnalytics.tester.test.ts`
- **Commit:** `eba948129` (on branch `META-ORCH-1187-leg2-buyer-web`, in the closing diff).
- **Angle (vs the implementor's pure source-TEXT grep):** RUNTIME BEHAVIOR —
  1. Executes the real native no-op stub: every export callable, returns the documented empty value,
     throws nothing, pulls no posthog-js (proves the "no-op" is real behavior, not just an absent line).
  2. Native `phMask` stub returns `{}` (no `data-ph-mask` leak on native).
  3. §SC-Security: extracts the real `session_recording` object from source and `eval`-parses it into a
     LIVE object, asserting `maskAllInputs === true`, `maskInputOptions.{password,email} === true`,
     `maskTextSelector === "[data-ph-mask]"`, `0 < sampleRate <= 0.2` as PARSED VALUES (a regex passes
     if the literal sits in a comment; this asserts the actual config value).
  4. GA4 consent gate: replays the exact gtag-shim sequence onto a fake `dataLayer` and asserts the
     all-denied `consent`/`default` push strictly PRECEDES the `config` push at RUNTIME (+ a source-order
     corroboration).
- **Result:** 9/9 PASS on the as-shipped tree.
- **fails-on-revert verified at `eba948129`:** flipping `maskAllInputs: true`→`false` in the real module
  → my test `maskAllInputs is the literal value true` FAILS (`Tests: 1 failed, 8 passed`) AND the
  `replay-masks-pii` gate exits 1; restored → 9/9 + gate green.
- **Both tests in the closing diff:** `git diff --name-only origin/main` shows
  `…/orch1187Leg2BuyerWebAnalytics.test.ts` (implementor) + `…tester.test.ts` (tester). ✓

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | Accept/Reject/Manage/Privacy all wired to handlers (`ConsentBanner.web.tsx:51-63`) |
| 2 | One owner per truth | PASS | consent = single `mingla_consent_v1` localStorage key + PostHog opt-state; one analytics facade |
| 3 | No silent failures | N/A→PASS | analytics is best-effort by design; every path try/catch → `console.warn`, never swallows a user-facing op. A missing key warns + no-ops (intended graceful degrade, not a hidden user failure) |
| 4 | One query key per entity | N/A | no React Query changes |
| 5 | Server state stays server-side | N/A | no Zustand/server-state changes this leg |
| 6 | Logout clears everything | N/A | buyer web is anon; identity/reset is LEG 3 |
| 7 | Label `[TRANSITIONAL]` | PASS | none introduced; impl report confirms |
| 8 | Subtract before adding | PASS | no Mixpanel/AppsFlyer removed (parallel run); DO-NOT-TOUCH honored |
| 9 | No fabricated data | PASS | events carry real order/total/currency/slug; no fakes |
| 10 | Currency-aware | PASS | `gaEvent("purchase",{value:result.total,currency:result.currency})` carries real currency |
| 11 | One auth instance | N/A | no auth changes (anon surface) |
| 12 | Validate at the right time | N/A | no datetime logic |
| 13 | Exclusion consistency | N/A | n/a |
| 14 | Persisted-state startup gate | PASS | consent read is guarded (`hasWindow()`, try/catch); banner shows only when no stored choice; no hydration race introduced |

No violations.

---

## 7. Device / parity matrix

| Surface | Result | Detail |
|---------|--------|--------|
| Buyer/anon Web (mingla-business web) | PASS (build/source) + runtime PENDING LIVE-FIRE | web export succeeded; ORCH-1083 budget PASS; 8 call sites wired; consent gate + masking structurally correct. Live capture/recording needs Vercel env + deploy. |
| Business iOS (mingla-business native) | PASS (byte-isolation) | `.web.ts(x)` split + `Platform.OS==='web'` guard; native stubs are pure no-ops (runtime-proven by my adversarial test); posthog-js/rrweb confined to lazy web chunk. Full native `expo export -p ios` string-grep (T-6) not run — structural + gate `analytics-web-only-via-web-ts` PASS. |
| Business Android (mingla-business native) | PASS (byte-isolation) | same code path as iOS native (shared RN). |
| Consumer iOS / Android (app-mobile) | N/A | not touched (LEG 3). |
| Marketing Web | N/A | LEG 1 (merged); not re-touched. |
| Admin Web (adjacent) | N/A | out of Phase-1 scope. |
| Business Web preview (adjacent) | PASS | same web export proven above. |

**Physical iPhone (HITL):** not required for this leg — buyer web is a web surface; native is
unaffected-by-isolation (no native analytics shipped in LEG 2). No physical-device step pending for
LEG 2. (Native on-device verification belongs to LEG 3.)

**Live-fire CAP (PENDING — needs Seth):** events in PostHog 479999 Live Events, GA4 Realtime hits for
`usemingla.com`, and a real masked-replay recording on deployed `business.usemingla.com` — all require
the Vercel env vars set + a deploy. NOT passable on source/build alone; explicitly deferred per dispatch.

---

## 8. Build / gate evidence (raw)

- **Web export:** `npx expo export -p web --output-dir web-build` → `Exported: web-build` (success).
- **ORCH-1083 bundle budget:** `node scripts/ci/orch-1083-initial-bundle-budget.mjs` → **PASS** —
  initial payload 3,215,456 bytes (ceiling 9,405,478), 142 chunk files, 0 deferred specifiers in main
  entry, `__common` within cap. (Matches impl report exactly.)
- **posthog-js deferral / native-isolation:** in `web-build/_expo/static/js/web/`, the SDK+rrweb bulk
  (216,023 bytes) is in lazy `module-112212e1e1620817a16a5ed2f3867d4a.js`; `opt_in_capturing`=0 and
  `rrweb`=0 across ALL ~89 `index-*` entry chunks; the lone entry-chunk `posthog.com` token is the US
  host string from my thin wrapper.
- **Strict-grep gates (all 8 1187 gates, source tree, web-build absent):** all exit 0 —
  `analytics-web-only-via-web-ts`, `consent-gate-before-cookies`, `marketing-layout-mounts-analytics`,
  `no-phx-in-client`, `posthog-host-us`, `replay-masks-pii`, `orch-1187-leg2-buyer-web-analytics-wired`
  (+ its `--self-test`), `tester-consent-gate-deletion-robust`.
- **Workflow registration:** `.github/workflows/strict-grep-mingla-business.yml` adds the new gate
  self-test + run steps. ✓
- **tsc:** zero `error TS` in any LEG-2 analytics file (the repo-wide pre-existing errors live in
  unrelated files on origin/main).
- **Scope:** `git diff --name-only origin/main` = mingla-business web-path files + 1187 gate/workflow +
  report ONLY. Zero app-mobile/supabase/mingla-marketing/mingla-admin. `120806a83` (consumer ORCH-1187)
  is an ancestor of HEAD — its work is preserved, NOT reverted (DISC-A resolved by rebase).

---

## 9. Discoveries for Orchestrator

- **DISC-A (ORCH-ID double-booking, informational):** `120806a83` "ORCH-1187: consumer experience
  purchase/render fixes (#585)" is a DIFFERENT already-merged ORCH-1187 colliding numerically with
  META-ORCH-1187 (Growth Analytics). Resolved on this branch (rebase, ancestor preserved). Consider a
  COMMS row noting the 1187 number is double-booked.
- **DISC-B (P3-3 above):** add `web-build/`/`dist/` to the LEG-1 1187 gates' `isExempt` so a local
  `expo export` doesn't false-fail them. CI is unaffected (web-build gitignored) — verified.
- **Live-fire gate before CLOSE:** SC-3/4/11 runtime + SC-Security-Web recording are PENDING and MUST
  be run after the Vercel env + deploy (incognito smoke per impl report §11). CLOSE for the buyer-web
  leg should be conditioned on that live-fire pass.

---

## 10. Accepted conditions (CONDITIONAL PASS)

1. **Live-fire deferral (pre-accepted in the dispatch CAP):** runtime event landing (PostHog 479999 +
   GA4 Realtime) and the actual masked-replay recording inspection on deployed
   `business.usemingla.com` are PENDING LIVE-FIRE (need Vercel env vars + deploy). Tracked as the
   buyer-web close gate; everything verifiable at source/build level PASSES with zero P0/P1.
