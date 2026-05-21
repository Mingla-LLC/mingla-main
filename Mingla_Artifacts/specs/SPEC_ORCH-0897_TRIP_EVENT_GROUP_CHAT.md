# SPEC — ORCH-0897 [Trips + Events Group Chat — auto-created consumer-app collab session + business-app Group Chat tile + blast→chat wiring]

**Skill:** Claude `mingla-forensics` — SPEC mode (companion to `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21
**Substrate parent:** ORCH-0898 [Consumer collab session → Friends-tab group chat] — CLOSED PASS 2026-05-21
**Competitive differentiation reference:** `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` §7 — Tr6 group chat is one of two flagship WeTravel-parity wins

---

## §1 Scope + Non-Goals

### §1.1 IN scope

A. **Business-app "Group Chat" tile** — new component placed inside the action grids of `mingla-business/app/trip/[id]/index.tsx` AND `mingla-business/app/event/[id]/index.tsx`. Tap → opens chat surface with all confirmed buyers. Planner can (a) read, (b) reply, (c) moderate (toggle broadcast-only, remove participant, delete message).

B. **Consumer-app auto-created group chat** — `conversations` row of `type='group'` + `linked_entity_type IN ('trip', 'event')` + `event_id=<event.id>` created on `events` INSERT (gated on `event_type IN ('event', 'trip')`); buyers auto-added to roster on order confirmation (auth'd buyers immediately; anon-web buyers via post-install claim flow).

C. **Slim countdown banner** — new `TripCountdownBanner.tsx` slotted between chat header and message list in `MessageInterface.tsx` for conversations with `linked_entity_type IN ('trip', 'event')`. Renders days until `events.start_at`; "Today" on day-of; hides post-end.

D. **Web post-purchase "Download Mingla" CTA** — new `DownloadMinglaCta.tsx` card on `mingla-business/app/checkout/[eventId]/confirm.tsx`. Universal-link target `https://usemingla.com/orders/<orderId>/chat` resumes the consumer-app onboarding flow with the order's chat claim attached.

E. **Consumer-app onboarding surfacing** — extend existing `OnboardingCollaborationStep.tsx` (step 6) to surface pending trip/event chat claims alongside existing pending session invites. No new step, no new screen.

F. **Blast → chat wiring (extension)** — `marketing-send` edge function: when a campaign targets an event audience (`marketing_audiences.query_definition.kind IN ('event_buyers')` with event_id), ALSO write ONE `messages` row into the event's group chat (planner-voice; no new message_type), idempotent per `(marketing_campaigns.id, conversations.id)` via a new partial UNIQUE index.

### §1.2 OUT of scope (cited from INVESTIGATION §1; do NOT spec these)

- New chat-message tables (`event_threads`, etc.) — Tr6 milestone §3 superseded
- New blast composer — existing composer ships unchanged
- Trip Documents tab + `trip_documents` storage bucket — deferred to later cycle
- Ari summarization — deferred
- Admin-web moderation surface — deferred
- `event_type='experience'` auto-create — explicit non-goal; flagged as DISC-0897-1 for operator decision

### §1.3 Assumptions

- ORCH-0898 substrate (`conversations`+`messages`) is fully live + verified per INVESTIGATION §4 A1-A12
- `events.event_type IN ('event', 'experience', 'trip')` per ORCH-0826 — this SPEC scopes to `('event', 'trip')` only
- `biz_ticket_checkout_finalize` RPC is the single canonical order-confirmation hook (no out-of-band confirmation flows)
- Resend is the email transport (no template-engine swap)
- iOS Associated Domains (`apple-app-site-association`) deployment is operator-owned; SPEC §7 lists this as an operator step

---

## §2 Cross-Surface Impact (MANDATORY per Phase 2.5)

### §2.1 Consumer iOS

**User-visible behaviour:**
- New group chat appears in Friends-tab chats list for every event/trip they bought a ticket to (auto-added on order confirmation OR via post-install claim flow)
- Tapping a trip/event group chat opens it with the new slim countdown banner above the message list ("3 days until Tulum Wellness Retreat")
- During onboarding step 6 (collaborations), pending trip/event chat claims appear alongside existing pending session invites — one tap to join
- Web-confirmation-CTA deep link (`/orders/<id>/chat`) post-install resumes to the corresponding group chat

**File paths touched:**
- `app-mobile/src/services/messagingService.ts` (+1 function `getOrCreateGroupConversationForEvent`)
- `app-mobile/src/services/deepLinkService.ts` (+1 path branch `/orders/<id>/chat` and `mingla://chat/<conv>?type=group&eventId=<e>`)
- `app-mobile/app.json` (+1 intent filter pathPrefix `/orders`; +1 universal link pattern in associated domains config)
- `app-mobile/app/_layout.tsx` + `app-mobile/app/index.tsx` (+ deep-link routing for chat-resume)
- `app-mobile/src/hooks/useOnboardingStateMachine.ts` (no change to step structure; the existing step 6 substep handles the new claim surface via hook extension only)
- NEW `app-mobile/src/components/chat/TripCountdownBanner.tsx`
- `app-mobile/src/components/MessageInterface.tsx` (slot banner under header for trip/event conversations)
- `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` (extend to surface pending trip/event chat claims via new hook)
- NEW `app-mobile/src/hooks/useTripCountdown.ts`
- NEW `app-mobile/src/hooks/usePendingTripChatClaims.ts`

**Parity:** automatic with Android (shared RN code path).

### §2.2 Consumer Android

Same user-visible behaviour as iOS. Same file paths. Parity is automatic (shared RN code path). The `app.json` Android `intentFilters` need an additional entry for the new pathPrefix; this is a JSON-only addition in the same config block already touched by iOS Associated Domains.

### §2.3 Business iOS

**User-visible behaviour:**
- New tile labeled "Group Chat" in the action grid of every trip page (`/trip/[id]`) AND every event page (`/event/[id]`)
- Tapping opens a chat panel showing the conversation with all buyers, planner-side composer, and a "..." moderation menu (toggle broadcast-only, member list with remove-action, message delete via swipe)
- Blast sent from the existing Blasts tile shows up as a planner-voice message in the chat

**File paths touched:**
- `mingla-business/app/trip/[id]/index.tsx` — insert new `<ActionTile icon="message-circle" label="Group chat" />` between Marketing blasts and Edit trip in the action grid (line 351-379)
- `mingla-business/app/event/[id]/index.tsx` — insert new `<ActionTile icon="message-circle" label="Group chat" />` between Blasts and Public page in the action grid (line 655-713)
- NEW `mingla-business/app/event/[id]/group-chat.tsx` (the chat panel route — handles both trip and event since trip routes flow through `/event/{trip.id}/*` already per existing convention)
- NEW `mingla-business/src/components/groupChat/GroupChatPanel.tsx` (message list + composer + moderation menu)
- NEW `mingla-business/src/components/groupChat/GroupChatModerationSheet.tsx` (broadcast-only toggle + member list with remove action)
- NEW `mingla-business/src/services/groupChatService.ts`
- NEW `mingla-business/src/hooks/useEventGroupChat.ts`
- NEW `mingla-business/src/hooks/useEventGroupChatModeration.ts`

**Parity:** automatic with Android (shared RN code path) + manual for business-web-preview (same component tree; SmartScrollView already enforced per I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY).

### §2.4 Business Android

Same as iOS. Parity automatic (shared RN code).

### §2.5 Business Web preview

Same component tree as iOS/Android. Verify chat panel renders correctly in web preview (responsive layout already covered by existing SmartScrollView wrapper).

### §2.6 Buyer anon-web

**User-visible behaviour:**
- Post-Stripe-success confirmation page (`/checkout/[eventId]/confirm.tsx`) shows a new "Download Mingla to join your trip/event chat" card with App Store badge + Play Store badge + dismiss button
- Confirmation email (Resend HTML body) contains the same CTA section after the calendar links

**File paths touched:**
- `mingla-business/app/checkout/[eventId]/confirm.tsx` — insert `<DownloadMinglaCta />` between TicketQrCarousel and "Back to event" CTA
- NEW `mingla-business/src/components/checkout/DownloadMinglaCta.tsx`
- `supabase/functions/_shared/email/ticketBody.ts` — add new CTA section between calendar links and email close (lines 186-187)

**Parity:** N/A — buyer-anon-web is a single surface.

### §2.7 Surfaces NOT in scope

- **Admin web (`mingla-admin/`)** — no moderation surface in this ORCH; admin views of group chats deferred to follow-up if needed
- **Consumer-app for non-buyer collab sessions** — ORCH-0898 already handles consumer collab session group chats; this ORCH extends to trip/event-linked variants only

### §2.8 Manual parity success criteria (per Phase 2.5 rule)

Surfaces 2.1+2.2 (consumer iOS/Android): shared code → automatic parity → ONE success criterion per consumer requirement.

Surfaces 2.3+2.4+2.5 (business iOS/Android/web): shared code → automatic parity → ONE success criterion per business requirement.

Surface 2.6 (buyer-anon-web): standalone → ONE success criterion.

No surface-specific code paths require per-platform SC splits.

---

## §3 Database layer

### §3.1 New migration

**File:** `supabase/migrations/20260703000000_orch_0897_trip_event_group_chat.sql`

**Filename rationale:** strictly greater than current head `20260702000000_orch_0908_chat_card_tags.sql`. Per memory `feedback_orchestrator_deploys_edge_functions.md` and ORCH-implementor standing constraint, monotonic timestamps are required.

### §3.2 Step 1 — Extend `linked_entity_type` enum to add `'event'`

```sql
-- Drop the existing CHECK (idempotent guard via NOT EXISTS check).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_type_check') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_type_check;
  END IF;
END;
$$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct', 'session', 'trip', 'event'));

-- Replace the coherence CHECK with 4-branch form.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_coherent') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_coherent;
  END IF;
END;
$$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
    (linked_entity_type = 'direct' AND session_id IS NULL AND event_id IS NULL)
    OR (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL)
    OR (linked_entity_type = 'trip' AND event_id IS NOT NULL AND session_id IS NULL)
    OR (linked_entity_type = 'event' AND event_id IS NOT NULL AND session_id IS NULL)
  );
```

### §3.3 Step 2 — Add `messages.marketing_campaign_id` for blast idempotency

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS marketing_campaign_id uuid NULL
    REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_blast_per_conversation
  ON public.messages (conversation_id, marketing_campaign_id)
  WHERE marketing_campaign_id IS NOT NULL;

COMMENT ON COLUMN public.messages.marketing_campaign_id IS
  'ORCH-0897: when a marketing-send blast writes into a trip/event group chat, this column carries the campaign_id for idempotency. UNIQUE partial index enforces one-blast-per-campaign-per-conversation. NULL for normal in-app chat messages.';
```

### §3.4 Step 3 — `pending_trip_chat_claims` table (anon-buyer post-install claim)

```sql
CREATE TABLE IF NOT EXISTS public.pending_trip_chat_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_email text NOT NULL,
  claim_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  claimed_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX pending_trip_chat_claims_buyer_email_unclaimed
  ON public.pending_trip_chat_claims (lower(buyer_email))
  WHERE claimed_at IS NULL;

ALTER TABLE public.pending_trip_chat_claims ENABLE ROW LEVEL SECURITY;

-- Service-role only writes; consumer-app reads via the new claim edge function (service-role).
-- No user-side RLS policies — claim flow uses edge function as bouncer.
COMMENT ON TABLE public.pending_trip_chat_claims IS
  'ORCH-0897: anon-web buyer post-install identity-claim. Written by biz_ticket_checkout_finalize when orders.buyer_user_id IS NULL. Claimed by claim-pending-trip-chat-participation edge function after consumer-app onboarding completes. claim_token is a 32-char random for the deep-link URL.';
```

### §3.5 Step 4 — Auto-create-event-group-chat trigger

```sql
CREATE OR REPLACE FUNCTION public.ensure_group_conversation_on_event_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_event_name text;
  v_linked_type text;
  v_creator_id uuid;
BEGIN
  -- Only fire for event_type IN ('event', 'trip'); explicitly skip 'experience' and any future values.
  IF NEW.event_type NOT IN ('event', 'trip') THEN
    RETURN NEW;
  END IF;

  v_event_name := COALESCE(NULLIF(trim(NEW.name), ''), 'Trip chat');
  v_linked_type := CASE NEW.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END;

  -- Resolve creator: pick the brand's first owner/admin team member as creator (fallback to NULL).
  SELECT btm.user_id INTO v_creator_id
  FROM public.brand_team_members btm
  WHERE btm.brand_id = NEW.brand_id
    AND btm.accepted_at IS NOT NULL
    AND btm.removed_at IS NULL
  ORDER BY btm.invited_at ASC
  LIMIT 1;

  INSERT INTO public.conversations (
    type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', v_linked_type, NEW.id, v_event_name, v_creator_id, true, false
  )
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;

  -- Add the creator as the first participant (idempotent).
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id FROM public.conversations
    WHERE event_id = NEW.id AND linked_entity_type IN ('trip', 'event');
  END IF;

  IF v_conv_id IS NOT NULL AND v_creator_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, v_creator_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_group_conversation_on_event_create() IS
  'ORCH-0897: AFTER INSERT trigger on events (gated on event_type IN (event, trip)). Atomically creates the group conversation + adds the brand''s first team-member as creator. SECURITY DEFINER for RLS bypass. Idempotent via partial UNIQUE on event_id.';

DROP TRIGGER IF EXISTS ensure_group_conversation_on_event_create ON public.events;
CREATE TRIGGER ensure_group_conversation_on_event_create
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_group_conversation_on_event_create();
```

### §3.6 Step 5 — `add_buyer_to_event_chat` helper called by `biz_ticket_checkout_finalize` extension

```sql
CREATE OR REPLACE FUNCTION public.add_buyer_to_event_chat(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_order_id uuid,
  p_buyer_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_claim_token text;
BEGIN
  -- Locate the auto-created group conversation for this event.
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE event_id = p_event_id
    AND linked_entity_type IN ('trip', 'event');

  -- If conversation doesn't exist yet (edge case: pre-trigger event), lazy-create.
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      type, linked_entity_type, event_id, name, is_enabled, is_broadcast_only
    )
    SELECT
      'group',
      CASE e.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END,
      e.id,
      COALESCE(NULLIF(trim(e.name), ''), 'Trip chat'),
      true,
      false
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.event_type IN ('event', 'trip')
    RETURNING id INTO v_conv_id;
  END IF;

  IF v_conv_id IS NULL THEN
    RETURN; -- Event is not chat-eligible (e.g., event_type='experience').
  END IF;

  -- Auth'd buyer: add directly to roster.
  IF p_buyer_user_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, p_buyer_user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    RETURN;
  END IF;

  -- Anon buyer: write pending claim row.
  IF p_buyer_email IS NOT NULL AND length(trim(p_buyer_email)) > 0 THEN
    v_claim_token := encode(gen_random_bytes(24), 'base64url');
    INSERT INTO public.pending_trip_chat_claims (
      order_id, event_id, buyer_email, claim_token
    ) VALUES (
      p_order_id, p_event_id, lower(trim(p_buyer_email)), v_claim_token
    )
    ON CONFLICT (claim_token) DO NOTHING;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.add_buyer_to_event_chat IS
  'ORCH-0897: called inside biz_ticket_checkout_finalize after ticket creation. Adds auth''d buyer to conversation_participants directly; writes pending_trip_chat_claims for anon buyers. Idempotent.';
```

### §3.7 Step 6 — Extend `biz_ticket_checkout_finalize` RPC

The implementor reads the current finalize RPC at `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` lines ~2150-2240 and applies a non-disruptive extension AFTER ticket creation (line ~2210 in that migration), BEFORE notification queue (line ~2215):

```sql
-- After ticket loop, before notification queue.
PERFORM public.add_buyer_to_event_chat(
  v_session.event_id,
  v_session.buyer_user_id,
  v_order_id,
  v_session.buyer_email
);
```

**Implementation note:** the extension must be ADDED as a new migration with `CREATE OR REPLACE FUNCTION biz_ticket_checkout_finalize(...)` — the entire function body replicated with the new PERFORM line added at the right position. The implementor copies the existing function definition verbatim and inserts the new line; no other changes.

### §3.8 Step 7 — Extend RLS policies for `event` linked type

The three existing RLS policies (`conversations_brand_team_member_read`, `messages_brand_team_member_read`, `messages_broadcast_only_enforcement`) currently key on `linked_entity_type='trip'`. ORCH-0897 extends each to handle both `'trip'` and `'event'`:

```sql
-- Replace conversations_brand_team_member_read.
DROP POLICY IF EXISTS conversations_brand_team_member_read ON public.conversations;
CREATE POLICY conversations_brand_team_member_read
  ON public.conversations
  FOR SELECT
  USING (
    linked_entity_type IN ('trip', 'event')
    AND event_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members btm
      JOIN public.events e ON e.brand_id = btm.brand_id
      WHERE e.id = conversations.event_id
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

-- Replace messages_brand_team_member_read.
DROP POLICY IF EXISTS messages_brand_team_member_read ON public.messages;
CREATE POLICY messages_brand_team_member_read
  ON public.messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND c.event_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.brand_team_members btm
          JOIN public.events e ON e.brand_id = btm.brand_id
          WHERE e.id = c.event_id
            AND btm.user_id = auth.uid()
            AND btm.accepted_at IS NOT NULL
            AND btm.removed_at IS NULL
        )
    )
  );

-- Replace messages_broadcast_only_enforcement (RESTRICTIVE).
DROP POLICY IF EXISTS messages_broadcast_only_enforcement ON public.messages;
CREATE POLICY messages_broadcast_only_enforcement
  ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND c.is_broadcast_only = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND c.is_broadcast_only = true
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );
```

### §3.9 Step 8 — Backfill conversations for existing trips + events

```sql
-- Backfill: for every events row where event_type IN ('event', 'trip') and NO conversations row exists,
-- create one. Idempotent.
INSERT INTO public.conversations (
  type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only, created_at, updated_at
)
SELECT
  'group',
  CASE e.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END,
  e.id,
  COALESCE(NULLIF(trim(e.name), ''), 'Trip chat'),
  (SELECT btm.user_id FROM public.brand_team_members btm
    WHERE btm.brand_id = e.brand_id AND btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL
    ORDER BY btm.invited_at ASC LIMIT 1),
  true,
  false,
  e.created_at,
  e.updated_at
FROM public.events e
WHERE e.event_type IN ('event', 'trip')
  AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.event_id = e.id AND c.linked_entity_type IN ('trip', 'event')
  );

-- Backfill participants from existing orders.
INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT DISTINCT c.id, o.buyer_user_id
FROM public.orders o
JOIN public.conversations c ON c.event_id = o.event_id AND c.linked_entity_type IN ('trip', 'event')
WHERE o.buyer_user_id IS NOT NULL
  AND o.payment_status IN ('paid', 'partial_refund')
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Row-count assertion (RAISE EXCEPTION on mismatch per I-PROPOSED-CHAT-BACKFILL-ASSERT).
DO $$
DECLARE
  v_expected bigint;
  v_actual bigint;
BEGIN
  SELECT COUNT(*) INTO v_expected
  FROM public.events e
  WHERE e.event_type IN ('event', 'trip');

  SELECT COUNT(*) INTO v_actual
  FROM public.conversations c
  WHERE c.linked_entity_type IN ('trip', 'event');

  IF v_actual < v_expected THEN
    RAISE EXCEPTION 'ORCH-0897 backfill row-count mismatch: events(event/trip)=%, conversations(trip/event)=%, missing=%',
      v_expected, v_actual, v_expected - v_actual;
  END IF;

  RAISE NOTICE 'ORCH-0897 backfill OK: events=% → conversations=%.', v_expected, v_actual;
END;
$$;
```

---

## §4 Edge function layer

### §4.1 `marketing-send` extension

**File:** `supabase/functions/marketing-send/index.ts`
**Change:** add `writeBlastIntoEventChat()` helper, called after `sendEmail()` for `email_buyers` audience kind.

```typescript
async function writeBlastIntoEventChat(
  supabase: SupabaseClient,
  campaign: MarketingCampaign,
  audience: MarketingAudience
): Promise<void> {
  // Skip if audience is not event-scoped.
  const eventId = audience.query_definition?.event_id;
  if (!eventId) return;

  // Lookup the trip/event group conversation.
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('event_id', eventId)
    .in('linked_entity_type', ['trip', 'event'])
    .maybeSingle();

  if (convErr || !conv) {
    console.warn(`[ORCH-0897] marketing-send: no group chat for event_id=${eventId}; skipping chat fan-out`);
    return;
  }

  // Resolve sender (campaign creator = planner).
  const senderId = campaign.created_by;
  if (!senderId) {
    console.warn(`[ORCH-0897] marketing-send: campaign ${campaign.id} has no created_by; skipping chat fan-out`);
    return;
  }

  // Idempotent insert via UNIQUE partial index.
  const content = `📢 ${campaign.name}\n\n${campaign.channel_payload.body_preview ?? campaign.channel_payload.body ?? ''}`;
  const { error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conv.id,
      sender_id: senderId,
      content,
      message_type: 'text',
      marketing_campaign_id: campaign.id,
    });

  if (msgErr && !msgErr.message?.includes('messages_unique_blast_per_conversation')) {
    console.error(`[ORCH-0897] marketing-send chat fan-out failed: ${msgErr.message}`);
    // Non-fatal: email already sent; chat fan-out is a best-effort enhancement.
  }
}
```

**Insertion point:** called after the `sendEmail` loop completes, with `(supabase, campaign, audience)`. ONE call per campaign (not per recipient).

**Auth:** the existing edge-function auth (service-role for cron, user JWT for direct send) is sufficient. The chat write bypasses RLS via service-role.

**Note:** when SMS lands (Phase B), `writeBlastIntoEventChat()` is called ONCE per campaign regardless of how many channels fire — it's a per-campaign chat insert.

### §4.2 NEW edge function: `claim-pending-trip-chat-participation`

**File:** `supabase/functions/claim-pending-trip-chat-participation/index.ts`
**HTTP method + route:** POST `/functions/v1/claim-pending-trip-chat-participation`
**Auth:** user JWT (`verify_jwt: true`)
**Request schema:** `{ claim_token?: string }` (optional — when present, claim by token; when absent, claim by `auth.email()`)
**Response schema:** `{ claimed: Array<{ conversation_id: string; event_id: string; event_name: string }>; count: number }`

**Behavior:**
1. Resolve `auth.uid()` from JWT. Fail with 401 if missing.
2. Build candidate set:
   - If `claim_token` present: `SELECT * FROM pending_trip_chat_claims WHERE claim_token = $1 AND claimed_at IS NULL LIMIT 1`
   - If `claim_token` absent: `SELECT * FROM pending_trip_chat_claims WHERE lower(buyer_email) = lower(auth.email()) AND claimed_at IS NULL`
3. For each candidate row:
   a. INSERT into `conversation_participants (conversation_id, user_id)` via service-role; resolve `conversation_id` by `SELECT id FROM conversations WHERE event_id = $1 AND linked_entity_type IN ('trip', 'event')`
   b. UPDATE `pending_trip_chat_claims SET claimed_at = now(), claimed_by_user_id = auth.uid() WHERE id = $1`
4. Return summary.

**Idempotency:** safe to call multiple times — `INSERT ... ON CONFLICT DO NOTHING` on conversation_participants + `claimed_at NULL` filter on candidates.

### §4.3 `notify-message` — NO change

The existing `notify-message` edge function (v156 live) already fires push for any new `messages` row regardless of source (chat reply or blast). No extension needed.

---

## §5 Service layer (consumer app)

### §5.1 `messagingService.getOrCreateGroupConversationForEvent`

**File:** `app-mobile/src/services/messagingService.ts`
**Signature:**
```typescript
async getOrCreateGroupConversationForEvent(
  eventId: string,
): Promise<{ conversation: Conversation | null; error: string | null }>
```

**Body:** mirror of `getOrCreateGroupConversationForSession` lines 869-907 with these changes:
- `.eq('session_id', sessionId)` → `.eq('event_id', eventId)`
- `.eq('linked_entity_type', 'session')` → `.in('linked_entity_type', ['trip', 'event'])`
- error message string: `'Group conversation not found for this event'`

**Return type:** same `Conversation` type as the session variant.

### §5.2 `messagingService.fetchPendingChatClaims` + `claimPendingTripChats`

Two new public functions:

```typescript
async fetchPendingChatClaims(): Promise<{ claims: Array<{ event_id: string; event_name: string; cover_url?: string | null }>; error: string | null }>;
async claimPendingTripChats(claimToken?: string): Promise<{ claimed: number; conversations: Array<{ conversation_id: string; event_id: string; event_name: string }>; error: string | null }>;
```

`fetchPendingChatClaims` reads pending claims for the current user via the new edge function (returns ZERO unless the user has unclaimed buys). `claimPendingTripChats` invokes the `claim-pending-trip-chat-participation` edge function.

---

## §6 Service layer (business app)

### §6.1 NEW `mingla-business/src/services/groupChatService.ts`

```typescript
export async function getEventGroupChat(eventId: string): Promise<{
  conversation: { id: string; name: string; is_broadcast_only: boolean; is_enabled: boolean } | null;
  error: string | null;
}>;

export async function postPlannerMessage(conversationId: string, content: string): Promise<{ messageId: string | null; error: string | null }>;

export async function listMessages(conversationId: string, limit?: number): Promise<{ messages: Array<{ id: string; sender_id: string | null; content: string; created_at: string; marketing_campaign_id: string | null }>; error: string | null }>;

export async function listParticipants(conversationId: string): Promise<{ participants: Array<{ user_id: string; display_name: string; avatar_url: string | null; joined_at: string }>; error: string | null }>;

export async function setBroadcastOnly(conversationId: string, isBroadcastOnly: boolean): Promise<{ error: string | null }>;

export async function removeParticipant(conversationId: string, userId: string): Promise<{ error: string | null }>;

export async function deleteMessage(messageId: string): Promise<{ error: string | null }>;
```

All functions use the standard `supabase` client (RLS-bound; the planner is auth'd via `brand_team_members` predicate which the ORCH-0898 RLS policies already cover).

---

## §7 Hook layer

### §7.1 Consumer app

**NEW `app-mobile/src/hooks/useTripCountdown.ts`:**
```typescript
export function useTripCountdown(eventId: string | null): {
  days: number | null;
  status: 'upcoming' | 'today' | 'past' | 'unknown';
  eventName: string | null;
}
```

Computes `Math.ceil((event.start_at - now) / 86400000)`. Null-safe.

**NEW `app-mobile/src/hooks/usePendingTripChatClaims.ts`:**
```typescript
export function usePendingTripChatClaims(): {
  claims: Array<{ event_id: string; event_name: string; cover_url?: string | null }>;
  loading: boolean;
  claim: (claimToken?: string) => Promise<{ claimed: number; conversations: Array<{ conversation_id: string; event_id: string; event_name: string }> }>;
}
```

Wraps `messagingService.fetchPendingChatClaims` + `claimPendingTripChats`.

### §7.2 Business app

**NEW `mingla-business/src/hooks/useEventGroupChat.ts`:**
```typescript
export function useEventGroupChat(eventId: string): {
  conversation: { id: string; name: string; is_broadcast_only: boolean; is_enabled: boolean } | null;
  messages: Array<{ id: string; sender_id: string | null; content: string; created_at: string; marketing_campaign_id: string | null }>;
  loading: boolean;
  refresh: () => Promise<void>;
  postMessage: (content: string) => Promise<{ messageId: string | null; error: string | null }>;
}
```

Subscribes to realtime channel `conversation:${conversationId}` (matches consumer-app naming for unified push surface).

**NEW `mingla-business/src/hooks/useEventGroupChatModeration.ts`:**
```typescript
export function useEventGroupChatModeration(conversationId: string): {
  participants: Array<{ user_id: string; display_name: string; avatar_url: string | null; joined_at: string }>;
  loading: boolean;
  setBroadcastOnly: (value: boolean) => Promise<{ error: string | null }>;
  removeParticipant: (userId: string) => Promise<{ error: string | null }>;
  deleteMessage: (messageId: string) => Promise<{ error: string | null }>;
}
```

---

## §8 Component layer

### §8.1 NEW `app-mobile/src/components/chat/TripCountdownBanner.tsx`

**Props:**
```typescript
interface TripCountdownBannerProps {
  eventId: string;
}
```

**Behavior:**
- Uses `useTripCountdown(eventId)`. Renders nothing (returns null) when `status === 'unknown'` or `status === 'past'`.
- Renders a thin row (~36pt tall) with countdown copy and event name.
- Copy: `"{days} day{s ? '' : 's'} until {eventName}"` for upcoming; `"Today is {eventName}!"` for day-of.
- Style: matches existing chat header tokens (no new design tokens introduced).
- Accessibility: `accessibilityRole="text"`, `accessibilityLabel` covers the countdown copy.

### §8.2 `app-mobile/src/components/MessageInterface.tsx` — slot the banner

In the header section (lines 1018-1114), AFTER `</View>` of `headerTopRow`, BEFORE the message list begins, conditionally render:
```tsx
{conversation.linked_entity_type === 'trip' || conversation.linked_entity_type === 'event' ? (
  <TripCountdownBanner eventId={conversation.event_id ?? ''} />
) : null}
```

The `event_id` is already part of the `conversation` data per the ORCH-0898 schema.

### §8.3 `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` — extend

Add a new section between the existing "Pending collaboration invites" section (lines 447-530) and the empty state:
```tsx
{pendingClaims.length > 0 && (
  <View style={styles.pendingClaimsSection}>
    <Text style={styles.sectionLabel}>Your trip & event chats</Text>
    {pendingClaims.map((claim) => (
      <View key={claim.event_id} style={styles.claimCard}>
        <Text style={styles.claimTitle}>{claim.event_name}</Text>
        <TouchableOpacity onPress={() => handleClaimTap(claim)}>
          <Text style={styles.joinButton}>Join chat</Text>
        </TouchableOpacity>
      </View>
    ))}
  </View>
)}
```

Wire `pendingClaims` from `usePendingTripChatClaims()`. `handleClaimTap` calls `claim(undefined)` to claim ALL pending by email + navigates to the corresponding chat on success.

### §8.4 NEW `mingla-business/src/components/groupChat/GroupChatPanel.tsx`

**Layout:**
- Header bar: event name + "..." moderation menu button + close/back button
- Message list: vertical scroll, planner messages right-aligned in brand-color, buyer messages left-aligned, avatars on left for buyers, system row for blasts (gray italic centered)
- Composer: text input + send button at bottom, disabled with notice when `is_broadcast_only=true` and… wait no, planner is brand_team_member so they can always send. Composer is always enabled for planner.

**Props:** `{ eventId: string; }`

**Hooks used:** `useEventGroupChat(eventId)`, `useEventGroupChatModeration(conversation?.id)`

### §8.5 NEW `mingla-business/src/components/groupChat/GroupChatModerationSheet.tsx`

Bottom sheet (uses existing Sheet primitive). Sections:
- **Broadcast-only toggle** — switch component, `value=conversation.is_broadcast_only`
- **Member list** — list of `participants` from `useEventGroupChatModeration`; each row shows avatar + name + swipe-action "Remove from chat"
- **(Below member list)** copy explaining what broadcast-only does ("When on, only your team can post. Buyers can still read.")

### §8.6 NEW `mingla-business/app/event/[id]/group-chat.tsx`

Thin route wrapper:
```tsx
export default function EventGroupChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <GroupChatPanel eventId={id} />;
}
```

### §8.7 Trip page + event page — insert Group Chat tile

**Trip page** (`mingla-business/app/trip/[id]/index.tsx` line 351-379 — action grid):
Insert as 4th tile (after Marketing blasts, before Edit trip):
```tsx
<ActionTile
  icon="message-circle"
  label="Group chat"
  onPress={() => router.push(`/event/${trip.id}/group-chat` as never)}
/>
```

**Event page** (`mingla-business/app/event/[id]/index.tsx` line 655-713 — action grid):
Insert after the Blasts ActionTile (around line 686):
```tsx
<ActionTile
  icon="message-circle"
  label="Group chat"
  sub="Read + reply + moderate"
  onPress={() => router.push(`/event/${event.id}/group-chat` as never)}
/>
```

### §8.8 NEW `mingla-business/src/components/checkout/DownloadMinglaCta.tsx`

**Layout:** glass card, headline "Join your trip/event chat in the Mingla app", subhead "Get updates, ask questions, message other travelers", App Store badge (left) + Google Play badge (right), dismiss button bottom-right.

**Props:** `{ orderId: string; eventName: string; eventType: 'event' | 'trip'; }`

**Deep-link:** badge taps go to `https://usemingla.com/orders/${orderId}/chat` (universal link). Platform detection via `navigator.userAgent` selects the right store URL fallback.

### §8.9 Web confirmation page — slot the CTA

`mingla-business/app/checkout/[eventId]/confirm.tsx`: insert `<DownloadMinglaCta orderId={...} eventName={...} eventType={...} />` between the TicketQrCarousel and the "Back to event" CTA.

---

## §9 Email template

`supabase/functions/_shared/email/ticketBody.ts` — add a new section between calendar links and email close:

```typescript
function renderDownloadAppCta(orderId: string, eventType: 'event' | 'trip'): string {
  const noun = eventType === 'trip' ? 'trip' : 'event';
  return `
    <div style="margin-top:32px;padding:24px;background:#FFF5EC;border-radius:12px;border:1px solid #FFD9B8;text-align:center;">
      <p style="margin:0;font-size:15px;color:#6B5A47;">Join your ${noun} chat in the Mingla app</p>
      <a href="https://usemingla.com/orders/${orderId}/chat"
         style="display:inline-block;margin-top:12px;padding:12px 24px;background:#FF7A2F;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Open in Mingla
      </a>
    </div>
  `;
}
```

Insert into the body composition AFTER `${renderCalendarSection(input)}` (line 186 in current ticketBody.ts).

---

## §10 Deep-link routing

### §10.1 `app-mobile/app.json`

Add to `ios.associatedDomains`: no change (already `applinks:usemingla.com`).
Add to `android.intentFilters[0].data`:
```json
{ "scheme": "https", "host": "usemingla.com", "pathPrefix": "/orders" },
{ "scheme": "https", "host": "usemingla.com", "pathPrefix": "/chat" }
```

### §10.2 iOS Associated Domain file

Operator-owned: `apple-app-site-association` at `https://usemingla.com/.well-known/apple-app-site-association` must include `/orders/*/chat` and `/chat/*` paths. Lists as operator step §13.

### §10.3 `app-mobile/src/services/deepLinkService.ts`

Add new path branches in `parseDeepLink()`:

```typescript
// mingla://chat/<conv>?type=group&eventId=<e>
if (pathParts[0] === 'chat' && pathParts[1]) {
  return {
    action: 'open_event_chat',
    conversationId: pathParts[1],
    eventId: params.eventId ?? null,
    chatType: params.type ?? 'group',
  };
}

// Universal link variant: /orders/<orderId>/chat
if (pathParts[0] === 'orders' && pathParts[1] && pathParts[2] === 'chat') {
  return {
    action: 'claim_and_open_chat',
    orderId: pathParts[1],
    claimToken: params.token ?? null,
  };
}
```

### §10.4 Deep-link consumer in `app-mobile/app/index.tsx`

`executeDeepLink()` (lines 466-473) adds handlers:
- `open_event_chat`: call `messagingService.getOrCreateGroupConversationForEvent(eventId)` → navigate to chat
- `claim_and_open_chat`: if not auth'd, stash in `pendingDeepLinkRef` and resume after sign-in/onboarding. If auth'd, call `claimPendingTripChats(claimToken)` then navigate to the first returned conversation.

---

## §11 Success criteria

Each criterion is observable + testable + unambiguous.

**Consumer chat substrate (per surface 2.1+2.2 — shared code; one SC each):**

| SC | Criterion |
|---|---|
| SC-01 | After a buyer confirms a ticket (auth'd) for an event with `event_type IN ('event', 'trip')`, the corresponding `conversations` row exists with `linked_entity_type IN ('trip', 'event')` and `conversation_participants` includes the buyer's `user_id`. |
| SC-02 | Anon-web buyer (`orders.buyer_user_id IS NULL`) results in a `pending_trip_chat_claims` row with `claim_token` populated. |
| SC-03 | `messagingService.getConversations(userId)` returns the new trip/event group chat in the result set; `ConnectionsPage` renders it with the event name + multi-avatar fan. |
| SC-04 | Opening the trip/event group chat from Friends-tab renders the `TripCountdownBanner` at the top showing days until the event start. Banner is null-safe (hides when start_at is unparseable or in the past). |
| SC-05 | During consumer-app onboarding step 6 (`['collaborations']`), pending trip/event chat claims appear as "Join chat" cards. Tapping "Join chat" successfully adds the user to `conversation_participants` and navigates to the chat. |
| SC-06 | Deep link `mingla://chat/<conv>?type=group&eventId=<e>` opens the conversation. Universal link `https://usemingla.com/orders/<id>/chat` resumes onboarding when not auth'd; after auth, claims and opens the chat. |

**Business chat surface (per surface 2.3+2.4+2.5 — shared code; one SC each):**

| SC | Criterion |
|---|---|
| SC-07 | "Group Chat" tile appears in the action grid on both `mingla-business/app/trip/[id]/index.tsx` and `mingla-business/app/event/[id]/index.tsx`. |
| SC-08 | Tapping the tile opens `GroupChatPanel` showing the full message history. |
| SC-09 | Planner-sent message posts as a regular message attributed to the planner (sender_id = planner user id). Buyers see the message in their consumer-app chat in realtime. |
| SC-10 | Planner moderation: toggle `is_broadcast_only` ON → buyer subsequent INSERT attempts fail with RLS error (verified via INSERT smoke). Toggle OFF → buyer INSERT succeeds. |
| SC-11 | Planner moderation: remove participant → corresponding `conversation_participants` row deleted; removed user's subsequent SELECT returns zero rows from this conversation. |
| SC-12 | Planner moderation: delete message → `messages.deleted_at` set; consumer app stops rendering that message. |

**Buyer-anon-web (surface 2.6 — standalone):**

| SC | Criterion |
|---|---|
| SC-13 | `DownloadMinglaCta` card renders on `mingla-business/app/checkout/[eventId]/confirm.tsx` between the QR carousel and "Back to event" CTA. App Store + Play Store badges link to the respective store. |
| SC-14 | Confirmation email contains the "Join your trip/event chat" CTA section after the calendar links. CTA button links to `https://usemingla.com/orders/{orderId}/chat`. |

**Blast → chat wiring:**

| SC | Criterion |
|---|---|
| SC-15 | When a campaign with `audience.query_definition.kind='event_buyers'` sends, ONE `messages` row is inserted into the trip/event group chat with `marketing_campaign_id` set to the campaign id and `sender_id` = campaign creator (planner). |
| SC-16 | Same blast fired twice (e.g., retry on transient failure) writes EXACTLY ONE chat message row — UNIQUE partial index `messages_unique_blast_per_conversation` enforces idempotency. |
| SC-17 | Blast → chat write failure is non-fatal — email continues to fire to all recipients regardless. |

**Critical security:**

| SC | Criterion |
|---|---|
| **SC-CRITICAL-SECURITY** | Cross-trip + cross-event read attempts from an unrelated user return ZERO rows. Independent test required: synthesize User A in Brand X's Event Y, User B in Brand Z's Event W, attempt User B → User A's conversation SELECT → expect 0 rows. Repeat for messages SELECT. |

---

## §12 Invariants

### §12.1 Inherited (preserved)

- **I-PROPOSED-CHAT-SUBSTRATE-UNIFIED** (ACTIVE post-ORCH-0902): no new chat-message tables — preserved (this ORCH adds rows to `conversations`+`messages` only)
- **I-PROPOSED-CHAT-RLS-INLINE-EXISTS** (ACTIVE post-ORCH-0902): no SECURITY DEFINER helpers in SELECT policies — preserved (all new RLS policies use inline EXISTS)
- **I-PROPOSED-CHAT-PERMISSIVE-TIGHTEN** (ACTIVE post-ORCH-0902): legacy permissive policies must be DROPped not just renamed — preserved (this ORCH only extends existing policies via DROP+CREATE)
- **I-PROPOSED-CHAT-BACKFILL-ASSERT** (ACTIVE post-ORCH-0902): data migrations row-count via RAISE EXCEPTION — preserved (§3.9 backfill uses RAISE EXCEPTION on mismatch)
- **I-PROPOSED-CREATOR-ENTRY-IS-INSTANT** (business app): new action tile is a button that pushes a lazy route; chat panel fetch happens on tile tap, not on page mount — preserved

### §12.2 NEW (DRAFT — flips ACTIVE on ORCH-0897 close)

- **I-PROPOSED-BLAST-CHAT-IDEMPOTENT** — blast → chat writes MUST be idempotent per `(conversation_id, marketing_campaign_id)`. Enforced via the new partial UNIQUE index `messages_unique_blast_per_conversation`. CI gate: tester adversarial verifies duplicate-send results in single chat row.

---

## §13 Test cases

### §13.1 Implementor regression test (Step 0.5 happy-path)

**File path:** `app-mobile/scripts/ci/orch-0897-regression-check.mjs`

| T-id | Scenario | Layer | Expected |
|---|---|---|---|
| T-01 | events INSERT with event_type='trip' fires trigger | Schema + Trigger | `conversations` row exists with `linked_entity_type='trip'`, `event_id=<trip.id>`, `name=trip.name` |
| T-02 | events INSERT with event_type='event' fires trigger | Schema + Trigger | `conversations` row exists with `linked_entity_type='event'`, `event_id=<event.id>` |
| T-03 | events INSERT with event_type='experience' does NOT fire trigger | Schema + Trigger | NO `conversations` row created |
| T-04 | biz_ticket_checkout_finalize for auth'd buyer adds to roster | RPC | `conversation_participants` row exists for `(conv, buyer_user_id)` |
| T-05 | biz_ticket_checkout_finalize for anon buyer writes pending_trip_chat_claims | RPC | `pending_trip_chat_claims` row exists with claim_token, claimed_at=NULL |
| T-06 | claim edge function called by auth'd user with claim_token completes claim | Edge function | `conversation_participants` row exists; `pending_trip_chat_claims.claimed_at` set |
| T-07 | marketing-send writes ONE messages row per campaign | Edge function | After send completes, ONE `messages` row with `marketing_campaign_id=campaign.id` |
| T-08 | RLS policy permits brand_team_member to SELECT event-typed conversation | RLS | Brand team member SELECT returns row |
| T-09 | RLS broadcast-only enforcement blocks buyer INSERT when is_broadcast_only=true | RLS | Non-team-member INSERT fails with policy violation |
| T-10 | trip ticket appears in consumer-app Tickets section | UI | `useBusinessEventOrders` returns trip purchase |
| T-11 | `getOrCreateGroupConversationForEvent` returns correct row | Service | Function returns conversation matching event_id |
| T-12 | `TripCountdownBanner` renders for trip-linked conversation | UI | Banner visible with days count |
| T-13 | Onboarding step 6 surfaces pending trip chat claims | UI | Claim cards render alongside session invites |
| T-14 | Web confirmation page renders DownloadMinglaCta | UI | CTA card visible between QR and back CTA |

**Fails-on-revert:** verify by stashing the new RPC `add_buyer_to_event_chat`, re-running — T-04 + T-05 must FAIL.

### §13.2 Tester adversarial regression test (Step 0.5)

**File path:** `app-mobile/scripts/ci/orch-0897-adversarial-check.mjs`

| TA-id | Attack angle | Expected |
|---|---|---|
| TA-01 | Cross-trip read attempt (User B SELECTs User A's trip conversation) | Returns ZERO rows |
| TA-02 | Cross-event read attempt (User B SELECTs User A's event conversation) | Returns ZERO rows |
| TA-03 | Buyer attempts broadcast-only INSERT bypass | Fails with RLS error |
| TA-04 | Same blast sent twice (concurrent retries) | EXACTLY ONE messages row inserted |
| TA-05 | Anon claim token reuse attempt (claim_token used twice) | Second attempt no-ops (claimed_at filter) |
| TA-06 | Claim by mismatched email | Returns ZERO claimed conversations |
| TA-07 | events INSERT with event_type='experience' attempts to trigger | NO conversation created |
| TA-08 | Non-team-member attempts moderation action (setBroadcastOnly) | Fails with RLS error |
| TA-09 | Removed brand_team_member attempts to read trip chat | Returns ZERO rows after `removed_at` set |
| TA-10 | Cancelled-order buyer attempts read after `payment_status` flips to refunded | Currently still has access — flag as DISC-0897-8 for follow-up (out of scope for this ORCH per operator: revocation-on-refund is a separate ORCH) |

**Fails-on-revert:** verify by stashing RLS extensions, re-running — TA-01 + TA-02 + TA-03 must FAIL (the unauthorized reads/writes succeed in pre-extension state).

---

## §14 Implementation order

1. **DB migration** (§3) — applied via `supabase db push --linked` by operator
2. **NEW edge function** `claim-pending-trip-chat-participation` (§4.2) — deployed by orchestrator
3. **`marketing-send` extension** (§4.1) — deployed by orchestrator
4. **Critical security test** (TA-01, TA-02 from §13.2) — run BEFORE any UI code; halt if cross-trip/cross-event leak detected
5. **Consumer service** `getOrCreateGroupConversationForEvent` + claim helpers (§5)
6. **Business service** `groupChatService.ts` (§6)
7. **Consumer hooks** `useTripCountdown` + `usePendingTripChatClaims` (§7.1)
8. **Business hooks** `useEventGroupChat` + `useEventGroupChatModeration` (§7.2)
9. **Consumer components**: `TripCountdownBanner`, `MessageInterface` banner slot, `OnboardingCollaborationStep` extension (§8.1, §8.2, §8.3)
10. **Business components**: `GroupChatPanel`, `GroupChatModerationSheet`, `event/[id]/group-chat.tsx` route, trip page tile, event page tile (§8.4-§8.7)
11. **Web checkout**: `DownloadMinglaCta` + slot on confirm page (§8.8, §8.9)
12. **Email template**: download CTA section (§9)
13. **Deep links**: `app.json` config, `deepLinkService.ts` path branches, `app/index.tsx` deep-link executor (§10)
14. **Implementor regression tests** (§13.1) — every file lands with its test
15. **Tester adversarial run** (§13.2) — independent
16. **Operator step:** publish updated `apple-app-site-association` to `https://usemingla.com/.well-known/`
17. **Sim smoke** (operator-driven; 6-step flow): anon-web buy → email open → CTA tap → install → onboard → join → blast received

---

## §15 Hard guards (verbatim from operator scope + investigation)

- (a) NO new chat-message tables — reuse `conversations`+`messages` per I-PROPOSED-CHAT-SUBSTRATE-UNIFIED
- (b) NO new blast composer — extend existing `marketing-send` to add chat as a destination
- (c) Blast → chat write MUST be idempotent per `(conversation_id, marketing_campaign_id)`
- (d) Trip AND event auto-create triggers MUST coexist — same `ensure_group_conversation_on_event_create` function with discriminator branching
- (e) Broadcast-only toggle gates buyer-side INSERT only (reads stay open) — RLS extension covers `linked_entity_type IN ('trip', 'event')` (§3.8)
- (f) Cross-trip + cross-event read isolation enforced via RLS inline EXISTS (NO SECURITY DEFINER helpers per I-PROPOSED-CHAT-RLS-INLINE-EXISTS)
- (g) `brand_team_members` active-membership predicate (`accepted_at IS NOT NULL AND removed_at IS NULL`)
- (h) Countdown banner null-safe when `start_at` is unparseable
- (i) Post-cancellation buyer (orders.status flips to refunded) loses chat access at next read — **DEFERRED to separate ORCH per operator** (DISC-0897-8 documented for follow-up; current scope leaves access intact even after refund — operator decision: a refund doesn't kick the buyer out of the chat retroactively)
- (j) Preserve I-PROPOSED-CREATOR-ENTRY-IS-INSTANT — business-app trip/event page entry must not slow down for the new tile (tile fetch is lazy on tap, not on page mount)
- (k) `event_type='experience'` is OUT of scope — trigger explicitly gates on `event_type IN ('event', 'trip')`
- (l) NO Documents tab + bucket (deferred), NO admin-web (deferred), NO Ari summarization (deferred)
- (m) Anon-buyer claim flow MUST use cryptographically random claim_token (24 bytes base64url = 32 chars)

---

## §16 Regression prevention

| Regression risk | Prevention |
|---|---|
| Blast duplicate writes on retry | UNIQUE partial index `messages_unique_blast_per_conversation` |
| Anon claim token replay | `claimed_at IS NULL` filter on candidate lookup |
| Onboarding step 6 break from extension | T-13 regression test + smoke check "step 6 with empty pending claims still renders" |
| Cross-trip RLS leak | TA-01 / TA-02 adversarial in CI |
| Business app trip/event page slow entry | Tile component performs zero queries on mount; data fetch is on tile tap |
| `add_buyer_to_event_chat` failure breaks order confirmation | Wrapped in PERFORM (no return); chat-create failure is logged but does not roll back the order. T-04 / T-05 verify happy path; explicit follow-up if chat create is mission-critical (currently best-effort) |
| Event with no team members → no creator → trigger crashes | Trigger handles `v_creator_id IS NULL` case gracefully (skip participant add, conversation still created) — see §3.5 |

**Append-only test enforcement:** all new test files under `app-mobile/scripts/ci/` are immutable post-merge per ORCH-0840 append-only CI workflow. The implementor's CLOSE commit body MUST include `[TEST-APPEND ORCH-0897]` if any test file is modified (rare; typically these tests are write-once).

---

## §17 Open follow-ups (carried forward to CLOSE)

| # | Item | Recommendation |
|---|---|---|
| DISC-0897-1 | `event_type='experience'` auto-create? | Operator decides; flagged in WORLD_MAP follow-up; if YES, becomes ORCH-0897-B (trivial — just adds 'experience' to the trigger gate) |
| DISC-0897-2 | Anon-buyer claim flow novel — future reuse signal | Note for product team |
| DISC-0897-3 | SMS blast → chat parity (when Phase B SMS lands) | Forward-reference: `writeBlastIntoEventChat()` is called once per campaign regardless of channel count; SMS just adds another channel to email + chat |
| DISC-0897-4 | `ConnectionsPage.tsx` trip/event chat list-item render verified during test | T-03 covers; no separate follow-up |
| DISC-0897-5 | Mark Tr6 milestone doc as SUPERSEDED | Orchestrator updates at CLOSE |
| DISC-0897-6 | iOS Associated Domain file update for `/orders/*/chat` path | Operator step at §14 #16 |
| DISC-0897-7 | `getOrCreateGroupConversationForEvent` shipped — spec'd | No follow-up |
| DISC-0897-8 | Refunded-order buyer access revocation | Deferred — register ORCH-0897-C if operator wants this; current behavior is "refund does not kick out of chat" (operator-confirmed) |
| DISC-0897-9 | Admin moderation surface (future) | Deferred; register if/when ops scaling needs it |
| DISC-0897-10 | Documents tab + `trip_documents` bucket (Tr6 §4 original scope) | Deferred — separate ORCH if/when operator wants it |

---

## §18 Layman summary

This SPEC delivers a per-trip + per-event group chat across both the consumer app and the business app, reusing the unified `conversations`+`messages` substrate ORCH-0898 already shipped. The only new database work is: one enum extension (add `'event'` to `linked_entity_type`), one new trigger (auto-create chat on event publish), one new helper RPC (`add_buyer_to_event_chat`), one new table (`pending_trip_chat_claims` for anon-buyer post-install identity claim), three RLS policy extensions, and one new column (`messages.marketing_campaign_id` for blast idempotency). Edge-function work is one new function (`claim-pending-trip-chat-participation`) and one extension to `marketing-send` (write blast as chat message). UI work spans both apps: business-app gets a new Group Chat tile on trip + event pages with a chat panel + moderation sheet; consumer-app gets a slim countdown banner under the chat header + extended onboarding step 6 to surface pending claims; mingla-business web gets a Download Mingla CTA on the confirmation page; trip + event confirmation emails get the same CTA. Critical security: cross-trip + cross-event RLS isolation independently verified. Implementation order leads with database + RLS + critical-security test, then services, then UI.

---

**Next handoff:** Implementor (Claude or Codex `mingla-implementor`) per Canonical Pipeline Routing.
