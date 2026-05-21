# IMPLEMENTATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT

Date: 2026-05-21  
Branch/worktree: `orch-0897-impl` at `/Users/sethogieva/Desktop/mingla-main-orch-0897`  
Implementation commit: `b76467755e07` (`ORCH-0897 trip event group chat`)  
Status: **implemented locally; edge deploy deferred until operator applies remote migration**

## Executive Summary

Implemented ORCH-0897 end-to-end across the DB substrate, edge functions, consumer app, business app, checkout/email CTA, and a repo-running regression gate.

Remote deployment was intentionally not performed. `mcp__supabase__list_migrations` showed production migrations stop at `20260703000000_orch_0906_session_deck_cards_mixed_type`; `20260710000000_orch_0897_trip_event_group_chat` is not applied. Per operator guard, no `supabase db push` and no edge function deploy were run.

## Scope Receipts

| Area | Old | New receipt |
|---|---|---|
| DB substrate | ORCH-0898 chat substrate only handled `trip`; no event discriminator branch for consumer event chats. | `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:18`, `:81`, `:143`, `:409`, `:733` add trip/event auto-create, buyer roster/claim helper, finalizer wiring, RLS, and backfill assertion. |
| Blast idempotency | Marketing blasts only sent email/report rows. | `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:48`; `supabase/functions/marketing-send/index.ts:450`, `:466`, `:505`, `:511`, `:517` write one idempotent chat message for `event_buyers`. |
| Claim edge | No post-install anon buyer chat claim endpoint. | `supabase/functions/claim-pending-trip-chat-participation/index.ts:32`, `:49`, `:85`, `:116`, `:134`; `supabase/config.toml:100` add JWT-protected preview/claim flow. |
| Consumer app | Conversations did not expose trip/event metadata, claims, countdown, or chat/order deep links. | `app-mobile/src/services/messagingService.ts:216`, `:524`, `:837`, `:877`, `:894`; `app-mobile/src/components/ConnectionsPage.tsx:1451`; `app-mobile/src/components/MessageInterface.tsx:1132`; `app-mobile/src/services/deepLinkService.ts:68`, `:79`; `app-mobile/app.json:62`, `:67`. |
| Onboarding | Pending trip/event chat claims were invisible during collaboration onboarding. | `app-mobile/src/hooks/usePendingTripChatClaims.ts:11`; `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx:313`, `:319`, `:569` show claims, claim membership, and route into chat. |
| Business app | No event/trip Group Chat tile or planner moderation surface. | `mingla-business/app/trip/[id]/index.tsx:375`; `mingla-business/app/event/[id]/index.tsx:690`; `mingla-business/app/event/[id]/group-chat.tsx:4`; `mingla-business/src/components/groupChat/GroupChatPanel.tsx:27`; `mingla-business/src/services/groupChatService.ts:48`, `:123`, `:137`, `:149`. |
| Checkout/email | Buyer confirmation did not advertise the consumer chat path. | `mingla-business/app/checkout/[eventId]/confirm.tsx:478`; `mingla-business/src/components/checkout/DownloadMinglaCta.tsx:21`; `supabase/functions/_shared/email/ticketBody.ts:141`, `:147`, `:200`. |
| Regression | No ORCH-0897 repo-running regression. | `app-mobile/scripts/ci/orch-0897-regression-check.mjs:1` adds T-01..T-15 including T-04 fails-on-revert key. |

## SPEC Traceability

| Criterion | Evidence |
|---|---|
| SC-01 | Auth buyer finalization calls `add_buyer_to_event_chat` at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:409`; helper inserts participants at `:195`; trigger/backfill conversation creation at `:81`, `:652`. |
| SC-02 | `pending_trip_chat_claims` table and claim token at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:56`, `:203`, `:698`. |
| SC-03 | `getConversations` returns `event_id`/`linked_entity_type` at `app-mobile/src/services/messagingService.ts:524`, `:629`; `ConnectionsPage` maps metadata at `app-mobile/src/components/ConnectionsPage.tsx:798`, `:1110`. |
| SC-04 | Countdown hook/banner at `app-mobile/src/hooks/useTripCountdown.ts:7`, `app-mobile/src/components/chat/TripCountdownBanner.tsx:11`; slotted into chat at `app-mobile/src/components/MessageInterface.tsx:1132`. |
| SC-05 | Pending claim cards and join action at `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx:313`, `:319`, `:569`; claim edge writes participants at `supabase/functions/claim-pending-trip-chat-participation/index.ts:116`. |
| SC-06 | Chat/order deep links at `app-mobile/src/services/deepLinkService.ts:68`, `:79`; app passes params into Connections at `app-mobile/app/index.tsx:2171`, `:2460`, `:2730`; Android filters at `app-mobile/app.json:62`, `:67`. |
| SC-07 | Group Chat tiles at `mingla-business/app/trip/[id]/index.tsx:375` and `mingla-business/app/event/[id]/index.tsx:690`. |
| SC-08 | Route and full panel at `mingla-business/app/event/[id]/group-chat.tsx:4`, `:10`; `GroupChatPanel` at `mingla-business/src/components/groupChat/GroupChatPanel.tsx:27`. |
| SC-09 | Planner send uses current user `sender_id` at `mingla-business/src/services/groupChatService.ts:48`, `:60`; realtime message subscription at `mingla-business/src/hooks/useEventGroupChat.ts:54`, `:60`. |
| SC-10 | Broadcast-only restrictive RLS at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:509`; UI toggle/service at `mingla-business/src/services/groupChatService.ts:123`. |
| SC-11 | Participant removal RLS/service at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:555`, `:619`; `mingla-business/src/services/groupChatService.ts:137`. |
| SC-12 | Soft delete policy/service and consumer filter at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:586`; `mingla-business/src/services/groupChatService.ts:149`; `app-mobile/src/services/messagingService.ts:654`, `:657`. |
| SC-13 | Confirmation CTA card at `mingla-business/app/checkout/[eventId]/confirm.tsx:478`; store/chat links at `mingla-business/src/components/checkout/DownloadMinglaCta.tsx:21`. |
| SC-14 | Email CTA after calendar section at `supabase/functions/_shared/email/ticketBody.ts:141`, `:147`, `:200`, `:221`. |
| SC-15 | Blast chat write at `supabase/functions/marketing-send/index.ts:450`, `:466`, `:505`, `:511`. |
| SC-16 | Unique partial idempotency index and duplicate swallowing at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:48`; `supabase/functions/marketing-send/index.ts:517`. |
| SC-17 | Non-fatal blast→chat failure path logs but does not throw at `supabase/functions/marketing-send/index.ts:515`. |
| SC-CRITICAL-SECURITY | RLS extends trip/event brand and participant boundaries at `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:478`, `:486`, `:536`, `:555`, `:586`; independent adversarial RLS verification remains assigned to tester per SPEC §13.2. |

## Verification

Passed:

```text
node app-mobile/scripts/ci/orch-0897-regression-check.mjs
ORCH-0897 regression check passed: 15/15
```

```text
/Users/sethogieva/.deno/bin/deno check supabase/functions/claim-pending-trip-chat-participation/index.ts
PASS

/Users/sethogieva/.deno/bin/deno check supabase/functions/marketing-send/index.ts
PASS
```

```text
/Users/sethogieva/.deno/bin/deno test supabase/functions/marketing-send --allow-read --no-check
ok | 12 passed | 0 failed
```

Fails-on-revert:

```text
Temporary parent-tree worktree at b76467755e07^ with only the ORCH-0897 regression script injected:
node app-mobile/scripts/ci/orch-0897-regression-check.mjs
ORCH-0897 regression check failed: 15/15
```

Blocked or not applicable:

```text
npx tsc --noEmit --pretty false            # app-mobile
This is not the tsc command you are looking for

npm run typecheck -- --pretty false        # mingla-business
sh: tsc: command not found

npm run lint                               # app-mobile / mingla-business
sh: expo: command not found

deno test supabase/functions/claim-pending-trip-chat-participation --no-check
error: No test modules found
```

No dependency install was performed.

## Deployment

Not deployed.

Remote migration check via `mcp__supabase__list_migrations` showed the remote migration list stops at `20260703000000_orch_0906_session_deck_cards_mixed_type`; `20260710000000_orch_0897_trip_event_group_chat` is absent. Therefore:

- `supabase db push`: not run, per operator guard.
- `/Users/sethogieva/bin/supabase functions deploy claim-pending-trip-chat-participation --project-ref gqnoajqerqhnvulmnyvv`: not run.
- `/Users/sethogieva/bin/supabase functions deploy marketing-send --project-ref gqnoajqerqhnvulmnyvv`: not run.
- Edge `verify_jwt`: preserved true at `supabase/config.toml:96` and `:100`.
- Version bumps: none applied in this implementation commit; deploy/version bump remains gated on operator migration confirmation.

## Deferred Items and Discoveries

| Item | Status |
|---|---|
| Remote migration + edge deploy | Deferred until operator applies `20260710000000_orch_0897_trip_event_group_chat` and confirms via `mcp__supabase__list_migrations`. |
| Tester adversarial checks | Required next: `app-mobile/scripts/ci/orch-0897-adversarial-check.mjs`, cross-trip and cross-event RLS isolation, broadcast-only INSERT smoke, removal visibility, and soft-delete visibility. |
| Native deep link delivery | `app-mobile/app.json` Android intent filters now include `/orders` and `/chat`; native config changes require release-owner validation, not just OTA. |
| iOS AASA `/orders/*/chat` | Operator-owned downstream per SPEC §14 step 16. |
| Trip confirmation email template | Event ticket email CTA is implemented in `ticketBody.ts`; separate trip confirmation email template exists outside the listed email scope and should be handled in a follow-up if the operator wants the identical CTA in trip-specific confirmations. |
| Email `{orderId}` source | `ticketBody.ts` uses `order.id` when present and falls back to `shortId`; the current render context may not always include the full UUID without widening into shared dispatch/type files. |
| Marketing sender identity | `marketing_campaigns` in this branch exposes `account_id`, not `created_by`; blast chat sender uses `campaign.account_id` and is documented for tester/orchestrator scrutiny. |

## Handoff

NEXT HANDOFF: Claude `mingla-forensics` TEST mode should run independent QA from `/Users/sethogieva/Desktop/mingla-main-orch-0897` on branch `orch-0897-impl`, create `app-mobile/scripts/ci/orch-0897-adversarial-check.mjs`, verify cross-trip + cross-event RLS isolation, and produce `Mingla_Artifacts/reports/QA_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`. Do not deploy edge functions until the operator confirms the remote `20260710000000` migration is applied.
