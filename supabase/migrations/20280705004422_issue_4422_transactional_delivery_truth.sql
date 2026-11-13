-- #4422 — held Nigerian RSVP texts and bounced transactional emails.
-- Invariants I-4422-EMBARGO-HOLD-NOT-A-TRY and I-4422-PROVIDER-BOUNCE-NOT-SENT
-- are declared in __tests__/issue_4422_transactional_delivery_truth.implementor.pg17.test.sql.
--
-- A. An RSVP text held by the Nigerian 20:00-08:00 WAT operator embargo is
--    parked as `deferred` until the window reopens, and the claim's try is
--    refunded (the ticket path's model, #2218). Before this, the retry ladder
--    ran out after about 70 minutes and the text was dropped for good.
-- B. A provider bounce or complaint for an RSVP or ticket email moves that
--    delivery out of `sent`, on ingest, late (when the delivery gets its
--    provider id after the event arrived) and once for history.
-- C. A guest left with no channel that reached them and nothing still owed is
--    listed once in a ledger the edge workers turn into one ops alert.
-- D. One owner for the RSVP parent-status rollup.
--
-- No dynamic SQL. Every new function is SECURITY DEFINER with a fixed
-- search_path and is executable by service_role only.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- A1. `deferred` is a legal RSVP delivery status.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rsvp_notification_deliveries
  DROP CONSTRAINT IF EXISTS rsvp_notification_deliveries_status_check;
ALTER TABLE public.rsvp_notification_deliveries
  ADD CONSTRAINT rsvp_notification_deliveries_status_check CHECK (status IN (
    'pending','processing','sent','failed_retryable','failed_terminal','ambiguous',
    'deferred'
  ));

CREATE INDEX IF NOT EXISTS issue_4422_rsvp_deliveries_deferred_due
  ON public.rsvp_notification_deliveries (next_attempt_at, created_at)
  WHERE status = 'deferred';

-- ---------------------------------------------------------------------------
-- D. The parent-status rollup, moved out of finish so finish, defer and the
--    bounce apply share one owner. The CASE is the #1447 one, unchanged; a
--    `deferred` child is still owed, so it falls through to 'sending'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4422_rollup_rsvp_notification(
  p_notification_id uuid,
  p_set_last_error boolean DEFAULT false,
  p_last_error text DEFAULT NULL,
  p_attempt integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.rsvp_notifications n
     SET status = CASE
       WHEN NOT EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = p_notification_id AND d.is_required
            AND d.status <> 'sent'
       ) THEN 'sent'
       WHEN EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = p_notification_id AND d.is_required
            AND d.status = 'failed_retryable'
       ) THEN 'failed_retryable'
       WHEN EXISTS (
         SELECT 1 FROM public.rsvp_notification_deliveries d
          WHERE d.notification_id = p_notification_id AND d.is_required
            AND d.status IN ('failed_terminal','ambiguous')
       ) THEN 'failed_terminal'
       ELSE 'sending' END,
         sent_at = CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.rsvp_notification_deliveries d
            WHERE d.notification_id = p_notification_id AND d.is_required
              AND d.status <> 'sent'
         ) THEN now() ELSE n.sent_at END,
         last_error = CASE WHEN p_set_last_error THEN p_last_error ELSE n.last_error END,
         attempt_count = GREATEST(n.attempt_count, COALESCE(p_attempt, 0))
   WHERE n.id = p_notification_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4422_rollup_rsvp_notification(uuid, boolean, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4422_rollup_rsvp_notification(uuid, boolean, text, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- A2. The #1447 claim, with `deferred` in the due set. Everything else
--     (ambiguous parking, lease, attempt increment) is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_rsvp_notification_deliveries(
  p_notification_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
) RETURNS TABLE (
  delivery_id uuid, notification_id uuid, channel text, attempt_count integer,
  lease_id uuid, template_key text, payload jsonb, idempotency_key text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A stale SMS/push lease whose provider call already started has an unknown
  -- acceptance outcome. Park it permanently instead of risking a duplicate.
  UPDATE public.rsvp_notification_deliveries d
     SET status = 'ambiguous', ambiguous_at = now(),
         safe_error_code = 'provider_acceptance_unknown',
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
   WHERE (p_notification_id IS NULL OR d.notification_id = p_notification_id)
     AND d.status = 'processing'
     AND d.processing_started_at < now() - interval '5 minutes'
     AND d.provider_io_started_at IS NOT NULL;

  UPDATE public.rsvp_notifications n
     SET status = 'failed_terminal', last_error = 'provider_acceptance_unknown'
   WHERE (p_notification_id IS NULL OR n.id = p_notification_id)
     AND EXISTS (
       SELECT 1 FROM public.rsvp_notification_deliveries d
        WHERE d.notification_id = n.id AND d.is_required AND d.status = 'ambiguous'
     );

  RETURN QUERY
  WITH due AS (
    SELECT d.id
      FROM public.rsvp_notification_deliveries d
     WHERE (p_notification_id IS NULL OR d.notification_id = p_notification_id)
       AND (
         (d.status IN ('pending','failed_retryable','deferred') AND d.next_attempt_at <= now())
         OR (d.status = 'processing' AND d.processing_started_at < now() - interval '5 minutes'
             AND d.provider_io_started_at IS NULL)
       )
     ORDER BY d.next_attempt_at, d.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  ), claimed AS (
    UPDATE public.rsvp_notification_deliveries d
       SET status = 'processing', processing_started_at = now(),
           lease_id = gen_random_uuid(), attempt_count = d.attempt_count + 1,
           updated_at = now()
      FROM due
     WHERE d.id = due.id
    RETURNING d.*
  )
  SELECT c.id, c.notification_id, c.channel, c.attempt_count, c.lease_id,
         n.template_key, n.payload, n.idempotency_key
    FROM claimed c JOIN public.rsvp_notifications n ON n.id = c.notification_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_rsvp_notification_deliveries(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rsvp_notification_deliveries(uuid, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- A4. The #1447 finish, unchanged except that the parent rollup is D's.
--     The cap of 8 still applies to real failures.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_rsvp_notification_delivery(
  p_delivery_id uuid, p_lease_id uuid, p_status text,
  p_provider_message_id text DEFAULT NULL, p_safe_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_notification_id uuid; v_attempt integer;
BEGIN
  IF p_status NOT IN ('sent','failed_retryable','failed_terminal','ambiguous') THEN
    RAISE EXCEPTION 'invalid_delivery_status';
  END IF;
  UPDATE public.rsvp_notification_deliveries
     SET status = CASE WHEN p_status='failed_retryable' AND attempt_count>=8
           THEN 'failed_terminal' ELSE p_status END,
         provider_message_id = LEFT(p_provider_message_id, 255),
         safe_error_code = LEFT(p_safe_error_code, 80),
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
         ambiguous_at = CASE WHEN p_status = 'ambiguous' THEN now() ELSE ambiguous_at END,
         next_attempt_at = CASE WHEN p_status = 'failed_retryable' AND attempt_count<8
           THEN now() + make_interval(secs =>
             LEAST(3600, 15 * (2 ^ LEAST(attempt_count, 8))) + floor(random()*11)::integer)
           ELSE next_attempt_at END,
         provider_io_started_at = CASE WHEN p_status = 'ambiguous'
           THEN provider_io_started_at ELSE NULL END,
         processing_started_at = NULL, lease_id = NULL, updated_at = now()
   WHERE id = p_delivery_id AND lease_id = p_lease_id AND status = 'processing'
   RETURNING notification_id, attempt_count INTO v_notification_id, v_attempt;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM public.issue_4422_rollup_rsvp_notification(
    v_notification_id,
    p_status <> 'sent',
    p_safe_error_code,
    v_attempt
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_rsvp_notification_delivery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_rsvp_notification_delivery(uuid, uuid, text, text, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- A3. Park a held text until its window reopens. The claim's try is refunded,
--     so a hold never consumes an attempt. A hold older than 36 hours (one
--     full window plus slack) is ended loudly as `ng_embargo_hold_expired`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.defer_rsvp_notification_delivery(
  p_delivery_id uuid,
  p_lease_id uuid,
  p_safe_error_code text,
  p_next_attempt_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_notification_id uuid;
  v_created_at timestamptz;
  v_expired boolean;
  v_code text;
BEGIN
  SELECT d.notification_id, d.created_at
    INTO v_notification_id, v_created_at
    FROM public.rsvp_notification_deliveries d
   WHERE d.id = p_delivery_id AND d.lease_id = p_lease_id AND d.status = 'processing'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_expired := now() - v_created_at > interval '36 hours';
  v_code := CASE WHEN v_expired THEN 'ng_embargo_hold_expired'
    ELSE LEFT(COALESCE(NULLIF(btrim(p_safe_error_code), ''), 'ng_operator_embargo'), 80) END;

  UPDATE public.rsvp_notification_deliveries
     SET status = CASE WHEN v_expired THEN 'failed_terminal' ELSE 'deferred' END,
         attempt_count = GREATEST(attempt_count - 1, 0),
         safe_error_code = v_code,
         next_attempt_at = CASE WHEN v_expired THEN next_attempt_at
           ELSE LEAST(
             GREATEST(COALESCE(p_next_attempt_at, now() + interval '15 minutes'),
                      now() + interval '30 seconds'),
             now() + interval '13 hours'
           ) + make_interval(secs => floor(random() * 121)::integer)
         END,
         processing_started_at = NULL,
         lease_id = NULL,
         provider_io_started_at = NULL,
         updated_at = now()
   WHERE id = p_delivery_id;

  PERFORM public.issue_4422_rollup_rsvp_notification(v_notification_id, true, v_code, NULL);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.defer_rsvp_notification_delivery(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_rsvp_notification_delivery(uuid, uuid, text, timestamptz)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B5. Provider-id lookups for transactional email rows.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS issue_4422_rsvp_deliveries_provider_id
  ON public.rsvp_notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL AND channel = 'email';
CREATE INDEX IF NOT EXISTS issue_4422_ticket_notifications_provider_id
  ON public.ticket_order_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL AND channel = 'email';

-- ---------------------------------------------------------------------------
-- B6. Apply one stored bounce or complaint to the RSVP or ticket email it
--     belongs to. Reads marketing_email_events, never writes it. Idempotent
--     through the status guard; sent_at is kept as evidence that the
--     provider accepted the email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4422_apply_transactional_email_event(p_svix_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.marketing_email_events%ROWTYPE;
  v_code text;
  v_result text := 'none';
  v_row record;
BEGIN
  SELECT * INTO v_event FROM public.marketing_email_events WHERE svix_id = p_svix_id;
  IF NOT FOUND OR v_event.provider_message_id IS NULL
     OR v_event.event_type NOT IN ('email.bounced', 'email.complained') THEN
    RETURN 'none';
  END IF;

  v_code := CASE
    WHEN v_event.event_type = 'email.complained' THEN 'email_complained'
    WHEN v_event.payload->'data'->'bounce'->>'type' = 'Permanent' THEN 'email_bounced_permanent'
    ELSE 'email_bounced_transient'
  END;

  FOR v_row IN
    UPDATE public.rsvp_notification_deliveries d
       SET status = 'failed_terminal', safe_error_code = v_code, updated_at = now()
     WHERE d.channel = 'email'
       AND d.provider_message_id = v_event.provider_message_id
       AND d.status = 'sent'
    RETURNING d.notification_id
  LOOP
    PERFORM public.issue_4422_rollup_rsvp_notification(v_row.notification_id, true, v_code, NULL);
    v_result := 'rsvp';
  END LOOP;

  UPDATE public.ticket_order_notifications t
     SET status = 'failed_terminal', last_error = v_code, updated_at = now()
   WHERE t.channel = 'email'
     AND t.provider_message_id = v_event.provider_message_id
     AND t.status IN ('sent', 'delivered');
  IF FOUND THEN
    v_result := 'ticket';
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4422_apply_transactional_email_event(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4422_apply_transactional_email_event(text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B7. The #4419 ingest (20280703014419, lines 143-183), unchanged for host
--     marketing and Admin deliveries, then transactional delivery truth for
--     an event neither claimed. Returns 'transactional_delivery' when it
--     applied; resend-webhook answers 200 for any value but the retry ones.
--     A failure here never fails ingest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mkt_ingest_email_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from text := lower(COALESCE(p_payload->'data'->>'from',''));
  v_result text;
BEGIN
  INSERT INTO public.marketing_email_events
    (svix_id, event_type, provider_message_id, payload, is_campaign_event)
  VALUES (
    p_svix_id,
    p_event_type,
    p_provider_message_id,
    p_payload,
    v_from ~ '(^|<)[^<>@[:space:]]+@campaigns[.]usemingla[.]com>?[[:space:]]*$'
  )
  ON CONFLICT (svix_id) DO NOTHING;

  v_result := public.mkt_reconcile_email_event(p_svix_id);

  IF v_result IN ('unmatched', 'campaign_unmatched', 'campaign_unmatched_stale') THEN
    BEGIN
      IF public.issue_4419_apply_admin_email_event(p_svix_id) THEN
        v_result := 'admin_delivery';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4419_admin_email_event_link_failed: % (%)', SQLERRM, SQLSTATE;
    END;
    IF v_result <> 'admin_delivery' THEN
      BEGIN
        IF public.issue_4422_apply_transactional_email_event(p_svix_id) <> 'none' THEN
          v_result := 'transactional_delivery';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'issue_4422_transactional_email_event_failed: % (%)', SQLERRM, SQLSTATE;
      END;
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B8. Late link: a bounce can arrive before the delivery stores its provider
--     id (rsvp-notify writes the id only when it finishes the row). When the
--     id lands, apply whatever already arrived. Same shape as #4419's link.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4422_link_transactional_email_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
BEGIN
  IF NEW.provider_message_id IS NULL OR NEW.channel <> 'email' THEN
    RETURN NEW;
  END IF;
  FOR v_event IN
    SELECT e.svix_id
      FROM public.marketing_email_events e
     WHERE e.provider_message_id = NEW.provider_message_id
       AND e.event_type IN ('email.bounced', 'email.complained')
     ORDER BY e.received_at, e.svix_id
  LOOP
    BEGIN
      PERFORM public.issue_4422_apply_transactional_email_event(v_event.svix_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4422_transactional_email_event_late_link_failed: % (%)', SQLERRM, SQLSTATE;
    END;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4422_link_transactional_email_events()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4422_link_rsvp_email_events ON public.rsvp_notification_deliveries;
CREATE TRIGGER issue_4422_link_rsvp_email_events
AFTER INSERT OR UPDATE OF provider_message_id ON public.rsvp_notification_deliveries
FOR EACH ROW
WHEN (NEW.provider_message_id IS NOT NULL AND NEW.channel = 'email')
EXECUTE FUNCTION public.issue_4422_link_transactional_email_events();

DROP TRIGGER IF EXISTS issue_4422_link_ticket_email_events ON public.ticket_order_notifications;
CREATE TRIGGER issue_4422_link_ticket_email_events
AFTER INSERT OR UPDATE OF provider_message_id ON public.ticket_order_notifications
FOR EACH ROW
WHEN (NEW.provider_message_id IS NOT NULL AND NEW.channel = 'email')
EXECUTE FUNCTION public.issue_4422_link_transactional_email_events();

-- ---------------------------------------------------------------------------
-- C10. Who has already been alerted as unreached. Ids only, never contacts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issue_4422_unreached_guest_alerts (
  source text NOT NULL CHECK (source IN ('rsvp', 'ticket')),
  subject_id uuid NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, subject_id)
);
COMMENT ON TABLE public.issue_4422_unreached_guest_alerts IS
  '#4422 ledger: an RSVP notification or ticket order that reached no channel and owes nothing, already alerted to ops. Ids only.';
ALTER TABLE public.issue_4422_unreached_guest_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4422_unreached_guest_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.issue_4422_unreached_guest_alerts TO service_role;

-- ---------------------------------------------------------------------------
-- C11. Claim the subjects to alert, once each. One statement inserts the
--      ledger rows and returns them: ids, the event id and the sorted
--      distinct safe codes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4422_claim_unreached_guest_alerts(
  p_source text,
  p_limit integer DEFAULT 50
) RETURNS TABLE (subject_id uuid, event_id uuid, codes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('rsvp', 'ticket') THEN
    RAISE EXCEPTION 'unreached_alert_source_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_source = 'rsvp' THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT n.id AS cand_id, n.event_id AS cand_event_id,
             (SELECT string_agg(DISTINCT dc.safe_error_code, ',' ORDER BY dc.safe_error_code)
                FROM public.rsvp_notification_deliveries dc
               WHERE dc.notification_id = n.id AND dc.safe_error_code IS NOT NULL) AS cand_codes
        FROM public.rsvp_notifications n
       WHERE n.template_key IN ('rsvp_pass', 'rsvp_acknowledgement')
         AND n.created_at > now() - interval '14 days'
         AND EXISTS (
           SELECT 1 FROM public.rsvp_notification_deliveries d
            WHERE d.notification_id = n.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.rsvp_notification_deliveries d
            WHERE d.notification_id = n.id
              AND d.status IN ('sent', 'pending', 'processing', 'failed_retryable', 'deferred')
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.issue_4422_unreached_guest_alerts a
            WHERE a.source = 'rsvp' AND a.subject_id = n.id
         )
       ORDER BY n.created_at, n.id
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
    ), inserted AS (
      INSERT INTO public.issue_4422_unreached_guest_alerts AS l (source, subject_id)
      SELECT 'rsvp', c.cand_id FROM candidates c
      ON CONFLICT (source, subject_id) DO NOTHING
      RETURNING l.subject_id AS ins_id
    )
    SELECT c.cand_id, c.cand_event_id, c.cand_codes
      FROM candidates c JOIN inserted i ON i.ins_id = c.cand_id
     ORDER BY c.cand_id;
    RETURN;
  END IF;

  RETURN QUERY
  WITH orders AS (
    SELECT t.order_id AS cand_id,
           (array_agg(t.event_id ORDER BY t.created_at, t.id))[1] AS cand_event_id,
           string_agg(DISTINCT t.last_error, ',' ORDER BY t.last_error)
             FILTER (WHERE t.last_error IS NOT NULL) AS cand_codes,
           min(t.created_at) AS first_at
      FROM public.ticket_order_notifications t
     WHERE t.order_id IS NOT NULL
     GROUP BY t.order_id
    HAVING min(t.created_at) > now() - interval '14 days'
       AND bool_and(t.status NOT IN ('sent', 'delivered', 'pending', 'sending', 'deferred', 'failed_retryable'))
       AND bool_or(t.status = 'failed_terminal')
  ), candidates AS (
    SELECT o.* FROM orders o
     WHERE NOT EXISTS (
       SELECT 1 FROM public.issue_4422_unreached_guest_alerts a
        WHERE a.source = 'ticket' AND a.subject_id = o.cand_id
     )
     ORDER BY o.first_at, o.cand_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ), inserted AS (
    INSERT INTO public.issue_4422_unreached_guest_alerts AS l (source, subject_id)
    SELECT 'ticket', c.cand_id FROM candidates c
    ON CONFLICT (source, subject_id) DO NOTHING
    RETURNING l.subject_id AS ins_id
  )
  SELECT c.cand_id, c.cand_event_id, c.cand_codes
    FROM candidates c JOIN inserted i ON i.ins_id = c.cand_id
   ORDER BY c.cand_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4422_claim_unreached_guest_alerts(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4422_claim_unreached_guest_alerts(text, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- B9. History: every stored bounce or complaint for a transactional email
--     still marked sent. A function so the pg17 suite runs the same statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4422_backfill_transactional_email_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
  v_result text;
  v_rsvp integer := 0;
  v_ticket integer := 0;
BEGIN
  FOR v_event IN
    SELECT e.svix_id
      FROM public.marketing_email_events e
     WHERE e.provider_message_id IS NOT NULL
       AND e.event_type IN ('email.bounced', 'email.complained')
       AND (
         EXISTS (SELECT 1 FROM public.rsvp_notification_deliveries d
                  WHERE d.channel = 'email' AND d.provider_message_id = e.provider_message_id
                    AND d.status = 'sent')
         OR EXISTS (SELECT 1 FROM public.ticket_order_notifications t
                     WHERE t.channel = 'email' AND t.provider_message_id = e.provider_message_id
                       AND t.status IN ('sent', 'delivered'))
       )
     ORDER BY e.received_at, e.svix_id
  LOOP
    v_result := public.issue_4422_apply_transactional_email_event(v_event.svix_id);
    IF v_result = 'rsvp' THEN v_rsvp := v_rsvp + 1;
    ELSIF v_result = 'ticket' THEN v_ticket := v_ticket + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('rsvp', v_rsvp, 'ticket', v_ticket);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4422_backfill_transactional_email_events()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4422_backfill_transactional_email_events()
  TO service_role;

DO $backfill$
DECLARE
  v_counts jsonb := public.issue_4422_backfill_transactional_email_events();
BEGIN
  RAISE NOTICE 'issue-4422: bounced/complained transactional emails moved out of sent: rsvp %, ticket %',
    v_counts->>'rsvp', v_counts->>'ticket';
END;
$backfill$;

COMMIT;
