-- #2829 W11 (A24) — Core never invents a person's name. When a member has no
-- name on their profile, the website reads answer NULL (lock holder, who
-- started the plan, who saved a newer version, who made a share link, who
-- published), and the app owns the fallback wording ("Someone", "your
-- teammate"). Before this, Core answered the literal "A teammate", which the
-- app could not tell apart from a real name. The two admin notifications are
-- written by Core, so their sentence keeps its own fallback words.
-- Do NOT apply here — orchestrator owns production apply.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- Who a member is to the team: their profile name, else NULL (never an email
-- address, never a made-up label).
CREATE OR REPLACE FUNCTION public.brand_site_plan_person_name(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(profile.display_name), ''),
    NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '')
  )
  FROM (SELECT p_user_id AS id) wanted
  LEFT JOIN public.profiles profile ON profile.id = wanted.id;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_person_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_person_name(uuid) TO service_role;

-- Who saved a newer version: their team name, never an email. Only for a
-- member of this site's brand; anyone else, or a member with no name, is NULL.
CREATE OR REPLACE FUNCTION public.brand_site_content_person_name(p_site_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_user_id IS NOT NULL AND public.biz_brand_effective_rank(s.brand_id, p_user_id) >= 20
      THEN public.brand_site_plan_person_name(p_user_id)
    ELSE NULL
  END
  FROM public.brand_sites s WHERE s.id = p_site_id;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_content_person_name(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_content_person_name(uuid, uuid) TO service_role;

-- The admin notifications are Core's own sentences: unchanged except that a
-- nameless member reads "A teammate" here (and only here).
CREATE OR REPLACE FUNCTION public.brand_site_request_start(p_brand_id uuid)
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
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  -- Marketing (20) and event managers (40); finance (30) and scanners (10)
  -- have no website item.
  IF v_actor IS NULL OR v_rank NOT IN (20, 40) THEN
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
      'business.site_start_requested', v_user, p_brand_id,
      jsonb_build_object(
        'title', 'Your team wants a website',
        'body', COALESCE(v_name, 'A teammate') || ' asked you to start ' || COALESCE(v_brand_name, 'your brand') ||
          '''s website. Open Build your website on your Home to-do list.',
        'brand_id', p_brand_id),
      'site-start:' || p_brand_id || ':' || v_actor || ':' ||
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
    v_actor, 'user', 'plan.start_requested', 'brand_site_plan', p_brand_id::text, '{}'::jsonb);
  -- already_asked: every admin already has today's notice from this person.
  RETURN jsonb_build_object('notified', v_sent, 'admins', v_recipients,
    'already_asked', v_sent = 0);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_request_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_request_start(uuid) TO authenticated, service_role;

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
        'body', COALESCE(v_name, 'A teammate') || ' asked you to ' || v_what || ' for ' ||
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

COMMIT;
