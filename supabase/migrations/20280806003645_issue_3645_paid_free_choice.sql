-- Issue #3645 bundle 2C — the host's paid/free choice is stored apart from
-- the ticket, so a paid experience saved at 0 stays paid.
--
-- The experience writers (biz_create_experience, biz_publish_experience,
-- biz_update_live_experience) read is_free from the payload but stored it
-- nowhere: issue_3281_apply_experience_price_options writes the ticket as
-- is_free = (total = 0), and every reader took "free" from the first ticket.
-- So a paid draft saved at 0 read back as free (Host wizard, Ari) and could
-- later publish free without the host choosing free; and an experience with
-- a free first option beside a paid one read as free, so saving it back
-- resolved to 0 and was refused (experience_price_invalid).
--
-- Now:
--   * the three writers store the choice in theme.experience_meta.is_free
--     (issue_3645_theme_with_is_free creates experience_meta when missing);
--   * issue_3645_experience_is_free is the one read rule, used by
--     issue_1973_current_experience_payload (Ari's read-back and every
--     Ari update merge): any live option priced above 0 means paid; else
--     the stored choice; else today's derived value (first ticket, then
--     whole price 0), so a row saved before this keeps reading as it did.
--     The Host (experienceDetailService) and Ari's flow row
--     (ariFlows/edge.ts) mirror it.
--
-- Each live body is patched in place (the #4420 / #3645 2A pattern), one
-- declared line each, so earlier in-place patches are kept. Declared patches:
-- __tests__/issue_3645_paid_free_choice_patches.ts.
-- Proofs: __tests__/issue_3645_paid_free_choice.pg17.test.sql.
--
-- No backfill: a paid draft saved at 0 before this has already lost the
-- choice (its ticket says free) and keeps reading free until it is saved.

BEGIN;

-- Apply order: the bodies patched here are the bundle 2A ones
-- (20280801003645). Patched before 2A, the 2A re-patch would still apply, but
-- refuse loudly now rather than leave a mixed state.
DO $precondition$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.biz_publish_experience(uuid,jsonb,boolean)')
          AND p.prosrc LIKE '%issue #3645 bundle 2A%'
     ) THEN
    RAISE EXCEPTION 'issue_3645_2c_requires_20280801003645'
      USING HINT = 'Apply 20280801003645_issue_3645_per_stop_paid_price.sql first.';
  END IF;
END
$precondition$;

-- The theme with experience_meta.is_free set, creating experience_meta when
-- the theme has none (a nested jsonb_set would silently do nothing).
CREATE OR REPLACE FUNCTION public.issue_3645_theme_with_is_free(
  p_theme jsonb,
  p_is_free boolean
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_set(
    CASE WHEN jsonb_typeof(p_theme) = 'object' THEN p_theme ELSE '{}'::jsonb END,
    '{experience_meta}',
    CASE WHEN jsonb_typeof(p_theme -> 'experience_meta') = 'object'
      THEN p_theme -> 'experience_meta' ELSE '{}'::jsonb END
      || jsonb_build_object('is_free', p_is_free),
    true
  )
$function$;

-- Whether an experience is free: any live option priced above 0 means paid;
-- else the host's stored choice; else today's derived value.
CREATE OR REPLACE FUNCTION public.issue_3645_experience_is_free(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.ticket_types t
       WHERE t.event_id = e.id AND t.deleted_at IS NULL AND t.price_cents > 0
    ) THEN false
    WHEN jsonb_typeof(e.theme #> '{experience_meta,is_free}') = 'boolean'
      THEN (e.theme #>> '{experience_meta,is_free}')::boolean
    ELSE COALESCE(
      (SELECT t.is_free FROM public.ticket_types t
        WHERE t.event_id = e.id AND t.deleted_at IS NULL
        ORDER BY t.display_order, t.created_at LIMIT 1),
      e.whole_price_cents = 0
    )
  END
  FROM public.events e
  WHERE e.id = p_event_id
$function$;

REVOKE ALL ON FUNCTION public.issue_3645_theme_with_is_free(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3645_experience_is_free(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_theme_with_is_free(jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3645_experience_is_free(uuid) TO service_role;

-- Replaces p_old with p_new in the live definition. Refuses unless p_old
-- occurs exactly p_expected times; a no-op once applied (re-apply safe).
CREATE OR REPLACE FUNCTION pg_temp.issue_3645_2c_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_old_count = 0 AND v_new_count = p_expected THEN
    RETURN;
  END IF;
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_3645_2c_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- ─── declared patches (generated from __tests__/issue_3645_paid_free_choice_patches.ts) ───

-- biz_create_experience: a new experience stores the host's paid/free choice.
SELECT pg_temp.issue_3645_2c_patch(
  'public.biz_create_experience(uuid,jsonb,boolean)',
  $old$'tier_name', 'Standard',
        'when_draft', v_when_draft$old$,
  $new$'tier_name', 'Standard',
        'is_free', v_is_free,
        'when_draft', v_when_draft$new$,
  1
);

-- biz_publish_experience: a draft save or publish stores the host's paid/free choice.
SELECT pg_temp.issue_3645_2c_patch(
  'public.biz_publish_experience(uuid,jsonb,boolean)',
  $old$COALESCE(theme, '{}'::jsonb),
                            '{experience_meta,venue_text}',$old$,
  $new$public.issue_3645_theme_with_is_free(theme, v_is_free),
                            '{experience_meta,venue_text}',$new$,
  1
);

-- biz_update_live_experience: a live edit stores the host's paid/free choice.
SELECT pg_temp.issue_3645_2c_patch(
  'public.biz_update_live_experience(uuid,jsonb,text)',
  $old$COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',$old$,
  $new$public.issue_3645_theme_with_is_free(theme, v_is_free),
                          '{experience_meta,venue_text}',$new$,
  1
);

-- biz_update_live_experience: the sold-price lock compares a paid experience whose first option is free against its price, not 0.
SELECT pg_temp.issue_3645_2c_patch(
  'public.biz_update_live_experience(uuid,jsonb,text)',
  $old$    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN$old$,
  $new$    v_old_resolved := COALESCE(v_old_resolved, 0);
    -- issue #3645 bundle 2C: a paid experience whose first option is free
    -- (say, Kids 0 beside Adult) was sold at its whole price, not at 0. Only
    -- that case changes: it needs a live option actually priced above 0, so
    -- a re-priced ticket (or one re-priced to 0) still locks its real price.
    IF v_old_resolved = 0 AND EXISTS (
      SELECT 1 FROM public.ticket_types t
       WHERE t.event_id = p_event_id AND t.deleted_at IS NULL AND t.price_cents > 0
    ) THEN
      SELECT COALESCE(e.whole_price_cents, 0) INTO v_old_resolved
        FROM public.events e WHERE e.id = p_event_id;
    END IF;

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN$new$,
  1
);

-- issue_1973_current_experience_payload: the read-back says free from the one rule, not the first ticket.
SELECT pg_temp.issue_3645_2c_patch(
  'public.issue_1973_current_experience_payload(uuid)',
  $old$'is_free',COALESCE(v_ticket.is_free,v_event.whole_price_cents=0),$old$,
  $new$'is_free',public.issue_3645_experience_is_free(p_event_id),$new$,
  1
);

COMMIT;
