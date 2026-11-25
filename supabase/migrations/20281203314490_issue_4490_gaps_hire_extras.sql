-- Issue #4490, spec 07 C: let a private-hire offer sell the priced extras
-- that the quote and booking rails already understand.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 hire-extras patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking', 'set_flexible')$old$,
  $new$  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking', 'set_flexible', 'set_extras')$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  v_step integer;
BEGIN$old$,
  $new$  v_step integer;
  v_extras jsonb;
BEGIN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND w.stop_sell AND w.starts_at > now()
        AND r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible';
    END IF;

  ELSIF p_action = 'set_terms' THEN$old$,
  $new$      WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND w.stop_sell AND w.starts_at > now()
        AND r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible';
    END IF;

  ELSIF p_action = 'set_extras' THEN
    IF jsonb_typeof(COALESCE(p_payload->'extras', '[]'::jsonb)) <> 'array'
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'extras', '[]'::jsonb)) e
         WHERE jsonb_typeof(e) <> 'object'
            OR jsonb_typeof(e->'priceMinor') <> 'number'
       ) THEN
      RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
    END IF;
    -- Keep every supplied id because bookings point at it. A new extra gets
    -- the same short, stable id shape as package extras.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', COALESCE(NULLIF(e->>'id', ''), 'x' || substr(md5(gen_random_uuid()::text), 1, 10)),
        'name', btrim(COALESCE(e->>'name', '')),
        'price_minor', e->'priceMinor',
        'per', e->>'per') ORDER BY ord), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(COALESCE(p_payload->'extras', '[]'::jsonb))
      WITH ORDINALITY AS ex(e, ord);
    IF NOT public.issue_4490_extras_valid(v_extras) THEN
      RAISE EXCEPTION 'extras_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET extras = v_extras,
        version = version + 1,
        updated_at = now(),
        updated_by = v_uid
    WHERE id = v_offer.id
    RETURNING * INTO v_offer;

  ELSIF p_action = 'set_terms' THEN$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
