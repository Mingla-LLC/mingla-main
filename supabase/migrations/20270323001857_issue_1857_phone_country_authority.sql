-- Issue #1857 — explicit handset-country authority for national phone input.
-- Prefix is monotonic above local/remote/sibling max 20270322001856.
BEGIN;

CREATE TEMP TABLE issue_1857_definition_snapshot (
  object_kind text NOT NULL,
  object_name text PRIMARY KEY,
  definition text NOT NULL
) ON COMMIT DROP;

DO $guard$
DECLARE
  v_missing text[] := '{}'::text[];
  v_drift text[] := '{}'::text[];
  v_expected record;
BEGIN
  IF to_regprocedure('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text)') IS NULL THEN v_missing:=array_append(v_missing,'submit_event_rsvp'); END IF;
  IF to_regprocedure('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text)') IS NULL THEN v_missing:=array_append(v_missing,'submit_event_rsvp_with_delivery'); END IF;
  IF to_regprocedure('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)') IS NULL THEN v_missing:=array_append(v_missing,'issue_1388_create_stay_group'); END IF;
  IF to_regprocedure('public.biz_reservation_create(uuid,timestamp with time zone,integer,text,text,text,text,uuid,text,text,text[],text)') IS NULL THEN v_missing:=array_append(v_missing,'biz_reservation_create'); END IF;
  IF to_regprocedure('public.pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text)') IS NULL THEN v_missing:=array_append(v_missing,'pg_create_guest_reservation'); END IF;
  IF to_regprocedure('public.pg_finalize_guest_reservation(uuid,text)') IS NULL THEN v_missing:=array_append(v_missing,'pg_finalize_guest_reservation'); END IF;
  IF to_regprocedure('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamp with time zone)') IS NULL THEN v_missing:=array_append(v_missing,'biz_resolve_brand_person_source'); END IF;
  IF to_regprocedure('public.issue_1770_enqueue_source()') IS NULL THEN v_missing:=array_append(v_missing,'issue_1770_enqueue_source'); END IF;
  IF cardinality(v_missing)>0 THEN RAISE EXCEPTION 'issue_1857_source_drift_missing:%',array_to_string(v_missing,','); END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text)', '787eae74cc2b878be905899915ceeb53'),
    ('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text)', '1c69cfda97aedfc8ba846f6e6193c5c2'),
    ('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)', 'e83d8deb8b6e2f55517e29fb7b7f67c0'),
    ('public.biz_reservation_create(uuid,timestamp with time zone,integer,text,text,text,text,uuid,text,text,text[],text)', 'dd09169aa2385b711fc5c54cf7039940'),
    ('public.pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text)', 'd014cc5dff178ad164e9c556c4f75c9b'),
    ('public.pg_finalize_guest_reservation(uuid,text)', '327b12492edb0402c28547ec06bfb52d'),
    ('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamp with time zone)', '6c7beaa8437fac93cfd75f37528598e4'),
    ('public.issue_1770_enqueue_source()', 'f24e11a15a1a692f0a0b4f3559264826')
  ) AS expected(signature, definition_md5) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(v_expected.signature))) <> v_expected.definition_md5 THEN
      v_drift := array_append(v_drift, v_expected.signature);
    END IF;
  END LOOP;
  IF cardinality(v_drift)>0 THEN
    RAISE EXCEPTION 'issue_1857_source_drift_fingerprint:%',array_to_string(v_drift,',');
  END IF;
  INSERT INTO issue_1857_definition_snapshot(object_kind,object_name,definition) VALUES
    ('acl','issue_1388_create_stay_group_service_role',has_function_privilege('service_role','public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)','EXECUTE')::text),
    ('acl','biz_reservation_create_service_role',has_function_privilege('service_role','public.biz_reservation_create(uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text)','EXECUTE')::text);
  IF to_regprocedure('public.biz_resolve_brand_person_source_derived(text,uuid)') IS NULL THEN RAISE EXCEPTION 'issue_1857_derived_missing'; END IF;
  IF md5(pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure)) <> '498565615bd834f1d3efa95fb3d4552c' THEN
    RAISE EXCEPTION 'issue_1857_derived_drift_fingerprint';
  END IF;
  INSERT INTO issue_1857_definition_snapshot(object_kind,object_name,definition)
  VALUES ('function','biz_resolve_brand_person_source_derived',pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure));

  INSERT INTO issue_1857_definition_snapshot(object_kind,object_name,definition)
  SELECT 'trigger',tgname,pg_get_triggerdef(oid,true)
  FROM pg_trigger
  WHERE tgname IN ('issue_1770_event_rsvp_ingest','issue_1770_rsvp_plus_one_ingest','issue_1770_order_ingest','issue_1770_ticket_ingest')
    AND NOT tgisinternal;
  IF (SELECT count(*) FROM issue_1857_definition_snapshot WHERE object_kind='trigger')<>4
     OR NOT EXISTS (SELECT 1 FROM issue_1857_definition_snapshot WHERE object_name='issue_1770_event_rsvp_ingest' AND definition='CREATE TRIGGER issue_1770_event_rsvp_ingest AFTER INSERT OR DELETE OR UPDATE ON event_rsvps FOR EACH ROW EXECUTE FUNCTION issue_1770_enqueue_source(''event_rsvp'')')
     OR NOT EXISTS (SELECT 1 FROM issue_1857_definition_snapshot WHERE object_name='issue_1770_rsvp_plus_one_ingest' AND definition='CREATE TRIGGER issue_1770_rsvp_plus_one_ingest AFTER INSERT OR DELETE OR UPDATE ON event_rsvp_guests FOR EACH ROW EXECUTE FUNCTION issue_1770_enqueue_source(''rsvp_plus_one'')')
     OR NOT EXISTS (SELECT 1 FROM issue_1857_definition_snapshot WHERE object_name='issue_1770_order_ingest' AND definition='CREATE TRIGGER issue_1770_order_ingest AFTER INSERT OR DELETE OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION issue_1770_enqueue_source(''order'')')
     OR NOT EXISTS (SELECT 1 FROM issue_1857_definition_snapshot WHERE object_name='issue_1770_ticket_ingest' AND definition='CREATE TRIGGER issue_1770_ticket_ingest AFTER INSERT OR DELETE OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION issue_1770_enqueue_source(''ticket_holder'')') THEN
    RAISE EXCEPTION 'issue_1857_trigger_drift_definition';
  END IF;
END $guard$;

ALTER TABLE public.event_rsvps ADD COLUMN IF NOT EXISTS guest_phone_country_iso text;
ALTER TABLE public.event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_guest_phone_country_iso_check;
ALTER TABLE public.event_rsvps ADD CONSTRAINT event_rsvps_guest_phone_country_iso_check CHECK (guest_phone_country_iso IS NULL OR guest_phone_country_iso ~ '^[A-Z]{2}$');
ALTER TABLE public.event_rsvp_guests ADD COLUMN IF NOT EXISTS phone_country_iso text;
ALTER TABLE public.event_rsvp_guests DROP CONSTRAINT IF EXISTS event_rsvp_guests_phone_country_iso_check;
ALTER TABLE public.event_rsvp_guests ADD CONSTRAINT event_rsvp_guests_phone_country_iso_check CHECK (phone_country_iso IS NULL OR phone_country_iso ~ '^[A-Z]{2}$');
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS guest_phone_country_iso text;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_guest_phone_country_iso_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_guest_phone_country_iso_check CHECK (guest_phone_country_iso IS NULL OR guest_phone_country_iso ~ '^[A-Z]{2}$');
ALTER TABLE public.reservation_checkout_sessions ADD COLUMN IF NOT EXISTS buyer_phone_country_iso text;
ALTER TABLE public.reservation_checkout_sessions DROP CONSTRAINT IF EXISTS reservation_checkout_sessions_buyer_phone_country_iso_check;
ALTER TABLE public.reservation_checkout_sessions ADD CONSTRAINT reservation_checkout_sessions_buyer_phone_country_iso_check CHECK (buyer_phone_country_iso IS NULL OR buyer_phone_country_iso ~ '^[A-Z]{2}$');
ALTER TABLE public.brand_person_contact_method_sources ADD COLUMN IF NOT EXISTS phone_country_iso text;
ALTER TABLE public.brand_person_contact_method_sources DROP CONSTRAINT IF EXISTS brand_person_contact_method_sources_phone_country_iso_check;
ALTER TABLE public.brand_person_contact_method_sources ADD CONSTRAINT brand_person_contact_method_sources_phone_country_iso_check CHECK (phone_country_iso IS NULL OR phone_country_iso ~ '^[A-Z]{2}$');

DROP FUNCTION public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text);
DROP FUNCTION public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text);

CREATE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0,
  p_guests      jsonb   DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
  v_master_count integer;
  v_master_end_at timestamptz;
  v_plus        integer;
  v_confirmed   integer;
  v_status      text;
  v_approval    text;
  v_name        text;
  v_existing_id uuid;
  v_guest       jsonb;
  v_guest_id    uuid;
  v_gname       text;
  v_gemail      text;
  v_gphone      text;
  v_gphone_country_iso text;
  v_token_hash  text;
  v_qr          text;
  v_primary_qr  text;
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  -- #1902: preserve the deployed authoritative acquisition boundary. This
  -- precedes every validation, capacity, identity, guest, pass, and delivery write.
  SELECT count(*)::integer, max(ed.end_at)
    INTO v_master_count, v_master_end_at
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
     AND ed.is_master IS TRUE;

  IF v_master_count <> 1 OR v_master_end_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1902',
      MESSAGE = 'rsvp_date_unavailable';
  END IF;

  IF v_master_end_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1901',
      MESSAGE = 'rsvp_event_ended';
  END IF;

  IF p_rsvp_status NOT IN ('going', 'not_going', 'maybe') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  -- 2. Contact gate for link guests (anon — no user_id).
  v_name := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
  IF p_user_id IS NULL THEN
    IF v_name IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NULL
       OR NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
      RAISE EXCEPTION 'rsvp_contact_required';
    END IF;
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(NULLIF(btrim(p_guest_email), ''), 'Guest');
  END IF;

  -- #1857: changed writers accept only strict E.164 and explicit ISO provenance.
  IF NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL
     AND btrim(p_guest_phone) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'rsvp_phone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rsvp_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'rsvp_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;

  -- 3. Clamp plus_count.
  v_plus := GREATEST(COALESCE(p_plus_count, 0), 0);
  IF v_event.rsvp_allow_plus_ones THEN
    v_plus := LEAST(v_plus, v_event.rsvp_plus_ones_max);
  ELSE
    v_plus := 0;
  END IF;

  -- 3b. Per-guest validation (§H.4 / §H.6). For not_going force no plus-ones; for
  --     going/maybe the guest array length must equal the clamped plus_count and
  --     every element must carry a non-empty name/email/phone.
  IF p_rsvp_status = 'not_going' THEN
    p_guests := '[]'::jsonb;
    v_plus := 0;
  ELSE
    IF jsonb_typeof(COALESCE(p_guests, '[]'::jsonb)) <> 'array' THEN
      p_guests := '[]'::jsonb;
    END IF;
    IF jsonb_array_length(COALESCE(p_guests, '[]'::jsonb)) <> v_plus THEN
      RAISE EXCEPTION 'rsvp_guest_count_mismatch';
    END IF;
    FOR v_guest IN SELECT * FROM jsonb_array_elements(COALESCE(p_guests, '[]'::jsonb)) LOOP
      IF v_guest - ARRAY['name','email','phone','phoneCountryIso'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'rsvp_guest_keys_invalid' USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(COALESCE(v_guest->>'name', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'phone', '')), '') IS NULL THEN
        RAISE EXCEPTION 'rsvp_guest_contact_required';
      END IF;
      IF btrim(v_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'rsvp_guest_phone_invalid' USING ERRCODE = '22023';
      END IF;
      IF v_guest ? 'phoneCountryIso'
         AND jsonb_typeof(v_guest->'phoneCountryIso') <> 'null'
         AND (jsonb_typeof(v_guest->'phoneCountryIso') <> 'string'
           OR (v_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$') THEN
        RAISE EXCEPTION 'rsvp_guest_phone_country_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 4. Resolve approval + attendance (UNCHANGED from ORCH-1150 maybe version).
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
  ELSIF p_rsvp_status = 'maybe' THEN
    v_status := 'maybe';
    v_approval := 'approved';
  ELSIF v_event.rsvp_capacity IS NULL THEN
    v_status := 'going';
  ELSE
    SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
       AND (p_user_id IS NULL OR r.user_id IS DISTINCT FROM p_user_id);
    IF (v_confirmed + 1 + v_plus) > v_event.rsvp_capacity THEN
      IF v_event.rsvp_approval_mode = 'manual' THEN
        v_status := 'going';
      ELSIF v_event.rsvp_waitlist_enabled THEN
        v_status := 'waitlisted';
        v_approval := 'approved';
      ELSE
        RAISE EXCEPTION 'rsvp_full';
      END IF;
    ELSE
      v_status := 'going';
    END IF;
  END IF;

  -- 5. UPSERT the parent row.
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = p_user_id;
  ELSIF NULLIF(btrim(COALESCE(p_guest_email, '')), '') IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.event_rsvps
     WHERE event_id = p_event_id AND lower(guest_email) = lower(btrim(p_guest_email));
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_rsvps
       SET rsvp_status = v_status,
           approval_status = v_approval,
           plus_count = v_plus,
           guest_name = v_name,
           guest_email = COALESCE(NULLIF(btrim(p_guest_email), ''), guest_email),
           guest_phone = COALESCE(NULLIF(btrim(p_guest_phone), ''), guest_phone),
           guest_phone_country_iso = CASE WHEN NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NULL THEN guest_phone_country_iso ELSE p_guest_phone_country_iso END,
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone, guest_phone_country_iso,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''), p_guest_phone_country_iso,
       v_status, v_approval, v_plus,
       CASE WHEN v_status = 'waitlisted' THEN now() ELSE NULL END)
    RETURNING id INTO v_existing_id;
  END IF;

  -- 6. Per-guest child set: delete-then-insert (idempotent, consistent with
  --    plus_count). Resolve a verified account match per guest (going OR maybe).
  DELETE FROM public.event_rsvp_guests WHERE rsvp_id = v_existing_id;
  IF jsonb_array_length(COALESCE(p_guests, '[]'::jsonb)) > 0 THEN
    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      v_gname  := btrim(v_guest->>'name');
      v_gemail := btrim(v_guest->>'email');
      v_gphone := btrim(v_guest->>'phone');
      v_gphone_country_iso := NULLIF(v_guest->>'phoneCountryIso','');
      INSERT INTO public.event_rsvp_guests (rsvp_id, name, email, phone, phone_country_iso, matched_user_id)
      VALUES (
        v_existing_id, v_gname, v_gemail, v_gphone, v_gphone_country_iso,
        public.biz_resolve_verified_user(v_gemail, v_gphone)
      )
      RETURNING id INTO v_guest_id;

      -- Mint the per-guest signed pass ONLY on a going resolution.
      IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
        SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
          FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m;
        UPDATE public.event_rsvp_guests
           SET qr_token_hash = v_token_hash, qr_code = v_qr
         WHERE id = v_guest_id;
      END IF;
    END LOOP;
  END IF;

  -- 7. Mint the PRIMARY's signed pass ONLY for going, idempotent on qr_token_hash.
  v_primary_qr := NULL;
  IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
    SELECT qr_code INTO v_primary_qr FROM public.event_rsvps
     WHERE id = v_existing_id AND qr_token_hash IS NOT NULL;
    IF v_primary_qr IS NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
        FROM public.biz_rsvp_mint_qr(v_existing_id, p_qr_token_pepper) m;
      UPDATE public.event_rsvps
         SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
       WHERE id = v_existing_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted'),
    'confirmationToken', v_primary_qr
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_event_rsvp_with_delivery(
  p_event_id uuid,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count integer DEFAULT 0,
  p_guests jsonb DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL,
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_rsvp_id uuid;
BEGIN
  v_result := public.submit_event_rsvp(
    p_event_id,p_user_id,p_guest_name,p_guest_email,p_guest_phone,
    p_rsvp_status,p_plus_count,p_guests,p_qr_token_pepper,p_guest_phone_country_iso
  );
  v_rsvp_id := NULLIF(v_result->>'rsvpId','')::uuid;
  IF v_rsvp_id IS NOT NULL THEN
    PERFORM public.enqueue_rsvp_acknowledgement(v_rsvp_id);
    IF v_result->>'status'='going' AND v_result->>'approvalStatus'='approved' THEN
      PERFORM public.enqueue_rsvp_pass(v_rsvp_id,p_qr_token_pepper);
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_1388_create_stay_group(
  p_quote_id uuid,
  p_idempotency_key text,
  p_guest jsonb,
  p_expected_quote_version bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_key text := public.issue_1388_actor_key();
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_group_id uuid := gen_random_uuid();
  v_hold_id uuid := gen_random_uuid();
  v_settings public.stay_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_reservation_line public.stay_reservation_lines%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_night public.stay_room_nights%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_resource jsonb;
  v_allocation public.stay_quote_allocations%ROWTYPE;
  v_date date;
  v_unit_id uuid;
  v_preference uuid;
  v_unit_index integer;
  v_held bigint;
  v_committed bigint;
  v_available bigint;
  v_request_hash text;
  v_group_state text;
  v_line_state text;
  v_hold_expires_at timestamptz;
  v_request_deadline timestamptz;
  v_dependency_room_line_id uuid;
BEGIN
  IF v_uid IS NULL OR v_actor_key IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_quote_id IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_guest) <> 'object'
     OR jsonb_typeof(p_guest->'name') <> 'string'
     OR (
       p_guest ? 'email'
       AND jsonb_typeof(p_guest->'email') <> 'string'
     )
     OR (
       p_guest ? 'phone'
       AND jsonb_typeof(p_guest->'phone') <> 'string'
     )
     OR (
       p_guest ? 'phoneCountryIso'
       AND jsonb_typeof(p_guest->'phoneCountryIso') NOT IN ('string','null')
     )
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'name', '')))
       NOT BETWEEN 1 AND 120
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) > 254
     OR char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) > 40
     OR (
       char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) > 0
       AND pg_catalog.btrim(p_guest->>'phone') !~ '^\+[1-9][0-9]{7,14}$'
     )
     OR (
       NULLIF(p_guest->>'phoneCountryIso','') IS NOT NULL
       AND (p_guest->>'phoneCountryIso') !~ '^[A-Z]{2}$'
     )
     OR (
       NULLIF(p_guest->>'phoneCountryIso','') IS NOT NULL
       AND char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) = 0
     )
     OR (
       char_length(pg_catalog.btrim(COALESCE(p_guest->>'email', ''))) = 0
       AND char_length(pg_catalog.btrim(COALESCE(p_guest->>'phone', ''))) = 0
     )
     OR p_guest - ARRAY['name', 'email', 'phone', 'phoneCountryIso'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'quoteId', p_quote_id,
        'guest', p_guest
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_key || ':group:' || pg_catalog.btrim(p_idempotency_key),
      1388
    )
  );
  SELECT * INTO v_existing
  FROM public.stay_reservation_groups
  WHERE actor_key_hash = v_actor_key
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(v_existing.id);
  END IF;

  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> v_actor_key THEN
    RAISE EXCEPTION 'stay_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_quote_version IS NULL
     OR v_quote.version <> p_expected_quote_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' AND v_quote.expires_at <= now() THEN
      UPDATE public.stay_quotes
      SET status = 'expired', version = version + 1
      WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'stay_quote_expired' USING ERRCODE = '22023';
  END IF;

  -- Binding lock order: brand/settings/currency readiness, idempotency/quote,
  -- offerings, Room nights, Place windows, private units, then active slices.
  PERFORM 1 FROM public.brands
  WHERE id = v_quote.brand_id
  FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_quote.venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_settings.booking_state <> 'active'
     OR NOT public.pg_brand_can_collect(v_quote.brand_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.brands b
       WHERE b.id = v_quote.brand_id
         AND upper(b.default_currency) = v_quote.currency_code
     )
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations r
       WHERE r.brand_id = v_quote.brand_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1
  FROM public.stay_offerings offering
  JOIN public.stay_quote_lines line ON line.offering_id = offering.id
  WHERE line.quote_id = v_quote.id
  ORDER BY offering.id
  FOR UPDATE OF offering;

  PERFORM 1
  FROM public.stay_room_nights night
  JOIN public.stay_quote_lines line
    ON line.offering_id = night.offering_id
   AND line.kind = 'room'
   AND night.local_date >= line.room_check_in
   AND night.local_date < line.room_check_out
  WHERE line.quote_id = v_quote.id
  ORDER BY night.offering_id, night.local_date
  FOR UPDATE OF night;

  PERFORM 1
  FROM public.stay_place_windows window_row
  JOIN public.stay_quote_lines line
    ON line.place_window_id = window_row.id
  WHERE line.quote_id = v_quote.id
  ORDER BY window_row.offering_id, window_row.starts_at, window_row.id
  FOR UPDATE OF window_row;

  PERFORM 1
  FROM public.stay_units unit_row
  JOIN public.stay_quote_lines line
    ON line.offering_id = unit_row.offering_id
  WHERE line.quote_id = v_quote.id
    AND unit_row.status = 'active'
  ORDER BY unit_row.offering_id, unit_row.id
  FOR UPDATE OF unit_row;

  PERFORM 1
  FROM public.stay_inventory_hold_slices slice_row
  JOIN public.stay_inventory_holds hold_row
    ON hold_row.id = slice_row.hold_id
  WHERE slice_row.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND hold_row.state IN ('active', 'reconciliation_required')
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  FOR UPDATE OF slice_row, hold_row;

  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.offering_id IN (
    SELECT offering_id
    FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
  )
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  UPDATE public.stay_inventory_holds hold_row
  SET state = 'expired', version = version + 1, updated_at = now()
  WHERE hold_row.state = 'active'
    AND hold_row.expires_at <= now()
    AND EXISTS (
      SELECT 1
      FROM public.stay_inventory_hold_slices slice_row
      WHERE slice_row.hold_id = hold_row.id
        AND slice_row.offering_id IN (
          SELECT offering_id
          FROM public.stay_quote_lines
          WHERE quote_id = v_quote.id
        )
    );

  FOR v_line IN
    SELECT * FROM public.stay_quote_lines
    WHERE quote_id = v_quote.id
    ORDER BY offering_id, place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_line.offering_id;
    IF NOT FOUND OR v_offering.status <> 'live'
       OR v_offering.version <> v_line.offering_version
       OR v_offering.confirmation_mode <> v_line.confirmation_mode
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_price_versions p
         WHERE p.id = v_line.price_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
           AND p.currency_code = v_quote.currency_code
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_policy_versions p
         WHERE p.id = v_line.policy_version_id
           AND p.offering_id = v_line.offering_id
           AND p.effective_to IS NULL
       ) THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
    END IF;
    FOR v_resource IN
      SELECT value
      FROM jsonb_array_elements(v_line.inventory_snapshot->'resources')
    LOOP
      IF v_resource->>'resourceType' = 'room_night' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_room_nights n
          WHERE n.offering_id = v_line.offering_id
            AND n.local_date = (v_resource->>'localDate')::date
            AND n.version = (v_resource->>'version')::bigint
            AND NOT n.stop_sell
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM public.stay_place_windows w
          WHERE w.id = (v_resource->>'windowId')::uuid
            AND w.offering_id = v_line.offering_id
            AND w.version = (v_resource->>'version')::bigint
            AND NOT w.stop_sell
            AND w.ends_at > now()
        ) THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  v_group_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'instant_payment_pending'
  END;
  v_line_state := CASE v_quote.mode
    WHEN 'request' THEN 'request_pending'
    ELSE 'payment_pending'
  END;
  v_request_deadline := CASE v_quote.mode
    WHEN 'request' THEN
      now() + make_interval(hours => v_settings.request_response_hours)
    ELSE NULL
  END;
  v_hold_expires_at := COALESCE(
    v_request_deadline,
    now() + make_interval(mins => v_settings.instant_payment_hold_minutes)
  );

  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash,
    venue_id, brand_id, currency_code, mode, state,
    request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash
  ) VALUES (
    v_group_id,
    'ST-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    v_quote.id, v_uid, v_actor_key,
    v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, v_group_state, v_request_deadline, NULL, p_guest,
    v_quote.source_subtotal_minor, v_quote.fee_total_minor,
    v_quote.tax_total_minor, v_quote.total_minor,
    pg_catalog.btrim(p_idempotency_key), v_request_hash
  );

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot
  FROM public.stay_quote_lines line
  WHERE line.quote_id = v_quote.id AND line.kind = 'room'
  ORDER BY line.offering_id;

  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state,
    room_check_in, room_check_out, room_quantity,
    place_window_id, place_units, place_guests, adults, children,
    base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot,
    dependency_room_line_id
  )
  SELECT
    gen_random_uuid(), v_group_id, line.id, line.offering_id, line.kind,
    v_line_state, line.room_check_in, line.room_check_out, line.room_quantity,
    line.place_window_id, line.place_units, line.place_guests,
    line.adults, line.children,
    line.base_minor, line.fee_minor, line.tax_minor, line.total_minor,
    line.offering_snapshot, line.price_snapshot, line.policy_snapshot,
    CASE WHEN offering.access_scope = 'overnight_guests_only' THEN (
      SELECT room_reservation.id
      FROM public.stay_reservation_lines room_reservation
      JOIN public.stay_quote_lines room_quote
        ON room_quote.id = room_reservation.quote_line_id
      WHERE room_reservation.group_id = v_group_id
        AND room_reservation.kind = 'room'
        AND room_quote.room_check_in <= window_row.local_date
        AND room_quote.room_check_out > window_row.local_date
      ORDER BY room_reservation.offering_id, room_reservation.id
      LIMIT 1
    ) ELSE NULL END
  FROM public.stay_quote_lines line
  JOIN public.stay_offerings offering ON offering.id = line.offering_id
  JOIN public.stay_place_windows window_row ON window_row.id = line.place_window_id
  WHERE line.quote_id = v_quote.id AND line.kind = 'place'
  ORDER BY line.offering_id, line.place_window_id;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines line
    JOIN public.stay_offerings offering ON offering.id = line.offering_id
    WHERE line.group_id = v_group_id
      AND line.kind = 'place'
      AND offering.access_scope = 'overnight_guests_only'
      AND line.dependency_room_line_id IS NULL
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_inventory_holds (
    id, group_id, state, expires_at, reason
  ) VALUES (
    v_hold_id, v_group_id, 'active', v_hold_expires_at,
    CASE v_quote.mode
      WHEN 'request' THEN 'request_response'
      ELSE 'instant_payment'
    END
  );

  FOR v_line IN
    SELECT quote_line.*
    FROM public.stay_quote_lines quote_line
    WHERE quote_line.quote_id = v_quote.id
    ORDER BY quote_line.offering_id, quote_line.place_window_id NULLS FIRST
  LOOP
    SELECT * INTO v_reservation_line
    FROM public.stay_reservation_lines
    WHERE group_id = v_group_id AND quote_line_id = v_line.id;
    SELECT * INTO v_offering
    FROM public.stay_offerings WHERE id = v_line.offering_id;

    IF v_line.kind = 'room' THEN
      FOR v_date IN
        SELECT d::date
        FROM generate_series(
          v_line.room_check_in::timestamp,
          (v_line.room_check_out - 1)::timestamp,
          interval '1 day'
        ) d
        ORDER BY d
      LOOP
        SELECT * INTO v_night
        FROM public.stay_room_nights
        WHERE offering_id = v_line.offering_id AND local_date = v_date;
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND slice_row.resource_type = 'room_night'
          AND slice_row.room_date = v_date
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE offering_id = v_line.offering_id
          AND resource_type = 'room_night'
          AND room_date = v_date
          AND state = 'active';
        v_available := v_night.sellable_quantity - v_held - v_committed;
        IF v_available < v_line.room_quantity THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
      END LOOP;

      IF v_offering.unit_naming_mode = 'named' THEN
        FOR v_allocation IN
          SELECT * FROM public.stay_quote_allocations
          WHERE quote_line_id = v_line.id
          ORDER BY allocation_ordinal
        LOOP
          v_preference := v_allocation.named_unit_preference;
          IF v_preference IS NOT NULL THEN
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.id = v_preference
              AND u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              );
          ELSE
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND slice_row.resource_type = 'room_night'
                  AND slice_row.room_date >= v_line.room_check_in
                  AND slice_row.room_date < v_line.room_check_out
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.resource_type = 'room_night'
                  AND commitment.room_date >= v_line.room_check_in
                  AND commitment.room_date < v_line.room_check_out
                  AND commitment.state = 'active'
              )
            ORDER BY u.id
            LIMIT 1;
          END IF;
          IF v_unit_id IS NULL THEN
            RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
          END IF;
          FOR v_date IN
            SELECT d::date
            FROM generate_series(
              v_line.room_check_in::timestamp,
              (v_line.room_check_out - 1)::timestamp,
              interval '1 day'
            ) d
            ORDER BY d
          LOOP
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              room_date, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'room_night',
              v_line.offering_id, v_date, 1, v_unit_id
            );
          END LOOP;
          v_unit_id := NULL;
        END LOOP;
      ELSE
        FOR v_date IN
          SELECT d::date
          FROM generate_series(
            v_line.room_check_in::timestamp,
            (v_line.room_check_out - 1)::timestamp,
            interval '1 day'
          ) d
          ORDER BY d
        LOOP
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            room_date, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'room_night',
            v_line.offering_id, v_date, v_line.room_quantity
          );
        END LOOP;
      END IF;
    ELSE
      SELECT * INTO v_window
      FROM public.stay_place_windows WHERE id = v_line.place_window_id;
      IF v_offering.inventory_basis = 'shared_capacity' THEN
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        WHERE slice_row.place_window_id = v_window.id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          );
        SELECT COALESCE(sum(quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments
        WHERE place_window_id = v_window.id AND state = 'active';
        v_available :=
          v_window.sellable_capacity - v_held - v_committed;
        IF v_available < v_line.place_guests THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;
        INSERT INTO public.stay_inventory_hold_slices (
          hold_id, reservation_line_id, resource_type, offering_id,
          place_window_id, quantity
        ) VALUES (
          v_hold_id, v_reservation_line.id, 'place_window',
          v_line.offering_id, v_window.id, v_line.place_guests
        );
      ELSE
        SELECT COALESCE(sum(slice_row.quantity), 0) INTO v_held
        FROM public.stay_inventory_hold_slices slice_row
        JOIN public.stay_inventory_holds hold_row
          ON hold_row.id = slice_row.hold_id
        JOIN public.stay_place_windows held_window
          ON held_window.id = slice_row.place_window_id
        WHERE slice_row.offering_id = v_line.offering_id
          AND (
            (hold_row.state = 'active' AND hold_row.expires_at > now())
            OR hold_row.state = 'reconciliation_required'
          )
          AND held_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND held_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        SELECT COALESCE(sum(commitment.quantity), 0) INTO v_committed
        FROM public.stay_inventory_commitments commitment
        JOIN public.stay_place_windows committed_window
          ON committed_window.id = commitment.place_window_id
        WHERE commitment.offering_id = v_line.offering_id
          AND commitment.state = 'active'
          AND committed_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes)
              < v_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
          AND committed_window.ends_at
                + make_interval(mins => v_offering.buffer_after_minutes)
              > v_window.starts_at
                - make_interval(mins => v_offering.buffer_before_minutes);
        v_available := v_window.sellable_units - v_held - v_committed;
        IF v_available < v_line.place_units THEN
          RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
        END IF;

        IF v_offering.unit_naming_mode = 'named' THEN
          FOR v_unit_index IN 1..v_line.place_units
          LOOP
            v_preference := v_line.named_unit_preferences[v_unit_index];
            SELECT u.id INTO v_unit_id
            FROM public.stay_units u
            WHERE u.offering_id = v_line.offering_id
              AND u.status = 'active'
              AND (v_preference IS NULL OR u.id = v_preference)
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_hold_slices slice_row
                JOIN public.stay_inventory_holds hold_row
                  ON hold_row.id = slice_row.hold_id
                JOIN public.stay_place_windows held_window
                  ON held_window.id = slice_row.place_window_id
                WHERE slice_row.exclusive_unit_id = u.id
                  AND (
                    (
                      hold_row.state = 'active'
                      AND hold_row.expires_at > now()
                    )
                    OR hold_row.state = 'reconciliation_required'
                  )
                  AND held_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND held_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.stay_inventory_commitments commitment
                JOIN public.stay_place_windows committed_window
                  ON committed_window.id = commitment.place_window_id
                WHERE commitment.exclusive_unit_id = u.id
                  AND commitment.state = 'active'
                  AND committed_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
                      < v_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                  AND committed_window.ends_at
                        + make_interval(
                          mins => v_offering.buffer_after_minutes
                        )
                      > v_window.starts_at
                        - make_interval(
                          mins => v_offering.buffer_before_minutes
                        )
              )
            ORDER BY u.id
            LIMIT 1;
            IF v_unit_id IS NULL THEN
              RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
            END IF;
            INSERT INTO public.stay_inventory_hold_slices (
              hold_id, reservation_line_id, resource_type, offering_id,
              place_window_id, quantity, exclusive_unit_id
            ) VALUES (
              v_hold_id, v_reservation_line.id, 'place_window',
              v_line.offering_id, v_window.id, 1, v_unit_id
            );
            v_unit_id := NULL;
          END LOOP;
        ELSE
          INSERT INTO public.stay_inventory_hold_slices (
            hold_id, reservation_line_id, resource_type, offering_id,
            place_window_id, quantity
          ) VALUES (
            v_hold_id, v_reservation_line.id, 'place_window',
            v_line.offering_id, v_window.id, v_line.place_units
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.stay_quotes
  SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group_id,
    CASE v_quote.mode
      WHEN 'request' THEN 'stay_request_submitted'
      ELSE 'stay_instant_payment_pending'
    END,
    'guest',
    v_uid,
    p_request_id,
    'create:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'mode', v_quote.mode,
      'holdExpiresAt', v_hold_expires_at,
      'lineCount', (
        SELECT count(*) FROM public.stay_reservation_lines
        WHERE group_id = v_group_id
      )
    )
  );

  RETURN public.issue_1388_group_projection(v_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_reservation_create(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text DEFAULT 'phone',
  p_guest_name text DEFAULT NULL,
  p_guest_phone_e164 text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_table_id uuid DEFAULT NULL,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'::text[],
  p_status text DEFAULT 'confirmed'
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand uuid;
  v_uid uuid := auth.uid();
  v_phone text := NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT v.brand_id INTO v_brand
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership: SAME rank helper, against the DERIVED brand (D-1: one team).
  -- Re-asserted BEFORE the INSERT so the SECURITY DEFINER RETURNING cannot
  -- leak another brand's row (RLS-RETURNING-OWNER-GAP note, SPEC §4.A.4).
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- A manual booking starts in a non-terminal, sensible state only.
  IF p_status NOT IN ('requested','confirmed','seated') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla','phone','walk_in','website','instagram') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;

  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE = '22023';
  END IF;

  -- D-1 guard, now VENUE-scoped: an assigned table MUST belong to the SAME
  -- venue as the reservation being created. NULL p_table_id is allowed.
  -- (Error literal kept as table_brand_mismatch — same cross-tenant-splice
  -- class the clients already map; it now also fires for a same-brand
  -- OTHER-venue table.)
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = p_venue_id
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, p_venue_id USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.reservations (
    brand_id, venue_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, table_id, occasion,
    guest_notes, tags
  ) VALUES (
    v_brand, p_venue_id, p_reserved_for, p_party_size, p_status, p_source, 'operator',
    p_guest_name, v_phone, p_guest_email, p_table_id, p_occasion,
    p_guest_notes, COALESCE(p_tags, '{}'::text[])
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.create',
    'reservation', v_row.id::text,
    jsonb_build_object(
      'source', p_source, 'party_size', p_party_size,
      'reserved_for', p_reserved_for, 'status', p_status, 'created_via', 'operator',
      'venue_id', p_venue_id
    )
  );

  RETURN v_row;
END;
$function$;

-- Replace the old 17-argument writer rather than leaving a competing overload.
-- Revoke first so no caller can enter it while this transaction rewires the
-- dependency chain; the widened writer's final country argument remains defaulted.
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text
) FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text
);

CREATE OR REPLACE FUNCTION public.pg_create_guest_reservation(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text,                 -- 'mingla' (app) | 'website' (anon web)
  p_created_via text,            -- 'consumer' (signed-in) | 'guest' (anon)
  p_consumer_user_id uuid,       -- set when created_via='consumer'; else NULL
  p_guest_name text,
  p_guest_phone_e164 text,
  p_guest_email text,
  p_fee_cents int,               -- NULL/0 for free; >0 for a paid fee/deposit
  p_fee_currency char(3),
  p_payment_intent_id text,
  p_payment_status text,         -- 'none' (free) | 'paid' (fee charged upfront)
  p_guest_cancel_token text,     -- web cancel-link token (NULL for app)
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',
  p_guest_phone_country_iso text DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand_id uuid;
  v_place_pool_id uuid;
  v_enabled boolean;
  v_tz text;
  v_slot_date date;
  v_slot_ok boolean;
  v_deposit_required boolean := false;
  v_lock_key bigint;
BEGIN
  -- Validate the discriminators up front (the edge fn validates buyer fields).
  IF p_venue_id IS NULL OR p_reserved_for IS NULL OR p_party_size IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NOT NULL
     AND btrim(p_guest_phone_e164) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'reservation_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservation_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;
  IF p_party_size < 1 OR p_party_size > 100 THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla', 'website') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;
  IF p_created_via NOT IN ('consumer', 'guest') THEN
    RAISE EXCEPTION 'invalid_created_via_%', p_created_via USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_payment_status NOT IN ('none', 'paid') THEN
    RAISE EXCEPTION 'invalid_payment_status_%', p_payment_status USING ERRCODE = '23514';
  END IF;

  -- (0) Derive the venue's brand + place (venue row is the truth, D-1; the old
  -- body read place_pool_id from settings — the venue row now owns it).
  SELECT v.brand_id, v.place_pool_id INTO v_brand_id, v_place_pool_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;

  -- (1) The venue must be reservable + have an availability config.
  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = p_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  SELECT iana_timezone INTO v_tz
  FROM public.venue_availability_config
  WHERE venue_id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  v_tz := NULLIF(btrim(COALESCE(v_tz, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- ANTI-DOUBLE-BOOK: transaction-level advisory lock keyed on
  -- (venue_id, reserved_for) — slots are PER VENUE now, so the lock is too.
  v_lock_key := hashtextextended(p_venue_id::text || '|' || p_reserved_for::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- (2) RE-VALIDATE the slot against the engine AT WRITE TIME
  -- (I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT, venue-keyed).
  v_slot_date := (p_reserved_for AT TIME ZONE v_tz)::date;
  SELECT EXISTS (
    SELECT 1
    FROM public.pg_venue_available_slots(
      p_date => v_slot_date,
      p_party_size => p_party_size,
      p_venue_id => p_venue_id
    ) s
    WHERE s.slot_start_utc = p_reserved_for
      AND s.is_full = false
      AND s.remaining > 0
  ) INTO v_slot_ok;
  IF NOT v_slot_ok THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- (3) deposit_threshold capacity rule (server-side), PER VENUE.
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_capacity_rules cr
    WHERE cr.venue_id = p_venue_id
      AND cr.is_active
      AND cr.kind = 'deposit_threshold'
      AND COALESCE((cr.params->>'min_party_for_fee')::int, 1) <= p_party_size
  ) INTO v_deposit_required;
  IF v_deposit_required
     AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
    RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
  END IF;

  -- (4) INSERT the reservation row (brand + place derived from the venue).
  INSERT INTO public.reservations (
    brand_id, venue_id, place_pool_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_phone_country_iso, guest_email, consumer_user_id,
    occasion, guest_notes, fee_cents, fee_currency, payment_intent_id,
    payment_status, guest_cancel_token
  ) VALUES (
    v_brand_id, p_venue_id, v_place_pool_id, p_reserved_for, p_party_size, p_status, p_source,
    p_created_via, p_guest_name, NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), ''), p_guest_phone_country_iso, p_guest_email,
    p_consumer_user_id, p_occasion, p_guest_notes,
    NULLIF(COALESCE(p_fee_cents, 0), 0), p_fee_currency, p_payment_intent_id,
    p_payment_status, p_guest_cancel_token
  ) RETURNING * INTO v_row;

  -- (5) Audit (append-only; runs as definer = privileged).
  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    p_consumer_user_id, v_brand_id,
    'venue_reservation.guest_create',
    'reservation', v_row.id,
    jsonb_build_object(
      'source', p_source, 'created_via', p_created_via,
      'party_size', p_party_size, 'reserved_for', p_reserved_for,
      'fee_cents', NULLIF(COALESCE(p_fee_cents, 0), 0),
      'payment_status', p_payment_status, 'status', p_status,
      'venue_id', p_venue_id
    )
  );

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_finalize_guest_reservation(
  p_session_id uuid,
  p_payment_intent_id text
) RETURNS TABLE (reservation public.reservations, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.reservation_checkout_sessions;
  v_row public.reservations;
  v_venue_id uuid;
  v_legacy_ids uuid[];
BEGIN
  IF p_session_id IS NULL OR p_payment_intent_id IS NULL
     OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_checkout_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- IDEMPOTENT EARLY-RETURN: the session already minted a reservation.
  IF v_session.reservation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.reservations WHERE id = v_session.reservation_id;
    IF FOUND THEN
      reservation := v_row;
      session_id := v_session.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- IDEMPOTENT EARLY-RETURN via the PI key.
  SELECT * INTO v_row FROM public.reservations
  WHERE payment_intent_id = p_payment_intent_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.reservation_checkout_sessions
       SET status = 'completed', reservation_id = v_row.id, updated_at = now()
     WHERE id = p_session_id;
    reservation := v_row;
    session_id := v_session.id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Venue resolution for the mint: the session's venue_id (M3 column), with
  -- the [TRANSITIONAL-1] single-venue fallback for legacy sessions written
  -- before the venue key existed. Ambiguous (0 or >1 venues) → RAISE
  -- venue_ambiguous — never mint against the wrong venue.
  -- Exit condition: next consumer/business native builds ship + OTA unfreeze →
  -- sessions always carry venue_id; drop the fallback.
  v_venue_id := v_session.venue_id;
  IF v_venue_id IS NULL THEN
    SELECT array_agg(v.id) INTO v_legacy_ids
    FROM public.venue_listings v
    WHERE v.brand_id = v_session.brand_id;
    IF v_legacy_ids IS NULL OR array_length(v_legacy_ids, 1) <> 1 THEN
      RAISE EXCEPTION 'venue_ambiguous' USING ERRCODE = 'P0001';
    END IF;
    v_venue_id := v_legacy_ids[1];
  END IF;

  -- No existing reservation → MINT via the same atomic writer (advisory-lock
  -- double-book guard + slot re-validation + deposit enforcement preserved).
  BEGIN
    v_row := public.pg_create_guest_reservation(
      v_venue_id,
      v_session.reserved_for,
      v_session.party_size,
      CASE WHEN v_session.created_via = 'web' THEN 'website' ELSE 'mingla' END,
      CASE WHEN v_session.created_via = 'web' THEN 'guest' ELSE 'consumer' END,
      v_session.consumer_user_id,
      v_session.buyer_name,
      v_session.buyer_phone_e164,
      v_session.buyer_email,
      v_session.amount_cents,
      substr(v_session.currency, 1, 3)::char(3),
      p_payment_intent_id,
      'paid',
      v_session.guest_cancel_token,
      v_session.occasion,
      v_session.guest_notes,
      'confirmed',
      v_session.buyer_phone_country_iso
    );
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent mint for the same PI won the unique index. Adopt the winner.
    SELECT * INTO v_row FROM public.reservations
    WHERE payment_intent_id = p_payment_intent_id
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE; -- not the PI index → re-raise.
    END IF;
  END;

  -- Link the session to the freshly-minted reservation in the SAME txn.
  UPDATE public.reservation_checkout_sessions
     SET status = 'completed', reservation_id = v_row.id, updated_at = now()
   WHERE id = p_session_id;

  reservation := v_row;
  session_id := v_session.id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_source(
  p_brand_id uuid,
  p_event_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_authenticated_user_id uuid DEFAULT NULL,
  p_validated_invite_id uuid DEFAULT NULL,
  p_normalized_email text DEFAULT NULL,
  p_normalized_phone_e164 text DEFAULT NULL,
  p_source_occurred_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid; v_event uuid; v_user uuid; v_name text; v_email text; v_phone text; v_phone_country_iso text;
  v_occurred timestamptz; v_existing uuid; v_prior_person uuid; v_person uuid; v_link uuid; v_conflict uuid;
  v_candidates uuid[]; v_candidate uuid; v_candidate_name text; v_norm_name text;
  v_link_method text := 'normalized_address'; v_provenance text;
BEGIN
  IF p_source_kind NOT IN ('event_rsvp','rsvp_plus_one','order','ticket_holder') THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_kind || ':' || p_source_id::text,0));
  SELECT id,brand_person_id INTO v_link,v_prior_person FROM public.brand_person_source_links
    WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;

  IF p_source_kind='event_rsvp' THEN
    SELECT e.brand_id,r.event_id,r.user_id,
      COALESCE(NULLIF(btrim(r.guest_name),''),'Guest'),
      public.issue_1770_normalize_email(r.guest_email),public.issue_1770_normalize_phone(r.guest_phone),r.guest_phone_country_iso,r.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_phone_country_iso,v_occurred
      FROM public.event_rsvps r JOIN public.events e ON e.id=r.event_id WHERE r.id=p_source_id;
    v_provenance := 'rsvp';
  ELSIF p_source_kind='rsvp_plus_one' THEN
    SELECT e.brand_id,r.event_id,g.matched_user_id,btrim(g.name),
      public.issue_1770_normalize_email(g.email),public.issue_1770_normalize_phone(g.phone),g.phone_country_iso,g.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_phone_country_iso,v_occurred
      FROM public.event_rsvp_guests g JOIN public.event_rsvps r ON r.id=g.rsvp_id
      JOIN public.events e ON e.id=r.event_id WHERE g.id=p_source_id;
    v_provenance := 'rsvp';
  ELSIF p_source_kind='order' THEN
    SELECT e.brand_id,o.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      WHERE o.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance := 'order';
  ELSE
    SELECT e.brand_id,t.event_id,o.buyer_user_id,COALESCE(NULLIF(btrim(o.buyer_name),''),'Guest'),
      public.issue_1770_normalize_email(o.buyer_email),public.issue_1770_normalize_phone(COALESCE(o.buyer_phone_e164,o.buyer_phone)),o.created_at
      INTO v_brand,v_event,v_user,v_name,v_email,v_phone,v_occurred
      FROM public.tickets t JOIN public.orders o ON o.id=t.order_id JOIN public.events e ON e.id=t.event_id
      WHERE t.id=p_source_id AND o.confirmed_at IS NOT NULL AND o.payment_status IN ('paid','partial_refund','refunded','cancelled');
    v_provenance := 'ticket';
  END IF;

  IF v_brand IS NULL THEN
    UPDATE public.brand_person_source_links SET detached_at=COALESCE(detached_at,now()),updated_at=now()
      WHERE source_kind=p_source_kind AND source_id=p_source_id AND detached_at IS NULL;
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','retired','conflictId',NULL);
  END IF;
  IF v_brand IS DISTINCT FROM p_brand_id OR v_event IS DISTINCT FROM p_event_id OR
     v_user IS DISTINCT FROM p_authenticated_user_id OR v_email IS DISTINCT FROM public.issue_1770_normalize_email(p_normalized_email) OR
     v_phone IS DISTINCT FROM public.issue_1770_normalize_phone(p_normalized_phone_e164) OR v_occurred IS DISTINCT FROM p_source_occurred_at THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  IF p_validated_invite_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invites WHERE id=p_validated_invite_id AND brand_id=v_brand AND event_id=v_event AND status='active'
  ) THEN
    RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
  END IF;
  v_norm_name := lower(regexp_replace(btrim(v_name),'\s+',' ','g'));
  IF v_link IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.brand_people p
       WHERE p.id=public.biz_brand_person_canonical(v_prior_person)
         AND p.brand_id=v_brand AND p.record_status='active'
         AND (v_user IS NULL OR p.linked_user_id=v_user)
     )
     AND EXISTS (
       SELECT 1 FROM public.brand_person_names n
       WHERE n.source_link_id=v_link AND n.active AND n.normalized_name=v_norm_name
     )
     AND (
       (v_email IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='email' AND c.record_state='active'
       ))
       OR EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='email'
           AND c.normalized_value=v_email AND c.record_state='active'
       )
     )
     AND (
       (v_phone IS NULL AND NOT EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='phone' AND c.record_state='active'
       ))
       OR EXISTS (
         SELECT 1 FROM public.brand_person_contact_method_sources s
         JOIN public.brand_person_contact_methods c ON c.id=s.contact_method_id
         WHERE s.source_link_id=v_link AND s.active AND c.channel='phone'
           AND c.normalized_value=v_phone AND c.record_state='active'
       )
     )
  THEN
    UPDATE public.brand_person_contact_method_sources s
       SET phone_country_iso=v_phone_country_iso
      FROM public.brand_person_contact_methods c
     WHERE s.source_link_id=v_link AND s.active
       AND c.id=s.contact_method_id AND c.channel='phone'
       AND s.phone_country_iso IS DISTINCT FROM v_phone_country_iso;
    RETURN jsonb_build_object(
      'personId',public.biz_brand_person_canonical(v_prior_person),
      'sourceLinkId',v_link,'linkOutcome','already_linked','conflictId',NULL
    );
  END IF;
  IF v_link IS NOT NULL THEN
    UPDATE public.brand_person_contact_method_sources
      SET active=false,retired_at=now()
      WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_contact_methods c
      SET record_state='retired',retired_at=now(),updated_at=now()
      WHERE c.record_state='active'
        AND EXISTS (SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.source_link_id=v_link)
        AND NOT EXISTS (SELECT 1 FROM public.brand_person_contact_method_sources s WHERE s.contact_method_id=c.id AND s.active);
    UPDATE public.brand_person_names
      SET active=false,retired_at=now()
      WHERE source_link_id=v_link AND active;
    UPDATE public.brand_person_source_links SET detached_at=now(),updated_at=now() WHERE id=v_link;
  END IF;
  IF p_validated_invite_id IS NOT NULL THEN v_link_method := 'invite_token';
  ELSIF v_user IS NOT NULL THEN v_link_method := 'authenticated_user'; END IF;

  SELECT array_agg(DISTINCT candidate ORDER BY candidate) INTO v_candidates FROM (
    SELECT public.biz_brand_person_canonical(v_prior_person) candidate WHERE v_prior_person IS NOT NULL
    UNION
    SELECT p.id candidate FROM public.brand_people p WHERE p.brand_id=v_brand AND p.record_status='active' AND v_user IS NOT NULL AND p.linked_user_id=v_user
    UNION
    SELECT c.brand_person_id FROM public.brand_person_contact_methods c
      JOIN public.brand_people p ON p.id=c.brand_person_id
      WHERE c.brand_id=v_brand AND p.record_status='active' AND c.record_state='active' AND c.provenance_scope='brand_owned'
        AND ((c.channel='email' AND v_email IS NOT NULL AND c.normalized_value=v_email)
          OR (c.channel='phone' AND v_phone IS NOT NULL AND c.normalized_value=v_phone))
    UNION
    SELECT i.brand_person_id FROM public.brand_offering_invites i
      WHERE p_validated_invite_id IS NOT NULL AND i.id=p_validated_invite_id AND i.status='active'
  ) s;
  IF cardinality(COALESCE(v_candidates,'{}')) > 0 THEN
    FOREACH v_candidate IN ARRAY v_candidates LOOP
      SELECT lower(regexp_replace(btrim(display_name),'\s+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_candidate;
      IF v_candidate_name <> v_norm_name AND v_candidate_name <> 'guest' AND v_norm_name <> 'guest' THEN
        INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason)
        VALUES(v_brand,p_source_kind,p_source_id,v_candidates,'different_nonempty_names')
        ON CONFLICT (source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids
        RETURNING id INTO v_conflict;
        RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','conflict','conflictId',v_conflict);
      END IF;
    END LOOP;
    v_person := v_candidates[1];
    IF cardinality(v_candidates)>1 THEN
      FOREACH v_candidate IN ARRAY v_candidates[2:cardinality(v_candidates)] LOOP
        PERFORM public.biz_merge_brand_people(v_person,v_candidate,
          CASE WHEN v_user IS NOT NULL THEN 'authenticated_user' ELSE 'normalized_address' END,NULL,NULL);
      END LOOP;
    END IF;
  ELSE
    IF v_user IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
      RETURN jsonb_build_object('personId',NULL,'sourceLinkId',NULL,'linkOutcome','unlinked','conflictId',NULL);
    END IF;
    INSERT INTO public.brand_people(brand_id,linked_user_id,display_name) VALUES(v_brand,v_user,v_name) RETURNING id INTO v_person;
  END IF;
  INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,offering_invite_id,link_method,source_occurred_at)
    VALUES(v_brand,v_person,p_source_kind,p_source_id,p_validated_invite_id,v_link_method,v_occurred) RETURNING id INTO v_link;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    VALUES(v_person,v_name,v_norm_name,CASE WHEN EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND name_kind='primary') THEN 'alternate' ELSE 'primary' END,v_link)
    ON CONFLICT (brand_person_id,normalized_name) WHERE active DO NOTHING;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(v_brand,v_person,'email',v_email,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND record_state='active'))
      ON CONFLICT (brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
      VALUES(v_existing,v_link,v_provenance,true) ON CONFLICT DO NOTHING;
  END IF;
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
      VALUES(v_brand,v_person,'phone',v_phone,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND record_state='active'))
      ON CONFLICT (brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now()
      RETURNING id INTO v_existing;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable,phone_country_iso)
      VALUES(v_existing,v_link,v_provenance,true,v_phone_country_iso)
      ON CONFLICT (contact_method_id,source_link_id) DO UPDATE
        SET active=true,retired_at=NULL,phone_country_iso=EXCLUDED.phone_country_iso;
  END IF;
  RETURN jsonb_build_object('personId',v_person,'sourceLinkId',v_link,'linkOutcome','linked','conflictId',NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1770_enqueue_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_operation text;
  v_old_state jsonb;
  v_new_state jsonb;
  v_revision text;
BEGIN
  v_id := COALESCE(NEW.id,OLD.id);
  v_operation := CASE WHEN TG_OP='DELETE' THEN 'retire' ELSE 'upsert' END;

  -- Only identity inputs consumed by biz_resolve_brand_person_source_derived
  -- participate in the revision. Operational/status-only updates therefore do
  -- not create an unbounded stream of equivalent work.
  IF TG_ARGV[0]='event_rsvp' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'guest_name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'guest_email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'guest_phone'),
        'phoneCountryIso',to_jsonb(OLD)->>'guest_phone_country_iso',
        'rsvpStatus',to_jsonb(OLD)->>'rsvp_status','approvalStatus',to_jsonb(OLD)->>'approval_status');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'guest_name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'guest_email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'guest_phone'),
        'phoneCountryIso',to_jsonb(NEW)->>'guest_phone_country_iso',
        'rsvpStatus',to_jsonb(NEW)->>'rsvp_status','approvalStatus',to_jsonb(NEW)->>'approval_status');
    END IF;
  ELSIF TG_ARGV[0]='rsvp_plus_one' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'rsvpId',to_jsonb(OLD)->>'rsvp_id','userId',to_jsonb(OLD)->>'matched_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(OLD)->>'phone'),
        'phoneCountryIso',to_jsonb(OLD)->>'phone_country_iso');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'rsvpId',to_jsonb(NEW)->>'rsvp_id','userId',to_jsonb(NEW)->>'matched_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'email'),
        'phone',public.issue_1770_normalize_phone(to_jsonb(NEW)->>'phone'),
        'phoneCountryIso',to_jsonb(NEW)->>'phone_country_iso');
    END IF;
  ELSIF TG_ARGV[0]='order' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object(
        'eventId',to_jsonb(OLD)->>'event_id','userId',to_jsonb(OLD)->>'buyer_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(OLD)->>'buyer_name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(OLD)->>'buyer_email'),
        'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(OLD)->>'buyer_phone_e164',to_jsonb(OLD)->>'buyer_phone')),
        'confirmedAt',to_jsonb(OLD)->>'confirmed_at','paymentStatus',to_jsonb(OLD)->>'payment_status');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object(
        'eventId',to_jsonb(NEW)->>'event_id','userId',to_jsonb(NEW)->>'buyer_user_id',
        'name',lower(regexp_replace(btrim(COALESCE(to_jsonb(NEW)->>'buyer_name','')),'\s+',' ','g')),
        'email',public.issue_1770_normalize_email(to_jsonb(NEW)->>'buyer_email'),
        'phone',public.issue_1770_normalize_phone(COALESCE(to_jsonb(NEW)->>'buyer_phone_e164',to_jsonb(NEW)->>'buyer_phone')),
        'confirmedAt',to_jsonb(NEW)->>'confirmed_at','paymentStatus',to_jsonb(NEW)->>'payment_status');
    END IF;
  ELSIF TG_ARGV[0]='ticket_holder' THEN
    IF TG_OP<>'INSERT' THEN
      v_old_state:=jsonb_build_object('eventId',to_jsonb(OLD)->>'event_id','orderId',to_jsonb(OLD)->>'order_id');
    END IF;
    IF TG_OP<>'DELETE' THEN
      v_new_state:=jsonb_build_object('eventId',to_jsonb(NEW)->>'event_id','orderId',to_jsonb(NEW)->>'order_id');
    END IF;
  ELSE
    RETURN COALESCE(NEW,OLD);
  END IF;

  IF TG_OP='UPDATE' AND v_old_state IS NOT DISTINCT FROM v_new_state THEN
    RETURN NEW;
  END IF;
  v_revision := md5(COALESCE(v_new_state,v_old_state,'{}'::jsonb)::text);
  INSERT INTO public.brand_person_ingest_outbox(source_kind,source_id,operation,revision_key)
    VALUES(TG_ARGV[0],v_id,v_operation,v_revision)
    ON CONFLICT DO NOTHING;
  RETURN COALESCE(NEW,OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_1770_ingest_enqueue_failed source=% id=%',TG_ARGV[0],v_id;
  RETURN COALESCE(NEW,OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_reservation_create(uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_create(uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text) TO authenticated;
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.pg_finalize_guest_reservation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.issue_1770_enqueue_source() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1770_enqueue_source() TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source_derived(text,uuid) TO service_role;

DO $post$
DECLARE
  v_expected record;
  v_drift text[] := '{}'::text[];
BEGIN
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', '3810b4f9ee2d8faeb9f2b373959b0756'),
    ('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', '9fe5e36dee2bd3bdc8ed26e2081716fb'),
    ('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)', 'eec5f6a9750eb113d3c75c027455a704'),
    ('public.biz_reservation_create(uuid,timestamp with time zone,integer,text,text,text,text,uuid,text,text,text[],text)', '49ffd0c7006d839ca41fbcf0a082d643'),
    ('public.pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text)', '97adc49789e7e254744ff9b60efbe9ba'),
    ('public.pg_finalize_guest_reservation(uuid,text)', '51b79bcbec509bfd5f3a115f87af472d'),
    ('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamp with time zone)', 'eaa44b5386a7a6a668e69ce769cdd6d8'),
    ('public.issue_1770_enqueue_source()', '82f95d2c7440945e43df55948c164f1f')
  ) AS expected(signature, definition_md5) LOOP
    IF to_regprocedure(v_expected.signature) IS NULL
       OR md5(pg_get_functiondef(to_regprocedure(v_expected.signature))) <> v_expected.definition_md5 THEN
      v_drift := array_append(v_drift, v_expected.signature);
    END IF;
  END LOOP;
  IF cardinality(v_drift)>0 THEN
    RAISE EXCEPTION 'issue_1857_post_definition_drift:%',array_to_string(v_drift,',');
  END IF;
  IF to_regprocedure('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text)') IS NOT NULL
     OR to_regprocedure('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text)') IS NOT NULL
     OR to_regprocedure('public.pg_create_guest_reservation(uuid,timestamp with time zone,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1857_old_signature_survived';
  END IF;

  IF pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure) IS DISTINCT FROM
       (SELECT definition FROM issue_1857_definition_snapshot WHERE object_name='biz_resolve_brand_person_source_derived') THEN
    RAISE EXCEPTION 'issue_1857_derived_definition_changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_1857_definition_snapshot snapshot
    LEFT JOIN pg_trigger current_trigger
      ON current_trigger.tgname=snapshot.object_name AND NOT current_trigger.tgisinternal
    WHERE snapshot.object_kind='trigger'
      AND pg_get_triggerdef(current_trigger.oid,true) IS DISTINCT FROM snapshot.definition
  ) OR (SELECT count(*) FROM pg_trigger WHERE tgname IN ('issue_1770_event_rsvp_ingest','issue_1770_rsvp_plus_one_ingest','issue_1770_order_ingest','issue_1770_ticket_ingest') AND NOT tgisinternal)<>4 THEN
    RAISE EXCEPTION 'issue_1857_trigger_definition_changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('event_rsvps','guest_phone_country_iso','event_rsvps_guest_phone_country_iso_check'),
      ('event_rsvp_guests','phone_country_iso','event_rsvp_guests_phone_country_iso_check'),
      ('reservations','guest_phone_country_iso','reservations_guest_phone_country_iso_check'),
      ('reservation_checkout_sessions','buyer_phone_country_iso','reservation_checkout_sessions_buyer_phone_country_iso_check'),
      ('brand_person_contact_method_sources','phone_country_iso','brand_person_contact_method_sources_phone_country_iso_check')
    ) AS expected(table_name,column_name,constraint_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name
        AND c.column_name=expected.column_name AND c.is_nullable='YES' AND c.data_type='text'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relname=expected.table_name AND c.conname=expected.constraint_name
        AND pg_get_constraintdef(c.oid,true)=format('CHECK (%I IS NULL OR %I ~ ''^[A-Z]{2}$''::text)',expected.column_name,expected.column_name)
    )
  ) THEN RAISE EXCEPTION 'issue_1857_schema_postcondition_failed'; END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', false, true),
      ('public.submit_event_rsvp_with_delivery(uuid,uuid,text,text,text,text,integer,jsonb,text,text)', false, true),
      ('public.issue_1388_create_stay_group(uuid,text,jsonb,bigint,uuid)', false, (SELECT definition::boolean FROM issue_1857_definition_snapshot WHERE object_name='issue_1388_create_stay_group_service_role')),
      ('public.biz_reservation_create(uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text)', true, (SELECT definition::boolean FROM issue_1857_definition_snapshot WHERE object_name='biz_reservation_create_service_role')),
      ('public.pg_create_guest_reservation(uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text)', false, true),
      ('public.pg_finalize_guest_reservation(uuid,text)', false, true),
      ('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)', false, true),
      ('public.issue_1770_enqueue_source()', false, true),
      ('public.biz_resolve_brand_person_source_derived(text,uuid)', false, true)
    ) AS expected(signature,authenticated_execute,service_role_execute)
    WHERE has_function_privilege('anon',expected.signature,'EXECUTE')
       OR has_function_privilege('authenticated',expected.signature,'EXECUTE') IS DISTINCT FROM expected.authenticated_execute
       OR has_function_privilege('service_role',expected.signature,'EXECUTE') IS DISTINCT FROM expected.service_role_execute
  ) THEN
    RAISE EXCEPTION 'issue_1857_acl_postcondition_failed';
  END IF;

  IF position('''phoneCountryIso''' in pg_get_functiondef('public.issue_1770_enqueue_source()'::regprocedure))=0
     OR position('guest_phone_country_iso' in pg_get_functiondef('public.issue_1770_enqueue_source()'::regprocedure))=0
     OR position('phone_country_iso' in pg_get_functiondef('public.issue_1770_enqueue_source()'::regprocedure))=0
     OR position('P1901' in pg_get_functiondef('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure))=0
     OR position('rsvp_event_ended' in pg_get_functiondef('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure))=0
     OR position('P1902' in pg_get_functiondef('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure))=0
     OR position('rsvp_date_unavailable' in pg_get_functiondef('public.submit_event_rsvp(uuid,uuid,text,text,text,text,integer,jsonb,text,text)'::regprocedure))=0
     OR position('reservation' in pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure))>0
     OR position('stay_' in pg_get_functiondef('public.biz_resolve_brand_person_source_derived(text,uuid)'::regprocedure))>0 THEN
    RAISE EXCEPTION 'issue_1857_revision_or_source_scope_postcondition_failed';
  END IF;
END $post$;

COMMIT;
