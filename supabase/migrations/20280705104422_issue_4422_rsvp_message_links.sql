-- #4422 — RSVP messages (spec addendum, parts E to G).
-- Invariants I-4422-EVENT-LINK-HOST-ONLY and I-4422-RSVP-SWITCH-SCOPED are
-- declared in __tests__/issue_4422_rsvp_message_links.implementor.pg17.test.sql.
--
-- E. An RSVP-only release switch, `rsvp_messages_v2`, created OFF. When on,
--    RSVP rows get the event start (so passes finally carry a date line), the
--    live event page, why the guest holds a pass, the last date's end and the
--    guest's QR. Ticket, reservation and food-order messages stay on
--    `messages_v2`. Turning the switch on is a separate step Seth approves.
-- F. Short links (/c/<code>) may now point at an event page on
--    host.usemingla.com, one link per event, so maybe, waitlist, pending and
--    change texts stay one segment.
-- G. The pass row's event link moves from usemingla.com/e/... (404) to the live
--    page on host.usemingla.com.
--
-- Each re-created function is copied from its latest definition with only
-- the lines named in its comment changed. No dynamic SQL.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- E1. The RSVP-only switch, off.
-- ---------------------------------------------------------------------------
INSERT INTO public.issue_4063_switches(name, enabled, changed_at)
VALUES ('rsvp_messages_v2', false, NULL)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E2. rsvp_prepare_notification (20271218054063, lines 46-137): the gate also
--     reads rsvp_messages_v2, and the enrichment adds passReason, eventUrl,
--     eventLastEndAt and qrCode. Caller keys still win.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_prepare_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_guest public.event_rsvp_guests%ROWTYPE;
  v_primary public.event_rsvps%ROWTYPE;
  v_enrich jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_primary
    FROM public.event_rsvps
   WHERE id = NEW.rsvp_id;
  SELECT * INTO v_guest
    FROM public.event_rsvp_guests
   WHERE rsvp_id = NEW.rsvp_id
     AND (
       id::text = nullif(NEW.payload->>'guestId','')
       OR qr_code = nullif(NEW.payload->>'qrCode','')
       OR lower(email) = lower(coalesce(NEW.recipient, ''))
     )
   ORDER BY CASE
     WHEN id::text = nullif(NEW.payload->>'guestId','') THEN 0
     ELSE 1
   END
   LIMIT 1;

  IF (NEW.payload->>'role') = 'guest' THEN
    NEW.payload := NEW.payload || jsonb_strip_nulls(jsonb_build_object(
      'entityId', v_guest.id,
      'guestId', v_guest.id,
      'recipientName', v_guest.name,
      'recipientEmail', v_guest.email,
      'recipientPhone', v_guest.phone,
      'matchedUserId', v_guest.matched_user_id,
      'recoveryCreatedAt', v_guest.pass_recovery_token_created_at
    ));
  ELSE
    NEW.payload := NEW.payload || jsonb_strip_nulls(jsonb_build_object(
      'entityId', v_primary.id,
      'recipientName', v_primary.guest_name,
      'recipientEmail', v_primary.guest_email,
      'recipientPhone', v_primary.guest_phone,
      'primaryUserId', v_primary.user_id,
      'recoveryCreatedAt', v_primary.pass_recovery_token_created_at
    ));
  END IF;

  -- Keep the pre-#4063 payload byte-for-byte compatible until the reviewed
  -- message bundle is live and the release switch is deliberately enabled.
  -- #4422: the RSVP-only switch enriches RSVP rows without changing ticket,
  -- reservation or food-order messages (they stay on messages_v2).
  IF NOT (public.issue_4063_switch_on('messages_v2')
          OR public.issue_4063_switch_on('rsvp_messages_v2')) THEN
    RETURN NEW;
  END IF;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'eventId', event.id,
    'eventName', event.title,
    'brandName', brand.name,
    'brandContactEmail', brand.contact_email,
    'eventStartAt', master_date.start_at,
    'eventEndAt', master_date.end_at,
    'eventTimezone', coalesce(master_date.timezone, event.timezone),
    'venueLine', event.location_text,
    'leadName', CASE
      WHEN (NEW.payload->>'role') = 'guest' THEN v_primary.guest_name
      ELSE NULL
    END,
    'claimed', CASE
      WHEN (NEW.payload->>'role') = 'guest'
        THEN v_guest.matched_user_id IS NOT NULL
      ELSE v_primary.user_id IS NOT NULL
    END,
    -- #4422: why this guest holds a pass, for the text that tells them.
    'passReason', CASE
      WHEN NEW.template_key = 'rsvp_waitlist_promoted' THEN 'spot_opened'
      WHEN NEW.template_key = 'rsvp_approved'
        OR (NEW.template_key = 'rsvp_pass' AND event.rsvp_approval_mode = 'manual')
        THEN 'approved'
      ELSE 'going'
    END,
    -- #4422: the live public page (host.usemingla.com), never usemingla.com/e/.
    'eventUrl', CASE
      WHEN brand.slug IS NOT NULL AND event.slug IS NOT NULL
        THEN 'https://host.usemingla.com/e/' || brand.slug || '/' || event.slug
      ELSE NULL
    END,
    'eventLastEndAt', last_date.last_end_at,
    'qrCode', CASE
      WHEN (NEW.payload->>'role') = 'guest' THEN v_guest.qr_code
      ELSE v_primary.qr_code
    END
  ))
    INTO v_enrich
    FROM public.events AS event
    JOIN public.brands AS brand ON brand.id = event.brand_id
    LEFT JOIN LATERAL (
      SELECT date.start_at, date.end_at, date.timezone
        FROM public.event_dates AS date
       WHERE date.event_id = event.id
         AND date.is_master
       ORDER BY date.start_at, date.id
       LIMIT 1
    ) AS master_date ON true
    LEFT JOIN LATERAL (
      SELECT max(coalesce(date.end_at, date.start_at)) AS last_end_at
        FROM public.event_dates AS date
       WHERE date.event_id = event.id
         AND date.cancelled_at IS NULL
    ) AS last_date ON true
   WHERE event.id = v_primary.event_id;

  -- Existing payload keys are caller-owned and win over canonical enrichment.
  NEW.payload := coalesce(v_enrich, '{}'::jsonb) || NEW.payload;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.rsvp_prepare_notification() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- E3. fn_rsvp_drain_on_capacity_freed (20271218054063, lines 628-723): only
--     the switch initializer changes, so manual promotions stay silent until
--     approval under the RSVP switch too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rsvp_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_id uuid;
  v_capacity integer;
  v_approval_mode text;
  v_event_type text;
  v_confirmed integer;
  v_free integer;
  v_entry record;
  v_has_queue boolean;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2') OR public.issue_4063_switch_on('rsvp_messages_v2');
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := NEW.id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  SELECT event.event_type, event.rsvp_capacity, event.rsvp_approval_mode
    INTO v_event_type, v_capacity, v_approval_mode
    FROM public.events AS event
   WHERE event.id = v_event_id;

  IF v_event_type IS DISTINCT FROM 'rsvp' THEN RETURN NEW; END IF;
  IF v_capacity IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(sum(1 + rsvp.plus_count), 0)
    INTO v_confirmed
    FROM public.event_rsvps AS rsvp
   WHERE rsvp.event_id = v_event_id
     AND rsvp.rsvp_status = 'going'
     AND rsvp.approval_status = 'approved';

  v_free := v_capacity - v_confirmed;
  IF v_free <= 0 THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'rsvp_notifications'
  ) INTO v_has_queue;

  FOR v_entry IN
    SELECT rsvp.id, rsvp.plus_count, rsvp.user_id
      FROM public.event_rsvps AS rsvp
     WHERE rsvp.event_id = v_event_id
       AND rsvp.rsvp_status = 'waitlisted'
     ORDER BY rsvp.waitlisted_at ASC NULLS FIRST, rsvp.created_at ASC
  LOOP
    EXIT WHEN v_free <= 0;

    IF v_approval_mode = 'manual' THEN
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'pending',
             promoted_at = now()
       WHERE id = v_entry.id;
    ELSE
      IF (1 + v_entry.plus_count) > v_free THEN
        EXIT;
      END IF;
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'approved',
             promoted_at = now()
       WHERE id = v_entry.id;
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;

    IF v_has_queue
       AND (NOT v_v2 OR v_approval_mode <> 'manual') THEN
      -- Auto promotions keep the established promotion template. The v2
      -- renderer turns it into the on-the-list message; only manual/pending
      -- promotions become silent after the switch is enabled.
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (v_event_id, v_entry.id, NULL, NULL, 'pending', 'rsvp_waitlist_promoted',
         jsonb_build_object('template_key', 'rsvp_waitlist_promoted',
                            'rsvp_id', v_entry.id, 'event_id', v_event_id),
         'rsvp_promote:' || v_entry.id::text || ':' || extract(epoch FROM now())::bigint::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_rsvp_drain_on_capacity_freed() IS
  '#1150/#4063/#4422: deterministic RSVP capacity drain. messages_v2 or rsvp_messages_v2 keeps auto promotion notices and makes manual promotions silent until host approval; switch-off preserves the legacy notice for both modes.';

REVOKE ALL ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  TO service_role;

-- ---------------------------------------------------------------------------
-- F1. claim_links may hold a redirect to an event page on host.usemingla.com.
-- ---------------------------------------------------------------------------
ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS claim_links_subject_kind_check;
ALTER TABLE public.claim_links ADD CONSTRAINT claim_links_subject_kind_check
  CHECK (subject_kind IN (
    'order','rsvp','rsvp_guest','reservation','stay_group','venue_order',
    'ticket','waitlist_offer','event_page'
  ));
ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS claim_links_redirect_kind_shape;
ALTER TABLE public.claim_links ADD CONSTRAINT claim_links_redirect_kind_shape
  CHECK (purpose <> 'redirect' OR subject_kind IN ('waitlist_offer','event_page'));
ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS claim_links_waitlist_shape;
ALTER TABLE public.claim_links ADD CONSTRAINT claim_links_waitlist_shape
  CHECK (purpose = 'redirect' OR subject_kind NOT IN ('waitlist_offer','event_page'));
ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS claim_links_target_origin;
ALTER TABLE public.claim_links ADD CONSTRAINT claim_links_target_origin
  CHECK (
    target_url IS NULL
    OR target_url ~ '^https://([a-z0-9-]+\.)*usemingla\.com/checkout/'
    OR (subject_kind = 'event_page'
        AND target_url ~ '^https://host\.usemingla\.com/(e|t|exp)/[^/?#[:space:]]+/[^/?#[:space:]]+$')
  );

-- ---------------------------------------------------------------------------
-- F2. mint_redirect_link (20271218034063, lines 413-466): a new event_page
--     branch; the waitlist_offer branch and the re-point loop are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mint_redirect_link(
  p_subject_kind text,
  p_subject_id uuid,
  p_target_url text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_code text;
  v_try integer;
BEGIN
  IF p_subject_kind = 'event_page' THEN
    -- #4422: one shared short link per live event page, for RSVP and change
    -- texts. No guest data: the subject is the event.
    IF p_subject_id IS NULL OR p_expires_at IS NULL OR p_expires_at <= now()
       OR p_expires_at > now() + interval '400 days'
       OR NOT EXISTS (
         SELECT 1 FROM public.events e
          WHERE e.id = p_subject_id AND e.deleted_at IS NULL
       ) THEN
      RAISE EXCEPTION 'redirect_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
  IF p_subject_kind <> 'waitlist_offer' OR p_subject_id IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'redirect_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.waitlist_entries w WHERE w.id = p_subject_id
  ) THEN
    RAISE EXCEPTION 'claim_subject_not_found' USING ERRCODE = 'P0002';
  END IF;
  END IF;
  -- The table constraints are the final allow-list for the target URL.
  FOR v_try IN 1..5 LOOP
    SELECT l.code INTO v_code
      FROM public.claim_links l
     WHERE l.purpose = 'redirect' AND l.subject_kind = p_subject_kind
       AND l.subject_id = p_subject_id AND l.revoked_at IS NULL;
    IF v_code IS NOT NULL THEN
      UPDATE public.claim_links
         SET target_url = p_target_url,
             expires_at = greatest(expires_at, p_expires_at)
       WHERE code = v_code;
      RETURN jsonb_build_object('code', v_code, 'expiresAt',
        greatest((SELECT expires_at FROM public.claim_links WHERE code = v_code), p_expires_at));
    END IF;
    v_code := public.issue_4063_claim_code();
    BEGIN
      INSERT INTO public.claim_links(
        code, purpose, subject_kind, subject_id, target_url, expires_at
      ) VALUES (
        v_code, 'redirect', p_subject_kind, p_subject_id,
        p_target_url, p_expires_at
      );
      RETURN jsonb_build_object('code', v_code, 'expiresAt', p_expires_at);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'claim_code_unavailable' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.mint_redirect_link(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_redirect_link(text, uuid, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- G1. enqueue_rsvp_pass (20261123000000, lines 69-214): only the event link
--     host changes (line 118), usemingla.com/e/ -> host.usemingla.com/e/.
--     EXECUTE narrows to service_role (no client calls it; the approval RPCs
--     call it as their owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_rsvp_pass(
  p_rsvp_id         uuid,
  p_qr_token_pepper text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rsvp        public.event_rsvps%ROWTYPE;
  v_event       public.events%ROWTYPE;
  v_brand_name  text;
  v_brand_slug  text;
  v_deep_link   text;
  v_pepper      text;
  v_enqueued    integer := 0;
  v_token_hash  text;
  v_primary_qr  text;
  v_guest       record;
  v_guest_qr    text;
BEGIN
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = p_rsvp_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- I-1 guard: only ever enqueue for a going+approved RSVP.
  IF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Pepper pre-flight (never RAISE — absent pepper means qr-less recipients are
  -- skipped, re-minted later by the ORCH-1203 backfill).
  BEGIN
    v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);
  EXCEPTION WHEN OTHERS THEN
    v_pepper := NULL;
  END;

  SELECT b.name, b.slug INTO v_brand_name, v_brand_slug
    FROM public.brands b WHERE b.id = v_event.brand_id;
  v_brand_name := COALESCE(v_brand_name, 'Mingla');
  v_deep_link := CASE
    WHEN v_brand_slug IS NOT NULL AND v_event.slug IS NOT NULL
      THEN 'https://host.usemingla.com/e/' || v_brand_slug || '/' || v_event.slug
    ELSE 'https://usemingla.com'
  END;

  -- ---- PRIMARY ----
  v_primary_qr := v_rsvp.qr_code;
  IF v_primary_qr IS NULL AND v_pepper IS NOT NULL THEN
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
      FROM public.biz_rsvp_mint_qr(p_rsvp_id, v_pepper) m;
    UPDATE public.event_rsvps
       SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
     WHERE id = p_rsvp_id;
  END IF;

  IF v_primary_qr IS NOT NULL THEN
    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES (
      v_event.id, p_rsvp_id, NULL, v_rsvp.guest_email, 'pending', 'rsvp_pass',
      jsonb_build_object(
        'template_key',   'rsvp_pass',
        'rsvp_id',        p_rsvp_id,
        'event_id',       v_event.id,
        'recipientEmail', v_rsvp.guest_email,
        'recipientName',  v_rsvp.guest_name,
        'qrCode',         v_primary_qr,
        'matchedUserId',  NULL,
        'primaryUserId',  v_rsvp.user_id,
        'role',           'primary',
        'eventName',      COALESCE(v_event.title, 'your event'),
        'dateLine',       NULL,
        'venueLine',      v_event.location_text,
        'brandName',      v_brand_name,
        'brandId',        v_event.brand_id,
        'deepLink',       v_deep_link
      ),
      'rsvp_pass:' || p_rsvp_id::text || ':primary',
      0
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END IF;

  -- ---- GUESTS ----
  FOR v_guest IN
    SELECT id, name, email, qr_code, matched_user_id
      FROM public.event_rsvp_guests
     WHERE rsvp_id = p_rsvp_id
  LOOP
    v_guest_qr := v_guest.qr_code;
    IF v_guest_qr IS NULL AND v_pepper IS NOT NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_guest_qr
        FROM public.biz_rsvp_mint_qr(v_guest.id, v_pepper) m;
      UPDATE public.event_rsvp_guests
         SET qr_token_hash = v_token_hash, qr_code = v_guest_qr
       WHERE id = v_guest.id;
    END IF;

    IF v_guest_qr IS NOT NULL THEN
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES (
        v_event.id, p_rsvp_id, NULL, v_guest.email, 'pending', 'rsvp_pass',
        jsonb_build_object(
          'template_key',   'rsvp_pass',
          'rsvp_id',        p_rsvp_id,
          'event_id',       v_event.id,
          'recipientEmail', v_guest.email,
          'recipientName',  v_guest.name,
          'qrCode',         v_guest_qr,
          'matchedUserId',  v_guest.matched_user_id,
          'primaryUserId',  NULL,
          'role',           'guest',
          'eventName',      COALESCE(v_event.title, 'your event'),
          'dateLine',       NULL,
          'venueLine',      v_event.location_text,
          'brandName',      v_brand_name,
          'brandId',        v_event.brand_id,
          'deepLink',       v_deep_link
        ),
        'rsvp_pass:' || p_rsvp_id::text || ':' || v_guest.id::text,
        0
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_rsvp_pass(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_rsvp_pass(uuid, text) TO service_role;

COMMIT;
