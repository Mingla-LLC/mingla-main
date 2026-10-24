-- issue #3827 — scanner hotfix.
--
-- The deployed scanner invitation path selected a non-existent brands column,
-- while ticket scanning made current Host managers depend on an event_scanners
-- projection that is only created with the event. Keep explicit scanner grants,
-- but authorize current event_manager-or-higher brand authority directly.
--
CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  -- Grace constants — SPEC §3.1 Decision-1. Tuning outside [60min, 24h]
  -- requires SPEC review.
  c_grace_before constant interval := interval '120 minutes';
  c_grace_after  constant interval := interval '360 minutes';

  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
  v_scan_event_id uuid;
  v_has_event_dates boolean;
  v_in_window boolean;
  v_next_start timestamptz;
  v_last_end timestamptz;
  -- issue #2160 — the day ladder's locals.
  v_day_count integer := 0;      -- how many days this pass admits (0 = legacy)
  v_target_day uuid;             -- the occurrence being presented against NOW
  v_admitted_day uuid;           -- the occurrence actually admitted (success)
  v_all_days_consumed boolean;   -- no unadmitted day left after this one
  -- issue #3281 F-C
  v_booked_start timestamptz;
  v_booked_duration interval;
  v_order_event_type text;
  v_order_event_date_id uuid;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  -- issue #3827 hotfix: current Host authority is the source of truth.
  -- event_scanners remains the explicit per-event scanner grant; accepted
  -- brand-scoped scanner membership remains the cross-event grant. Owners,
  -- admins and event managers are authorized from their current brand rank so
  -- a stale auto-provisioned event_scanners projection cannot lock them out.
  IF NOT (
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_scanner_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_scanner_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
       WHERE e.id = p_event_id
         AND public.biz_brand_effective_rank(e.brand_id, p_scanner_user_id)
               >= public.biz_role_rank('event_manager'::text)
    )
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSE
      -- ══════════════════════════════════════════════════════════════════════
      -- issue #2160 — THE DAY LADDER. THIS IS THE SINGLE ENFORCEMENT SITE FOR
      -- "a pass is refused on a day it was not issued for, and a scan records
      -- which day it admitted". There must never be a second one.
      --
      -- A pass admits the days it has `ticket_event_dates` rows for. The ladder
      -- never asks which pricing mode minted it — per_day gives N passes with
      -- one row each, all_days gives one pass with N rows, and both are the
      -- same sentence here.
      --
      -- ⚠️  DELETE THE `v_day_count > 0` BRANCH and a guest who bought Saturday
      --     walks in on Sunday, and a Sunday guest is refused on Saturday.
      -- ══════════════════════════════════════════════════════════════════════
      SELECT count(*) INTO v_day_count
        FROM public.ticket_event_dates ted
       WHERE ted.ticket_id = v_ticket.id;

      IF v_day_count = 0 THEN
        -- ── LEGACY / SINGLE-DATE PATH. Byte-for-behaviour identical to
        --    pre-#2160, including the one-shot `status='used'` lifecycle. Every
        --    pass ever issued before this migration is on this path and stays
        --    on it: nothing is backfilled (§A.1).
        IF v_ticket.status = 'used' THEN
          v_scan_result := 'duplicate';
        ELSIF v_ticket.status <> 'valid' THEN
          v_scan_result := 'void';
        ELSE
          -- issue #3281 F-C — experience pass with a booked start: admit only
          -- inside [booked_start - grace, booked_start + duration + grace].
          -- Duration = the named date's length when present, else 2 hours.
          -- Legacy orders (NULL booked_start) keep the any-occurrence window.
          SELECT o.booked_start_at, e.event_type, o.event_date_id
            INTO v_booked_start, v_order_event_type, v_order_event_date_id
            FROM public.orders o
            JOIN public.events e ON e.id = o.event_id
           WHERE o.id = v_ticket.order_id;

          IF v_order_event_type = 'experience' AND v_booked_start IS NOT NULL THEN
            SELECT COALESCE(ed.end_at - ed.start_at, interval '2 hours')
              INTO v_booked_duration
              FROM public.event_dates ed
             WHERE ed.id = v_order_event_date_id;
            IF v_booked_duration IS NULL OR v_booked_duration < interval '2 hours' THEN
              v_booked_duration := interval '2 hours';
            END IF;

            IF now() BETWEEN (v_booked_start - c_grace_before)
                          AND (v_booked_start + v_booked_duration + c_grace_after) THEN
              v_scan_result := 'success';
              v_admitted_day := v_order_event_date_id;
            ELSIF now() < (v_booked_start - c_grace_before) THEN
              v_scan_result := 'not_yet_open';
              v_next_start := v_booked_start;
            ELSE
              v_scan_result := 'event_ended';
              v_last_end := v_booked_start + v_booked_duration;
            END IF;
          ELSE
            -- ORCH-0793 — event time-window check. Reads event_dates per
            -- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Multi-date events
            -- succeed if now() lies in ANY date row's grace-extended window
            -- (most-permissive policy — SPEC §3.1 Decision-2).
            SELECT EXISTS (
              SELECT 1 FROM public.event_dates ed
               WHERE ed.event_id = p_event_id
            ) INTO v_has_event_dates;

            IF NOT v_has_event_dates THEN
              v_scan_result := 'success';
            ELSE
              SELECT EXISTS (
                SELECT 1 FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND now() BETWEEN (ed.start_at - c_grace_before)
                                  AND (ed.end_at   + c_grace_after)
              ) INTO v_in_window;

              IF v_in_window THEN
                v_scan_result := 'success';
                SELECT ed.id INTO v_admitted_day
                  FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND now() BETWEEN (ed.start_at - c_grace_before)
                                  AND (ed.end_at   + c_grace_after)
                 ORDER BY ed.start_at ASC, ed.id ASC
                 LIMIT 1;
              ELSE
                SELECT MIN(ed.start_at) INTO v_next_start
                  FROM public.event_dates ed
                 WHERE ed.event_id = p_event_id
                   AND ed.start_at - c_grace_before > now();

                IF v_next_start IS NOT NULL THEN
                  v_scan_result := 'not_yet_open';
                ELSE
                  v_scan_result := 'event_ended';
                  SELECT MAX(ed.end_at) INTO v_last_end
                    FROM public.event_dates ed
                   WHERE ed.event_id = p_event_id;
                END IF;
              END IF;
            END IF;
          END IF;

          IF v_scan_result = 'success' THEN
            UPDATE public.tickets
               SET status = 'used',
                   used_at = now(),
                   used_by_scanner_id = p_scanner_user_id
             WHERE id = v_ticket.id;
          END IF;
        END IF;

      ELSE
        -- ── DAY-SCOPED PATH.
        --
        -- `status='used'` here means "FULLY CONSUMED", not "has been scanned":
        -- an all_days pass admitting 2 of its 3 days is still `valid`. The
        -- per-day admission truth is the `scan_events` ledger row, NOT the
        -- status — which is why the duplicate rung below queries the ledger
        -- rather than the status. `'transferred'` is admitted alongside
        -- `'valid'`/`'used'` nowhere: only valid/used are live here, matching
        -- the legacy rungs it replaces.
        --
        -- THE ROSTER NEEDS NO CHANGE, and that was verified rather than
        -- assumed: biz_guest_roster_project counts check-ins as
        -- `status='used' OR used_at IS NOT NULL`
        -- (20270319000873:304), and `used_at` is set on the FIRST admission
        -- below — so a partly-admitted multi-day guest already counts as
        -- checked in with that function completely untouched.
        --
        -- THE WRITE IS LEGAL, and that was verified rather than assumed:
        -- `biz_tickets_enforce_update` (baseline squash:3420-3477) forbids a
        -- scanner-role caller from touching `used_at` outside a strict
        -- valid -> used transition, which would have made this design illegal.
        -- Its FIRST statement is `IF auth.uid() IS NULL THEN RETURN NEW`, and
        -- this function is SECURITY DEFINER invoked by the `scan-ticket` edge
        -- function under the service key, so auth.uid() is NULL and the guard
        -- short-circuits. THE TRIGGER IS NOT MODIFIED.
        IF v_ticket.status NOT IN ('valid', 'used') THEN
          v_scan_result := 'void';
        ELSE
          -- issue #3281 — experience checkouts that promote a day set land
          -- here (v_day_count > 0). Booked-start windows must still bind;
          -- otherwise a 17:00 booking admits at 10:00 under the occurrence
          -- window. Per-day duplicate detection and consumption stay below.
          SELECT o.booked_start_at, e.event_type
            INTO v_booked_start, v_order_event_type
            FROM public.orders o
            JOIN public.events e ON e.id = o.event_id
           WHERE o.id = v_ticket.order_id;

          IF v_order_event_type = 'experience' AND v_booked_start IS NOT NULL THEN
            SELECT ted.event_date_id INTO v_target_day
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
             ORDER BY ed.start_at ASC, ed.id ASC
             LIMIT 1;

            SELECT COALESCE(ed.end_at - ed.start_at, interval '2 hours')
              INTO v_booked_duration
              FROM public.event_dates ed
             WHERE ed.id = v_target_day;
            IF v_booked_duration IS NULL OR v_booked_duration < interval '2 hours' THEN
              v_booked_duration := interval '2 hours';
            END IF;

            IF EXISTS (
              SELECT 1 FROM public.scan_events se
               WHERE se.ticket_id = v_ticket.id
                 AND se.event_date_id = v_target_day
                 AND se.scan_result = 'success'
            ) THEN
              v_scan_result := 'duplicate';
            ELSIF now() BETWEEN (v_booked_start - c_grace_before)
                            AND (v_booked_start + v_booked_duration + c_grace_after) THEN
              v_scan_result := 'success';
              v_admitted_day := v_target_day;

              SELECT NOT EXISTS (
                SELECT 1 FROM public.ticket_event_dates ted
                 WHERE ted.ticket_id = v_ticket.id
                   AND ted.event_date_id <> v_target_day
                   AND NOT EXISTS (
                     SELECT 1 FROM public.scan_events se
                      WHERE se.ticket_id = v_ticket.id
                        AND se.event_date_id = ted.event_date_id
                        AND se.scan_result = 'success')
              ) INTO v_all_days_consumed;

              UPDATE public.tickets
                 SET used_at = COALESCE(used_at, now()),
                     used_by_scanner_id = p_scanner_user_id,
                     status = CASE WHEN v_all_days_consumed THEN 'used' ELSE status END
               WHERE id = v_ticket.id;
            ELSIF now() < (v_booked_start - c_grace_before) THEN
              v_scan_result := 'not_yet_open';
              v_next_start := v_booked_start;
            ELSE
              v_scan_result := 'event_ended';
              v_last_end := v_booked_start + v_booked_duration;
            END IF;
          ELSE
          -- WHICH DAY IS THIS PASS BEING PRESENTED AGAINST RIGHT NOW?
          -- Two occurrences of one event CAN overlap once the 8-hour combined
          -- grace is applied (a day ending 18:00 and the next starting 11:00 do
          -- not; a same-day double session could). The tie-break is specified,
          -- not left to LIMIT 1 without ORDER BY: prefer an occurrence with NO
          -- success row yet (false sorts before true), then the earliest
          -- start_at, then the id. If every in-window day is already admitted
          -- we deliberately land on the earliest so the answer is `duplicate`,
          -- never a silent second admission.
          SELECT ed.id INTO v_target_day
            FROM public.ticket_event_dates ted
            JOIN public.event_dates ed ON ed.id = ted.event_date_id
           WHERE ted.ticket_id = v_ticket.id
             AND now() BETWEEN (ed.start_at - c_grace_before)
                            AND (ed.end_at   + c_grace_after)
           ORDER BY EXISTS (
                      SELECT 1 FROM public.scan_events se
                       WHERE se.ticket_id = v_ticket.id
                         AND se.event_date_id = ed.id
                         AND se.scan_result = 'success'
                    ) ASC,
                    ed.start_at ASC, ed.id ASC
           LIMIT 1;

          IF v_target_day IS NULL THEN
            -- Not inside ANY of THIS PASS'S days. The window is the pass's own
            -- set, never the event's — that is the whole point of the issue.
            SELECT MIN(ed.start_at) INTO v_next_start
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
               AND ed.start_at - c_grace_before > now();

            IF v_next_start IS NOT NULL THEN
              v_scan_result := 'not_yet_open';
            ELSE
              v_scan_result := 'event_ended';
              SELECT MAX(ed.end_at) INTO v_last_end
                FROM public.ticket_event_dates ted
                JOIN public.event_dates ed ON ed.id = ted.event_date_id
               WHERE ted.ticket_id = v_ticket.id;
            END IF;

            -- Attributable refusal: record the day they were TRYING to use.
            SELECT ed.id INTO v_target_day
              FROM public.ticket_event_dates ted
              JOIN public.event_dates ed ON ed.id = ted.event_date_id
             WHERE ted.ticket_id = v_ticket.id
             ORDER BY ed.start_at ASC, ed.id ASC
             LIMIT 1;

          ELSIF EXISTS (
            SELECT 1 FROM public.scan_events se
             WHERE se.ticket_id = v_ticket.id
               AND se.event_date_id = v_target_day
               AND se.scan_result = 'success'
          ) THEN
            -- DEDUPE BY LEDGER, NOT BY STATUS. An all_days pass legitimately
            -- admits once PER DAY, so `status` cannot answer this question.
            -- DELETE THIS RUNG and a two-day pass admits twice on day one.
            v_scan_result := 'duplicate';

          ELSE
            v_scan_result := 'success';
            v_admitted_day := v_target_day;

            -- Is any day of this pass left unadmitted after this one?
            SELECT NOT EXISTS (
              SELECT 1 FROM public.ticket_event_dates ted
               WHERE ted.ticket_id = v_ticket.id
                 AND ted.event_date_id <> v_target_day
                 AND NOT EXISTS (
                   SELECT 1 FROM public.scan_events se
                    WHERE se.ticket_id = v_ticket.id
                      AND se.event_date_id = ted.event_date_id
                      AND se.scan_result = 'success')
            ) INTO v_all_days_consumed;

            UPDATE public.tickets
               SET used_at = COALESCE(used_at, now()),
                   used_by_scanner_id = p_scanner_user_id,
                   -- 'used' means FULLY CONSUMED. Flipped only when no
                   -- unadmitted day remains, so an all_days pass stays 'valid'
                   -- between day 1 and day 2 and can be scanned again.
                   status = CASE WHEN v_all_days_consumed THEN 'used' ELSE status END
             WHERE id = v_ticket.id;
          END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    v_scan_event_id := CASE
      WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
      ELSE p_event_id
    END;

    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      -- issue #2160 — WHICH DAY. On success it is the occurrence that
      -- admitted them (day-scoped AND legacy alike, SC-10); on a day-scoped
      -- refusal it is the day they presented against, so the refusal is
      -- attributable rather than anonymous. NULL on every non-day-scoped
      -- refusal and on not_found / wrong_event, where there is no honest day.
      event_date_id,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false,
      COALESCE(v_admitted_day, v_target_day), now(),
      jsonb_build_object(
        'source', 'scan-ticket',
        'requestedEventId', p_event_id,
        'buyerName', COALESCE(v_ticket.buyer_name, ''),
        'ticketName', COALESCE(v_ticket.ticket_name, ''),
        'nextStartAt', v_next_start,
        'lastEndAt', v_last_end
      )
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name,
    'nextStartAt', v_next_start,
    'lastEndAt', v_last_end,
    -- issue #2160 — the day this scan admitted, for the scanner UI.
    'eventDateId', v_admitted_day
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) IS
  'Scans a ticket for an explicit scanner or current event-manager-or-higher Host; records the immutable scan result.';

-- Fail closed if the authorization repair or any protected scanner semantics
-- drift while this migration is replayed.
DO $probe$
DECLARE
  v_def text := pg_get_functiondef('public.biz_ticket_scan(uuid,text,uuid,text)'::regprocedure);
BEGIN
  IF position('biz_brand_effective_rank' IN v_def) = 0
     OR position('biz_role_rank(''event_manager''::text)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3827 probe: current Host authority gate missing';
  END IF;
  IF position('event_scanners' IN v_def) = 0
     OR position('m.role = ''scanner''' IN v_def) = 0
     OR position('m.accepted_at IS NOT NULL' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3827 probe: explicit scanner grants missing';
  END IF;
  IF position('ticket_event_dates' IN v_def) = 0
     OR position('booked_start_at' IN v_def) = 0
     OR position('scanner_not_authorized' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue #3827 probe: protected scan semantics missing';
  END IF;
  IF has_function_privilege('anon', 'public.biz_ticket_scan(uuid,text,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_ticket_scan(uuid,text,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.biz_ticket_scan(uuid,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #3827 probe: execute ACL drift';
  END IF;
END
$probe$;
