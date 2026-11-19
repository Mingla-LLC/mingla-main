-- #4508 Phase 0 — account matching by phone.
--
-- Root cause (issue #4508, "Live case, 18 Nov 2026"): biz_resolve_verified_user
-- compared auth.users.phone (stored as digits, no "+") with the guest phone
-- (E.164 with "+") by exact equality, so a plus-one could never be matched to
-- an account by phone.
--
-- 0.1 biz_resolve_verified_user matches PHONE FIRST, then a verified email,
--     comparing phones as digits only on both sides. The phone proof is the
--     one account_owns_contact accepts (a code received at that number): the
--     possession ledger, a live verified claim contact, or a GoTrue phone
--     identity. When a phone is supplied an email is never a fallback.
-- 0.2 submit_event_rsvp never resolves a plus-one to the RSVP's own primary
--     account (the one changed line is marked #4508 0.2; the rest of the body is
--     copied from 20271215004063 lines 500-772 unchanged).
-- 0.3 No backfill. The one historical row that would now match holds the
--     inviter's own number; it is corrected by hand only on Seth's say-so.
-- 0.4 Grants unchanged: service_role only.
--
-- Read-only probe to run before applying (must return no rows):
--   select regexp_replace(phone_e164,'\D','','g'), count(*)
--     from public.verified_phone_identities group by 1 having count(*) > 1;
--
-- ROLLBACK (R-7): nothing here changes a table or a row. To roll back,
-- re-apply the previous definitions: biz_resolve_verified_user from
-- 20261016000001_orch_1163_event_rsvp_guests.sql (its last writer before this
-- file) and submit_event_rsvp from 20271215004063 lines 500-772, with their
-- grants (service_role only). If 20281119014508 has also run, roll that back
-- first (its own note): it re-creates submit_event_rsvp on top of this one.
--
-- The invariant declaration lives beside its test:
--   supabase/migrations/__tests__/issue_4508_guest_phone_match.implementor.pg17.test.sql

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.biz_resolve_verified_user(
  p_email text,
  p_phone text
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  v_digits text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
  v_user_id uuid;
  v_candidate uuid;
  v_number_expr text;
BEGIN
  -- (a) A phone was supplied: the phone decides, and an email is NEVER a
  --     fallback (an email typed beside someone else's number must not hand
  --     that number's pass to the email's owner). The proof is exactly the one
  --     account_owns_contact accepts (a code received at that number): the
  --     possession ledger, a live verified claim contact, or a GoTrue phone
  --     identity. Every candidate is re-checked through account_owns_contact.
  IF v_digits IS NOT NULL AND length(v_digits) BETWEEN 7 AND 15 THEN
    FOR v_candidate IN
      SELECT c.user_id FROM (
        SELECT v.user_id, 1 AS rank, v.verified_at AS at
          FROM public.verified_phone_identities v
         WHERE regexp_replace(v.phone_e164, '\D', '', 'g') = v_digits
        UNION ALL
        SELECT a.user_id, 2, a.last_proved_at
          FROM public.account_claim_contacts a
         WHERE a.channel = 'phone' AND a.revoked_at IS NULL
           AND regexp_replace(a.value, '\D', '', 'g') = v_digits
      ) c
      ORDER BY c.rank, c.at DESC
    LOOP
      IF public.account_owns_contact(v_candidate, NULL, '+' || v_digits) THEN
        RETURN v_candidate;
      END IF;
    END LOOP;

    -- GoTrue phone identity, read only where auth.identities exists (the
    -- stock CI image has none), the same fail-closed idiom
    -- account_owns_contact uses. auth.users.phone_confirmed_at alone is NOT a
    -- proof here.
    IF to_regclass('auth.identities') IS NOT NULL THEN
      v_number_expr := CASE
        WHEN EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'auth' AND table_name = 'users'
             AND column_name = 'phone'
        ) THEN 'coalesce(i.identity_data->>''phone'', u.phone)'
        ELSE 'i.identity_data->>''phone'''
      END;
      FOR v_candidate IN EXECUTE format($q$
        SELECT i.user_id
          FROM auth.identities i
          JOIN auth.users u ON u.id = i.user_id
         WHERE i.provider = 'phone'
           AND regexp_replace(coalesce(%1$s, ''), '[^0-9]', '', 'g') = $1
         ORDER BY i.last_sign_in_at DESC NULLS LAST
      $q$, v_number_expr) USING v_digits
      LOOP
        IF public.account_owns_contact(v_candidate, NULL, '+' || v_digits) THEN
          RETURN v_candidate;
        END IF;
      END LOOP;
    END IF;
    RETURN NULL;
  END IF;

  -- (b) No phone: a verified email (unchanged rule). Read only where
  --     auth.identities exists; a database without it answers NULL.
  IF v_email IS NOT NULL AND to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $q$
      SELECT i.user_id FROM auth.identities i
       WHERE lower(i.identity_data->>'email') = $1
         AND lower(COALESCE(i.identity_data->>'email_verified', '')) IN ('true', 't')
       ORDER BY i.last_sign_in_at DESC NULLS LAST
       LIMIT 1
    $q$ INTO v_user_id USING v_email;
  END IF;
  RETURN v_user_id;
END;
$function$;

COMMENT ON FUNCTION public.biz_resolve_verified_user(text, text) IS
  '#4508: a supplied phone decides alone (the account_owns_contact proof, digits only on both sides; never an email fallback); with no phone, a verified email. NEVER user_metadata.';
REVOKE ALL ON FUNCTION public.biz_resolve_verified_user(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_verified_user(text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
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

  -- #4063 W0: an anonymous submission never changes an RSVP that already exists for that email.
  IF p_user_id IS NULL AND EXISTS (
    SELECT 1
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id
       AND lower(btrim(r.guest_email)) = lower(btrim(p_guest_email))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P4063',
      MESSAGE = 'rsvp_already_exists';
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
        -- #4508 0.2: a guest never resolves to the RSVP's own primary account.
        NULLIF(public.biz_resolve_verified_user(v_gemail, v_gphone), p_user_id)
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

COMMENT ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) IS '#4063: an anonymous submission never changes an RSVP that already exists for that email. I-4063-RSVP-SUBMIT-GUARD. #4508: a plus-one never resolves to the primary''s own account.';

REVOKE ALL ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(
  uuid, uuid, text, text, text, text, integer, jsonb, text, text
) TO service_role;

COMMIT;
