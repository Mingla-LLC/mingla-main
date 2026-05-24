# INVESTIGATION - ORCH-0948 Waitlist Feature

**Date:** 2026-05-24  
**Mode:** INVESTIGATE only  
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0948-[waitlist-feature]/`  
**Branch:** `ORCH-0948-waitlist-feature`  
**Scope:** buyer-anonymous web, business iOS/Android/web preview, Supabase schema/RPC/edge notification path. Out of scope: `app-mobile/`, `mingla-admin/`.

## Executive Summary

The intake is directionally right but factually incomplete: `public.waitlist_entries` already exists in the baseline schema, so ORCH-0948 is not a blank-table build. The table has core persistence fields, FKs, indexes, RLS enabled, grants, and a brand-team SELECT policy, but there is no anon-safe signup path, no edge function, no planner-facing waitlist surface, no queue drain, and no notification enqueue when capacity opens.

The root cause is **missing product implementation on top of partial backend substrate plus latent backend contract defects**. The existing table should be reused as the canonical waitlist table name, not replaced with a parallel `waitlist_signups` table, but the SPEC must reconcile its current contract before implementation.

## Five-Truth-Layer Summary

| Truth layer | Evidence | State |
|---|---|---|
| Docs / artifacts | `Mingla_Artifacts/specs/SPEC_BUSINESS_USER_JOURNEYS.md:327-329` promises email+phone signup and FIFO invite when a refund frees inventory. `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-6-PUBLIC-EVENT-PAGE.md:43-45` explicitly deferred real waitlist invites to B5. | Intended feature exists, but earlier cycles intentionally shipped only a stub/toggle. |
| Schema | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:10126-10144` creates `waitlist_entries`; `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14194-14196` adds brand-team SELECT; `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:16131` enables RLS; `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:18574-18576` grants table privileges. | Partial persistence exists. No `waitlist_signups`, `waitlist_offers`, or waitlist notification table found by migration/function grep. |
| Code | `mingla-business/src/components/event/PublicEventPage.tsx:203-210` wires `onJoinWaitlist` to a toast; `packages/event-rendering/PublicEventPage.tsx:469-492` labels sold-out waitlist tickets as "Join waitlist." | Public event page has a dead-end stub, not signup. Checkout pages do not expose waitlist signup. |
| Runtime / test evidence | Static verification: `rg "waitlist|Waitlist|waitlistEnabled|waitlist_enabled" mingla-business/src mingla-business/app supabase/functions` found business toggle/plumbing and no waitlist edge function. `rg "waitlist_entries|waitlist_signups|waitlist_offers" supabase/migrations supabase/functions` found only `waitlist_entries`. | No repo-running waitlist signup or drain test exists today; no live Supabase mutation was run. |
| Persisted-data assumptions | `ticket_types.quantity_total` is constrained to NULL or positive at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9834-9837`; buyer services map it to `capacity` at `mingla-business/src/services/publicEventsService.ts:421-435`. | Buyer UI receives total capacity, not remaining capacity. Real sold-out tiers do not naturally become `capacity === 0`. |

## Q1 - Schema Reality

**Classification:** confirmed backend substrate + latent backend defects.

| Required field | Evidence |
|---|---|
| File:line | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:10126-10144`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:11098-11099`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:12415-12419`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:13994-14000`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14194-14196`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:16131`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:18574-18576` |
| What code/data shows | `waitlist_entries` columns: `id uuid default gen_random_uuid()`, `event_id uuid`, `ticket_type_id uuid`, `email text`, `phone text`, `name text`, `status text default 'waiting'`, `invited_at timestamptz`, `created_at timestamptz default now()`. Checks: nonempty email and status in `waiting/invited/converted/expired`. PK on `id`; indexes on `event_id` and `ticket_type_id`; FKs to `events(id)` and `ticket_types(id)` with `ON DELETE CASCADE`; RLS enabled; grants to anon/authenticated/service_role; one authenticated brand-team SELECT policy. |
| Expected vs observed | Expected from intake: no signup table. Observed: `waitlist_entries` exists and is the only waitlist persistence table found; no `waitlist_signups`, `waitlist_offers`, or waitlist notification table exists. |
| Truth layer | Schema. |
| Repro/query | `rg -n "waitlist_entries|waitlist_signups|waitlist_offers" supabase/migrations supabase/functions mingla-business/src mingla-business/app`. |
| Confidence | High. Latest migration-chain grep found only the baseline definition for `waitlist_entries`; no later migration supersedes it. |

## Q2 - `waitlist_enabled` Plumbing

**Classification:** confirmed partial plumbing.

| Required field | Evidence |
|---|---|
| File:line | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9829`, `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:405-442`, `mingla-business/src/services/ticketTypeMapper.ts:18-40`, `mingla-business/src/services/businessEvents.ts:200-202`, `mingla-business/src/services/businessEvents.ts:276-290`, `mingla-business/src/services/publicEventsService.ts:155-177`, `mingla-business/src/services/publicEventsService.ts:421-435`, `mingla-business/src/services/publicEventsService.ts:547-561`, `mingla-business/src/components/event/PublicEventPage.tsx:57-78` |
| What code/data shows | `ticket_types.waitlist_enabled` exists with default false; latest event publish RPC writes `COALESCE((v_ticket->>'waitlistEnabled')::boolean, false)` into it; mapper/service code reads/writes the field; public event service selects `waitlist_enabled` and maps it to `TicketStub.waitlistEnabled`; adapter passes it into package `PublicTicketProps`. |
| Expected vs observed | Expected: value changes buyer behavior. Observed: it reaches the public event page and package component, but only gates a toast-only "Join waitlist" stub when the ticket appears sold out. Checkout quantity rows do not receive `waitlistEnabled` at all. |
| Truth layer | Schema + code. |
| Repro/query | `rg -n "waitlist_enabled|waitlistEnabled" supabase/migrations mingla-business/src mingla-business/app packages/event-rendering`. |
| Confidence | High. The latest event publish function is `20260604000001_orch_0824_publish_rpc.sql`; older publish definitions were superseded by `CREATE OR REPLACE FUNCTION`. |

## Q3 - Buyer-Web Waitlist Surface

**Classification:** UX gap + dead-end stub.

| Required field | Evidence |
|---|---|
| File:line | `packages/event-rendering/types.ts:20-37`, `packages/event-rendering/types.ts:89-96`; `packages/event-rendering/PublicEventPage.tsx:461-492`, `packages/event-rendering/PublicEventPage.tsx:526-544`; `mingla-business/src/components/event/PublicEventPage.tsx:203-210`; `mingla-business/src/components/checkout/QuantityRow.tsx:84-113`; `packages/event-rendering/QuantityRow.tsx:55-72`, `packages/event-rendering/QuantityRow.tsx:174-188`, `packages/event-rendering/QuantityRow.tsx:275-278` |
| What code/data shows | Public event package has `waitlistEnabled` and `onJoinWaitlist`; public event rows call `callbacks.onJoinWaitlist(ticket.id)` and render "Join waitlist" for sold-out waitlist-enabled tickets. Mingla-business callback only `showToast("Waitlist invites land B5.")`. Checkout `QuantityRow` strips `waitlistEnabled` from the package row shape and only renders a "Sold out" badge when capacity is zero. |
| Expected vs observed | Expected: buyer can join waitlist with email/phone. Observed: buyer either gets a B5 toast on public event page stub or no waitlist affordance in checkout. No `JoinWaitlist` component, hook, or service exists. |
| Truth layer | Code. |
| Repro/query | `rg -n "waitlist|Waitlist|JoinWaitlist|Join waitlist|waitlistEnabled|waitlist_enabled" mingla-business/src mingla-business/app --glob '!**/__tests__/**'`. |
| Confidence | High. Grep found only toggle/plumbing/stub references, no signup form or service. |

## Q4 - Business App / Planner Waitlist Surface

**Classification:** missing feature.

| Required field | Evidence |
|---|---|
| File:line | `mingla-business/src/components/event/TicketTierEditSheet.tsx:952-964`; `mingla-business/src/utils/draftEventValidation.ts:473-478`; `mingla-business/src/utils/ticketDisplay.ts:89-91`, `mingla-business/src/utils/ticketDisplay.ts:140-142`; `mingla-business/app/trip/[id]/index.tsx:75-88`; `mingla-business/app/trip/[id]/index.tsx:290-301` |
| What code/data shows | Planner can enable waitlist and gets validation against unlimited capacity. Ticket display helpers show `+ Waitlist` / "Waitlist available" badges. Trip dashboard maps trip pricing tiers to `waitlistEnabled: false`; KPI spots count orders, not waitlist signups. |
| Expected vs observed | Expected: planner can see waitlist count/signups and gets notified when a spot opens. Observed: planner only controls a ticket flag and sees badges/change labels; there is no waitlist list, count, drain control, or notification UI. Trip pricing currently hard-codes waitlist false. |
| Truth layer | Code. |
| Repro/query | Same grep as Q3, plus `rg -n "TripCheckoutFlow|waitlistEnabled|spotsLabel" mingla-business/app mingla-business/src/components/trip`. |
| Confidence | High. No planner-facing waitlist CRUD/list code was found. |

## Q5 - Edge Functions

**Classification:** confirmed missing backend edge surface.

| Required field | Evidence |
|---|---|
| File:line | `supabase/functions/` inventory lists deployable functions including `ticket-checkout-create`, `ticket-confirmation-dispatch`, `notification-retry-sweeper`, but no waitlist function. `supabase/config.toml:73-91` registers anon-tolerant buyer functions for checkout status/confirm and intake upload, but no waitlist function. |
| What code/data shows | `rg -n "waitlist|Waitlist|wait list|wait-list" supabase/functions` returned no matches. |
| Expected vs observed | Expected: anon-safe waitlist signup and/or notify/drain edge function. Observed: none exists and no deployed client code can call one. |
| Truth layer | Code + runtime configuration. |
| Repro/query | `find supabase/functions -maxdepth 2 -name index.ts | sort`; `rg -n "waitlist|Waitlist|wait list|wait-list" supabase/functions`; `rg -n "ticket-confirmation-dispatch|waitlist" supabase/config.toml`. |
| Confidence | High. Full edge-function tree grep found zero waitlist references. |

## Q6 - Sold-Out UX Today

**Classification:** confirmed UX gap + sibling ORCH-0946 overlap.

| Required field | Evidence |
|---|---|
| File:line | `/checkout/{eventId}`: `mingla-business/app/checkout/[eventId]/index.tsx:167-185`, `mingla-business/app/checkout/[eventId]/index.tsx:187-210`, `mingla-business/app/checkout/[eventId]/index.tsx:258-276`. `/checkout-trip/{tripEventId}`: `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:65-86`, `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:234-240`, `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:241-267`. `/e/{brandSlug}/{eventSlug}`: `packages/event-rendering/PublicEventPage.tsx:86-91`, `packages/event-rendering/PublicEventPage.tsx:461-492`, `packages/event-rendering/PublicEventPage.tsx:506-510`. Shared row: `packages/event-rendering/QuantityRow.tsx:174-188`, `packages/event-rendering/QuantityRow.tsx:275-278`. |
| What code/data shows | `/checkout/{eventId}` shows an empty "Sold out" / "This event isn't taking new tickets" state only when every visible ticket has `capacity <= 0`; otherwise it renders `QuantityRow`. `/checkout-trip` does the same. Public event page marks sold out only when every visible ticket has `capacity === 0` and labels individual sold-out waitlist tickets "Join waitlist." |
| Expected vs observed | Expected: sold-out tier should show Join waitlist when enabled. Observed: persisted DB tickets cannot normally have `quantity_total = 0` because `ticket_types_qty_positive` allows only NULL or positive (`supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9834-9837`), and services pass total capacity as `capacity` (`mingla-business/src/services/publicEventsService.ts:421-435`). Real sold-out inventory is only enforced by checkout RPC capacity gate (`supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:221-239`). |
| Truth layer | Schema + code. |
| Repro/query | Read the checkout index screens and package public/quantity row; compare to `ticket_types.quantity_total` check and service mapping. |
| Confidence | High. This directly overlaps ORCH-0946's remaining-capacity defect, but ORCH-0948 depends on it because waitlist UI needs a real sold-out signal. |

## Q7 - Capacity / "Spot Opens" Detection

**Classification:** missing feature + latent backend contract gap.

| Required field | Evidence |
|---|---|
| File:line | Capacity gate: `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:221-239`. Ticket creation: `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql:234-249`. Refund frees inventory by setting tickets refunded: `supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql:467-485`. Ticket table/trigger: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9862-9882`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:12707`. |
| What code/data shows | Checkout computes sold tickets as `status IN ('valid','used','transferred')` and rejects when sold+reserved+qty exceeds `quantity_total`. Finalize inserts valid tickets. Refund updates valid tickets to `refunded`, which removes them from the capacity count. The only ticket trigger found enforces consistent event, not waitlist drain. |
| Expected vs observed | Expected: system detects a free spot and notifies FIFO waitlist entries. Observed: no trigger/service watches `tickets.status` changes, refund completion, or capacity increases for waitlist notification. Existing capacity arithmetic can be reused, but the waitlist-open event path does not exist. |
| Truth layer | Schema + RPC. |
| Repro/query | `rg -n "ticket_capacity_exceeded|status IN \\('valid'|UPDATE public.tickets|CREATE TRIGGER .*tickets|waitlist" supabase/migrations supabase/functions`. |
| Confidence | High. No waitlist drain function, trigger, or notification enqueue appears in migration/function search. |

## Q8 - Notification Infra Reuse

**Classification:** confirmed reusable infrastructure with template-extension requirement.

| Required field | Evidence |
|---|---|
| File:line | Queue schema/RLS: `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:153-182`, `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:229-240`. Retry cron: `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql:1-17`, `supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql:104-128`. Dispatcher: `supabase/functions/ticket-confirmation-dispatch/index.ts:1-22`, `supabase/functions/ticket-confirmation-dispatch/index.ts:82-145`, `supabase/functions/ticket-confirmation-dispatch/index.ts:734-845`, `supabase/functions/ticket-confirmation-dispatch/index.ts:968-979`. Sender constants: `supabase/functions/_shared/email/senders.ts:24-33`. Trigger helper: `supabase/functions/_shared/ticketCheckout.ts:119-131`. |
| What code/data shows | `ticket_order_notifications` queues email/SMS rows with status, idempotency key, attempts, payload. `ticket-confirmation-dispatch` sends Resend email and Twilio SMS, marks rows sent, and fails unknown `template_key` values terminally. ORCH-0788 retry cron re-dispatches failed retryable rows every five minutes. |
| Expected vs observed | Expected: waitlist notification should reuse Resend/Twilio dispatch shape. Observed: infrastructure is appropriate, but a new waitlist template key/adapter/queue writer is absent; unknown template keys already fail loudly by design. |
| Truth layer | Schema + edge code. |
| Repro/query | Read queue migration, retry cron, and `ticket-confirmation-dispatch`; grep `template_key`, `sendResendEmailWithAttachment`, `sendTwilioMessage`. |
| Confidence | High. Reuse is clear; implementing a new template without dispatcher support would violate `Mingla_Artifacts/INVARIANT_REGISTRY.md:447-455`. |

## Q9 - Constitutional / Invariant Compliance

**Classification:** production-hardening gap + invariant risks.

| Required field | Evidence |
|---|---|
| File:line | Constitution: `README.md:56-64`. Anon route rule: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_anon_buyer_routes.md:1-20`, `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_anon_buyer_routes.md:38-40`. RLS returning memory: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md:10-23`. Existing waitlist RLS: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14194-14196`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:16131`, `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:18574-18576`. |
| What code/data shows | The table has grants to anon/authenticated/service_role but RLS has only brand-team SELECT. The table stores buyer email/phone/name but has no signup source, consent timestamp, quantity requested, dedupe constraint, or invite expiry. Public event `onJoinWaitlist` shows a toast but does not persist. |
| Expected vs observed | Expected: anonymous buyers can sign up without auth, state-changing errors are visible, and PII collection is purposeful/consented. Observed: direct anon insert is blocked by RLS, service-role-only signup path is missing, and the current public CTA is a dead-end toast. |
| Truth layer | Docs + schema + code. |
| Repro/query | Read README constitution, anon-buyer memory, RLS memory, and waitlist RLS/grants. |
| Confidence | Medium-high. PII consent/expiry needs product/legal confirmation in SPEC, but the current absence is a production-readiness risk. |

## Q10 - Sequencing Risk vs META-ORCH-0952

**Classification:** explicit sequencing overlap.

| Required field | Evidence |
|---|---|
| File:line | `Mingla_Artifacts/WORLD_MAP.md:729` queues ORCH-0948 behind META-ORCH-0952 as buyer-web polish touching the same checkout surface; `Mingla_Artifacts/WORLD_MAP.md:739` registers META-ORCH-0952 for `/checkout-trip/{tripEventId}/confirm` and `/checkout/{eventId}/confirm`; `Mingla_Artifacts/reports/SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md:1-20`, `Mingla_Artifacts/reports/SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md:116-149`, `Mingla_Artifacts/reports/SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md:153-167` documents the unresolved confirm-carousel defect and critical files. |
| What code/data shows | META-ORCH-0952 owns confirm pages and `TicketQrCarousel`. ORCH-0948 would primarily touch public event page, checkout ticket-selection pages, waitlist signup edge/RPC, and planner surfaces. |
| Expected vs observed | Expected: flag any landing-area collision. Observed: no current direct overlap with `confirm.tsx` or `TicketQrCarousel` unless ORCH-0948 adds post-purchase waitlist messaging there. There is indirect overlap with buyer-web checkout routing and shared buyer-web QA; ORCH-0946 remaining-capacity work is a more direct prerequisite for reliable waitlist CTA behavior. |
| Truth layer | Artifacts + code. |
| Repro/query | Read WORLD_MAP META entries and `SAGA_BUYER_WEB_CONFIRM_CAROUSEL.md`; grep ORCH-0948 landing files. |
| Confidence | High for current overlap; medium for future implementation collision because META-ORCH-0952 may rewrite broader checkout pipeline contracts. |

## Root-Cause Classification

| Root cause | Classification | Evidence |
|---|---|---|
| Planner toggle shipped without real buyer signup | confirmed UX gap / missing feature | Toggle and validation exist at `TicketTierEditSheet.tsx:952-964` and `draftEventValidation.ts:473-478`; public callback only toasts at `PublicEventPage.tsx:203-210`. |
| Existing table is unused by clients | confirmed backend integration gap | `waitlist_entries` exists at `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:10126-10144`, but no edge function or service references it (`rg waitlist_entries` only finds schema). |
| Real sold-out signal is unavailable to UI | confirmed latent backend/data-contract defect | UI uses `capacity === 0`; services pass `quantity_total`; schema disallows zero finite quantity; checkout RPC alone computes sold+reserved. |
| No spot-open detector/drain | confirmed missing backend feature | Refunds update tickets to `refunded`; no waitlist trigger/function reacts. |
| Notification queue can be reused but is not extended | confirmed integration gap | Dispatcher has Resend/Twilio and defensive unknown-template failure; no waitlist template writer/handler. |

Conclusion: **not purely missing UI**. It is missing UI plus missing anon-safe signup backend, missing capacity-open detection, missing waitlist notification integration, and a sold-out/remaining-capacity contract defect shared with ORCH-0946.

## Reuse vs Rebuild Recommendation

Reuse `public.waitlist_entries` as the canonical table identity. Do not create a parallel `waitlist_signups` table unless the SPEC proves an unrecoverable incompatibility, because the existing table already has the expected semantic name, event/ticket FKs, brand-team SELECT shape, lifecycle status values, and historical B1 provenance.

However, treat the current table as an incomplete substrate, not production-ready. The SPEC should reconcile missing contract pieces before implementation: anonymous service-role signup path, duplicate prevention/idempotency, requested quantity, notification/invite timing semantics, privacy/consent fields as product/legal require, FIFO ordering, planner read surface, and notification queue integration. This is a reuse-and-harden path, not a rebuild.

## Blast-Radius Map

| Surface/layer | Impact |
|---|---|
| Buyer public event page `/e/{brandSlug}/{eventSlug}` | Has stub "Join waitlist" behavior only for `capacity === 0`; real sold-out state is not reliable until remaining capacity exists. |
| Buyer checkout `/checkout/{eventId}` | No waitlist CTA; sold-out gating currently depends on total capacity and falls through to server 409 in real sellout cases. |
| Buyer trip public/checkout `/t/...` and `/checkout-trip/{tripEventId}` | Trip entry hard-codes waitlist false and uses trip pricing total quantity, so no trip waitlist behavior exists. |
| Business event planner | Can enable waitlist flag and see badges/change labels; cannot view/manage signups. |
| Business trip planner | No waitlist toggle/surface for trip pricing tiers; dashboard spots KPI is unrelated and currently counts orders. |
| Supabase schema/RLS | `waitlist_entries` exists but is service-role-only for writes in practice; no anon insert policy and no service-role RPC/edge writer. |
| Edge functions | No waitlist signup/drain/notify function. |
| Notifications | Reusable `ticket_order_notifications` + dispatcher exists, but waitlist template and queue writer are absent. |
| META-ORCH-0952 | Indirect buyer-web checkout sequencing overlap; direct confirm-carousel files should remain out of ORCH-0948 unless META conclusions require otherwise. |

## Readiness For SPEC

Ready for SPEC with caveats:

1. SPEC must start from reuse of `waitlist_entries`, not a new `waitlist_signups` table, unless it explicitly rejects reuse with evidence.
2. SPEC must declare dependency/coordination with ORCH-0946 for remaining-capacity exposure; without that, waitlist CTA trigger conditions remain unreliable.
3. SPEC must avoid `app-mobile/` and `mingla-admin/` and keep buyer-web primary plus business app parity.
4. SPEC must explicitly flag META-ORCH-0952 overlap and avoid confirm-page changes until META-ORCH-0952 returns, unless the operator intentionally reorders.
5. SPEC must include repo-running regression tests in the same scoped commit/push per AGENTS.md: buyer public-page waitlist CTA, checkout sold-out waitlist CTA, anon signup edge/RPC, RLS/service-role path, planner waitlist read, notification enqueue/drain, and failure states.

## Verification Commands Run

```bash
rg -n "ORCH-0948|waitlist|wait list|wait-list|META-ORCH-0952|0952" Mingla_Artifacts -g '!prompts/**'
rg -n "waitlist_entries|waitlist_signups|waitlist_offers|waitlist.*notification|ticket_waitlist" supabase/migrations supabase/functions mingla-business/src mingla-business/app --glob '!**/node_modules/**'
rg -n "waitlist|Waitlist|JoinWaitlist|Join waitlist|waitlistEnabled|waitlist_enabled" mingla-business/src mingla-business/app --glob '!**/__tests__/**' --glob '!**/*.test.*' --glob '!**/node_modules/**'
rg -n "waitlist|Waitlist|wait list|wait-list" supabase/functions --glob '!**/node_modules/**'
rg -n "ticket_capacity_exceeded|UPDATE public.tickets|CREATE TRIGGER .*tickets|waitlist" supabase/migrations supabase/functions --glob '!**/node_modules/**'
```
