-- #2829 W9r (SPEC §39 A23) — the Business app manages a website's content
-- collections (destinations, stories, reviews), hides individual past trips
-- from the site, asks an admin for owner-only steps, and remembers each
-- member's preview size.
--
--   * brand_site_content_min_rank     the minimum rank of every content action
--                                     (one list, read by Core and the tests)
--   * brand_site_content_authorize    customer JWT: entitlement + live rank for
--                                     one action on one site (Core's gate in
--                                     front of Studio's tenant-scoped APIs)
--   * brand_site_content_record       service role: the audit row after Studio
--                                     confirmed the change (never the words)
--   * brand_site_content_person_name  service role: who saved a newer version
--   * brand_site_request_admin        rank 20-49 "Ask an admin" (notification
--                                     business.site_admin_requested)
--   * brand_site_plan_status_internal "Approve" and "Build" are done for a
--                                     site that is live or predates the plan
--   * brand_site_overview_counts      "Last 30 days": visits, website
--                                     enquiries (count only), bookings
--   * business_user_ui_preferences    per-user UI preferences (only
--                                     website.previewDevice), own rows only
--
-- Forward-only. No row is created for any brand or user by this migration.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Audit vocabulary ───────────────────────────────────────────────────
ALTER TABLE public.brand_site_audit_log
  DROP CONSTRAINT brand_site_audit_log_action_check,
  DROP CONSTRAINT brand_site_audit_metadata_ck;
ALTER TABLE public.brand_site_audit_log
  ADD CONSTRAINT brand_site_audit_log_action_check CHECK (action IN (
    'site.provision_requested','site.provisioned','site.provision_failed',
    'editor.exchange_issued','editor.exchange_consumed','editor.sessions_revoked',
    'preview.requested','preview.created',
    'publication.requested','publication.published','publication.failed',
    'publication.reconciled','publication.rollback_requested',
    'publication.public_check','operation.reconcile_checked',
    'site.suspended','site.resumed','attribution.consumed',
    'pilot.activated','pilot.deactivated',
    'site.owner_offline','site.owner_online',
    'site.export_requested','site.export_ready',
    'entitlement.granted','entitlement.revoked','label.reserved',
    'host.set_primary','host.released',
    'domain.attached','domain.verifying','domain.activated',
    'domain.misconfigured','domain.recovered','domain.primary_fallback',
    'domain.detach_requested','domain.released','domain.mx_missing',
    'domain.tls_expiring',
    'plan.saved','plan.taken_over','plan.built','plan.start_requested',
    -- #2829 W9r
    'content.created','content.updated','content.reordered','content.visibility',
    'content.deleted','content.review_confirmed','content.review_unconfirmed',
    'content.offering_visibility','media.upload_requested','site.admin_requested'
  )),
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved','hostname',
        'publication_id','status_code','reachable','digest_ok','label',
        'dns_state','tls_state','registrar','host_kind',
        'revision','fields','part','pages','previous_holder',
        -- #2829 W9r
        'collection','entry','visible','count','action']
    )
  );

-- ── 2. Which rank each content action needs (one list) ───────────────────
CREATE OR REPLACE FUNCTION public.brand_site_content_min_rank(p_action text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_action IN (
      'list','get','create','update','reorder','set_visibility','delete',
      'categories','create_category','rename_category','reorder_categories',
      'delete_category','media_upload_grant','media_complete','media_status',
      'media_library','offerings','past_trips','font_search','font_previews','draft_changes','pages','set_menu','cover','set_cover'
    ) THEN 20
    -- Only brand admins and owners confirm a review is real (§37 answer 2)
    -- and hide a past trip from the website (§37 answer 3).
    WHEN p_action IN ('confirm_review','set_offering_visibility') THEN 50
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_min_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_min_rank(text) TO authenticated, service_role;

-- ── 3. The gate in front of Studio (customer JWT) ─────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_content_authorize(
  p_site_id uuid, p_action text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_min integer := public.brand_site_content_min_rank(p_action);
  v_site public.brand_sites%ROWTYPE;
  v_rank integer;
BEGIN
  IF v_actor IS NULL OR v_min IS NULL THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(v_site.brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, v_actor);
  IF v_rank IS NULL OR v_rank < v_min THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN jsonb_build_object(
    'site_id', v_site.id, 'brand_id', v_site.brand_id, 'user_id', v_actor,
    'rank', v_rank, 'min_rank', v_min
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_authorize(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_content_authorize(uuid, text) TO authenticated, service_role;

-- ── 4. The audit row, after Studio confirmed the change (service role) ────
CREATE OR REPLACE FUNCTION public.brand_site_content_record(
  p_site_id uuid,
  p_actor uuid,
  p_action text,
  p_collection text,
  p_entry text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_action NOT IN (
    'content.created','content.updated','content.reordered','content.visibility',
    'content.deleted','content.review_confirmed','content.review_unconfirmed',
    'content.offering_visibility','media.upload_requested'
  ) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_collection IS NOT NULL AND p_collection NOT IN (
    'destinations','stories','testimonials','categories','media','offerings','navigation'
  ) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_entry IS NOT NULL AND p_entry !~ '^[A-Za-z0-9-]{1,64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT brand_id INTO v_brand FROM public.brand_sites WHERE id = p_site_id;
  IF v_brand IS NULL THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (p_site_id, v_brand, p_actor, 'user', p_action, 'site_content',
    left(COALESCE(p_collection, 'site') || ':' || COALESCE(p_entry, '-'), 128),
    v_meta
      || CASE WHEN p_collection IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('collection', p_collection) END
      || CASE WHEN p_entry IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('entry', p_entry) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_record(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_content_record(uuid, uuid, text, text, text, jsonb) TO service_role;

-- Who saved a newer version: their team name, never an email. Only for a
-- member of this site's brand (anyone else reads as "A teammate").
CREATE OR REPLACE FUNCTION public.brand_site_content_person_name(p_site_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_user_id IS NOT NULL AND public.biz_brand_effective_rank(s.brand_id, p_user_id) >= 20
      THEN public.brand_site_plan_person_name(p_user_id)
    ELSE 'A teammate'
  END
  FROM public.brand_sites s WHERE s.id = p_site_id;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_person_name(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_content_person_name(uuid, uuid) TO service_role;

-- ── 5. "Ask an admin" for owner-only website steps ────────────────────────
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.site_admin_requested', 'business', true, 'normal',
    ARRAY['inapp', 'push']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.brand_site_request_admin(p_brand_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_name text;
  v_brand_name text;
  v_user uuid;
  v_sent integer := 0;
  v_recipients integer := 0;
  v_rows integer;
  v_what text;
  v_section text;
BEGIN
  v_what := CASE p_action
    WHEN 'publish' THEN 'publish the website'
    WHEN 'restore' THEN 'restore an earlier version of the website'
    WHEN 'confirm_review' THEN 'confirm a review is real'
    WHEN 'domain' THEN 'change the website''s addresses'
    WHEN 'offline' THEN 'change whether the website is online'
    WHEN 'download' THEN 'download the website'
    WHEN 'past_trip' THEN 'hide or show a past trip on the website'
    WHEN 'plan' THEN 'finish a step of the website setup plan'
    ELSE NULL END;
  v_section := CASE p_action
    WHEN 'publish' THEN 'publish' WHEN 'restore' THEN 'publish'
    WHEN 'confirm_review' THEN 'reviews' WHEN 'domain' THEN 'addresses'
    WHEN 'offline' THEN 'settings' WHEN 'download' THEN 'settings'
    WHEN 'past_trip' THEN 'past' WHEN 'plan' THEN 'plan' END;
  IF v_what IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  -- Members who can edit but not do the step themselves (marketing 20,
  -- event manager 40). Admins and owners do it; finance and scanners have no
  -- website.
  IF v_actor IS NULL OR v_rank IS NULL OR v_rank < 20 OR v_rank >= 50 OR v_rank = 30 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_not_entitled';
  END IF;
  v_name := public.brand_site_plan_person_name(v_actor);
  SELECT name INTO v_brand_name FROM public.brands WHERE id = p_brand_id;
  FOR v_user IN
    SELECT DISTINCT candidate.user_id FROM (
      SELECT brand.account_id AS user_id FROM public.brands brand WHERE brand.id = p_brand_id
      UNION
      SELECT member.user_id FROM public.brand_team_members member
      WHERE member.brand_id = p_brand_id AND member.removed_at IS NULL
        AND member.accepted_at IS NOT NULL
    ) candidate
    WHERE candidate.user_id IS NOT NULL
      AND public.biz_brand_effective_rank(p_brand_id, candidate.user_id) >= 50
  LOOP
    INSERT INTO public.notification_outbox(
      category_key, user_id, brand_id, payload, idempotency_key
    ) VALUES (
      'business.site_admin_requested', v_user, p_brand_id,
      jsonb_build_object(
        'title', 'Your team needs you on the website',
        'body', v_name || ' asked you to ' || v_what || ' for ' ||
          COALESCE(v_brand_name, 'your brand') || '.',
        'brand_id', p_brand_id,
        'deep_link', 'mingla-business://brand/' || p_brand_id || '/website/' || v_section),
      'site-admin:' || p_brand_id || ':' || p_action || ':' || v_actor || ':' ||
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ':' || v_user
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_sent := v_sent + v_rows;
    v_recipients := v_recipients + 1;
  END LOOP;
  IF v_recipients = 0 THEN
    RAISE EXCEPTION 'sites_no_admin';
  END IF;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES ((SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id), p_brand_id,
    v_actor, 'user', 'site.admin_requested', 'brand_site', p_brand_id::text,
    jsonb_build_object('action', p_action));
  RETURN jsonb_build_object('notified', v_sent, 'admins', v_recipients,
    'already_asked', v_sent = 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_request_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_request_admin(uuid, text) TO authenticated, service_role;

-- The scope check allows a brand-only row for this action (a brand may ask
-- before its site exists only for plan steps).
ALTER TABLE public.brand_site_audit_log DROP CONSTRAINT brand_site_audit_log_scope_ck;
ALTER TABLE public.brand_site_audit_log
  ADD CONSTRAINT brand_site_audit_log_scope_ck CHECK (
    (site_id IS NOT NULL AND brand_id IS NOT NULL)
    OR (site_id IS NULL AND brand_id IS NOT NULL AND action IN (
      'entitlement.granted','entitlement.revoked',
      'plan.saved','plan.taken_over','plan.start_requested','site.admin_requested'
    ))
    OR (site_id IS NULL AND brand_id IS NULL AND action = 'label.reserved')
  );

-- ── 6. The plan never contradicts the live site (server truth) ───────────
CREATE OR REPLACE FUNCTION public.brand_site_plan_status_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.brand_site_plans%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_done jsonb;
  v_needed text[];
  v_kinds text[];
  v_first boolean;
  v_kind text;
  v_parts jsonb := '[]'::jsonb;
  v_part text;
  v_next text;
  v_count integer := 0;
  v_site_predates_plan boolean;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_site_predates_plan := v_site.id IS NOT NULL AND (
    v_site.last_successful_publication_id IS NOT NULL
    OR v_plan.brand_id IS NULL
    OR v_site.created_at < v_plan.started_at);
  -- Not answered yet: what Mingla already knows the brand offers.
  v_plan.offerings_selected := COALESCE(v_plan.offerings_selected,
    public.brand_site_plan_prefill_offerings(p_brand_id));

  v_needed := public.brand_site_plan_offering_pages(v_plan.offerings_selected);
  v_kinds := ARRAY(SELECT unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[]))
    INTERSECT SELECT unnest(ARRAY['trips','events','experiences']));
  v_first := cardinality(v_kinds) > 0;
  FOREACH v_kind IN ARRAY v_kinds LOOP
    IF public.brand_site_plan_offering_count(p_brand_id, v_kind, false) = 0 THEN
      v_first := false;
    END IF;
  END LOOP;

  v_done := jsonb_build_object(
    'offer', v_plan.offerings_selected IS NOT NULL,
    'brand', NULLIF(btrim(COALESCE(v_brand.name, '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.description, '')), '') IS NOT NULL,
    'look', (v_site.id IS NOT NULL AND v_site.design_key IS NOT NULL
      AND v_site.tokens_saved_at IS NOT NULL)
      OR 'look' = ANY (COALESCE(v_plan.skipped_parts, ARRAY[]::text[])),
    'story', v_plan.story IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'who', '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'why', '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_plan.story->>'main_action', '')), '') IS NOT NULL,
    -- #2829 W9r (DESIGN_SPEC §1.6 server truth): a site that is already
    -- live, or was made before this plan began, satisfies "Approve" and
    -- "Build" — the plan never contradicts the live site or offers to build
    -- what exists. A draft the plan itself is building still needs both.
    'approve', (v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL)
      OR v_site_predates_plan,
    'build', (v_site.id IS NOT NULL AND v_plan.built_at IS NOT NULL
      AND v_plan.offerings_selected IS NOT NULL
      AND v_needed <@ COALESCE(v_plan.built_pages, ARRAY[]::text[]))
      OR v_site_predates_plan,
    'first_offering', v_first
      OR 'first_offering' = ANY (COALESCE(v_plan.skipped_parts, ARRAY[]::text[])),
    'publish', v_site.last_successful_publication_id IS NOT NULL
  );

  FOREACH v_part IN ARRAY public.brand_site_plan_parts() LOOP
    v_parts := v_parts || jsonb_build_object(
      'key', v_part,
      'done', (v_done->>v_part)::boolean,
      'skipped', v_part = ANY (COALESCE(v_plan.skipped_parts, ARRAY[]::text[])),
      'optional', v_part = 'first_offering'
    );
    IF (v_done->>v_part)::boolean THEN
      v_count := v_count + 1;
    ELSIF v_next IS NULL THEN
      v_next := v_part;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('parts', v_parts, 'done_count', v_count, 'next_part', v_next);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_status_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_status_internal(uuid) TO service_role;

-- ── 7. Per-user UI preferences (own rows only) ────────────────────────────
CREATE TABLE public.business_user_ui_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('website.previewDevice')),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key),
  CONSTRAINT business_user_ui_preferences_value_ck CHECK (
    key <> 'website.previewDevice' OR (
      jsonb_typeof(value) = 'object'
      -- (no helper call: members insert their own row, so the check must use
      -- only built-ins they can run)
      AND (value - 'device' - 'tablet' - 'phone') = '{}'::jsonb
      AND value->>'device' IN ('desktop','tablet','phone')
      AND COALESCE(value->>'tablet', 'portrait') IN ('portrait','landscape')
      AND COALESCE(value->>'phone', 'portrait') IN ('portrait','landscape')
    )
  )
);
ALTER TABLE public.business_user_ui_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_user_ui_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_user_ui_preferences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_user_ui_preferences TO authenticated;
GRANT ALL ON public.business_user_ui_preferences TO service_role;
CREATE POLICY business_user_ui_preferences_own_select ON public.business_user_ui_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY business_user_ui_preferences_own_insert ON public.business_user_ui_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY business_user_ui_preferences_own_update ON public.business_user_ui_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY business_user_ui_preferences_own_delete ON public.business_user_ui_preferences
  FOR DELETE TO authenticated USING (user_id = auth.uid());
COMMENT ON TABLE public.business_user_ui_preferences IS
  '#2829 W9r — per-user Business app UI preferences (only website.previewDevice: the draft preview size, remembered across brands, sessions and devices). Each member reads and writes only their own rows.';

-- ── 8. "Last 30 days" on the Website overview (counts only) ──────────────
-- Visits (site views), enquiries that came from the website (#4111's rows,
-- counted, never copied) and bookings that started on the website (consumed
-- attribution handoffs). Rank 20+ of the site's brand.
CREATE OR REPLACE FUNCTION public.brand_site_overview_counts(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
BEGIN
  SELECT brand_id INTO v_brand FROM public.brand_sites WHERE id = p_site_id;
  IF v_brand IS NULL OR auth.uid() IS NULL
    OR public.biz_brand_effective_rank(v_brand, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'visits_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.event_name = 'site_view'
        AND e.occurred_at >= now() - interval '30 days'),
    'enquiries_30d', (SELECT count(*) FROM public.brand_enquiries q
      WHERE q.brand_id = v_brand AND q.source = 'site'
        AND q.created_at >= now() - interval '30 days'),
    'bookings_30d', (SELECT count(*) FROM public.brand_site_attribution_touches t
      WHERE t.site_id = p_site_id AND t.consumed_at >= now() - interval '30 days'),
    'generated_at', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_overview_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_overview_counts(uuid) TO authenticated, service_role;

COMMIT;
