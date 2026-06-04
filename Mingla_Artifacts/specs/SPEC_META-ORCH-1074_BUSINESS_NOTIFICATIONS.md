# SPEC — META-ORCH-1074 [Mingla Business notifications feature]

**Date:** 2026-06-04
**Mode:** SPEC (META spec, 4 sub-ORCHs)
**Owner:** mingla-forensics+claude
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]/` on branch `META-ORCH-1074-business-notifications`
**Inputs (read + built upon, not re-derived):**
- `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` (cross-app forensic map — the anchor)
- `Mingla_Artifacts/reports/TAXONOMY_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` (event catalog + locked v1 cut)

**Comms-ledger acks (this turn):** COMMS-0002 (ORCH-0863 strict-grep `no-new-backend-files` gate — backend allowlist required in-commit), COMMS-0003 (external-API integration ORCHs must cite provider docs URLs inline at SPEC). Both are folded into Sub-A as HARD requirements below.

---

## 0. Executive summary (layman first)

Mingla Business already has the OneSignal SDK installed and a notifications table, an inbox screen, and a settings screen — but **nothing actually notifies a brand owner today**, because (a) the backend only knows how to push to the *consumer* OneSignal app, not the separate *business* one, and (b) the 12 events a brand cares about (a ticket sold, a payout landed, a dispute opened, a review posted, a teammate joined…) have no trigger wired. This spec defines four independently-shippable sub-ORCHs that close that gap by **reusing every existing asset** (the `notifications` table, `notify-dispatch`, `useBusinessNotifications`, `BusinessNotificationsScreen`, `stripeNotificationTemplates`) and adding only the missing last mile. No parallel systems.

**The keystone:** Sub-A (backend dual-app routing + the 12 triggers). Until it lands, no push can physically reach a business device, so B and C can only deliver in-app/inbox value. Sub-D (copy + default-prefs matrix) feeds Sub-A's payloads and Sub-C's settings, so it should land first or concurrently with A.

---

## 1. Scope & non-goals

### 1.1 In scope (LOCKED — exactly these 12 v1 types, operator-confirmed)

`business.order_paid`, `business.event_sold_out`, `business.refund_processed`, `business.dispute_opened`, `business.dispute_action_needed`, `business.payout_paid`, `business.account_status_changed`, `business.new_review`, `business.claim_decision`, `business.low_inventory`, `business.new_follower`, `business.team_member_joined`.

Plus the existing `stripe.*` compliance types (kyc/payout-failed/deauth/bank/restricted/reactivation/refund) which already fire and already write `notifications` rows — they ride the same dual-app routing for free once Sub-A lands, and appear in the same business inbox.

### 1.2 Non-goals (explicit, do NOT add)

- **Tier-3 → v2:** digests (`engagement_digest`, `campaign_results`, `checkin_summary`, `waitlist_summary`), milestones (`audience_milestone`, `first_sale`), lifecycle nudges (`setup_nudge`, `event_starting`, `event_ended`, `listing_published`), Ari insights (`ari_insight`), security alerts (`security_alert`), installment/role-change/scanner-joined. Taxonomy report §D2/§D3 catalogs them; they are NOT built here.
- **Consumer app** (`app-mobile/`): reference only. The `business.%`/`stripe.%` rows are already excluded from the consumer feed (`app-mobile/src/hooks/useNotifications.ts:224-225`); do not change that.
- **Admin web** (`mingla-admin/`): no notification surface; exempt from I-PROPOSED-W by design.
- **Buyer/anon web checkout:** has its own email/SMS path (`ticket-confirmation-dispatch`); not touched.
- **No new notifications table, no new dispatcher, no new push helper file beyond the dual-app extension.** Reuse `public.notifications`, `notify-dispatch`, `_shared/push-utils.ts`, `_shared/stripeEdgeAuth.ts` `dispatchNotification`.

### 1.3 Assumptions (must hold; verify before IMPLEMENT)

- **A1 — Business OneSignal app exists + credentials provisionable.** Seth provisions `ONESIGNAL_BUSINESS_APP_ID` (UUID) + `ONESIGNAL_BUSINESS_REST_API_KEY` as Supabase Edge secrets. The business client already initializes against `EXPO_PUBLIC_ONESIGNAL_APP_ID` (`mingla-business/src/services/oneSignalService.ts:27`); the backend `ONESIGNAL_BUSINESS_APP_ID` MUST equal that same OneSignal application's App ID. **NEW dependency — operator action (see §7 Open Questions Q1).**
- **A2 — `brand_team_members` is the audience source of truth** with roles `account_owner | brand_admin | finance_manager | event_manager | scanner` (the resolver at `_shared/stripeEdgeAuth.ts:75-91` already filters `removed_at IS NULL AND accepted_at IS NOT NULL`).
- **A3 — `new_follower` has NO data source today.** No `brand_followers` table exists (confirmed: `marketing_messages` migration `20260602000003_orch_0815_marketing_hub_phase_a.sql:86` lists `brand_followers` only as a *future, unbuilt* audience kind). This is an **operator decision (§7 Q2)** — either define a follower relationship or descope `business.new_follower` from the v1 of Sub-A's triggers (its copy/pref row in Sub-D/C can still ship inert).

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behaviour demanded | Files | Parity |
|---|---------|----------|--------------------|-------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | Unchanged. `business.%`/`stripe.%` already excluded from consumer feed. | — | n/a |
| 2 | Consumer Android | NO | Unchanged (same exclusion). | — | n/a |
| 3 | Buyer/anon Web | NO | Unchanged — buyer email/SMS path is separate. | — | n/a |
| 4 | Business iOS (`mingla-business/` iOS) | YES | Receives push for 12 types (Sub-A+B); inbox bell + unread + cards (Sub-C); per-type prefs (Sub-C+D). | Sub-B + Sub-C file lists | Manual vs Android — separate SC per platform |
| 5 | Business Android | YES | Same as iOS, plus Android 13+ `POST_NOTIFICATIONS` runtime permission moment (Sub-B). | Sub-B + Sub-C | Manual — separate SC |
| 6 | Admin Web (`mingla-admin/`) | NO | No notification surface; I-PROPOSED-W exempts it. | — | n/a |
| 7 | Business Web preview (`mingla-business/` web export) | YES (inbox only) | Bell → inbox screen + unread + cards + prefs render and function. **No push** (OneSignal native-only; `oneSignalService.ts:36` Platform.OS guard). Web export must still build. | Sub-C only (Sub-B is Platform.OS-guarded no-op on web) | Manual — Web SC = inbox-only |

Backend (edge functions + 0–1 migration) is the substrate for surfaces 4/5/7; it has no user-visible surface of its own but its success criteria are in Sub-A.

---

## 3. Sub-ORCH A — Backend dual-app push routing + the 12 triggers (no UI) · THE KEYSTONE

**Goal:** route any `business.*`/`stripe.*` notification to the **business** OneSignal application (not consumer), and wire the 12 trigger call-sites. No client UI.

### 3.A.1 OneSignal REST API contract (COMMS-0003 — docs cited inline)

The existing `_shared/push-utils.ts` already speaks the correct OneSignal REST shape; Sub-A only parameterizes *which app* it targets. Confirmed contract (cite these URLs inline in the implementation file headers):

- **Endpoint + method:** `POST https://api.onesignal.com/notifications` — https://documentation.onesignal.com/reference/create-message
- **`app_id`** (required, UUID — identifies the OneSignal *application*; per-app 1:1 with its REST API Key) — https://documentation.onesignal.com/reference/create-message · https://documentation.onesignal.com/docs/keys-and-ids
- **Targeting by external_id:** `"include_aliases": { "external_id": [<supabase uuid>] }` **plus** `"target_channel": "push"` (required when using `include_aliases`). Alias label MUST be exactly `external_id` (not `externalId`). — https://documentation.onesignal.com/reference/create-message · https://documentation.onesignal.com/docs/aliases-external-id
- **Auth header:** `Authorization: Key <REST_API_KEY>` (current OneSignal "Key" scheme; legacy `Basic` still works but `Key` is canonical and is what `push-utils.ts:90` already sends). — https://documentation.onesignal.com/reference/create-message · https://documentation.onesignal.com/docs/rest-api-overview
- **Multi-app:** each OneSignal application has its own `app_id` + REST API Key pair. There is **no cross-app send**; to reach business devices you MUST send with the business app's `app_id` + business key. — https://documentation.onesignal.com/docs/keys-and-ids
- **Success contract:** HTTP 200 with non-empty `id`; 200-with-`errors` or empty `id` = not delivered (already handled at `push-utils.ts:130-145`). — https://documentation.onesignal.com/reference/create-message

The implementor MUST cite the relevant URL(s) inline at every new/changed OneSignal parameter or branch per COMMS-0003.

### 3.A.2 Routing decision — by type prefix

**Contract:** the OneSignal *app* is a pure function of the notification `type` prefix.

```
resolveOneSignalApp(type):
  type.startsWith("business.") || type.startsWith("stripe.")  → "business"
  else                                                         → "consumer"
```

**LOCKED implementation shape (`_shared/push-utils.ts`):**
- Read four env vars at module top: existing `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` (consumer) + new `ONESIGNAL_BUSINESS_APP_ID` / `ONESIGNAL_BUSINESS_REST_API_KEY`.
- `PushPayload` gains a field `app: "consumer" | "business"` (or `appType`). `sendPush` selects `{ appId, restKey }` from a small map keyed by `payload.app`, defaulting to `"consumer"` when absent (backward-compatible — every existing consumer call-site omits it and keeps working). `sendPushToMany` gains the same passthrough.
- If the *selected* app's credentials are missing → the existing "credentials not configured, skipping" warn + `return false` (per-app, not global). LOCKED: business-credential absence MUST NOT silently fall back to the consumer app (that is the exact keystone bug — a business push delivered to the consumer app reaches nobody).

**Routing resolution in `notify-dispatch` (`supabase/functions/notify-dispatch/index.ts`):** compute `app` from `type` (same prefix rule) and pass it into the `pushPayload` built at `:477`. LOCKED: the in-app row insert (`:301-340`), prefs/quiet-hours/rate-limit/idempotency logic is unchanged — only the push *delivery target* is parameterized. The `notifications` row is written identically regardless of app (the inbox is a shared table; the app prefix-filters at read time per I-PROPOSED-W).

### 3.A.3 Audience resolver (reuse, do NOT rebuild)

Reuse the existing pattern verbatim:
- `getBrandPaymentManagerUserIds(supabase, brandId)` (`_shared/stripeEdgeAuth.ts:75-91`) — returns deduped `user_id`s for roles `account_owner | brand_admin | finance_manager`, `removed_at IS NULL AND accepted_at IS NOT NULL`.
- `notifyBrandManagers(supabase, {...})` (`_shared/stripeWebhookRouter.ts:146-178`) — fans out one `dispatchNotification` per recipient with a per-user idempotency key suffix (`${idempotencyKey}:${userId}`).

**For the 12 types, recipient roles MUST be resolvable by role-set.** The existing resolver only knows the 3 payments roles. Sub-A MUST generalize it (or add a sibling) so a type can target a broader/different role set per the matrix below. **LOCKED:** add a role-parameterized resolver, e.g. `getBrandTeamUserIdsByRoles(supabase, brandId, roles: string[])` in `_shared/stripeEdgeAuth.ts`, and keep `getBrandPaymentManagerUserIds` as a thin wrapper (`roles = ["account_owner","brand_admin","finance_manager"]`) so no existing caller breaks. `notifyBrandManagers` gains an optional `roles` param (default = the 3 payments roles) so existing call-sites are byte-stable.

**Per-type recipient role-set (LOCKED — from Taxonomy §D + Sub-D matrix):**

| Type | Recipient roles |
|------|-----------------|
| `business.order_paid` | account_owner, brand_admin, finance_manager |
| `business.event_sold_out` | account_owner, brand_admin |
| `business.refund_processed` | account_owner, finance_manager |
| `business.dispute_opened` | account_owner, finance_manager |
| `business.dispute_action_needed` | account_owner, finance_manager |
| `business.payout_paid` | account_owner, finance_manager |
| `business.account_status_changed` | account_owner, finance_manager |
| `business.new_review` | account_owner, brand_admin |
| `business.claim_decision` | account_owner |
| `business.low_inventory` | account_owner, brand_admin |
| `business.new_follower` | account_owner, brand_admin |
| `business.team_member_joined` | account_owner, brand_admin |

### 3.A.4 Idempotency keys (LOCKED — one per type, replay-safe)

Every trigger MUST pass `idempotencyKey` so webhook replays + double-fires collapse (notify-dispatch enforces it at `:259-274`, and `notifyBrandManagers` suffixes `:${userId}`):

| Type | Idempotency key (before per-user suffix) |
|------|-------------------------------------------|
| `business.order_paid` | `business.order_paid:${orderId}` |
| `business.event_sold_out` | `business.event_sold_out:${eventId}` |
| `business.refund_processed` | `business.refund_processed:${refundId}` |
| `business.dispute_opened` | `business.dispute_opened:${disputeId}` |
| `business.dispute_action_needed` | `business.dispute_action_needed:${disputeId}:${status}` |
| `business.payout_paid` | `business.payout_paid:${payoutId}` |
| `business.account_status_changed` | `business.account_status_changed:${stripeAccountId}:${stateHash}` |
| `business.new_review` | `business.new_review:${reviewId}` |
| `business.claim_decision` | `business.claim_decision:${brandId}:${decision}` |
| `business.low_inventory` | `business.low_inventory:${eventId}:${thresholdBucket}` |
| `business.new_follower` | `business.new_follower:${brandId}:${followerId}` |
| `business.team_member_joined` | `business.team_member_joined:${brandId}:${memberUserId}` |

### 3.A.5 The 12 trigger call-sites (exact location + payload)

For every trigger, the dispatch payload feeds `notifyBrandManagers` (or `dispatchNotification` directly when single-recipient). `title`/`body`/`deepLink` come from **Sub-D's copy matrix** (§6). `type`, `brandId`, `data`, `relatedId`/`relatedType`, `idempotencyKey`, and recipient `roles` are LOCKED here. All `business.*` pushes route to the business app automatically via §3.A.2 (prefix rule) — no per-call `app` flag needed at the trigger.

1. **`business.order_paid`** — **Site:** order finalize path. The canonical finalize is the `biz_ticket_checkout_finalize*` RPC family (`supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`, installment-aware `20260610000002_*`, compare-and-correct `20260724000000_orch_0921_*`); it is invoked from BOTH `ticket-checkout-confirm/index.ts` (slow-path, `:27`) AND the `payment_intent.succeeded` webhook race-winner in `_shared/stripeWebhookRouter.ts`. **LOCKED:** to fire exactly once regardless of which side wins the race, the trigger MUST be **at the point the order row transitions to paid**, keyed on `orderId` idempotency. Recommended: emit from the edge layer immediately after the finalize RPC reports a *newly-created* order (not the idempotent re-read) — both `ticket-checkout-confirm` and the webhook finalize branch call the RPC and can check "did this call create the order vs return an existing one." **Implementor MUST locate the single newly-created-order signal** (the RPC's early-return-if-order-exists path at `ticket-checkout-confirm/index.ts:23-37` is the discriminator) and fire there. **Payload:** `{ type:"business.order_paid", brandId, data:{ orderId, eventId, eventTitle, totalCents, currency, qty }, relatedId:orderId, relatedType:"order", deepLink:"mingla-business://event/{eventId}", idempotencyKey:"business.order_paid:{orderId}", roles:[owner,admin,finance] }`.

2. **`business.event_sold_out`** — **Site:** SAME finalize path, immediately after the order commits, when remaining capacity reaches 0. **LOCKED:** the implementor MUST derive remaining capacity from the post-finalize event/ticket state (orders + tickets tables; the capacity math lives in the finalize RPC and the event's published capacity — `events`/`ticket_types`). Fire `event_sold_out` once per event (idempotency on `eventId`) the first time remaining hits 0. **Payload:** `{ type:"business.event_sold_out", brandId, data:{ eventId, eventTitle, capacity }, relatedId:eventId, relatedType:"event", deepLink:"mingla-business://event/{eventId}", idempotencyKey:"business.event_sold_out:{eventId}", roles:[owner,admin] }`.

3. **`business.low_inventory`** — **Site:** SAME finalize path. Fire once when remaining crosses a low threshold (default ≤10% of capacity, see §7 Q3 for threshold confirmation) and is >0. Idempotency on `eventId:thresholdBucket` so it fires at most once per threshold band. **Payload:** `{ type:"business.low_inventory", brandId, data:{ eventId, eventTitle, remaining, capacity, pct }, relatedId:eventId, relatedType:"event", deepLink:"mingla-business://event/{eventId}", idempotencyKey:"business.low_inventory:{eventId}:{bucket}", roles:[owner,admin] }`.

4. **`business.refund_processed`** — **Site:** `_shared/stripeWebhookRouter.ts` `handleRefundEvent` (`:551+`, reconciles into `public.refunds` via `biz_refund_order_commit_from_webhook`). After a refund row commits as succeeded, call `notifyBrandManagers`. **NOTE:** a `stripe.refund_processed` template already exists (`stripeNotificationTemplates.ts:155`); v1 uses the **`business.refund_processed`** type for the brand-facing push (the `stripe.refund_processed` template copy can be reused/adapted in Sub-D — do not create a duplicate dispatch). **Payload:** `{ type:"business.refund_processed", brandId, data:{ orderId, refundId, amountCents, currency }, relatedId:orderId, relatedType:"order", deepLink:"mingla-business://event/{eventId}" (or order deep-link when available), idempotencyKey:"business.refund_processed:{refundId}", roles:[owner,finance] }`.

5. **`business.dispute_opened`** — **Site:** `_shared/stripeDisputeHandlers.ts` `handleChargeDispute`, the `event.type === "charge.dispute.created"` branch (`:339`). Today it only emails the **operator** (`alertDisputeCreated` → `STRIPE_DISPUTE_ALERT_EMAILS`) — it does NOT notify the brand. `brandId` is already resolved (`:307`). Add a `notifyBrandManagers` call here. **Payload:** `{ type:"business.dispute_opened", brandId, data:{ disputeId, orderId, amount, currency, reason, evidenceDueBy }, relatedId:disputeId, relatedType:"dispute", deepLink:"mingla-business://payments", idempotencyKey:"business.dispute_opened:{disputeId}", roles:[owner,finance] }`.

6. **`business.dispute_action_needed`** — **Site:** SAME handler. Fire when evidence is due / the dispute needs action (`status === "needs_response"` on `charge.dispute.created`/`updated`, or when `evidence_due_by` is near). **LOCKED:** distinct from `dispute_opened` — opened = FYI; action_needed = "you must submit evidence." Idempotency on `disputeId:status`. **Payload:** `{ type:"business.dispute_action_needed", brandId, data:{ disputeId, orderId, amount, currency, evidenceDueBy }, relatedId:disputeId, relatedType:"dispute", deepLink:"mingla-business://payments", idempotencyKey:"business.dispute_action_needed:{disputeId}:{status}", roles:[owner,finance] }`.

7. **`business.payout_paid`** — **Site:** `_shared/stripeWebhookRouter.ts` `handlePayout`, the `event.type === "payout.paid"` branch (`:454`). Today it fires AppsFlyer `mingla_first_payout` but does NOT notify the brand (only `payout.failed` notifies, via `stripe.payout_failed` at `:423`). Add a `notifyBrandManagers` call in the `payout.paid` branch. **Payload:** `{ type:"business.payout_paid", brandId, data:{ payoutId, amountCents, currency, arrivalDate }, relatedId:payoutId, relatedType:"payout", deepLink:"mingla-business://payments", idempotencyKey:"business.payout_paid:{payoutId}", roles:[owner,finance] }`.

8. **`business.account_status_changed`** — **Site:** `_shared/stripeWebhookRouter.ts` `syncAccount` (`:180`, fires on `account.updated`). When `charges_enabled`/`payouts_enabled` transitions (restricted ↔ active), notify the brand. **LOCKED:** the `prior` snapshot (`:188-195`) gives before/after — fire only on an actual transition (not every `account.updated`). Distinguish restricted-now vs reactivated-now for copy via `data.status`. The existing `stripe.account_restricted`/`stripe.reactivation_complete` templates exist (`stripeNotificationTemplates.ts:131,143`) — v1 unifies under `business.account_status_changed` with a `status` discriminator in `data` (Sub-D copy branches on it). **Payload:** `{ type:"business.account_status_changed", brandId, data:{ stripeAccountId, status:"restricted"|"reactivated", chargesEnabled, payoutsEnabled }, relatedId:stripeAccountId, relatedType:"stripe_account", deepLink:"mingla-business://payments", idempotencyKey:"business.account_status_changed:{stripeAccountId}:{stateHash}", roles:[owner,finance] }`.

9. **`business.new_review`** — **Site:** DB trigger on `public.place_reviews` INSERT and `public.experience_feedback` INSERT (both tables exist: baseline `20260505000000_*:8972,8286`; `place_reviews` already has a fan-out trigger `fan_review_to_engagement` at baseline `:4666`). **LOCKED:** resolve the `brand_id` from the reviewed place/experience, then call `notify-dispatch`. **Two implementation options — implementor picks one and documents it:** (a) extend/add a DB trigger that `pg_net`-invokes `notify-dispatch` (mirrors existing trigger→edge patterns), or (b) a lightweight edge cron that polls new reviews. Option (a) is preferred (real-time, no poll). Idempotency on `reviewId`. **Payload:** `{ type:"business.new_review", brandId, data:{ reviewId, rating, placeOrExperienceId, kind:"place"|"experience" }, relatedId:reviewId, relatedType:"review", deepLink:"mingla-business://event/{relatedId}" (or listing/review surface — see Sub-D), idempotencyKey:"business.new_review:{reviewId}", roles:[owner,admin] }`. **NOTE:** respect `place_reviews.moderation_status` — only notify on `approved` (baseline `:8988`).

10. **`business.claim_decision`** — **Site:** `supabase/functions/admin-review-venue-claim/index.ts`, the approve branch (`:121`) and reject branch (`:147`). Today it sends an **email** to the brand (gated on `claim_decision_emailed_at IS NULL`, `:158-161`) but no push/in-app. Add a `dispatchNotification` (single recipient = brand owner) alongside the email. `brandId` (`brandRow.id`) + decision are in scope. **Payload:** `{ type:"business.claim_decision", userId:<ownerUserId>, brandId, data:{ decision:"approved"|"rejected", rejectionReason? }, relatedId:brandId, relatedType:"brand", deepLink:"mingla-business://brand/{brandId}/listing", idempotencyKey:"business.claim_decision:{brandId}:{decision}", roles:[owner] }`. Resolve `ownerUserId` via the existing brand-owner resolver (`resolveBrandOwnerUserId` is used in the webhook router; reuse the equivalent).

11. **`business.new_follower`** — **Site:** UNDEFINED — no follower relationship exists (Assumption A3). **LOCKED conditional:** if Seth confirms a follower model (§7 Q2), the trigger is a DB trigger on the new follow table INSERT resolving `brand_id` + `followerId`. If Seth descopes, this trigger is NOT built in Sub-A (its copy + pref row still ship inert in C/D, and the type is reserved). **Payload (when built):** `{ type:"business.new_follower", brandId, data:{ followerId, followerName? }, relatedId:followerId, relatedType:"follower", deepLink:"mingla-business://(tabs)/marketing" (audience), idempotencyKey:"business.new_follower:{brandId}:{followerId}", roles:[owner,admin] }`.

12. **`business.team_member_joined`** — **Site:** `supabase/functions/accept-brand-invitation/index.ts` (exists in this worktree; lands on main via ORCH-1050 PR #318 `1164476e2`). On successful acceptance (after `brand_team_members.accepted_at` is set + optional ownership transfer), notify the **existing** owner/admins that a teammate joined. **LOCKED:** recipients are the brand's owner/admins EXCLUDING the just-joined member. **Payload:** `{ type:"business.team_member_joined", brandId, data:{ memberUserId, memberRole, memberName? }, relatedId:memberUserId, relatedType:"team_member", deepLink:"mingla-business://brand/{brandId}/team", idempotencyKey:"business.team_member_joined:{brandId}:{memberUserId}", roles:[owner,admin] }`.

### 3.A.6 Migration (if any) — Supabase docs cited inline

If trigger 9 (and conditionally 11) uses a DB trigger that invokes `notify-dispatch`, a migration is required. **LOCKED guards:**
- **Prefix:** highest migration prefix anywhere (main + all sibling worktrees, scanned 2026-06-04) is `20260908000000`. Use **`20260910000000`+** to avoid collision. Re-scan `~/Desktop/mingla-orchs/*/supabase/migrations/` + main at IMPLEMENT time and pick a prefix strictly above the max.
- Cite Supabase docs inline in the migration header for every object introduced: Database Functions / triggers (https://supabase.com/docs/guides/database/functions), `pg_net` for edge invocation (https://supabase.com/docs/guides/database/extensions/pg_net), RLS if any new table (https://supabase.com/docs/guides/auth/row-level-security), SECURITY DEFINER + `search_path` lint (https://supabase.com/docs/guides/database/database-linter).
- The `notifications` table + `notification_preferences` already exist and are business-ready (`brand_id` + `deep_link` columns present per `20260511000003_b2a_v3_notifications.sql`) — **no schema change to them.**

### 3.A.7 Strict-grep allowlist (COMMS-0002 — IN THE SAME COMMIT)

The ORCH-0863 gate's `C7: no-new-backend-files` check (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:237`) fails any PR that adds files under `supabase/functions/` or `supabase/migrations/` unless they are in a per-ORCH allowlist array. **LOCKED:** Sub-A MUST add a `META_ORCH_1074_BACKEND_ALLOWLIST` array listing every new/changed backend file (the migration, any new `_shared` helper, the changed `push-utils.ts` / `notify-dispatch` / `stripeWebhookRouter.ts` / `stripeDisputeHandlers.ts` / `stripeEdgeAuth.ts` / `admin-review-venue-claim` / `accept-brand-invitation` if they count as "new" under the gate's logic) **in the same commit as the backend change**. Run the full gate locally (`node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) and confirm exit 0 before pushing. Model on the existing `ORCH_1064_BACKEND_ALLOWLIST` / `ORCH_1066_BACKEND_ALLOWLIST` precedent (COMMS-0002 ack history).

### 3.A.8 Sub-A success criteria (machine-checkable)

- **SC-A1** — With `ONESIGNAL_BUSINESS_APP_ID` + `ONESIGNAL_BUSINESS_REST_API_KEY` set, a dispatched `business.*` push hits OneSignal with `app_id === ONESIGNAL_BUSINESS_APP_ID` (verifiable: edge log line shows the business app_id; OneSignal dashboard shows the message under the business app). A consumer-type push still uses the consumer app_id.
- **SC-A2** — Business credentials absent → business push logs "credentials not configured, skipping" and returns false; it NEVER sends to the consumer app_id (no silent cross-app fallback).
- **SC-A3** — Each of the 12 triggers (11 if `new_follower` descoped) writes exactly ONE `notifications` row per recipient per event (idempotency holds across webhook replay — fire the same Stripe event twice → still one row per recipient).
- **SC-A4** — Recipient set for each type matches §3.A.3 (query `brand_team_members` by role and assert the dispatched `user_id`s equal the expected role-set).
- **SC-A5** — Each `notifications` row has correct `type` (prefix `business.`/`stripe.`), `brand_id`, `deep_link`, and `data` per §3.A.5.
- **SC-A6** — ORCH-0863 strict-grep gate passes (exit 0) with the `META_ORCH_1074_BACKEND_ALLOWLIST` in the same commit.
- **SC-A7** — No consumer-side regression: existing consumer pushes still route to the consumer app (run/inspect any consumer dispatch).

**Regression test (implementor, happy path):** `T-A-01` deploy with business creds set → buy a ticket on a test event via `ticket-checkout-confirm` → assert one `business.order_paid` row per owner/admin/finance member with correct payload + push log shows business app_id.

**Adversarial angle (tester):** `T-A-ADV` replay the same `payout.paid` Stripe webhook 3× and a `charge.dispute.created` 3× → assert exactly one `business.payout_paid` and one `business.dispute_opened` row per recipient (idempotency); flip business creds to empty and confirm zero consumer-app leakage; assert a consumer user who is ALSO a brand member does not see `business.*` in their consumer feed (I-PROPOSED-W still holds).

---

## 4. Sub-ORCH B — Business client receive path

**Goal:** mirror the consumer receive path so the business app opts into push, displays foreground banners, and deep-links each of the 12 types to the right business screen. **Reference (port, don't reinvent):** `app-mobile/src/services/oneSignalService.ts` + `app-mobile/app/index.tsx:408-673`.

### 4.B.1 Push opt-in (the deferred `optIn()`)

`mingla-business/src/services/oneSignalService.ts:82-90` `loginToOneSignal` deliberately does NOT call `optIn()` (header comment `:9-22`). **LOCKED:** add `optIn()` per the consumer ORCH-0407 pattern (`app-mobile/src/services/oneSignalService.ts:77-90` — `await OneSignal.login(userId); await OneSignal.User.pushSubscription.optIn();`). Cite https://documentation.onesignal.com/docs/aliases-external-id (external_id binding) + https://documentation.onesignal.com/docs/permission-requests (opt-in vs OS permission distinction). Keep the Platform.OS/`_enabled` guards (web no-op). `optIn()` = "register this device for delivery" (server-side); it is separate from the OS permission dialog (below).

### 4.B.2 OS permission moment (Android 13+ + iOS)

**LOCKED:** add `requestPushPermission()` to `oneSignalService.ts` mirroring consumer `:102-116` (`OneSignal.Notifications.requestPermission(true)`). **Trigger point (UX):** the business app has no coach-mark tour like consumer. The permission prompt MUST fire at a **moment of demonstrated value**, NOT app boot. **LOCKED trigger:** first time the user lands on Hub/Home with an existing brand AND at least one published listing OR first successful Stripe-connect — i.e. when "you have something worth being notified about." **OPEN (implementor craft):** the exact host screen + an optional lightweight pre-permission rationale sheet ("Get notified when tickets sell, payouts land, or a dispute opens — [Turn on] / [Not now]") before the OS dialog, to protect the one-shot iOS prompt. If a rationale sheet is added it needs a DESIGN pass (flag to mingla-designer). Do NOT prompt on boot or on the account/settings screen alone.

### 4.B.3 Foreground display + click handlers

**LOCKED:** add `onForegroundNotification` + `onNotificationClicked` to `oneSignalService.ts` byte-mirroring consumer `:181-241` (SDK v5 `foregroundWillDisplay` requires explicit `display()`; `click` listener for taps). Register both in `mingla-business/app/_layout.tsx` inside `RootLayoutInner`, in a `useEffect` that returns the cleanup (mirror consumer `app/index.tsx:651-672`). Register AFTER `initializeOneSignal()` (currently `_layout.tsx:186`). **LOCKED:** foreground handler calls `display()` for all 12 types (show the banner — consumer chose "app feels alive" at `app/index.tsx:660-667`). Web export: these are Platform.OS-guarded no-ops (the service already guards via `_enabled`).

### 4.B.4 Business `NAV_TARGETS` + `processNotification`

**LOCKED:** port a business `processNotification(data, navigationTarget?)` + `NAV_TARGETS` map (mirror consumer `app/index.tsx:413-486,589-633`). On tap: mark the `notifications` row read + `push_clicked` (fire-and-forget UPDATE), Mixpanel-track, then navigate via `data.deepLink` (parse `mingla-business://…`) with `NAV_TARGETS[type]` as fallback. Stash the deep link if unauthenticated (mirror consumer `:417-425`). Business deep-links resolve to expo-router routes (the app uses expo-router, not the consumer's custom nav):

| Type | `data.deepLink` | NAV_TARGETS fallback (route) |
|------|-----------------|------------------------------|
| order_paid | `mingla-business://event/{eventId}` | `/event/[id]` |
| event_sold_out | `mingla-business://event/{eventId}` | `/event/[id]` |
| low_inventory | `mingla-business://event/{eventId}` | `/event/[id]` |
| refund_processed | `mingla-business://event/{eventId}` (or order) | `/event/[id]` |
| dispute_opened | `mingla-business://payments` | BrandPaymentsView route |
| dispute_action_needed | `mingla-business://payments` | BrandPaymentsView route |
| payout_paid | `mingla-business://payments` | BrandPaymentsView route |
| account_status_changed | `mingla-business://payments` | BrandPaymentsView route |
| new_review | `mingla-business://event/{id}` (or listing/review) | `/event/[id]` or `/brand/[id]/listing` |
| claim_decision | `mingla-business://brand/{brandId}/listing` | `/brand/[id]/listing` |
| new_follower | `mingla-business://(tabs)/marketing` | `/(tabs)/marketing` |
| team_member_joined | `mingla-business://brand/{brandId}/team` | `/brand/[id]/team` |

**LOCKED:** every one of the 12 types MUST have a `NAV_TARGETS` entry (consumer rule: tapping a push always lands somewhere). The `stripe.*` types already in the inbox should also map (payments). **OPEN:** deep-link routing helper structure (a `parseBusinessDeepLink` util vs inline switch) is implementor's choice as long as it covers all 12 + the `stripe.*` set.

### 4.B.5 Sub-B success criteria

- **SC-B1-iOS / SC-B1-Android** — After login + permission grant, the device is opted-in (OneSignal dashboard shows the business external_id as a subscribed user on the business app); a test push displays a banner.
- **SC-B2** — Permission prompt fires at the value moment (§4.B.2), NOT on boot (verify: cold-boot to account screen → no prompt; reach the value moment → prompt).
- **SC-B3** — Foreground push shows a banner (display() called) on iOS + Android.
- **SC-B4** — Tapping each of the 12 push types navigates to the mapped business screen; the underlying `notifications` row is marked `is_read=true` + `push_clicked=true`.
- **SC-B5-Web** — Web export builds and runs with the OneSignal service as a guarded no-op (no crash, no push).
- **SC-B6** — Logout calls `OneSignal.logout()` (already wired `:99-107`) — confirm no business pushes after sign-out (Constitution #6).

**Regression test (implementor):** `T-B-01` send a `business.order_paid` test push to a logged-in business device → banner shows foregrounded → tap → lands on `/event/[id]` → row marked read.
**Adversarial angle (tester):** `T-B-ADV` deny the OS permission → app does not crash, inbox (Sub-C) still works, no repeated prompt-spam on every launch; tap a push while logged out → deep link is stashed and replayed after login, not dropped.

---

## 5. Sub-ORCH C — Business inbox finish

**Goal:** wire the bell → inbox, derive unread + mark-read, raise cards to consumer-grade, add per-type pref rows. **Reference:** `app-mobile/src/components/NotificationsSheet.tsx` + `useNotifications.ts`.

### 5.C.1 Bell wiring (TopBar)

`mingla-business/src/components/ui/TopBar.tsx:119-133` renders the bell with a `badge={unreadCount}` slot but `onPress` is unwired (`[TRANSITIONAL]` comment `:123-124`). **LOCKED:** wire the bell `onPress` to route to `BusinessNotificationsScreen`. The app uses expo-router → add a route (e.g. `app/notifications.tsx`) that mounts `BusinessNotificationsScreen`, and the bell `router.push("/notifications")`. **LOCKED:** preserve I-37 (brand-left TopBar consumers MUST NOT pass `rightSlot=`; the default cluster owns the bell) — wire `onPress` inside `DefaultRightSlotInner`/`IconChrome`, do not refactor consumers to pass `rightSlot`. **`unreadCount`** is passed by each screen that renders `<TopBar>`; source it from the hook (§5.C.2). **OPEN:** whether the inbox is a full route vs a bottom-sheet (consumer uses a gorhom sheet `NotificationsSheet`; business may prefer a route for web-preview parity) — implementor/designer choice; both satisfy SC.

### 5.C.2 `useBusinessNotifications` — add unread + mark-read

`mingla-business/src/hooks/useBusinessNotifications.ts` currently READ-ONLY (query + Realtime invalidate). **LOCKED additions (mirror consumer `useNotifications.ts`):**
- **Unread derivation:** `unreadCount = data.filter(n => n.read_at === null).length` (the hook already selects `read_at`). Expose it (either widen the return or add a sibling selector hook). **LOCKED:** do NOT remove the `.or("type.like.stripe.%,type.like.business.%")` clause (`:114`) — I-PROPOSED-W strict-grep gate (`i-proposed-w-notifications-app-type-prefix.mjs`) fails CI if the business-side inclusion filter is removed.
- **`markAsRead(id)`** — optimistic cache update (`read_at = now()`) + `supabase.from("notifications").update({ read_at }).eq("id", id)`. Mirror consumer `:349-382` (optimistic + invalidate-on-error). The strict-grep gate exempts `.update(`/`.delete(` chains (gate `MODIFY_OP_REGEX`), so the mutation does not need the prefix filter — but it MUST target by `id`.
- **`markAllAsRead()`** — optimistic + `update({read_at}).eq("user_id",userId).is("read_at",null).or("type.like.stripe.%,type.like.business.%")` (scope the bulk update to business types so it never marks a consumer row read). Cite Supabase PostgREST update docs inline: https://supabase.com/docs/reference/javascript/update.
- **Realtime:** extend the existing channel (`:60-93`) to also handle UPDATE (so a read elsewhere reflects) — mirror consumer `:304-319`. Keep the unique-channel-name-per-mount pattern (`:65`).
- **Badge:** on markAllAsRead / unread→0, call the business OneSignal `clearNotificationBadge` equivalent (add it to business `oneSignalService.ts` mirroring consumer `:149-156`) so the iOS app-icon badge resets.

### 5.C.3 Card design pass (consumer-grade) — DESIGN PASS REQUIRED

`BusinessNotificationsScreen.tsx` today renders a flat list (title/body/timestamp/unread-dot). Consumer `NotificationsSheet.tsx` (1235 lines) has: per-type avatar/icon, category grouping (Today/Yesterday/This Week/Earlier), unread amber ring, relative time, loading skeleton, empty/error/offline states. **LOCKED functional bar (the SPEC owns this):**
- Per-type **icon** (money/trust/growth/team families — map the 12 types to icons; reuse `stripeNotificationTemplates.ts` `severity` for emphasis where sensible).
- Title (1 line, actor/amount bolded where applicable), body (2 lines), relative time, unread dot/ring.
- **All 9 states with Mingla-business voice copy:** loading (skeleton, not just spinner), error ("Couldn't load your notifications. Pull down to try again." — already present `:77-79`), empty ("You're all caught up" — already present `:104`), populated, first-time (empty variant), returning, offline, degraded (some rows failed), submitting (n/a — read-only inbox; mark-read is optimistic).
- Category grouping by recency (mirror consumer buckets).
- Tap → mark read (actionable) / navigate via `onOpenDeepLink` (already wired `:56-63`) → the Sub-B `processNotification` deep-link.

**LOCKED:** use business design tokens (`src/constants/designSystem`) — the screen already imports them. No AI slop (no generic gradients, stock/AI imagery, emoji icons, decorative effects) per `mingla-designer/references/premium-craft.md`.

**🎨 DESIGN PASS:** the granular visual contract (exact tokens per state light+dark, computed contrast ratios, spacing on the 4px grid, safe-area/edge rules, page width, motion/haptics, icon set per type, "References examined" line) is produced by **mingla-designer** before IMPLEMENT. The SPEC REQUIRES that design contract to exist (`DESIGN_META-ORCH-1074_BUSINESS_INBOX.md`) and the implementor builds to it. Do NOT ship the inbox visuals undefined.

### 5.C.4 Per-type preference rows under the existing 4-category settings

`app/account/notifications.tsx` has 4 master toggles (Order activity / Scanner activity / Brand team / Marketing) persisting to `notificationPrefsStore` (Zustand) + (marketing only) `creator_accounts.marketing_opt_in`. **LOCKED:** add per-type rows UNDER the relevant master category, grouped:
- **Order activity** → order_paid, event_sold_out, low_inventory, refund_processed.
- **Payments & trust** (new group or under Order) → dispute_opened, dispute_action_needed, payout_paid, account_status_changed.
- **Audience & content** → new_review, new_follower.
- **Brand team** → team_member_joined, claim_decision.

**LOCKED:** the master category toggle gates its children (master OFF → children disabled). Per-type prefs MUST persist to `notification_preferences` (the table `notify-dispatch` reads at `:381-414`, channel × type × opt_in) so the backend actually honors them — NOT only Zustand. **LOCKED default matrix** comes from Sub-D §6.3. **OPEN:** the exact row layout/disclosure (expand-master-to-reveal-children vs always-visible) is designer's call.

### 5.C.5 Sub-C success criteria

- **SC-C1** — Tapping the TopBar bell opens the inbox on iOS + Android + Web preview.
- **SC-C2** — Bell badge shows the correct unread count (matches `read_at IS NULL` business-type rows); decrements on mark-read; reaches 0 + clears iOS badge on mark-all-read.
- **SC-C3** — A new `business.*`/`stripe.*` row appears in the inbox in real-time (Realtime INSERT) with a haptic; an UPDATE (read elsewhere) reflects.
- **SC-C4** — All 9 states render correctly with Mingla-business voice copy (per the DESIGN contract).
- **SC-C5** — Per-type pref rows persist to `notification_preferences`; toggling a type OFF then dispatching that type → `notify-dispatch` returns `reason:"user_disabled"` and no push sent (in-app row may still write per existing behavior).
- **SC-C6** — I-PROPOSED-W gate passes (the `.or()` clause intact); the inbox shows ONLY `business.%`/`stripe.%` rows, never consumer rows.
- **SC-C7-Web** — Web preview: inbox renders + mark-read works (no push). Web export builds.

**Regression test (implementor):** `T-C-01` insert a `business.order_paid` row → it appears in the inbox + bell badge=1 → tap → navigates + badge=0 + row `read_at` set.
**Adversarial angle (tester):** `T-C-ADV` attempt to make the inbox query return a consumer row (insert a `friend_request_received` row for the same user) → it must NOT appear in the business inbox; remove the `.or()` clause locally → strict-grep MUST fail. Toggle a type OFF → confirm backend `notification_preferences` row written + `notify-dispatch` honors it.

---

## 6. Sub-ORCH D — Copy + default-prefs matrix

**Goal:** the title/body copy (Mingla business voice), deep-link target, and default opt-in for all 12 types. Feeds Sub-A payloads + Sub-C settings. **May route through `mingla-product` for voice** (flag at dispatch).

### 6.1 Copy contract (LOCKED shape; voice OPEN to mingla-product refinement)

Reuse the `NotificationTemplate` shape from `mingla-business/src/constants/stripeNotificationTemplates.ts` (pushTitle ≤30 chars, pushBody ≤120 chars, inAppTitle, inAppBody, severity). **LOCKED:** add a `BUSINESS_NOTIFICATION_TEMPLATES` record (same file or a sibling `businessNotificationTemplates.ts`) for the 12 `business.*` types with `{var}` interpolation (mirror the existing `{brandName}`/`{amount}` pattern). Severity: money/trust = `blocking`/`warning`; growth/team = `info`. Draft copy (mingla-product polishes voice; signature voice = direct, warm, operator-respecting):

| Type | pushTitle | pushBody | deepLink |
|------|-----------|----------|----------|
| order_paid | New sale | {eventTitle}: {amount} just came in. | event/{eventId} |
| event_sold_out | Sold out | {eventTitle} is sold out — nice work. | event/{eventId} |
| low_inventory | Almost gone | {eventTitle}: only {remaining} left. | event/{eventId} |
| refund_processed | Refund processed | {amount} refunded for {eventTitle}. | event/{eventId} |
| dispute_opened | Dispute opened | A {amount} charge is disputed. Review it. | payments |
| dispute_action_needed | Evidence due | Submit evidence by {evidenceDueBy} to contest. | payments |
| payout_paid | You got paid | {amount} is on its way to your bank. | payments |
| account_status_changed | Account update | {brandName}: payments {status}. Tap for details. | payments |
| new_review | New review | {rating}★ review just came in. | event/{id} |
| claim_decision | Claim {decision} | {brandName} was {decision}. Tap to see next steps. | brand/{brandId}/listing |
| new_follower | New follower | Someone just followed {brandName}. | (tabs)/marketing |
| team_member_joined | Teammate joined | {memberName} joined {brandName} as {role}. | brand/{brandId}/team |

(`inAppTitle`/`inAppBody`/`emailSubject`/`emailBody` parallel these; mingla-product authors the full long-form set. `account_status_changed` copy branches on `data.status` ∈ {restricted, reactivated}.)

### 6.2 Deep-link target per type — see §4.B.4 table (canonical). Sub-D restates the human-facing targets; Sub-A consumes the `mingla-business://` URIs.

### 6.3 Default opt-in matrix (LOCKED)

Channels: **push** + **in_app** (the `notifications` row always writes; in_app = "show in inbox"; push = OneSignal delivery). Defaults written to `notification_preferences` defaults / honored by Sub-C settings:

| Type | push default | in_app default | Master category |
|------|-------------|----------------|-----------------|
| order_paid | ON | ON | Order activity |
| event_sold_out | ON | ON | Order activity |
| low_inventory | ON | ON | Order activity |
| refund_processed | ON | ON | Payments & trust |
| dispute_opened | ON | ON | Payments & trust |
| dispute_action_needed | ON | ON | Payments & trust |
| payout_paid | ON | ON | Payments & trust |
| account_status_changed | ON | ON | Payments & trust |
| new_review | ON | ON | Audience & content |
| new_follower | OFF (push) | ON | Audience & content |
| claim_decision | ON | ON | Brand team |
| team_member_joined | OFF (push) | ON | Brand team |

**Rule:** money/trust = push+in-app default ON (a brand cannot afford to miss these). Growth/team = in-app default ON, push OPTIONAL (default OFF for `new_follower`, `team_member_joined`) to prevent alert fatigue — user can opt in via Sub-C. The existing 4 master toggles default: Order activity ON, Scanner ON, Brand team ON, Marketing OFF (`notificationPrefsStore.ts:48-53`) — preserve.

### 6.4 Sub-D success criteria

- **SC-D1** — `BUSINESS_NOTIFICATION_TEMPLATES` covers all 12 types with non-empty push/in-app/email copy; `{var}` interpolation falls back to a sensible literal (mirror `stripeNotificationTemplates` header rule) — no raw `{var}` ever shown.
- **SC-D2** — Every type's deep-link matches §4.B.4 exactly.
- **SC-D3** — The default matrix (§6.3) is encoded where Sub-C reads defaults; a fresh user sees money/trust push ON and growth/team push OFF.
- **SC-D4** — Copy passes Mingla business voice review (mingla-product sign-off): no dating-app framing, no AI slop, ≤30/≤120 char push limits respected.

**Regression test (implementor):** `T-D-01` render each template with sample vars → assert no `{...}` leakage + char limits.
**Adversarial angle (tester):** `T-D-ADV` render with MISSING vars → fallback literal shows, not `{amount}`; assert `account_status_changed` branches correctly on both `restricted` and `reactivated`.

---

## 7. Open questions (operator decision required)

- **Q1 — Business OneSignal credentials (BLOCKING for Sub-A delivery).** Provide `ONESIGNAL_BUSINESS_APP_ID` (the SAME OneSignal application the business client registers against via `EXPO_PUBLIC_ONESIGNAL_APP_ID`) + `ONESIGNAL_BUSINESS_REST_API_KEY` as Supabase Edge secrets. Without these, Sub-A's routing lands but no push physically delivers (in-app inbox still works). Confirm the business app exists in the OneSignal org and share the App ID.
- **Q2 — `new_follower` data source (BLOCKING for trigger 12 only).** No `brand_followers` table exists. **Options:** (a) define a brand-follow relationship now (new table + the consumer-app follow action — larger scope, likely its own ORCH), or (b) **descope `business.new_follower`'s trigger from Sub-A v1** (keep the type reserved + its copy/pref row inert in C/D), shipping 11 live triggers. **Recommendation: (b)** — keep v1 shippable; follower model is a separate product decision. Confirm.
- **Q3 — Low-inventory threshold.** Default ≤10% remaining (Taxonomy §D1). Confirm the % or an absolute count, and whether it fires once per band or once per event.
- **Q4 — Inbox surface shape (non-blocking).** Route vs bottom-sheet for the business inbox (affects web-preview parity). Recommendation: route (cleaner web parity). Designer decides; not a blocker.

---

## 8. Invariants

**Preserve:**
- **I-PROPOSED-W** (notifications app-type-prefix) — business reads keep `.or('type.like.stripe.%,type.like.business.%')`; consumer reads keep the dual `.not(...)`. Strict-grep `i-proposed-w-notifications-app-type-prefix.mjs` enforces. Sub-C MUST NOT remove it.
- **I-37** (TopBar `leftKind="brand"` consumers MUST NOT pass `rightSlot=`) — Sub-C wires the bell inside the default cluster, not via `rightSlot`.
- **Constitution #6** (logout clears everything) — business `OneSignal.logout()` already wired; keep.
- **COMMS-0002** — backend allowlist in-commit (Sub-A).
- **COMMS-0003** — provider docs URLs inline at SPEC + IMPLEMENT (Sub-A + Sub-B OneSignal calls + any migration).

**New (DRAFT → ACTIVE on close):**
- **I-BUSINESS-PUSH-APP-ROUTING** — any `business.*`/`stripe.*` push MUST target the business OneSignal app_id; never the consumer app_id. (Candidate strict-grep: `push-utils` must select app by type prefix; no business type may hardcode the consumer app_id.)
- **I-BUSINESS-NOTIFY-IDEMPOTENT** — every business trigger passes an `idempotencyKey`; webhook replay yields one row per recipient.

---

## 9. Implementation order (keystone-first)

1. **Sub-D** (copy + default matrix) — pure data; unblocks A's payloads + C's settings. Route voice through mingla-product.
2. **Sub-A** (backend dual-app routing + 11–12 triggers) — THE KEYSTONE. Requires Q1 creds for live delivery; can land + be tested at the row/idempotency layer before creds arrive. Backend allowlist + docs URLs in-commit.
3. **Sub-B** (client receive path) — depends on A delivering real pushes for full E2E; can build + unit-test against A's payload contract first.
4. **Sub-C** (inbox finish) — independent of push; needs a **mingla-designer DESIGN pass** before IMPLEMENT. Can ship in parallel with B (inbox value is real even before push lands).

**Dependency summary:** D → A → B (push E2E); D → C (settings). A and C are independently mergeable; B's full E2E gates on A + Q1.

---

## 10. Regression prevention

- The new `I-BUSINESS-PUSH-APP-ROUTING` strict-grep candidate prevents a future edit from sending a business type to the consumer app.
- Idempotency keys (§3.A.4) prevent duplicate-notification recurrence under webhook replay (the exact class that bites Stripe webhook handlers).
- The `META_ORCH_1074_BACKEND_ALLOWLIST` + protective header comments on `push-utils.ts` ("business types MUST select the business app; no consumer fallback") encode the keystone rule at the call-site.
- Sub-C keeps the I-PROPOSED-W filter; the existing gate prevents its removal.
