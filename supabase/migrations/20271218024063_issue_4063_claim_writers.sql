-- Issue #4063 / PR-2 / M2
-- Preserve old Business comp clients while making new clients state whether a
-- named guest intentionally has no contact. A name-only comp remains a valid
-- door-list ticket, but it cannot later be claimed by contact.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $rewrite$
DECLARE
  v_definition text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(
    'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure
  ) INTO v_definition;

  IF position('v_name_only boolean;' IN v_definition) > 0 THEN
    RAISE NOTICE 'issue_4063_comp_name_only=already_applied';
    RETURN;
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
  v_phone text;
  v_emails text[] := ARRAY[]::text[];$old$, $new$
  v_phone text;
  v_name_only boolean;
  v_emails text[] := ARRAY[]::text[];$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: declaration';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
       OR COALESCE(jsonb_typeof(v_guest -> 'phoneE164'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'plusOnes'), 'array') <> 'array' THEN$old$, $new$
       OR COALESCE(jsonb_typeof(v_guest -> 'phoneE164'), 'null') NOT IN ('string', 'null')
       OR COALESCE(jsonb_typeof(v_guest -> 'nameOnly'), 'boolean') <> 'boolean'
       OR COALESCE(jsonb_typeof(v_guest -> 'plusOnes'), 'array') <> 'array' THEN$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: guest_shape';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
    END IF;
    IF v_email IS NOT NULL THEN$old$, $new$
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
    END IF;
    -- #4063 nameOnly compatibility: an old client that omits the field and
    -- sends no contact keeps today's name-only behaviour. New clients are
    -- explicit, so false without contact and true with contact are refused.
    v_name_only := COALESCE(
      (v_guest ->> 'nameOnly')::boolean,
      v_email IS NULL AND v_phone IS NULL
    );
    IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
    ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
      RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
    END IF;
    IF v_email IS NOT NULL THEN$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: guest_contact';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
      'index', v_index, 'plusOneIndex', NULL, 'name', v_name,
      'email', v_email, 'phone', v_phone, 'partySize', 1));$old$, $new$
      'index', v_index, 'plusOneIndex', NULL, 'name', v_name,
      'email', v_email, 'phone', v_phone, 'partySize', 1,
      'nameOnly', v_name_only));$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: guest_people';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
         OR COALESCE(jsonb_typeof(v_po -> 'email'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'phoneE164'), 'null') NOT IN ('string', 'null') THEN$old$, $new$
         OR COALESCE(jsonb_typeof(v_po -> 'email'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'phoneE164'), 'null') NOT IN ('string', 'null')
         OR COALESCE(jsonb_typeof(v_po -> 'nameOnly'), 'boolean') <> 'boolean' THEN$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: plus_one_shape';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
      IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
      END IF;
      IF v_email IS NOT NULL THEN$old$, $new$
      IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{1,14}$' THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'phone';
      END IF;
      v_name_only := COALESCE(
        (v_po ->> 'nameOnly')::boolean,
        v_email IS NULL AND v_phone IS NULL
      );
      IF v_name_only AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'name_only_with_contact';
      ELSIF NOT v_name_only AND v_email IS NULL AND v_phone IS NULL THEN
        RAISE EXCEPTION 'invalid_guests' USING HINT = 'contact_required';
      END IF;
      IF v_email IS NOT NULL THEN$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: plus_one_contact';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
        'index', v_index, 'plusOneIndex', v_pi, 'name', v_name,
        'email', v_email, 'phone', v_phone, 'partySize', 1));$old$, $new$
        'index', v_index, 'plusOneIndex', v_pi, 'name', v_name,
        'email', v_email, 'phone', v_phone, 'partySize', 1,
        'nameOnly', v_name_only));$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: plus_one_people';
  END IF;

  v_before := v_definition;
  v_definition := replace(v_definition, $old$
          p_note => v_note,
          p_party_lead_order_id =>$old$, $new$
          p_note => v_note,
          p_metadata => CASE
            WHEN COALESCE((v_person ->> 'nameOnly')::boolean, false)
              THEN jsonb_build_object('name_only', true)
            ELSE NULL
          END,
          p_party_lead_order_id =>$new$);
  IF v_definition = v_before THEN
    RAISE EXCEPTION 'issue_4063_comp_writer_drift: metadata';
  END IF;

  EXECUTE v_definition;
END;
$rewrite$;

COMMENT ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) IS
  '#3827 + #4063: batch comp issue with explicit nameOnly validation. Omitted nameOnly plus no contact preserves old-client name-only behaviour and records metadata.name_only=true; explicit false requires a contact; explicit true forbids one.';

REVOKE ALL ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_comp_issue(
  uuid, uuid, uuid, uuid, jsonb, text, uuid, text
) TO service_role;

-- MINGLA-INVARIANT: I-4063-COMP-CONTACT-INTENT | issue #4063 | New comp writers explicitly choose contact or name-only; legacy omitted fields preserve name-only behaviour and carry metadata.name_only=true.

COMMIT;
NOTIFY pgrst, 'reload schema';
