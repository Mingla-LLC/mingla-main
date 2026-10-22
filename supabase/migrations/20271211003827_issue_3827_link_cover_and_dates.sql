-- issue #3827 — private link page: video covers, and several dates per
-- guest-list sign-up on events that ask the guest to choose a date.
--
-- 1. pg_ticket_link_resolve adds coverMediaType and coverPosterUrl to the
--    event, plus the event's date-choice settings (multiDatePricingMode,
--    allDaysPass). The new keys are returned ONLY while the link is active, so
--    a revoked, expired, full or unavailable link adds nothing.
-- 2. A guest-list sign-up on an event that asks for a date (a multi-date event,
--    or a recurring event with more than one upcoming date) may choose several
--    dates. Seth's decisions (chat, 2026-10-21):
--      a. a link's limit counts PEOPLE: one guest on two days uses one place;
--         the ticket type's capacity still counts every pass;
--      b. duplicates are decided PER DATE: the same email may sign up once for
--         each date, so a second sign-up for a date already held is skipped and
--         a sign-up for a new date is issued;
--      c. paid links already reuse normal checkout, which takes the chosen days
--         (no database change: biz_ticket_link_checkout_create_session passes
--         p_event_date_ids through and counts link units as people).
--    Each chosen date gets its own row in ticket_link_member_passes. A per-day
--    event issues one pass per person per date (one comp order each); an
--    all-days-pass event issues one pass per person valid on every chosen date,
--    exactly as normal checkout does. Approval-required links still hold
--    nothing until the host approves.
--    Events that never ask for a date keep the exact pre-existing behaviour:
--    the per-event duplicate rule, one order per person, the same request keys.
--
-- BEFORE MERGE: apply this migration to production before the edge functions
-- deploy (merging auto-deploys ticket-link-public). The drift guard below stops
-- the apply if any re-emitted function's live body differs from the repository.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Drift guard: these functions are re-emitted in full, so refuse to run if any
-- live body differs from its definition in 20271209003827 (a production hotfix
-- would otherwise be silently overwritten).
DO $drift_guard$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.issue_3827_link_uses_taken(uuid)', 'f94a565c6e675bab201816717821aedd'),
      ('public.issue_3827_issue_link_signup(uuid,uuid,text)', '7cfebf6cba66937d45f32b40158c58e9'),
      ('public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text)', '1b74459fe307004e3b1b2aff5f868bab'),
      ('public.pg_ticket_link_resolve(text)', '18c224c34dfebc3f672815715d4ac025'),
      ('public.biz_ticket_link_requests(uuid,uuid,uuid)', 'ee552157571d8bb10f94912c617ba113')
    ) AS v(sig, expected_md5)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.sig::regprocedure) IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3827 re-emit drift: % no longer matches its repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.ticket_link_signups
  ADD COLUMN per_date boolean NOT NULL DEFAULT false;
ALTER TABLE public.ticket_link_signup_members
  ADD COLUMN per_date boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ticket_link_signups.per_date IS
  'issue #3827: true when the event asks for a date; the chosen dates and their outcomes live in ticket_link_member_passes.';
COMMENT ON COLUMN public.ticket_link_signup_members.per_date IS
  'issue #3827: copied from the sign-up; a per-date person may be pending for one date while holding another.';

-- One pending request per email per event, for sign-ups that do not choose a
-- date (unchanged). Per-date sign-ups are unique per email per DATE instead,
-- which the issuer and the sign-up enforce under the event row lock.
DROP INDEX public.ticket_link_members_pending_email_uidx;
CREATE UNIQUE INDEX ticket_link_members_pending_email_uidx
  ON public.ticket_link_signup_members(event_id, lower(email))
  WHERE status = 'pending' AND email IS NOT NULL AND NOT per_date;

-- One live guest-list order per email per event became one per email per
-- DATE (decision b): a per-day pass for each chosen date is its own comp order
-- bound to that date. An order with no date keeps the old per-event meaning
-- among undated orders. Hosts' biz_comp_issue still refuses a second comp for
-- the same email on the event before it reaches this index.
DROP INDEX public.orders_comp_live_email_uidx;
CREATE UNIQUE INDEX orders_comp_live_email_uidx
  ON public.orders (
    event_id, lower(buyer_email),
    COALESCE(event_date_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE source = 'comp' AND payment_status = 'paid' AND buyer_email IS NOT NULL;

CREATE TABLE public.ticket_link_member_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.ticket_link_signup_members(id) ON DELETE CASCADE,
  signup_id uuid NOT NULL REFERENCES public.ticket_link_signups(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id uuid NOT NULL REFERENCES public.event_dates(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'issued', 'declined', 'duplicate')),
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, event_date_id)
);

CREATE INDEX ticket_link_member_passes_signup_idx
  ON public.ticket_link_member_passes(signup_id);
CREATE INDEX ticket_link_member_passes_pending_idx
  ON public.ticket_link_member_passes(event_id, event_date_id)
  WHERE status = 'pending';
CREATE INDEX ticket_link_member_passes_order_idx
  ON public.ticket_link_member_passes(order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.ticket_link_member_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_link_member_passes FROM anon, authenticated;
GRANT ALL ON TABLE public.ticket_link_member_passes TO service_role;

COMMENT ON TABLE public.ticket_link_member_passes IS
  'issue #3827: one person''s outcome for one chosen date of a per-date guest-list link sign-up.';

-- A declined or revoked person declines every date still waiting.
CREATE OR REPLACE FUNCTION public.issue_3827_member_passes_follow_decline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.ticket_link_member_passes
     SET status = 'declined'
   WHERE member_id = NEW.id AND status = 'pending';
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_3827_member_passes_follow_decline
AFTER UPDATE OF status ON public.ticket_link_signup_members
FOR EACH ROW
WHEN (NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined')
EXECUTE FUNCTION public.issue_3827_member_passes_follow_decline();

REVOKE ALL ON FUNCTION public.issue_3827_member_passes_follow_decline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_member_passes_follow_decline() TO service_role;

-- ---------------------------------------------------------------------------
-- Per-date helpers
-- ---------------------------------------------------------------------------

-- The earliest live guest-list (comp) order for this email that admits on the
-- date: an order bound to the date, a pass with a row for the date, or an
-- order with no day at all (admits on any date).
CREATE OR REPLACE FUNCTION public.issue_3827_comp_order_on_date(
  p_event_id uuid,
  p_email text,
  p_event_date_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id
    FROM public.orders o
   WHERE o.event_id = p_event_id
     AND o.source = 'comp'
     AND o.payment_status IN ('paid', 'partial_refund')
     AND lower(o.buyer_email) = lower(p_email)
     AND (
       o.event_date_id = p_event_date_id
       OR EXISTS (
         SELECT 1 FROM public.tickets t
           JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
          WHERE t.order_id = o.id AND ted.event_date_id = p_event_date_id
       )
       OR (
         o.event_date_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.tickets t
             JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
            WHERE t.order_id = o.id
         )
       )
     )
   ORDER BY o.created_at, o.id
   LIMIT 1;
$$;

-- True when another sign-up already waits for host approval for this email on
-- this date (per-date passes, or an older single-date request for the date).
CREATE OR REPLACE FUNCTION public.issue_3827_link_pending_on_date(
  p_event_id uuid,
  p_email text,
  p_event_date_id uuid,
  p_exclude_signup_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.ticket_link_member_passes p
      JOIN public.ticket_link_signup_members m ON m.id = p.member_id
     WHERE p.event_id = p_event_id
       AND p.event_date_id = p_event_date_id
       AND p.status = 'pending'
       AND lower(m.email) = lower(p_email)
       AND p.signup_id IS DISTINCT FROM p_exclude_signup_id
  ) OR EXISTS (
    SELECT 1
      FROM public.ticket_link_signup_members m
      JOIN public.ticket_link_signups s ON s.id = m.signup_id
     WHERE m.event_id = p_event_id
       AND NOT m.per_date
       AND m.status = 'pending'
       AND lower(m.email) = lower(p_email)
       AND (s.event_date_id IS NULL OR s.event_date_id = p_event_date_id)
       AND s.id IS DISTINCT FROM p_exclude_signup_id
  );
$$;

REVOKE ALL ON FUNCTION public.issue_3827_comp_order_on_date(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3827_link_pending_on_date(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_comp_order_on_date(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3827_link_pending_on_date(uuid,text,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- A guest-list link's limit counts PEOPLE (decision a). Before this change it
-- counted tickets, which was the same number while every person held exactly
-- one ticket; a person with a pass for each of two dates now counts once.
-- The private_ticket branch is unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3827_link_uses_taken(p_link_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text;
  v_used integer;
BEGIN
  SELECT l.kind INTO v_kind FROM public.ticket_type_links l WHERE l.id = p_link_id;
  IF v_kind = 'guest_list' THEN
    SELECT count(DISTINCT COALESCE(lower(o.buyer_email), o.id::text))::integer INTO v_used
      FROM public.orders o
      JOIN public.tickets t ON t.order_id = o.id
     WHERE o.ticket_link_id = p_link_id
       AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND t.status IN ('valid', 'used');
  ELSIF v_kind = 'private_ticket' THEN
    SELECT COALESCE(sum(s.ticket_link_units), 0)::integer INTO v_used
      FROM public.ticket_checkout_sessions s
     WHERE s.ticket_link_id = p_link_id
       AND (
         (s.expires_at > now() AND s.status IN (
           'pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect'
         ))
         OR EXISTS (
           SELECT 1 FROM public.orders o
            WHERE o.checkout_session_id = s.id
              AND o.payment_status IN ('paid', 'partial_refund')
         )
       );
  ELSE
    v_used := 0;
  END IF;
  RETURN COALESCE(v_used, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- Per-date issuance. Called by issue_3827_issue_link_signup for a per-date
-- sign-up. Same contract as the single-date issuer: it raises and catches
-- nothing, so one failure rolls the whole group back (I-3827-LINK-GROUP-ATOMIC).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_3827_issue_link_signup_days(
  p_signup_id uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_member record;
  v_pass record;
  v_existing uuid;
  v_first uuid;
  v_member_new boolean;
  v_new_passes integer := 0;
  v_new_people integer := 0;
  v_new_members integer := 0;
  v_units integer;
  v_used integer;
  v_held integer := 0;
  v_remaining integer;
  v_all_days boolean;
  v_lead_name text;
  v_lead_order uuid;
  v_lead_orders jsonb := '{}'::jsonb;
  v_party_lead uuid;
  v_dates uuid[];
  v_anchor uuid;
  v_order uuid;
  v_one jsonb;
  v_resent uuid[] := ARRAY[]::uuid[];
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  IF NOT v_signup.per_date THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF v_signup.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type,
         COALESCE(e.is_multi_date, false) AS is_multi_date,
         COALESCE(e.is_recurring, false) AS is_recurring,
         COALESCE(e.multi_date_pricing_mode, 'per_day') AS pricing_mode
    INTO v_event FROM public.events e WHERE e.id = v_signup.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited,
         tt.sold_count
    INTO v_tier FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id FOR UPDATE;

  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_state
      WHEN 'revoked' THEN 'link_revoked' WHEN 'expired' THEN 'link_expired'
      ELSE v_state END;
  END IF;

  -- The same rule the public event payload and normal checkout use.
  v_all_days := v_event.is_multi_date AND NOT v_event.is_recurring
    AND v_event.pricing_mode = 'all_days';

  -- Re-classify every chosen date under the event lock (decision b).
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position FOR UPDATE
  LOOP
    v_member_new := false;
    v_first := NULL;
    FOR v_pass IN
      SELECT p.id, p.event_date_id FROM public.ticket_link_member_passes p
        JOIN public.event_dates d ON d.id = p.event_date_id
       WHERE p.member_id = v_member.id
       ORDER BY d.start_at, d.id
    LOOP
      v_existing := public.issue_3827_comp_order_on_date(
        v_signup.event_id, v_member.email, v_pass.event_date_id);
      IF v_existing IS NOT NULL THEN
        UPDATE public.ticket_link_member_passes
           SET status = 'duplicate', order_id = v_existing WHERE id = v_pass.id;
        v_first := COALESCE(v_first, v_existing);
        IF NOT (v_existing = ANY(v_resent)) THEN
          v_resent := v_resent || v_existing;
          INSERT INTO public.ticket_order_notifications(
            order_id, event_id, channel, recipient, idempotency_key, payload
          ) VALUES (
            v_existing, v_signup.event_id, 'email', v_member.email,
            'ticket_link_resend:' || v_existing::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
            jsonb_build_object('source', 'comp', 'resend', true)
          ) ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
      ELSIF public.issue_3827_link_pending_on_date(
        v_signup.event_id, v_member.email, v_pass.event_date_id, v_signup.id
      ) THEN
        UPDATE public.ticket_link_member_passes
           SET status = 'duplicate', order_id = NULL WHERE id = v_pass.id;
      ELSE
        UPDATE public.ticket_link_member_passes
           SET status = 'pending', order_id = NULL WHERE id = v_pass.id;
        v_member_new := true;
        v_new_passes := v_new_passes + 1;
      END IF;
    END LOOP;

    IF v_member_new THEN
      UPDATE public.ticket_link_signup_members
         SET status = 'pending', order_id = NULL WHERE id = v_member.id;
      v_new_members := v_new_members + 1;
      -- Decision (a): a person this link already counts is not counted again.
      IF NOT EXISTS (
        SELECT 1 FROM public.orders o
          JOIN public.tickets t ON t.order_id = o.id
         WHERE o.ticket_link_id = v_link.id AND o.source = 'comp'
           AND o.payment_status IN ('paid', 'partial_refund')
           AND t.status IN ('valid', 'used')
           AND lower(o.buyer_email) = lower(v_member.email)
      ) THEN
        v_new_people := v_new_people + 1;
      END IF;
    ELSE
      UPDATE public.ticket_link_signup_members
         SET status = 'duplicate', order_id = v_first WHERE id = v_member.id;
      v_skipped := v_skipped || jsonb_build_array(v_member.name);
    END IF;
  END LOOP;

  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_link.max_uses IS NOT NULL AND v_used + v_new_people > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full' USING HINT = jsonb_build_object(
      'remaining', GREATEST(v_link.max_uses - v_used, 0), 'needed', v_new_people
    )::text;
  END IF;

  -- Capacity counts passes, the way normal checkout does: per night on a
  -- recurring event; one shared pool otherwise, where a per-day pass uses one
  -- place per date and an all-days pass uses one place.
  v_choice := public.issue_3313_event_day_choice(v_signup.event_id);
  IF NOT v_tier.is_unlimited AND v_tier.quantity_total IS NOT NULL THEN
    IF COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false) THEN
      FOR v_pass IN
        SELECT p.event_date_id, count(*)::integer AS needed
          FROM public.ticket_link_member_passes p
         WHERE p.signup_id = v_signup.id AND p.status = 'pending'
         GROUP BY p.event_date_id
      LOOP
        v_remaining := v_tier.quantity_total
          - public.issue_3313_ticket_type_occurrence_taken(v_tier.id, v_pass.event_date_id);
        IF v_pass.needed > v_remaining THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
            'remaining', GREATEST(v_remaining, 0), 'needed', v_pass.needed,
            'ticketName', v_tier.name, 'eventDateId', v_pass.event_date_id
          )::text;
        END IF;
      END LOOP;
    ELSE
      v_units := CASE WHEN v_all_days THEN v_new_members ELSE v_new_passes END;
      SELECT COALESCE(sum(i.quantity), 0)::integer INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tier.id AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tier.quantity_total - COALESCE(v_tier.sold_count, 0) - v_held;
      IF v_units > v_remaining THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
          'remaining', GREATEST(v_remaining, 0), 'needed', v_units,
          'ticketName', v_tier.name
        )::text;
      END IF;
    END IF;
  END IF;

  -- The lead's existing passes anchor a guest's party line on each date.
  SELECT m0.name INTO v_lead_name FROM public.ticket_link_signup_members m0
   WHERE m0.signup_id = v_signup.id AND m0.position = 0;
  SELECT COALESCE(jsonb_object_agg(p.event_date_id::text, p.order_id), '{}'::jsonb)
    INTO v_lead_orders
    FROM public.ticket_link_member_passes p
    JOIN public.ticket_link_signup_members m ON m.id = p.member_id
   WHERE m.signup_id = v_signup.id AND m.position = 0
     AND p.status = 'duplicate' AND p.order_id IS NOT NULL;
  SELECT m.order_id INTO v_lead_order FROM public.ticket_link_signup_members m
   WHERE m.signup_id = v_signup.id AND m.position = 0 AND m.status = 'duplicate';

  -- Lead first, then guests.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position
  LOOP
    IF v_member.status = 'duplicate' THEN CONTINUE; END IF;
    IF v_all_days THEN
      v_dates := ARRAY(
        SELECT p.event_date_id FROM public.ticket_link_member_passes p
          JOIN public.event_dates d ON d.id = p.event_date_id
         WHERE p.member_id = v_member.id AND p.status = 'pending'
         ORDER BY d.start_at, d.id
      );
      v_party_lead := NULL;
      IF v_member.position <> 0 THEN
        SELECT o.id INTO v_party_lead FROM public.orders o
         WHERE o.id IN (
           SELECT value::uuid FROM jsonb_each_text(v_lead_orders)
         ) AND o.comp_party_lead_order_id IS NULL
         ORDER BY o.created_at, o.id LIMIT 1;
      END IF;
      -- One pass valid on every new date: no day on the order while the pass
      -- rows are written, then the latest-ending date anchors the order (the
      -- payout and refund anchor normal checkout uses).
      v_one := public.issue_3827_comp_issue_one(
        v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
        CASE WHEN cardinality(v_dates) = 1 THEN v_dates[1] ELSE NULL END,
        v_member.name, v_member.email, v_member.phone_e164,
        1, 'link:' || v_signup.id::text || ':' || v_member.position::text,
        p_qr_token_pepper, p_issued_by, v_link.id, NULL,
        v_party_lead,
        CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_name END,
        CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
        jsonb_build_object(
          'marketing_opt_in', true, 'via_link', true,
          'ticket_link_signup_id', v_signup.id
        )
      );
      v_order := (v_one ->> 'orderId')::uuid;
      IF cardinality(v_dates) > 1 THEN
        INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
        SELECT t.id, x.id FROM public.tickets t CROSS JOIN unnest(v_dates) AS x(id)
         WHERE t.order_id = v_order
        ON CONFLICT DO NOTHING;
        SELECT d.id INTO v_anchor FROM public.event_dates d
         WHERE d.id = ANY(v_dates) ORDER BY d.end_at DESC, d.id DESC LIMIT 1;
        UPDATE public.orders SET event_date_id = v_anchor WHERE id = v_order;
      END IF;
      UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_order;
      UPDATE public.ticket_link_member_passes
         SET status = 'issued', order_id = v_order
       WHERE member_id = v_member.id AND status = 'pending';
      UPDATE public.ticket_link_signup_members
         SET status = 'issued', order_id = v_order WHERE id = v_member.id;
      IF v_member.position = 0 THEN
        v_lead_order := COALESCE(v_lead_order, v_order);
        SELECT v_lead_orders || COALESCE(jsonb_object_agg(x.id::text, v_order), '{}'::jsonb)
          INTO v_lead_orders FROM unnest(v_dates) AS x(id);
      END IF;
      IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
        v_orders := v_orders || jsonb_build_array(v_order);
      END IF;
    ELSE
      v_first := NULL;
      FOR v_pass IN
        SELECT p.id, p.event_date_id FROM public.ticket_link_member_passes p
          JOIN public.event_dates d ON d.id = p.event_date_id
         WHERE p.member_id = v_member.id AND p.status = 'pending'
         ORDER BY d.start_at, d.id
      LOOP
        v_party_lead := NULL;
        IF v_member.position <> 0 THEN
          SELECT o.id INTO v_party_lead FROM public.orders o
           WHERE o.id = (v_lead_orders ->> v_pass.event_date_id::text)::uuid
             AND o.comp_party_lead_order_id IS NULL;
        END IF;
        v_one := public.issue_3827_comp_issue_one(
          v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
          v_pass.event_date_id, v_member.name, v_member.email, v_member.phone_e164,
          1, 'link:' || v_signup.id::text || ':' || v_member.position::text
            || ':' || v_pass.event_date_id::text,
          p_qr_token_pepper, p_issued_by, v_link.id, NULL,
          v_party_lead,
          CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_name END,
          CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
          jsonb_build_object(
            'marketing_opt_in', true, 'via_link', true,
            'ticket_link_signup_id', v_signup.id
          )
        );
        v_order := (v_one ->> 'orderId')::uuid;
        v_first := COALESCE(v_first, v_order);
        UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_order;
        UPDATE public.ticket_link_member_passes
           SET status = 'issued', order_id = v_order WHERE id = v_pass.id;
        IF v_member.position = 0 THEN
          v_lead_orders := v_lead_orders || jsonb_build_object(v_pass.event_date_id::text, v_order);
        END IF;
        IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
          v_orders := v_orders || jsonb_build_array(v_order);
        END IF;
      END LOOP;
      UPDATE public.ticket_link_signup_members
         SET status = 'issued', order_id = v_first WHERE id = v_member.id;
      IF v_member.position = 0 THEN v_lead_order := COALESCE(v_first, v_lead_order); END IF;
    END IF;
  END LOOP;

  UPDATE public.ticket_link_signups
     SET status = CASE WHEN v_new_passes = 0 THEN 'duplicate' ELSE 'issued' END,
         lead_order_id = v_lead_order,
         decided_by = p_issued_by,
         decided_at = CASE WHEN p_issued_by IS NULL THEN decided_at ELSE now() END
   WHERE id = v_signup.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_new_passes = 0 THEN 'duplicate' ELSE 'issued' END,
    'leadOrderId', v_lead_order, 'emailQueuedOrderIds', v_orders,
    'issuedCount', v_new_members, 'issuedPasses', v_new_passes,
    'skippedNames', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3827_issue_link_signup_days(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3827_issue_link_signup_days(uuid,uuid,text) TO service_role;

-- The single-date issuer, re-emitted from 20271209003827 with one change: a
-- per-date sign-up is handed to issue_3827_issue_link_signup_days.
CREATE OR REPLACE FUNCTION public.issue_3827_issue_link_signup(
  p_signup_id uuid,
  p_issued_by uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_signup public.ticket_link_signups;
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_member record;
  v_existing uuid;
  v_new integer := 0;
  v_used integer;
  v_held integer := 0;
  v_remaining integer;
  v_lead_order uuid;
  v_one jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  SELECT s.* INTO v_signup FROM public.ticket_link_signups s WHERE s.id = p_signup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signup_not_found'; END IF;
  -- issue #3827: several dates per sign-up.
  IF v_signup.per_date THEN
    RETURN public.issue_3827_issue_link_signup_days(p_signup_id, p_issued_by, p_qr_token_pepper);
  END IF;
  IF v_signup.status NOT IN ('pending', 'issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;
  IF v_signup.status IN ('issued', 'duplicate') THEN
    RETURN jsonb_build_object('status', v_signup.status, 'idempotentReplay', true,
      'leadOrderId', v_signup.lead_order_id, 'emailQueuedOrderIds', '[]'::jsonb,
      'issuedCount', 0, 'skippedNames', '[]'::jsonb);
  END IF;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.id = v_signup.link_id FOR UPDATE;
  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type
    INTO v_event FROM public.events e WHERE e.id = v_signup.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited,
         tt.sold_count
    INTO v_tier FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id FOR UPDATE;

  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_state
      WHEN 'revoked' THEN 'link_revoked' WHEN 'expired' THEN 'link_expired'
      ELSE v_state END;
  END IF;

  -- Re-classify under the event lock. A host may have added somebody while the
  -- request waited; that person is skipped without blocking the group.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position FOR UPDATE
  LOOP
    SELECT o.id INTO v_existing FROM public.orders o
     WHERE o.event_id = v_signup.event_id AND o.source = 'comp'
       AND o.payment_status IN ('paid', 'partial_refund')
       AND lower(o.buyer_email) = lower(v_member.email)
     ORDER BY o.created_at, o.id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.ticket_link_signup_members
         SET status = 'duplicate', order_id = v_existing WHERE id = v_member.id;
      v_skipped := v_skipped || jsonb_build_array(v_member.name);
      IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
      INSERT INTO public.ticket_order_notifications(
        order_id, event_id, channel, recipient, idempotency_key, payload
      ) VALUES (
        v_existing, v_signup.event_id, 'email', v_member.email,
        'ticket_link_resend:' || v_existing::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        jsonb_build_object('source', 'comp', 'resend', true)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    ELSE
      UPDATE public.ticket_link_signup_members
         SET status = 'pending', order_id = NULL WHERE id = v_member.id;
      v_new := v_new + 1;
    END IF;
  END LOOP;

  v_used := public.issue_3827_link_uses_taken(v_link.id);
  IF v_link.max_uses IS NOT NULL AND v_used + v_new > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full' USING HINT = jsonb_build_object(
      'remaining', GREATEST(v_link.max_uses - v_used, 0), 'needed', v_new
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_signup.event_id);
  IF NOT v_tier.is_unlimited AND v_tier.quantity_total IS NOT NULL THEN
    IF COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false)
       AND v_signup.event_date_id IS NOT NULL THEN
      v_remaining := v_tier.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tier.id, v_signup.event_date_id);
    ELSE
      SELECT COALESCE(sum(i.quantity), 0)::integer INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tier.id AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tier.quantity_total - COALESCE(v_tier.sold_count, 0) - v_held;
    END IF;
    IF v_new > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded' USING HINT = jsonb_build_object(
        'remaining', GREATEST(v_remaining, 0), 'needed', v_new,
        'ticketName', v_tier.name
      )::text;
    END IF;
  END IF;

  -- Lead first, then guests. Exceptions are deliberately not caught:
  -- I-3827-LINK-GROUP-ATOMIC rolls the entire group back.
  FOR v_member IN
    SELECT m.* FROM public.ticket_link_signup_members m
     WHERE m.signup_id = v_signup.id ORDER BY m.position
  LOOP
    IF v_member.status = 'duplicate' THEN CONTINUE; END IF;
    v_one := public.issue_3827_comp_issue_one(
      v_signup.event_id, v_event.brand_id, v_link.ticket_type_id,
      v_signup.event_date_id, v_member.name, v_member.email, v_member.phone_e164,
      1, 'link:' || v_signup.id::text || ':' || v_member.position::text,
      p_qr_token_pepper, p_issued_by, v_link.id, NULL,
      CASE WHEN v_member.position = 0 THEN NULL ELSE v_lead_order END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE (
        SELECT m0.name FROM public.ticket_link_signup_members m0
         WHERE m0.signup_id = v_signup.id AND m0.position = 0
      ) END,
      CASE WHEN v_member.position = 0 THEN NULL ELSE 'link' END,
      jsonb_build_object(
        'marketing_opt_in', true, 'via_link', true,
        'ticket_link_signup_id', v_signup.id
      )
    );
    v_existing := (v_one ->> 'orderId')::uuid;
    UPDATE public.orders SET ticket_link_signup_id = v_signup.id WHERE id = v_existing;
    UPDATE public.ticket_link_signup_members
       SET status = 'issued', order_id = v_existing WHERE id = v_member.id;
    IF v_member.position = 0 THEN v_lead_order := v_existing; END IF;
    IF COALESCE((v_one ->> 'emailQueued')::boolean, false) THEN
      v_orders := v_orders || jsonb_build_array(v_existing);
    END IF;
  END LOOP;

  UPDATE public.ticket_link_signups
     SET status = CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
         lead_order_id = v_lead_order,
         decided_by = p_issued_by,
         decided_at = CASE WHEN p_issued_by IS NULL THEN decided_at ELSE now() END
   WHERE id = v_signup.id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_new = 0 THEN 'duplicate' ELSE 'issued' END,
    'leadOrderId', v_lead_order, 'emailQueuedOrderIds', v_orders,
    'issuedCount', v_new, 'skippedNames', v_skipped
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public guest-list sign-up with a date SET. The six-argument
-- pg_ticket_link_signup keeps its signature and delegates here with its one
-- date, so both callers share one implementation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pg_ticket_link_signup_days(
  p_token_hash text,
  p_members jsonb,
  p_event_date_ids uuid[],
  p_client_request_id uuid,
  p_ip_hash text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_event record;
  v_tier record;
  v_choice jsonb;
  v_existing_signup public.ticket_link_signups;
  v_signup_id uuid := gen_random_uuid();
  v_date_id uuid;
  v_date_ids uuid[] := ARRAY[]::uuid[];
  v_per_date boolean := false;
  v_all_days boolean := false;
  v_d uuid;
  v_item jsonb;
  v_members jsonb := '[]'::jsonb;
  v_passes jsonb;
  v_pass jsonb;
  v_emails text[] := ARRAY[]::text[];
  v_i integer;
  v_name text;
  v_email text;
  v_phone text;
  v_existing_order uuid;
  v_first_order uuid;
  v_pending boolean;
  v_any_new boolean;
  v_lead_waiting boolean;
  v_status text;
  v_email_hits integer;
  v_phone_hits integer;
  v_member_id uuid;
  v_result jsonb;
  v_people jsonb;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_client_request_id IS NULL
     OR p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_members IS NULL OR jsonb_typeof(p_members) <> 'array'
     OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 10
     OR COALESCE(cardinality(p_event_date_ids), 0) > 60
     OR array_position(p_event_date_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_members) - 1 LOOP
    v_item := p_members -> v_i;
    v_name := btrim(COALESCE(v_item ->> 'name', ''));
    v_email := lower(btrim(COALESCE(v_item ->> 'email', '')));
    v_phone := btrim(COALESCE(v_item ->> 'phoneE164', ''));
    IF jsonb_typeof(v_item) <> 'object' OR v_item - ARRAY['name','email','phoneE164'] <> '{}'::jsonb
       OR char_length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.name', 'reason', 'missing'
      )::text;
    END IF;
    IF char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'format'
      )::text;
    END IF;
    IF v_email = ANY(v_emails) THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.email', 'reason', 'duplicate_in_request'
      )::text;
    END IF;
    v_emails := v_emails || v_email;
    IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
        'field', 'members.' || v_i || '.phone', 'reason', 'format'
      )::text;
    END IF;
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'position', v_i, 'name', v_name, 'email', v_email, 'phoneE164', v_phone
    ));
  END LOOP;

  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  SELECT s.* INTO v_existing_signup FROM public.ticket_link_signups s
   WHERE s.link_id = v_link.id AND s.client_request_id = p_client_request_id;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'position', m.position, 'name', m.name,
      'maskedEmail', CASE WHEN position('@' IN m.email) < 2 THEN '***'
        ELSE left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
          || '***@' || split_part(m.email, '@', 2) END
    ) ORDER BY m.position), '[]'::jsonb) INTO v_people
    FROM public.ticket_link_signup_members m WHERE m.signup_id = v_existing_signup.id;
    RETURN jsonb_build_object('status', CASE WHEN v_existing_signup.status = 'duplicate' THEN 'issued'
      ELSE v_existing_signup.status END, 'people', v_people, 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;

  SELECT e.id, e.brand_id, e.status, e.visibility, e.deleted_at, e.event_type,
         COALESCE(e.is_multi_date, false) AS is_multi_date,
         COALESCE(e.is_recurring, false) AS is_recurring,
         COALESCE(e.multi_date_pricing_mode, 'per_day') AS pricing_mode
    INTO v_event FROM public.events e WHERE e.id = v_link.event_id FOR UPDATE;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;
  SELECT tt.id, tt.deleted_at INTO v_tier FROM public.ticket_types tt
   WHERE tt.id = v_link.ticket_type_id FOR UPDATE;
  v_status := public.issue_3827_link_state(v_link, now());
  -- A full link may still be replaying a request whose people already have
  -- tickets. Let the locked issuer distinguish that harmless replay from a
  -- new person who would exceed the link's limit.
  IF v_status NOT IN ('active', 'full') THEN
    RAISE EXCEPTION '%', CASE v_status WHEN 'revoked' THEN 'link_revoked'
      WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_status END;
  END IF;
  IF v_link.kind <> 'guest_list' THEN RAISE EXCEPTION 'not_a_guest_list_link'; END IF;
  IF jsonb_array_length(v_members) > v_link.party_max THEN
    RAISE EXCEPTION 'invalid_request' USING HINT = jsonb_build_object(
      'field', 'members', 'reason', 'too_many'
    )::text;
  END IF;

  v_choice := public.issue_3313_event_day_choice(v_link.event_id);
  v_per_date := COALESCE((v_choice ->> 'requiresChoice')::boolean, false);
  IF NOT v_per_date THEN
    -- An event that never asks for a date: exactly the single-date rule.
    IF COALESCE(cardinality(p_event_date_ids), 0) > 1 THEN
      RAISE EXCEPTION 'invalid_request';
    END IF;
    IF v_link.event_date_id IS NOT NULL THEN
      v_date_id := v_link.event_date_id;
    ELSIF COALESCE(cardinality(p_event_date_ids), 0) = 1 THEN
      v_date_id := p_event_date_ids[1];
    ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
      v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
    END IF;
    IF v_date_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.event_dates d
       WHERE d.id = v_date_id AND d.event_id = v_link.event_id AND d.end_at > now()
    ) THEN RAISE EXCEPTION 'occurrence_not_available'; END IF;
  ELSE
    v_all_days := v_event.is_multi_date AND NOT v_event.is_recurring
      AND v_event.pricing_mode = 'all_days';
    IF v_link.event_date_id IS NOT NULL THEN
      v_date_ids := ARRAY[v_link.event_date_id];
    ELSIF v_all_days THEN
      -- An all-days pass covers every upcoming date; the guest picks nothing.
      v_date_ids := ARRAY(
        SELECT d.id FROM public.event_dates d
         WHERE d.event_id = v_link.event_id AND d.end_at > now()
      );
    ELSE
      v_date_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_event_date_ids, ARRAY[]::uuid[])) AS x);
    END IF;
    IF cardinality(v_date_ids) = 0 THEN
      RAISE EXCEPTION 'event_date_choice_required';
    END IF;
    IF (
      SELECT count(*) FROM public.event_dates d
       WHERE d.id = ANY(v_date_ids) AND d.event_id = v_link.event_id AND d.end_at > now()
    ) <> cardinality(v_date_ids) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_date_ids := ARRAY(
      SELECT d.id FROM public.event_dates d WHERE d.id = ANY(v_date_ids)
       ORDER BY d.start_at, d.id
    );
    v_date_id := v_date_ids[1];
  END IF;

  -- Rate gates fail closed and count every person in the group.
  IF p_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.ticket_link_signups s
     WHERE s.ip_hash = p_ip_hash AND s.created_at > now() - interval '1 hour'
  ) >= 20 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT COALESCE(sum(s.member_count), 0) FROM public.ticket_link_signups s
     WHERE s.link_id = v_link.id AND s.created_at > now() - interval '1 hour'
  ) + jsonb_array_length(v_members) > 300 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  IF (
    SELECT count(*) FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.status = 'pending'
  ) + jsonb_array_length(v_members) > 500 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    v_email := v_item ->> 'email';
    v_phone := v_item ->> 'phoneE164';
    SELECT count(*) INTO v_email_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND lower(m.email) = v_email
      AND m.created_at > now() - interval '1 hour';
    SELECT count(*) INTO v_phone_hits FROM public.ticket_link_signup_members m
    JOIN public.ticket_link_signups s ON s.id = m.signup_id
    WHERE s.link_id = v_link.id AND m.phone_e164 = v_phone
      AND m.created_at > now() - interval '1 hour';
    IF v_email_hits >= 3 OR v_phone_hits >= 3 OR (
      SELECT count(*) FROM public.ticket_link_signup_members m
       WHERE m.event_id = v_link.event_id AND m.phone_e164 = v_phone
         AND m.created_at > now() - interval '1 hour'
    ) >= 10 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  END LOOP;

  -- Classify before insert. The lead already pending returns the same pending
  -- state without creating a second group.
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    IF NOT v_per_date THEN
      v_existing_order := NULL;
      SELECT o.id INTO v_existing_order FROM public.orders o
       WHERE o.event_id = v_link.event_id AND o.source = 'comp'
         AND o.payment_status IN ('paid', 'partial_refund')
         AND lower(o.buyer_email) = v_item ->> 'email'
       ORDER BY o.created_at, o.id LIMIT 1;
      SELECT EXISTS(
        SELECT 1 FROM public.ticket_link_signup_members m
         WHERE m.event_id = v_link.event_id AND m.status = 'pending'
           AND lower(m.email) = v_item ->> 'email'
      ) INTO v_pending;
      IF v_i = 0 AND v_existing_order IS NULL AND v_pending THEN
        RETURN jsonb_build_object('status', 'pending', 'alreadyPending', true,
          'people', jsonb_build_array(jsonb_build_object(
            'position', 0, 'name', v_item ->> 'name', 'maskedEmail', NULL
          )), 'emailQueuedOrderIds', '[]'::jsonb);
      END IF;
      v_members := jsonb_set(v_members, ARRAY[v_i::text], v_item || jsonb_build_object(
        'status', CASE WHEN v_existing_order IS NOT NULL OR v_pending THEN 'duplicate' ELSE 'pending' END,
        'orderId', v_existing_order
      ));
    ELSE
      -- Decision (b): each date is decided on its own.
      v_passes := '[]'::jsonb;
      v_any_new := false;
      v_lead_waiting := true;
      v_first_order := NULL;
      FOREACH v_d IN ARRAY v_date_ids LOOP
        v_existing_order := public.issue_3827_comp_order_on_date(
          v_link.event_id, v_item ->> 'email', v_d);
        v_pending := v_existing_order IS NULL AND public.issue_3827_link_pending_on_date(
          v_link.event_id, v_item ->> 'email', v_d, NULL);
        IF v_existing_order IS NOT NULL THEN
          v_lead_waiting := false;
          v_first_order := COALESCE(v_first_order, v_existing_order);
        ELSIF NOT v_pending THEN
          v_lead_waiting := false;
          v_any_new := true;
        END IF;
        v_passes := v_passes || jsonb_build_array(jsonb_build_object(
          'eventDateId', v_d,
          'status', CASE WHEN v_existing_order IS NOT NULL OR v_pending THEN 'duplicate' ELSE 'pending' END,
          'orderId', v_existing_order
        ));
      END LOOP;
      IF v_i = 0 AND v_lead_waiting THEN
        RETURN jsonb_build_object('status', 'pending', 'alreadyPending', true,
          'people', jsonb_build_array(jsonb_build_object(
            'position', 0, 'name', v_item ->> 'name', 'maskedEmail', NULL
          )), 'emailQueuedOrderIds', '[]'::jsonb);
      END IF;
      v_members := jsonb_set(v_members, ARRAY[v_i::text], v_item || jsonb_build_object(
        'status', CASE WHEN v_any_new THEN 'pending' ELSE 'duplicate' END,
        'orderId', v_first_order,
        'passes', v_passes
      ));
    END IF;
  END LOOP;

  INSERT INTO public.ticket_link_signups(
    id, link_id, event_id, status, member_count, event_date_id,
    client_request_id, ip_hash, per_date
  ) VALUES (
    v_signup_id, v_link.id, v_link.event_id, 'pending', jsonb_array_length(v_members),
    v_date_id, p_client_request_id, p_ip_hash, v_per_date
  );
  FOR v_i IN 0 .. jsonb_array_length(v_members) - 1 LOOP
    v_item := v_members -> v_i;
    INSERT INTO public.ticket_link_signup_members(
      signup_id, event_id, position, name, email, phone_e164, status, order_id, per_date
    ) VALUES (
      v_signup_id, v_link.event_id, v_i, v_item ->> 'name', v_item ->> 'email',
      v_item ->> 'phoneE164', v_item ->> 'status', (v_item ->> 'orderId')::uuid, v_per_date
    ) RETURNING id INTO v_member_id;
    IF v_per_date THEN
      FOR v_pass IN SELECT value FROM jsonb_array_elements(v_item -> 'passes') LOOP
        INSERT INTO public.ticket_link_member_passes(
          member_id, signup_id, event_id, event_date_id, status, order_id
        ) VALUES (
          v_member_id, v_signup_id, v_link.event_id, (v_pass ->> 'eventDateId')::uuid,
          v_pass ->> 'status', (v_pass ->> 'orderId')::uuid
        );
      END LOOP;
    END IF;
  END LOOP;

  IF v_link.approval_mode = 'auto' THEN
    v_result := public.issue_3827_issue_link_signup(v_signup_id, NULL, p_qr_token_pepper);
  ELSE
    v_result := jsonb_build_object('status', 'pending', 'emailQueuedOrderIds', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'position', m.position, 'name', m.name,
    'maskedEmail', left(split_part(m.email, '@', 1), LEAST(2, char_length(split_part(m.email, '@', 1))))
      || '***@' || split_part(m.email, '@', 2)
  ) ORDER BY m.position), '[]'::jsonb) INTO v_people
  FROM public.ticket_link_signup_members m WHERE m.signup_id = v_signup_id;
  RETURN v_result || jsonb_build_object(
    'status', CASE WHEN v_result ->> 'status' = 'duplicate' THEN 'issued' ELSE v_result ->> 'status' END,
    'people', v_people
  ) || CASE WHEN v_per_date
    THEN jsonb_build_object('eventDateIds', to_jsonb(v_date_ids))
    ELSE '{}'::jsonb END;
END;
$$;

CREATE OR REPLACE FUNCTION public.pg_ticket_link_signup(
  p_token_hash text,
  p_members jsonb,
  p_event_date_id uuid,
  p_client_request_id uuid,
  p_ip_hash text,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN public.pg_ticket_link_signup_days(
    p_token_hash, p_members,
    CASE WHEN p_event_date_id IS NULL THEN NULL ELSE ARRAY[p_event_date_id] END,
    p_client_request_id, p_ip_hash, p_qr_token_pepper
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text) TO service_role;

-- ---------------------------------------------------------------------------
-- Resolver: re-emitted from 20271209003827. Adds coverMediaType and
-- coverPosterUrl to the event, and multiDatePricingMode / allDaysPass, ONLY
-- while the link is active. The #2489 address gate is unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pg_ticket_link_resolve(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_state text;
  v_result jsonb;
  v_remaining integer;
  v_active boolean;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
  v_state := public.issue_3827_link_state(v_link, now());

  SELECT CASE
    WHEN COALESCE(tt.is_unlimited, false) OR tt.quantity_total IS NULL THEN NULL
    ELSE GREATEST(tt.quantity_total - COALESCE(tt.sold_count, 0) - COALESCE((
      SELECT sum(i.quantity)::integer FROM public.ticket_checkout_session_items i
      JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
      WHERE i.ticket_type_id = tt.id AND s.expires_at > now()
        AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
    ), 0), 0) END INTO v_remaining
  FROM public.ticket_types tt WHERE tt.id = v_link.ticket_type_id;

  -- The state the page shows. Only an active link learns the cover media
  -- and the date-choice settings.
  v_active := v_state = 'active' AND v_remaining IS DISTINCT FROM 0;

  SELECT jsonb_build_object(
    'state', CASE WHEN v_state = 'active' AND v_remaining = 0 THEN 'sold_out' ELSE v_state END,
    'kind', v_link.kind,
    'linkId', v_link.id,
    'eventId', e.id,
    'guestsMax', GREATEST(v_link.party_max - 1, 0),
    'approvalRequired', v_link.approval_mode = 'host',
    'eventDateId', v_link.event_date_id,
    'hideRemaining', COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false),
    'event', jsonb_build_object(
      'title', e.title, 'brandName', b.name, 'brandSlug', b.slug,
      'eventSlug', e.slug, 'visibility', e.visibility,
      'coverUrl', e.cover_media_url, 'startAt', ed.start_at,
      'endAt', ed.end_at, 'timezone', COALESCE(ed.timezone, e.timezone),
      'venueLine', CASE WHEN public.issue_2489_address_withheld(e.theme)
        THEN NULLIF(e.theme #>> '{business_event,location,venueName}', '')
        ELSE COALESCE(NULLIF(e.theme #>> '{business_event,location,venueName}', ''), e.location_text) END,
      'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
      'themeColor', COALESCE(e.theme_color_override, b.theme_color),
      'themeFont', COALESCE(e.theme_font_override, b.theme_font)
    ) || CASE WHEN v_active THEN jsonb_build_object(
      'coverMediaType', e.cover_media_type,
      'coverPosterUrl', e.cover_media_poster_url
    ) ELSE '{}'::jsonb END,
    'tier', CASE WHEN v_link.kind = 'guest_list'
      THEN jsonb_build_object('id', tt.id, 'name', tt.name)
      ELSE jsonb_build_object(
        'id', tt.id, 'name', tt.name, 'description', tt.description,
        'priceCents', tt.price_cents,
        'allInCents', CASE WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
          ELSE public.compute_all_in_cents(
            tt.price_cents, COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
            COALESCE(e.pass_service_fee, b.default_pass_service_fee),
            (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
          ) END,
        'currency', COALESCE(b.pricing_currency, tt.currency, e.currency, 'GBP'),
        'minPurchaseQty', COALESCE(tt.min_purchase_qty, 1),
        'maxPurchaseQty', tt.max_purchase_qty,
        'isUnlimited', COALESCE(tt.is_unlimited, false),
        'waitlistEnabled', COALESCE(tt.waitlist_enabled, false),
        'remaining', CASE WHEN COALESCE((e.theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)
          THEN NULL ELSE v_remaining END,
        'saleStartAt', tt.sale_start_at, 'saleEndAt', tt.sale_end_at
      ) END,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at, 'timezone', d.timezone
      ) ORDER BY d.start_at)
      FROM public.event_dates d
      WHERE d.event_id = e.id AND d.end_at > now()
        AND v_link.event_date_id IS NULL
        AND COALESCE((public.issue_3313_event_day_choice(e.id) ->> 'requiresChoice')::boolean, false)
    ), '[]'::jsonb)
  ) || CASE WHEN v_active THEN jsonb_build_object(
    'multiDatePricingMode', COALESCE(e.multi_date_pricing_mode, 'per_day'),
    'allDaysPass', COALESCE(e.is_multi_date, false) AND NOT COALESCE(e.is_recurring, false)
      AND COALESCE(e.multi_date_pricing_mode, 'per_day') = 'all_days'
  ) ELSE '{}'::jsonb END INTO v_result
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  JOIN public.ticket_types tt ON tt.id = v_link.ticket_type_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.id = v_link.event_id;
  RETURN COALESCE(v_result, jsonb_build_object('state', 'not_found'));
END;
$$;

-- ---------------------------------------------------------------------------
-- Host approval list: re-emitted from 20271209003827. Each request now names
-- its dates; a per-date person is "already on the list" only when every
-- chosen date is already held.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_ticket_link_requests(
  p_actor_id uuid,
  p_event_id uuid,
  p_link_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_brand uuid; v_rows jsonb;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND OR public.biz_brand_effective_rank(v_brand, p_actor_id)
      < public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'linkId', l.id, 'linkLabel', l.label,
    'ticketTypeName', tt.name, 'createdAt', s.created_at,
    'eventDateId', s.event_date_id, 'memberCount', s.member_count,
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at, 'timezone', d.timezone
      ) ORDER BY d.start_at, d.id)
      FROM public.event_dates d
      WHERE CASE WHEN s.per_date
        THEN d.id IN (SELECT p.event_date_id FROM public.ticket_link_member_passes p WHERE p.signup_id = s.id)
        ELSE d.id = s.event_date_id END
    ), '[]'::jsonb),
    'members', (
      SELECT jsonb_agg(jsonb_build_object(
        'position', m.position, 'name', m.name, 'email', m.email,
        'phone', m.phone_e164,
        'alreadyOnList', CASE WHEN s.per_date THEN
          EXISTS (SELECT 1 FROM public.ticket_link_member_passes p WHERE p.member_id = m.id)
          AND NOT EXISTS (
            SELECT 1 FROM public.ticket_link_member_passes p
             WHERE p.member_id = m.id
               AND public.issue_3827_comp_order_on_date(s.event_id, m.email, p.event_date_id) IS NULL
          )
        ELSE EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.event_id = s.event_id AND o.source = 'comp'
             AND o.payment_status IN ('paid', 'partial_refund')
             AND lower(o.buyer_email) = lower(m.email)
        ) END
      ) ORDER BY m.position)
      FROM public.ticket_link_signup_members m WHERE m.signup_id = s.id
    )
  ) ORDER BY s.created_at), '[]'::jsonb) INTO v_rows
  FROM public.ticket_link_signups s
  JOIN public.ticket_type_links l ON l.id = s.link_id
  JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
  WHERE s.event_id = p_event_id AND s.status = 'pending'
    AND (p_link_id IS NULL OR s.link_id = p_link_id)
  LIMIT 200;
  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- Migration-time proof
-- ---------------------------------------------------------------------------

DO $postcheck$
BEGIN
  IF position('issue_3827_issue_link_signup_days' IN pg_get_functiondef(
    'public.issue_3827_issue_link_signup(uuid,uuid,text)'::regprocedure)) = 0
     OR position('pg_ticket_link_signup_days' IN pg_get_functiondef(
    'public.pg_ticket_link_signup(text,jsonb,uuid,uuid,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue #3827 per-date sign-up is not wired';
  END IF;
  IF position('coverPosterUrl' IN pg_get_functiondef('public.pg_ticket_link_resolve(text)'::regprocedure)) = 0
     OR position('issue_2489_address_withheld' IN pg_get_functiondef('public.pg_ticket_link_resolve(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue #3827 resolver postcheck failed';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.ticket_link_member_passes'::regclass)
     OR has_table_privilege('anon', 'public.ticket_link_member_passes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ticket_link_member_passes', 'SELECT')
     OR has_function_privilege('anon', 'public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pg_ticket_link_signup_days(text,jsonb,uuid[],uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3827 per-date ACL postcheck failed';
  END IF;
  IF pg_get_indexdef('public.ticket_link_members_pending_email_uidx'::regclass) NOT LIKE '%per_date%' THEN
    RAISE EXCEPTION 'issue #3827 pending-email index postcheck failed';
  END IF;
END;
$postcheck$;

COMMIT;
NOTIFY pgrst, 'reload schema';
