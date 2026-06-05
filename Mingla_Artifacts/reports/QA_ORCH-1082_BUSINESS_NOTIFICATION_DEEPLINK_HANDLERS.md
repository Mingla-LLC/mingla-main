# QA — ORCH-1082 [Business-app notification deep-link handlers]

**Mode:** TARGETED (orchestrator-dispatched ORCH-ID)
**Skill:** `mingla-tester` (Claude)
**Date:** 2026-06-05
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1082-[business-notification-deeplink-handlers]/` on branch `ORCH-1082-business-notification-deeplink-handlers`
**Code under test:** implementor commit `c584aabb0` (code + tests + allowlist). Tester commit `82ec672d5` (my two adversarial tests + allowlist entry).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1082_BUSINESS_NOTIFICATION_DEEPLINK_HANDLERS.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1082_BUSINESS_NOTIFICATION_DEEPLINK_HANDLERS.md`

---

## VERDICT: CONDITIONAL PASS — Grade A

All four fixes are correct against spec SCs and proven by independent tests. The single deferral is the on-device tap proof: the business app on the booted sim is a STALE dev binary (pre-ORCH-1082 JS) that requires a worktree-Metro rebuild **and** an operator-authenticated organiser session to render the routed screens. The routing **mechanism** is `proven` by the parser tests against the exact `parseBusinessDeepLink` function the app calls + confirmed-existing route files; the OS-level deep-link plumbing is confirmed accepting both target URIs on the sim. This is the same deferral pattern Seth accepted on ORCH-1080's first pass.

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2 (praise)

### Comms ledger
Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`WARN` row is addressed to `mingla-tester`, `ORCH-1082`, or `ALL` requiring an action this turn. COMMS-0002 (C7 backend allowlist) and COMMS-0003 (external-API docs cited) are relevant and already satisfied by the implementation + verified below. No new cross-ORCH discovery → no new ledger entry.

---

## Per-gap evidence (spec SC matrix)

### Gap 15 — `payments`/`payments/onboard` sub-path (client parser) — SC-15.1…15.4 PASS
Source `businessNotificationRouting.ts:89-93` adds the `payments` sub-branch: `rest[2] === "onboard"` → `/brand/${brandId}/payments/onboard`, bare → `/brand/${brandId}/payments`. Route files confirmed present:
- `mingla-business/app/brand/[id]/payments/onboard.tsx` ✅
- `mingla-business/app/brand/[id]/payments/index.tsx` ✅

Verified by implementor Jest cases (7 passed in the ORCH-1082 describe block) + my adversarial parser test (boundary/malformed cases). SC-15.4 (KYC-stall/deadline tap → onboarding) holds by mechanism: `stripe-kyc-stall-reminder` emits `deepLink: mingla-business://brand/${brandId}/payments/onboard` and the parser now maps it.

### Gap 16 (redefined) — deadline_warning recipients correct; fixed by Gap 15 — SC-16.1/16.2 PASS
No backend change (spec overturn confirmed in the report §1). Same parser path as Gap 15, distinct type. SC-16.2 documentation recorded in the implementation report §1.

### Gap 17a — re-prefix `partner_stripe.detach_completed` → `stripe.partner_detach_completed` (backend) — SC-17.1/17.2 PASS
Diff `partner-stripe-detach/index.ts:126-145` (verified against spec verbatim): `type`, `idempotencyKey` prefix, and `deepLink` (`mingla-business://partner/earnings`) all changed; old strings removed. `resolveOneSignalApp` (push-utils.ts:53) returns `"business"` for `stripe.*`, `"consumer"` for `partner_stripe.*` — confirmed by both Deno tests. No emitter of `partner_stripe.detach_completed` remains (grep + source-assert test).

### Gap 17b — `partner` head case (client parser) — SC-17.3/17.5 PASS
Source `businessNotificationRouting.ts:100-103`: `case "partner"` → `sub === "earnings" ? "/partner/earnings" : null`. Route `mingla-business/app/partner/earnings.tsx` ✅. Unknown heads still → `null` (regression cases + my adversarial test).

### venue_claim — `app:"business"` on both direct `sendPush` calls (backend) — SC-VC.1/VC.2/VC.3 PASS
Diff `admin-review-venue-claim/index.ts` (both `venue_claim_review` ~`:646` and `venue_claim_feedback` ~`:316`): `app: "business"` added to both `sendPush` payloads + the OPEN-recommended `deepLink: mingla-business://brand/${parsed.brandId}/listing`. My/implementor Deno delivery-target test captures the BUSINESS app_id (`22222222-…`), never the consumer one. SC-VC.3 satisfied (listing deepLink added; parser already handles `brand/{id}/listing`).

---

## Test runs (captured)

### 1. Implementor happy-path (Jest) — `mingla-business/src/services/__tests__/businessNotificationRouting.test.ts`
- ORCH-1082 describe block: **7 passed** (Gap 15 onboard, Gap 15 bare, Gap 17b partner, Gap 17b unknown-sub, 3 regression guards).
- Full file: **27 passed, 1 failed** — the 1 failure is the documented PRE-EXISTING `.select` mock mismatch (see §Pre-existing failure).

### 2. Implementor happy-path fails-on-revert — INDEPENDENTLY RE-VERIFIED
Reverted `businessNotificationRouting.ts` to `origin/main` (kept the new test), re-ran the ORCH-1082 cases:
```
✕ Gap 15: brand payments/onboard → onboarding screen
✕ Gap 15: brand payments (bare) → payments hub
✕ Gap 17b: partner/earnings → /partner/earnings
✓ regression guards (4)
Tests: 3 failed, 21 skipped, 4 passed
```
The 3 load-bearing cases go RED on revert; restored → 7 passed. Working tree restored clean. **fails-on-revert confirmed at `origin/main` parser baseline.** (Implementor cited fails-on-revert @ `cd5bd67bb`.)

### 3. Implementor adversarial Deno test — `supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts`
**5 passed | 0 failed.** Captured the BUSINESS app_id (`22222222-2222-2222-2222-222222222222`) on the `app:"business"` push — proves an organiser-targeted push physically cannot land on the consumer app_id. Existing `meta_orch_1074_push_routing.test.ts` still **4 passed** (no regression).

### 4. Tester-authored adversarial tests (TWO distinct angles, committed `82ec672d5`)

**(a) Parser malformed-input / graceful-degradation — `mingla-business/src/services/__tests__/orch_1082_parser_adversarial.test.ts` (Jest, NEW file, additions only).**
Angle: attacks the parser's GRACEFUL-DEGRADATION contract under malformed input (empty/garbage paths, trailing/duplicate slashes, the `payments` HEAD vs `brand/{id}/payments` SUB confusion, partial `partner` paths, deeper-than-handled leaves, wrong-case scheme, the OLD removed `account/partner-earnings` link). A layer neither implementor test exercises.
- Run: **18 passed.**
- Fails-on-revert: reverting the parser → **5 load-bearing cases RED** (the throw-safety cases correctly stay green — graceful degradation held pre-fix; routing-correctness cases fail). Proves the test is load-bearing, not vacuous.

**(b) `resolveOneSignalApp` routing-breadth no-regression — `supabase/functions/_shared/__tests__/orch_1082_resolve_app_no_regression.test.ts` (Deno, NEW file).**
Angle: proves the 17a re-prefix did NOT silently WIDEN or NARROW the business-app routing universe — every existing `business.*`/`stripe.*` type still → business; a broad sweep of real consumer/neutral prefixes still → consumer; near-miss prefixes (wrong case, non-prefix substring, leading space) resolve to consumer (exact-prefix match, not fuzzy); undefined/null/empty default to consumer without throwing. The implementor Deno test only asserts the single moved type; this guards the whole boundary.
- Run: **4 passed.**

All Deno tests together (5 implementor + 4 tester + 4 existing 1074): **13 passed | 0 failed.**

### 5. C7 strict-grep gate
`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → **exit 0, `# All checks PASS`**, `OK [C7: no-new-backend-files] … (11 files changed total)`. Both production edge fns + the implementor Deno test + my new Deno test are allowlisted via `ORCH_1082_BACKEND_ALLOWLIST` (I added my test to the allowlist in the same commit). **Allowlist is load-bearing:** I committed my backend test WITHOUT the allowlist entry first and observed C7 `FAIL … offenders`, then added the entry → back to green.

### 6. Type / lint
- **tsc (mingla-business):** zero errors in `businessNotificationRouting.ts`. Whole-package error count is **256 on both `origin/main` and HEAD** — identical baseline; the parser change introduces **no new type errors**.
- **expo lint (mingla-business):** clean on the touched file.
- **deno check:** `admin-review-venue-claim/index.ts` clean. `partner-stripe-detach/index.ts` reports one `TS2345` at `writeAudit(supabase, …)` line 115 — a supabase-js generic-version skew at a call site NOT touched by ORCH-1082 (the diff is the `dispatchNotification` block at 126-145). **Confirmed PRE-EXISTING on `origin/main`** (checked out origin/main's copy → identical TS2345 at the `writeAudit` call). Not an ORCH-1082 regression.

---

## Pre-existing failure confirmation (NOT an ORCH-1082 regression)
The implementation report documents `businessNotificationRouting.test.ts › processBusinessNotification › authenticated` failing with `supabase.from(...).update(...).eq(...).select is not a function`. **Independently confirmed pre-existing:** checked out `origin/main`'s exact copies of BOTH the SUT and the test file, re-ran → `1 failed` with the identical `.select is not a function` error. Root cause: `markRowClicked` chains `.select("id")` (present on origin/main at line 159, added by a prior ORCH) but the test mock `updateEq` (line 30) returns `{ then }` with no `.select` stub. ORCH-1082 did not touch `markRowClicked` or that test case (append-only). **It fails on clean origin/main — a real finding only insofar as the mock needs a tiny follow-up fix; it is NOT introduced by ORCH-1082.** Recommend a follow-up to add `.select` to the `updateEq` mock chain under `[TEST-MOD-APPROVED]`.

---

## On-device leg (live-fire gate) — `probable`, deferred
- Surface: business app deep-link routing (iOS + Android — shared JS parser, platform-agnostic OneSignal routing).
- **iOS sim:** iPhone 17 Pro (`17091E60-C3B6-4167-980D-60C348E177F6`) booted, `com.sethogieva.minglabusiness` installed. The `mingla-business://` scheme IS registered in the binary (Info.plist CFBundleURLSchemes). `xcrun simctl openurl` on both `mingla-business://partner/earnings` and `mingla-business://brand/test-brand/payments/onboard` returns exit 0 (OS deep-link plumbing accepts the URIs and hands them to the app).
- **Blocker (genuine, not bypassable by tooling):** the installed binary is a STALE dev build (pre-ORCH-1082 JS) showing the Metro dev-loading splash with no bundler connected. A true render proof requires (1) a worktree-Metro rebuild — the worktree's `node_modules` is a symlink to the anchor, which hangs `eas update`/Metro export per `reference_ota_from_worktree_needs_real_npm_ci.md` (needs `rm` symlink + `npm ci`), AND (2) an operator-authenticated **organiser** session, which I cannot create without an operator login. Driving the deep link on the stale binary would exercise the OLD parser, not the fix — an invalid proof.
- **Mechanism proven `proven`:** `parseBusinessDeepLink` is the exact pure function the tap handler calls (`processBusinessNotification` → `resolveBusinessNavTarget` → `parseBusinessDeepLink`); the parser tests assert the post-fix path strings for the precise URIs the edge functions emit, and all four destination route files exist on disk. Android needs no separate proof — the parser is shared JS with no platform-divergent path (spec §8.2).
- **Android emulator:** not booted; not required (shared JS, no divergent code).

**Deferred:** one live organiser-logged-in tap per platform confirming the routed screen renders (KYC/deadline → onboarding; partner-detach → partner earnings; venue-claim → listing). Same deferral Seth accepted on ORCH-1080's first pass. CONDITIONAL on operator-driven (or operator-authed) device tap if a render-level proof is desired before close.

---

## Constitution (relevant rules)
- **#1 No dead taps** — every parser branch returns a real route or `null` (→ NAV_TARGETS fallback); no dead end. PASS.
- **#3 No silent failures** — new branches return real paths; `markRowClicked` row-count verify path unchanged; malformed input degrades to `null`/fallback, never throws (my adversarial test). PASS.
- **One-owner / routing determinism** — `resolveOneSignalApp` byte-stable (no push-utils edit); re-prefix is at the single emitter. PASS.
- Rules 2,4–14: N/A (no DB/state/auth/currency/datetime change).

---

## P4 — praise
- The implementor's Deno adversarial test is genuinely adversarial (attacks the delivery target, captures the actual `app_id`) — not a renamed happy-path. Distinct from the Jest test by construction.
- The 17a re-prefix (vs widening the shared `resolveOneSignalApp` chokepoint) is the minimal-blast-radius choice; `push-utils.ts` stays byte-stable and consumer routing is untouched. Clean, well-commented, docs-cited (COMMS-0003).

---

## Discoveries for orchestrator
1. **Pre-existing broken test** (`processBusinessNotification authenticated`) fails on clean `origin/main` — recommend a tiny `[TEST-MOD-APPROVED]` follow-up adding `.select` to the `updateEq` mock. Not an ORCH-1082 regression; does not block close.
2. **Pre-existing `deno check` TS2345** in `partner-stripe-detach/index.ts` (`writeAudit` supabase-js generic skew) exists on origin/main; CI does not gate `deno check` on these files. Cosmetic, pre-existing.
3. **Deploy-at-close (COMMS-0015):** the two edge fns (`partner-stripe-detach`, `admin-review-venue-claim`) must be deployed FROM MERGED MAIN at close, never from this worktree. No migration, no db push.

---

## Completion self-check
- [x] QA report with evidence-backed verdict (CONDITIONAL PASS Grade A).
- [x] All 4 fixes verified against spec SCs (Gap 15, 17a, 17b, venue_claim) — matrix above.
- [x] Implementor happy-path fails-on-revert INDEPENDENTLY confirmed (3 load-bearing cases RED on origin/main parser).
- [x] Implementor Deno push-app-routing test confirmed (5 passed; BUSINESS app_id captured).
- [x] TWO distinct tester-authored adversarial tests present + passing (parser malformed-input 18/4; resolveOneSignalApp breadth 4/4), both committed in the PR diff, the parser one fails-on-revert.
- [x] C7 exit 0 with both edge fns + both Deno tests allowlisted; allowlist proven load-bearing.
- [x] Pre-existing failure confirmed NOT an ORCH-1082 regression (fails on clean origin/main).
- [~] On-device tap proof deferred (`probable`) — mechanism `proven` by parser tests + existing routes + scheme-accept probe; stale-binary + organiser-login blocker named.
