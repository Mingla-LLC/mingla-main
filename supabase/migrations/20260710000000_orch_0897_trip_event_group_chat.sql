-- ORCH-0897 [Trips + Events Group Chat]
--
-- Extends the ORCH-0898 unified conversations/messages substrate to trips
-- and events. This migration is operator-applied via `supabase db push`;
-- Codex must not apply it remotely.

-- Step 1: extend linked_entity_type to include event.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_type_check'
  ) THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_type_check;
  END IF;
END;
$$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct', 'session', 'trip', 'event'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_linked_entity_coherent'
  ) THEN
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

COMMENT ON COLUMN public.conversations.linked_entity_type IS
  'ORCH-0898/0897: discriminator — direct (no linkage), session (collab-session group), trip/event (buyer group chat for event rows).';

-- Step 2: blast-to-chat idempotency marker.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS marketing_campaign_id uuid NULL
    REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_blast_per_conversation
  ON public.messages (conversation_id, marketing_campaign_id)
  WHERE marketing_campaign_id IS NOT NULL;

COMMENT ON COLUMN public.messages.marketing_campaign_id IS
  'ORCH-0897: marketing-send blast chat fan-out idempotency key. One message per campaign per conversation; NULL for normal chat messages.';

-- Step 3: pending anon-buyer post-install claims.
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

CREATE INDEX IF NOT EXISTS pending_trip_chat_claims_buyer_email_unclaimed
  ON public.pending_trip_chat_claims (lower(buyer_email))
  WHERE claimed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pending_trip_chat_claims_order_unclaimed
  ON public.pending_trip_chat_claims (order_id)
  WHERE claimed_at IS NULL;

ALTER TABLE public.pending_trip_chat_claims ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pending_trip_chat_claims IS
  'ORCH-0897: anon-web buyer post-install chat claim. Written by order finalization and claimed through claim-pending-trip-chat-participation. Service-role only; no user RLS policies.';

-- Step 4: auto-create group conversations for event/trip rows only.
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
  IF NEW.event_type NOT IN ('event', 'trip') THEN
    RETURN NEW;
  END IF;

  v_event_name := COALESCE(NULLIF(trim(NEW.title), ''), 'Trip chat');
  v_linked_type := CASE NEW.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END;

  SELECT btm.user_id INTO v_creator_id
  FROM public.brand_team_members btm
  WHERE btm.brand_id = NEW.brand_id
    AND btm.accepted_at IS NOT NULL
    AND btm.removed_at IS NULL
  ORDER BY btm.invited_at ASC NULLS LAST
  LIMIT 1;

  INSERT INTO public.conversations (
    type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', v_linked_type, NEW.id, v_event_name, v_creator_id, true, false
  )
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;

  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE event_id = NEW.id
      AND linked_entity_type IN ('trip', 'event');
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
  'ORCH-0897: AFTER INSERT trigger on events, gated on event_type IN (event, trip). Creates buyer group chat and adds the first active brand team member when available.';

DROP TRIGGER IF EXISTS ensure_group_conversation_on_event_create ON public.events;
CREATE TRIGGER ensure_group_conversation_on_event_create
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_group_conversation_on_event_create();

-- Step 5: order finalization helper.
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
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE event_id = p_event_id
    AND linked_entity_type IN ('trip', 'event')
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      type, linked_entity_type, event_id, name, is_enabled, is_broadcast_only
    )
    SELECT
      'group',
      CASE e.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END,
      e.id,
      COALESCE(NULLIF(trim(e.title), ''), 'Trip chat'),
      true,
      false
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.event_type IN ('event', 'trip')
    ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
      SELECT id INTO v_conv_id
      FROM public.conversations
      WHERE event_id = p_event_id
        AND linked_entity_type IN ('trip', 'event')
      LIMIT 1;
    END IF;
  END IF;

  IF v_conv_id IS NULL THEN
    RETURN;
  END IF;

  IF p_buyer_user_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, p_buyer_user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    RETURN;
  END IF;

  IF p_buyer_email IS NOT NULL AND length(trim(p_buyer_email)) > 0 THEN
    -- Postgres encode() supports only base64/hex/escape; build base64url by translating + and / to URL-safe forms.
    -- 24 input bytes -> 32 char output, no '=' padding (24 % 3 == 0).
    v_claim_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
    INSERT INTO public.pending_trip_chat_claims (
      order_id, event_id, buyer_email, claim_token
    ) VALUES (
      p_order_id, p_event_id, lower(trim(p_buyer_email)), v_claim_token
    )
    ON CONFLICT (order_id) WHERE claimed_at IS NULL DO NOTHING;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.add_buyer_to_event_chat(uuid, uuid, uuid, text) IS
  'ORCH-0897: order-confirmation helper. Adds auth buyers directly to trip/event chat; writes pending claim for anon-web buyers.';

-- Step 6: replace latest biz_ticket_checkout_finalize definition with the
-- same body plus add_buyer_to_event_chat after ticket creation.
CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued'
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now,
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    IF p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    FOR i IN 1..v_item.quantity LOOP
      v_ticket_id := gen_random_uuid();
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      v_token_hash := public.biz_ticket_checkout_token_hash(v_token, v_qr_token_pepper);
      v_qr := public.biz_ticket_checkout_qr_payload(
        v_ticket_id,
        v_token_hash,
        v_qr_token_pepper
      );

      INSERT INTO public.tickets (
        id, order_id, ticket_type_id, event_id, attendee_name, attendee_email,
        attendee_phone, qr_code, qr_token_hash, status, approval_status, created_at,
        issued_at
      ) VALUES (
        v_ticket_id, v_order_id, v_item.ticket_type_id, v_session.event_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr, v_token_hash, 'valid', 'auto', v_now, v_now
      );

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid'
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued',
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid, text, text, text, text, text, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(
  uuid, text, text, text, text, text, text, boolean
) TO service_role;

-- Step 7: RLS policy extension for event-linked chats.
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

DROP POLICY IF EXISTS messages_brand_team_member_insert ON public.messages;
CREATE POLICY messages_brand_team_member_insert
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS conversation_participants_brand_team_member_read ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_team_member_read
  ON public.conversation_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = conversation_participants.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS conversations_brand_team_member_update ON public.conversations;
CREATE POLICY conversations_brand_team_member_update
  ON public.conversations
  FOR UPDATE
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
  )
  WITH CHECK (
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

DROP POLICY IF EXISTS conversation_participants_brand_team_member_delete ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_team_member_delete
  ON public.conversation_participants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = conversation_participants.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

DROP POLICY IF EXISTS messages_brand_team_member_update ON public.messages;
CREATE POLICY messages_brand_team_member_update
  ON public.messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.events e ON e.id = c.event_id
      JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
      WHERE c.id = messages.conversation_id
        AND c.linked_entity_type IN ('trip', 'event')
        AND btm.user_id = auth.uid()
        AND btm.accepted_at IS NOT NULL
        AND btm.removed_at IS NULL
    )
  );

-- Step 8: backfill eligible existing events, brand creators, auth buyer rosters,
-- and anon buyer claims.
INSERT INTO public.conversations (
  type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only, created_at, updated_at
)
SELECT
  'group',
  CASE e.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END,
  e.id,
  COALESCE(NULLIF(trim(e.title), ''), 'Trip chat'),
  (SELECT btm.user_id
   FROM public.brand_team_members btm
   WHERE btm.brand_id = e.brand_id
     AND btm.accepted_at IS NOT NULL
     AND btm.removed_at IS NULL
   ORDER BY btm.invited_at ASC NULLS LAST
   LIMIT 1),
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

INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT DISTINCT c.id, c.created_by
FROM public.conversations c
WHERE c.linked_entity_type IN ('trip', 'event')
  AND c.created_by IS NOT NULL
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT DISTINCT c.id, o.buyer_user_id
FROM public.orders o
JOIN public.conversations c
  ON c.event_id = o.event_id
 AND c.linked_entity_type IN ('trip', 'event')
WHERE o.buyer_user_id IS NOT NULL
  AND o.payment_status IN ('paid', 'partial_refund')
ON CONFLICT (conversation_id, user_id) DO NOTHING;

INSERT INTO public.pending_trip_chat_claims (order_id, event_id, buyer_email, claim_token)
SELECT DISTINCT o.id, o.event_id, lower(trim(o.buyer_email)), translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_')
FROM public.orders o
JOIN public.events e ON e.id = o.event_id
WHERE e.event_type IN ('event', 'trip')
  AND o.buyer_user_id IS NULL
  AND o.buyer_email IS NOT NULL
  AND length(trim(o.buyer_email)) > 0
  AND o.payment_status IN ('paid', 'partial_refund')
  AND NOT EXISTS (
    SELECT 1 FROM public.pending_trip_chat_claims p
    WHERE p.order_id = o.id AND p.claimed_at IS NULL
  )
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_expected bigint;
  v_actual bigint;
BEGIN
  SELECT COUNT(*) INTO v_expected
  FROM public.events e
  WHERE e.event_type IN ('event', 'trip');

  SELECT COUNT(*) INTO v_actual
  FROM public.events e
  WHERE e.event_type IN ('event', 'trip')
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.event_id = e.id
        AND c.linked_entity_type IN ('trip', 'event')
    );

  IF v_actual < v_expected THEN
    RAISE EXCEPTION 'ORCH-0897 backfill row-count mismatch: events(event/trip)=%, conversations=%',
      v_expected, v_actual;
  END IF;

  RAISE NOTICE 'ORCH-0897 backfill OK: eligible_events=%, conversations=%', v_expected, v_actual;
END;
$$;
