-- ORCH-1163 [rsvp-shared-body] — Migration 2: per-guest plus-ones + per-guest QR
-- passes + verified-account match + the matched-guest Calendar read.
--
-- LEG 2 of META-ORCH-1166. Adds the FLOW B (§H) + FLOW C (§I) + §J expansion DB:
--   • child table `event_rsvp_guests` (name/email/phone PER plus-one — NOT a count,
--     NOT a JSONB blob; the relational child mirrors the primary's contact triple);
--   • per-guest signed QR token cols + a matched-account FK on the child;
--   • `event_rsvps.qr_token_hash` / `qr_code` (the PRIMARY's signed pass);
--   • redefined `submit_event_rsvp` (delete-then-insert guests, mint per-guest +
--     primary signed `mingla:v1:rsvp:` tokens ONLY for going, resolve verified
--     account matches) — single owner preserved;
--   • `biz_rsvp_qr_payload` (sibling of biz_ticket_checkout_qr_payload — emits the
--     `mingla:v1:rsvp:` prefix; takes ANY entity id so it serves the primary rsvp_id
--     AND each guest_id);
--   • `biz_resolve_verified_user` (VERIFIED auth.identities email / phone_confirmed_at
--     phone, NEVER user_metadata — ORCH-1111/1112 pattern);
--   • `fetch_user_going_rsvps` (the §J.6 UNION read: primary rows + matched-guest
--     rows, each with the right per-entity QR + role discriminator).
--
-- ORCH-1150 PRESERVED: plus-ones STILL count toward capacity via SUM(1+plus_count);
-- maybe stays cap-neutral + mints NO QR/pass; tokens + matches fire only at the
-- shared submit_event_rsvp single owner.
--
-- SAFE-MIGRATION PROTOCOL: applied via the Supabase Management API (browser UA),
-- recorded in schema_migrations. $function$ terminator before each GRANT; DROP the
-- old submit_event_rsvp signature before re-CREATE (the param list changes —
-- p_guests + p_qr_token_pepper added — so a plain CREATE OR REPLACE would collide on
-- the new overload; DROP is mandatory). The two NEW functions need no DROP. New
-- SECURITY DEFINER functions: STABLE/VOLATILE as noted, SET search_path, GRANT.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API (SPEC §13).

BEGIN;

-- ===========================================================================
-- (1) The PRIMARY's signed pass cols (mirror tickets/event_rsvps).
-- ===========================================================================
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS qr_token_hash text NULL,
  ADD COLUMN IF NOT EXISTS qr_code       text NULL;

-- ORCH-1163 §J.6 — the consumer Calendar tab subscribes to `event_rsvps` realtime
-- (useCalendarEntries `useMyGoingRsvps`) so a going/cancel reflects live. Add the
-- table to the realtime publication (idempotent) and pair it in the ORCH-0854
-- REALTIME-TABLE-PUBLICATION-PAIRED gate baseline. Mirrors the `tickets` add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'event_rsvps'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_rsvps;
  END IF;
END $$;

-- ===========================================================================
-- (2) The child table — one CONTACT record per plus-one + per-guest pass +
--     matched-account FK (§H.3 + §J.1, folded into one migration).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.event_rsvp_guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id     uuid NOT NULL REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  email       text NOT NULL CHECK (length(btrim(email)) > 0),
  phone       text NOT NULL CHECK (length(btrim(phone)) > 0),
  qr_token_hash   text NULL,                                          -- mirror tickets/event_rsvps
  qr_code         text NULL,                                          -- full signed mingla:v1:rsvp: payload
  matched_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL, -- §J.4 verified-identity match
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_rsvp_guests_rsvp_id_idx
  ON public.event_rsvp_guests(rsvp_id);
CREATE INDEX IF NOT EXISTS event_rsvp_guests_matched_user_idx
  ON public.event_rsvp_guests(matched_user_id) WHERE matched_user_id IS NOT NULL;

ALTER TABLE public.event_rsvp_guests ENABLE ROW LEVEL SECURITY;

-- Host read (event_manager on the parent event's brand) — mirror event_rsvps_host_read.
DROP POLICY IF EXISTS event_rsvp_guests_host_read ON public.event_rsvp_guests;
CREATE POLICY event_rsvp_guests_host_read ON public.event_rsvp_guests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id
    WHERE r.id = event_rsvp_guests.rsvp_id
      AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('event_manager')
  ));

-- Owner read — the primary RSVP-er reads their own plus-ones, OR the MATCHED user
-- reads its OWN guest row (§J.6 read path).
DROP POLICY IF EXISTS event_rsvp_guests_owner_read ON public.event_rsvp_guests;
CREATE POLICY event_rsvp_guests_owner_read ON public.event_rsvp_guests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.event_rsvps r
      WHERE r.id = event_rsvp_guests.rsvp_id AND r.user_id = auth.uid()
    )
    OR matched_user_id = auth.uid()
  );

-- Writes flow ONLY via the SECURITY DEFINER submit_event_rsvp RPC under service-role;
-- no anon/authenticated table grant.
GRANT SELECT, INSERT, DELETE ON TABLE public.event_rsvp_guests TO service_role;

-- ===========================================================================
-- (3) biz_rsvp_qr_payload — sibling of biz_ticket_checkout_qr_payload (the
--     `mingla:v1:rsvp:` prefix). Takes ANY entity id (the primary rsvp_id OR a
--     guest_id) so it serves both. Reuses the same pepper-asserting helper.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.biz_rsvp_qr_payload(
  p_entity_id uuid,
  p_token_hash text,
  p_qr_token_pepper text
) RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT 'mingla:v1:rsvp:' || p_entity_id::text || ':sig:' || encode(extensions.digest(
    p_entity_id::text || ':' || p_token_hash || ':' || public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper),
    'sha256'
  ), 'hex')
$function$;

GRANT EXECUTE ON FUNCTION public.biz_rsvp_qr_payload(uuid, text, text) TO service_role;

-- ===========================================================================
-- (4) biz_resolve_verified_user — VERIFIED-only account match (§J.2).
--     email via auth.identities (email_verified IN ('true','t')), phone via
--     auth.users.phone_confirmed_at. NEVER user_metadata/raw_user_meta_data.
--     Email match preferred; phone fallback; NULL when neither verified-matches.
-- ===========================================================================
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
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_user_id uuid;
BEGIN
  -- (a) Verified-email match via auth.identities (ORCH-1111 precedent). Pick the
  --     most-recently-signed-in verified identity whose email equals the guest's.
  IF v_email IS NOT NULL THEN
    SELECT i.user_id INTO v_user_id
      FROM auth.identities i
     WHERE lower(i.identity_data->>'email') = v_email
       AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t')
     ORDER BY i.last_sign_in_at DESC NULLS LAST
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN v_user_id;
    END IF;
  END IF;

  -- (b) Verified-phone fallback: a CONFIRMED auth.users.phone only.
  IF v_phone IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM auth.users u
     WHERE u.phone = v_phone
       AND u.phone_confirmed_at IS NOT NULL
     ORDER BY u.last_sign_in_at DESC NULLS LAST
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN v_user_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.biz_resolve_verified_user(text, text) TO service_role;

-- ===========================================================================
-- (5) Redefine submit_event_rsvp — add p_guests jsonb + p_qr_token_pepper.
--     DROP the old 7-arg signature first (param list changes → mandatory).
--     Deltas vs 20261012000000 (the ORCH-1150 maybe version):
--       • delete-then-insert event_rsvp_guests from p_guests (idempotent);
--       • validate guests.length === clamped plus_count for going/maybe;
--       • mint primary + per-guest signed mingla:v1:rsvp: tokens ONLY for going;
--       • resolve matched_user_id per guest (going OR maybe — useful for upgrade).
--     RSVP capacity math (SUM(1+plus_count)) UNCHANGED.
-- ===========================================================================
DROP FUNCTION IF EXISTS public.submit_event_rsvp(uuid, uuid, text, text, text, text, integer);

CREATE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0,
  p_guests      jsonb   DEFAULT '[]'::jsonb,
  p_qr_token_pepper text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event       public.events%ROWTYPE;
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
  v_token       text;
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
      IF NULLIF(btrim(COALESCE(v_guest->>'name', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'email', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(v_guest->>'phone', '')), '') IS NULL THEN
        RAISE EXCEPTION 'rsvp_guest_contact_required';
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
           waitlisted_at = CASE WHEN v_status = 'waitlisted' THEN COALESCE(waitlisted_at, now()) ELSE NULL END
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.event_rsvps
      (event_id, user_id, guest_name, guest_email, guest_phone,
       rsvp_status, approval_status, plus_count, waitlisted_at)
    VALUES
      (p_event_id, p_user_id, v_name,
       NULLIF(btrim(p_guest_email), ''), NULLIF(btrim(p_guest_phone), ''),
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
      INSERT INTO public.event_rsvp_guests (rsvp_id, name, email, phone, matched_user_id)
      VALUES (
        v_existing_id, v_gname, v_gemail, v_gphone,
        public.biz_resolve_verified_user(v_gemail, v_gphone)
      )
      RETURNING id INTO v_guest_id;

      -- Mint the per-guest signed pass ONLY on a going resolution.
      IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
        v_token := encode(extensions.gen_random_bytes(16), 'hex');
        v_token_hash := public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper);
        v_qr := public.biz_rsvp_qr_payload(v_guest_id, v_token_hash, p_qr_token_pepper);
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
      v_token := encode(extensions.gen_random_bytes(16), 'hex');
      v_token_hash := public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper);
      v_primary_qr := public.biz_rsvp_qr_payload(v_existing_id, v_token_hash, p_qr_token_pepper);
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

GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(uuid, uuid, text, text, text, text, integer, jsonb, text) TO service_role;

-- ===========================================================================
-- (6) fetch_user_going_rsvps — the §J.6 UNION read: primary rows + matched-guest
--     rows. Each row is a flat record the calendar service maps to ConsumerRsvpRow.
--     SECURITY DEFINER so the guest→rsvp→event join is readable; scoped to the
--     passed user (caller passes auth.uid()).
-- ===========================================================================
DROP FUNCTION IF EXISTS public.fetch_user_going_rsvps(uuid);
CREATE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE (
  rsvp_id         uuid,
  guest_id        uuid,
  role            text,           -- 'primary' | 'guest'
  qr_code         text,
  rsvp_status     text,
  approval_status text,
  plus_count      integer,
  display_name    text,
  invited_by      text,
  event_id        uuid,
  event_title     text,
  event_slug      text,
  cover_media_url text,
  timezone        text,
  location_text   text,
  is_online       boolean,
  online_url      text,
  brand_id        uuid,
  brand_slug      text,
  brand_name      text,
  master_start_at timestamptz,
  master_end_at   timestamptz,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  -- (a) primary rows — the user is the RSVP-er.
  SELECT
    r.id          AS rsvp_id,
    NULL::uuid    AS guest_id,
    'primary'     AS role,
    r.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    r.guest_name  AS display_name,
    NULL::text    AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    r.created_at
  FROM public.event_rsvps r
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE r.user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL

  UNION ALL

  -- (b) matched-guest rows — the user is a verified plus-one on a going RSVP.
  SELECT
    r.id          AS rsvp_id,
    g.id          AS guest_id,
    'guest'       AS role,
    g.qr_code,
    r.rsvp_status,
    r.approval_status,
    r.plus_count,
    g.name        AS display_name,
    r.guest_name  AS invited_by,
    e.id          AS event_id,
    e.title       AS event_title,
    e.slug        AS event_slug,
    e.cover_media_url,
    e.timezone,
    e.location_text,
    e.is_online,
    e.online_url,
    b.id          AS brand_id,
    b.slug        AS brand_slug,
    b.name        AS brand_name,
    ed.start_at   AS master_start_at,
    ed.end_at     AS master_end_at,
    g.created_at
  FROM public.event_rsvp_guests g
  JOIN public.event_rsvps r ON r.id = g.rsvp_id
  JOIN public.events e ON e.id = r.event_id
  JOIN public.brands b ON b.id = e.brand_id
  LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE g.matched_user_id = p_user_id
    AND r.rsvp_status = 'going'
    AND r.approval_status IN ('approved', 'pending')
    AND e.deleted_at IS NULL;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_user_going_rsvps(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
