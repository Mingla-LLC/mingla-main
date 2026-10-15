-- Issue #3802 — keep the Team dashboard's established totals and add a
-- counts-only split for person, Claude and Codex outcomes.

DO $$
BEGIN
  PERFORM set_config(
    'issue3802.is_admin_user_hash',
    encode(digest(pg_get_functiondef('public.is_admin_user()'::regprocedure), 'sha256'), 'hex'),
    false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_team_summary(p_today date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v        record;
  v_utc    date := (now() AT TIME ZONE 'UTC')::date;
  v_today  date;
  v_month  date;
  v_week   timestamptz;
  v_new    bigint;
  v_people jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden: Only an owner or admin can open the team dashboard.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.crm_ctx();
  v_today := CASE WHEN p_today BETWEEN v_utc - 1 AND v_utc + 1 THEN p_today ELSE v_utc END;
  v_month := date_trunc('month', v_utc::timestamp)::date;
  v_week  := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*) INTO v_new
  FROM public.beta_access_leads l
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_records r
     WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
       AND (r.beta_lead_id = l.id OR r.name_key = public.crm_name_key(l.brand_name)));

  -- Every teammate, then anyone else who logged something this week (so no
  -- logged activity is hidden). The system is not a person.
  WITH people AS (
    SELECT d.email, d.role, d.status, 0 AS grp, (d.role = 'owner') AS is_owner
    FROM public.admin_team_directory() d
    UNION ALL
    SELECT DISTINCT a.actor_email, NULL::text, 'former'::text, 1, false
    FROM public.crm_activity a
    WHERE a.actor_email IS NOT NULL
      AND a.created_at >= v_week
      AND NOT EXISTS (SELECT 1 FROM public.admin_team_directory() d WHERE d.email = a.actor_email)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email,
           'display_name', public.crm_display_name(p.email),
           'role', p.role,
           'status', p.status,
           'touches', (SELECT count(*) FROM public.crm_activity a
                        WHERE a.actor_email = p.email AND a.kind = 'touch' AND a.created_at >= v_week),
           'touches_by', jsonb_build_object(
             'person', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'touch' AND a.created_at >= v_week AND a.via IS NULL),
             'claude', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'touch' AND a.created_at >= v_week AND a.via = 'claude'),
             'codex', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'touch' AND a.created_at >= v_week AND a.via = 'codex')),
           'stage_moves', (SELECT count(*) FROM public.crm_activity a
                            WHERE a.actor_email = p.email AND a.kind = 'stage_move' AND a.created_at >= v_week),
           'stage_moves_by', jsonb_build_object(
             'person', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'stage_move' AND a.created_at >= v_week AND a.via IS NULL),
             'claude', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'stage_move' AND a.created_at >= v_week AND a.via = 'claude'),
             'codex', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'stage_move' AND a.created_at >= v_week AND a.via = 'codex')),
           'added', (SELECT count(*) FROM public.crm_activity a
                      WHERE a.actor_email = p.email AND a.kind = 'created' AND a.created_at >= v_week),
           'added_by', jsonb_build_object(
             'person', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'created' AND a.created_at >= v_week AND a.via IS NULL),
             'claude', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'created' AND a.created_at >= v_week AND a.via = 'claude'),
             'codex', (SELECT count(*) FROM public.crm_activity a WHERE a.actor_email = p.email AND a.kind = 'created' AND a.created_at >= v_week AND a.via = 'codex')),
           'overdue', (SELECT count(*) FROM public.crm_records r
                        JOIN public.crm_record_owners o ON o.record_id = r.id AND o.owner_email = p.email
                       WHERE r.deleted_at IS NULL AND r.due_on < v_today
                         AND NOT COALESCE((public.crm_stage_def(r.pipeline, r.stage)->>'terminal')::boolean, false)),
           'due_today', (SELECT count(*) FROM public.crm_records r
                          JOIN public.crm_record_owners o ON o.record_id = r.id AND o.owner_email = p.email
                         WHERE r.deleted_at IS NULL AND r.due_on = v_today
                           AND NOT COALESCE((public.crm_stage_def(r.pipeline, r.stage)->>'terminal')::boolean, false)))
         ORDER BY p.grp, p.is_owner DESC, p.email), '[]'::jsonb)
    INTO v_people
  FROM people p;

  RETURN jsonb_build_object(
    'me', jsonb_build_object(
      'email', v.actor_email,
      'display_name', public.crm_display_name(v.actor_email),
      'role', public.admin_team_role()),
    'today', v_today,
    'month_start', v_month,
    'week_start', v_week,
    'stages', public.crm_stage_counts_json(),
    'due', public.crm_due_json(NULL, v_today, 200),
    'by_person', v_people,
    'targets', public.crm_targets_json(v_month),
    'beta_leads_new', v_new);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.crm_team_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_team_summary(date) TO authenticated, service_role;
COMMENT ON FUNCTION public.crm_team_summary(date) IS
  'Issue #3802. The team dashboard, for an owner or admin: stage counts, everything due across the team (up to 200 rows per pipeline, exact counts), this week by person since Monday 00:00 UTC, targets with progress, and beta leads not in Hosts yet, including counts-only person, Claude and Codex attribution.';

DO $$
DECLARE
  v_source text := pg_get_functiondef('public.crm_team_summary(date)'::regprocedure);
BEGIN
  IF current_setting('issue3802.is_admin_user_hash', true) IS NULL
     OR current_setting('issue3802.is_admin_user_hash', true) <> encode(digest(pg_get_functiondef('public.is_admin_user()'::regprocedure), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'issue3802_admin_gate_changed';
  END IF;
  IF (SELECT prokind <> 'f' OR provolatile <> 's' OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""']
        FROM pg_proc WHERE oid = 'public.crm_team_summary(date)'::regprocedure) THEN
    RAISE EXCEPTION 'issue3802_team_summary_contract_changed';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = 'public.crm_team_summary(date)'::regprocedure
         AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     ) OR has_function_privilege('anon', 'public.crm_team_summary(date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.crm_team_summary(date)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.crm_team_summary(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3802_team_summary_grants_changed';
  END IF;
  IF v_source !~ '''touches_by''' OR v_source !~ '''stage_moves_by''' OR v_source !~ '''added_by'''
     OR v_source ~* 'draft_text|message_body|request_args|result_json|key_digest' THEN
    RAISE EXCEPTION 'issue3802_outcome_bucket_contract_changed';
  END IF;
END;
$$;
