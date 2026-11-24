-- Issue #4571 last three leftovers.
--   1. crm_team_pulse (#4130): the Team dashboard counts a card only while it
--      is on the board. A card archived after it went live (or was contacted,
--      or moved) no longer counts, the same way crm_records_list and the call
--      queue leave archived cards out.
--   2. ops_brand_exact_rows (#3980): an exact email, handle or phone match
--      never picks an archived card, so ops_brand_match, ops_brand_new_exact
--      and the cron (ops_brand_autolink) never attach a brand to one.
-- Both are CREATE OR REPLACE with the same signatures and grants.
--
-- INVARIANT crm-archived-not-counted | gate crm_team_pulse + ops_brand_exact_rows (archived_at IS NULL) | test issue_4571_leftovers.implementor.pg17.test.sql

CREATE OR REPLACE FUNCTION public.crm_team_pulse(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_len interval;
  v_now jsonb;
  v_before jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can open the team dashboard.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '92 days' OR p_to > now() + interval '1 day' THEN
    RAISE EXCEPTION 'invalid_query: Pick a period of at most 92 days that has started.' USING ERRCODE = '22023';
  END IF;
  v_len := p_to - p_from;

  SELECT jsonb_object_agg(k.which, k.body) INTO v_now FROM (
    SELECT b.which, jsonb_build_object(
      'hosts_contacted', (SELECT count(DISTINCT a.record_id) FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                           WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.archived_at IS NULL AND a.created_at >= b.f AND a.created_at < b.t
                             AND ((a.kind = 'touch' AND a.direction = 'outbound') OR (a.kind = 'stage_move' AND a.to_stage = 'contacted'))),
      'hosts_onboarded', (SELECT count(DISTINCT a.record_id) FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                           WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.archived_at IS NULL AND a.kind = 'stage_move' AND a.to_stage IN ('onboarded', 'live')
                             AND a.created_at >= b.f AND a.created_at < b.t),
      'moves', jsonb_build_object(
        'hosts', COALESCE((SELECT jsonb_object_agg(m.to_stage, m.n) FROM (
                    SELECT a.to_stage, count(DISTINCT a.record_id) AS n FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                     WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.archived_at IS NULL AND a.kind = 'stage_move' AND a.created_at >= b.f AND a.created_at < b.t
                     GROUP BY a.to_stage) m), '{}'::jsonb),
        'creators', COALESCE((SELECT jsonb_object_agg(m.to_stage, m.n) FROM (
                    SELECT a.to_stage, count(DISTINCT a.record_id) AS n FROM public.crm_activity a JOIN public.crm_records r ON r.id = a.record_id
                     WHERE r.pipeline = 'creators' AND r.deleted_at IS NULL AND r.archived_at IS NULL AND a.kind = 'stage_move' AND a.created_at >= b.f AND a.created_at < b.t
                     GROUP BY a.to_stage) m), '{}'::jsonb)),
      'beta_leads', (SELECT count(*) FROM public.beta_access_leads l WHERE l.created_at >= b.f AND l.created_at < b.t)) AS body
    FROM (VALUES ('now', p_from, p_to), ('before', p_from - v_len, p_from)) b(which, f, t)
  ) k;
  v_before := v_now->'before';
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'now', v_now->'now', 'before', v_before);
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_brand_exact_rows(p_idents jsonb, p_country text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  WITH x AS MATERIALIZED (
          SELECT i.record_id, i.kind, i.platform
            FROM jsonb_array_elements(COALESCE(p_idents, '[]'::jsonb)) w
            JOIN public.crm_record_identifiers i ON i.kind = 'email' AND i.value_key = w->>'value_key'
           WHERE w->>'kind' = 'email'
          UNION ALL
          SELECT i.record_id, i.kind, i.platform
            FROM jsonb_array_elements(COALESCE(p_idents, '[]'::jsonb)) w
            JOIN public.crm_record_identifiers i ON i.kind = 'handle' AND i.value_key = w->>'value_key'
           WHERE w->>'kind' = 'handle' AND i.platform IS NOT NULL AND i.platform = w->>'platform'
          UNION ALL
          SELECT i.record_id, i.kind, i.platform
            FROM jsonb_array_elements(COALESCE(p_idents, '[]'::jsonb)) w
            JOIN public.crm_record_identifiers i
              ON i.national IS NOT NULL AND right(i.national, 6) = right(public.crm_phone_national(w->>'value_key'), 6)
           WHERE w->>'kind' = 'phone' AND i.kind = 'phone'
             AND public.ops_phone_same(i.value_key, public.ops_record_country(i.record_id), w->>'value_key', p_country))
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', x.record_id, 'kind', x.kind, 'platform', x.platform)), '[]'::jsonb)
    FROM x JOIN public.crm_records c ON c.id = x.record_id AND c.pipeline = 'hosts' AND c.deleted_at IS NULL
                          AND c.archived_at IS NULL
$$;
