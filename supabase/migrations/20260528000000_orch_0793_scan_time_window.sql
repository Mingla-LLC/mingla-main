-- ORCH-0793 — biz_ticket_scan gains event_dates time-window enforcement.
--
-- Reads start_at/end_at from event_dates per I-PROPOSED-AY
-- EVENT_DATES_SOLE_DATE_AUTHORITY (never events table, never theme JSON).
--
-- Window membership rule: scan succeeds iff EXISTS event_dates row where
--   now() BETWEEN (start_at - GRACE_BEFORE) AND (end_at + GRACE_AFTER).
-- If no event_dates rows exist for this event (legacy/cancelled), the RPC
-- falls through to pre-0793 behavior (preserves backward compatibility per
-- SPEC §3.1 Decision-3; investigation OBS-1).
--
-- New discriminator values: 'not_yet_open', 'event_ended'. Both write a
-- scan_events audit row but do NOT mutate tickets.status, so the buyer can
-- retry inside the window. This is the buyer-burn-prevention fix.
--
-- Cross-references:
--   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md
--   - INVESTIGATION: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md
--   - Invariant: I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED (proposed)
--   - Reinforces: I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY

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
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  IF NOT EXISTS (
    SELECT 1
      FROM public.event_scanners es
     WHERE es.event_id = p_event_id
       AND es.user_id = p_scanner_user_id
       AND es.removed_at IS NULL
       AND COALESCE((es.permissions ->> 'scan')::boolean, true)
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
    ELSIF v_ticket.status = 'used' THEN
      v_scan_result := 'duplicate';
    ELSIF v_ticket.status <> 'valid' THEN
      v_scan_result := 'void';
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
        -- Decision-3: legacy/cancelled events with no event_dates rows
        -- fall through to existing behavior. Refusing the scan here would
        -- regress operator workflow on pre-0792 events.
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
        ELSE
          -- Determine which side of the window we're on for the
          -- discriminator. "Next upcoming start" = MIN(start_at) where
          -- start_at - grace_before > now(). If none, the event has fully
          -- ended for all dates → event_ended.
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

      IF v_scan_result = 'success' THEN
        UPDATE public.tickets
           SET status = 'used',
               used_at = now(),
               used_by_scanner_id = p_scanner_user_id
         WHERE id = v_ticket.id;
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
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false, now(),
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
    'lastEndAt', v_last_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;

-- =============================================================
-- Verification probe — fail loudly at migration time if the
-- I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED contract drifted.
-- =============================================================
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'biz_ticket_scan';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan function not found post-migration';
  END IF;
  IF v_body NOT LIKE '%event_dates%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body lacks event_dates reference';
  END IF;
  IF v_body NOT LIKE '%now()%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body lacks now() comparison';
  END IF;
  IF v_body NOT LIKE '%not_yet_open%' OR v_body NOT LIKE '%event_ended%' THEN
    RAISE EXCEPTION 'ORCH-0793 probe failed: biz_ticket_scan body missing new discriminator values';
  END IF;
END$$;

COMMENT ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) IS
  'ORCH-0793 — scanner RPC. Validates scanner auth, QR signature, payment, ticket status, event match, and time-window membership against event_dates [start_at - 120min, end_at + 360min]. Invariant I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED. See SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md.';
