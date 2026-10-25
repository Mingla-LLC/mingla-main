-- Issue #4063 / PR-2 / M2
-- Preserve old Business comp clients while making new clients state whether a
-- named guest intentionally has no contact. A name-only comp remains a valid
-- door-list ticket, but it cannot later be claimed by contact.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Replace the writer with the explicit reviewed definition. The prior dynamic
-- pg_get_functiondef/replace form hid its DDL behind an opaque EXECUTE variable,
-- which the repository's migration gate correctly rejects.
CREATE OR REPLACE FUNCTION public.biz_comp_issue(p_actor_id uuid, p_event_id uuid, p_ticket_type_id uuid, p_event_date_id uuid, p_guests jsonb, p_note text, p_client_request_id uuid, p_qr_token_pepper text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_actor_hourly_cap constant integer := 300;
  c_brand_daily_cap constant integer := 1000;
  v_pepper text;
  v_event record;
  v_tt record;
  v_choice jsonb;
  v_date_id uuid;
  v_per_occurrence boolean := false;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_guest jsonb;
  v_po jsonb;
  v_gi integer;
  v_pi integer;
  v_index integer;
  v_name text;
  v_email text;
  v_phone text;
  v_name_only boolean;
  v_emails text[] := ARRAY[]::text[];
  v_indexes integer[] := ARRAY[]::integer[];
  v_unnamed integer;
  -- one row per person, in submission order
  v_people jsonb := '[]'::jsonb;
  v_person jsonb;
  v_key text;
  v_existing_id uuid;
  v_dup_id uuid;
  v_dup_lead uuid;
  v_requested integer := 0;
  v_new_orders integer := 0;
  v_sold integer;
  v_held integer;
  v_remaining integer;
  v_recent integer;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_lead_id uuid;
  v_lead_name text;
  v_added integer := 0;
  v_failed integer := 0;
  v_k integer;
BEGIN
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF p_actor_id IS NULL OR p_event_id IS NULL OR p_ticket_type_id IS NULL OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'note';
  END IF;

  -- ---- 1. Validate and normalise every person (nothing is written yet) ----
  IF p_guests IS NULL OR jsonb_typeof(p_guests) <> 'array'
     OR jsonb_array_length(p_guests) < 1 OR jsonb_array_length(p_guests) > 50 THEN
    RAISE EXCEPTION 'invalid_guests' USING HINT = 'count';
  END IF;

  FOR v_gi IN 0 .. jsonb_array_length(p_guests) - 1 LOOP
    v_guest := p_guests -> v_gi;
    IF jsonb_typeof(v_guest) <> 'object'
       OR jsonb_typeof(v_guest -> 'index') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_guest -> 'name') IS DISTINCT FROM 'string'
       OR COALESCE(jsonb_typeof(v_guest -> 'email'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'phoneE164'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'nameOnly'), 'boolean') <> 'boolean'
       OR COALESCE(jsonb_typeof(v_guest -> 'plusOnes'), 'array') <> 'array' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
    END IF;
    IF (v_guest ->> 'index') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_index := (v_guest ->> 'index')::integer;
    IF v_index < 0 OR v_index > 49 OR v_index = ANY (v_indexes) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'index';
    END IF;
    v_indexes := v_indexes || v_index;

    v_name := btrim(v_guest ->> 'name');
    v_email := NULLIF(lower(btrim(COALESCE(v_guest ->> 'email', ''))), '');
    v_phone := NULLIF(btrim(COALESCE(v_guest ->> 'phoneE164', '')), '');
    IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
    END IF;
    IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
    END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
    END IF;
    -- #4063 nameOnly compatibility: an old client that omits the field and
    -- sends no contact keeps today's name-only behaviour. New clients are
    -- explicit, so false without contact and true with contact are refused.
    v_name_only := COALESCE(
      (v_guest ->> 'nameOnly')::boolean,
      v_email IS NULL AND v_phone IS NULL
    );
    IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
    ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
    END IF;
    IF v_email IS NOT NULL THEN
      IF v_email = ANY (v_emails) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
      END IF;
      v_emails := v_emails || v_email;
    END IF;

    v_unnamed := 0;
    IF jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) > 9 THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_ones';
    END IF;
    -- The guest goes first; their named plus-ones follow, pointing back.
    v_people := v_people || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'plusOneIndex', NULL, 'name', v_name,
      'email', v_email, 'phone', v_phone, 'partySize', 1,
      'nameOnly', v_name_only));

    FOR v_pi IN 0 .. jsonb_array_length(COALESCE(v_guest -> 'plusOnes', '[]'::jsonb)) - 1 LOOP
      v_po := v_guest -> 'plusOnes' -> v_pi;
      IF jsonb_typeof(v_po) <> 'object'
         OR COALESCE(jsonb_typeof(v_po -> 'name'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'email'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'phoneE164'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'nameOnly'), 'boolean') <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'shape';
      END IF;
      v_name := NULLIF(btrim(COALESCE(v_po ->> 'name', '')), '');
      v_email := NULLIF(lower(btrim(COALESCE(v_po ->> 'email', ''))), '');
      v_phone := NULLIF(btrim(COALESCE(v_po ->> 'phoneE164', '')), '');
      IF v_name IS NULL THEN
        IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
          -- "Add their name, or leave all three empty."
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'plus_one_needs_name';
        END IF;
        v_unnamed := v_unnamed + 1;
        CONTINUE;
      END IF;
      IF char_length(v_name) > 120 THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name';
      END IF;
      IF v_email IS NOT NULL AND (char_length(v_email) > 200 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'email';
      END IF;
      IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
      END IF;
      v_name_only := COALESCE(
        (v_po ->> 'nameOnly')::boolean,
        v_email IS NULL AND v_phone IS NULL
      );
      IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
      ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
      END IF;
      IF v_email IS NOT NULL THEN
        IF v_email = ANY (v_emails) THEN
          RAISE EXCEPTION 'invalid_guests' USING HINT = 'listed_twice';
        END IF;
        v_emails := v_emails || v_email;
      END IF;
      v_people := v_people || jsonb_build_array(jsonb_build_object(
        'index', v_index, 'plusOneIndex', v_pi, 'name', v_name,
        'email', v_email, 'phone', v_phone, 'partySize', 1,
        'nameOnly', v_name_only));
    END LOOP;

    -- Blank plus-ones ride on the guest's own order.
    IF v_unnamed > 0 THEN
      FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
        IF (v_people -> v_k ->> 'index')::integer = v_index
           AND (v_people -> v_k -> 'plusOneIndex') = 'null'::jsonb THEN
          v_people := jsonb_set(v_people, ARRAY[v_k::text, 'partySize'], to_jsonb(1 + v_unnamed));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- ---- 2. Locks, in create-session order: event, brand, ticket type ----
  SELECT e.id, e.brand_id, e.status, e.deleted_at, e.event_type
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE OF e;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  PERFORM 1 FROM public.brands b WHERE b.id = v_event.brand_id FOR UPDATE;

  IF public.biz_brand_effective_rank(v_event.brand_id, p_actor_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Visibility is NOT checked: public, hidden, unlisted and private events
  -- all take guest-list tickets.
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_open';
  END IF;
  IF v_event.event_type IN ('trip', 'experience', 'rsvp') THEN
    RAISE EXCEPTION 'event_type_unsupported';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id AND d.end_at > now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  -- The day: the same predicate checkout uses (issue_3313_event_day_choice).
  v_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF p_event_date_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_dates d
                    WHERE d.id = p_event_date_id AND d.event_id = p_event_id AND d.end_at > now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_date_id := p_event_date_id;
  ELSIF (v_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_date_id := (v_choice ->> 'soleOccurrenceId')::uuid;
  ELSIF COALESCE((v_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- Hidden, disabled, offline and out-of-window tiers ARE allowed: a comp is a
  -- host grant, not a sale.
  SELECT tt.id, tt.name, tt.quantity_total, COALESCE(tt.is_unlimited, false) AS is_unlimited, tt.sold_count
    INTO v_tt
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id
     AND tt.event_id = p_event_id
     AND tt.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_type_not_found';
  END IF;

  -- ---- 3. Replays and duplicates do not count against capacity ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;
    v_key := 'comp:' || p_event_id::text || ':' || p_client_request_id::text || ':' || (v_person ->> 'index')
      || CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN '' ELSE ':p' || (v_person ->> 'plusOneIndex') END;
    v_person := v_person || jsonb_build_object('key', v_key);

    SELECT o.id INTO v_existing_id FROM public.orders o WHERE o.comp_request_key = v_key;
    IF FOUND THEN
      v_person := v_person || jsonb_build_object('plan', 'replay', 'orderId', v_existing_id);
    ELSE
      v_dup_id := NULL;
      IF (v_person ->> 'email') IS NOT NULL THEN
        SELECT o.id, o.comp_party_lead_order_id INTO v_dup_id, v_dup_lead
          FROM public.orders o
         WHERE o.event_id = p_event_id AND o.source = 'comp' AND o.payment_status = 'paid'
           AND lower(o.buyer_email) = (v_person ->> 'email');
      END IF;
      IF v_dup_id IS NOT NULL THEN
        v_person := v_person || jsonb_build_object('plan', 'duplicate', 'orderId', v_dup_id,
          'dupIsLead', v_dup_lead IS NULL);
      ELSE
        v_person := v_person || jsonb_build_object('plan', 'new');
        v_requested := v_requested + (v_person ->> 'partySize')::integer;
        v_new_orders := v_new_orders + 1;
      END IF;
    END IF;
    v_people := jsonb_set(v_people, ARRAY[v_k::text], v_person);
  END LOOP;

  -- ---- 4. Capacity: the whole batch or nothing (I-3827-COMP-COUNTS-CAPACITY) ----
  -- The counter rule of the checkout create-session base (20271121003281).
  -- DELETE THIS BLOCK and a guest list can push a tier past its capacity.
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_held
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_tt.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');
      v_remaining := v_tt.quantity_total - COALESCE(v_tt.sold_count, 0) - v_held;
    END IF;
    IF v_requested > v_remaining THEN
      RAISE EXCEPTION 'ticket_capacity_exceeded'
        USING HINT = jsonb_build_object('remaining', GREATEST(v_remaining, 0), 'ticketName', v_tt.name)::text;
    END IF;
  END IF;

  -- ---- 5. Rate limits (fail CLOSED: issuing sends email) ----
  IF v_new_orders > 0 THEN
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
     WHERE o.source = 'comp' AND o.comp_issued_by = p_actor_id
       AND o.created_at > now() - interval '1 hour';
    IF v_recent + v_new_orders > c_actor_hourly_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
    SELECT count(*)::integer INTO v_recent
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
     WHERE e.brand_id = v_event.brand_id AND o.source = 'comp'
       AND o.created_at > now() - interval '1 day';
    IF v_recent + v_new_orders > c_brand_daily_cap THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
  END IF;

  -- ---- 6. Issue, one person per sub-block ----
  FOR v_k IN 0 .. jsonb_array_length(v_people) - 1 LOOP
    v_person := v_people -> v_k;

    IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
      -- A guest. Their named plus-ones (next rows) attach to this order.
      v_lead_id := NULL;
      v_lead_name := v_person ->> 'name';
    END IF;

    IF (v_person -> 'plusOneIndex') <> 'null'::jsonb AND v_lead_id IS NULL
       AND (v_person ->> 'plan') = 'new' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'lead_not_added');
    ELSIF (v_person ->> 'plan') = 'duplicate' THEN
      v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
      -- A guest already on the list: their new plus-ones join that order.
      IF (v_person -> 'plusOneIndex') = 'null'::jsonb AND (v_person ->> 'dupIsLead')::boolean THEN
        v_lead_id := (v_person ->> 'orderId')::uuid;
      END IF;
    ELSE
      BEGIN
        v_one := public.issue_3827_comp_issue_one(
          p_event_id => p_event_id,
          p_brand_id => v_event.brand_id,
          p_ticket_type_id => p_ticket_type_id,
          p_event_date_id => v_date_id,
          p_name => v_person ->> 'name',
          p_email => v_person ->> 'email',
          p_phone_e164 => v_person ->> 'phone',
          p_party_size => (v_person ->> 'partySize')::integer,
          p_request_key => v_person ->> 'key',
          p_qr_token_pepper => v_pepper,
          p_issued_by => p_actor_id,
          p_note => v_note,
          p_metadata => CASE
            WHEN COALESCE((v_person ->> 'nameOnly')::boolean, false)
              THEN jsonb_build_object('name_only', true)
            ELSE NULL
          END,
          p_party_lead_order_id => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_id END,
          p_party_lead_name => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE v_lead_name END,
          p_party_origin => CASE WHEN (v_person -> 'plusOneIndex') = 'null'::jsonb THEN NULL ELSE 'host' END
        );
        IF (v_person -> 'plusOneIndex') = 'null'::jsonb THEN
          v_lead_id := (v_one ->> 'orderId')::uuid;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_one := jsonb_build_object('status', 'failed', 'code', 'already_on_guest_list');
        WHEN OTHERS THEN
          -- No PII in the log line.
          RAISE WARNING 'biz_comp_issue: person % of event % failed: %', v_k, p_event_id, SQLSTATE;
          v_one := jsonb_build_object('status', 'failed', 'code', 'internal');
      END;
    END IF;

    IF (v_one ->> 'status') = 'failed' THEN
      v_failed := v_failed + 1;
    ELSE
      v_added := v_added + 1;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', (v_person ->> 'index')::integer,
      'plusOneIndex', v_person -> 'plusOneIndex',
      'status', v_one ->> 'status',
      'orderId', v_one ->> 'orderId',
      'ticketCount', (v_one ->> 'ticketCount')::integer,
      'emailQueued', COALESCE((v_one ->> 'emailQueued')::boolean, false),
      'smsQueued', COALESCE((v_one ->> 'smsQueued')::boolean, false),
      'code', v_one ->> 'code'
    ));
  END LOOP;

  -- Places left after this call, for the host's sheet.
  v_remaining := NULL;
  IF NOT v_tt.is_unlimited AND v_tt.quantity_total IS NOT NULL THEN
    IF v_per_occurrence AND v_date_id IS NOT NULL THEN
      v_remaining := v_tt.quantity_total
        - public.issue_3313_ticket_type_occurrence_taken(v_tt.id, v_date_id);
    ELSE
      SELECT tt.sold_count INTO v_sold FROM public.ticket_types tt WHERE tt.id = v_tt.id;
      v_remaining := v_tt.quantity_total - COALESCE(v_sold, 0) - COALESCE(v_held, 0);
    END IF;
    v_remaining := GREATEST(v_remaining, 0);
  END IF;

  RETURN jsonb_build_object(
    'eventId', p_event_id,
    'eventDateId', v_date_id,
    'results', v_results,
    'addedCount', v_added,
    'failedCount', v_failed,
    'remaining', v_remaining
  );
END;
$function$;

COMMENT ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) IS
  '#3827 + #4063: batch comp issue with explicit nameOnly validation. Omitted nameOnly plus no contact preserves old-client name-only behaviour and records metadata.name_only=true; explicit false requires a contact; explicit true forbids one.';

REVOKE ALL ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
