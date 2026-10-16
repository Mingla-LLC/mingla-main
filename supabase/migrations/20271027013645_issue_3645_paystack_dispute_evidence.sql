-- Issue #3645 WS5 — Paystack dispute evidence: admin list/detail, auto-assembled
-- dossier, human review gate, internal deadline, export / stub-submit with an
-- immutable record of exactly what was sent.
--
-- Why: Paystack is Mingla's merchant of record on the NGN rail, so a Paystack
-- chargeback is Mingla's clock (16h auto-accept -> merchant-accepted -> organiser
-- debt via record_paystack_dispute_outcome). Admin could only read Stripe
-- disputes (admin_list_disputes). This adds the Paystack read surface plus an
-- evidence workflow that finishes well inside the 16h window.
--
-- Design notes
--   1. Admin workflow state lives in an ADMIN-ONLY table, NOT on paystack_disputes:
--      brand payment managers hold SELECT on paystack_disputes (RLS policy from
--      PR4), so an internal note / review hash added there would be readable by
--      the organiser being charged back. Same lesson as brand_payout_admin_holds.
--   2. paystack_dispute_evidence_events is APPEND-ONLY (UPDATE/DELETE/TRUNCATE
--      blocked by trigger). Every review, export, and stub-submit stores the full
--      dossier snapshot + its sha256, so what was sent is provable later.
--   3. Review gate: export / submit require a prior review whose dossier sha256
--      still matches the freshly assembled dossier. New order/ticket/scan/consent/
--      delivery rows after review force a re-review (dossier_changed_since_review).
--   4. Internal deadline = least(created_at + 4h, response_due_by - 1h). The
--      list/detail surface internal_overdue so the console shows red long before
--      Paystack's own 16h auto-accept.
--   5. Provider submit is a STUB: submit_stub records the intent + snapshot with
--      provider_submit_status = 'not_sent_stub'. No Paystack API call is made here.
--   6. Every RPC is guard-first (is_admin_user()), reason-required for writes,
--      audited via admin_write_audit, anon revoked / authenticated granted.
--      Moves no money.
-- Docs: https://paystack.com/docs/payments/manage-disputes/

BEGIN;

-- ── §1. Admin-only workflow state (one row per dispute) ───────────────────────
CREATE TABLE IF NOT EXISTS public.paystack_dispute_admin_state (
  dispute_id uuid PRIMARY KEY REFERENCES public.paystack_disputes(id) ON DELETE CASCADE,
  internal_note text,
  evidence_reviewed_at timestamptz,
  evidence_reviewed_by uuid,
  evidence_reviewed_sha256 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paystack_dispute_admin_state_review_complete CHECK (
    (evidence_reviewed_at IS NULL) = (evidence_reviewed_sha256 IS NULL)
    AND (evidence_reviewed_at IS NULL) = (evidence_reviewed_by IS NULL)
  )
);

ALTER TABLE public.paystack_dispute_admin_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paystack_dispute_admin_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.paystack_dispute_admin_state TO service_role;

COMMENT ON TABLE public.paystack_dispute_admin_state IS
  'Issue #3645 WS5: admin-only Paystack dispute workflow state (internal note + evidence review gate). RLS-on, service_role-only so a brand payment manager (who can SELECT paystack_disputes) can never read it.';

-- ── §2. Append-only evidence event log (what was reviewed / exported / sent) ──
CREATE TABLE IF NOT EXISTS public.paystack_dispute_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.paystack_disputes(id),
  action text NOT NULL CHECK (action IN ('review_approve', 'export', 'submit_stub')),
  dossier jsonb NOT NULL,
  dossier_sha256 text NOT NULL CHECK (dossier_sha256 ~ '^[0-9a-f]{64}$'),
  provider_submit_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (provider_submit_status IN ('not_applicable', 'not_sent_stub')),
  actor_uid uuid,
  actor_email text,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paystack_dispute_evidence_events_submit_status_matches_action CHECK (
    (action = 'submit_stub' AND provider_submit_status = 'not_sent_stub')
    OR (action <> 'submit_stub' AND provider_submit_status = 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS idx_paystack_dispute_evidence_events_dispute
  ON public.paystack_dispute_evidence_events (dispute_id, created_at DESC);

ALTER TABLE public.paystack_dispute_evidence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paystack_dispute_evidence_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.paystack_dispute_evidence_events TO service_role;

CREATE OR REPLACE FUNCTION public.paystack_dispute_evidence_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'paystack_dispute_evidence_events_immutable' USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS paystack_dispute_evidence_events_no_update_delete
  ON public.paystack_dispute_evidence_events;
CREATE TRIGGER paystack_dispute_evidence_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.paystack_dispute_evidence_events
  FOR EACH ROW EXECUTE FUNCTION public.paystack_dispute_evidence_events_immutable();

DROP TRIGGER IF EXISTS paystack_dispute_evidence_events_no_truncate
  ON public.paystack_dispute_evidence_events;
CREATE TRIGGER paystack_dispute_evidence_events_no_truncate
  BEFORE TRUNCATE ON public.paystack_dispute_evidence_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.paystack_dispute_evidence_events_immutable();

REVOKE ALL ON FUNCTION public.paystack_dispute_evidence_events_immutable() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.paystack_dispute_evidence_events IS
  'Issue #3645 WS5: APPEND-ONLY record of every evidence review / export / stub-submit with the full dossier snapshot and its sha256. UPDATE/DELETE/TRUNCATE are blocked by trigger.';

-- ── §3. Internal deadline helper (internal-only) ──────────────────────────────
-- Paystack auto-accepts (merchant loses) at response_due_by (~16h). Mingla's own
-- review must land much sooner: 4h after the dispute opened, and never later than
-- 1h before Paystack's deadline.
CREATE OR REPLACE FUNCTION public.paystack_dispute_internal_deadline(
  p_created_at timestamptz,
  p_response_due_by timestamptz
) RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT least(
    p_created_at + interval '4 hours',
    coalesce(p_response_due_by - interval '1 hour', p_created_at + interval '4 hours')
  );
$fn$;

REVOKE ALL ON FUNCTION public.paystack_dispute_internal_deadline(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_dispute_internal_deadline(timestamptz, timestamptz)
  TO service_role;

-- ── §4. Dossier assembler (internal-only; deterministic — no now()) ───────────
CREATE OR REPLACE FUNCTION public.paystack_dispute_build_dossier(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d public.paystack_disputes%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_subject_type text;
  v_subject_id uuid;
  v_order_json jsonb;
  v_event_json jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_tickets jsonb := '[]'::jsonb;
  v_scans jsonb := '[]'::jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_consent jsonb := '[]'::jsonb;
  v_delivery jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO d FROM public.paystack_disputes WHERE id = p_dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF d.order_id IS NOT NULL THEN
    v_subject_type := 'order'; v_subject_id := d.order_id;
  ELSIF d.rsvp_contribution_id IS NOT NULL THEN
    v_subject_type := 'rsvp_contribution'; v_subject_id := d.rsvp_contribution_id;
  ELSIF d.venue_reservation_id IS NOT NULL THEN
    v_subject_type := 'venue_reservation'; v_subject_id := d.venue_reservation_id;
  ELSIF d.venue_menu_order_id IS NOT NULL THEN
    v_subject_type := 'venue_menu_order'; v_subject_id := d.venue_menu_order_id;
  END IF;

  IF v_subject_type IS NULL THEN
    v_gaps := v_gaps || to_jsonb('no_linked_subject'::text);
  ELSIF v_subject_type <> 'order' THEN
    v_gaps := v_gaps || to_jsonb('subject_not_ticket_order_manual_assembly_required'::text);
  END IF;

  IF d.order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = d.order_id;
    IF FOUND THEN
      v_order_json := jsonb_build_object(
        'id', v_order.id,
        'event_id', v_order.event_id,
        'buyer_name', v_order.buyer_name,
        'buyer_email', v_order.buyer_email,
        'buyer_phone', v_order.buyer_phone,
        'total_cents', v_order.total_cents,
        'currency', v_order.currency,
        'payment_method', v_order.payment_method,
        'payment_status', v_order.payment_status,
        'created_at', v_order.created_at
      );
      v_event_json := (
        SELECT jsonb_build_object(
          'id', e.id, 'title', e.title, 'status', e.status,
          'location_text', e.location_text, 'timezone', e.timezone
        )
        FROM public.events e WHERE e.id = v_order.event_id
      );

      v_lines := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'ticket_type_name', tt.name, 'quantity', li.quantity,
          'unit_price_cents', li.unit_price_cents, 'total_cents', li.total_cents
        ) ORDER BY li.id)
        FROM public.order_line_items li
        LEFT JOIN public.ticket_types tt ON tt.id = li.ticket_type_id
        WHERE li.order_id = v_order.id
      ), '[]'::jsonb);

      v_tickets := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'status', t.status,
          'attendee_name', t.attendee_name, 'attendee_email', t.attendee_email,
          'issued_at', t.created_at, 'used_at', t.used_at,
          'transferred_at', t.transferred_at
        ) ORDER BY t.created_at, t.id)
        FROM public.tickets t WHERE t.order_id = v_order.id
      ), '[]'::jsonb);

      v_scans := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'ticket_id', s.ticket_id, 'scan_result', s.scan_result,
          'scanned_at', s.scanned_at, 'client_offline', s.client_offline
        ) ORDER BY s.scanned_at, s.id)
        FROM public.scan_events s
        INNER JOIN public.tickets t ON t.id = s.ticket_id
        WHERE t.order_id = v_order.id
      ), '[]'::jsonb);

      v_refunds := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id, 'amount_cents', r.amount_cents, 'currency', r.currency,
          'status', r.status, 'reason', r.reason, 'created_at', r.created_at
        ) ORDER BY r.created_at, r.id)
        FROM public.refunds r WHERE r.order_id = v_order.id
      ), '[]'::jsonb);

      -- Buyer consent / terms acceptance on record for this contact + offering.
      -- ip_hash is deliberately not exported.
      v_consent := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'channel', c.channel, 'scope', c.scope, 'action', c.action,
          'source', c.source, 'disclosure_version', c.disclosure_version,
          'disclosure_text', c.disclosure_text, 'recorded_at', c.created_at
        ) ORDER BY c.created_at, c.id)
        FROM public.consent_records c
        WHERE v_order.buyer_email IS NOT NULL
          AND c.contact = lower(btrim(v_order.buyer_email))
          AND (c.event_id IS NULL OR c.event_id = v_order.event_id)
      ), '[]'::jsonb);

      -- Delivery proof: in-app/push/email notifications tied to this order.
      v_delivery := coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'notification_type', n.type, 'channel', nd.channel, 'status', nd.status,
          'provider', nd.provider, 'attempted_at', nd.attempt_at,
          'delivered_at', nd.delivered_at
        ) ORDER BY nd.attempt_at, nd.id)
        FROM public.notifications n
        JOIN public.notification_deliveries nd ON nd.notification_id = n.id
        WHERE n.related_id = v_order.id::text
      ), '[]'::jsonb);

      IF jsonb_array_length(v_tickets) = 0 THEN
        v_gaps := v_gaps || to_jsonb('no_tickets_issued'::text);
      END IF;
      IF jsonb_array_length(v_scans) = 0 THEN
        v_gaps := v_gaps || to_jsonb('no_scan_records'::text);
      END IF;
      IF jsonb_array_length(v_consent) = 0 THEN
        v_gaps := v_gaps || to_jsonb('no_consent_records'::text);
      END IF;
      IF jsonb_array_length(v_delivery) = 0 THEN
        v_gaps := v_gaps || to_jsonb('no_delivery_records'::text);
      END IF;
    ELSE
      v_gaps := v_gaps || to_jsonb('linked_order_missing'::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'dispute', jsonb_build_object(
      'id', d.id,
      'paystack_dispute_id', d.paystack_dispute_id,
      'transaction_reference', d.transaction_reference,
      'amount_cents', d.amount_cents,
      'currency', d.currency,
      'status', d.status,
      'resolution', d.resolution,
      'reason', d.reason,
      'response_due_by', d.response_due_by,
      'opened_at', d.created_at
    ),
    'subject', jsonb_build_object('type', v_subject_type, 'id', v_subject_id),
    'order', v_order_json,
    'event', v_event_json,
    'line_items', v_lines,
    'tickets', v_tickets,
    'scan_events', v_scans,
    'refunds', v_refunds,
    'consent_records', v_consent,
    'delivery_records', v_delivery,
    'evidence_gaps', v_gaps
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.paystack_dispute_build_dossier(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_dispute_build_dossier(uuid) TO service_role;

-- ── §5. admin_list_paystack_disputes — guard-first READ { rows, total } ───────
CREATE OR REPLACE FUNCTION public.admin_list_paystack_disputes(
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT d.id, d.paystack_dispute_id, d.transaction_reference, d.brand_id,
      b.name AS brand_name, d.order_id, d.amount_cents, d.currency, d.status,
      d.resolution, d.reason, d.response_due_by, d.is_resolved, d.debt_opened,
      d.created_at,
      public.paystack_dispute_internal_deadline(d.created_at, d.response_due_by)
        AS internal_deadline_at,
      s.evidence_reviewed_at,
      CASE
        WHEN d.is_resolved THEN 'resolved'
        WHEN EXISTS (SELECT 1 FROM public.paystack_dispute_evidence_events ev
                     WHERE ev.dispute_id = d.id AND ev.action = 'submit_stub') THEN 'submitted_stub'
        WHEN EXISTS (SELECT 1 FROM public.paystack_dispute_evidence_events ev
                     WHERE ev.dispute_id = d.id AND ev.action = 'export') THEN 'exported'
        WHEN s.evidence_reviewed_at IS NOT NULL THEN 'reviewed'
        ELSE 'needs_review'
      END AS evidence_state
    FROM public.paystack_disputes d
    LEFT JOIN public.brands b ON b.id = d.brand_id
    LEFT JOIN public.paystack_dispute_admin_state s ON s.dispute_id = d.id
  ), flagged AS (
    SELECT base.*,
      (base.evidence_reviewed_at IS NULL AND NOT base.is_resolved
        AND now() > base.internal_deadline_at) AS internal_overdue
    FROM base
  ), filtered AS (
    SELECT * FROM flagged
    WHERE (p_search IS NULL
           OR paystack_dispute_id ILIKE '%' || p_search || '%'
           OR transaction_reference ILIKE '%' || p_search || '%')
      AND (p_status_filter IS NULL OR evidence_state = p_status_filter OR status = p_status_filter)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.is_resolved ASC,
                            f.internal_deadline_at ASC NULLS LAST, f.created_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered
          ORDER BY is_resolved ASC, internal_deadline_at ASC NULLS LAST, created_at DESC
          LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$fn$;

-- ── §6. admin_get_paystack_dispute — detail bundle with the live dossier ──────
CREATE OR REPLACE FUNCTION public.admin_get_paystack_dispute(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  d public.paystack_disputes%ROWTYPE;
  s public.paystack_dispute_admin_state%ROWTYPE;
  v_dossier jsonb;
  v_sha text;
  v_deadline timestamptz;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO d FROM public.paystack_disputes WHERE id = p_dispute_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO s FROM public.paystack_dispute_admin_state WHERE dispute_id = p_dispute_id;

  v_dossier := public.paystack_dispute_build_dossier(p_dispute_id);
  v_sha := encode(sha256(convert_to(v_dossier::text, 'UTF8')), 'hex');
  v_deadline := public.paystack_dispute_internal_deadline(d.created_at, d.response_due_by);

  RETURN jsonb_build_object(
    'dispute', to_jsonb(d) - 'raw_event',
    'raw_event', d.raw_event,
    'brand', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
              FROM public.brands b WHERE b.id = d.brand_id),
    'internal_deadline_at', v_deadline,
    'internal_overdue', (s.evidence_reviewed_at IS NULL AND NOT d.is_resolved AND now() > v_deadline),
    'admin_state', jsonb_build_object(
      'internal_note', s.internal_note,
      'evidence_reviewed_at', s.evidence_reviewed_at,
      'evidence_reviewed_by', s.evidence_reviewed_by,
      'evidence_reviewed_sha256', s.evidence_reviewed_sha256,
      'review_current', (s.evidence_reviewed_sha256 IS NOT NULL AND s.evidence_reviewed_sha256 = v_sha)
    ),
    'dossier', v_dossier,
    'dossier_sha256', v_sha,
    'evidence_events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ev.id, 'action', ev.action, 'dossier_sha256', ev.dossier_sha256,
        'provider_submit_status', ev.provider_submit_status,
        'actor_email', ev.actor_email, 'reason', ev.reason, 'created_at', ev.created_at
      ) ORDER BY ev.created_at DESC)
      FROM public.paystack_dispute_evidence_events ev WHERE ev.dispute_id = p_dispute_id
    ), '[]'::jsonb),
    'provider_submit', jsonb_build_object('mode', 'stub', 'api_upload_wired', false)
  );
END;
$fn$;

-- ── §7. admin_review_paystack_dispute_evidence — the human review gate ────────
CREATE OR REPLACE FUNCTION public.admin_review_paystack_dispute_evidence(
  p_dispute_id uuid,
  p_note text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  d public.paystack_disputes%ROWTYPE;
  v_dossier jsonb;
  v_sha text;
  v_email text;
  v_event_id uuid;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO d FROM public.paystack_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute_not_found'; END IF;
  IF d.is_resolved THEN RAISE EXCEPTION 'dispute_resolved'; END IF;

  v_dossier := public.paystack_dispute_build_dossier(p_dispute_id);
  v_sha := encode(sha256(convert_to(v_dossier::text, 'UTF8')), 'hex');
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.paystack_dispute_admin_state AS s (
    dispute_id, internal_note, evidence_reviewed_at, evidence_reviewed_by,
    evidence_reviewed_sha256, updated_at
  ) VALUES (
    p_dispute_id, nullif(btrim(p_note), ''), now(), auth.uid(), v_sha, now()
  )
  ON CONFLICT (dispute_id) DO UPDATE SET
    internal_note = coalesce(nullif(btrim(p_note), ''), s.internal_note),
    evidence_reviewed_at = now(),
    evidence_reviewed_by = auth.uid(),
    evidence_reviewed_sha256 = v_sha,
    updated_at = now();

  INSERT INTO public.paystack_dispute_evidence_events (
    dispute_id, action, dossier, dossier_sha256, actor_uid, actor_email, reason
  ) VALUES (
    p_dispute_id, 'review_approve', v_dossier, v_sha, auth.uid(), v_email, btrim(p_reason)
  ) RETURNING id INTO v_event_id;

  PERFORM public.admin_write_audit(
    'paystack_dispute.evidence_review', 'paystack_dispute', p_dispute_id::text, p_reason,
    jsonb_build_object('dossier_sha256', v_sha, 'evidence_event_id', v_event_id)
  );

  RETURN jsonb_build_object(
    'dispute_id', p_dispute_id, 'dossier_sha256', v_sha, 'evidence_event_id', v_event_id
  );
END;
$fn$;

-- ── §8. admin_record_paystack_dispute_evidence_action — export / stub submit ──
CREATE OR REPLACE FUNCTION public.admin_record_paystack_dispute_evidence_action(
  p_dispute_id uuid,
  p_action text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  d public.paystack_disputes%ROWTYPE;
  s public.paystack_dispute_admin_state%ROWTYPE;
  v_dossier jsonb;
  v_sha text;
  v_email text;
  v_event_id uuid;
  v_provider text;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('export', 'submit_stub') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO d FROM public.paystack_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute_not_found'; END IF;
  IF p_action = 'submit_stub' AND d.is_resolved THEN RAISE EXCEPTION 'dispute_resolved'; END IF;
  IF p_action = 'submit_stub' AND d.response_due_by IS NOT NULL AND now() > d.response_due_by THEN
    RAISE EXCEPTION 'past_provider_deadline';
  END IF;

  SELECT * INTO s FROM public.paystack_dispute_admin_state WHERE dispute_id = p_dispute_id;
  IF NOT FOUND OR s.evidence_reviewed_at IS NULL THEN
    RAISE EXCEPTION 'review_required';
  END IF;

  v_dossier := public.paystack_dispute_build_dossier(p_dispute_id);
  v_sha := encode(sha256(convert_to(v_dossier::text, 'UTF8')), 'hex');
  IF v_sha IS DISTINCT FROM s.evidence_reviewed_sha256 THEN
    RAISE EXCEPTION 'dossier_changed_since_review';
  END IF;

  v_provider := CASE WHEN p_action = 'submit_stub' THEN 'not_sent_stub' ELSE 'not_applicable' END;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.paystack_dispute_evidence_events (
    dispute_id, action, dossier, dossier_sha256, provider_submit_status,
    actor_uid, actor_email, reason
  ) VALUES (
    p_dispute_id, p_action, v_dossier, v_sha, v_provider,
    auth.uid(), v_email, btrim(p_reason)
  ) RETURNING id INTO v_event_id;

  PERFORM public.admin_write_audit(
    'paystack_dispute.evidence_' || p_action, 'paystack_dispute', p_dispute_id::text, p_reason,
    jsonb_build_object(
      'dossier_sha256', v_sha, 'evidence_event_id', v_event_id,
      'provider_submit_status', v_provider
    )
  );

  RETURN jsonb_build_object(
    'dispute_id', p_dispute_id,
    'action', p_action,
    'evidence_event_id', v_event_id,
    'dossier_sha256', v_sha,
    'provider_submit_status', v_provider,
    'dossier', v_dossier
  );
END;
$fn$;

-- ── §9. Least-privilege + apply-time self-assert ──────────────────────────────
REVOKE EXECUTE ON FUNCTION public.admin_list_paystack_disputes(text, text, int, int)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_paystack_disputes(text, text, int, int)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_paystack_dispute(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_paystack_dispute(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_review_paystack_dispute_evidence(uuid, text, text)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_paystack_dispute_evidence(uuid, text, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_record_paystack_dispute_evidence_action(uuid, text, text)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_paystack_dispute_evidence_action(uuid, text, text)
  TO authenticated;

DO $assert$
DECLARE
  v_sig text;
  v_admin_sigs text[] := ARRAY[
    'public.admin_list_paystack_disputes(text,text,integer,integer)',
    'public.admin_get_paystack_dispute(uuid)',
    'public.admin_review_paystack_dispute_evidence(uuid,text,text)',
    'public.admin_record_paystack_dispute_evidence_action(uuid,text,text)'
  ];
  v_internal_sigs text[] := ARRAY[
    'public.paystack_dispute_build_dossier(uuid)',
    'public.paystack_dispute_internal_deadline(timestamptz,timestamptz)'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_admin_sigs LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '#3645 WS5: % still EXECUTE-able by anon', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '#3645 WS5: authenticated lost EXECUTE on % (admin UI would break)', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY v_internal_sigs LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '#3645 WS5: internal % must be service_role-only', v_sig;
    END IF;
  END LOOP;
END
$assert$;

COMMENT ON FUNCTION public.admin_record_paystack_dispute_evidence_action(uuid, text, text) IS
  'Issue #3645 WS5: admin-only export / stub-submit of a Paystack dispute dossier. Requires a prior review whose sha256 still matches the live dossier; records the full snapshot in the append-only evidence log. submit_stub does NOT call Paystack.';

COMMIT;
