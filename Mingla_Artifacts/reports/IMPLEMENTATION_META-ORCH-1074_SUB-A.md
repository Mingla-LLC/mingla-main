# IMPLEMENTATION — META-ORCH-1074 Sub-A [Backend dual-app push routing + business notification triggers] · THE KEYSTONE

**Date:** 2026-06-04
**Owner:** mingla-implementor+claude
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]/` on branch `META-ORCH-1074-business-notifications`
**Status:** implemented and verified (row/payload/routing layer); live OneSignal delivery (SC-A1) is post-deploy verification by orchestrator/tester.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` §3 (Sub-A) + `SPEC_META-ORCH-1074_SUB-D_COPY_AND_PREFS.md`.
**Scope correction honored:** 11 triggers (NOT 12 — `business.new_follower` DROPPED, operator-locked 2026-06-04). Low-inventory threshold = 10% of capacity.

**Comms-ledger acks (this turn):** COMMS-0002 (ORCH-0863 strict-grep `no-new-backend-files` — `META_ORCH_1074_BACKEND_ALLOWLIST` added in the SAME commit; gate run exit 0, C7 OK) · COMMS-0003 (OneSignal REST docs URLs cited inline at every new/changed param/branch; Supabase docs cited inline in the migration header) · COMMS-0019 (FYI — this is the renumbered META-ORCH-1074 session).

---

## 0. Layman summary

The Mingla Business backend can now physically send push notifications to the **business** OneSignal app (a separate app from the consumer one), and 11 brand-facing events now actually fire a notification: a sale, a sold-out listing, low inventory, a refund, a dispute opened, evidence-due, a payout landing, a Stripe account status change, a new review, a venue-claim decision, and a teammate joining. Until this landed, nothing could reach a brand owner's phone. A hard guard ensures a business push can never silently leak into the consumer app.

---

## 1. Files changed (trigger → site mapping)

### Routing layer (§3.A.2)

#### `supabase/functions/_shared/push-utils.ts`
**Before:** read consumer OneSignal creds at module-top; `sendPush` always used the consumer `app_id` + key.
**Now:** added `OneSignalAppType = "consumer"|"business"`, exported `resolveOneSignalApp(type)` (prefix rule), `PushPayload.app?` (default `"consumer"`, backward-compatible), and call-time per-app credential resolution (`resolveAppCredentials`). `sendPush` selects the app's `{appId, restKey}` by `payload.app`; SC-A2 guard: if the SELECTED app's creds are missing → skip+warn+`return false`, **never** a consumer fallback. `sendPushToMany` gained an `app` passthrough. OneSignal docs URLs cited inline at each new branch.
**Why:** SC-A1 / SC-A2 (the keystone).
**Lines:** ~70.

#### `supabase/functions/notify-dispatch/index.ts`
**Before:** built the push payload with no app selection.
**Now:** imports `resolveOneSignalApp`; sets `pushPayload.app = resolveOneSignalApp(type)`. Everything else (in-app row insert, prefs/quiet-hours/rate-limit/idempotency) is UNCHANGED — only the push delivery target is parameterized.
**Why:** §3.A.2 routing resolution.
**Lines:** ~8.

### Audience resolver + money formatter (§3.A.3, Sub-D §2/F5)

#### `supabase/functions/_shared/stripeEdgeAuth.ts`
**Before:** `getBrandPaymentManagerUserIds` hardcoded the 3 payments roles.
**Now:** added `getBrandTeamUserIdsByRoles(supabase, brandId, roles[])` (role-parameterized); `getBrandPaymentManagerUserIds` is now a thin wrapper over it (no caller breaks). Added `BRAND_PAYMENTS_ROLES` const and `formatMoneyCents(cents, currency)` — currency-aware via `Intl.NumberFormat`, zero-decimal-aware, **no GBP fallback** (ORCH-1034); missing currency returns the bare number, never a wrong symbol.
**Why:** §3.A.3 role-sets + Sub-D F5 money formatting.
**Lines:** ~90.

### Shared trigger module (new)

#### `supabase/functions/_shared/businessNotifyTriggers.ts` (NEW)
Holds `notifyBrandRoles(...)` (fan-out one dispatch per role-resolved recipient with per-user idempotency suffix) and `fireOrderFinalizeNotifications(...)` — the shared order_paid / event_sold_out / low_inventory logic called by BOTH the confirm edge and the webhook. Capacity derived post-finalize via the canonical `pg_public_ticket_types_remaining` RPC (sold formula matches the checkout gate). LOW_INVENTORY_PCT = 0.1. All copy strings are the LOCKED Sub-D §3 templates; `{amount}` formatted via `formatMoneyCents`.

### The 11 trigger call-sites (§3.A.5)

| # | Type | Site (file) | Recipients (live roles) |
|---|------|-------------|--------------------------|
| 1 | `business.order_paid` | `ticket-checkout-confirm/index.ts` (slow path) **+** `_shared/stripeWebhookRouter.ts` `handleTicketCheckoutPaymentIntent` (race-winner) → both call `fireOrderFinalizeNotifications`; idempotency `business.order_paid:{orderId}:{userId}` collapses the double-fire to one row/recipient | brand_owner, brand_admin, finance_manager |
| 2 | `business.event_sold_out` | same finalize path (capacity hits 0) | brand_owner, brand_admin |
| 3 | `business.low_inventory` | same finalize path (≤10% & >0, bucketed) | brand_owner, brand_admin |
| 4 | `business.refund_processed` | `_shared/stripeWebhookRouter.ts` `handleRefundEvent` (after `biz_refund_order_commit_from_webhook`) | brand_owner, finance_manager |
| 5 | `business.dispute_opened` | `_shared/stripeDisputeHandlers.ts` `handleChargeDispute` (`charge.dispute.created`) | brand_owner, finance_manager |
| 6 | `business.dispute_action_needed` | same handler, when `status ∈ {needs_response, warning_needs_response}` | brand_owner, finance_manager |
| 7 | `business.payout_paid` | `_shared/stripeWebhookRouter.ts` `handlePayout` (`payout.paid` branch) | brand_owner, finance_manager |
| 8 | `business.account_status_changed` | `_shared/stripeWebhookRouter.ts` `syncAccount` (only on a real charges_enabled transition; branches restricted/reactivated) | brand_owner, finance_manager |
| 9 | `business.new_review` | DB trigger on `place_reviews` (migration below) → `pg_net` → notify-dispatch; only on `moderation_status='approved'` transition; brand resolved via `brands.place_pool_id` | brand_owner, brand_admin |
| 10 | `business.claim_decision` | `admin-review-venue-claim/index.ts` (approve + reject branches; single recipient = brand owner `account_id`) | brand_owner (owner) |
| 11 | `business.team_member_joined` | `accept-brand-invitation/index.ts` (after successful accept RPC; recipients EXCLUDE the just-joined member) | brand_owner, brand_admin |

All `business.*`/`stripe.*` pushes route to the business app automatically via notify-dispatch's prefix rule — no per-call `app` flag at the triggers. Every trigger is wrapped best-effort (try/catch + warn) so a notify failure never fails the underlying order/webhook/review/accept.

**Role-string note (IMPORTANT):** the parent + Sub-D specs name the owner role `account_owner`. In the SHIPPED schema (post `ORCH-1047` rename, migration `20260819000000`) that role is **`brand_owner`** — which is what the live `getBrandPaymentManagerUserIds`, the RLS policies, and the role-check constraint already use. I used `brand_owner` everywhere to match the live schema. No deviation from intent; only the literal string differs from the spec prose.

---

## 2. Migration

**Filename:** `supabase/migrations/20260910000000_meta_orch_1074_new_review_notify.sql`
**Prefix rationale:** strictly above the parent §3.A.6 LOCKED floor (≥`20260910000000`; max scanned across main + sibling worktrees was `20260907000000`–`20260908000000`).
**Contents:** `meta_orch_1074_notify_new_review()` SECURITY DEFINER trigger fn (search_path pinned) + `AFTER INSERT OR UPDATE OF moderation_status ON public.place_reviews` trigger. Self-gates on `moderation_status='approved'` + actual transition; resolves brand via `brands.place_pool_id`; reads vault `supabase_url`/`service_role_key`; `pg_net`-invokes notify-dispatch once per owner/admin recipient. Supabase docs (Database Functions, pg_net, Vault, linter) cited inline in the header. **No schema change** to `notifications` / `notification_preferences` (already business-ready).

**`experience_feedback` is intentionally NOT wired** (documented gap, Sub-D F2/F3): it has no brand link (`card_id` text only) and no moderation column, so there is no reliable brand to notify. v1 fires `new_review` for `place_reviews` only.

**Exact apply command for the orchestrator** (run AFTER REVIEW; implementor does NOT push):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]" && /Users/sethogieva/bin/supabase db push --linked
```
Before running, confirm no remote-only versions:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]" && /Users/sethogieva/bin/supabase migration list --linked
```
Runtime requirement: the trigger needs `pg_net` enabled + vault rows `supabase_url` + `service_role_key` (advisory NOTICEs emitted if absent — apply still succeeds, dispatch no-ops until configured). This is the same vault dependency as the existing ORCH-0815-B marketing-send cron.

---

## 3. Edge functions the orchestrator must deploy (after db push + REVIEW)

Every fn whose source OR a touched `_shared/` import changed. Deploy from MERGED main (not this worktree) per `[[ship-verify-merge-before-reap]]` / COMMS-0015:

```
supabase functions deploy notify-dispatch --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy ticket-checkout-confirm --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy admin-review-venue-claim --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy accept-brand-invitation --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv   # imports _shared/stripeWebhookRouter.ts + stripeDisputeHandlers.ts
```

Plus any OTHER deployed fn that imports the changed `_shared/` modules (`push-utils.ts`, `stripeEdgeAuth.ts`) — the orchestrator should grep deployed fns for these imports and redeploy them too so they pick up the new bundle. `notify-dispatch` is the most important (it owns the routing). Preserve each fn's existing `verify_jwt` (ticket-checkout-confirm=false, accept-brand-invitation=true — both unchanged).

**Required secrets (Q1):** `ONESIGNAL_BUSINESS_APP_ID` + `ONESIGNAL_BUSINESS_REST_API_KEY` (operator confirmed already set as Supabase secrets). Without them, business push logs "credentials not configured, skipping" and returns false (SC-A2) — in-app inbox rows still write.

---

## 4. Strict-grep gate (COMMS-0002)

Added `META_ORCH_1074_BACKEND_ALLOWLIST` (11 backend files incl. the migration, the new shared module, the 8 touched fns/modules, and the 2 regression tests) to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`, spread into `ALLOWLIST`, in the SAME commit as the backend change. **Gate run: exit 0, `OK [C7: no-new-backend-files]`.**

---

## 5. Regression tests

**Paths (ship in the same PR):**
- `supabase/functions/_shared/__tests__/meta_orch_1074_push_routing.test.ts` — routing layer (SC-A1/SC-A2).
- `supabase/functions/_shared/__tests__/meta_orch_1074_order_paid_payload.test.ts` — order_paid/sold_out/low_inventory payload + role-set.

**Passing run:**
```
meta_orch_1074_push_routing.test.ts        → ok | 4 passed | 0 failed
meta_orch_1074_order_paid_payload.test.ts  → ok | 3 passed | 0 failed
```
Asserts: `resolveOneSignalApp("business.order_paid")==="business"`; `sendPush(app:"business")` carries the BUSINESS `app_id` + business REST key; SC-A2 (missing business creds → returns false, zero fetch, no consumer leak); order_paid fans out to exactly owner+admin+finance (NOT scanner) with the exact §3.A.5 payload (type/brandId/data slots/relatedId/relatedType/deepLink/per-user idempotencyKey) and currency-aware `$15.00` (no GBP); sold_out → owner+admin only; low_inventory at ≤10%.

**Fails-on-revert verified @ `427032a70054be6d99d65e3f43b8a5c792ce83af`** (pre-commit base): forcing `sendPush` to ignore `payload.app` (always consumer) made the routing test report **2 passed | 2 failed** (SC-A1 + SC-A2 fail); restoring the fix → **4 passed | 0 failed**.

**Deno checks:** all 9 touched edge fns/modules + both test files `deno check` clean (output captured in session).

**Existing-test impact:** my `account_status_changed` addition is exercised by the existing `account.updated updates connect row…` test (its FakeDb has `charges_enabled:false` prior → my code detects a transition). Wrapping the notify best-effort keeps that test green (now 14 passed in `stripeWebhookRouter.test.ts` + dispute + adversarial suite, up from 12). No existing test file was modified (append-only respected).

---

## 6. Verification matrix (Sub-A success criteria)

| SC | Verdict | Evidence |
|----|---------|----------|
| SC-A1 (business push → business app_id) | PASS (test layer) · live = post-deploy | routing test asserts business `app_id`; live OneSignal-dashboard confirm is orchestrator/tester. |
| SC-A2 (no silent consumer fallback) | PASS | routing test: missing business creds → false, zero fetch. |
| SC-A3 (one row/recipient, idempotent) | PASS (design + payload test) | per-user idempotency keys + notify-dispatch's idempotency check; webhook/confirm double-fire collapses. Live replay = tester T-A-ADV. |
| SC-A4 (recipient role-set) | PASS | payload test asserts owner+admin+finance for order_paid; scanner excluded; per-type roles wired per §3.A.3. |
| SC-A5 (row type/brand_id/deep_link/data) | PASS | payload test asserts exact fields. |
| SC-A6 (strict-grep exit 0) | PASS | gate run exit 0. |
| SC-A7 (no consumer regression) | PASS | consumer push omits `app` → defaults consumer; routing test confirms consumer app_id. |

---

## 7. Discoveries for orchestrator

1. **Pre-existing stale test (NOT my change):** `supabase/functions/_shared/__tests__/stripeWebhookRouter_disputeAdversarial.test.ts` (`ORCH-0953 §8 adversarial — webhook router event-list contract`) asserts `charge.succeeded must NOT be in STRIPE_ROUTED_EVENT_TYPES`, but ORCH-1054 (`caf21ed5e`, partner splits) ADDED `charge.succeeded` to the list intentionally. The test was never updated. It fails on the pristine branch base, independent of Sub-A. Recommend a follow-up to update that assertion under `[TEST-MOD-APPROVED]` (or register a tiny fixup ORCH). I did not touch it (append-only).
2. **Role-string drift in the spec prose:** parent + Sub-D say `account_owner`; live schema is `brand_owner` (post-ORCH-1047). I used the live string. Future Sub-C/D copy work should align to `brand_owner`.
3. **`experience_feedback` reviews are unnotifiable** (no brand link, no moderation) — only `place_reviews` fires `new_review`. If experience reviews should notify, that needs a brand link + moderation column on `experience_feedback` (separate ORCH).
4. **Client `BUSINESS_NOTIFICATION_TEMPLATES` constant** (Sub-D shape, `mingla-business/src/constants/`) is Sub-C/D's deliverable, not built here (Sub-A is backend-only). The trigger payloads carry the LOCKED Sub-D copy strings inline.

---

## 8. Invariant check

- **I-PROPOSED-W** preserved — notify-dispatch writes the in-app row identically; business inbox prefix-filter untouched.
- **SC-A2 / I-BUSINESS-PUSH-APP-ROUTING (new, DRAFT)** — enforced in `push-utils.ts` (per-app skip, no fallback) + the routing test.
- **I-BUSINESS-NOTIFY-IDEMPOTENT (new, DRAFT)** — every trigger passes an idempotencyKey.
- Touched fns' `verify_jwt` settings preserved; no out-of-scope edits.
