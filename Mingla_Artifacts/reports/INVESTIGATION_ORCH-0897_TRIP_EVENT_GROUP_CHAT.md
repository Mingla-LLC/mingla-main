# INVESTIGATION + AUDIT — ORCH-0897 [Trips + Events Group Chat — auto-created consumer-app collab session + business-app Group Chat tile + blast→chat wiring]

**Skill:** Claude `mingla-forensics` — INVESTIGATE + AUDIT mode (combined; SPEC follows in `Mingla_Artifacts/specs/SPEC_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21
**Confidence:** HIGH for code-read findings; HIGH for live-schema verification via Supabase MCP; this is a code-audit-only investigation exempt from Prime Directive 7 live-fire requirement per dispatch §1 and §0.
**Substrate parent:** ORCH-0898 [Consumer collab session → Friends-tab group chat] — CLOSED PASS 2026-05-21; ORCH-0897 inherits the unified `conversations`+`messages` substrate. Verification of substrate-shipment status in §4 below.

---

## §0 Phase 0 ingestion (mandatory; cited)

| Source | One-line summary | Read state |
|---|---|---|
| `Mingla_Artifacts/WORLD_MAP.md` lines 3–31 | Authoritative ORCH-0897 scope banner (top); ORCH-0898 substrate close banner; line-23 SCOPE UPDATE retargeting Tr6 onto `conversations`+`messages`; original line-31 INTAKE banner (historical) | read |
| `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` (1024 lines) | Substrate spec with all 12 locked open questions + RLS policy text + edge function contract | read (full) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT_v2.md` | Old→new receipts for 12 files; documented SPEC §3.1 Step 6c `AS RESTRICTIVE` SPEC-text correction; image-attachment deferral note | read (full) |
| `Mingla_Artifacts/reports/QA_ORCH-0898_COLLAB_GROUP_CHAT_REPORT.md` | CONDITIONAL PASS; P0/P1/P2 = 0/0/0; P3 = 2 (SPEC §3.1 Step 6c backport + pre-existing TS Friend collision); 17/17 happy-path + 15/15 adversarial regression GREEN | read (full) |
| `Mingla_Artifacts/milestones/Tr6_DISCUSSION_BOARD.md` | Operator-locked Tr6 milestone — proposes (now-superseded) NEW `event_threads` substrate. SUBSTANTIALLY SUPERSEDED by ORCH-0898 + this banner. Cited as historical context. | read (full, in prior conversation) |
| `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` | The substrate schema. 554 lines. Adds 6 conversations columns + messages.mentions + conversation_participants.notifications_muted + 3 triggers + 4 RLS policies + board_messages → messages backfill with row-count assert | read (full) |
| `supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql` | Adds `events.event_type IN ('event', 'experience', 'trip')` CHECK. Three values, not two. | read |
| `supabase/functions/marketing-send/index.ts` | Phase-A blast pipeline. Email-only (SMS/RCS throw `not_yet_enabled`). Writes to `marketing_messages`. NO writes to `conversations`+`messages`. | read (full, via subagent + verified grep) |
| `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql` | `marketing_audiences` + `marketing_campaigns` + `marketing_messages` + `marketing_templates` + `marketing_unsubscribes` schema | read (via subagent) |
| `supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql` | `mkt_claim_campaigns` RPC with `FOR UPDATE SKIP LOCKED`; pg_cron schedule `* * * * *` | read (via subagent) |
| `app-mobile/src/services/messagingService.ts` lines 869-907 | `getOrCreateGroupConversationForSession` lookup-only; NO `getOrCreateGroupConversationForEvent` sibling | read (full function body) |
| `app-mobile/src/hooks/useOnboardingStateMachine.ts` line 17 | Step 6 = `['collaborations']` — single substep | read |
| `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` (833 lines) | Renders pending collab invites via `useSessionManagement().pendingInvites`; tap-to-join (not auto-join) | read (via subagent) |
| `app-mobile/src/components/MessageInterface.tsx` lines 1018-1114 | Chat header has NO sub-banner space today; message list begins immediately after header | read (via subagent) |
| `app-mobile/src/services/deepLinkService.ts` lines 27-94 | Existing scheme `mingla://` paths: home, discover, connections, session/{id}, messages/{id}, calendar/{id}, review/{id}, profile, subscription, onboarding, board/{code}, likes, saved. **MISSING:** `mingla://chat/<conv>?type=group&eventId=<e>` (the ORCH-0898 SPEC §3.2 format) | read (via subagent) |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Post-Stripe-success page; renders TicketQrCarousel; NO "Download Mingla" CTA, NO "open in app" affordance | read (via subagent + verified grep) |
| `mingla-business/app/trip/[id]/index.tsx` lines 351-379 | Action grid with 4 tiles: View public, Brand page, **Marketing blasts** (routes to `/event/{trip.id}/blasts`), Edit trip (primary). Trip→Blasts reuses event Blasts surface | read (verified) |
| `mingla-business/app/event/[id]/index.tsx` lines 655-713 | Action grid with 8-9 tiles: Scan (primary), Scanners, Orders, Guests, Blasts, Public, Brand, Door Sales (conditional), Reconciliation (perm-gated) | read (via subagent) |
| `mingla-business/app/event/[id]/blasts/index.tsx` + `mingla-business/app/brand/[id]/blasts.tsx` | Blasts tile entry points; both route to composer at `/marketing/campaigns/compose?audience=<kind>:<targetId>` | read (via subagent) |
| `supabase/functions/ticket-checkout-confirm/index.ts` + `supabase/functions/_shared/stripeWebhookRouter.ts` + `biz_ticket_checkout_finalize` RPC (in `20260515000013_orch_0777_ticket_checkout_core.sql`) | The order-confirmation pipeline. `payment_status='paid'` is hardcoded at INSERT inside the finalize RPC. Tickets created + notifications queued INSIDE the RPC. Trip + event tickets created identically (no event_type fork). | read (via subagent) |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` + `supabase/functions/_shared/email/ticketBody.ts` | HTML+text+PDF Resend email. Hero → greeting → heading → event details → tickets-attached block → line items → order number → calendar links | read (via subagent) |
| Memory `feedback_rls_returning_owner_gap.md` | Pair owner-callable mutations with direct-predicate owner-SELECTs. SECURITY DEFINER helpers fail in RETURNING + soft-delete contexts | indexed |
| Memory `feedback_solo_collab_parity.md` | Solo+collab parity rule — DM + group chat both ride on conversations+messages per ORCH-0898 | indexed |
| Memory `feedback_supabase_neq_null.md` | Never use `.neq()` on nullable columns | indexed |
| Memory `feedback_anon_buyer_routes.md` | `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` live OUTSIDE `app/(tabs)/`; never call `useAuth` | indexed |

No prior investigation contradicts current findings. No referenced table is decommissioned. The four parallel-session ORCHs (0906/0908/0909) currently dirty in the working tree do not touch ORCH-0897 scope (collab deck mechanics, not chat substrate).

---

## §1 Operator scope (authoritative; verbatim from WORLD_MAP top banner 2026-05-21)

**A.** Business-app "Group Chat" tile on trip page AND event page. Tap → opens chat interface with all confirmed buyers. Planner: read + chat (reply) + moderate (broadcast-only toggle, remove participant, delete message). Separate from existing Blasts tile.

**B.** Consumer-app auto-created group chat on order confirmation (trip OR event) using ORCH-0898 `conversations`+`messages` substrate.

**C.** Slim countdown banner in consumer app's chat header neighborhood — days until trip/event start_at; null-safe; hides post-end.

**D.** Web post-purchase "Download Mingla" CTA on `mingla-business/app/checkout/[eventId]/confirm.tsx` — mirrors existing email CTA.

**E.** Consumer-app onboarding surfacing of pending trip/event session chats via existing `OnboardingCollaborationStep` (no new screen).

**F.** Blast → chat wiring (EXTENSION, not replacement). Existing Blasts tile + `marketing-send` already fans out email; extend to ALSO write into the new auto-created group chat as a regular planner-voice message. Idempotent per `(blast_id, conversation_id)`.

**OUT of scope:** new chat-message tables; new blast composer; Trip Documents tab + `trip_documents` storage bucket; Ari summarization; admin-web moderation; `event_type='experience'` (discovered third enum value — see §3.11 + Discovery DISC-0897-1).

---

## §2 Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `Mingla_Artifacts/WORLD_MAP.md` lines 3-31 | Docs | Operator scope; ORCH-0898 close status |
| 2 | `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` | Docs | Substrate contract |
| 3 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT_v2.md` | Docs | What shipped |
| 4 | `Mingla_Artifacts/reports/QA_ORCH-0898_COLLAB_GROUP_CHAT_REPORT.md` | Docs | Substrate verification |
| 5 | `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` | Schema | Substrate schema authority |
| 6 | `supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql` | Schema | event_type enum |
| 7 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (orders + conversations) | Schema | Pre-existing schema |
| 8 | `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` (biz_ticket_checkout_finalize RPC) | Schema + Code | Order confirmation pipeline |
| 9 | `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql` | Schema | Marketing tables |
| 10 | `supabase/migrations/20260603000000_orch_0815_b_marketing_send_cron.sql` | Schema + Code | Blast claim RPC + cron |
| 11 | `supabase/functions/marketing-send/index.ts` | Edge function | Blast fan-out (email only) |
| 12 | `supabase/functions/ticket-checkout-confirm/index.ts` | Edge function | Stripe success handler |
| 13 | `supabase/functions/_shared/stripeWebhookRouter.ts` | Edge function | Webhook router |
| 14 | `supabase/functions/ticket-confirmation-dispatch/index.ts` | Edge function | Email dispatcher |
| 15 | `supabase/functions/_shared/email/ticketBody.ts` | Edge function | Email body renderer |
| 16 | `supabase/functions/notify-message/index.ts` | Edge function | OneSignal push (chat) |
| 17 | `app-mobile/src/services/messagingService.ts` | Service | Group conversation lookup; missing event variant |
| 18 | `app-mobile/src/services/sessionService.ts` + `collaborationInviteService.ts` | Service | Session lifecycle |
| 19 | `app-mobile/src/services/deepLinkService.ts` | Service | URL routing |
| 20 | `app-mobile/src/hooks/useOnboardingStateMachine.ts` | Hook | Step 6 = collaborations |
| 21 | `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` | Component | Pending-invites surface |
| 22 | `app-mobile/src/components/MessageInterface.tsx` lines 1018-1114 | Component | Chat header layout |
| 23 | `app-mobile/src/components/chat/*` + `discussion/*` | Components | Chat surface; absence of pinned-card primitive |
| 24 | `app-mobile/app.json` | Config | Universal-link associated domains |
| 25 | `app-mobile/app/_layout.tsx` + `app-mobile/app/index.tsx` lines 399-478 | Component | Push deep-link routing |
| 26 | `mingla-business/app/trip/[id]/index.tsx` lines 351-379 | Component | Trip page action grid |
| 27 | `mingla-business/app/event/[id]/index.tsx` lines 655-713 | Component | Event page action grid |
| 28 | `mingla-business/app/event/[id]/blasts/index.tsx` + `app/brand/[id]/blasts.tsx` | Component | Blasts tile entry |
| 29 | `mingla-business/app/checkout/[eventId]/confirm.tsx` | Component | Web post-purchase page |
| 30 | `mingla-business/src/services/marketing/marketingCampaignService.ts` | Service | sendNow + ensureBrandBuyersAudience + ensureEventBuyersAudience |

---

## §3 Findings (classified: 🔴 Root / 🟠 Contributing / 🟡 Hidden / 🔵 Observation)

### §3.1 🔴 Root finding — `marketing-send` does NOT write to `conversations`+`messages` today

- **File + line:** `supabase/functions/marketing-send/index.ts` — `marketing_messages` writes at lines 376, 408, 429, 439. ZERO references to `conversations` table (verified via direct grep).
- **Exact code:** Lines 374-386 INSERT into `marketing_messages` with status='queued'; subsequent UPDATEs flip to `sent` / `failed` / `preview_skipped` per Resend response.
- **What it does today:** Writes one `marketing_messages` row per recipient + fires one Resend email per recipient. No in-app chat side-effect.
- **What it should do (per operator scope F):** ALSO write one `messages` row into the trip/event's auto-created `conversations` row, attributed to the planner (sender_id = planner user id), with content = blast body. Idempotent per `(campaign_id, conversation_id)`.
- **Causal chain:** Operator's prior statement "blasts already fan out to email + SMS + chat" was partially incorrect. Email exists (Phase A). SMS/RCS throw `not_yet_enabled` (Phase B/C). Chat fan-out does NOT exist. This is the bulk of new code in ORCH-0897.
- **Verification step:** `grep -n "conversations\|from('messages')\|from(\"messages\")" supabase/functions/marketing-send/index.ts` returns 5 hits all of which are `marketing_messages`, none of which are `conversations` or `messages` (the chat table).

### §3.2 🔴 Root finding — `getOrCreateGroupConversationForEvent` does NOT exist

- **File + line:** `app-mobile/src/services/messagingService.ts` lines 869-907 contain `getOrCreateGroupConversationForSession`. Grep for `getOrCreateGroupConversationForEvent` returns ZERO matches in the entire repo.
- **Exact code:** The session variant queries `.eq('session_id', sessionId).eq('linked_entity_type', 'session')` and returns the conversation row. No event variant exists.
- **What it does today:** Only session-linked group conversations can be looked up by application code.
- **What it should do:** A sibling `getOrCreateGroupConversationForEvent(eventId)` is needed for ORCH-0897 to surface the trip/event group chat in the consumer app. **However:** auto-creation is preferred via DB trigger on `events` row creation OR on `orders` confirmation, not application-layer creation. The service function is then read-only (lookup), matching the session variant's shape.
- **Causal chain:** Without this function, the consumer app cannot navigate from a trip/event ticket to the corresponding group chat.
- **Verification:** Read of full `messagingService.ts` exports list confirms absence.

### §3.3 🔴 Root finding — Substrate schema needs ONE additional `linked_entity_type` value: `'event'`

- **File + line:** `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` line 38: `CHECK (linked_entity_type IN ('direct', 'session', 'trip'))`.
- **Exact constraint:** Three-value enum; `'event'` is NOT in the list. The coherence CHECK (line 50-54) names `'trip'` branch as `event_id IS NOT NULL`.
- **What it does today:** `conversations.linked_entity_type='trip'` is the only event-id-bearing branch.
- **What it should do (per operator scope expansion):** Either (a) add `'event'` to the enum AND extend the coherence CHECK to a 4-branch form, OR (b) reuse `'trip'` semantically for both `event_type='event'` and `event_type='trip'` events.
- **Recommendation:** Option (a) — extend the enum. Reasons: (i) semantic clarity for ops + investigators; (ii) future queries can filter `linked_entity_type='event'` vs `='trip'` without joining `events.event_type`; (iii) cost is one migration with a single ALTER + DROP/RECREATE CHECK; (iv) ORCH-0898's RLS policies use the discriminator in inline EXISTS — making them branch-aware is cleaner than overloading `'trip'`.
- **Causal chain:** If we reuse `'trip'`, future SQL queries that need to distinguish trip group chats from event group chats must join `events` and filter by `event_type`. This is unnecessary indirection.
- **Verification:** Migration line-by-line read.

### §3.4 🔴 Root finding — Web post-purchase confirmation page has NO "Download Mingla" CTA or any deep-link affordance

- **File + line:** `mingla-business/app/checkout/[eventId]/confirm.tsx` — grep for `Download Mingla`, `app store`, `App Store`, `deep.link`, `deepLink` returns ZERO matches.
- **What it does today:** Renders TicketQrCarousel + order summary + tax line + "Back to event" CTA. The buyer leaves the flow without any prompt to install the app.
- **What it should do:** Surface a "Download Mingla to join your trip/event chat" CTA card with platform-detection (App Store badge on iOS Safari, Play Store badge on Android Chrome, fallback dual-badge on desktop), linking to the universal link `https://usemingla.com/orders/{orderId}/chat` (or similar) that post-install resumes to the auto-created group chat.
- **Causal chain:** Without this CTA, anon-web buyers are unaware the consumer-app group chat exists. Email CTA alone is insufficient (operator instruction: web AND email).
- **Verification:** Grep returned zero hits; subagent confirmed by reading full file.

### §3.5 🔴 Root finding — `app.json` universal-link config + `deepLinkService.ts` do NOT handle the chat-resume deep link

- **File + line:** `app-mobile/app.json` lines 30-65 only declare associated domains `applinks:usemingla.com` and intent filter pathPrefixes `/invite` + `/board`. Missing: `/orders/{orderId}/chat`, `/chat/<conv>`, or the ORCH-0898 SPEC §3.2 format `mingla://chat/<conv>?type=group&eventId=<e>`.
- **`deepLinkService.ts` lines 27-94:** Existing `mingla://` paths enumerated; no `chat/<conv>` branch.
- **What it does today:** A user who taps the email or web CTA deep-link is routed to an unhandled URL → app likely opens to the Home tab (default fallback).
- **What it should do:** Add `/orders/{orderId}/chat` (and/or `/chat/<conv>`) handler that:
  1. Persists the requested target if user is in pre-auth state
  2. Post-auth + post-onboarding, navigates to the group chat via existing `messagingService.getOrCreateGroupConversationForEvent(eventId)` (new — see §3.2)
- **Causal chain:** Without this routing, the CTA → install → "join my trip chat" flow breaks at the deep-link step.
- **Verification:** Subagent read of `deepLinkService.ts` confirms absence of chat-resume paths.

### §3.6 🟠 Contributing finding — Chat header has NO subheader/banner space

- **File + line:** `app-mobile/src/components/MessageInterface.tsx` lines 1018-1114 = header; line 1115+ = message list. No vertical banner space.
- **What it does today:** Header height = `safeInsets.top + 8 + chrome height`. Message list begins immediately after.
- **What it should do (per operator scope C):** New thin banner component slotted between header and message list, ~32-40pt tall, sticky-position, shows "{N} days until {trip.name}" / "Today" on day-of / hides post-end (`now > event.end_at + 1d` or equivalent).
- **Causal chain:** Without architectural space for the banner, slotting it later adds shift-by-banner-height layout disturbance in every chat scroll.
- **Verification:** Subagent read of `MessageInterface.tsx`.

### §3.7 🟠 Contributing finding — No business-app component renders chat messages today

- **File:** `mingla-business/src/components/` — grep for `MessageBubble`, `chat`, `conversation` returns marketing/composer-related files only. No consumer-style chat reader exists in business app.
- **What it does today:** Business app has no chat surface. Operators today only have email/SMS broadcast.
- **What it should do:** New `GroupChatTile.tsx` (or whatever name implementor chooses) renders inside the trip page action grid + event page action grid. Tapping it opens a panel (or new screen) with the chat surface: message list + composer + moderation controls (broadcast-only toggle, member list with remove action, message delete swipe).
- **Causal chain:** Operator scope (A) requires planner-side chat. None of the chat UI primitives currently live in `mingla-business/src/components/`.
- **Verification:** Grep + subagent inventory of `mingla-business/src/components/marketing/`.

### §3.8 🟠 Contributing finding — No order-confirmation hook fires `auto-create group conversation` today

- **File + line:** `biz_ticket_checkout_finalize` RPC in `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` lines ~2150-2240. Tickets created (line ~2175); notifications queued (line ~2215); session marked completed (line ~2235). NO chat creation.
- **What it does today:** Trip / event purchase confirms → tickets generated → emails queued. No group chat side-effect.
- **What it should do:** Inside the same RPC (idempotent, FOR UPDATE-serialized), AFTER ticket creation and BEFORE notification queue:
  1. Lookup or create the `conversations` row for the event_id with `linked_entity_type='trip'` (or `'event'` per §3.3 recommendation), `is_broadcast_only=false` (defaults), `name=events.name`, `created_by=events.brand_team_member` (or NULL for system-created).
  2. Insert `conversation_participants` row for `buyer_user_id` (when non-null — auth'd buyer).
  3. For anon buyers (buyer_user_id IS NULL): defer participant-add until post-install auth claim (a separate edge function `claim-pending-trip-chat-participation` invoked after onboarding completes, gated on a `pending_trip_chat_claims` link table — see SPEC §3 §5.5).
- **Causal chain:** Without this hook, the consumer app shows the trip chat as empty for the buyer because they're not in the roster. Auto-add by trigger fails for anon buyers (no user id yet).
- **Verification:** Subagent read of finalize RPC body.

### §3.9 🟡 Hidden flaw — Anon-buyer `auth.users` row state is uncertain

- **Context:** Operator's open Q2 asked whether `conversation_participants` supports server-side bulk-add when a user has an `auth.users` row but no consumer-app install. The deeper question: does the anon-web buyer have an `auth.users` row at all post-checkout?
- **File + line:** `orders.buyer_user_id` is nullable (`supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`). `orders.buyer_email` is nullable text.
- **What it implies:** Anon-web buyers may have NO `auth.users` row at the moment of order confirmation. Their `auth.users` row is created later when they download the app and sign in with the same email (or new account). The link from old `orders.buyer_email` → new `auth.users.id` requires an explicit claim flow.
- **Recommendation:** New table `pending_trip_chat_claims (id, event_id, buyer_email, claim_token, created_at, claimed_at, claimed_by_user_id)` written at order-confirmation time. Consumer-app post-onboarding queries `pending_trip_chat_claims WHERE buyer_email = auth.email() AND claimed_at IS NULL` and adds the new user_id to the corresponding conversation_participants row + marks claim as claimed.
- **Verification:** Subagent inspection of `orders` schema in baseline migration; absence of claim table in current schema.

### §3.10 🟡 Hidden flaw — Tickets tab integration for trips is structurally identical but not user-tested in this audit

- **Context:** Operator's open Q3 asked whether trip-purchase creates a ticket row in the consumer-app Tickets tab today.
- **Evidence:** `biz_ticket_checkout_finalize` RPC creates `tickets` rows identically for `event_type='event'` and `event_type='trip'` (no fork). Consumer app's CalendarTab.tsx (where Tickets are folded per ORCH-0842) queries via `useBusinessEventOrders()` hook + `useTicketsRealtimeSubscription()`. The discriminated union row type at lines 61-64 names both `calendar` and `ticket` kinds.
- **Risk:** Without sim repro (exempt for this code audit per dispatch §1), we can't 100% confirm trip tickets RENDER in the Tickets section. They INSERT identically; render is probable but not proven.
- **Recommendation:** Implementor's test plan must include a synthetic trip-purchase → tickets-tab visibility check. SPEC §5.11 T-09 will require this.

### §3.11 🔵 Observation — `events.event_type` has THREE values, not two

- **File:** `supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql` line 34: `CHECK (event_type IN ('event', 'experience', 'trip'))`.
- **What it means:** ORCH-0826 introduced a third discriminator `'experience'` that operator's scope did NOT enumerate. ORCH-0897 should explicitly exclude `'experience'` to avoid surprising auto-creation of group chats for experience purchases (if experiences sell tickets at all — TBD).
- **Recommendation:** Scope ORCH-0897 to `event_type IN ('event', 'trip')` only. Flag `event_type='experience'` as a deliberate non-goal in the SPEC; register Discovery DISC-0897-1 for follow-up.
- **Verification:** Migration grep.

### §3.12 🔵 Observation — `marketing_audiences.query_definition.event_id` already supports trip targeting

- **File + line:** `mingla-business/src/services/marketing/marketingCampaignService.ts` lines 291-336 — `ensureEventBuyersAudience` accepts an event_id with no event_type discriminator. `marketing_audiences` schema CHECK permits `query_definition.kind IN ('brand_buyers', 'event_buyers', 'brand_followers', 'custom_segment')`.
- **Why this matters:** When ORCH-0897 extends `marketing-send` to fan out into chat, the existing audience-resolution path needs ZERO changes for the chat destination — just iterate the resolved recipient list (or the resolved conversation row) and write into it. The destination is per-campaign (single chat per campaign because audience is event_id-scoped); no per-recipient chat write.
- **Implication:** Blast → chat is ONE `messages` row insert per campaign (not per recipient). The recipients still get emails individually (per `marketing_messages` row), but the chat sees ONE blast message that all recipients can read.

### §3.13 🔵 Observation — Substrate trigger fires on `collaboration_sessions` INSERT, NOT on `events` INSERT

- **File + line:** `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` lines 184-187 — `CREATE TRIGGER ensure_group_conversation_on_session_create AFTER INSERT ON public.collaboration_sessions`.
- **Implication:** A parallel trigger is needed on `events` INSERT (gated on `event_type IN ('event', 'trip')`) to auto-create the trip/event group chat at trip-publish time. This pre-creates the conversation BEFORE the first buyer confirms, ensuring the chat exists when the first ticket is sold and is ready for participant inserts on order confirmation.
- **Alternative:** Lazy-create the conversation on first order confirmation inside `biz_ticket_checkout_finalize`. Tradeoff: trigger-based pre-create simplifies the finalize RPC; lazy-create avoids empty conversations for events that never sell. **Recommend trigger** for simplicity + alignment with ORCH-0898 pattern.

### §3.14 🔵 Observation — `pinned-card` UI primitive does not exist in consumer app

- **Files:** `app-mobile/src/components/chat/` (12 files) + `app-mobile/src/components/discussion/` (5 files). Grep for `pinned`, `Pinned`, `sticky`, `StickyBanner` returns no matches.
- **Implication:** The slim countdown banner (operator scope C) is a NEW primitive. Lives alongside existing chat components. Component name suggestion: `TripCountdownBanner.tsx` — placed in `app-mobile/src/components/chat/`.

### §3.15 🔵 Observation — `notify-message` edge function already supports the unified `message` type

- **File + line:** `supabase/functions/notify-message/index.ts` (v156 live; verified via subagent MCP). Canonical types: `message` + `message_mention`. Legacy aliases preserved with `console.warn`.
- **Implication:** When `marketing-send` writes a chat message into the trip/event group chat, the existing push-fan-out for the message INSERT will fire naturally (no notify-message extension needed). One write = email (via marketing-send) + chat message + push (via notify-message reacting to the message INSERT). All three channels delivered.

---

## §4 AUDIT proof matrix (A1..A12 with proven/probable/suspected status)

| # | Claim | Status | Evidence |
|---|---|---|---|
| **A1** | ORCH-0898 migration `20260624000000_orch_0898_unified_chat_substrate.sql` shipped on remote | **PROVEN** | Subagent confirmed via `mcp__supabase__list_migrations` |
| **A2** | `conversations.event_id` column exists, nullable, FK to `events(id)` ON DELETE CASCADE | **PROVEN** | Migration line 23-24; subagent `information_schema.columns` query confirms LIVE |
| **A3** | `conversations.linked_entity_type` enum includes `'trip'` value; **NOT** `'event'` value | **PROVEN** | Migration line 38 `CHECK (linked_entity_type IN ('direct', 'session', 'trip'))`; subagent MCP `pg_get_constraintdef` confirms verbatim |
| **A4** | `conversations_linked_entity_coherent` CHECK constrains `linked_entity_type='trip'` to `event_id IS NOT NULL AND session_id IS NULL` | **PROVEN** | Migration line 50-54; subagent confirmed live constraint |
| **A5** | `messages_broadcast_only_enforcement` is `AS RESTRICTIVE` INSERT policy with both `NOT EXISTS (broadcast-only block)` + `OR EXISTS (brand_team_members bypass)` branches | **PROVEN** | Migration line 328-354; subagent MCP query `permissive='RESTRICTIVE'` confirmed |
| **A6** | `brand_team_members` active-membership predicate (`accepted_at IS NOT NULL AND removed_at IS NULL`) is canonical | **PROVEN** | Subagent confirmed both columns nullable, present, used in migration RLS policies |
| **A7** | Existing Blasts tile entry path `mingla-business/app/event/[id]/blasts/index.tsx` + trip page routes to same endpoint | **PROVEN** | Trip page line 370-371 `router.push(\`/event/${trip.id}/blasts\`)`; verified via grep |
| **A8** | `marketing-send` edge function: POST, email-only Phase A (SMS/RCS throw `not_yet_enabled`), writes to `marketing_messages` (not `conversations`), idempotent via `mkt_claim_campaigns(p_limit, p_campaign_id)` FOR UPDATE SKIP LOCKED RPC | **PROVEN** | Subagent read full file + verified `grep "conversations\|messages " supabase/functions/marketing-send/index.ts` returned only `marketing_messages` matches |
| **A9** | Order-confirmation pipeline: Stripe webhook → `stripeWebhookRouter` → `biz_ticket_checkout_finalize` RPC. `payment_status='paid'` hardcoded at INSERT. Tickets created + notifications queued inside same RPC | **PROVEN** | Subagent read finalize RPC body in `20260515000013_orch_0777_ticket_checkout_core.sql` |
| **A10** | Consumer app Tickets are folded into CalendarTab.tsx (ORCH-0842); trip + event tickets INSERTed identically; render parity probable but unverified by sim | **PROBABLE** | Subagent read CalendarTab.tsx hook surface; ticket render path inferred from discriminated union row type lines 61-64 — sim repro exempt for code audit |
| **A11** | Universal/deep-link handling: `app.json` declares `applinks:usemingla.com` + intent filter pathPrefixes `/invite` + `/board`. `deepLinkService.ts` enumerates 13 `mingla://` paths, NONE of which match `chat/<conv>` or `orders/<id>/chat`. Post-install chat-resume = NOT IMPLEMENTED | **PROVEN** | Subagent read `app.json` + `deepLinkService.ts` end-to-end |
| **A12** | Existing collab-session onboarding screen = `OnboardingCollaborationStep.tsx` (833 lines). Rendered at onboarding step 6 (`useOnboardingStateMachine.ts` line 17: `6: ['collaborations']`). Renders `pendingInvites` from `useSessionManagement()` hook. Tap-to-join, not auto-join | **PROVEN** | Subagent read full component + hook; line numbers verified |

**Verdict on substrate readiness for ORCH-0897 inheritance:**

- `event_id` FK ✅ live
- `is_broadcast_only` ✅ live, default false
- `is_enabled` ✅ live, default true
- `name` ✅ live, required for groups
- `messages_broadcast_only_enforcement` RESTRICTIVE policy ✅ live (already keys on `linked_entity_type='trip'`)
- `conversations_brand_team_member_read` ✅ live (already keys on `linked_entity_type='trip'`)
- `messages_brand_team_member_read` ✅ live

**The ONE schema gap for ORCH-0897:** the `'event'` value for `linked_entity_type` (current enum is direct/session/trip). Recommended SPEC choice = extend the enum + coherence CHECK + RLS policies (4-branch form) to accept `'event'`. Or accept the alternative (reuse `'trip'` for both) with a note in the migration comment. SPEC §3 will pick (a).

---

## §5 Five-layer cross-check

| Layer | Question | Finding |
|---|---|---|
| **Docs** | What does ORCH-0898 SPEC say about trip group chats? | SPEC §3.1 anticipates Tr6 inheritance via `linked_entity_type='trip'` — explicit. SPEC was written 2026-05-20, lands Tr6 on this substrate, but does NOT spec the trip-publish trigger, blast→chat wiring, or web CTA. Those are this ORCH's scope. |
| **Schema** | What does the live DB enforce? | All ORCH-0898 schema is live. The single delta needed for ORCH-0897: extend `linked_entity_type` enum to add `'event'`. All other prerequisites satisfied. |
| **Code** | What does the live code do? | `marketing-send` does NOT write to chat. `messagingService.getOrCreateGroupConversationForEvent` does NOT exist. Consumer-app onboarding does NOT surface pending trip chats. Web confirmation has NO download CTA. `deepLinkService` does NOT route chat URLs. Business-app has NO chat surface. ALL of these are new code. |
| **Runtime** | Sim-verified? | Out of scope (code audit only). Sim repro deferred to TEST mode after implementation. |
| **Data** | What's in the DB? | Subagent MCP queries confirm columns + policies live. No pre-existing trip group chats in the wild (operator confirmed pre-build state). |

**No layer contradicts another.** ORCH-0898 substrate is clean and ready; ORCH-0897 is fresh work on top.

---

## §6 Blast radius map

| Surface | Code touched | Risk |
|---|---|---|
| **Consumer iOS + Android** (`app-mobile/`) | `messagingService` (+1 function), `deepLinkService` (+1 path), `OnboardingCollaborationStep` (extension), new `TripCountdownBanner.tsx`, new `MessageInterface` wrap to slot banner | Medium — touches onboarding (high-traffic path); regression risk on existing collab onboarding flow |
| **Business iOS + Android + web-preview** (`mingla-business/`) | new `GroupChatTile.tsx` + chat panel + moderation controls, trip page action grid +1 tile, event page action grid +1 tile, web confirmation +1 CTA card | Medium — first chat surface in business app; risk concentrated in new code, not in existing surfaces |
| **Buyer anon-web** | web confirmation page CTA, email template CTA | Low — additive cards, no behavior change |
| **Backend** | One migration (linked_entity_type enum extension + coherence + 2 new RLS extensions), `events` INSERT trigger, `biz_ticket_checkout_finalize` RPC extension (post-ticket-create chat create+roster), `pending_trip_chat_claims` table + `claim-pending-trip-chat-participation` edge function, `marketing-send` extension (+1 `messages` insert per send), new RLS policies for event-typed conversations | Medium-High — RLS extensions need a critical security test (cross-trip/cross-event read = 0 rows), finalize RPC is the most-trafficked write path |
| **Admin web** | NOT in scope | None |

**Solo + collab parity:** N/A — this is a group-chat feature; "solo" doesn't apply.

**Cache state:** consumer app's `messagingService.getConversations` already returns group conversations (ORCH-0898 wired this). No cache invalidation gaps expected.

**Invariants potentially affected:**
- **I-PROPOSED-CHAT-SUBSTRATE-UNIFIED** — preserved (no new chat tables)
- **I-PROPOSED-CHAT-RLS-INLINE-EXISTS** — preserved (new RLS extensions use inline EXISTS)
- **I-PROPOSED-CHAT-PERMISSIVE-TIGHTEN** — preserved (broadcast-only enforcement extends RESTRICTIVE policy)
- **I-PROPOSED-CHAT-BACKFILL-ASSERT** — N/A (no data backfill in ORCH-0897)
- **I-PROPOSED-CREATOR-ENTRY-IS-INSTANT** (mingla-business) — preserved (new action tile is just a button; chat panel loads lazily on tap)

---

## §7 Invariant violations

None new from this investigation. All ORCH-0898 invariants extend cleanly. ORCH-0897 will ratify ONE new invariant DRAFT:

- **I-PROPOSED-BLAST-CHAT-IDEMPOTENT** (DRAFT — flips ACTIVE on ORCH-0897 close): blast→chat writes MUST be idempotent per `(campaign_id, conversation_id)`. Same blast sent twice writes exactly ONE `messages` row. Enforced via UNIQUE partial index on `messages (conversation_id, marketing_campaign_id) WHERE marketing_campaign_id IS NOT NULL`. SPEC §3 picks the column name; recommend `messages.marketing_campaign_id uuid NULL` plus the UNIQUE partial index.

---

## §8 Fix strategy (direction only — not a spec, not code)

The SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md` codifies the strategy below. High-level direction:

1. **Database layer (one migration):**
   - Extend `linked_entity_type` enum to add `'event'`; extend `conversations_linked_entity_coherent` CHECK to 4-branch form; extend `conversations_brand_team_member_read` + `messages_brand_team_member_read` + `messages_broadcast_only_enforcement` RLS to handle both `'trip'` AND `'event'` linked types via `linked_entity_type IN ('trip', 'event')` predicate
   - Add `messages.marketing_campaign_id uuid NULL` column + UNIQUE partial index for blast idempotency
   - Add `pending_trip_chat_claims` table for anon-buyer post-install claim flow
   - Add `auto_create_event_group_chat` trigger on `events` AFTER INSERT (gated on `event_type IN ('event', 'trip')`)
   - Update `biz_ticket_checkout_finalize` RPC to add buyer to chat roster (auth'd) OR write `pending_trip_chat_claims` row (anon)

2. **Edge function layer:**
   - Extend `marketing-send` to (a) lookup or auto-create the chat for the audience's event_id, (b) write one `messages` row per campaign attributed to the campaign creator (planner), (c) use `marketing_campaign_id` UNIQUE for idempotency
   - New edge function `claim-pending-trip-chat-participation` invoked by consumer app post-onboarding

3. **Service layer (consumer app):**
   - Add `messagingService.getOrCreateGroupConversationForEvent(eventId)` (lookup-only sibling of session variant)
   - Add `messagingService.fetchPendingChatClaims()` for the onboarding step + `claimPendingTripChats(claimToken)` invocation

4. **Service layer (business app):**
   - New `mingla-business/src/services/groupChatService.ts`: `getEventGroupChat(eventId)`, `postMessage(conversationId, content)`, `setBroadcastOnly(conversationId, bool)`, `removeParticipant(conversationId, userId)`, `deleteMessage(messageId)`

5. **Hook layer (consumer app):**
   - Extend `useOnboardingStateMachine` step 6 to also surface pending trip-chat claims (not new substep — same step)
   - New `useTripCountdown(eventId)` for the slim banner

6. **Hook layer (business app):**
   - New `useEventGroupChat(eventId)` powering the Group Chat tile read; new `useEventGroupChatModeration(eventId)` for the moderation actions

7. **Component layer (consumer app):**
   - New `TripCountdownBanner.tsx` slotted in `MessageInterface.tsx` for trip-linked conversations
   - Extend `OnboardingCollaborationStep.tsx` to surface pending trip-chat-claim items alongside existing pending session invites

8. **Component layer (business app):**
   - New `GroupChatTile.tsx` placed in the action grids of both trip and event pages
   - New `GroupChatPanel.tsx` opens on tile tap (modal or full-screen — implementor's call) with message list + composer + moderation controls

9. **Component layer (mingla-business web):**
   - New `DownloadMinglaCta.tsx` card on `mingla-business/app/checkout/[eventId]/confirm.tsx`

10. **Email template:**
    - Add CTA section to `supabase/functions/_shared/email/ticketBody.ts` body composition (after calendar links, before sign-off)

11. **Deep links:**
    - Add `/orders/{orderId}/chat` universal-link handler in `app.json` + `deepLinkService.ts`

---

## §9 Regression prevention

| Risk | Mitigation |
|---|---|
| Marketing-send blast writes duplicate `messages` rows on retry | UNIQUE partial index on `messages (conversation_id, marketing_campaign_id) WHERE marketing_campaign_id IS NOT NULL` + ON CONFLICT DO NOTHING in marketing-send |
| Anon-buyer never claims pending chat participation (orphaned `pending_trip_chat_claims`) | Operator-facing dashboard count + cleanup ORCH after 30-day retention |
| Cross-trip/cross-event read leak via RLS bug | Critical security test in adversarial check: independent attempt to SELECT from another trip's conversation → 0 rows |
| Onboarding step 6 regression from extension | Implementor regression test (Step 0.5 happy-path) MUST include "step 6 with no pending chat claims still renders correctly" + "step 6 with pending claims renders both invites and claims" |
| `biz_ticket_checkout_finalize` RPC slowdown from chat-create-on-confirm | Trigger-based pre-create (at events INSERT) keeps the finalize RPC at insert-roster-row complexity, not create-conversation-row complexity |
| Web download CTA breaks at install → claim flow | E2E test in adversarial check: web confirmation CTA → mock install → app open → onboarding step 6 surfaces claim → tap join → conversation row + participant row present |

---

## §10 Discoveries for orchestrator (carried forward)

| # | Discovery | Severity | Recommendation |
|---|---|---|---|
| **DISC-0897-1** | `events.event_type='experience'` is the third discriminator value in the ORCH-0826 enum but operator scope did not enumerate it. Operator should decide: do experience-type events get group chats too, or are they explicitly out? | P3 | Register follow-up ORCH if operator wants experiences included; otherwise lock SPEC to `event_type IN ('event', 'trip')` only |
| **DISC-0897-2** | Anon-buyer post-install identity-claim flow (the `pending_trip_chat_claims` table) is novel for Mingla. Other places in the product may benefit from the same mechanism (e.g., post-anon-checkout community features in future ORCHs). | P4 | Note in SPEC for future-reuse signal |
| **DISC-0897-3** | `marketing-send` currently has no Phase B (SMS) live. When SMS lands, blast → SMS + chat fan-out wiring must follow the same idempotency pattern. | P3 | Forward-reference in SPEC §15 follow-ups |
| **DISC-0897-4** | `ConnectionsPage.tsx` (which renders chat list items) was modified by ORCH-0898 with `type='group'` branch + multi-avatar render. Tests should verify trip/event group chats appear correctly there with the right name (events.name) and the right avatar set (planner + buyers). | P3 | SPEC §5.11 includes test case |
| **DISC-0897-5** | The original Tr6 milestone's `trip_documents` storage bucket is OUT of ORCH-0897 scope per operator. The milestone document `Mingla_Artifacts/milestones/Tr6_DISCUSSION_BOARD.md` should be marked SUPERSEDED with a cross-reference to ORCH-0897 + ORCH-0898. | P4 | Orchestrator updates milestone doc at CLOSE |
| **DISC-0897-6** | The web confirmation CTA → universal link → consumer-app post-install resume flow is novel. iOS Associated Domains setup may need a fresh apple-app-site-association deployment to handle the `/orders/{orderId}/chat` path. | P2 | Implementor verifies AASA deploy step; if missing, this becomes a P1 finding at TEST |
| **DISC-0897-7** | `getOrCreateGroupConversationForEvent` does not exist. Tr6's original SPEC anticipated needing it (per ORCH-0898 SPEC §3.1 trip branch). The sibling pattern is clear; implementor scope is well-defined. | P4 | No follow-up; specced |

---

## §11 Confidence level

**Overall:** HIGH. Source-only investigation is acceptable for this scope per dispatch §1 (code-audit-only mode + no UI/runtime bug under investigation). The substrate (ORCH-0898) is fully shipped + independently verified by ORCH-0898 QA + this investigation's MCP audit (§4 A1-A12). The new work (operator scope A-F) sits on top of proven infrastructure with one schema enum extension and well-scoped per-layer additions.

**Per-finding confidence:**
- §3.1 (marketing-send NO chat write): **PROVEN** (grep + full subagent read of edge function source)
- §3.2 (getOrCreateGroupConversationForEvent absence): **PROVEN** (grep + manual read of messagingService.ts)
- §3.3 (enum needs `'event'` value): **PROVEN** (migration line 38 verbatim)
- §3.4 (web confirmation has NO Download Mingla): **PROVEN** (grep returned zero)
- §3.5 (deep-link handler absence): **PROVEN** (subagent read of deepLinkService + app.json)
- §3.6 (chat header no banner space): **PROVEN** (subagent line-by-line read of MessageInterface header)
- §3.7 (business-app no chat component): **PROVEN** (component inventory grep)
- §3.8 (no chat-create hook in finalize RPC): **PROVEN** (subagent read of RPC body)
- §3.9 (anon-buyer claim flow novel): **PROBABLE** (inferred from orders.buyer_user_id nullability + no existing claim table)
- §3.10 (trip ticket render in Tickets tab): **PROBABLE** (insert path identical; render path inferred from CalendarTab union type)
- §3.11 (event_type 3 values): **PROVEN** (ORCH-0826 migration grep)
- §3.12-§3.15: **PROVEN** (subagent + grep)

No `suspected`-level findings exist in this investigation. No item is held back for runtime verification because the investigation is source-only by design.

---

## §12 Layman summary

This is the third group-chat ORCH in 2 weeks. ORCH-0898 shipped the unified chat substrate (`conversations`+`messages`) — that's done and verified. ORCH-0897 (Tr6 + events) adds three pieces on top: (1) auto-create a group chat for every trip OR event when the first ticket is sold, with the right buyers added (auth'd buyers automatically; anon-web buyers via a post-install claim flow), (2) a new "Group Chat" tile on the business-app trip page AND event page so planners can read/reply/moderate from their dashboard, (3) wiring the existing Blasts pipeline to ALSO write into the new group chat (not just email — blasts become a single "broadcast message" the planner can also see in the chat). Plus three smaller pieces: a slim countdown banner under the chat header, a "Download Mingla" CTA on the web post-purchase page, and consumer-app onboarding surfacing the pending trip/event chat at step 6.

**Confidence:** HIGH. The substrate is already live. The new work is well-scoped (one migration, one trigger, one RPC extension, one edge-function extension, ~10 new components/hooks). The biggest risk is the anon-buyer claim flow — that's novel for Mingla and the SPEC must lock the claim-token security carefully.

**Next:** SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md` (companion to this investigation).
