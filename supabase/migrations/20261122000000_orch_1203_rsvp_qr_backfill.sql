-- ===========================================================================
-- ORCH-1203 GAP-C1 — "every going RSVP always gets a signed, scan-valid QR pass"
-- ===========================================================================
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1203_RSVP_QR_FAIL_CLOSED_HARDENING.md
-- INVESTIGATE: Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1203_QR_ON_ALL_PDFS.md
--
-- Problem (fail-OPEN, env-dependent): if the QR pepper is transiently missing at
-- submit time, submit_event_rsvp writes a going RSVP (primary + guests) with
-- qr_code=NULL and rsvp-notify's handleRsvpPass gates the QR-PDF email on
-- qrCode!=null → no entry pass ever sent. Unlike the ticket path (which RAISES +
-- aborts when the pepper is missing) the RSVP path tolerates a null pepper so the
-- guest can still RSVP (I-1). This migration adds the GUARANTEE the submit path
-- can't make: an idempotent backfill that re-mints + re-delivers once the pepper
-- is restored, plus an every-15-min cron that runs it.
--
-- Monotonicity: prefix 20261122000000 is strictly greater than every migration on
-- main (max 20261120000000) AND every active sibling worktree (ORCH-1201's
-- 20261121000000 head). Clear of 1120/1121; headroom against in-flight ORCH-1204.
--
-- Conventions: GRANT/REVOKE after the closing $$ ; ; cron mirrors the ORCH-1161
-- 15-min net.http_post pattern verbatim. (feedback_edge_deploy_and_migration_apply_hazards)
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) SHARED mint routine (I-4) — the SINGLE source of truth for the RSVP QR
--     signing expression. EXACT extraction of the 3-line mint that
--     submit_event_rsvp already performs for the primary + each guest:
--       v_token      := encode(extensions.gen_random_bytes(16), 'hex');
--       v_token_hash := public.biz_ticket_checkout_token_hash(v_token, pepper);
--       v_qr         := public.biz_rsvp_qr_payload(entity_id, v_token_hash, pepper);
--     Both submit_event_rsvp (redefined in (3) below) and
--     backfill_going_rsvp_qr_codes (4) call THIS — no second QR format exists, so
--     scan-ticket / RSVP-entry scan validates a backfilled qr identically to an
--     inline-minted one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_rsvp_mint_qr(
  p_entity_id       uuid,
  p_qr_token_pepper text
)
RETURNS TABLE (token_hash text, qr_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_token      text;
  v_token_hash text;
BEGIN
  -- biz_ticket_checkout_token_hash + biz_rsvp_qr_payload both assert the pepper
  -- (>=32 chars, not placeholder) and RAISE qr_token_pepper_missing otherwise —
  -- callers gate on pepper-present before calling, so this never fires here.
  v_token      := encode(extensions.gen_random_bytes(16), 'hex');
  v_token_hash := public.biz_ticket_checkout_token_hash(v_token, p_qr_token_pepper);
  RETURN QUERY
    SELECT v_token_hash,
           public.biz_rsvp_qr_payload(p_entity_id, v_token_hash, p_qr_token_pepper);
END;
$$;

-- ---------------------------------------------------------------------------
-- (2) Redefine submit_event_rsvp to call the shared mint (I-4). Param list is
--     UNCHANGED from 20261016000001 (no DROP needed — plain CREATE OR REPLACE);
--     the ONLY behavioural delta is the two inline 3-line mints are replaced by a
--     single call to public.biz_rsvp_mint_qr. Byte-identical output for a given
--     (entity_id, token_hash) pair — same gen_random_bytes(16) entropy source,
--     same biz_ticket_checkout_token_hash, same biz_rsvp_qr_payload. Everything
--     else (capacity math, guest delete/insert, approval resolve) is verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
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

  -- 3b. Per-guest validation (§H.4 / §H.6).
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

  -- 4. Resolve approval + attendance (UNCHANGED).
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

  -- 6. Per-guest child set: delete-then-insert (idempotent). Mint via the SHARED
  --    routine (I-4) ONLY on a going resolution.
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

      IF v_status = 'going' AND p_qr_token_pepper IS NOT NULL THEN
        SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
          FROM public.biz_rsvp_mint_qr(v_guest_id, p_qr_token_pepper) m;
        UPDATE public.event_rsvp_guests
           SET qr_token_hash = v_token_hash, qr_code = v_qr
         WHERE id = v_guest_id;
      END IF;
    END LOOP;
  END IF;

  -- 7. Mint the PRIMARY's signed pass via the SHARED routine (I-4), idempotent on
  --    qr_token_hash, ONLY for going.
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

-- ---------------------------------------------------------------------------
-- (3) The GUARANTEE — backfill_going_rsvp_qr_codes(): idempotent re-mint +
--     re-deliver for any going RSVP / guest left with qr_code=NULL.
--
--     • Pepper is PASSED IN (p_qr_token_pepper) — ORCH-0777 removed the DB GUC, so
--       the pepper lives ONLY in the edge-fn env; the backfill-rsvp-qr-codes edge
--       fn resolves it (qrTokenPepper()) and passes it, exactly as the inline
--       submit path does. No-ops (returns 0) if the pepper is absent — never
--       RAISES (so the cron never errors when the env is mid-rotation; the C-1
--       alert is what flags the misconfig).
--     • Mints via the SHARED routine (I-4) for event_rsvps (rsvp_status='going',
--       qr_code IS NULL) + event_rsvp_guests (going parent, qr_code IS NULL).
--       Idempotent: only NULL-qr rows are touched, so a row that already has a qr
--       is never re-minted.
--     • Enqueues exactly ONE QR-bearing rsvp_pass per newly-minted row with a
--       STABLE idempotency key `rsvp_pass_qr:<id>` that is DISTINCT from the
--       inline `rsvp_pass:<rsvpId>:<guestId|primary>` key (I-3) — so a prior
--       push-only / passless attempt made while qr was null can NOT suppress the
--       QR pass, AND re-runs never double-send (ON CONFLICT DO NOTHING).
--     • Returns the count minted (primaries + guests).
--
--     The enqueued rows are drained by the every-15-min backfill-rsvp-qr-codes
--     edge fn (which invokes rsvp-notify per freshly-enqueued row), wired in (4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_going_rsvp_qr_codes(
  p_qr_token_pepper text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pepper      text;
  v_minted      integer := 0;
  v_rec         record;
  v_token_hash  text;
  v_qr          text;
  v_brand_name  text;
  v_brand_slug  text;
  v_deep_link   text;
BEGIN
  -- (a) Pepper pre-flight — the pepper is PASSED IN by the caller (edge fn env;
  --     ORCH-0777 removed the DB GUC). No-op (NOT raise) when absent / short /
  --     placeholder so the cron never errors mid-rotation.
  BEGIN
    v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);
  EXCEPTION WHEN OTHERS THEN
    v_pepper := NULL;
  END;
  IF v_pepper IS NULL THEN
    RETURN 0;
  END IF;

  -- (b) PRIMARY rows: going + qr_code IS NULL. Mint via the SHARED routine and
  --     enqueue one QR rsvp_pass. event/brand context resolved per row.
  FOR v_rec IN
    SELECT r.id          AS rsvp_id,
           r.event_id    AS event_id,
           r.guest_email AS recipient_email,
           r.guest_name  AS recipient_name,
           r.user_id     AS primary_user_id,
           e.title       AS event_title,
           e.slug        AS event_slug,
           e.brand_id    AS brand_id,
           e.location_text AS venue_line
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
     WHERE r.rsvp_status = 'going'
       AND r.qr_code IS NULL
       AND e.event_type = 'rsvp'
  LOOP
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
      FROM public.biz_rsvp_mint_qr(v_rec.rsvp_id, v_pepper) m;
    UPDATE public.event_rsvps
       SET qr_token_hash = v_token_hash, qr_code = v_qr
     WHERE id = v_rec.rsvp_id;

    SELECT b.name, b.slug INTO v_brand_name, v_brand_slug
      FROM public.brands b WHERE b.id = v_rec.brand_id;
    v_brand_name := COALESCE(v_brand_name, 'Mingla');
    v_deep_link := CASE
      WHEN v_brand_slug IS NOT NULL AND v_rec.event_slug IS NOT NULL
        THEN 'https://usemingla.com/e/' || v_brand_slug || '/' || v_rec.event_slug
      ELSE 'https://usemingla.com'
    END;

    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES (
      v_rec.event_id, v_rec.rsvp_id, NULL, v_rec.recipient_email, 'pending',
      'rsvp_pass',
      jsonb_build_object(
        'template_key',   'rsvp_pass',
        'rsvp_id',        v_rec.rsvp_id,
        'event_id',       v_rec.event_id,
        'recipientEmail', v_rec.recipient_email,
        'recipientName',  v_rec.recipient_name,
        'qrCode',         v_qr,
        'matchedUserId',  NULL,
        'primaryUserId',  v_rec.primary_user_id,
        'role',           'primary',
        'eventName',      COALESCE(v_rec.event_title, 'your event'),
        'dateLine',       NULL,
        'venueLine',      v_rec.venue_line,
        'brandName',      v_brand_name,
        'brandId',        v_rec.brand_id,
        'deepLink',       v_deep_link
      ),
      'rsvp_pass_qr:' || v_rec.rsvp_id::text,
      0
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_minted := v_minted + 1;
  END LOOP;

  -- (c) GUEST rows: parent going + guest qr_code IS NULL.
  FOR v_rec IN
    SELECT g.id            AS guest_id,
           g.rsvp_id       AS rsvp_id,
           g.email         AS recipient_email,
           g.name          AS recipient_name,
           g.matched_user_id AS matched_user_id,
           r.event_id      AS event_id,
           e.title         AS event_title,
           e.slug          AS event_slug,
           e.brand_id      AS brand_id,
           e.location_text AS venue_line
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
     WHERE r.rsvp_status = 'going'
       AND g.qr_code IS NULL
       AND e.event_type = 'rsvp'
  LOOP
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_qr
      FROM public.biz_rsvp_mint_qr(v_rec.guest_id, v_pepper) m;
    UPDATE public.event_rsvp_guests
       SET qr_token_hash = v_token_hash, qr_code = v_qr
     WHERE id = v_rec.guest_id;

    SELECT b.name, b.slug INTO v_brand_name, v_brand_slug
      FROM public.brands b WHERE b.id = v_rec.brand_id;
    v_brand_name := COALESCE(v_brand_name, 'Mingla');
    v_deep_link := CASE
      WHEN v_brand_slug IS NOT NULL AND v_rec.event_slug IS NOT NULL
        THEN 'https://usemingla.com/e/' || v_brand_slug || '/' || v_rec.event_slug
      ELSE 'https://usemingla.com'
    END;

    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES (
      v_rec.event_id, v_rec.rsvp_id, NULL, v_rec.recipient_email, 'pending',
      'rsvp_pass',
      jsonb_build_object(
        'template_key',   'rsvp_pass',
        'rsvp_id',        v_rec.rsvp_id,
        'event_id',       v_rec.event_id,
        'recipientEmail', v_rec.recipient_email,
        'recipientName',  v_rec.recipient_name,
        'qrCode',         v_qr,
        'matchedUserId',  v_rec.matched_user_id,
        'primaryUserId',  NULL,
        'role',           'guest',
        'eventName',      COALESCE(v_rec.event_title, 'your event'),
        'dateLine',       NULL,
        'venueLine',      v_rec.venue_line,
        'brandName',      v_brand_name,
        'brandId',        v_rec.brand_id,
        'deepLink',       v_deep_link
      ),
      'rsvp_pass_qr:' || v_rec.guest_id::text,
      0
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_minted := v_minted + 1;
  END LOOP;

  RETURN v_minted;
END;
$$;

COMMENT ON FUNCTION public.backfill_going_rsvp_qr_codes(text) IS
  'ORCH-1203 GAP-C1 — idempotently mints the signed qr_code (via the shared '
  'biz_rsvp_mint_qr routine, I-4) for any going RSVP/guest left with qr_code=NULL '
  '(e.g. submitted while the pepper was transiently missing) and enqueues exactly '
  'one QR-bearing rsvp_pass per newly-minted row (stable key rsvp_pass_qr:<id>, '
  'distinct from the inline rsvp_pass: key so a prior passless attempt cannot '
  'suppress it — I-3). No-ops when the pepper is absent. Returns the count minted.';

COMMIT;

-- ===========================================================================
-- GRANTs / REVOKEs — service-role only; locked down from anon + PUBLIC.
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public.biz_rsvp_mint_qr(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_rsvp_mint_qr(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.biz_rsvp_mint_qr(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) TO service_role;

-- ===========================================================================
-- pg_cron — every 15 min, drive the backfill-rsvp-qr-codes edge fn (mirrors the
-- ORCH-1161 notify-reminders cron verbatim: vault-secret URL + service-role
-- bearer + net.http_post). The edge fn calls backfill_going_rsvp_qr_codes() then
-- invokes rsvp-notify for each freshly-enqueued QR row (rsvp_notifications has no
-- standalone cron drainer — rows are sent by per-row rsvp-notify invocation, the
-- same path the inline dispatcher uses).
-- ===========================================================================

-- §1. Extension + vault pre-flight (advisory NOTICEs only — CI-safe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'ORCH-1203 advisory: vault schema not present. Backfill cron will register but http_post calls will fail at runtime until Supabase vault is configured.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-1203 advisory: vault.secrets row "supabase_url" missing. Backfill cron will register but http_post calls will fail at runtime.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-1203 advisory: vault.secrets row "service_role_key" missing. Backfill cron will register but http_post calls will fail at runtime.';
  END IF;
END$$;

-- §2. Idempotent re-schedule (unschedule if present, then schedule).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1203_rsvp_qr_backfill'
  ) THEN
    PERFORM cron.unschedule('orch_1203_rsvp_qr_backfill');
  END IF;
END$$;

-- §3. Schedule backfill-rsvp-qr-codes every 15 minutes.
SELECT cron.schedule(
  'orch_1203_rsvp_qr_backfill',
  '*/15 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/backfill-rsvp-qr-codes',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- §4. Verification probes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1203_rsvp_qr_backfill'
  ) THEN
    RAISE EXCEPTION 'ORCH-1203 probe failed: backfill cron job not registered after schedule call';
  END IF;
END$$;

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1203_rsvp_qr_backfill'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'ORCH-1203 probe failed: backfill cron schedule is % but expected */15 * * * *', v_schedule;
  END IF;
END$$;
