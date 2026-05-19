-- ============================================================
-- ORCH-0880 [Tr5 Traveler Intake Forms] Phase 2 — trigger wiring fix.
--
-- DISC-IMPL-0880-2 from Phase 1 implementation report: Phase 1 wired the
-- `tg_intake_schemas_re_answer_dispatch` trigger to INSERT into a
-- `notifications_outbox` table that doesn't exist in the current schema.
-- The trigger guarded the insert with `information_schema.tables` existence
-- check so it silently no-ops (graceful) but never actually fires
-- notifications.
--
-- Phase 2 decision per dispatch §2 (DISC-IMPL-0880-2 = option b):
-- replace the trigger body to INSERT into `ticket_order_notifications`
-- (the canonical notification queue established by ORCH-0788
-- [ticket-confirmation-dispatch]). The existing ORCH-0788 retry-cron picks
-- the rows up and dispatches via ticket-confirmation-dispatch edge function
-- which (per Phase 2 edge-fn modification) handles the new
-- `buyer_intake_form_re_answer_required` template_key.
--
-- This is a CREATE OR REPLACE on the trigger function only; the trigger
-- registration itself from Phase 1 (`tg_trip_intake_schemas_re_answer`) is
-- preserved.
--
-- See: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md
-- Phase 1 §10 DISC-IMPL-0880-2 + Phase 2 §3.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_intake_schemas_re_answer_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_question_ids text[];
  v_new_question_ids text[];
  v_changed_question_ids text[];
  v_added_question_ids text[];
  v_removed_question_ids text[];
  v_changed_questions_payload jsonb := '[]'::jsonb;
  v_removed_labels text[];
  v_affected_order record;
  v_question_label text;
  v_q jsonb;
BEGIN
  -- Only fire on UPDATE (not INSERT — no prior answers to re-ask)
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Skip if schema_version_id unchanged (no-op write)
  IF NEW.schema_version_id = OLD.schema_version_id THEN
    RETURN NEW;
  END IF;

  -- Extract old + new question IDs
  SELECT COALESCE(array_agg((q->>'id') ORDER BY q->>'id'), '{}'::text[])
    INTO v_old_question_ids
    FROM jsonb_array_elements(OLD.schema->'questions') q;

  SELECT COALESCE(array_agg((q->>'id') ORDER BY q->>'id'), '{}'::text[])
    INTO v_new_question_ids
    FROM jsonb_array_elements(NEW.schema->'questions') q;

  -- Added question IDs (in new, not in old)
  v_added_question_ids := COALESCE(
    (SELECT array_agg(q) FROM unnest(v_new_question_ids) q
     WHERE NOT (q = ANY (v_old_question_ids))),
    '{}'::text[]
  );

  -- Removed question IDs (in old, not in new)
  v_removed_question_ids := COALESCE(
    (SELECT array_agg(q) FROM unnest(v_old_question_ids) q
     WHERE NOT (q = ANY (v_new_question_ids))),
    '{}'::text[]
  );

  -- "Changed" = added + removed combined (sufficient for v1; per-question
  -- content edit detection deferred to ORCH-0881 follow-up if needed)
  v_changed_question_ids := array_cat(v_added_question_ids, v_removed_question_ids);

  IF array_length(v_changed_question_ids, 1) IS NULL THEN
    -- No structural change; skip notification dispatch
    RETURN NEW;
  END IF;

  -- Build changed_questions payload array (added entries with current label
  -- from new schema; removed entries get just the label from old schema)
  IF array_length(v_added_question_ids, 1) IS NOT NULL THEN
    FOR v_q IN
      SELECT q FROM jsonb_array_elements(NEW.schema->'questions') q
       WHERE (q->>'id') = ANY (v_added_question_ids)
    LOOP
      v_changed_questions_payload := v_changed_questions_payload
        || jsonb_build_array(jsonb_build_object(
          'question_id', v_q->>'id',
          'label', v_q->>'label',
          'change_kind', 'added'
        ));
    END LOOP;
  END IF;

  -- Build removed_labels array from old schema for context
  IF array_length(v_removed_question_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(q->>'label'), '{}'::text[])
      INTO v_removed_labels
      FROM jsonb_array_elements(OLD.schema->'questions') q
     WHERE (q->>'id') = ANY (v_removed_question_ids);
  ELSE
    v_removed_labels := '{}'::text[];
  END IF;

  -- For each affected order on this tier, INSERT into ticket_order_notifications
  -- so the ORCH-0788 retry-cron + ticket-confirmation-dispatch flow handles
  -- delivery (with retry semantics, channel selection, failed_terminal etc).
  FOR v_affected_order IN
    SELECT id, buyer_email
      FROM public.orders
     WHERE event_id = NEW.event_id
       AND intake_form_data IS NOT NULL
       AND payment_status NOT IN ('failed', 'cancelled')
       AND (intake_form_data->>'ticket_type_id')::uuid = NEW.ticket_type_id
       AND (intake_form_data->>'schema_version_id') = (OLD.schema_version_id)::text
       AND buyer_email IS NOT NULL
       AND char_length(buyer_email) > 0
  LOOP
    -- Defensive: check ticket_order_notifications table exists. It should —
    -- ORCH-0788 established it — but the existence guard means a future
    -- schema reorg doesn't break trip-edit transactions.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'ticket_order_notifications'
    ) THEN
      INSERT INTO public.ticket_order_notifications
        (order_id, channel, recipient, payload, status, attempt_count,
         next_attempt_at, created_at, updated_at)
      VALUES (
        v_affected_order.id,
        'email',
        v_affected_order.buyer_email,
        jsonb_build_object(
          'template_key', 'buyer_intake_form_re_answer_required',
          'ticket_type_id', NEW.ticket_type_id,
          'tier_name', COALESCE(
            (SELECT tt.name FROM public.ticket_types tt
              WHERE tt.id = NEW.ticket_type_id),
            'your ticket'
          ),
          'prior_schema_version_id', OLD.schema_version_id,
          'current_schema_version_id', NEW.schema_version_id,
          'changed_questions', v_changed_questions_payload,
          'removed_question_labels', to_jsonb(v_removed_labels),
          'reason',
            -- Pull most recent reason from trip_edit_log for this event +
            -- the diff_summary.intake_changed_tier_ids that includes this tier.
            -- Fallback to a generic copy if no row matches.
            COALESCE(
              (SELECT tel.reason
                 FROM public.trip_edit_log tel
                WHERE tel.event_id = NEW.event_id
                  AND tel.diff_summary->'intake_changed_tier_ids'
                      @> to_jsonb(NEW.ticket_type_id::text)
                ORDER BY tel.occurred_at DESC
                LIMIT 1),
              'Organizer updated the traveler intake form.'
            )
        ),
        'pending',
        0,
        now(),
        now(),
        now()
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger registration unchanged from Phase 1 — CREATE OR REPLACE the FUNCTION
-- only; the existing trigger named tg_trip_intake_schemas_re_answer continues
-- to bind to this updated function definition.

COMMENT ON FUNCTION public.tg_intake_schemas_re_answer_dispatch() IS
  'ORCH-0880 Tr5 Phase 2 rewrite: after a per-tier intake_schema UPDATE, INSERT into ticket_order_notifications queue with template_key=buyer_intake_form_re_answer_required + tier_name + changed_questions payload + removed_question_labels + reason (pulled from most recent trip_edit_log row touching this tier). ORCH-0788 retry-cron + ticket-confirmation-dispatch handle delivery. Defensive: ticket_order_notifications table existence checked so trigger never breaks parent UPDATE transactions. Per I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH (DRAFT → ACTIVE on ORCH-0880 CLOSE).';

-- ============================================================
-- Self-verification DO-block
-- ============================================================
DO $verify$
DECLARE
  v_func_source text;
BEGIN
  -- Assert the function source contains the canonical INSERT INTO ticket_order_notifications
  SELECT pg_get_functiondef(p.oid)
    INTO v_func_source
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'tg_intake_schemas_re_answer_dispatch';

  IF v_func_source IS NULL THEN
    RAISE EXCEPTION 'ORCH-0880 Phase 2 self-verify: tg_intake_schemas_re_answer_dispatch function missing';
  END IF;

  IF v_func_source NOT LIKE '%ticket_order_notifications%' THEN
    RAISE EXCEPTION 'ORCH-0880 Phase 2 self-verify: trigger function not rewritten to use ticket_order_notifications';
  END IF;

  IF v_func_source NOT LIKE '%buyer_intake_form_re_answer_required%' THEN
    RAISE EXCEPTION 'ORCH-0880 Phase 2 self-verify: trigger function missing template_key emission';
  END IF;

  RAISE NOTICE 'ORCH-0880 Phase 2 self-verify: trigger function rewritten to ticket_order_notifications PASS';
END
$verify$;

COMMIT;
