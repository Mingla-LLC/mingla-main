-- issue #3285 — editing a live multi-day event's dates must never strip sold
-- passes of their days, null the payout anchor, or erase the admitting day.
--
-- ── THE DEFECT (proved against production, 2026-09-12) ─────────────────────
-- business_patch_event_when (last body: 20260911000000_orch_1075_paid_publish_
-- integrity_guards.sql; production md5 6782326a5c05f7575992662b773d69d5 equals
-- that body byte for byte) ran `DELETE` over every event_dates row of the event
-- and re-inserted all of them with NEW ids on every When save. Its sold-ticket
-- guard in multi_date mode only refused a calendar date MISSING from the
-- payload, so adding a day or retiming one saved. What pointed at the old ids:
--   ticket_event_dates.event_date_id  ON DELETE CASCADE  -> the pass loses every
--                                      day and admits on ANY day (#2160 model)
--   orders.event_date_id              ON DELETE SET NULL -> payout anchor lost
--   scan_events.event_date_id         ON DELETE SET NULL -> in practice the
--                                      save FAILS instead: the SET NULL is an
--                                      update, and biz_scan_events_block_mutate
--                                      refuses any scan_events update while
--                                      auth.uid() is set ("append-only for
--                                      clients"). So the damage window is every
--                                      multi-day event between its first sale
--                                      and its first door scan.
-- #2160 chose CASCADE on the stated assumption that deleting a published
-- occurrence was "guarded elsewhere". It was guarded for removal only.
-- Executed repro on the production body: 2 day-bound passes, 2 anchored orders,
-- 1 success scan; organiser adds a Monday ->
--   AFTER: ted=0 orders_anchored=0 scans_with_day=0 sat_id_survived=f
-- Production had NOT been hit: zero orders, tickets, scans or checkout sessions
-- predate the current event_dates rows of any event. No repair is needed and
-- this migration performs none.
--
-- ── WHAT THIS MIGRATION DOES ───────────────────────────────────────────────
--   §1 public.issue_3285_event_date_hold_reason(uuid) — the ONE definition of
--      "something still holds this occurrence". Day-scoped ticket types
--      (#3282) extend THIS function, in a CREATE OR REPLACE, and key their own
--      FK with ON DELETE RESTRICT.
--   §2 ticket_event_dates.event_date_id: CASCADE -> RESTRICT. The database
--      itself now refuses to orphan a pass's day. (NO ACTION was measured and
--      rejected: on PG17 both refuse a whole-event hard delete under this
--      multi-path cascade, so it buys nothing; RESTRICT matches
--      brand_payout_releases_event_date_id_fkey.)
--      ticket_checkout_session_event_dates stays CASCADE: deleting a date
--      revokes every in-flight session of the event in the same statement
--      (issue_1930_event_dates_revoke), and RESTRICT would make a date
--      unremovable once anyone had abandoned a checkout for it.
--      orders / scan_events stay SET NULL here: biz_update_live_experience
--      still deletes-and-reinserts, so tightening those FKs now would make
--      every live edit of a sold experience fail. Sold anchors on EVENTS are
--      protected by §3 (held occurrences are never deleted).
--   §3 business_patch_event_when: steps 1-9, the ORCH-1075 Guard B and the
--      return shape are VERBATIM. Step 10 reconciles in place (see the body).
--      New guards: a multi-date retime with sales and no "Refund all &
--      proceed" raises schedule_change_with_sales (the multi-date twin of
--      ORCH-1047); a held occurrence is never deleted, acknowledged or not.
--      No GRANT/REVOKE: CREATE OR REPLACE keeps the #2353 ACL.
--   §4 self-verify probe.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Re-apply the 1075 body and restore the CASCADE FK. Do not do the first
-- without understanding that it re-opens the defect above.

BEGIN;

-- ===========================================================================
-- §1 — "Held": something a guest, an organiser's payout or the door record
-- still points at. NULL = not held.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_3285_event_date_hold_reason(p_event_date_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- A live day-bound pass. 'refund_pending' is money in flight: still held.
    WHEN EXISTS (
      SELECT 1
        FROM public.ticket_event_dates ted
        JOIN public.tickets t ON t.id = ted.ticket_id
       WHERE ted.event_date_id = p_event_date_id
         AND t.status IN ('valid', 'used', 'transferred', 'refund_pending')
    ) THEN 'live_pass'
    -- A live payout/refund anchor.
    WHEN EXISTS (
      SELECT 1
        FROM public.orders o
       WHERE o.event_date_id = p_event_date_id
         AND o.payment_status IN ('pending', 'paid', 'partial_refund')
    ) THEN 'live_order'
    -- The door has scanned against this day. scan_events is append-only for
    -- every authenticated caller (trigger biz_scan_events_block_mutate), and
    -- the SET NULL a delete would perform IS an update, so it would be refused
    -- with a raw trigger error anyway. Any scan row holds the day.
    WHEN EXISTS (
      SELECT 1
        FROM public.scan_events s
       WHERE s.event_date_id = p_event_date_id
    ) THEN 'scan_recorded'
    -- Money already released against this day (its FK is RESTRICT too).
    WHEN EXISTS (
      SELECT 1
        FROM public.brand_payout_releases b
       WHERE b.event_date_id = p_event_date_id
    ) THEN 'payout_release'
    ELSE NULL
  END
$function$;

REVOKE ALL ON FUNCTION public.issue_3285_event_date_hold_reason(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3285_event_date_hold_reason(uuid)
  TO service_role;

COMMENT ON FUNCTION public.issue_3285_event_date_hold_reason(uuid) IS
  'issue #3285 — the single definition of an event_dates occurrence that must '
  'not be deleted: a live day-bound pass (valid/used/transferred/refund_pending), '
  'a live order anchor (pending/paid/partial_refund), any door scan recorded '
  'against it (scan_events is append-only), or a payout release. Returns the '
  'reason or NULL. Any new '
  'table keyed on event_dates.id (e.g. #3282 day-scoped ticket types) must be '
  'added here AND key its FK with ON DELETE RESTRICT.';

-- ===========================================================================
-- §2 — The entitlement FK refuses instead of cascading.
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ticket_event_dates_event_date_id_fkey'
       AND conrelid = 'public.ticket_event_dates'::regclass
       AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE public.ticket_event_dates
      DROP CONSTRAINT ticket_event_dates_event_date_id_fkey,
      ADD CONSTRAINT ticket_event_dates_event_date_id_fkey
        FOREIGN KEY (event_date_id) REFERENCES public.event_dates(id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON CONSTRAINT ticket_event_dates_event_date_id_fkey ON public.ticket_event_dates IS
  'issue #3285 — ON DELETE RESTRICT (was CASCADE, #2160). A row here IS the '
  'entitlement: cascading it away turns a one-day pass into an any-day pass. '
  'The database refuses; writers must reconcile occurrences in place and may '
  'only delete a day nothing holds (issue_3285_event_date_hold_reason).';

-- ===========================================================================
-- §3 — business_patch_event_when, reconciling in place.
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
    v_t_dates := ARRAY[v_date_iso::date];
    v_t_starts := ARRAY[v_start];
    v_t_ends := ARRAY[v_end];

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
  IF v_sold_count > 0 AND NOT v_ack AND v_when_mode = 'multi_date' THEN
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
  UPDATE public.events
  SET
    timezone = v_timezone,
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

COMMENT ON FUNCTION public.business_patch_event_when(uuid, jsonb, text, integer) IS
  'ORCH-0877 + ORCH-1047 + ORCH-1075 + issue #3285 — patches a published '
  'event''s When section. #3285: event_dates are reconciled IN PLACE, never '
  'deleted and re-inserted. An occurrence matches its existing row by the same '
  'start instant, else the unique same local day, else (single/recurring) the '
  'one occurrence; matched rows keep their id, so pass days, the payout anchor '
  'and the admitting day survive every permitted edit. With sales and no '
  'acknowledgeSoldImpact, a multi-date removal raises '
  'multi_date_remove_with_sales and a multi-date retime raises '
  'schedule_change_with_sales; adding a day is allowed. A held occurrence '
  '(issue_3285_event_date_hold_reason) is never deleted, acknowledged or not. '
  'New codes: event_date_duplicate, event_date_match_ambiguous.';

-- ===========================================================================
-- §4 — Self-verify. Fails the migration if the post-state drifted.
-- ===========================================================================
DO $$
DECLARE
  v_def text;
BEGIN
  IF (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'ticket_event_dates_event_date_id_fkey'
         AND conrelid = 'public.ticket_event_dates'::regclass) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'issue #3285 probe: ticket_event_dates.event_date_id FK is not ON DELETE RESTRICT';
  END IF;
  IF (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'ticket_checkout_session_event_dates_event_date_id_fkey'
         AND conrelid = 'public.ticket_checkout_session_event_dates'::regclass) IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'issue #3285 probe: ticket_checkout_session_event_dates.event_date_id FK must stay CASCADE';
  END IF;
  v_def := pg_get_functiondef('public.business_patch_event_when(uuid,jsonb,text,integer)'::regprocedure);
  IF position('offering_date_past' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3285 probe: business_patch_event_when lost ORCH-1075 Guard B (offering_date_past)';
  END IF;
  IF position('issue_3285_event_date_hold_reason(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3285 probe: business_patch_event_when does not consult the held-occurrence rule';
  END IF;
  IF v_def ~* 'DELETE\s+FROM\s+public\.event_dates\s+WHERE\s+event_id\s*=\s*p_event_id' THEN
    RAISE EXCEPTION 'issue #3285 probe: business_patch_event_when still deletes every occurrence of the event';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
