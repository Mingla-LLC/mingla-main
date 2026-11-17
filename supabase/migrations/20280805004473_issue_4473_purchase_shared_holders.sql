-- Issue #4473 — one purchase shows on every account that proved its contact.
--
-- Until now a purchase had exactly one consumer owner: the first account that
-- proved the purchase email or phone (`orders.buyer_user_id`,
-- `event_rsvps.user_id`, `event_rsvp_guests.matched_user_id`,
-- `reservations.consumer_user_id`, `stay_reservation_groups.user_id`,
-- `venue_orders.buyer_user_id`). A person with two Mingla accounts saw the
-- purchase on only one of them.
--
-- This file adds a second, read-only way to hold a purchase:
--
--   * `purchase_shared_holders` — one row per (kind, source, account) for an
--     account that proved the purchase contact after another account already
--     owned it. One generic table, not one per kind: every kind has the same
--     rule (owner present, holder is someone else, holder proves the contact
--     NOW), the same lifecycle, and one shape for the #4459 Guest chat hook and
--     the app. The kind column is CHECKed and every reader resolves the source
--     through one function, so a new kind is a CHECK value plus one CASE arm.
--   * Visibility is LIVE: a row counts only while
--     `account_owns_contact(holder, purchase email, purchase phone)` is true.
--     Losing the contact (revoked extra, number moved, yearly expiry) removes
--     the purchase with no other step. Rows are also revoked eagerly where the
--     database itself removes a proof, for history.
--   * The owner stays the only writer: sending, taking back, cancelling,
--     refunding, intake answers and show-me-as-going keep their owner checks.
--   * A shared holder never reads the purchase tables directly. Table RLS is
--     NOT widened. The holder reads one SECURITY DEFINER RPC,
--     `pg_my_shared_purchases()`, which returns event, ticket, pass and state
--     fields only: no buyer or guest name, email, phone, card, amount or notes.
--   * Writer: `issue_4473_share_purchases_by_verified_identity`, called by the
--     claim edge functions after the ordinary identity sweep. The two claim
--     functions are not edited here.
--
-- Contact rules that change:
--   * Claim-only extra contacts (`account_claim_contacts`) may now be held by
--     more than one account. They count as proof for 12 months after they were
--     last proved by code (`last_proved_at`); proving again refreshes them.
--   * `record_verified_phone` revokes other accounts' extras for a number only
--     when the number's ledger row is created or moves to a different account.
--     A re-verification by the account that already holds it revokes nothing.
--
-- The #4459 brand Guest chat (if present) is patched to treat a live shared
-- holder like an owner, through `issue_4473_shared_brand_guest`.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── 1. Claim-only extras: many holders, yearly proof ───────────────────────
ALTER TABLE public.account_claim_contacts
  ADD COLUMN IF NOT EXISTS last_proved_at timestamptz;
UPDATE public.account_claim_contacts
   SET last_proved_at = verified_at
 WHERE last_proved_at IS NULL;
ALTER TABLE public.account_claim_contacts
  ALTER COLUMN last_proved_at SET DEFAULT now(),
  ALTER COLUMN last_proved_at SET NOT NULL;

COMMENT ON COLUMN public.account_claim_contacts.last_proved_at IS
  '#4473: when this extra was last proved by a code. It counts as proof for 12 months from here; proving it again refreshes it.';

DROP INDEX IF EXISTS public.account_claim_contacts_one_live_owner;
CREATE UNIQUE INDEX IF NOT EXISTS account_claim_contacts_one_live_per_user
  ON public.account_claim_contacts (user_id, channel, value)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_claim_contacts_live_value
  ON public.account_claim_contacts (channel, value)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.account_claim_contacts IS
  '#4063 decision 2, #4473: extra emails/phones proved by a code, used ONLY to claim purchases. Several accounts may hold the same extra. Each counts for 12 months after last_proved_at. Never read by verified_account_identifiers. Written by issue_4063_record_claim_contact; revoked (phone) by record_verified_phone when the number''s ledger owner changes.';

-- One patch helper: replace one exact fragment, or no-op when already patched.
CREATE FUNCTION pg_temp.issue_4473_share_patch(
  p_sig regprocedure, p_old text, p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_new_count := (length(v_def) - length(replace(v_def, p_new, '')))
    / length(p_new);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, '')))
    / length(p_old);
  IF v_new_count = 1 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION
      'issue_4473: % has % unpatched and % patched fragments; expected exactly one unpatched',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$fn$;

-- account_owns_contact: an extra counts only within 12 months of its last proof.
SELECT pg_temp.issue_4473_share_patch(
  'public.account_owns_contact(uuid,text,text)'::regprocedure,
  'AND c.revoked_at IS NULL',
  'AND c.revoked_at IS NULL AND c.last_proved_at >= now() - interval ''12 months'''
);

CREATE OR REPLACE FUNCTION public.issue_4063_contact_conflict(
  p_user_id uuid, p_channel text, p_value text
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_value text;
BEGIN
  IF p_user_id IS NULL OR p_channel NOT IN ('email','phone') THEN
    RETURN 'invalid';
  END IF;
  v_value := CASE WHEN p_channel = 'email'
    THEN lower(btrim(coalesce(p_value, '')))
    ELSE btrim(coalesce(p_value, '')) END;
  IF (p_channel = 'email' AND v_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (p_channel = 'phone' AND v_value !~ '^\+[1-9][0-9]{1,14}$') THEN
    RETURN 'invalid';
  END IF;
  IF public.account_owns_contact(
    p_user_id,
    CASE WHEN p_channel = 'email' THEN v_value END,
    CASE WHEN p_channel = 'phone' THEN v_value END
  ) THEN
    RETURN 'already_on_this_account';
  END IF;

  -- #4473: a contact proved by another account no longer blocks this one.
  -- Each account proves it with its own code; purchases then show on both.
  IF NOT EXISTS (
    SELECT 1 FROM public.account_claim_contacts c
     WHERE c.user_id = p_user_id AND c.revoked_at IS NULL
       AND c.channel = p_channel AND c.value = v_value
  ) AND (
    SELECT count(*) FROM public.account_claim_contacts c
     WHERE c.user_id = p_user_id AND c.revoked_at IS NULL
       AND c.last_proved_at >= now() - interval '12 months'
  ) >= 5 THEN
    RETURN 'limit_reached';
  END IF;
  RETURN 'available';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_record_claim_contact(
  p_user_id uuid, p_channel text, p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_value text;
  v_result text;
  v_try integer;
BEGIN
  v_value := CASE WHEN p_channel = 'email'
    THEN lower(btrim(coalesce(p_value, '')))
    ELSE btrim(coalesce(p_value, '')) END;
  v_result := public.issue_4063_contact_conflict(p_user_id, p_channel, v_value);
  IF v_result = 'already_on_this_account' THEN
    -- A fresh code was read: restart the yearly clock on an existing extra.
    UPDATE public.account_claim_contacts
       SET last_proved_at = now()
     WHERE user_id = p_user_id AND channel = p_channel AND value = v_value
       AND revoked_at IS NULL;
    RETURN jsonb_build_object('result', v_result);
  END IF;
  IF v_result <> 'available' THEN
    RETURN jsonb_build_object('result', v_result);
  END IF;

  FOR v_try IN 1..2 LOOP
    BEGIN
      UPDATE public.account_claim_contacts
         SET last_proved_at = now(), verified_at = now(),
             verified_via = CASE WHEN p_channel = 'email'
               THEN 'email_code' ELSE 'twilio_verify' END
       WHERE user_id = p_user_id AND channel = p_channel AND value = v_value
         AND revoked_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object('result', 'recorded');
      END IF;
      INSERT INTO public.account_claim_contacts(
        user_id, channel, value, verified_via, last_proved_at
      ) VALUES (
        p_user_id, p_channel, v_value,
        CASE WHEN p_channel = 'email' THEN 'email_code' ELSE 'twilio_verify' END,
        now()
      );
      RETURN jsonb_build_object('result', 'recorded');
    EXCEPTION WHEN unique_violation THEN
      IF v_try = 2 THEN
        RETURN jsonb_build_object('result', 'retry');
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('result', 'retry');
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_my_claim_identifiers()
 RETURNS TABLE(kind text, value text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT ON (x.kind, x.value) x.kind, x.value, x.source
    FROM (
      SELECT v.kind, v.value, 'account'::text AS source
        FROM public.verified_account_identifiers(auth.uid()) v
       WHERE public.account_owns_contact(
         auth.uid(),
         CASE WHEN v.kind = 'email' THEN v.value END,
         CASE WHEN v.kind = 'phone' THEN v.value END
       )
      UNION ALL
      SELECT c.channel, c.value, 'added'::text
        FROM public.account_claim_contacts c
       WHERE c.user_id = auth.uid() AND c.revoked_at IS NULL
         AND c.last_proved_at >= now() - interval '12 months'
    ) x
   ORDER BY x.kind, x.value,
     CASE WHEN x.source = 'added' THEN 0 ELSE 1 END;
$function$;

-- ── 2. The shared-holder table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_shared_holders (
  kind text NOT NULL CHECK (kind IN (
    'order', 'rsvp', 'rsvp_guest', 'reservation', 'stay_group', 'venue_order'
  )),
  source_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proved_via text NOT NULL DEFAULT 'identity_sweep'
    CHECK (proved_via IN ('identity_sweep')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reshared_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_reason text NULL CHECK (revoked_reason IN ('contact_lost')),
  PRIMARY KEY (kind, source_id, user_id),
  CONSTRAINT purchase_shared_holders_revoked_pair
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS purchase_shared_holders_user_live
  ON public.purchase_shared_holders (user_id, kind, source_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.purchase_shared_holders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_shared_holders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_shared_holders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.purchase_shared_holders
  TO service_role;

COMMENT ON TABLE public.purchase_shared_holders IS
  '#4473: accounts that proved a purchase''s email or phone after another account owned it. Read-only holders. A row counts only while issue_4473_holder_proves() is true. Written only by issue_4473_share_purchases_by_verified_identity. No client access; holders read pg_my_shared_purchases().';

-- Prefilter indexes for owned rows (the #4063 ones cover unowned rows only).
CREATE INDEX IF NOT EXISTS orders_4473_owned_email_idx
  ON public.orders (lower(btrim(buyer_email))) WHERE buyer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_4473_owned_phone_idx
  ON public.orders (buyer_phone_e164) WHERE buyer_user_id IS NOT NULL;

-- ── 3. Source lookup and the live predicate ────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4473_purchase_contact(
  p_kind text, p_source_id uuid,
  OUT owner_id uuid, OUT email text, OUT phone text, OUT source_found boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  source_found := false;
  IF p_source_id IS NULL THEN RETURN; END IF;
  IF p_kind = 'order' THEN
    SELECT o.buyer_user_id, o.buyer_email, o.buyer_phone_e164, true
      INTO owner_id, email, phone, source_found
      FROM public.orders o WHERE o.id = p_source_id;
  ELSIF p_kind = 'rsvp' THEN
    SELECT r.user_id, r.guest_email, r.guest_phone, true
      INTO owner_id, email, phone, source_found
      FROM public.event_rsvps r WHERE r.id = p_source_id;
  ELSIF p_kind = 'rsvp_guest' THEN
    SELECT g.matched_user_id, g.email, g.phone, true
      INTO owner_id, email, phone, source_found
      FROM public.event_rsvp_guests g WHERE g.id = p_source_id;
  ELSIF p_kind = 'reservation' THEN
    SELECT r.consumer_user_id, r.guest_email, r.guest_phone_e164, true
      INTO owner_id, email, phone, source_found
      FROM public.reservations r WHERE r.id = p_source_id;
  ELSIF p_kind = 'stay_group' THEN
    SELECT g.user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone', true
      INTO owner_id, email, phone, source_found
      FROM public.stay_reservation_groups g WHERE g.id = p_source_id;
  ELSIF p_kind = 'venue_order' THEN
    SELECT vo.buyer_user_id, vo.buyer_email, vo.buyer_phone_e164, true
      INTO owner_id, email, phone, source_found
      FROM public.venue_orders vo WHERE vo.id = p_source_id;
  END IF;
  source_found := coalesce(source_found, false);
END;
$function$;

-- True when p_user_id may hold this purchase as a shared holder right now:
-- the purchase exists, another account owns it, and p_user_id proves its
-- email or phone today (the same predicate that made the owner the owner).
CREATE OR REPLACE FUNCTION public.issue_4473_holder_proves(
  p_kind text, p_source_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v record;
BEGIN
  IF p_kind IS NULL OR p_source_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v FROM public.issue_4473_purchase_contact(p_kind, p_source_id);
  IF v.source_found IS NOT TRUE OR v.owner_id IS NULL OR v.owner_id = p_user_id THEN
    RETURN false;
  END IF;
  RETURN public.account_owns_contact(p_user_id, v.email, v.phone);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4473_purchase_shared_with(
  p_kind text, p_source_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_shared_holders s
     WHERE s.user_id = p_user_id AND s.kind = p_kind
       AND s.source_id = p_source_id AND s.revoked_at IS NULL
  ) THEN
    RETURN false;
  END IF;
  RETURN public.issue_4473_holder_proves(p_kind, p_source_id, p_user_id);
END;
$function$;

-- A row can only become live for an account that proves the contact.
CREATE OR REPLACE FUNCTION public.tg_purchase_shared_holders_4473_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
  ) THEN
    RAISE EXCEPTION 'shared_holder_key_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.revoked_at IS NOT NULL)
     AND NOT public.issue_4473_holder_proves(NEW.kind, NEW.source_id, NEW.user_id)
  THEN
    RAISE EXCEPTION 'shared_holder_must_own_contact' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS purchase_shared_holders_4473_guard
  ON public.purchase_shared_holders;
CREATE TRIGGER purchase_shared_holders_4473_guard
BEFORE INSERT OR UPDATE ON public.purchase_shared_holders
FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_shared_holders_4473_guard();

-- Eager revocation, for history. Readers never rely on it.
CREATE OR REPLACE FUNCTION public.issue_4473_revoke_unproved_shares(
  p_user_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.purchase_shared_holders s
     SET revoked_at = now(), revoked_reason = 'contact_lost'
   WHERE s.user_id = ANY(coalesce(p_user_ids, '{}'::uuid[]))
     AND s.revoked_at IS NULL
     AND NOT public.issue_4473_holder_proves(s.kind, s.source_id, s.user_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ── 4. Phone ledger: revoke others' extras only when ownership changes ──────
CREATE OR REPLACE FUNCTION public.record_verified_phone(p_user_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
  v_prior uuid;
  v_affected uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  v_phone := '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RETURN jsonb_build_object('result', 'unknown_user');
  END IF;

  SELECT v.user_id INTO v_prior
    FROM public.verified_phone_identities v
   WHERE v.phone_e164 = v_phone;

  DELETE FROM public.verified_phone_identities
   WHERE phone_e164 = v_phone AND user_id <> p_user_id;

  -- #4473: the number is new to this account (first proof, or it moved from
  -- another account), so every other account's claim-only proof of it ends.
  -- A re-verification by the account that already holds it ends nothing.
  IF v_prior IS DISTINCT FROM p_user_id THEN
    WITH revoked AS (
      UPDATE public.account_claim_contacts
         SET revoked_at = now()
       WHERE channel = 'phone'
         AND value = v_phone
         AND user_id <> p_user_id
         AND revoked_at IS NULL
      RETURNING user_id
    )
    SELECT array_agg(DISTINCT user_id) INTO v_affected FROM revoked;
  END IF;

  INSERT INTO public.verified_phone_identities AS v (
    user_id, phone_e164, verified_at
  ) VALUES (
    p_user_id, v_phone, now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET phone_e164 = EXCLUDED.phone_e164,
        verified_at = EXCLUDED.verified_at;

  PERFORM public.issue_4473_revoke_unproved_shares(
    coalesce(v_affected, '{}'::uuid[])
      || CASE WHEN v_prior IS NOT NULL AND v_prior <> p_user_id
           THEN ARRAY[v_prior] ELSE '{}'::uuid[] END
      || ARRAY[p_user_id]
  );

  RETURN jsonb_build_object('result', 'recorded', 'phone', v_phone);
END;
$function$;

-- ── 5. The writer ──────────────────────────────────────────────────────────
-- Same eligibility windows as the ordinary identity sweep, for purchases that
-- another account already owns. Service role only.
CREATE OR REPLACE FUNCTION public.issue_4473_share_purchases_by_verified_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_more boolean := false;
  v_pass integer;
  v_conv uuid;
  v_brand uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object('claimed', v_claimed, 'count', 0, 'more', false);
  END IF;

  -- Orders (tickets, trips, experiences, door receipts and comps).
  v_pass := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, o.door_payment_method, e.event_type,
           e.title, e.brand_id,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NOT NULL
       AND o.buyer_user_id <> p_user_id
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'order' AND s.source_id = o.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, o.buyer_email, o.buyer_phone_e164)
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (NOT public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('order', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;

    -- The single chat writer: before #4459 this joins the event chat; after
    -- #4459 it syncs the brand Guest chat, which reads shared holders too.
    PERFORM public.add_buyer_to_event_chat(v_row.event_id, p_user_id, NULL, NULL);
    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE (c.event_id = v_row.event_id
            AND c.linked_entity_type IN ('trip', 'event'))
        OR (c.linked_entity_type = 'brand_guests'
            AND to_jsonb(c)->>'brand_id' = v_row.brand_id::text)
     ORDER BY CASE WHEN c.event_id = v_row.event_id THEN 0 ELSE 1 END
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source = 'comp'
          OR public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- RSVP primaries owned by another account.
  v_pass := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NOT NULL AND r.user_id <> p_user_id
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'rsvp' AND s.source_id = r.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, r.guest_email, r.guest_phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
     ORDER BY r.created_at, r.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('rsvp', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- RSVP plus-ones matched to another account.
  v_pass := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NOT NULL AND g.matched_user_id <> p_user_id
       AND r.user_id IS DISTINCT FROM p_user_id
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'rsvp_guest' AND s.source_id = g.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
     ORDER BY g.created_at, g.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('rsvp_guest', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Venue reservations.
  v_pass := 0;
  FOR v_row IN
    SELECT r.id, r.reserved_for, r.party_size, vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NOT NULL AND r.consumer_user_id <> p_user_id
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'reservation' AND s.source_id = r.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, r.guest_email, r.guest_phone_e164)
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('reservation', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Stay groups.
  v_pass := 0;
  FOR v_row IN
    SELECT g.id, vl.name AS title
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NOT NULL AND g.user_id <> p_user_id
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'stay_group' AND s.source_id = g.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone')
     ORDER BY g.created_at, g.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('stay_group', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Mingla food and drink orders.
  v_pass := 0;
  FOR v_row IN
    SELECT vo.id, vo.created_at, vo.pickup_code, vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NOT NULL AND vo.buyer_user_id <> p_user_id
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'venue_order' AND s.source_id = vo.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, vo.buyer_email, vo.buyer_phone_e164)
     ORDER BY vo.created_at, vo.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('venue_order', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

-- ── 6. Reads for the shared holder (safe fields only) ──────────────────────
CREATE OR REPLACE FUNCTION public.pg_my_shared_purchases()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Orders: event facts, unsent tickets with their QR, and state. Never the
  -- buyer's name, email, phone, card, amounts or intake answers.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT o.created_at, jsonb_build_object(
        'kind', 'order', 'sourceId', o.id, 'orderId', o.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'eventId', e.id, 'eventSlug', e.slug, 'title', e.title,
        'offeringType', e.event_type,
        'coverMediaUrl', e.cover_media_url, 'coverMediaType', e.cover_media_type,
        'timezone', e.timezone, 'locationText', e.location_text,
        'city', e.city, 'isOnline', e.is_online, 'onlineUrl', e.online_url,
        'brand', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
        'eventDateId', o.event_date_id, 'bookedStartAt', o.booked_start_at,
        'eventDates', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id, 'startAt', d.start_at, 'endAt', d.end_at,
            'isMaster', d.is_master) ORDER BY d.start_at, d.id)
            FROM public.event_dates d WHERE d.event_id = e.id), '[]'::jsonb),
        'paymentStatus', o.payment_status, 'cancelledAt', o.cancelled_at,
        'source', CASE
          WHEN o.source = 'comp'
            OR public.issue_4271_is_door_order(o.source, o.door_payment_method)
            THEN 'door'
          ELSE 'purchase' END,
        'createdAt', o.created_at,
        'tickets', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'ticketIndex', t.ticket_index,
            'ticketTypeId', t.ticket_type_id, 'ticketTypeName', tt.name,
            'status', t.status, 'approvalStatus', t.approval_status,
            'transferState', t.transfer_state,
            'qrCode', CASE WHEN t.holder_user_id IS NULL THEN t.qr_code END,
            'eventDateIds', coalesce((
              SELECT jsonb_agg(ted.event_date_id ORDER BY ted.event_date_id)
                FROM public.ticket_event_dates ted WHERE ted.ticket_id = t.id),
              '[]'::jsonb)
          ) ORDER BY t.ticket_index)
            FROM (
              SELECT x.*, row_number() OVER (ORDER BY x.created_at, x.id)::integer
                       AS ticket_index
                FROM public.tickets x WHERE x.order_id = o.id
            ) t
            LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id),
          '[]'::jsonb)
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.orders o ON s.kind = 'order' AND o.id = s.source_id
        JOIN public.events e ON e.id = o.event_id AND e.deleted_at IS NULL
        JOIN public.brands b ON b.id = e.brand_id
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('order', o.id, v_uid)
    ) orders_x;

  -- RSVP primaries: the pass QR and state. Never the guest's name or contact.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT r.created_at, jsonb_build_object(
        'kind', 'rsvp', 'sourceId', r.id, 'rsvpId', r.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'eventId', e.id, 'eventSlug', e.slug, 'title', e.title,
        'offeringType', 'rsvp',
        'coverMediaUrl', e.cover_media_url, 'coverMediaType', e.cover_media_type,
        'timezone', coalesce(master.timezone, e.timezone),
        'locationText', e.location_text, 'city', e.city,
        'brand', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
        'startsAt', master.start_at, 'endsAt', master.end_at,
        'rsvpStatus', r.rsvp_status, 'approvalStatus', r.approval_status,
        'quantity', 1 + coalesce(r.plus_count, 0),
        'qrCode', r.qr_code, 'checkedIn', r.checked_in_at IS NOT NULL,
        'createdAt', r.created_at
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.event_rsvps r ON s.kind = 'rsvp' AND r.id = s.source_id
        JOIN public.events e ON e.id = r.event_id AND e.deleted_at IS NULL
        JOIN public.brands b ON b.id = e.brand_id
        LEFT JOIN LATERAL (
          SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
           WHERE d.event_id = e.id AND d.is_master IS TRUE
           ORDER BY d.start_at, d.id LIMIT 1
        ) master ON true
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('rsvp', r.id, v_uid)
    ) rsvps_x;

  -- RSVP plus-ones.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT g.created_at, jsonb_build_object(
        'kind', 'rsvp_guest', 'sourceId', g.id, 'rsvpId', r.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'eventId', e.id, 'eventSlug', e.slug, 'title', e.title,
        'offeringType', 'rsvp',
        'coverMediaUrl', e.cover_media_url, 'coverMediaType', e.cover_media_type,
        'timezone', coalesce(master.timezone, e.timezone),
        'locationText', e.location_text, 'city', e.city,
        'brand', jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name),
        'startsAt', master.start_at, 'endsAt', master.end_at,
        'rsvpStatus', r.rsvp_status, 'approvalStatus', r.approval_status,
        'quantity', 1,
        'qrCode', g.qr_code, 'checkedIn', g.checked_in_at IS NOT NULL,
        'createdAt', g.created_at
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.event_rsvp_guests g ON s.kind = 'rsvp_guest' AND g.id = s.source_id
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
        JOIN public.events e ON e.id = r.event_id AND e.deleted_at IS NULL
        JOIN public.brands b ON b.id = e.brand_id
        LEFT JOIN LATERAL (
          SELECT d.start_at, d.end_at, d.timezone FROM public.event_dates d
           WHERE d.event_id = e.id AND d.is_master IS TRUE
           ORDER BY d.start_at, d.id LIMIT 1
        ) master ON true
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('rsvp_guest', g.id, v_uid)
    ) guests_x;

  -- Reservations: venue, time, party size, state. Never notes or fees.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT r.created_at, jsonb_build_object(
        'kind', 'reservation', 'sourceId', r.id, 'reservationId', r.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'venueId', r.venue_id, 'venueName', vl.name, 'title', vl.name,
        'offeringType', 'venue',
        'startsAt', r.reserved_for, 'partySize', r.party_size,
        'status', r.status,
        'timezone', CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
          ELSE vac.iana_timezone END,
        'createdAt', r.created_at
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.reservations r ON s.kind = 'reservation' AND r.id = s.source_id
        LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
        LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('reservation', r.id, v_uid)
    ) reservations_x;

  -- Stay groups: venue, reference and state. Never the guest snapshot or totals.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT g.created_at, jsonb_build_object(
        'kind', 'stay_group', 'sourceId', g.id, 'stayGroupId', g.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'venueId', g.venue_id, 'venueName', vl.name, 'title', vl.name,
        'offeringType', 'stay',
        'publicReference', g.public_reference, 'state', g.state, 'mode', g.mode,
        'createdAt', g.created_at
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.stay_reservation_groups g ON s.kind = 'stay_group' AND g.id = s.source_id
        LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('stay_group', g.id, v_uid)
    ) stays_x;

  -- Food and drink orders: venue, pickup code, item count and state. Never amounts.
  SELECT v_items || coalesce(jsonb_agg(item ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT vo.created_at, jsonb_build_object(
        'kind', 'venue_order', 'sourceId', vo.id, 'venueOrderId', vo.id,
        'role', 'shared', 'sharedWithAnotherAccount', true,
        'sharedAt', coalesce(s.reshared_at, s.created_at),
        'venueId', vo.venue_id, 'venueName', vl.name, 'title', vl.name,
        'offeringType', 'food',
        'pickupCode', vo.pickup_code,
        'orderLabel', CASE WHEN btrim(coalesce(vo.pickup_code, '')) <> ''
          THEN 'Order #' || vo.pickup_code
          ELSE 'Order ' || upper(substr(replace(vo.id::text, '-', ''), 1, 8)) END,
        'paymentStatus', vo.payment_status,
        'fulfillmentStatus', vo.fulfillment_status,
        'quantity', coalesce((SELECT sum(i.quantity)::integer
          FROM public.venue_order_items i WHERE i.venue_order_id = vo.id), 0),
        'createdAt', vo.created_at
      ) AS item
        FROM public.purchase_shared_holders s
        JOIN public.venue_orders vo ON s.kind = 'venue_order' AND vo.id = s.source_id
        LEFT JOIN public.venue_listings vl ON vl.id = vo.venue_id
       WHERE s.user_id = v_uid AND s.revoked_at IS NULL
         AND public.issue_4473_holder_proves('venue_order', vo.id, v_uid)
    ) venue_orders_x;

  RETURN v_items;
END;
$function$;

-- For the owner: which of my purchases also show on another account now.
CREATE OR REPLACE FUNCTION public.pg_my_purchase_share_flags()
RETURNS TABLE(kind text, source_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT s.kind, s.source_id
    FROM public.purchase_shared_holders s
    CROSS JOIN LATERAL public.issue_4473_purchase_contact(s.kind, s.source_id) c
   WHERE auth.uid() IS NOT NULL
     AND s.revoked_at IS NULL
     AND c.source_found AND c.owner_id = auth.uid()
     AND public.issue_4473_holder_proves(s.kind, s.source_id, s.user_id);
$function$;

-- ── 7. Event facts a shared holder may read (no buyer data on these rows) ──
CREATE OR REPLACE FUNCTION public.consumer_can_read_event_for_caller(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.event_id = p_event_id
          AND o.buyer_user_id = auth.uid()
          AND o.payment_status IN (
            'paid', 'pending', 'partial_refund', 'refunded', 'cancelled'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.tickets t
        WHERE t.event_id = p_event_id
          -- The deliberately filtered pre-#1931 replay omits the later
          -- send-to-friend migration that adds holder_user_id. Reading the
          -- optional field through the whole-row JSON keeps that historical
          -- replay buildable while remaining exactly equivalent on the live
          -- schema, where the UUID column exists.
          AND to_jsonb(t)->>'holder_user_id' = auth.uid()::text
      )
      -- #4473: a live shared holder of an order or RSVP on this event.
      OR EXISTS (
        SELECT 1
          FROM public.purchase_shared_holders s
          JOIN public.orders o ON o.id = s.source_id
         WHERE s.user_id = auth.uid() AND s.kind = 'order'
           AND s.revoked_at IS NULL AND o.event_id = p_event_id
           AND public.issue_4473_holder_proves('order', o.id, auth.uid())
      )
      OR EXISTS (
        SELECT 1
          FROM public.purchase_shared_holders s
          JOIN public.event_rsvps r ON r.id = s.source_id
         WHERE s.user_id = auth.uid() AND s.kind = 'rsvp'
           AND s.revoked_at IS NULL AND r.event_id = p_event_id
           AND public.issue_4473_holder_proves('rsvp', r.id, auth.uid())
      )
      OR EXISTS (
        SELECT 1
          FROM public.purchase_shared_holders s
          JOIN public.event_rsvp_guests g ON g.id = s.source_id
          JOIN public.event_rsvps r ON r.id = g.rsvp_id
         WHERE s.user_id = auth.uid() AND s.kind = 'rsvp_guest'
           AND s.revoked_at IS NULL AND r.event_id = p_event_id
           AND public.issue_4473_holder_proves('rsvp_guest', g.id, auth.uid())
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4420_caller_reads_exact_stops(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.events e
       WHERE e.id = p_event_id
         AND e.deleted_at IS NULL
         AND (
           public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.orders o
              WHERE o.event_id = e.id
                AND o.buyer_user_id = auth.uid()
                AND o.payment_status IN ('paid', 'partial_refund'))
           OR EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = e.id
                AND t.holder_user_id = auth.uid()
                AND t.status IN ('valid', 'used'))
           -- #4473: a live shared holder of a paid order on this event.
           OR EXISTS (
             SELECT 1 FROM public.purchase_shared_holders s
               JOIN public.orders o ON o.id = s.source_id
              WHERE s.user_id = auth.uid() AND s.kind = 'order'
                AND s.revoked_at IS NULL AND o.event_id = e.id
                AND o.payment_status IN ('paid', 'partial_refund')
                AND public.issue_4473_holder_proves('order', o.id, auth.uid()))
         )
    )
$function$;

-- ── 8. The #4459 brand Guest chat ──────────────────────────────────────────
-- A live shared holder counts as a guest of the brand exactly where an owner
-- would: a paid order, or a going + server-approved RSVP / plus-one.
CREATE OR REPLACE FUNCTION public.issue_4473_shared_brand_guest(
  p_brand_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1
      FROM public.purchase_shared_holders s
      JOIN public.orders o ON s.kind = 'order' AND o.id = s.source_id
      JOIN public.events e ON e.id = o.event_id
     WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
       AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
       AND o.payment_status IN ('paid', 'partial_refund')
       AND public.issue_4473_holder_proves('order', o.id, p_user_id)
  ) THEN
    RETURN true;
  END IF;
  IF to_regclass('public.issue_4459_rsvp_server_approvals') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE $q$
    SELECT EXISTS (
      SELECT 1
        FROM public.purchase_shared_holders s
        JOIN public.event_rsvps r ON s.kind = 'rsvp' AND r.id = s.source_id
        JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
        JOIN public.events e ON e.id = r.event_id
       WHERE s.user_id = $2 AND s.revoked_at IS NULL
         AND e.brand_id = $1 AND e.deleted_at IS NULL
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         AND public.issue_4473_holder_proves('rsvp', r.id, $2)
    ) OR EXISTS (
      SELECT 1
        FROM public.purchase_shared_holders s
        JOIN public.event_rsvp_guests g ON s.kind = 'rsvp_guest' AND g.id = s.source_id
        JOIN public.event_rsvps r ON r.id = g.rsvp_id
        JOIN public.issue_4459_rsvp_server_approvals sa ON sa.rsvp_id = r.id
        JOIN public.events e ON e.id = r.event_id
       WHERE s.user_id = $2 AND s.revoked_at IS NULL
         AND e.brand_id = $1 AND e.deleted_at IS NULL
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         AND public.issue_4473_holder_proves('rsvp_guest', g.id, $2)
    )
  $q$ INTO v_ok USING p_brand_id, p_user_id;
  RETURN coalesce(v_ok, false);
END;
$function$;

-- Keep the Guest chat in step when a share starts or ends (no-op before #4459).
CREATE OR REPLACE FUNCTION public.tg_purchase_shared_holders_4473_guest_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.purchase_shared_holders%ROWTYPE;
  v_brand uuid;
BEGIN
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL THEN
    RETURN NULL;
  END IF;
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF v_row.kind = 'order' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE o.id = v_row.source_id;
  ELSIF v_row.kind = 'rsvp' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
     WHERE r.id = v_row.source_id;
  ELSIF v_row.kind = 'rsvp_guest' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
     WHERE g.id = v_row.source_id;
  END IF;
  IF v_brand IS NOT NULL THEN
    EXECUTE 'SELECT public.issue_4459_safe_sync($1, $2, $3)'
      USING v_brand, v_row.user_id, 'purchase_share';
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS purchase_shared_holders_4473_guest_sync
  ON public.purchase_shared_holders;
CREATE TRIGGER purchase_shared_holders_4473_guest_sync
AFTER INSERT OR UPDATE OF revoked_at OR DELETE ON public.purchase_shared_holders
FOR EACH ROW EXECUTE FUNCTION public.tg_purchase_shared_holders_4473_guest_sync();

-- If #4459 is already applied, its eligibility also accepts a shared holder.
CREATE FUNCTION pg_temp.issue_4473_hook_brand_guest()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF to_regprocedure('public.issue_4459_brand_guest_eligible(uuid,uuid)') IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_temp.issue_4473_share_patch(
    'public.issue_4459_brand_guest_eligible(uuid,uuid)'::regprocedure,
    'SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND (',
    'SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL AND (public.issue_4473_shared_brand_guest(p_brand_id, p_user_id) OR '
  );
END;
$fn$;
SELECT pg_temp.issue_4473_hook_brand_guest();
DROP FUNCTION pg_temp.issue_4473_hook_brand_guest();
DROP FUNCTION pg_temp.issue_4473_share_patch(regprocedure, text, text);

-- ── 8b. Claim link: a signed-in account proves the purchase's own contact ──
-- "Is this your ticket?": the code goes to the email or phone stored on the
-- purchase behind a claim link. The client never supplies or sees the value.
-- On success the edge records it with issue_4063_record_claim_contact, so the
-- yearly rule and the many-accounts rule apply, then runs the sweeps.
ALTER TABLE public.contact_challenges
  DROP CONSTRAINT IF EXISTS contact_challenges_purpose_check;
ALTER TABLE public.contact_challenges
  ADD CONSTRAINT contact_challenges_purpose_check
  CHECK (purpose IN ('claim_sign_in', 'add_contact', 'claim_add_contact'));
ALTER TABLE public.contact_challenges
  DROP CONSTRAINT IF EXISTS contact_challenges_shape;
ALTER TABLE public.contact_challenges
  ADD CONSTRAINT contact_challenges_shape CHECK (
    (purpose = 'add_contact' AND user_id IS NOT NULL AND claim_code IS NULL)
    OR (purpose = 'claim_sign_in' AND user_id IS NULL
        AND claim_code IS NOT NULL AND channel = 'email')
    OR (purpose = 'claim_add_contact' AND user_id IS NOT NULL
        AND claim_code IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.issue_4473_begin_claim_link_contact_challenge(
  p_challenge_id uuid, p_user_id uuid, p_claim_code text, p_channel text,
  p_code_hash text, p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claim text := upper(btrim(coalesce(p_claim_code, '')));
  v_link public.claim_links%ROWTYPE;
  v_subject jsonb;
  v_value text;
  v_conflict text;
BEGIN
  IF p_challenge_id IS NULL OR p_user_id IS NULL
     OR p_channel NOT IN ('email', 'phone')
     OR v_claim !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  SELECT * INTO v_link FROM public.claim_links l
   WHERE l.code = v_claim AND l.purpose = 'claim' AND l.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  IF v_link.expires_at < now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  v_subject := CASE WHEN v_link.subject_kind = 'ticket'
    THEN public.issue_4063_ticket_claim_subject(v_link.subject_id)
    ELSE public.issue_4063_claim_subject(v_link.subject_kind, v_link.subject_id)
    END;
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  v_value := CASE WHEN p_channel = 'email'
    THEN lower(btrim(coalesce(v_subject->>'email', '')))
    ELSE btrim(coalesce(v_subject->>'phone', '')) END;
  IF (p_channel = 'email'
        AND v_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (p_channel = 'phone' AND v_value !~ '^\+[1-9][0-9]{1,14}$') THEN
    RETURN jsonb_build_object('outcome',
      CASE WHEN p_channel = 'email' THEN 'no_email' ELSE 'no_phone' END);
  END IF;

  v_conflict := public.issue_4063_contact_conflict(p_user_id, p_channel, v_value);
  IF v_conflict = 'already_on_this_account' THEN
    RETURN jsonb_build_object('outcome', v_conflict, 'channel', p_channel);
  END IF;
  IF v_conflict <> 'available' THEN
    RETURN jsonb_build_object('outcome', v_conflict);
  END IF;

  IF (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.user_id = p_user_id
       AND c.created_at > now() - interval '10 minutes'
  ) >= 5 OR (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.user_id = p_user_id
       AND c.created_at > now() - interval '24 hours'
  ) >= 20 OR (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.claim_code = v_claim AND c.user_id = p_user_id
       AND c.created_at > now() - interval '10 minutes'
  ) >= 3 OR (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.target_value = v_value
       AND c.purpose IN ('claim_add_contact', 'claim_sign_in')
       AND c.created_at > now() - interval '24 hours'
  ) >= 20 OR (p_channel = 'phone' AND (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.channel = 'phone' AND c.target_value = v_value
       AND c.created_at > now() - interval '10 minutes'
  ) >= 2) OR (p_ip_hash IS NOT NULL AND (
    SELECT count(*) FROM public.contact_challenges c
     WHERE c.ip_hash = p_ip_hash
       AND c.created_at > now() - interval '10 minutes'
  ) >= 10) THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;

  IF p_channel = 'email' AND nullif(btrim(coalesce(p_code_hash, '')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  INSERT INTO public.contact_challenges(
    id, purpose, channel, user_id, claim_code, target_value, code_hash, ip_hash
  ) VALUES (
    p_challenge_id, 'claim_add_contact', p_channel, p_user_id, v_claim,
    v_value, CASE WHEN p_channel = 'email' THEN p_code_hash END, p_ip_hash
  );
  RETURN jsonb_build_object(
    'outcome', 'started', 'challengeId', p_challenge_id,
    'channel', p_channel, 'target', v_value
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('outcome', 'invalid');
END;
$function$;

-- The pending challenge's channel and value, for the edge only (to check a
-- phone code with the provider). Never returned to a client.
CREATE OR REPLACE FUNCTION public.issue_4473_claim_link_challenge_for_user(
  p_challenge_id uuid, p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'outcome', 'ok', 'channel', c.channel, 'value', c.target_value
    )
      FROM public.contact_challenges c
     WHERE c.id = p_challenge_id AND c.purpose = 'claim_add_contact'
       AND c.user_id = p_user_id AND c.consumed_at IS NULL
  ), jsonb_build_object('outcome', 'invalid'));
$function$;

REVOKE ALL ON FUNCTION public.issue_4473_begin_claim_link_contact_challenge(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_claim_link_challenge_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4473_begin_claim_link_contact_challenge(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_claim_link_challenge_for_user(uuid, uuid) TO service_role;

-- ── 9. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.issue_4473_purchase_contact(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_holder_proves(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_purchase_shared_with(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_revoke_unproved_shares(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_share_purchases_by_verified_identity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_shared_brand_guest(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_purchase_shared_holders_4473_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_purchase_shared_holders_4473_guest_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pg_my_shared_purchases() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pg_my_purchase_share_flags() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4063_contact_conflict(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_record_claim_contact(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_verified_phone(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_4473_purchase_contact(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_holder_proves(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_purchase_shared_with(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_revoke_unproved_shares(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_share_purchases_by_verified_identity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_shared_brand_guest(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_my_shared_purchases() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_my_purchase_share_flags() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_contact_conflict(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_record_claim_contact(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_verified_phone(uuid, text) TO service_role;

COMMIT;
