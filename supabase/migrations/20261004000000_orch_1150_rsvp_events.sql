-- ===========================================================================
-- ORCH-1150 — RSVP Event (Partiful-style ticketless) schema + RPCs + trigger
-- ===========================================================================
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1150_RSVP_EVENT_WIZARD.md (§4.1, §5).
--
-- ORCH-1150: do NOT merge back into the event/ticket path — RSVP has zero
-- tickets + no money gate; notify is TRANSACTIONAL (no marketing-consent).
-- See SPEC §5.
--
-- This migration is monotonic: prefix 20261004000000 is strictly greater than
-- the local head (20261002000000_orch_1142) AND the sibling-worktree ORCH-1148
-- head (20261003000007). Wrapped in BEGIN/COMMIT (matches the discriminator
-- migration). All GRANTs follow the closing $$; ; all RETURNS-TABLE widens are
-- preceded by a DROP. (feedback_edge_deploy_and_migration_apply_hazards)
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Widen the event_type CHECK to admit 'rsvp' (DROP + ADD, never silent).
--     The constraint was created inline at 20260605000000...:33-34 → auto-name
--     events_event_type_check.
-- ---------------------------------------------------------------------------
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('event', 'experience', 'trip', 'rsvp'));

-- ---------------------------------------------------------------------------
-- (b) RSVP host-control columns on public.events (additive; inert for non-rsvp).
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_discoverable     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rsvp_capacity         integer NULL,
  ADD COLUMN IF NOT EXISTS rsvp_allow_plus_ones  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rsvp_plus_ones_max    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rsvp_waitlist_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rsvp_approval_mode    text    NOT NULL DEFAULT 'auto';

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_rsvp_approval_mode_check;
ALTER TABLE public.events ADD CONSTRAINT events_rsvp_approval_mode_check
  CHECK (rsvp_approval_mode IN ('auto', 'manual'));

COMMENT ON COLUMN public.events.rsvp_discoverable IS
  'ORCH-1150 — true => the RSVP row is eligible for the consumer discover deck; '
  'false => invite-link-only (Partiful default). Inert for event_type<>''rsvp''.';

-- ---------------------------------------------------------------------------
-- (c) New per-guest table public.event_rsvps — TWO-DIMENSION status model.
--     rsvp_status   = guest intent (going/not_going/waitlisted)
--     approval_status = host gate (pending/approved/denied)
--     ORCH-1150: see SPEC §4.1c for the canonical precedence rules.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id         uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_name      text NOT NULL,
  guest_email     text NULL,
  guest_phone     text NULL,
  rsvp_status     text NOT NULL DEFAULT 'going'
                    CHECK (rsvp_status IN ('going', 'not_going', 'waitlisted')),
  approval_status text NOT NULL DEFAULT 'approved'
                    CHECK (approval_status IN ('pending', 'approved', 'denied')),
  plus_count      integer NOT NULL DEFAULT 0 CHECK (plus_count >= 0),
  waitlisted_at   timestamptz NULL,
  promoted_at     timestamptz NULL,
  notified_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- ORCH-1150 A4-NEW: link guests MUST be reachable by email AND SMS — do not
  -- relax to email-only or name-only. App-user rows (user_id IS NOT NULL) are
  -- exempt (profile-inherited addresses + push by user_id).
  CONSTRAINT event_rsvps_link_guest_contact_required CHECK (
    user_id IS NOT NULL
    OR (guest_email IS NOT NULL AND length(btrim(guest_email)) > 0
        AND guest_phone IS NOT NULL AND length(btrim(guest_phone)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS event_rsvps_event_id_idx ON public.event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS event_rsvps_waitlist_idx
  ON public.event_rsvps (event_id, waitlisted_at)
  WHERE rsvp_status = 'waitlisted';
CREATE UNIQUE INDEX IF NOT EXISTS event_rsvps_event_user_uniq
  ON public.event_rsvps (event_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_rsvps_event_email_uniq
  ON public.event_rsvps (event_id, lower(guest_email)) WHERE guest_email IS NOT NULL;

COMMENT ON TABLE public.event_rsvps IS
  'ORCH-1150 — per-guest RSVP rows for event_type=rsvp events. Two-dimension '
  'status: rsvp_status (going/not_going/waitlisted) + approval_status '
  '(pending/approved/denied). Confirmed-attending = going AND approved. '
  'approved->denied is the host-REMOVE terminal state (no distinct removed).';

-- updated_at maintenance trigger (reuse the standard set_updated_at if present;
-- else a local one). Defensive: only create if no such helper exists.
CREATE OR REPLACE FUNCTION public.fn_event_rsvps_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_event_rsvps_touch_updated_at ON public.event_rsvps;
CREATE TRIGGER trg_event_rsvps_touch_updated_at
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_event_rsvps_touch_updated_at();

-- ---------------------------------------------------------------------------
-- (d) RLS on public.event_rsvps.
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

-- Host read: all rows for their brand's events (event_manager rank).
DROP POLICY IF EXISTS event_rsvps_host_read ON public.event_rsvps;
CREATE POLICY event_rsvps_host_read ON public.event_rsvps
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Host write (approve/deny/remove / waitlist): same event_manager predicate.
DROP POLICY IF EXISTS event_rsvps_host_write ON public.event_rsvps;
CREATE POLICY event_rsvps_host_write ON public.event_rsvps
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Guest read own.
DROP POLICY IF EXISTS event_rsvps_guest_read_own ON public.event_rsvps;
CREATE POLICY event_rsvps_guest_read_own ON public.event_rsvps
  FOR SELECT
  USING (user_id = auth.uid());

-- Guest insert own (logged-in). Event must be a published RSVP.
DROP POLICY IF EXISTS event_rsvps_guest_insert_own ON public.event_rsvps;
CREATE POLICY event_rsvps_guest_insert_own ON public.event_rsvps
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rsvps.event_id
        AND e.event_type = 'rsvp'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
    )
  );

-- Guest update own (logged-in) — may only set going/not_going for own row.
DROP POLICY IF EXISTS event_rsvps_guest_update_own ON public.event_rsvps;
CREATE POLICY event_rsvps_guest_update_own ON public.event_rsvps
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND rsvp_status IN ('going', 'not_going')
  );

-- Anon link guests get NO direct table policy — they write via the
-- public-submit-rsvp edge fn under service-role (bypasses RLS). This keeps the
-- table closed to arbitrary anon writes.

-- ---------------------------------------------------------------------------
-- (5.6) Notification queue public.rsvp_notifications (clone of the
--       ticket_order_notifications shape). RLS: service-role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rsvp_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rsvp_id             uuid NULL REFERENCES public.event_rsvps(id) ON DELETE SET NULL,
  channel             text NULL CHECK (channel IS NULL OR channel IN ('push', 'sms', 'email')),
  recipient           text NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sending', 'sent',
                                          'failed_retryable', 'failed_terminal', 'skipped')),
  template_key        text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key     text NOT NULL,
  attempt_count       integer NOT NULL DEFAULT 0,
  provider            text NULL,
  provider_message_id text NULL,
  last_error          text NULL,
  sent_at             timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rsvp_notifications_idempotency_uniq
  ON public.rsvp_notifications (idempotency_key);
CREATE INDEX IF NOT EXISTS rsvp_notifications_status_idx
  ON public.rsvp_notifications (status, created_at)
  WHERE status IN ('pending', 'failed_retryable');

COMMENT ON TABLE public.rsvp_notifications IS
  'ORCH-1150 — transactional RSVP notification queue (one row per (guest,trigger)). '
  'The rsvp-notify edge fn fans channels by available contact. NOT marketing.';

ALTER TABLE public.rsvp_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rsvp_notifications_service_only ON public.rsvp_notifications;
CREATE POLICY rsvp_notifications_service_only ON public.rsvp_notifications
  FOR ALL USING (false) WITH CHECK (false);
GRANT ALL ON TABLE public.rsvp_notifications TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.event_rsvps TO service_role;

COMMIT;

-- ===========================================================================
-- RPCs + trigger (separate transaction so a failing function body never
-- partially-rolls the schema; each CREATE OR REPLACE is independent).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (f) Auto-promote trigger fn_rsvp_drain_on_capacity_freed (A3).
--     ORCH-1150: do NOT merge back into the event/ticket path. Clones the
--     proven ticket fn_waitlist_drain_on_capacity_freed (0948...:93-169) but
--     for event_rsvps, in-transaction + deterministic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_rsvp_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_event_id     uuid;
  v_capacity     integer;
  v_approval_mode text;
  v_event_type   text;
  v_confirmed    integer;
  v_free         integer;
  v_entry        record;
  v_has_queue    boolean;
BEGIN
  -- Resolve the event_id depending on which table fired the trigger.
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := NEW.id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  SELECT e.event_type, e.rsvp_capacity, e.rsvp_approval_mode
    INTO v_event_type, v_capacity, v_approval_mode
    FROM public.events e
   WHERE e.id = v_event_id;

  -- Only RSVP events with a finite cap can have a waitlist to drain.
  IF v_event_type IS DISTINCT FROM 'rsvp' THEN RETURN NEW; END IF;
  IF v_capacity IS NULL THEN RETURN NEW; END IF;

  -- Confirmed-attending headcount (the +1s count). §4.1c capacity formula.
  SELECT COALESCE(SUM(1 + r.plus_count), 0)
    INTO v_confirmed
    FROM public.event_rsvps r
   WHERE r.event_id = v_event_id
     AND r.rsvp_status = 'going'
     AND r.approval_status = 'approved';

  v_free := v_capacity - v_confirmed;
  IF v_free <= 0 THEN RETURN NEW; END IF;

  -- Queue-table existence guard so the trigger never breaks the parent UPDATE.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rsvp_notifications'
  ) INTO v_has_queue;

  -- Promote the OLDEST waitlisted rows while free capacity remains.
  FOR v_entry IN
    SELECT r.id, r.plus_count, r.user_id
      FROM public.event_rsvps r
     WHERE r.event_id = v_event_id
       AND r.rsvp_status = 'waitlisted'
     ORDER BY r.waitlisted_at ASC NULLS FIRST, r.created_at ASC
  LOOP
    EXIT WHEN v_free <= 0;

    IF v_approval_mode = 'manual' THEN
      -- manual: waitlist -> going + pending (host still approves; doesn't
      -- occupy the cap, so do NOT decrement v_free).
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'pending',
             promoted_at = now()
       WHERE id = v_entry.id;
    ELSE
      -- auto: waitlist -> going (confirmed). Consume the cap.
      IF (1 + v_entry.plus_count) > v_free THEN
        -- This guest's party doesn't fit the remaining free seats; stop.
        EXIT;
      END IF;
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'approved',
             promoted_at = now()
       WHERE id = v_entry.id;
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;

    IF v_has_queue THEN
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
$fn$;

-- Trigger arm 1: attendance/approval flips on event_rsvps (the spot-freeing
-- conditions — going->not_going, *->denied incl. the A2-NEW approved->denied
-- host-remove). Guarded WHEN so it only fires on a relevant change.
DROP TRIGGER IF EXISTS trg_rsvp_drain_on_status ON public.event_rsvps;
CREATE TRIGGER trg_rsvp_drain_on_status
  AFTER UPDATE OF rsvp_status, approval_status ON public.event_rsvps
  FOR EACH ROW
  WHEN (
    (OLD.rsvp_status IS DISTINCT FROM NEW.rsvp_status
      OR OLD.approval_status IS DISTINCT FROM NEW.approval_status)
    AND (NEW.rsvp_status <> 'going' OR NEW.approval_status <> 'approved')
  )
  EXECUTE FUNCTION public.fn_rsvp_drain_on_capacity_freed();

-- Trigger arm 2: cap-raise on events.
DROP TRIGGER IF EXISTS trg_rsvp_drain_on_cap_raise ON public.events;
CREATE TRIGGER trg_rsvp_drain_on_cap_raise
  AFTER UPDATE OF rsvp_capacity ON public.events
  FOR EACH ROW
  WHEN (NEW.rsvp_capacity IS DISTINCT FROM OLD.rsvp_capacity AND NEW.event_type = 'rsvp')
  EXECUTE FUNCTION public.fn_rsvp_drain_on_capacity_freed();

-- ---------------------------------------------------------------------------
-- (5.1) business_publish_rsvp_draft — forked from business_publish_event_draft.
--       ORCH-1150: do NOT merge back into the event/ticket path — RSVP has
--       zero tickets + no money gate. Removes ticket / city / stripe gates,
--       keeps the party-type gate (steering #2), creates ZERO ticket_types.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_publish_rsvp_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_timezone text;
  v_visibility text;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_event_dates_rows jsonb;
  v_when jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- RSVP host-control locals.
  v_rsvp_capacity integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;
  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency INTO v_brand
    FROM public.brands WHERE id = v_event.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- Taxonomy (party-type gate KEPT — steering #2). City NOT required (freeform).
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]);

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;
  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;
  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;
  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','hiphop-rap','pop','rock','latin','afrobeats','rnb-soul',
    'disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  -- RSVP host-control reads.
  v_rsvp_capacity := NULLIF(v_business_draft->>'rsvpCapacity', '')::integer;
  v_rsvp_allow_plus_ones := COALESCE((v_business_draft->>'rsvpAllowPlusOnes')::boolean, false);
  v_rsvp_plus_ones_max := COALESCE((v_business_draft->>'rsvpPlusOnesMax')::integer, 0);
  v_rsvp_waitlist_enabled := COALESCE((v_business_draft->>'rsvpWaitlistEnabled')::boolean, false);
  v_rsvp_approval_mode := COALESCE(NULLIF(v_business_draft->>'rsvpApprovalMode', ''), 'auto');
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((v_business_draft->>'rsvpDiscoverable')::boolean, false);

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;
  -- A private RSVP can never be on a public discovery feed.
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- Slug.
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'rsvp';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = v_event.brand_id AND e.deleted_at IS NULL
      AND e.id <> p_event_id AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL; v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL; v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL; v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  -- Single-date only (steering #4).
  v_when := v_business_draft->'when';
  v_date_iso := NULLIF(v_when->>'date', '');
  IF v_date_iso IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
  v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
  v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
  v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
  IF v_end <= v_start THEN
    v_end := v_end + INTERVAL '1 day';
  END IF;

  -- Discoverable RSVPs must be future-dated (no dead deck card). Link-only is
  -- allowed same-day. NO stripe gate (moneyless).
  IF v_rsvp_discoverable AND v_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- Permit the draft->scheduled slug finalization (ORCH-0763 trigger).
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);

  UPDATE public.events
  SET
    event_type = 'rsvp',
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets' - 'category' - 'partyTypes' - 'vibeTags' - 'musicGenres'
        - 'city' - 'locationGeo'),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    updated_at = v_now
  WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- An RSVP creates ZERO ticket_types (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).
  -- Defensive: soft-delete any stray ticket rows from a mis-routed draft.
  UPDATE public.ticket_types
     SET deleted_at = v_now, updated_at = v_now
   WHERE event_id = p_event_id AND deleted_at IS NULL;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_event_dates_rows
    FROM public.event_dates ed WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'tickets', '[]'::jsonb,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) IS
  'ORCH-1150 — RSVP publish RPC (forked from business_publish_event_draft). '
  'Zero tickets, no money gate, no city gate; keeps party-type gate. '
  'do NOT merge back into the event/ticket path. See SPEC §5.1.';

COMMIT;

-- ===========================================================================
-- Edit-published + guest-submit + host-approve RPCs (separate txn).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (5.2) biz_update_live_rsvp — edit a published RSVP. No refund gate, no
--       ticket diff. Enqueues rsvp_event_updated on material change (A4).
--       ORCH-1150: do NOT merge back into the event/ticket path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(
  p_event_id uuid,
  p_payload jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid;
  v_existing       public.events%ROWTYPE;
  v_brand          record;
  v_now            timestamptz := now();
  v_trimmed_reason text;
  v_title          text;
  v_description    text;
  v_location_text  text;
  v_online_url     text;
  v_timezone       text;
  v_visibility     text;
  v_when           jsonb;
  v_date_iso       text;
  v_doors          text;
  v_ends           text;
  v_new_start      timestamptz;
  v_new_end        timestamptz;
  v_old_start      timestamptz;
  v_rsvp_capacity  integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  v_material_change boolean := false;
  v_going_count    integer;
  v_notified_count integer := 0;
  v_event          public.events%ROWTYPE;
  v_guest          record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  SELECT * INTO v_existing FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  IF v_existing.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp'
      USING HINT = 'biz_update_live_rsvp only handles event_type=rsvp rows.';
  END IF;
  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rsvp_not_editable_status');
  END IF;
  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name INTO v_brand FROM public.brands
   WHERE id = v_existing.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'rsvp_title_required';
  END IF;
  v_description := NULLIF(p_payload->>'description', '');
  v_location_text := NULLIF(p_payload->>'location_text', '');
  v_online_url := NULLIF(p_payload->>'online_url', '');
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), v_existing.timezone, 'UTC');

  v_visibility := CASE COALESCE(p_payload->>'requestedVisibility', NULL)
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    WHEN 'public' THEN 'public'
    ELSE v_existing.visibility
  END;

  -- RSVP host-control (default to existing when key absent).
  v_rsvp_capacity := CASE WHEN p_payload ? 'rsvpCapacity'
    THEN NULLIF(p_payload->>'rsvpCapacity', '')::integer ELSE v_existing.rsvp_capacity END;
  v_rsvp_allow_plus_ones := COALESCE((p_payload->>'rsvpAllowPlusOnes')::boolean, v_existing.rsvp_allow_plus_ones);
  v_rsvp_plus_ones_max := COALESCE(NULLIF(p_payload->>'rsvpPlusOnesMax', '')::integer, v_existing.rsvp_plus_ones_max);
  v_rsvp_waitlist_enabled := COALESCE((p_payload->>'rsvpWaitlistEnabled')::boolean, v_existing.rsvp_waitlist_enabled);
  v_rsvp_approval_mode := COALESCE(NULLIF(p_payload->>'rsvpApprovalMode', ''), v_existing.rsvp_approval_mode);
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((p_payload->>'rsvpDiscoverable')::boolean, v_existing.rsvp_discoverable);
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- Single-date when (optional in payload; default to existing master).
  SELECT start_at INTO v_old_start FROM public.event_dates
   WHERE event_id = p_event_id AND is_master = true LIMIT 1;

  v_when := p_payload->'when';
  IF v_when IS NOT NULL AND NULLIF(v_when->>'date', '') IS NOT NULL THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_new_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_new_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_new_end <= v_new_start THEN
      v_new_end := v_new_end + INTERVAL '1 day';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);
    IF v_old_start IS DISTINCT FROM v_new_start THEN
      v_material_change := true;
    END IF;
  END IF;

  -- Material change = date/time OR venue/location text changed.
  IF v_location_text IS DISTINCT FROM v_existing.location_text THEN
    v_material_change := true;
  END IF;

  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = NULLIF(p_payload->>'cover_media_url', ''),
    cover_media_type = NULLIF(p_payload->>'cover_media_type', ''),
    visibility = v_visibility,
    timezone = v_timezone,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    updated_at = v_now
  WHERE id = p_event_id;

  -- Enqueue rsvp_event_updated for every going+approved guest on material change.
  IF v_material_change THEN
    FOR v_guest IN
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
    LOOP
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (p_event_id, v_guest.id, NULL, NULL, 'pending', 'rsvp_event_updated',
         jsonb_build_object('template_key', 'rsvp_event_updated',
                            'rsvp_id', v_guest.id, 'event_id', p_event_id),
         'rsvp_update:' || p_event_id::text || ':' || extract(epoch FROM v_now)::bigint::text
           || ':' || v_guest.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_notified_count := v_notified_count + 1;
    END LOOP;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_going_count
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';

  RETURN jsonb_build_object(
    'ok', true,
    'event', to_jsonb(v_event),
    'going_count', v_going_count,
    'notified_count', v_notified_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_update_live_rsvp(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- (5.3) submit_event_rsvp — guest write (called by public-submit-rsvp edge fn
--       under service-role, OR directly by a logged-in app user via RLS).
--       Returns the resolved status. ORCH-1150: do NOT merge back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_event_rsvp(
  p_event_id   uuid,
  p_user_id    uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_rsvp_status text,
  p_plus_count  integer DEFAULT 0
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
BEGIN
  -- 1. Load + gate the event (FOR UPDATE serializes concurrent submits).
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR v_event.event_type <> 'rsvp'
     OR v_event.status NOT IN ('scheduled', 'live')
     OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rsvp_not_open';
  END IF;

  IF p_rsvp_status NOT IN ('going', 'not_going') THEN
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

  -- 4. Resolve approval + attendance.
  v_approval := CASE WHEN v_event.rsvp_approval_mode = 'manual' THEN 'pending' ELSE 'approved' END;

  IF p_rsvp_status = 'not_going' THEN
    v_status := 'not_going';
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
        -- pending doesn't occupy the cap; host's approve is capacity-gated.
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

  -- 5. UPSERT the row.
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

  RETURN jsonb_build_object(
    'rsvpId', v_existing_id,
    'status', v_status,
    'approvalStatus', v_approval,
    'capacityFull', (v_status = 'waitlisted')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_event_rsvp(uuid, uuid, text, text, text, text, integer) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- (5.4) host_set_rsvp_status — approve/deny/remove. ORCH-1150: do NOT merge back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_set_rsvp_status(
  p_rsvp_id uuid,
  p_status  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id    uuid;
  v_rsvp       public.event_rsvps%ROWTYPE;
  v_event      public.events%ROWTYPE;
  v_source     text;
  v_confirmed  integer;
  v_was_removed boolean := false;
  v_template   text;
  v_pending    integer;
  v_going      integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_status NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id FOR UPDATE;
  IF NOT FOUND OR v_event.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  v_source := v_rsvp.approval_status;

  -- Idempotent: re-applying current status is a no-op.
  IF v_source = p_status THEN
    SELECT count(*) FILTER (WHERE approval_status = 'pending') ,
           COALESCE(SUM(1 + plus_count) FILTER (WHERE rsvp_status = 'going' AND approval_status = 'approved'), 0)
      INTO v_pending, v_going
      FROM public.event_rsvps WHERE event_id = v_event.id;
    RETURN jsonb_build_object('ok', true, 'rsvpId', p_rsvp_id, 'approvalStatus', p_status,
      'wasRemoved', false, 'pendingCountRemaining', v_pending, 'goingCountRemaining', v_going);
  END IF;

  -- denied is terminal for a remove; a denied->approved re-admit is allowed
  -- (re-approve), but denied->denied handled above; otherwise valid transitions:
  -- pending->approved, pending->denied, approved->denied (remove), denied->approved.
  IF p_status = 'approved' THEN
    -- Capacity gate on approve.
    IF v_event.rsvp_capacity IS NOT NULL THEN
      SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
        FROM public.event_rsvps r
       WHERE r.event_id = v_event.id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         AND r.id <> p_rsvp_id;
      IF (v_confirmed + 1 + v_rsvp.plus_count) > v_event.rsvp_capacity THEN
        RAISE EXCEPTION 'rsvp_capacity_full';
      END IF;
    END IF;
    UPDATE public.event_rsvps
       SET approval_status = 'approved',
           rsvp_status = CASE WHEN rsvp_status = 'waitlisted' THEN 'going' ELSE rsvp_status END
     WHERE id = p_rsvp_id;
    v_template := 'rsvp_approved';
  ELSE
    -- denied. approved->denied = host remove.
    v_was_removed := (v_source = 'approved');
    UPDATE public.event_rsvps
       SET approval_status = 'denied'
     WHERE id = p_rsvp_id;
    v_template := CASE WHEN v_was_removed THEN 'rsvp_removed' ELSE 'rsvp_denied' END;
  END IF;

  INSERT INTO public.rsvp_notifications
    (event_id, rsvp_id, channel, recipient, status, template_key, payload,
     idempotency_key, attempt_count)
  VALUES
    (v_event.id, p_rsvp_id, NULL, NULL, 'pending', v_template,
     jsonb_build_object('template_key', v_template, 'rsvp_id', p_rsvp_id, 'event_id', v_event.id),
     'rsvp_approval:' || p_rsvp_id::text || ':' || v_source || ':' || p_status,
     0)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT count(*) FILTER (WHERE approval_status = 'pending'),
         COALESCE(SUM(1 + plus_count) FILTER (WHERE rsvp_status = 'going' AND approval_status = 'approved'), 0)
    INTO v_pending, v_going
    FROM public.event_rsvps WHERE event_id = v_event.id;

  RETURN jsonb_build_object(
    'ok', true, 'rsvpId', p_rsvp_id, 'approvalStatus', p_status,
    'wasRemoved', v_was_removed,
    'pendingCountRemaining', v_pending, 'goingCountRemaining', v_going
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_set_rsvp_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- host_bulk_approve_rsvps — approve all pending up to remaining capacity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_bulk_approve_rsvps(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id     uuid;
  v_event       public.events%ROWTYPE;
  v_confirmed   integer;
  v_free        integer;
  v_entry       record;
  v_approved    integer := 0;
  v_skipped     integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_confirmed
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';
  v_free := CASE WHEN v_event.rsvp_capacity IS NULL THEN NULL ELSE v_event.rsvp_capacity - v_confirmed END;

  FOR v_entry IN
    SELECT id, plus_count FROM public.event_rsvps
     WHERE event_id = p_event_id AND approval_status = 'pending'
     ORDER BY created_at ASC
  LOOP
    IF v_free IS NOT NULL AND (1 + v_entry.plus_count) > v_free THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    UPDATE public.event_rsvps
       SET approval_status = 'approved',
           rsvp_status = CASE WHEN rsvp_status = 'waitlisted' THEN 'going' ELSE rsvp_status END
     WHERE id = v_entry.id;
    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES
      (p_event_id, v_entry.id, NULL, NULL, 'pending', 'rsvp_approved',
       jsonb_build_object('template_key', 'rsvp_approved', 'rsvp_id', v_entry.id, 'event_id', p_event_id),
       'rsvp_approval:' || v_entry.id::text || ':pending:approved', 0)
    ON CONFLICT (idempotency_key) DO NOTHING;
    v_approved := v_approved + 1;
    IF v_free IS NOT NULL THEN
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('approvedCount', v_approved, 'skippedForCapacity', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_bulk_approve_rsvps(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- listRsvpGuests support — host-scoped read RPC (pending first then going then
-- waitlisted). SECURITY INVOKER so RLS host-read applies.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.host_list_rsvp_guests(uuid);
CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)
RETURNS TABLE (
  id uuid, event_id uuid, user_id uuid, guest_name text, guest_email text,
  guest_phone text, rsvp_status text, approval_status text, plus_count integer,
  waitlisted_at timestamptz, promoted_at timestamptz, created_at timestamptz
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT r.id, r.event_id, r.user_id, r.guest_name, r.guest_email, r.guest_phone,
         r.rsvp_status, r.approval_status, r.plus_count,
         r.waitlisted_at, r.promoted_at, r.created_at
    FROM public.event_rsvps r
   WHERE r.event_id = p_event_id
   ORDER BY
     CASE WHEN r.approval_status = 'pending' THEN 0
          WHEN r.rsvp_status = 'going' AND r.approval_status = 'approved' THEN 1
          WHEN r.rsvp_status = 'waitlisted' THEN 2
          ELSE 3 END,
     r.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.host_list_rsvp_guests(uuid) TO authenticated;

COMMIT;

-- ===========================================================================
-- (4.1e) Discover-RPC widen — admit opted-in RSVP rows onto the consumer deck.
--        Full CREATE OR REPLACE so the latest definition wins (migration-chain).
--        RSVP rows have no paid-ticket concept → display_price_cents resolves
--        NULL; the gated CTE leaves them untouched (has_paid_online = false).
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_discover_business_events(
  p_cities text[],
  p_lower_bound timestamptz,
  p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL,
  p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH base AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug,
      e.location_text,
      e.location_geo,
      e.online_url,
      e.is_online,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      e.timezone,
      e.currency,
      e.city,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.event_type,
      b.slug AS brand_slug,
      b.name AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      ed.start_at AS master_start_at,
      ed.end_at AS master_end_at,
      ed.timezone AS master_timezone,
      (
        SELECT MIN(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_min_cents,
      (
        SELECT MAX(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_max_cents,
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents > 0
      ) AS has_paid_online,
      (
        SELECT public.compute_all_in_cents(
          MIN(tt.price_cents),
          COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
          COALESCE(e.pass_service_fee, b.default_pass_service_fee),
          (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
        )
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.price_cents > 0
          AND tt.deleted_at IS NULL
      ) AS display_price_cents,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    INNER JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    INNER JOIN public.event_dates ed
      ON ed.event_id = e.id
     AND ed.is_master IS TRUE
     AND ed.end_at >= p_lower_bound
    WHERE e.deleted_at IS NULL
      AND e.visibility = 'public'
      -- ORCH-1150: admit opted-in RSVP rows alongside ticketed events.
      AND ( e.event_type = 'event'
         OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND e.city = ANY (p_cities)
      AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)
      AND (p_party_types IS NULL OR cardinality(p_party_types) = 0 OR e.party_types && p_party_types)
      AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags) = 0 OR e.vibe_tags && p_vibe_tags)
      AND (p_music_genres IS NULL OR cardinality(p_music_genres) = 0 OR e.music_genres && p_music_genres)
  ),
  gated AS (
    SELECT *
    FROM base
    WHERE NOT (has_paid_online AND NOT public.pg_brand_can_charge(brand_id))
  ),
  ranked AS (
    SELECT
      g.*,
      COUNT(*) OVER () AS total_count
    FROM gated g
    ORDER BY master_start_at ASC NULLS LAST
    OFFSET GREATEST(p_offset, 0)
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT total_count FROM ranked LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'brand_id', r.brand_id,
            'title', r.title,
            'description', r.description,
            'slug', r.slug,
            'location_text', r.location_text,
            'location_geo', r.location_geo,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', r.theme,
            'timezone', r.timezone,
            'currency', r.currency,
            'city', r.city,
            'party_types', r.party_types,
            'vibe_tags', r.vibe_tags,
            'music_genres', r.music_genres,
            'event_type', r.event_type,
            'brand_slug', r.brand_slug,
            'brand_name', r.brand_name,
            'brand_profile_photo_url', r.brand_profile_photo_url,
            'master_start_at', r.master_start_at,
            'master_end_at', r.master_end_at,
            'master_timezone', r.master_timezone,
            'price_min_cents', r.price_min_cents,
            'price_max_cents', r.price_max_cents,
            'display_price_cents', r.display_price_cents,
            'pricing_currency', r.pricing_currency
          )
          ORDER BY r.master_start_at ASC NULLS LAST
        )
        FROM ranked r
      ),
      '[]'::jsonb
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.pg_discover_business_events(
  text[], timestamptz, timestamptz, text[], text[], text[], integer, integer
) TO service_role;

-- Widen the consumer discover-feed partial index to also cover RSVP rows.
DROP INDEX IF EXISTS public.idx_events_discover_feed;
CREATE INDEX idx_events_discover_feed
  ON public.events (city)
  WHERE deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled', 'live')
    AND event_type IN ('event', 'rsvp');

COMMIT;

-- ===========================================================================
-- ORCH-1150 — expose the RSVP host-control columns + a live confirmed-attending
-- count on business_public_events_view so the public /e/ page + the Hub
-- list-card can render Going/Not-going + "N going" without a second query.
-- do NOT merge back into the ticket/checkout path — these columns are inert for
-- non-RSVP rows. Mirrors the ORCH-1006 view column list verbatim, appending only
-- the e.rsvp_* columns + the rsvp_going_count subselect. See SPEC §6 / §8 step 11.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE VIEW public.business_public_events_view AS
  SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
    e.location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    (e.theme - 'business_draft'::text) AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    e.location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    -- ORCH-1150 confirmed-attending headcount (counts each guest + plus_count),
    -- per the §4.1c capacity formula: rsvp_status='going' AND approval_status='approved'.
    -- 0 for non-RSVP rows (no event_rsvps rows exist for them).
    (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) AS rsvp_going_count
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));

ALTER VIEW public.business_public_events_view SET (security_invoker = false);

COMMIT;

NOTIFY pgrst, 'reload schema';
