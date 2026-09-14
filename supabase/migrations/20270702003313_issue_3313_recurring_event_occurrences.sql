-- ---------------------------------------------------------------------------
-- issue #3313 — publishing a recurring event only created its first date, so
-- guests could only ever buy that one night.
--
-- ── THE DEFECT (proved against production, 2026-09-14) ───────────────────
-- business_publish_event_draft treated ('single','recurring') identically and
-- inserted ONE master event_dates row; the rule was only copied onto the event.
-- The organiser's own screens expanded the rule on the phone, so they showed
-- all eight Tuesdays while the database held one. Downstream: the public page
-- read "Recurring (incomplete)" with no night to pick, a guest's order carried
-- no night (orders.event_date_id NULL, no ticket_event_dates — an any-night
-- pass), payouts anchored to the one date, and after that first night checkout
-- refused every buyer with event_no_active_dates. Exactly one recurring event
-- has ever been published (zero orders). THIS MIGRATION DOES NOT REPAIR IT.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   §1 issue_3313_recurrence_occurrences — a pure, read-only expansion of a
--      rule (the #1138 expander's walk, verbatim), used by §2 and §6.
--   §2 issue_3313_topup_recurring_events + its daily cron — never-ending and
--      until-dated recurring EVENTS keep 52 upcoming dates. Experiences keep
--      their own #1153 job, untouched.
--   §3 issue_3313_event_day_choice — the ONE predicate for "must the guest pick
--      a day", read by checkout (§7), the public reader (§8) and the tier
--      editor (§9).
--   §4 issue_3313_ticket_type_occurrence_sold / _taken — per-night counting
--      (Seth, 2026-09-14: capacity is PER NIGHT on a recurring event).
--   §5 business_publish_event_draft — recurring publish expands the rule.
--   §6 business_patch_event_when — a recurring edit targets every rule date,
--      keeps #3285's held-date rules, and stores the When shape it saved.
--   §7 issue_1930_ticket_checkout_create_session_base — no order without a
--      night; capacity per night on recurring events.
--   §8 pg_direct_event_checkout_bundle — isMultiDate = "must pick a day";
--      upcoming nights only for recurring; per-night remaining; the rule.
--   §9 business_patch_event_ticket_tiers — the capacity floor on a recurring
--      event is the busiest night.
--   §10 self-verify probe.
--
-- Every re-emitted function is a full CREATE OR REPLACE copied from its LATEST
-- definition and changed only in the hunks marked "issue #3313":
--   business_publish_event_draft                    20270701003288
--   business_patch_event_when                       20270628003285
--   issue_1930_ticket_checkout_create_session_base  20270609002879
--   pg_direct_event_checkout_bundle                 20270609002879
--   business_patch_event_ticket_tiers               20270526002590
-- BEFORE APPLYING: compare each against production's pg_get_functiondef. If
-- any has drifted, stop and reconcile. Same-signature CREATE OR REPLACE keeps
-- every existing grant. New functions are service_role-only.
--
-- NOT APPLIED TO PRODUCTION BY THE PR THAT ADDS IT. Apply order after merge:
-- this migration, then ticket-checkout-create, then the web deploy.
--
-- ROLLBACK: re-apply the five source definitions above and unschedule
-- issue-3313-topup-recurring-events. Dates already materialised stay (they are
-- real occurrences a guest may hold).
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- §1 — The dates a rule describes, without writing any.
-- ===========================================================================
-- Index 1 is the anchor itself. Later dates walk the anchor's LOCAL calendar
-- in p_timezone with the #1138 expander's preset match, termination and
-- five-year safety bound, byte for byte, and keep the anchor's local start time
-- and length.
--
-- Window:
--   * a date starting at or before p_forward_after is always included (it has
--     already started; used by the live edit so past nights still match);
--   * otherwise up to p_max_forward upcoming dates (the anchor counts when it is
--     upcoming);
--   * plus any date starting at or before p_cover_through (dates a top-up has
--     already added).
-- With the defaults it returns EXACTLY the anchor plus what
-- pg_expand_experience_recurrence inserts — pinned by the #3313 parity test.
CREATE OR REPLACE FUNCTION public.issue_3313_recurrence_occurrences(
  p_anchor_start  timestamptz,
  p_anchor_end    timestamptz,
  p_rule          jsonb,
  p_timezone      text,
  p_forward_after timestamptz DEFAULT '-infinity'::timestamptz,
  p_max_forward   integer DEFAULT 52,
  p_cover_through timestamptz DEFAULT NULL
) RETURNS TABLE (occurrence_index integer, start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c_safety     constant integer := 365 * 5; -- mirror the #1138 runaway-loop guard
  v_preset     text;
  v_byday      text;
  v_bymonthday integer;
  v_bysetpos   integer;
  v_term_kind  text;
  v_term_count integer;
  v_until      date;
  v_duration   interval;
  v_tz         text := COALESCE(NULLIF(p_timezone, ''), 'UTC');
  v_master_local date;
  v_cursor       date;
  v_local_time   time;
  v_next_start   timestamptz;
  v_safety       integer := c_safety;
  v_index        integer := 1;
  v_forward      integer := 0;
BEGIN
  IF p_anchor_start IS NULL OR p_anchor_end IS NULL THEN
    RETURN;
  END IF;

  occurrence_index := 1;
  start_at := p_anchor_start;
  end_at := p_anchor_end;
  RETURN NEXT;
  IF p_anchor_start > p_forward_after THEN
    v_forward := 1;
  END IF;

  IF p_rule IS NULL THEN
    RETURN;
  END IF;

  v_preset     := NULLIF(p_rule->>'preset', '');
  v_byday      := NULLIF(p_rule->>'byDay', '');
  v_bymonthday := NULLIF(p_rule->>'byMonthDay', '')::integer;
  v_bysetpos   := NULLIF(p_rule->>'bySetPos', '')::integer;
  v_term_kind  := NULLIF(p_rule->'termination'->>'kind', '');
  v_term_count := NULLIF(p_rule->'termination'->>'count', '')::integer;
  v_until      := NULLIF(p_rule->'termination'->>'until', '')::date;

  IF v_preset IS NULL THEN
    RETURN;
  END IF;

  v_duration     := p_anchor_end - p_anchor_start;
  v_master_local := (p_anchor_start AT TIME ZONE v_tz)::date;
  v_local_time   := (p_anchor_start AT TIME ZONE v_tz)::time;
  v_cursor       := v_master_local;

  WHILE v_safety > 0 LOOP
    -- count termination: the anchor is occurrence #1.
    IF v_term_kind = 'count' AND v_term_count IS NOT NULL AND v_index >= v_term_count THEN
      EXIT;
    END IF;
    v_safety := v_safety - 1;
    v_cursor := v_cursor + 1;

    IF v_until IS NOT NULL AND v_cursor > v_until THEN
      EXIT;
    END IF;

    IF (
      CASE v_preset
        WHEN 'daily' THEN true
        WHEN 'weekly' THEN
          v_byday IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
        WHEN 'biweekly' THEN
          v_byday IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
          AND (ROUND((v_cursor - v_master_local) / 7.0)::int % 2) = 0
        WHEN 'monthly_dom' THEN
          v_bymonthday IS NOT NULL
          AND EXTRACT(day FROM v_cursor)::int = v_bymonthday
        WHEN 'monthly_dow' THEN
          v_byday IS NOT NULL AND v_bysetpos IS NOT NULL
          AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
          AND (
            CASE
              WHEN v_bysetpos = -1 THEN
                EXTRACT(month FROM (v_cursor + 7))::int <> EXTRACT(month FROM v_cursor)::int
              ELSE
                CEIL(EXTRACT(day FROM v_cursor)::numeric / 7.0)::int = v_bysetpos
            END
          )
        ELSE false
      END
    ) THEN
      v_next_start := (v_cursor + v_local_time) AT TIME ZONE v_tz;
      IF v_next_start <= p_forward_after THEN
        NULL; -- already started: always part of the series
      ELSIF v_forward < p_max_forward
            OR (p_cover_through IS NOT NULL AND v_next_start <= p_cover_through) THEN
        v_forward := v_forward + 1;
      ELSE
        EXIT; -- starts only grow, so nothing later can qualify
      END IF;
      v_index := v_index + 1;
      occurrence_index := v_index;
      start_at := v_next_start;
      end_at := v_next_start + v_duration;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3313_recurrence_occurrences(timestamptz, timestamptz, jsonb, text, timestamptz, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_recurrence_occurrences(timestamptz, timestamptz, jsonb, text, timestamptz, integer, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.issue_3313_recurrence_occurrences(timestamptz, timestamptz, jsonb, text, timestamptz, integer, timestamptz) IS
  'issue #3313 — the dates a recurrence rule describes, read-only. Index 1 is the '
  'anchor. Same walk as pg_expand_experience_recurrence (parity-tested). '
  'Window: every date already started by p_forward_after, up to p_max_forward '
  'upcoming dates, plus any date starting by p_cover_through.';

-- ===========================================================================
-- §2 — Recurring EVENTS keep 52 upcoming dates.
-- ===========================================================================
-- Scope: events (not experiences: #1153 owns those), recurring, not multi-date,
-- scheduled/live, with a rule that has no fixed count ('never' or 'until') and
-- has not terminated. Count rules are materialised in full at publish (up to
-- 52) and are deliberately left alone — including the one live recurring
-- event, whose repair is a separate, approved step.
-- Forward-only and idempotent: anchors on the latest existing date, inserts
-- only dates that start in the future and do not already exist, never deletes.
CREATE OR REPLACE FUNCTION public.issue_3313_topup_recurring_events(
  p_floor integer DEFAULT 14
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_now        timestamptz := now();
  v_e          record;
  v_future     integer;
  v_last_start timestamptz;
  v_last_end   timestamptz;
  v_tz         text;
  v_room       integer;
  v_added      integer;
  v_topped     integer := 0;
BEGIN
  FOR v_e IN
    SELECT e.id, e.recurrence_rules, e.timezone
      FROM public.events e
     WHERE e.event_type = 'event'
       AND e.is_recurring = true
       AND COALESCE(e.is_multi_date, false) = false
       AND e.status IN ('scheduled', 'live')
       AND e.deleted_at IS NULL
       AND jsonb_typeof(e.recurrence_rules) = 'object'
       AND (e.recurrence_rules->'termination'->>'kind') IN ('never', 'until')
     ORDER BY e.id
  LOOP
    IF public.pg_recurrence_is_terminated(v_e.recurrence_rules, v_e.id, v_now) THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer INTO v_future
      FROM public.event_dates ed
     WHERE ed.event_id = v_e.id AND ed.start_at > v_now;
    IF v_future >= p_floor THEN
      CONTINUE;
    END IF;

    SELECT ed.start_at, ed.end_at INTO v_last_start, v_last_end
      FROM public.event_dates ed
     WHERE ed.event_id = v_e.id
     ORDER BY ed.start_at DESC, ed.id DESC
     LIMIT 1;
    IF v_last_start IS NULL THEN
      CONTINUE; -- never fabricate a first date
    END IF;

    SELECT ed.timezone INTO v_tz
      FROM public.event_dates ed
     WHERE ed.event_id = v_e.id AND ed.is_master = true
     LIMIT 1;
    v_tz := COALESCE(NULLIF(v_tz, ''), NULLIF(v_e.timezone, ''), 'UTC');

    -- Room under 52 upcoming dates. The anchor counts toward the window when it
    -- is itself upcoming (it is already one of v_future).
    v_room := 52 - v_future + CASE WHEN v_last_start > v_now THEN 1 ELSE 0 END;

    WITH ins AS (
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      SELECT v_e.id, o.start_at, o.end_at, v_tz, false
        FROM public.issue_3313_recurrence_occurrences(
               v_last_start, v_last_end, v_e.recurrence_rules, v_tz, v_now, v_room, NULL
             ) o
       WHERE o.occurrence_index > 1
         AND o.start_at > v_now
         AND NOT EXISTS (
           SELECT 1 FROM public.event_dates x
            WHERE x.event_id = v_e.id AND x.start_at = o.start_at
         )
       ORDER BY o.occurrence_index
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_added FROM ins;

    IF v_added > 0 THEN
      v_topped := v_topped + 1;
    END IF;
  END LOOP;

  RETURN v_topped;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3313_topup_recurring_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_topup_recurring_events(integer) TO service_role;

COMMENT ON FUNCTION public.issue_3313_topup_recurring_events(integer) IS
  'issue #3313 — keeps never-ending / until-dated recurring EVENTS stocked with '
  '52 upcoming event_dates. Forward-only, idempotent, never deletes. Count rules '
  'and experiences are out of scope (publish / #1153 own them).';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'issue #3313: pg_cron not installed here; top-up job not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue-3313-topup-recurring-events') THEN
    PERFORM cron.unschedule('issue-3313-topup-recurring-events');
  END IF;
  PERFORM cron.schedule(
    'issue-3313-topup-recurring-events',
    '15 9 * * *',
    $$ SELECT public.issue_3313_topup_recurring_events(14); $$
  );
END;
$cron$;

-- ===========================================================================
-- §3 — Must the guest pick a day? ONE predicate.
-- ===========================================================================
--   requiresChoice        event AND (multi-date OR recurring with > 1 upcoming date)
--   soleOccurrenceId      recurring (not multi-date) event with exactly 1 upcoming date
--   perOccurrenceCapacity recurring (not multi-date) event: capacity is per night
--   upcomingCount         dates whose end_at is still ahead
-- The public reader's `isMultiDate` IS requiresChoice, so the chooser a guest
-- sees and the checkout refusal cannot disagree.
CREATE OR REPLACE FUNCTION public.issue_3313_event_day_choice(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_type      text;
  v_multi     boolean;
  v_recurring boolean;
  v_upcoming  integer;
  v_sole      uuid;
BEGIN
  SELECT e.event_type, COALESCE(e.is_multi_date, false), COALESCE(e.is_recurring, false)
    INTO v_type, v_multi, v_recurring
    FROM public.events e
   WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'requiresChoice', false, 'soleOccurrenceId', NULL,
      'perOccurrenceCapacity', false, 'upcomingCount', 0);
  END IF;

  SELECT count(*)::integer, (array_agg(d.id ORDER BY d.start_at, d.id))[1]
    INTO v_upcoming, v_sole
    FROM public.event_dates d
   WHERE d.event_id = p_event_id AND d.end_at > now();

  RETURN jsonb_build_object(
    'requiresChoice',
      v_type = 'event' AND (v_multi OR (v_recurring AND v_upcoming > 1)),
    'soleOccurrenceId',
      CASE WHEN v_type = 'event' AND v_recurring AND NOT v_multi AND v_upcoming = 1
        THEN v_sole END,
    'perOccurrenceCapacity',
      v_type = 'event' AND v_recurring AND NOT v_multi,
    'upcomingCount', v_upcoming
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3313_event_day_choice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_event_day_choice(uuid) TO service_role;

COMMENT ON FUNCTION public.issue_3313_event_day_choice(uuid) IS
  'issue #3313 — the one definition of whether a guest must pick a day '
  '(requiresChoice), the one upcoming night to bind when there is no choice '
  '(soleOccurrenceId), and whether capacity is per night '
  '(perOccurrenceCapacity). Read by checkout, the public bundle and the tier editor.';

-- ===========================================================================
-- §4 — Places used on ONE night.
-- ===========================================================================
-- SOLD: live passes of the type (#2491's sold set) that admit this night, plus
-- passes with NO day rows — those admit any night (I-PROPOSED-2160-A), so they
-- count on every night.
-- HELD: unexpired in-flight checkouts (#2879's held set). A checkout whose day
-- set includes this night holds quantity / day count when priced per_day
-- (quantity was stored as q x D) and quantity when all_days; a checkout with
-- no day set holds its full quantity on every night. Finalized or revoked
-- sessions hold nothing; p_exclude_session_id leaves one session out (the
-- finalize-time re-check measures everyone ELSE, then adds its own).
CREATE OR REPLACE FUNCTION public.issue_3313_ticket_type_occurrence_sold(
  p_ticket_type_id uuid,
  p_event_date_id uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sold integer;
BEGIN
  SELECT count(*)::integer INTO v_sold
    FROM public.tickets t
   WHERE t.ticket_type_id = p_ticket_type_id
     AND t.status IN ('valid', 'used', 'transferred')
     AND (
       EXISTS (SELECT 1 FROM public.ticket_event_dates ted
                WHERE ted.ticket_id = t.id AND ted.event_date_id = p_event_date_id)
       OR NOT EXISTS (SELECT 1 FROM public.ticket_event_dates ted
                       WHERE ted.ticket_id = t.id)
     );
  RETURN COALESCE(v_sold, 0);
END;
$fn$;

-- A two-argument draft of this function never shipped; dropping it keeps a
-- re-apply on a scratch database unambiguous.
DROP FUNCTION IF EXISTS public.issue_3313_ticket_type_occurrence_taken(uuid, uuid);
CREATE OR REPLACE FUNCTION public.issue_3313_ticket_type_occurrence_taken(
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_exclude_session_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_held integer;
BEGIN
  SELECT COALESCE(SUM(
           CASE
             WHEN sd.day_count = 0 THEN i.quantity
             WHEN COALESCE(s.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
               THEN i.quantity / sd.day_count
             ELSE i.quantity
           END
         ), 0)::integer
    INTO v_held
    FROM public.ticket_checkout_session_items i
    JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS day_count,
             COALESCE(bool_or(x.event_date_id = p_event_date_id), false) AS has_night
        FROM public.ticket_checkout_session_event_dates x
       WHERE x.checkout_session_id = s.id
    ) sd
   WHERE i.ticket_type_id = p_ticket_type_id
     AND s.expires_at > now()
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     -- a finalized or revoked session holds nothing (its tickets, if any,
     -- are counted as sold); the caller's own session can be excluded.
     AND s.order_id IS NULL
     AND s.revoked_at IS NULL
     AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
     AND (sd.day_count = 0 OR sd.has_night);

  RETURN public.issue_3313_ticket_type_occurrence_sold(p_ticket_type_id, p_event_date_id)
         + COALESCE(v_held, 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3313_ticket_type_occurrence_sold(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_ticket_type_occurrence_sold(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid) IS
  'issue #3313 — places of one ticket type used on one night: live passes that '
  'admit it (no-day passes count on every night) plus unexpired holds (per_day '
  'holds divided by their day count). THE per-night counter for checkout and '
  'the public reader; #3282 day-scoped tickets extend this, never a second one.';

-- ===========================================================================
-- §5 — business_publish_event_draft (copied from 20270701003288; ONE hunk)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.business_publish_event_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_tickets jsonb;
  v_ticket jsonb;
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
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_currency char(3);
  v_price numeric;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_date_entry jsonb;
  v_min_start timestamptz;
  -- ORCH-0824: new locals for taxonomy + city.
  v_city text;
  v_format text;   -- issue #2333
  -- issue #1653 — the wizard's pin was collected and then discarded at publish.
  v_location_geo point;
  v_coordinate_precision text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- ORCH-1075: paid-publish guard locals.
  v_paid_online boolean;
  v_max_end timestamptz;
  -- issue #1014: money-bearing predicate (BROADER than v_paid_online — no
  -- availableAt filter, no isFree shortcut: a paid DOOR ticket has no Stripe
  -- requirement but DOES display money and therefore requires a currency).
  v_money_bearing boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

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

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);
  v_tickets := COALESCE(v_business_draft->'tickets', '[]'::jsonb);
  -- issue #1014 delta (1): the 'GBP' fabrication is REMOVED — v_currency may
  -- now be NULL (currency-less brand, no draft override). Trigger (c) is
  -- authoritative: it stamps a resolvable brand currency or NULLs a free-only
  -- publish; the explicit gate below fail-closes money-bearing publishes.
  v_currency := upper(COALESCE(
    NULLIF(v_business_draft->>'currency', ''),
    NULLIF(p_draft_payload->>'currency', ''),
    v_brand.default_currency::text
  ))::char(3);

  -- issue #1014 delta (2): whitelist gains NGN (NG Paystack brands stamp
  -- brands.default_currency='NGN' at onboard) and runs only for a known
  -- currency — NULL means "no currency yet", not "unsupported currency".
  IF v_currency IS NOT NULL AND v_currency <> ALL (
    ARRAY[
      'GBP'::bpchar, 'USD'::bpchar, 'CAD'::bpchar, 'CHF'::bpchar, 'EUR'::bpchar,
      'BGN'::bpchar, 'CZK'::bpchar, 'DKK'::bpchar, 'HUF'::bpchar, 'ISK'::bpchar,
      'NOK'::bpchar, 'PLN'::bpchar, 'RON'::bpchar, 'SEK'::bpchar,
      'NGN'::bpchar
    ]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  IF jsonb_typeof(v_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_tickets) = 0 THEN
    RAISE EXCEPTION 'event_ticket_required';
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    IF NULLIF(btrim(COALESCE(v_ticket->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ticket_name_required';
    END IF;

    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    IF COALESCE((v_ticket->>'isFree')::boolean, false) = true THEN
      IF v_price <> 0 THEN
        RAISE EXCEPTION 'free_ticket_price_must_be_zero';
      END IF;
    ELSE
      IF v_price < 0 THEN
        RAISE EXCEPTION 'ticket_price_cannot_be_negative';
      END IF;
    END IF;
    IF COALESCE((v_ticket->>'isUnlimited')::boolean, false) = false
      AND COALESCE((v_ticket->>'capacity')::integer, 0) <= 0
    THEN
      RAISE EXCEPTION 'ticket_capacity_required';
    END IF;
    IF NULLIF(COALESCE(v_ticket->>'password', ''), '') IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_plaintext_password_forbidden';
    END IF;
  END LOOP;

  -- ORCH-0824: read new taxonomy + city fields and validate.
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>'format', '')), ''));
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]
  );

  -- issue #2333 — an ONLINE-ONLY event has no city and the wizard renders no
  -- field that could set one (CreatorStep3Where.tsx:138-140 gates the ONLY
  -- writer of city behind in_person|hybrid), so demanding one here made every
  -- online publish impossible while the client said "Ready to publish".
  -- Keyed on business_draft.format, the SAME node v_city is read from, and NOT
  -- on p_draft_payload.is_online — is_online is TRUE for HYBRID too
  -- (serverDraftEventMapper.ts:708), and hybrid genuinely has a city that
  -- validateWhere:382-406 requires. Absent/unknown format FAILS CLOSED.
  IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'city_required';
  END IF;

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
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  -- #1931 Amendment 1 §3 / Amendment 3 §5 released item 6 — the legacy-Private-draft
  -- publish block. This is the AUTHORITATIVE half: the client hook blocks too, but
  -- deleting the client block cannot admit a Private publish because this raises.
  --
  -- It is evaluated BEFORE any write, so a denied publish mutates nothing.
  --
  -- DELIBERATE, CONTRACT-MANDATED BEHAVIOUR CHANGE AT READINESS FALSE, and the only one
  -- in the released set. Today this function publishes visibility='private' UNGUARDED,
  -- which creates an offering no guest has a working access path to — the exact defect
  -- #1931 is named after. Amendment 1 §3 requires the server to "independently return
  -- typed private_access_not_ready", and Amendment 3 §5 frozen item 2 freezes anything
  -- that PERMITS Private publication. Non-private publishes are bit-identical.
  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;

  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'event';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');

  -- issue #1653 — promote the coordinate the wizard already captured. Mirrors
  -- business_patch_event_taxonomy exactly, including point(LNG, LAT) argument
  -- order. When the payload carries no coordinate we KEEP whatever the row
  -- already holds, so publishing can never erase a pin a later edit set.
  IF (p_draft_payload->'locationGeo'->>'lat') IS NOT NULL
     AND (p_draft_payload->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (p_draft_payload->'locationGeo'->>'lng')::double precision,
      (p_draft_payload->'locationGeo'->>'lat')::double precision
    );
    -- Normalise the token so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — a stale client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(p_draft_payload->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
  ELSE
    SELECT e.location_geo, e.coordinate_precision
      INTO v_location_geo, v_coordinate_precision
      FROM public.events e WHERE e.id = p_event_id;
  END IF;
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled when the cover url is absent (a photo gallery coexists with any
  -- cover, incl. a video cover). Default [] preserves single-cover behavior.
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL;
    v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL;
    v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL;
    v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  v_when_mode := COALESCE(NULLIF(v_business_draft->>'whenMode', ''), 'single');
  v_when := v_business_draft->'when';
  v_multi_dates := v_business_draft->'multiDates';

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;

  IF v_when_mode IN ('single', 'recurring') THEN
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
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

    -- issue #3313 — A RECURRING EVENT GETS EVERY DATE ITS RULE DESCRIBES.
    -- This branch used to stop at the master row above, so "every Tuesday, 8
    -- times" published ONE Tuesday: the rule was only copied onto the event
    -- row. The #1138 expander (52-date cap, master = date #1, same local start
    -- time and length) has always been type-agnostic; experiences called it and
    -- events never did. The rule expanded is the SAME value written to
    -- events.recurrence_rules below, so the stored rule and the dates cannot
    -- disagree. DELETE THIS BLOCK and a recurring event sells one night only.
    IF v_when_mode = 'recurring'
       AND jsonb_typeof(p_draft_payload->'recurrence_rules') = 'object' THEN
      PERFORM public.pg_expand_experience_recurrence(
        p_event_id, v_start, v_end, p_draft_payload->'recurrence_rules', v_timezone
      );
    END IF;

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
    END LOOP;
  END IF;

  -- ORCH-1075 paid-publish integrity guards (event publish path) ---------
  -- PAID = a ticket about to be written that is online-sellable
  -- (availableAt in ('online','both')) AND has price_cents > 0. In-person-only
  -- paid tickets (availableAt='door') and FREE tickets are exempt: they cannot
  -- reach the buyer-web/native checkout 409, so Guard A is N/A (operator-confirmed
  -- 2026-06-04). Mirror the checkout readiness predicate + reject past-dated paid
  -- publishes BEFORE the status flips to scheduled.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT bool_or(
           COALESCE((t->>'availableAt'), 'both') IN ('online', 'both')
           AND NOT COALESCE((t->>'isFree')::boolean, false)
           AND round(
                 COALESCE(
                   NULLIF(t->>'priceMajor', '')::numeric,
                   NULLIF(t->>'price', '')::numeric,
                   NULLIF(t->>'priceGbp', '')::numeric,
                   0
                 ) * 100
               ) > 0
         )
    INTO v_paid_online
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_paid_online, false) THEN
    IF NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- issue #1014 deltas (3)+(4) — money-bearing predicate + explicit currency
  -- gate, grouped with the ORCH-1075 guards (before the events write). ANY
  -- ticket priced > 0 (online OR door, isFree flag irrelevant — price is
  -- truth) makes the publish money-bearing; money without a resolvable
  -- currency fails close HERE for error locality (the trigger remains the
  -- backstop for undeclared paths).
  SELECT bool_or(
           round(
             COALESCE(
               NULLIF(t->>'priceMajor', '')::numeric,
               NULLIF(t->>'price', '')::numeric,
               NULLIF(t->>'priceGbp', '')::numeric,
               0
             ) * 100
           ) > 0
         )
    INTO v_money_bearing
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_money_bearing, false) AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 delta (5): declare the moneyless transition to
  -- tg_require_event_brand_currency (transaction-scoped flag).
  IF NOT COALESCE(v_money_bearing, false) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- ORCH-0824: write the four new top-level columns + strip taxonomy keys
  -- and deprecated 'category' from business_event JSONB so the same data
  -- is not stored in two places.
  UPDATE public.events
  SET
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
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = COALESCE((p_draft_payload->>'is_recurring')::boolean, false),
    is_multi_date = COALESCE((p_draft_payload->>'is_multi_date')::boolean, false),
    recurrence_rules = p_draft_payload->'recurrence_rules',
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets'
        - 'category'      -- ORCH-0824: deprecated; promoted to party_types column
        - 'partyTypes'    -- ORCH-0824: promoted to party_types column
        - 'vibeTags'      -- ORCH-0824: promoted to vibe_tags column
        - 'musicGenres'   -- ORCH-0824: promoted to music_genres column
        - 'city'          -- ORCH-0824: promoted to city column
        - 'locationGeo'   -- ORCH-0824: cached client-side only
      ) || jsonb_build_object('currency', v_currency::text),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    currency = v_currency,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    -- ORCH-0824: new top-level columns
    city = v_city,
    location_geo = v_location_geo,              -- issue #1653
    coordinate_precision = v_coordinate_precision,  -- issue #1653
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  UPDATE public.ticket_types
  SET deleted_at = v_now, updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    INSERT INTO public.ticket_types (
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      p_event_id,
      btrim(v_ticket->>'name'),
      NULLIF(v_ticket->>'description', ''),
      CASE
        WHEN COALESCE((v_ticket->>'isFree')::boolean, false) THEN 0
        ELSE round(v_price * 100)::integer
      END,
      v_currency,
      CASE
        WHEN COALESCE((v_ticket->>'isUnlimited')::boolean, false) THEN NULL
        ELSE COALESCE((v_ticket->>'capacity')::integer, 0)
      END,
      COALESCE((v_ticket->>'isUnlimited')::boolean, false),
      COALESCE((v_ticket->>'isFree')::boolean, false),
      NULLIF(v_ticket->>'saleStartAt', '')::timestamptz,
      NULLIF(v_ticket->>'saleEndAt', '')::timestamptz,
      COALESCE((v_ticket->>'minPurchaseQty')::integer, 1),
      NULLIF(v_ticket->>'maxPurchaseQty', '')::integer,
      COALESCE(v_ticket->>'visibility', 'public') = 'hidden',
      COALESCE(v_ticket->>'visibility', 'public') = 'disabled',
      COALESCE((v_ticket->>'approvalRequired')::boolean, false),
      COALESCE((v_ticket->>'allowTransfers')::boolean, true),
      COALESCE((v_ticket->>'passwordProtected')::boolean, false),
      NULL,
      COALESCE(v_ticket->>'availableAt', 'both') IN ('online', 'both'),
      COALESCE(v_ticket->>'availableAt', 'both') IN ('door', 'both'),
      COALESCE((v_ticket->>'waitlistEnabled')::boolean, false),
      COALESCE((v_ticket->>'displayOrder')::integer, 0),
      NULL
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;

-- ===========================================================================
-- §6 — business_patch_event_when (copied from 20270628003285; four hunks)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.business_patch_event_when(p_event_id uuid, p_when_payload jsonb, p_reason text, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_trimmed_reason text;
  v_reason_len integer;
  v_when_mode text;
  v_old_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_min_start timestamptz;
  v_date_entry jsonb;
  v_sold_count integer;
  v_old_recurrence jsonb;
  v_new_recurrence jsonb;
  v_old_master_dates date[];
  v_new_payload_dates date[];
  v_updated public.events%ROWTYPE;
  v_event_is_paid_online boolean; -- ORCH-1075: event currently online-paid?
  v_max_end timestamptz;          -- ORCH-1075: latest end_at after the patch
  -- #3285: reconcile state. Targets (t_*) are the payload occurrences; rows
  -- (e_*) are the event's existing event_dates, locked FOR UPDATE below.
  v_ack boolean;
  v_t_dates date[] := '{}'::date[];
  v_t_starts timestamptz[] := '{}'::timestamptz[];
  v_t_ends timestamptz[] := '{}'::timestamptz[];
  v_t_match uuid[] := '{}'::uuid[];
  v_n_t integer := 0;
  v_e_ids uuid[];
  v_e_starts timestamptz[];
  v_e_ends timestamptz[];
  v_e_days date[];
  v_e_matched boolean[];
  v_n_e integer := 0;
  v_i integer;
  v_j integer;
  v_cand integer;
  v_cand_count integer;
  v_t_on_day integer;
  v_e_on_day integer;
  v_removed uuid[] := '{}'::uuid[];
  v_hold text;
  v_master_id uuid;
  -- issue #3313: a recurring event's targets are every date of its rule.
  v_rule jsonb;
  v_cover_through timestamptz;
  v_occ record;
  v_persist_when_shape boolean;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Fetch + lock the events row (concurrent edit/publish protection)
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- 3. Soft-delete guard
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_deleted';
  END IF;

  -- 4. Status guard — only scheduled/live events are editable
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  -- 5. Permission — event_manager+ for the brand
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- #3285: lock the complete schedule before any guard reads it. A concurrent
  -- scan or mint takes FOR KEY SHARE on the date row it references, so it
  -- serialises behind this edit: the "held" check below cannot be raced by a
  -- success scan or a pass that commits between the check and the write.
  -- Mirrors business_unpublish_event_to_draft.
  PERFORM 1 FROM public.event_dates WHERE event_id = p_event_id ORDER BY id FOR UPDATE;


  -- 6. Reason validation (mirror publishedEventEditGuards.ts:26-32 — trim ∈ [10, 200])
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_trimmed_reason := btrim(p_reason);
  IF length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_reason_len := length(v_trimmed_reason);
  IF v_reason_len < 10 OR v_reason_len > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- 7. Client revision check (NO-OP — events.client_revision column does
  --    not exist yet; param reserved for future optimistic-concurrency
  --    extension. Service still passes the param per SPEC §4.8 contract.)
  IF p_client_revision IS NOT NULL THEN
    -- Future: SELECT client_revision FROM events WHERE id = p_event_id;
    -- and raise stale_client_revision on mismatch. Currently a no-op.
    NULL;
  END IF;

  -- 8. whenMode validation
  v_when_mode := COALESCE(NULLIF(p_when_payload->>'whenMode', ''), 'single');
  v_when := p_when_payload->'when';
  v_multi_dates := p_when_payload->'multiDates';
  v_timezone := COALESCE(NULLIF(p_when_payload->>'timezone', ''), v_event.timezone, 'UTC');

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- 9. Buyer-protection (CONSERVATIVE) — block structural changes when sold>0
  SELECT count(*)::integer INTO v_sold_count
  FROM public.orders
  WHERE event_id = p_event_id
    AND payment_status IN ('paid', 'partial_refund');

  v_old_when_mode := CASE
    WHEN v_event.is_multi_date THEN 'multi_date'
    WHEN v_event.is_recurring THEN 'recurring'
    ELSE 'single'
  END;

  -- ORCH-1047 "Refund all & proceed": when the payload carries
  -- "acknowledgeSoldImpact": true (organiser chose to refund all buyers and
  -- change anyway), bypass every sold-ticket structural block below. Carried
  -- inside p_when_payload (not a new param) so this stays a CREATE OR REPLACE
  -- with no signature change / no DROP. Absent/false preserves the
  -- conservative refund-first behaviour for all other callers. The client only
  -- sets this true AFTER attempting to refund every order for the event.
  IF v_sold_count > 0 AND NOT COALESCE((p_when_payload->>'acknowledgeSoldImpact')::boolean, false) THEN
    -- Block whenMode change
    IF v_when_mode <> v_old_when_mode THEN
      RAISE EXCEPTION 'when_mode_drops_active_date';
    END IF;

    -- Block recurrenceRule structural change in recurring mode
    IF v_when_mode = 'recurring' THEN
      v_old_recurrence := v_event.recurrence_rules;
      v_new_recurrence := p_when_payload->'recurrenceRule';
      IF COALESCE(v_old_recurrence::text, '') <> COALESCE(v_new_recurrence::text, '') THEN
        RAISE EXCEPTION 'recurrence_drops_occurrence';
      END IF;
    END IF;

    -- Block multi-date structural removal OR single-mode date change
    IF v_when_mode = 'multi_date' THEN
      -- Compare existing event_dates dates with payload dates
      SELECT array_agg(DISTINCT (start_at AT TIME ZONE v_timezone)::date ORDER BY (start_at AT TIME ZONE v_timezone)::date)
      INTO v_old_master_dates
      FROM public.event_dates
      WHERE event_id = p_event_id;

      SELECT array_agg(DISTINCT (entry->>'date')::date ORDER BY (entry->>'date')::date)
      INTO v_new_payload_dates
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      -- Reject if any existing date is missing from new payload
      IF v_old_master_dates IS NOT NULL AND v_new_payload_dates IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM unnest(v_old_master_dates) AS d
          WHERE d <> ALL(v_new_payload_dates)
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
      END IF;
    END IF;

    IF v_when_mode = 'single' THEN
      -- Reject date change in single mode with sold>0
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at AT TIME ZONE v_timezone)::date <> v_date_iso::date
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
        -- ORCH-1047 buyer protection: a TIME / timezone change (same calendar
        -- day) is just as material to a ticket holder as a date move — the
        -- event they paid for is moving — so it must also pass through the
        -- refund-first process rather than saving silently. Compute the
        -- proposed master start/end instant (mirror the §10 midnight-wrap) and
        -- reject if it differs from the current master row.
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at <> v_start OR end_at <> v_end)
        ) THEN
          RAISE EXCEPTION 'schedule_change_with_sales';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════
  -- 10. #3285 — RECONCILE event_dates IN PLACE. NEVER DELETE-AND-REINSERT.
  --
  -- The previous body ran `DELETE` over every row for the event and
  -- re-inserted them with new ids. Three things point at those ids:
  -- ticket_event_dates (the days a pass admits), orders.event_date_id (the
  -- payout anchor) and scan_events.event_date_id (the admitting day, which is
  -- what de-duplicates a multi-day pass at the door). Adding a day or
  -- retiming one passed the old guard, so every sold pass silently became an
  -- any-day pass, every anchor went NULL, and every in-flight checkout was
  -- revoked, on a save that changed nothing a guest holds.
  --
  -- An occurrence is now matched to its existing row and updated in place:
  --   P1 same start instant (exactly one candidate);
  --   P2 same local calendar day, row day in the row's own stored zone,
  --      when exactly one unmatched target and one unmatched row share it;
  --   P3 single/recurring only: the one occurrence is the same occurrence
  --      even when its date moves.
  -- A multi-date day is NEVER matched across dates: Friday -> Saturday is
  -- remove Friday + add Saturday, so a Friday pass cannot become a Saturday
  -- pass. A day with unmatched targets AND unmatched rows after P2 is
  -- ambiguous (e.g. two same-day sessions both retimed).
  -- ═════════════════════════════════════════════════════════════════════════
  v_ack := COALESCE((p_when_payload->>'acknowledgeSoldImpact')::boolean, false);

  -- 10.1 Build and validate the targets (same codes, same order as before).
  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    -- Midnight wrap — IDENTICAL to business_publish_event_draft:292-294
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    -- Zero-duration rejection (defensive — wizard should prevent this client-side)
    IF v_end = v_start THEN
      RAISE EXCEPTION 'event_end_must_differ_from_start';
    END IF;
    -- issue #3313 — A RECURRING EVENT'S TARGETS ARE EVERY DATE OF ITS RULE.
    -- #3285 built ONE target here for recurring, so the in-place reconcile
    -- below would have deleted every other date nothing held. The rule is the
    -- one the organiser just saved, else the stored one. The window is every
    -- date since the anchor that has already started, up to 52 upcoming dates,
    -- and — when the rule is unchanged — every date the top-up has already
    -- added, so an unchanged save matches every existing row and writes
    -- nothing. No rule at all keeps the single #3285 target.
    IF v_when_mode = 'recurring' THEN
      v_rule := CASE
        WHEN jsonb_typeof(p_when_payload->'recurrenceRule') = 'object'
          THEN p_when_payload->'recurrenceRule'
        WHEN jsonb_typeof(v_event.recurrence_rules) = 'object'
          THEN v_event.recurrence_rules
        ELSE NULL
      END;
    END IF;
    IF v_rule IS NULL THEN
      v_t_dates := ARRAY[v_date_iso::date];
      v_t_starts := ARRAY[v_start];
      v_t_ends := ARRAY[v_end];
    ELSE
      IF v_rule IS NOT DISTINCT FROM v_event.recurrence_rules THEN
        SELECT max(ed.start_at) INTO v_cover_through
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id;
      END IF;
      FOR v_occ IN
        SELECT o.start_at, o.end_at
          FROM public.issue_3313_recurrence_occurrences(
                 v_start, v_end, v_rule, v_timezone, v_now, 52, v_cover_through
               ) o
         ORDER BY o.occurrence_index
      LOOP
        v_t_dates := v_t_dates || (v_occ.start_at AT TIME ZONE v_timezone)::date;
        v_t_starts := v_t_starts || v_occ.start_at;
        v_t_ends := v_t_ends || v_occ.end_at;
      END LOOP;
    END IF;

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      -- Per-entry midnight wrap — IDENTICAL to business_publish_event_draft:327-329
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      IF v_end = v_start THEN
        RAISE EXCEPTION 'event_end_must_differ_from_start';
      END IF;
      -- Two occurrences starting at the same instant cannot be told apart, so
      -- they cannot be matched. The wizard already refuses duplicate
      -- date+startTime; this is the server's own refusal.
      IF v_start = ANY (v_t_starts) THEN
        RAISE EXCEPTION 'event_date_duplicate';
      END IF;
      v_t_dates := v_t_dates || v_date_iso::date;
      v_t_starts := v_t_starts || v_start;
      v_t_ends := v_t_ends || v_end;
    END LOOP;
  END IF;

  v_n_t := COALESCE(array_length(v_t_starts, 1), 0);
  v_t_match := array_fill(NULL::uuid, ARRAY[v_n_t]);

  -- 10.2 The existing rows (already locked).
  SELECT COALESCE(array_agg(ed.id ORDER BY ed.start_at, ed.id), '{}'::uuid[]),
         COALESCE(array_agg(ed.start_at ORDER BY ed.start_at, ed.id), '{}'::timestamptz[]),
         COALESCE(array_agg(ed.end_at ORDER BY ed.start_at, ed.id), '{}'::timestamptz[]),
         COALESCE(array_agg((ed.start_at AT TIME ZONE ed.timezone)::date ORDER BY ed.start_at, ed.id), '{}'::date[])
    INTO v_e_ids, v_e_starts, v_e_ends, v_e_days
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id;
  v_n_e := COALESCE(array_length(v_e_ids, 1), 0);
  v_e_matched := array_fill(false, ARRAY[v_n_e]);

  -- 10.3 P1 — same start instant.
  FOR v_i IN 1 .. v_n_t LOOP
    v_cand := NULL;
    v_cand_count := 0;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] AND v_e_starts[v_j] = v_t_starts[v_i] THEN
        v_cand := v_j;
        v_cand_count := v_cand_count + 1;
      END IF;
    END LOOP;
    IF v_cand_count = 1 THEN
      v_t_match[v_i] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END LOOP;

  -- 10.3 P2 — same local calendar day, only when it is 1:1.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NOT NULL;
    v_t_on_day := 0;
    FOR v_j IN 1 .. v_n_t LOOP
      IF v_t_match[v_j] IS NULL AND v_t_dates[v_j] = v_t_dates[v_i] THEN
        v_t_on_day := v_t_on_day + 1;
      END IF;
    END LOOP;
    v_e_on_day := 0;
    v_cand := NULL;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] AND v_e_days[v_j] = v_t_dates[v_i] THEN
        v_e_on_day := v_e_on_day + 1;
        v_cand := v_j;
      END IF;
    END LOOP;
    IF v_t_on_day = 1 AND v_e_on_day = 1 THEN
      v_t_match[v_i] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END LOOP;

  -- 10.3 P3 — a single/recurring event's one occurrence is the same
  -- occurrence when its date moves.
  IF v_when_mode IN ('single', 'recurring') AND v_n_t = 1 AND v_t_match[1] IS NULL THEN
    v_e_on_day := 0;
    v_cand := NULL;
    FOR v_j IN 1 .. v_n_e LOOP
      IF NOT v_e_matched[v_j] THEN
        v_e_on_day := v_e_on_day + 1;
        v_cand := v_j;
      END IF;
    END LOOP;
    IF v_e_on_day = 1 THEN
      v_t_match[1] := v_e_ids[v_cand];
      v_e_matched[v_cand] := true;
    END IF;
  END IF;

  -- 10.4 Removed = every existing row nothing matched.
  FOR v_j IN 1 .. v_n_e LOOP
    IF NOT v_e_matched[v_j] THEN
      v_removed := v_removed || v_e_ids[v_j];
    END IF;
  END LOOP;

  -- 10.5a The multi-date twin of ORCH-1047's single-date rule. With sales and
  -- no "Refund all & proceed", guests who bought a day must not find it moved
  -- or gone. Adding a day is allowed: no holder's day changes.
  -- issue #3313 — recurring joins multi_date: with sales, a guest's night must
  -- not move or disappear without "Refund all & proceed".
  IF v_sold_count > 0 AND NOT v_ack AND v_when_mode IN ('multi_date', 'recurring') THEN
    -- A day removed outright: its local day has no unmatched target.
    FOR v_j IN 1 .. v_n_e LOOP
      CONTINUE WHEN v_e_matched[v_j];
      v_t_on_day := 0;
      FOR v_i IN 1 .. v_n_t LOOP
        IF v_t_match[v_i] IS NULL AND v_t_dates[v_i] = v_e_days[v_j] THEN
          v_t_on_day := v_t_on_day + 1;
        END IF;
      END LOOP;
      IF v_t_on_day = 0 THEN
        RAISE EXCEPTION 'multi_date_remove_with_sales';
      END IF;
    END LOOP;
    -- A matched day whose start or end moved.
    FOR v_i IN 1 .. v_n_t LOOP
      CONTINUE WHEN v_t_match[v_i] IS NULL;
      FOR v_j IN 1 .. v_n_e LOOP
        IF v_e_ids[v_j] = v_t_match[v_i]
           AND (v_e_starts[v_j], v_e_ends[v_j]) IS DISTINCT FROM (v_t_starts[v_i], v_t_ends[v_i]) THEN
          RAISE EXCEPTION 'schedule_change_with_sales';
        END IF;
      END LOOP;
    END LOOP;
    -- Anything still unmatched shares its day with an unmatched target: an
    -- ambiguous same-day change, which is a schedule change.
    IF COALESCE(array_length(v_removed, 1), 0) > 0 THEN
      RAISE EXCEPTION 'schedule_change_with_sales';
    END IF;
  END IF;

  -- 10.5b ALWAYS, including "Refund all & proceed" and sold_count = 0: an
  -- occurrence that something still holds is never deleted.
  FOR v_j IN 1 .. v_n_e LOOP
    CONTINUE WHEN v_e_matched[v_j];
    v_hold := public.issue_3285_event_date_hold_reason(v_e_ids[v_j]);
    CONTINUE WHEN v_hold IS NULL;
    v_t_on_day := 0;
    FOR v_i IN 1 .. v_n_t LOOP
      IF v_t_match[v_i] IS NULL AND v_t_dates[v_i] = v_e_days[v_j] THEN
        v_t_on_day := v_t_on_day + 1;
      END IF;
    END LOOP;
    IF v_t_on_day > 0 THEN
      RAISE EXCEPTION 'event_date_match_ambiguous'
        USING DETAIL = format('issue #3285: occurrence %s is held (%s) and its day cannot be matched to exactly one new time', v_e_ids[v_j], v_hold);
    END IF;
    RAISE EXCEPTION 'multi_date_remove_with_sales'
      USING DETAIL = format('issue #3285: occurrence %s is held (%s)', v_e_ids[v_j], v_hold);
  END LOOP;

  -- 10.6 Writes. Only rows whose values actually change are touched, so the
  -- #1930 revocation trigger and the #1777 reach trigger fire on real changes
  -- only.
  IF COALESCE(array_length(v_removed, 1), 0) > 0 THEN
    -- W1 Dead entitlements only (void/refunded passes) for days being removed.
    -- A live one cannot reach here (10.5b); if one ever did, the RESTRICT FK
    -- refuses the delete below instead of orphaning it.
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = ANY (v_removed)
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    -- W2
    DELETE FROM public.event_dates WHERE id = ANY (v_removed);
  END IF;

  -- W3 Retime matched rows in place. The id — and everything pointing at it —
  -- survives.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NULL;
    UPDATE public.event_dates
       SET start_at = v_t_starts[v_i],
           end_at = v_t_ends[v_i]
     WHERE id = v_t_match[v_i]
       AND (start_at, end_at) IS DISTINCT FROM (v_t_starts[v_i], v_t_ends[v_i]);
  END LOOP;

  -- W4 Zone relabel.
  UPDATE public.event_dates
     SET timezone = v_timezone
   WHERE event_id = p_event_id
     AND timezone IS DISTINCT FROM v_timezone;

  -- W5 Genuinely new occurrences.
  FOR v_i IN 1 .. v_n_t LOOP
    CONTINUE WHEN v_t_match[v_i] IS NOT NULL;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_t_starts[v_i], v_t_ends[v_i], v_timezone, false);
  END LOOP;

  -- W6 Exactly one master = the earliest occurrence. Clear before set:
  -- event_dates_master_unique is a non-deferrable partial unique index.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id <> v_master_id;
  UPDATE public.event_dates
     SET is_master = true
   WHERE id = v_master_id
     AND NOT is_master;

  -- ORCH-1075 paid-publish integrity guard (event-edit family — Guard B only).
  -- business_patch_event_when patches WHEN (dates) only; it never writes
  -- price_cents / available_online, so a free<->paid transition is impossible
  -- here and Guard A (Stripe readiness) is N/A. But editing dates CAN push an
  -- already-PAID online event onto a past date, so reject that. FREE events and
  -- in-person-only paid events are exempt (paid-only, mirrors checkout).
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  v_event_is_paid_online := EXISTS (
    SELECT 1 FROM public.ticket_types t
     WHERE t.event_id = p_event_id
       AND t.deleted_at IS NULL
       AND t.available_online = true
       AND t.price_cents > 0
  );
  IF v_event_is_paid_online THEN
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- 11. Update events row (timezone may have changed; updated_at bump)
  -- issue #3313 — a save that involves recurring (either side) also stores
  -- the When shape it just materialised: the mode flags, the rule the top-up
  -- and the public reader expand, and the organiser's copy in
  -- theme.business_event. Before this a live rule change moved the dates while
  -- every stored copy kept the old rule. Every other save is byte-identical.
  v_persist_when_shape := v_when_mode = 'recurring' OR v_old_when_mode = 'recurring';
  UPDATE public.events
  SET
    timezone = v_timezone,
    is_recurring = CASE WHEN v_persist_when_shape
      THEN v_when_mode = 'recurring' ELSE is_recurring END,
    is_multi_date = CASE WHEN v_persist_when_shape
      THEN v_when_mode = 'multi_date' ELSE is_multi_date END,
    recurrence_rules = CASE WHEN v_persist_when_shape
      THEN CASE WHEN v_when_mode = 'recurring' THEN v_rule ELSE NULL END
      ELSE recurrence_rules END,
    theme = CASE WHEN v_persist_when_shape
      THEN COALESCE(theme, '{}'::jsonb) || jsonb_build_object(
        'business_event',
        CASE WHEN jsonb_typeof(theme->'business_event') = 'object'
          THEN theme->'business_event' ELSE '{}'::jsonb END
        || jsonb_build_object(
          'whenMode', v_when_mode,
          'when', v_when,
          'multiDates', v_multi_dates,
          'recurrenceRule', CASE WHEN v_when_mode = 'recurring' THEN v_rule ELSE NULL END
        ))
      ELSE theme END,
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  -- 12. Return canonical shape (mirror business_patch_event_taxonomy)
  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'when_mode', v_when_mode,
    'sold_count', v_sold_count,
    'updated_at', v_now
  );
END;
$function$;

-- ===========================================================================
-- §7 — issue_1930_ticket_checkout_create_session_base (copied from
-- 20270609002879; three hunks)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_night_taken integer;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- ══ issue #2160 DELTA 3 of 6 — VALIDATE THE DAY SET, READ THE MODE ════
  -- Distinct, ordered by start_at, and every id must be an occurrence OF
  -- THIS EVENT that has not already ended. A day the guest cannot attend is
  -- never allowed to become an entitlement.
  --
  -- DELETE THIS BLOCK and a guest can mint a pass for another event's
  -- occurrence, or for a day that is already over.
  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids, 1) > 0 THEN
    SELECT ARRAY(
             SELECT d.id FROM public.event_dates d
              WHERE d.event_id = p_event_id
                AND d.id = ANY (p_event_date_ids)
              ORDER BY d.start_at, d.id
           )
      INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids, 1), 0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) AS x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_dates d
                WHERE d.id = ANY (v_day_ids) AND d.end_at <= now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count := COALESCE(array_length(v_day_ids, 1), 0);
  END IF;

  -- ══ issue #3313 — NO ORDER WITHOUT A NIGHT ═════════════════════════════
  -- A checkout on an event with more than one bookable date used to finish
  -- with NO day set: orders.event_date_id NULL, no ticket_event_dates, and a
  -- pass that admits on ANY night (I-PROPOSED-2160-A). One predicate decides,
  -- the same one the public reader turns into `isMultiDate`, so the chooser a
  -- guest sees and the refusal here cannot disagree:
  --   * a recurring event with exactly one upcoming date binds to it;
  --   * an event that requires a choice and received none is refused.
  -- Trips, experiences and single-date events: requiresChoice is false and
  -- there is no sole date, so this block is a no-op for them.
  -- DELETE THIS BLOCK and a no-night order is issued again.
  v_day_choice := public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence := COALESCE((v_day_choice ->> 'perOccurrenceCapacity')::boolean, false);
  IF v_day_count = 0 AND (v_day_choice ->> 'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids := ARRAY[(v_day_choice ->> 'soleOccurrenceId')::uuid];
    v_day_count := 1;
  END IF;
  IF v_day_count = 0 AND COALESCE((v_day_choice ->> 'requiresChoice')::boolean, false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;

  -- The organiser's choice. Read ONCE, here, so the whole function agrees.
  SELECT COALESCE(e.multi_date_pricing_mode, 'per_day')
    INTO v_pricing_mode
    FROM public.events e WHERE e.id = p_event_id;

  -- THE ONE MULTIPLIER, APPLIED IN ONE PLACE.
  --   per_day , D days -> D  (D admissions, D passes, D units of capacity)
  --   all_days, D days -> 1  (one pass sold once)
  --   no days chosen    -> 1  (byte-identical to pre-#2160)
  -- Because it multiplies the stored line QUANTITY, pricing, capacity and
  -- the mint loop all see the same number with no special-casing anywhere
  -- downstream (amendment §1 and §8).
  IF v_day_count > 0 AND v_pricing_mode = 'per_day' THEN
    v_day_multiplier := v_day_count;
  END IF;

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    -- ══ issue #2160 DELTA 4 of 6 — THE PER-DAY MULTIPLIER ═══════════════
    -- Applied AFTER min_purchase_qty / max_purchase_qty, which stay per LINE
    -- and therefore mean "per day" — an organiser capping a guest at 4
    -- tickets means 4 per day, not 4 across a three-day festival. Applied
    -- BEFORE capacity and pricing, which must both see the real number of
    -- admissions. v_day_multiplier is 1 on every pre-#2160 path.
    v_qty := v_qty_raw * v_day_multiplier;

    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      IF v_per_occurrence AND v_day_count > 0 THEN
        SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
          INTO v_cart_qty_for_type
          FROM jsonb_array_elements(p_lines) AS l
         WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY v_day_ids LOOP
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded';
            END IF;
          END LOOP;
        END IF;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- ---------------- Pass 2: per-line installment math (META-ORCH-1174 B1). ----------------
  -- For trips only, walk the BUILT line items (v_items carries the per-line
  -- totals). For each line, look up its package's tier_metadata.installments.
  -- A line with a plan (and not opted to pay-full) contributes its OWN deposit
  -- to "due today" + its OWN installment entries to the union; a line without a
  -- plan contributes its full total to "due today". The union is then re-
  -- numbered ordinal 1..M sorted by dueAt.
  --
  -- ORCH-0915 opt-out: p_payment_plan_choice='full' ⇒ NO line installments at
  -- all (every line pays full now). This is the session-wide pay-in-full path.
  IF v_is_trip AND p_payment_plan_choice <> 'full' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_total := (v_line ->> 'totalCents')::bigint;
      v_tier_metadata := NULL;

      SELECT tpt.tier_metadata
        INTO v_tier_metadata
        FROM public.trip_pricing_tiers tpt
       WHERE tpt.event_id = p_event_id
         AND tpt.ticket_type_id = (v_line ->> 'ticketTypeId')::uuid;

      v_installments_input := CASE
        WHEN v_tier_metadata IS NOT NULL THEN v_tier_metadata -> 'installments'
        ELSE NULL
      END;

      IF v_installments_input IS NOT NULL
         AND jsonb_typeof(v_installments_input) = 'object' THEN
        -- This package carries a payment plan → compute its per-line schedule.
        v_deposit_pct := COALESCE((v_installments_input ->> 'deposit_pct')::numeric, 0);
        v_inst_array := v_installments_input -> 'installments';

        IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
          RAISE EXCEPTION 'installment_deposit_pct_out_of_range';
        END IF;
        IF v_inst_array IS NULL OR jsonb_typeof(v_inst_array) <> 'array' THEN
          RAISE EXCEPTION 'installment_schedule_malformed';
        END IF;

        v_inst_count := jsonb_array_length(v_inst_array);
        IF v_inst_count < 1 OR v_inst_count > 11 THEN
          RAISE EXCEPTION 'installment_count_out_of_range';
        END IF;

        -- First pass over THIS line's installments: validate + accumulate pct.
        v_pct_sum := v_deposit_pct;
        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := COALESCE((v_inst_item ->> 'ordinal')::int, -1);
          v_inst_pct := COALESCE((v_inst_item ->> 'pct')::numeric, 0);
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_ord <> v_i + 1 THEN
            RAISE EXCEPTION 'installment_ordinal_invalid';
          END IF;
          IF v_inst_pct <= 0 OR v_inst_pct >= 100 THEN
            RAISE EXCEPTION 'installment_pct_out_of_range';
          END IF;
          IF (v_inst_days IS NULL AND v_inst_fixed IS NULL)
             OR (v_inst_days IS NOT NULL AND v_inst_fixed IS NOT NULL) THEN
            RAISE EXCEPTION 'installment_due_mode_invalid';
          END IF;

          v_pct_sum := v_pct_sum + v_inst_pct;
        END LOOP;

        IF abs(v_pct_sum - 100) > 0.01 THEN
          RAISE EXCEPTION 'installment_pct_sum_mismatch';
        END IF;

        -- Second pass: amounts scaled by THIS LINE's total, last-absorbs-rounding.
        v_line_deposit_cents := floor(v_line_total::numeric * v_deposit_pct / 100)::bigint;
        v_line_running := 0;

        FOR v_i IN 0 .. v_inst_count - 1 LOOP
          v_inst_item := v_inst_array -> v_i;
          v_inst_ord := (v_inst_item ->> 'ordinal')::int;
          v_inst_pct := (v_inst_item ->> 'pct')::numeric;
          v_inst_days := NULLIF(v_inst_item ->> 'days_after_booking', '')::int;
          v_inst_fixed := NULLIF(v_inst_item ->> 'fixed_date', '');

          IF v_inst_days IS NOT NULL THEN
            IF v_inst_days < 1 THEN
              RAISE EXCEPTION 'installment_days_after_booking_invalid';
            END IF;
            v_inst_due := v_now + (v_inst_days || ' days')::interval;
          ELSE
            v_inst_due := (v_inst_fixed)::timestamptz;
          END IF;

          IF v_i = 0 AND v_inst_due <= v_now THEN
            RAISE EXCEPTION 'installment_schedule_past_due_at_booking';
          END IF;

          IF v_i < v_inst_count - 1 THEN
            v_inst_amount := floor(v_line_total::numeric * v_inst_pct / 100)::bigint;
            v_line_running := v_line_running + v_inst_amount;
          ELSE
            v_inst_amount := v_line_total - v_line_deposit_cents - v_line_running;
            IF v_inst_amount <= 0 THEN
              RAISE EXCEPTION 'installment_rounding_invalid';
            END IF;
          END IF;

          -- Append to the UNION with a sortable dueAt (ordinal re-numbered below).
          v_unioned := v_unioned || jsonb_build_array(jsonb_build_object(
            'pct', v_inst_pct,
            'amountCents', v_inst_amount,
            'dueAt', to_char(v_inst_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'sourceTicketTypeId', (v_line ->> 'ticketTypeId'),
            'sourceOrdinal', v_inst_ord
          ));
        END LOOP;

        v_due_today_cents := v_due_today_cents + v_line_deposit_cents;
        v_any_installments := true;
      ELSE
        -- No plan on this package → its full total is due today.
        v_due_today_cents := v_due_today_cents + v_line_total;
      END IF;
    END LOOP;
  END IF;

  -- ---------------- Finalize the schedule + the deposit override. ----------------
  -- When at least one line produced installments, override v_total to the summed
  -- "due today" (Σ deposits + Σ non-plan fulls) and build the unioned schedule
  -- with sequential ordinals 1..M sorted by dueAt (then stable source order). The
  -- persisted shape is byte-identical to the single-line ORCH-0869 schedule.
  IF v_any_installments THEN
    v_total := v_due_today_cents::integer;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'ordinal', rn,
               'pct', (elem ->> 'pct')::numeric,
               'amountCents', (elem ->> 'amountCents')::bigint,
               'dueAt', elem ->> 'dueAt'
             )
             ORDER BY rn
           ), '[]'::jsonb)
      INTO v_unioned
      FROM (
        SELECT elem,
               row_number() OVER (
                 ORDER BY (elem ->> 'dueAt') ASC, (elem ->> 'sourceOrdinal')::int ASC
               ) AS rn
        FROM jsonb_array_elements(v_unioned) AS elem
      ) ranked;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END,
    v_pricing_mode
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', CASE
      WHEN v_any_installments THEN
        jsonb_build_object(
          'fullPriceCents', v_full_price_cents,
          'depositCents', v_due_today_cents,
          'currency', trim(v_currency),
          'installments', v_unioned
        )
      ELSE NULL
    END
  );
END;
$function$;

-- ===========================================================================
-- §7b — issue_1930_ticket_session_authorized (copied from 20270420002160;
-- three hunks). Its grants are unchanged by CREATE OR REPLACE.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      OR (v_per_occurrence AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;

-- ===========================================================================
-- §8 — pg_direct_event_checkout_bundle (copied from 20270609002879; five hunks)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_direct_event_checkout_bundle(p_event_id uuid DEFAULT NULL::uuid, p_brand_slug text DEFAULT NULL::text, p_event_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH ev AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug              AS event_slug,
      e.event_type,
      e.location_text,
      e.online_url,
      e.is_online,
      e.status,
      e.published_at,
      e.timezone,
      e.currency,
      -- issue #2160 DELTA 1 of 3. See the note above the appended keys.
      e.is_multi_date,
      e.is_recurring,
      e.multi_date_pricing_mode,
      -- issue #3313 — the stored rule, and the one day-choice predicate.
      e.recurrence_rules,
      public.issue_3313_event_day_choice(e.id) AS day_choice,
      e.cover_media_url,
      e.cover_media_type,
      e.cover_media_provider,
      e.cover_media_source_url,
      e.cover_media_credit,
      e.cover_media_credit_url,
      e.cover_media_alt,
      e.cover_media_gallery,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.city,
      e.location_geo,
      e.city_geo,
      e.theme_color_override,
      e.theme_font_override,
      e.theme_animation_override,
      public.issue_2489_public_theme(e.theme) AS public_theme,
      ed.start_at AS master_start_at,
      ed.end_at   AS master_end_at,
      ed.timezone AS master_timezone,
      -- hide_address_until_ticket lives in theme.business_event (jsonb), not a
      -- real column. Default TRUE when absent — mirrors the service mapper
      -- (publicEventViewRowToEvent: asBoolean(..., true)) so a legacy row never
      -- leaks the street.
      public.issue_2489_address_withheld(e.theme) AS hide_address_until_ticket,
      b.id            AS brand_id_b,
      b.slug          AS brand_slug,
      b.name          AS brand_name,
      b.address       AS brand_address,
      b.cover_media_url AS brand_cover_media_url,
      b.profile_photo_url AS brand_profile_photo_url,
      b.theme_color   AS brand_theme_color,
      b.theme_font    AS brand_theme_font,
      b.theme_animation AS brand_theme_animation,
      COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
      COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed
           ON ed.event_id = e.id AND ed.is_master = true
    WHERE (
      (p_event_id IS NOT NULL AND p_brand_slug IS NULL AND p_event_slug IS NULL AND e.id = p_event_id)
      OR
      (p_event_id IS NULL
       AND NULLIF(pg_catalog.btrim(p_brand_slug), '') IS NOT NULL
       AND NULLIF(pg_catalog.btrim(p_event_slug), '') IS NOT NULL
       AND b.slug = p_brand_slug
       AND e.slug = p_event_slug)
    )
      AND e.event_type = 'event'
      -- issue #2160 DELTA 2 of 3 — WITHDRAWN. The literal predicate STAYS.
      --
      -- This clause was briefly `pg_offering_visibility_gate(e.visibility,
      -- e.deleted_at, 'direct')`, to make the SPEC's demanded end state
      -- (T-14 / I-PROPOSED-2117-ONE-OFFERING-VISIBILITY-GATE) true — the SPEC
      -- asserted the gate was ALREADY here and it was not. The substitution was
      -- behaviour-identical and proved so. It is withdrawn anyway, because it
      -- is STRUCTURALLY UNAVAILABLE to any migration that lands after #2117:
      --
      --   The #2117 offering-visibility-gate workflow under `.github/workflows/`
      --   (filename ends `issue-2117-offering-visibility-gate-tests`; the
      --   extension is omitted ON PURPOSE — `validate-manifest-v2.mjs:796`
      --   discovers CI dependencies by scanning EVERY non-workflow file for
      --   `/[A-Za-z0-9_.-]+\.ya?ml/`, comments included, so spelling it in full
      --   here registers this migration as a consumer of that workflow and
      --   drifts the reference inventory. It failed exactly that way in CI.
      --   This file is not a consumer of it; it only explains a decision.)
      --   applies THE WHOLE CHAIN EXCEPT #2117, captures the A-SC-9 baseline,
      --   then applies #2117. Calling the gate makes this file fail phase 1
      --   with "function public.pg_offering_visibility_gate(...) does not
      --   exist" — a `LANGUAGE sql` body is validated at CREATE time. Moving
      --   this file to phase 2 fixes that and then fails A-SC-9(a), because
      --   §H's `authenticated` grant is no longer in the BEFORE snapshot and
      --   is reported as having "arrived" with #2117.
      --
      -- Both constraints cannot hold at once, so the gate is not reusable by
      -- anything downstream of it until that lane's baseline capture is
      -- restructured. That is #2117's own decision to make, not this issue's,
      -- and it is recorded in the implementation report rather than worked
      -- around here: a payment-adjacent public reader is the wrong place to
      -- carry a CI-shaped compromise.
      --
      -- The literal below is what #1929/#1931 shipped and is byte-identical to
      -- what the gate would have returned for audience 'direct'.
      AND e.visibility IN ('public'::text, 'hidden'::text)
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    LIMIT 1
  ),
  tix AS (
    SELECT
      tt.id,
      tt.name,
      tt.description,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.is_unlimited,
      tt.is_free,
      tt.sale_start_at,
      tt.sale_end_at,
      tt.is_hidden,
      tt.is_disabled,
      tt.requires_approval,
      tt.password_protected,
      tt.available_online,
      tt.available_in_person,
      tt.waitlist_enabled,
      tt.display_order,
      -- issue #2462 — THE ORGANISER'S PURCHASE RULES. Absent from this reader
      -- since #1929, which is why `directBundleTicketToStub` fabricated
      -- `minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true`: it had
      -- nothing to map. The server has always enforced them, so the cart let a
      -- guest pick a quantity the RPC then refused with
      -- `ticket_quantity_above_max` -> "Nothing was reserved - please try again",
      -- a permanent dead end. DELETE THESE THREE LINES and that returns.
      tt.min_purchase_qty,
      tt.max_purchase_qty,
      tt.allow_transfers,
      -- server all-in (WYSIWYP) — SAME compute_all_in_cents single owner as
      -- pg_public_event_tier_allin. Free / zero-price tier → 0.
      CASE
        WHEN COALESCE(tt.is_free, false) OR COALESCE(tt.price_cents, 0) = 0 THEN 0
        ELSE public.compute_all_in_cents(
               tt.price_cents,
               ev.pass_mingla_fee,
               ev.pass_service_fee,
               (SELECT r.effective_take_rate_bps
                  FROM public.resolve_effective_take_rate_bps(ev.brand_id) AS r)
             )
      END AS all_in_cents,
      -- remaining capacity (GREATEST(total - sold, 0)); NULL for unlimited.
      -- Sold formula matches pg_public_ticket_types_remaining (ORCH-0946) EXACTLY:
      -- COUNT of tickets rows with status IN ('valid','used','transferred').
      CASE
        WHEN COALESCE(tt.is_unlimited, false) THEN NULL
        WHEN tt.quantity_total IS NULL THEN NULL
        -- issue #3313 — per-night capacity: the most places any UPCOMING night
        -- still has, from the same per-night counter the checkout guard reads
        -- (ONE OWNER FOR CAPACITY). "Sold out" only when every night is full.
        WHEN COALESCE((ev.day_choice ->> 'perOccurrenceCapacity')::boolean, false)
             AND EXISTS (
               SELECT 1 FROM public.event_dates d
                WHERE d.event_id = ev.id AND d.end_at > now()
             )
          THEN (
            SELECT GREATEST(0, MAX(
                     tt.quantity_total
                     - public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id)
                   ))
              FROM public.event_dates d
             WHERE d.event_id = ev.id AND d.end_at > now()
          )
        ELSE GREATEST(
          0,
          tt.quantity_total
            -- issue #2491 C2 step 4 — the same switch as the guard, on the READ
            -- path. This subquery ran once per ticket type PER PAGE VIEW, and at
            -- 100k sold that is ~18.7 ms of database time for every person merely
            -- LOOKING at the event. Page views arrive before reservations and
            -- outnumber them, so this is the larger volume problem of the two.
            -- Switched to the same column the guard now reads, so the advertised
            -- number and the enforced number remain ONE OWNER FOR CAPACITY (#2462).
            - COALESCE(tt.sold_count, 0)
            -- issue #2462 — IN-FLIGHT HOLDS COUNT. This subtrahend is byte-for-byte
            -- the `v_reserved` the capacity guard in
            -- issue_1930_ticket_checkout_create_session_base already applies. Without
            -- it the page advertises stock the server has committed: measured on
            -- production, 5 concurrent holds moved the guard by 5 and moved this
            -- number by 0 (229 -> 229). At low traffic v_reserved is ~0 so the two
            -- agree and the divergence is invisible; under load the guest reads
            -- "N available" and is refused as sold out. ONE OWNER FOR CAPACITY.
            - COALESCE((
                SELECT SUM(i.quantity)::integer
                FROM public.ticket_checkout_session_items i
                JOIN public.ticket_checkout_sessions s
                  ON s.id = i.checkout_session_id
                WHERE i.ticket_type_id = tt.id
                  AND s.expires_at > now()
                  AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
              ), 0)
        )
      END AS remaining
    FROM public.ticket_types tt
    JOIN ev ON ev.id = tt.event_id
    WHERE tt.deleted_at IS NULL
      AND tt.available_online = true
  )
  SELECT
    CASE WHEN ev.id IS NULL THEN NULL ELSE pg_catalog.json_build_object(
      'id', ev.id,
      'brandId', ev.brand_id,
      'brandSlug', ev.brand_slug,
      'eventSlug', ev.event_slug,
      'name', ev.title,
      'description', COALESCE(ev.description, ''),
      'masterStartAt', ev.master_start_at,
      'masterEndAt', ev.master_end_at,
      'timezone', COALESCE(ev.master_timezone, ev.timezone),
      'status', ev.status,
      'isOnline', ev.is_online,
      'onlineUrl', ev.online_url,
      'venueName', CASE
        WHEN ev.hide_address_until_ticket
          THEN NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), '')
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,venueName}'), ''), ev.location_text)
      END,
      -- PRIVACY: address + exact pin omitted (NULL) when the street is hidden.
      'address', CASE
        WHEN ev.hide_address_until_ticket THEN NULL
        ELSE COALESCE(NULLIF((ev.public_theme #>> '{business_event,location,address}'), ''), ev.location_text)
      END,
      'hideAddressUntilTicket', ev.hide_address_until_ticket,
      'format', (ev.public_theme #>> '{business_event,format}'),
      'city', ev.city,
      -- exact pin: NULL when hidden; else {lat,lng} from the point.
      'locationGeo', CASE
        WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.location_geo::public.geometry),
          'lng', public.ST_X(ev.location_geo::public.geometry)
        )
      END,
      -- city-level centroid: always returned when present (privacy-safe).
      'cityGeo', CASE
        WHEN ev.city_geo IS NULL THEN NULL
        ELSE pg_catalog.json_build_object(
          'lat', public.ST_Y(ev.city_geo),
          'lng', public.ST_X(ev.city_geo)
        )
      END,
      'coverMediaUrl', ev.cover_media_url,
      'coverMediaType', ev.cover_media_type,
      'coverGallery', COALESCE(ev.cover_media_gallery, '[]'::jsonb),
      'coverMediaProvider', ev.cover_media_provider,
      'coverMediaCredit', ev.cover_media_credit,
      'currency', COALESCE(ev.pricing_currency, ev.currency, 'usd'),
      'partyTypes', COALESCE(ev.party_types, ARRAY[]::text[]),
      'vibeTags', COALESCE(ev.vibe_tags, ARRAY[]::text[]),
      'musicGenres', COALESCE(ev.music_genres, ARRAY[]::text[]),
      'themeColorOverride', ev.theme_color_override,
      'themeFontOverride', ev.theme_font_override,
      'themeAnimationOverride', ev.theme_animation_override,
      'brand', pg_catalog.json_build_object(
        'id', ev.brand_id_b,
        'slug', ev.brand_slug,
        'name', ev.brand_name,
        'address', ev.brand_address,
        'coverMediaUrl', ev.brand_cover_media_url,
        'profilePhotoUrl', ev.brand_profile_photo_url,
        'themeColor', ev.brand_theme_color,
        'themeFont', ev.brand_theme_font,
        'themeAnimation', ev.brand_theme_animation
      ),
      'tickets', COALESCE((
        SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
          'id', tix.id,
          'name', tix.name,
          'description', tix.description,
          'priceCents', tix.price_cents,
          'allInCents', tix.all_in_cents,
          'currency', tix.currency,
          'capacity', tix.quantity_total,
          'remaining', tix.remaining,
          'isUnlimited', tix.is_unlimited,
          'isFree', tix.is_free,
          'saleStartAt', tix.sale_start_at,
          'saleEndAt', tix.sale_end_at,
          'isHidden', tix.is_hidden,
          'isDisabled', tix.is_disabled,
          'requiresApproval', tix.requires_approval,
          'passwordProtected', tix.password_protected,
          'availableOnline', tix.available_online,
          'availableInPerson', tix.available_in_person,
          'waitlistEnabled', tix.waitlist_enabled,
          'displayOrder', tix.display_order,
          -- issue #2462 — APPENDED LAST so CREATE OR REPLACE preserves every
          -- pre-existing key name and order (house rule, …1931…:735-740).
          'minPurchaseQty', tix.min_purchase_qty,
          'maxPurchaseQty', tix.max_purchase_qty,
          'allowTransfers', tix.allow_transfers
        ) ORDER BY tix.display_order ASC)
        FROM tix
      ), '[]'::json),
      -- ══ issue #2160 DELTA 3 of 3 — APPENDED LAST ═══════════════════════
      -- Appended after every pre-existing key so CREATE OR REPLACE preserves
      -- each existing key's name AND order (the house rule at …1931…:735-740).
      --
      -- `occurrences` (SPEC §F / D-4, closes #2161). The occurrence list now
      -- travels on the SAME SECURITY DEFINER reader that served the event, so
      -- ONE authority decides who may see this event and its schedule. The
      -- direct `.from("event_dates")` read in publicEventOccurrencesService is
      -- deleted in the same change: a guest surface must never read that table
      -- again (I-PROPOSED-2160-D). Costs zero extra round trips.
      --
      -- NO `ticketsRemaining` KEY, DELIBERATELY. `event_dates` has no capacity
      -- column and capacity is authored event-level on ticket_types.quantity_
      -- total, so there is no honest per-day remaining. Stamping the
      -- event-level number onto each day would claim per-day availability that
      -- does not exist (Constitution #9).
      'occurrences', (
        SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                 'id',        d.id,
                 'startAt',   d.start_at,
                 'endAt',     d.end_at,
                 'timezone',  d.timezone,
                 'isMaster',  d.is_master
               ) ORDER BY d.start_at, d.id), '[]'::json)
          FROM public.event_dates d
         WHERE d.event_id = ev.id
           -- issue #3313 — a recurring event offers only nights still ahead,
           -- which keeps `isMultiDate === (occurrences.length > 1)` true (the
           -- shipped native shape check). Multi-date events are unchanged.
           AND (NOT (COALESCE(ev.is_recurring, false) AND NOT COALESCE(ev.is_multi_date, false))
                OR d.end_at > now())
      ),
      -- THE MULTI-DATE SIGNAL. Without these two keys the day chooser is
      -- UNREACHABLE, and it was: `detailFromDirectBundle` hard-codes
      -- `is_multi_date: false`, this bundle is the FIRST reader consulted by
      -- both getPublicEventBySlug and getPublicEventById, and the bundle
      -- carried no multi-date key — so `asWhenMode` resolved every
      -- bundle-served ticketed event to 'single' and #2135's chooser never
      -- mounted, on PUBLIC events as well as unlisted ones. #2161 diagnosed
      -- this as "works for public, silently empty for unlisted"; measured on
      -- the full migration chain, it worked for neither. See the
      -- implementation report.
      --
      -- `isRecurring` rides along because the gate is `multi_date` ONLY —
      -- deriving multi-date from `occurrences.length > 1` would sweep in
      -- recurring events, which #2145 keeps out of scope.
      -- issue #3313 — `isMultiDate` now means "the guest must pick a day":
      -- unchanged for multi-date events, and true for a recurring event while
      -- more than one night is ahead. Every shipped client already mounts the
      -- day chooser from this key, so recurring events get it with no release.
      'isMultiDate', COALESCE((ev.day_choice ->> 'requiresChoice')::boolean, false),
      'isRecurring', COALESCE(ev.is_recurring, false),
      -- The organiser's pricing choice, so the page can say "per day" or
      -- "for all days" BEFORE the guest sees a total (amendment §7).
      'multiDatePricingMode', COALESCE(ev.multi_date_pricing_mode, 'per_day'),
      -- issue #3313 — APPENDED LAST. The stored repeat rule, so the public page
      -- can say "Every Tuesday" over the real dates instead of "Recurring
      -- (incomplete)".
      'recurrenceRule', CASE
        WHEN COALESCE(ev.is_recurring, false) AND jsonb_typeof(ev.recurrence_rules) = 'object'
          THEN ev.recurrence_rules
        ELSE NULL
      END
    ) END
  FROM ev;
$function$;

-- ===========================================================================
-- §9 — business_patch_event_ticket_tiers (copied from 20270526002590; two hunks)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.business_patch_event_ticket_tiers(p_event_id uuid, p_tiers jsonb, p_expected_event_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expected_client_revision integer DEFAULT NULL::integer, p_operation_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_tiers jsonb;
  v_tier jsonb;
  v_existing public.ticket_types%ROWTYPE;
  v_current_revision integer;
  v_next_revision integer;
  v_sold integer;
  v_currency char(3);
  v_password_hash text;
  v_result_tiers jsonb;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_event_id IS NULL OR p_tiers IS NULL THEN RAISE EXCEPTION 'invalid_ticket_tiers'; END IF;
  IF p_operation_id IS NOT NULL AND p_operation_id::text = '' THEN RAISE EXCEPTION 'invalid_operation_id'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.event_type NOT IN ('event','experience') THEN RAISE EXCEPTION 'event_ticket_type_unsupported'; END IF;
  IF v_event.status NOT IN ('draft','scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF p_expected_event_updated_at IS NOT NULL AND v_event.updated_at IS DISTINCT FROM p_expected_event_updated_at THEN
    RAISE EXCEPTION 'stale_event_revision';
  END IF;

  v_tiers := public.issue_1974_normalize_ticket_tiers(p_tiers);
  SELECT upper(COALESCE(v_event.currency::text,sca.default_currency::text,b.default_currency::text))::char(3)
    INTO v_currency
    FROM public.brands b
    LEFT JOIN public.stripe_connect_accounts sca ON sca.brand_id=b.id AND sca.detached_at IS NULL
   WHERE b.id=v_event.brand_id;

  IF v_currency IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_tiers) t
    WHERE NOT COALESCE((t->>'isFree')::boolean,false)
      AND round((t->>'priceGbp')::numeric*100)>0
  ) THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  IF v_event.status='draft' THEN
    v_current_revision := COALESCE(NULLIF(v_event.theme->'business_draft'->>'clientRevision','')::integer,0);
    IF p_expected_client_revision IS NULL OR p_expected_client_revision <> v_current_revision THEN
      RAISE EXCEPTION 'stale_client_revision';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'draft_ticket_projection_conflict';
    END IF;
    -- A draft tier id belongs only to the draft JSON graph. Reusing an id from
    -- any live ticket or from the separate trip-pricing graph would make the
    -- caller's lifecycle intent ambiguous and can poison deterministic retry.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      WHERE EXISTS (
              SELECT 1 FROM public.ticket_types tt
              WHERE tt.id=CASE
                WHEN (t->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (t->>'id')::uuid ELSE NULL END
            )
         OR EXISTS (
              SELECT 1 FROM public.trip_pricing_tiers trip
              WHERE trip.id=CASE
                WHEN (t->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (t->>'id')::uuid ELSE NULL END
            )
    ) THEN RAISE EXCEPTION 'ticket_lifecycle_mismatch'; END IF;
    -- Collection readiness is required only for a new or newly-paid tier. An
    -- unrelated edit to an already-paid tier must not become hostage to a later
    -- provider disconnect; checkout remains independently fail closed.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_tiers) t
      LEFT JOIN LATERAL (
        SELECT old_tier
        FROM jsonb_array_elements(COALESCE(v_event.theme->'business_draft'->'tickets','[]'::jsonb)) old_tier
        WHERE old_tier->>'id'=t->>'id'
        LIMIT 1
      ) previous ON true
      WHERE NOT (t->>'isFree')::boolean
        AND (previous.old_tier IS NULL OR COALESCE((previous.old_tier->>'isFree')::boolean,true))
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      RAISE EXCEPTION 'payout_not_ready';
    END IF;
    v_next_revision := v_current_revision+1;
    UPDATE public.events
       SET theme=jsonb_set(
             COALESCE(theme,'{}'::jsonb),
             '{business_draft}',
             COALESCE(theme->'business_draft','{}'::jsonb) || jsonb_build_object(
               'tickets',v_tiers,
               'clientRevision',v_next_revision
             ),
             true
           ),
           currency=CASE WHEN EXISTS(
             SELECT 1 FROM jsonb_array_elements(v_tiers) t
             WHERE NOT COALESCE((t->>'isFree')::boolean,false)
           ) THEN v_currency ELSE currency END,
           updated_at=now()
     WHERE id=p_event_id;
  ELSE
    IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'invalid_edit_reason';
    END IF;

    -- Business creates new client-side tiers with the established `t_*`
    -- temporary identity. Resolve those markers inside this transaction before
    -- validating or writing the graph; any other malformed identity remains a
    -- hard failure. The #1972 client revision gate makes an ambiguous retry
    -- stale instead of creating a second row.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      WHERE (t->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (t->>'id') !~ '^t_[a-z0-9]+$'
    ) THEN RAISE EXCEPTION 'live_ticket_id_must_be_uuid'; END IF;
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN tier->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN tier
        ELSE jsonb_set(tier,'{id}',to_jsonb(gen_random_uuid()::text),false)
      END
      ORDER BY ordinality
    ),'[]'::jsonb)
    INTO v_tiers
    FROM jsonb_array_elements(v_tiers) WITH ORDINALITY rows(tier,ordinality);

    -- Supplied ids may be new or belong to this event, never another graph.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      JOIN public.ticket_types tt ON tt.id=(t->>'id')::uuid
      WHERE tt.event_id<>p_event_id OR tt.deleted_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'ticket_event_mismatch'; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tiers) t
      JOIN public.trip_pricing_tiers trip ON trip.id=(t->>'id')::uuid
    ) THEN RAISE EXCEPTION 'ticket_lifecycle_mismatch'; END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_tiers) t
      LEFT JOIN public.ticket_types existing_tier
        ON existing_tier.id=(t->>'id')::uuid AND existing_tier.event_id=p_event_id AND existing_tier.deleted_at IS NULL
      WHERE NOT (t->>'isFree')::boolean
        AND (existing_tier.id IS NULL OR existing_tier.is_free)
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      RAISE EXCEPTION 'payout_not_ready';
    END IF;

    -- Removed tiers are soft-deleted only when no ticket has ever been issued.
    FOR v_existing IN
      SELECT * FROM public.ticket_types tt
      WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tiers) t WHERE (t->>'id')::uuid=tt.id)
      FOR UPDATE
    LOOP
      SELECT count(*)::integer INTO v_sold FROM public.tickets tk
      WHERE tk.ticket_type_id=v_existing.id AND tk.status IN ('valid','used','transferred');
      IF v_sold>0 THEN RAISE EXCEPTION 'tier_delete_with_sales'; END IF;
      UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE id=v_existing.id;
    END LOOP;

    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_tiers)
    LOOP
      SELECT * INTO v_existing FROM public.ticket_types
      WHERE id=(v_tier->>'id')::uuid AND event_id=p_event_id AND deleted_at IS NULL FOR UPDATE;
      IF FOUND THEN
        SELECT count(*)::integer INTO v_sold FROM public.tickets tk
        WHERE tk.ticket_type_id=v_existing.id AND tk.status IN ('valid','used','transferred');
        -- issue #3313 — on a recurring event capacity is PER NIGHT, so the
        -- floor below is the BUSIEST night's issued passes, not the run's
        -- total. v_sold stays > 0 exactly when any pass is live, so the price
        -- and free/paid locks are unchanged.
        IF v_sold > 0 THEN
          IF v_per_occurrence IS NULL THEN
            v_per_occurrence := COALESCE(
              (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean,
              false);
          END IF;
          IF v_per_occurrence THEN
            SELECT COALESCE(MAX(public.issue_3313_ticket_type_occurrence_sold(v_existing.id, d.id)), v_sold)
              INTO v_sold
              FROM public.event_dates d
             WHERE d.event_id = p_event_id;
          END IF;
        END IF;
        -- ══ issue #2590 — THE LOCK NOW COVERS ONLY WHAT IT PROTECTS ═══════
        -- This guard froze EIGHT things the moment a single ticket sold. Three
        -- of them genuinely change a deal an existing holder already accepted.
        -- The other five took nothing away from anyone, and freezing them turned
        -- an ordinary correction into a permanent mistake.
        --
        -- Proven on a live event: We Go Again Exhibition's sales were set to
        -- close 07:00 on the morning of Day 2 — six hours BEFORE doors — almost
        -- certainly 19:00 misread on a 12-hour picker. 124 tickets had sold, so
        -- the organiser could not correct it from the product at all. Every
        -- attempt raised here, and the screen redrew the old value with no
        -- message (`sold_ticket_mutation_blocked` has no organiser copy).
        --
        -- STILL LOCKED, and each for the same reason — it rewrites a deal
        -- somebody already accepted:
        --   * price_cents  — what they agreed to pay
        --   * is_free      — whether they agreed to pay at all
        --   * capacity     — only BELOW the number already issued, which would
        --                    invalidate real tickets. Raising it stays free.
        --
        -- NO LONGER LOCKED, because an issued ticket is unaffected by any of it:
        --   * is_hidden / is_disabled — hiding or pausing a tier stops FUTURE
        --     sales. Pausing mid-event is an ordinary operational need, and the
        --     holders keep their tickets either way.
        --   * available_online — same shape. Turning it off stops future online
        --     sales; turning it on harms nobody. The client warns on the
        --     off direction rather than the server refusing it.
        --   * sale_start_at / sale_end_at — when the window opens and closes.
        --     Moving it cannot reach backwards and un-issue a ticket.
        --
        -- Deleting a tier with sales is still refused, above, by
        -- `tier_delete_with_sales`. That one does destroy real tickets.
        --
        -- DELETE THE THREE REMAINING CLAUSES and a sold-out tier's price becomes
        -- editable, which is the defect this guard exists to prevent.
        IF v_sold>0 AND (
          v_existing.price_cents IS DISTINCT FROM CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END OR
          v_existing.is_free IS DISTINCT FROM (v_tier->>'isFree')::boolean OR
          COALESCE((v_tier->>'capacity')::integer,2147483647)<v_sold
        ) THEN RAISE EXCEPTION 'sold_ticket_mutation_blocked'; END IF;
        IF (v_tier->>'passwordProtected')::boolean AND v_existing.password_hash IS NULL THEN
          RAISE EXCEPTION 'ticket_password_setup_required';
        END IF;
        v_password_hash:=v_existing.password_hash;
        UPDATE public.ticket_types SET
          name=v_tier->>'name',description=NULLIF(v_tier->>'description',''),
          price_cents=CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END,
          currency=CASE WHEN (v_tier->>'isFree')::boolean THEN v_existing.currency ELSE v_currency END,
          quantity_total=NULLIF(v_tier->>'capacity','')::integer,is_unlimited=(v_tier->>'isUnlimited')::boolean,
          is_free=(v_tier->>'isFree')::boolean,sale_start_at=NULLIF(v_tier->>'saleStartAt','')::timestamptz,
          sale_end_at=NULLIF(v_tier->>'saleEndAt','')::timestamptz,min_purchase_qty=(v_tier->>'minPurchaseQty')::integer,
          max_purchase_qty=NULLIF(v_tier->>'maxPurchaseQty','')::integer,is_hidden=(v_tier->>'visibility')='hidden',
          is_disabled=(v_tier->>'visibility')='disabled',requires_approval=(v_tier->>'approvalRequired')::boolean,
          allow_transfers=(v_tier->>'allowTransfers')::boolean,password_protected=(v_tier->>'passwordProtected')::boolean,
          password_hash=v_password_hash,available_online=(v_tier->>'availableAt') IN ('online','both'),
          available_in_person=(v_tier->>'availableAt') IN ('door','both'),waitlist_enabled=(v_tier->>'waitlistEnabled')::boolean,
          display_order=(v_tier->>'displayOrder')::integer,updated_at=now()
        WHERE id=v_existing.id;
      ELSE
        IF (v_tier->>'passwordProtected')::boolean THEN RAISE EXCEPTION 'ticket_password_setup_required'; END IF;
        INSERT INTO public.ticket_types(
          id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,
          sale_start_at,sale_end_at,min_purchase_qty,max_purchase_qty,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,available_online,available_in_person,
          waitlist_enabled,display_order
        ) VALUES (
          (v_tier->>'id')::uuid,p_event_id,v_tier->>'name',NULLIF(v_tier->>'description',''),
          CASE WHEN (v_tier->>'isFree')::boolean THEN 0 ELSE round((v_tier->>'priceGbp')::numeric*100)::integer END,
          CASE WHEN (v_tier->>'isFree')::boolean THEN NULL ELSE v_currency END,NULLIF(v_tier->>'capacity','')::integer,
          (v_tier->>'isUnlimited')::boolean,(v_tier->>'isFree')::boolean,NULLIF(v_tier->>'saleStartAt','')::timestamptz,
          NULLIF(v_tier->>'saleEndAt','')::timestamptz,(v_tier->>'minPurchaseQty')::integer,
          NULLIF(v_tier->>'maxPurchaseQty','')::integer,(v_tier->>'visibility')='hidden',(v_tier->>'visibility')='disabled',
          (v_tier->>'approvalRequired')::boolean,(v_tier->>'allowTransfers')::boolean,false,
          (v_tier->>'availableAt') IN ('online','both'),(v_tier->>'availableAt') IN ('door','both'),
          (v_tier->>'waitlistEnabled')::boolean,(v_tier->>'displayOrder')::integer
        );
      END IF;
    END LOOP;
    UPDATE public.events SET updated_at=now() WHERE id=p_event_id;
  END IF;

  SELECT e.currency INTO v_currency FROM public.events e WHERE e.id=p_event_id;
  IF v_event.status='draft' THEN
    SELECT e.theme->'business_draft'->'tickets' INTO v_result_tiers FROM public.events e WHERE e.id=p_event_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',tt.id::text,'name',tt.name,'isFree',tt.is_free,'isUnlimited',tt.is_unlimited,
      'priceGbp',CASE WHEN tt.is_free THEN NULL ELSE tt.price_cents::numeric/100 END,
      'capacity',tt.quantity_total,'visibility',CASE WHEN tt.is_hidden THEN 'hidden' WHEN tt.is_disabled THEN 'disabled' ELSE 'public' END,
      'displayOrder',tt.display_order,'approvalRequired',tt.requires_approval,'passwordProtected',tt.password_protected,
      'passwordConfigured',tt.password_hash IS NOT NULL,'waitlistEnabled',tt.waitlist_enabled,
      'minPurchaseQty',tt.min_purchase_qty,'maxPurchaseQty',tt.max_purchase_qty,'allowTransfers',tt.allow_transfers,
      'description',tt.description,'saleStartAt',tt.sale_start_at,'saleEndAt',tt.sale_end_at,
      'availableAt',CASE WHEN tt.available_online AND tt.available_in_person THEN 'both' WHEN tt.available_in_person THEN 'door' ELSE 'online' END
    ) ORDER BY tt.display_order),'[]'::jsonb) INTO v_result_tiers
    FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  END IF;
  RETURN jsonb_build_object(
    'event_id',p_event_id,'operation_id',p_operation_id,'representation',CASE WHEN v_event.status='draft' THEN 'draft' ELSE 'live' END,
    'effective_currency',v_currency,'tiers',v_result_tiers,
    'client_revision',CASE WHEN v_event.status='draft' THEN v_next_revision ELSE NULL END,
    'updated_at',(SELECT updated_at FROM public.events WHERE id=p_event_id)
  );
END;
$function$;

-- ===========================================================================
-- §10 — Self-verify. Fails the migration if the post-state drifted.
-- ===========================================================================
DO $probe$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.business_publish_event_draft(uuid,jsonb,integer)'::regprocedure);
  IF position('pg_expand_experience_recurrence(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: recurring publish no longer expands its rule';
  END IF;
  IF position('offering_date_past' IN v_def) = 0 OR position('stripe_charges_disabled' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: publish lost an ORCH-1075 guard';
  END IF;

  v_def := pg_get_functiondef('public.business_patch_event_when(uuid,jsonb,text,integer)'::regprocedure);
  IF position('issue_3313_recurrence_occurrences(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: a recurring edit is back to one target';
  END IF;
  IF position('issue_3285_event_date_hold_reason(' IN v_def) = 0 OR position('offering_date_past' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: the patch lost a #3285 or ORCH-1075 rule';
  END IF;
  IF v_def ~* 'DELETE\s+FROM\s+public\.event_dates\s+WHERE\s+event_id\s*=\s*p_event_id' THEN
    RAISE EXCEPTION 'issue #3313 probe: the patch deletes every occurrence again';
  END IF;

  v_def := pg_get_functiondef('public.issue_1930_ticket_checkout_create_session_base'::regproc);
  IF position('event_date_choice_required' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: checkout can finish without a night again';
  END IF;
  IF position('issue_3313_ticket_type_occurrence_taken(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: capacity is no longer checked per night';
  END IF;
  IF position('v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: the shared capacity check for every other event is gone';
  END IF;

  v_def := pg_get_functiondef('public.issue_1930_ticket_session_authorized(uuid,uuid)'::regprocedure);
  IF position('issue_3313_ticket_type_occurrence_taken(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: finalize re-checks capacity across the whole run again';
  END IF;

  v_def := pg_get_functiondef('public.pg_direct_event_checkout_bundle'::regproc);
  IF position('issue_3313_event_day_choice(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: the public reader no longer uses the day-choice predicate';
  END IF;

  v_def := pg_get_functiondef('public.business_patch_event_ticket_tiers'::regproc);
  IF position('issue_3313_ticket_type_occurrence_sold(' IN v_def) = 0 OR position('<v_sold' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3313 probe: the per-night capacity floor is gone';
  END IF;

  IF has_function_privilege('anon', 'public.issue_3313_event_day_choice(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3313_ticket_type_occurrence_taken(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3313_topup_recurring_events(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3313 probe: an internal #3313 function is anon-executable';
  END IF;
END
$probe$;

COMMIT;

NOTIFY pgrst, 'reload schema';
