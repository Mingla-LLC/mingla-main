# IMPLEMENTATION — ORCH-1082 [Business-app notification deep-link handlers]

**Mode:** IMPLEMENT (Claude `mingla-implementor`)
**Date:** 2026-06-05
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1082-[business-notification-deeplink-handlers]/` on branch `ORCH-1082-business-notification-deeplink-handlers` (rebased clean onto `origin/main`)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1082_BUSINESS_NOTIFICATION_DEEPLINK_HANDLERS.md`
**Status:** implemented and verified (one pre-existing unrelated test failure documented as a Discovery)

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. Relevant WARN entries, all factored:
- **COMMS-0002** (C7 backend allowlist required, same commit) — satisfied: `ORCH_1082_BACKEND_ALLOWLIST` added in the same commit as the backend change; full gate run exit 0, C7 OK.
- **COMMS-0015** (deploy from MERGED main at CLOSE, never from worktree) — honored: no deploy, no db push from this worktree. Both edge fns flagged for deploy-from-main at close.
No BLOCK entries addressed to this ORCH/skill. No new cross-ORCH discovery requiring a new COMMS entry.

---

## 1. What changed (gap-by-gap)

### Gap 15 — CLIENT (`mingla-business/src/services/businessNotificationRouting.ts`)
**Before:** the `case "brand":` block handled only `team` + `listing` subs; `brand/{id}/payments/onboard` fell through to `return /brand/${brandId}` (the bare brand hub). The KYC-stall reminder + deadline warnings (both emitted by `stripe-kyc-stall-reminder` via `notifyBrand` with deepLink `mingla-business://brand/${brandId}/payments/onboard`) never reached the onboarding screen.
**After:** added a `payments` sub-branch: `rest[2] === "onboard"` → `/brand/${brandId}/payments/onboard`; bare → `/brand/${brandId}/payments`. team/listing/bare-brand/missing-brandId unchanged.
**Routes confirmed present:** `mingla-business/app/brand/[id]/payments/onboard.tsx` ✅, `mingla-business/app/brand/[id]/payments/index.tsx` ✅.
**Lines changed:** ~12 added.

### Gap 16 (redefined) — documentation only, no code
The investigation's "deadline_warning reaches nobody (user_id: null)" was overturned in the spec: `notifyBrand` resolves real recipients (`getBrandPaymentManagerUserIds`) and dispatches `userId: userIds[i]` with the `stripe.` prefix (correct business-app routing). Its only real defect was the dropped `payments/onboard` sub-path — fixed entirely by Gap 15. No backend change, no edge fn touched for Gap 16. Recorded here per SC-16.2.

### Gap 17a — BACKEND (`supabase/functions/partner-stripe-detach/index.ts`)
**Before:** emitted `type: "partner_stripe.detach_completed"` (+ matching idempotencyKey prefix) and `deepLink: "mingla-business://account/partner-earnings"`. The `partner_stripe.` prefix matched neither `business.` nor `stripe.` in `resolveOneSignalApp`, so it fell to the consumer OneSignal app and the business device never received it.
**After:** `type: "stripe.partner_detach_completed"` (+ idempotencyKey prefix) so it inherits the existing `stripe.` business-app routing (zero change to the shared `resolveOneSignalApp`); `deepLink: "mingla-business://partner/earnings"`.
**Lines changed:** ~10 (incl. provenance comment).

### Gap 17b — CLIENT (`businessNotificationRouting.ts`)
**Before:** no `partner` head in the parser; the old `account/partner-earnings` had neither a parser head nor a route file.
**After:** added `case "partner":` → `sub === "earnings" ? "/partner/earnings" : null`.
**Route confirmed present:** `mingla-business/app/partner/earnings.tsx` ✅.
**Lines changed:** ~6 added.

### venue_claim — BACKEND (`supabase/functions/admin-review-venue-claim/index.ts`)
**Before:** both `venue_claim_review` (`:631`) + `venue_claim_feedback` (`:316`) direct `sendPush()` calls omitted the `app` param, so `sendPush` defaulted `app = "consumer"`. Both target the organiser (`brand.account_id` / `fbBrand.account_id`) — a business-app user — so the pushes reached nobody.
**After:** added `app: "business"` to BOTH calls. Also added (spec OPEN, recommended) `deepLink: mingla-business://brand/${parsed.brandId}/listing` to both `data` payloads so the organiser lands on the venue listing (parser already handles `brand/{id}/listing` — no parser change).
**Lines changed:** ~16 (both call sites incl. comments).

### C7 allowlist — `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
Added `ORCH_1082_BACKEND_ALLOWLIST` (partner-stripe-detach/index.ts, admin-review-venue-claim/index.ts, the new Deno test) + spread into `ALLOWLIST`, in the SAME commit as the backend change (COMMS-0002).

---

## 2. Files changed (with commit hashes)

Commit **`c584aabb0`** — code + tests + allowlist (single commit, COMMS-0002):
| File | Layer | Change |
|------|-------|--------|
| `mingla-business/src/services/businessNotificationRouting.ts` | client parser | Gap 15 `payments`/`onboard` branch + Gap 17b `partner` head |
| `supabase/functions/partner-stripe-detach/index.ts` | edge (DEPLOY) | Gap 17a re-prefix type+idempotencyKey → `stripe.partner_detach_completed`; deepLink → `mingla-business://partner/earnings` |
| `supabase/functions/admin-review-venue-claim/index.ts` | edge (DEPLOY) | venue_claim: `app:"business"` on both `sendPush` + listing deepLink |
| `mingla-business/src/services/__tests__/businessNotificationRouting.test.ts` | client test | 7 ORCH-1082 happy-path cases (append-only) |
| `supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts` | edge test (NEW) | adversarial push-app-routing test |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | CI gate | `ORCH_1082_BACKEND_ALLOWLIST` |

Commit **`f5457ac3c`** — spec + investigation artifacts.

No migration. No RLS. No DB function. No consumer-app / admin-web / buyer-web change.

---

## 3. Edge functions to DEPLOY from merged main at CLOSE (COMMS-0015)
1. `supabase/functions/partner-stripe-detach`
2. `supabase/functions/admin-review-venue-claim`

Deploy command (from merged main, after the PR lands):
```
supabase functions deploy partner-stripe-detach --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy admin-review-venue-claim --project-ref gqnoajqerqhnvulmnyvv
```
**No `supabase db push`** (there is no migration).

---

## 4. Spec success criteria — verification matrix

| SC | Statement | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-15.1 | `…/brand/B/payments/onboard` → `/brand/B/payments/onboard` | PASS | client test green |
| SC-15.2 | `…/brand/B/payments` → `/brand/B/payments` | PASS | client test green |
| SC-15.3 | team/listing/bare/missing-brandId unchanged | PASS | regression cases green |
| SC-15.4 | tapped kyc_stall/deadline → onboarding | PASS (mechanism) | deepLink emitted by stripe-kyc-stall-reminder + parser now maps it |
| SC-16.1 | deadline_warning → onboarding via Gap 15 | PASS | same parser path; distinct type |
| SC-16.2 | report records the corrected finding | PASS | §1 Gap 16 above |
| SC-17.1 | `resolveOneSignalApp("stripe.partner_detach_completed") === "business"` | PASS | Deno test green |
| SC-17.2 | emitter uses new type + new deepLink; no old type remains | PASS | Deno source-assert test green |
| SC-17.3 | `…/partner/earnings` → `/partner/earnings` | PASS | client test green |
| SC-17.4 | partner-detach reaches business app + `/partner/earnings` | PASS (mechanism) | re-prefix + parser case |
| SC-17.5 | unknown heads still → null | PASS | regression case green |
| SC-VC.1 | both venue_claim sendPush pass `app:"business"` | PASS | Deno source-assert (`>=2` opt-ins) green |
| SC-VC.2 | organiser push hits BUSINESS app_id | PASS | Deno delivery-target test captures BUSINESS_APP_ID |
| SC-VC.3 | (OPEN) listing deepLink added → routes to `/brand/{id}/listing` | PASS | deepLink added to both payloads |

---

## 5. Regression tests

### Test 1 — implementor happy-path (CLIENT parser)
**Path:** `mingla-business/src/services/__tests__/businessNotificationRouting.test.ts` (7 new cases under `describe("ORCH-1082 residual routing")`).
**Pass:** `7 passed` (filtered run); full file `27 passed, 1 failed` (the 1 failure is pre-existing — see §7 Discovery).
**Fails-on-revert PROVEN @ `cd5bd67bb`:** reverted `businessNotificationRouting.ts` to origin/main, kept the new test → the 3 load-bearing cases (Gap 15 onboard, Gap 15 bare payments, Gap 17b partner/earnings) went RED (`3 failed, 4 passed`); restored the fix → `7 passed`. **`fails-on-revert verified at cd5bd67bb`.**

### Test 2 — tester adversarial angle (BACKEND push-app routing)
**Path:** `supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts` (Deno, fetch-stub pattern mirroring meta_orch_1074).
**Distinct angle:** attacks the DELIVERY TARGET (which OneSignal app physically receives the push) — a layer Test 1 (pure path parsing) never exercises. Asserts an `app:"business"` push captures the BUSINESS app_id (never consumer), plus 17a type-routing + source-shape assertions.
**Pass:** `5 passed | 0 failed`.
**No regression:** existing `meta_orch_1074_push_routing.test.ts` still `4 passed | 0 failed`.

---

## 6. Local checks captured

- **C7 strict-grep gate:** full run **exit 0** — `OK [C7: no-new-backend-files] … (6 files changed total)`; all checks PASS. The 3 backend paths are allowlisted via `ORCH_1082_BACKEND_ALLOWLIST`.
- **tsc (mingla-business):** no errors in `businessNotificationRouting.ts` (grep clean).
- **expo lint (mingla-business):** no errors/warnings on the touched file.
- **deno test (new):** `5 passed | 0 failed`.
- **deno test (existing 1074):** `4 passed | 0 failed` (no regression).
- **deno check (edge fns):** the `TS2345` supabase-js generic-version skew at `writeAudit(supabase, …)` (line 115) is **pre-existing on origin/main** (origin/main's copy already reports 4 errors at the same call sites) — NOT introduced by ORCH-1082; my edits are at the `dispatchNotification` block (lines 126-145), unrelated to the error locus. CI does not gate on `deno check` of these files for this reason.

---

## 7. Discoveries for orchestrator

- **Pre-existing broken test on main:** `businessNotificationRouting.test.ts › processBusinessNotification › authenticated → marks row read + navigates` fails on clean origin/main with `supabase.from(...).update(...).eq(...).select is not a function`. The SUT's `markRowClicked` chains `.select("id")` (added by a prior ORCH per the I-PROPOSED-I comment) but the test mock `updateEq` returns `{ then }` without a `.select` stub. Proven pre-existing by checking out origin/main's exact copies of both files and re-running (`1 failed`). It is in an existing/locked test case so ORCH-1082 did not modify it (append-only). Recommend a tiny follow-up to fix the mock (add `.select` to the `updateEq` chain) under `[TEST-MOD-APPROVED]`.

---

## 8. Cross-surface impact
In scope: Business iOS + Business Android (shared parser TS → automatic parity) + the two edge fns (server, platform-agnostic). Out: consumer app (these are organiser-only; re-prefix + app:"business" REMOVE erroneously-consumer-routed pushes — a correction, no consumer code touched), admin-web, buyer/anon web. No platform-divergent code path.

## 9. Invariants
- I-NOTIFICATIONS-FILTERED-BY-APP-TYPE-PREFIX: preserved (17a re-prefixes into the existing `stripe.` namespace; `push-utils.ts` byte-stable; VC uses explicit `app:"business"` on a direct `sendPush`).
- SC-A2 (no cross-app fallback): preserved (unchanged `sendPush`).
- Constitution #3 (no silent failures): the new parser branches return real paths; no swallow.
