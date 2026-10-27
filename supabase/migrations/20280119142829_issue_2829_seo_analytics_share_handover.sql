-- #2829 W10 — analytics, private share-preview links and client handover.
--
-- 1. Analytics: five more consent-gated visitor events (offering_view already
--    existed), the page a visit landed on (for "top pages"), and one reader
--    the Business Website overview shows (visits, top pages, book clicks,
--    enquiries, bookings, sources). The older overview counter now answers
--    from the same reader, so the numbers have one owner.
-- 2. Private share-preview links: an owner or admin shares the site's draft
--    with someone outside the team (an agency's client) through an expiring,
--    revocable link. Core stores only a peppered digest of the token (the
--    token is minted where the pepper lives and shown once). The link shows
--    the site's newest built preview, which Studio reports after each build.
-- 3. Handover: when a team member's access to a brand ends (removed, demoted
--    below the editing rank, or no longer the account owner), their unused
--    Studio sign-in codes are revoked, their plan lock is released and the
--    share links they made stop working, with an audit row. Every Studio
--    request already re-checks the member's live rank with Core, so their
--    Studio session ends on its next request.
--
-- Forward-only. Writes no content.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Analytics ─────────────────────────────────────────────────────────
ALTER TABLE public.brand_site_analytics_events
  DROP CONSTRAINT IF EXISTS brand_site_analytics_events_event_name_check;
ALTER TABLE public.brand_site_analytics_events
  ADD CONSTRAINT brand_site_analytics_events_event_name_check CHECK (event_name IN (
    'site_view','page_view','cta_click','offering_view','reservation_start',
    'checkout_start','checkout_complete','contact_click','consent_granted','consent_denied',
    -- #2829 W10
    'book_click','form_submit_contact','form_submit_newsletter','outbound_click'
  ));
ALTER TABLE public.brand_site_analytics_events
  ADD COLUMN IF NOT EXISTS page_path text;
ALTER TABLE public.brand_site_analytics_events
  ADD CONSTRAINT brand_site_analytics_events_page_path_ck CHECK (
    page_path IS NULL OR (length(page_path) BETWEEN 1 AND 300 AND page_path ~ '^/[A-Za-z0-9._~/-]*$')
  );
CREATE INDEX IF NOT EXISTS brand_site_analytics_events_site_time_idx
  ON public.brand_site_analytics_events (site_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.brand_site_record_analytics_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_event_id uuid;
  v_occurred_at timestamptz;
BEGIN
  IF NOT public.brand_site_json_keys_allowed(
    p_event,
    ARRAY['event_name','occurred_at','site_id','brand_id','publication_id',
      'page_role','cta_kind','offering_id','referrer_class',
      'consent_policy_version','event_id','page_path']
  ) THEN RAISE EXCEPTION 'sites_validation_failed'; END IF;
  v_event_id := (p_event->>'event_id')::uuid;
  v_occurred_at := COALESCE((p_event->>'occurred_at')::timestamptz, now());
  IF v_occurred_at < now() - interval '24 hours' OR v_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites
    WHERE id = (p_event->>'site_id')::uuid
      AND brand_id = (p_event->>'brand_id')::uuid;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = (p_event->>'publication_id')::uuid
      AND site_id = v_site.id AND status = 'published';
  IF v_site.active_publication_id <> v_publication.id THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  INSERT INTO public.brand_site_analytics_events(
    event_id, site_id, brand_id, publication_id, event_name, occurred_at,
    page_role, cta_kind, offering_id, referrer_class, consent_policy_version, page_path
  ) VALUES (
    v_event_id, v_site.id, v_site.brand_id, v_publication.id,
    p_event->>'event_name', v_occurred_at, NULLIF(p_event->>'page_role',''),
    NULLIF(p_event->>'cta_kind',''), NULLIF(p_event->>'offering_id','')::uuid,
    NULLIF(p_event->>'referrer_class',''), p_event->>'consent_policy_version',
    NULLIF(p_event->>'page_path','')
  ) ON CONFLICT (event_id) DO NOTHING;
  RETURN jsonb_build_object('accepted', true, 'event_id', v_event_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_record_analytics_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_analytics_event(jsonb) TO service_role;

-- The Website overview's "Last 30 days" (rank >= 20). Only counts and
-- page addresses: no visitor identifiers exist to return.
CREATE OR REPLACE FUNCTION public.brand_site_customer_analytics(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand_id uuid;
  v_since timestamptz := now() - interval '30 days';
BEGIN
  SELECT brand_id INTO v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF v_brand_id IS NULL OR auth.uid() IS NULL
    OR public.biz_brand_effective_rank(v_brand_id, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'visits_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.event_name = 'site_view' AND e.occurred_at >= v_since),
    'page_views_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.event_name = 'page_view' AND e.occurred_at >= v_since),
    'top_pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('path', ranked.page_path, 'views', ranked.views)
        ORDER BY ranked.views DESC, ranked.page_path)
      FROM (
        SELECT e.page_path, count(*) AS views
        FROM public.brand_site_analytics_events e
        WHERE e.site_id = p_site_id AND e.event_name = 'page_view'
          AND e.page_path IS NOT NULL AND e.occurred_at >= v_since
        GROUP BY e.page_path
        ORDER BY count(*) DESC, e.page_path
        LIMIT 5
      ) ranked
    ), '[]'::jsonb),
    'book_clicks_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.event_name = 'book_click' AND e.occurred_at >= v_since),
    'outbound_clicks_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.event_name = 'outbound_click' AND e.occurred_at >= v_since),
    'form_submissions_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id
        AND e.event_name IN ('form_submit_contact','form_submit_newsletter')
        AND e.occurred_at >= v_since),
    -- Enquiries are #4111's records (Host Messages); this is only a count.
    'enquiries_30d', (SELECT count(*) FROM public.brand_enquiries q
      WHERE q.brand_id = v_brand_id AND q.source = 'site' AND q.created_at >= v_since),
    'bookings_30d', (SELECT count(*) FROM public.brand_site_attribution_touches t
      WHERE t.site_id = p_site_id AND t.consumed_at >= v_since),
    'sources', COALESCE((
      SELECT jsonb_object_agg(counted.referrer_class, counted.visits)
      FROM (
        SELECT e.referrer_class, count(*) AS visits
        FROM public.brand_site_analytics_events e
        WHERE e.site_id = p_site_id AND e.event_name = 'site_view'
          AND e.referrer_class IS NOT NULL AND e.occurred_at >= v_since
        GROUP BY e.referrer_class
      ) counted
    ), '{}'::jsonb),
    -- Kept for older callers (#2830 shape).
    'issued_handoffs', (SELECT count(*) FROM public.brand_site_attribution_touches t WHERE t.site_id = p_site_id),
    'consumed_handoffs', (SELECT count(*) FROM public.brand_site_attribution_touches t
      WHERE t.site_id = p_site_id AND t.consumed_at IS NOT NULL),
    'events_30d', (SELECT count(*) FROM public.brand_site_analytics_events e
      WHERE e.site_id = p_site_id AND e.occurred_at >= v_since),
    'generated_at', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_customer_analytics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_customer_analytics(uuid) TO authenticated;

-- One owner for the overview numbers: the W9r counter answers from the reader above.
CREATE OR REPLACE FUNCTION public.brand_site_overview_counts(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.brand_site_customer_analytics(p_site_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_overview_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_overview_counts(uuid) TO authenticated, service_role;

-- ── 2. Audit vocabulary ──────────────────────────────────────────────────
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
    'content.created','content.updated','content.reordered','content.visibility',
    'content.deleted','content.review_confirmed','content.review_unconfirmed',
    'content.offering_visibility','media.upload_requested','site.admin_requested',
    -- #2829 W10
    'share_link.created','share_link.revoked','member.access_ended'
  )),
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved','hostname',
        'publication_id','status_code','reachable','digest_ok','label',
        'dns_state','tls_state','registrar','host_kind',
        'revision','fields','part','pages','previous_holder',
        'collection','entry','visible','count','action',
        -- #2829 W10
        'ttl_days','exchanges_revoked','links_revoked','lock_released']
    )
  );

-- ── 3. The newest built preview of each site (reported by Studio) ────────
ALTER TABLE public.brand_sites
  ADD COLUMN IF NOT EXISTS latest_preview_artifact_key text,
  ADD COLUMN IF NOT EXISTS latest_preview_built_at timestamptz;
ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_latest_preview_key_ck CHECK (
    (latest_preview_artifact_key IS NULL AND latest_preview_built_at IS NULL)
    OR (latest_preview_built_at IS NOT NULL AND latest_preview_artifact_key ~
      ('^publications/' || id::text || '/preview-[0-9a-f]{32}/[0-9a-f]{64}\.json$'))
  );

CREATE OR REPLACE FUNCTION public.brand_site_record_preview_artifact(
  p_site_id uuid,
  p_artifact_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- #2829 W10 — only a preview object of THIS site (the key names the site).
  IF p_artifact_key IS NULL OR p_artifact_key !~ (
      '^publications/' || p_site_id::text || '/preview-[0-9a-f]{32}/[0-9a-f]{64}\.json$') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  UPDATE public.brand_sites
  SET latest_preview_artifact_key = p_artifact_key,
      latest_preview_built_at = clock_timestamp()
  WHERE id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  RETURN jsonb_build_object('site_id', p_site_id, 'recorded', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_record_preview_artifact(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_preview_artifact(uuid, text) TO service_role;

-- ── 4. Private share-preview links ───────────────────────────────────────
CREATE TABLE public.brand_site_preview_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  -- HMAC-SHA-256 of the token under the Sites pepper (the token is never stored).
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoke_reason text CHECK (revoke_reason IS NULL OR revoke_reason IN ('owner','member_access_ended')),
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  CONSTRAINT brand_site_preview_links_ttl_ck CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '14 days'
  ),
  CONSTRAINT brand_site_preview_links_revoked_ck CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX brand_site_preview_links_site_idx ON public.brand_site_preview_links (site_id, created_at DESC);
CREATE INDEX brand_site_preview_links_creator_idx ON public.brand_site_preview_links (created_by) WHERE revoked_at IS NULL;
ALTER TABLE public.brand_site_preview_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_preview_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_preview_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_preview_links TO service_role;

/*
 * Rank 50 (brand admin, owner). The token is minted by brand-site-control,
 * which holds the pepper and passes only the digest; it returns the token to
 * the owner once. At most 20 live links per site.
 */
CREATE OR REPLACE FUNCTION public.brand_site_create_preview_link(
  p_site_id uuid,
  p_ttl_days integer,
  p_token_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_link public.brand_site_preview_links%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  IF v_site.id IS NULL OR auth.uid() IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, auth.uid()) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_ttl_days IS NULL OR p_ttl_days < 1 OR p_ttl_days > 14
    OR p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF (SELECT count(*) FROM public.brand_site_preview_links link
      WHERE link.site_id = p_site_id AND link.revoked_at IS NULL
        AND link.expires_at > clock_timestamp()) >= 20 THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  -- One clock reading for both ends, so a 14-day link is exactly 14 days.
  v_now := clock_timestamp();
  INSERT INTO public.brand_site_preview_links(site_id, brand_id, token_digest, created_by, created_at, expires_at)
  VALUES (p_site_id, v_site.brand_id, p_token_digest, auth.uid(), v_now,
    v_now + make_interval(days => p_ttl_days))
  RETURNING * INTO v_link;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (p_site_id, v_site.brand_id, auth.uid(), 'user', 'share_link.created',
    'share_link', v_link.id::text, jsonb_build_object('ttl_days', p_ttl_days));
  RETURN jsonb_build_object(
    'id', v_link.id, 'site_id', p_site_id, 'created_at', v_link.created_at,
    'expires_at', v_link.expires_at,
    'preview_ready', v_site.latest_preview_artifact_key IS NOT NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_create_preview_link(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_create_preview_link(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.brand_site_revoke_preview_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link public.brand_site_preview_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.brand_site_preview_links WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL OR auth.uid() IS NULL
    OR public.biz_brand_effective_rank(v_link.brand_id, auth.uid()) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF v_link.revoked_at IS NULL THEN
    UPDATE public.brand_site_preview_links
    SET revoked_at = clock_timestamp(), revoked_by = auth.uid(), revoke_reason = 'owner'
    WHERE id = p_link_id;
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
      action, resource_kind, resource_id, metadata)
    VALUES (v_link.site_id, v_link.brand_id, auth.uid(), 'user', 'share_link.revoked',
      'share_link', v_link.id::text, jsonb_build_object('reason_code', 'OWNER'));
  END IF;
  RETURN jsonb_build_object('id', p_link_id, 'revoked', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_revoke_preview_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_revoke_preview_link(uuid) TO authenticated;

-- The site's links, newest first (rank 50). Never the token or its digest.
CREATE OR REPLACE FUNCTION public.brand_site_list_preview_links(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
BEGIN
  SELECT brand_id INTO v_brand FROM public.brand_sites WHERE id = p_site_id;
  IF v_brand IS NULL OR auth.uid() IS NULL
    OR public.biz_brand_effective_rank(v_brand, auth.uid()) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', link.id,
      'created_at', link.created_at,
      'expires_at', link.expires_at,
      'revoked_at', link.revoked_at,
      'last_viewed_at', link.last_viewed_at,
      'view_count', link.view_count,
      'created_by_name', public.brand_site_content_person_name(p_site_id, link.created_by),
      'state', CASE WHEN link.revoked_at IS NOT NULL THEN 'revoked'
        WHEN link.expires_at <= clock_timestamp() THEN 'expired' ELSE 'active' END
    ) ORDER BY link.created_at DESC)
    FROM (
      SELECT * FROM public.brand_site_preview_links l
      WHERE l.site_id = p_site_id
        AND (l.revoked_at IS NULL OR l.revoked_at > clock_timestamp() - interval '30 days')
        AND l.expires_at > clock_timestamp() - interval '30 days'
      ORDER BY l.created_at DESC LIMIT 50
    ) link
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_list_preview_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_list_preview_links(uuid) TO authenticated;

/*
 * Service role (the public runtime, through brand-site-runtime-resolve, for
 * the site Core resolved for the request host). Answers the site's newest
 * built preview for a live link of THAT site, or nothing.
 */
CREATE OR REPLACE FUNCTION public.brand_site_resolve_preview_link(
  p_site_id uuid,
  p_token_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link public.brand_site_preview_links%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
BEGIN
  IF p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.brand_site_preview_links
  WHERE token_digest = p_token_digest AND site_id = p_site_id
    AND revoked_at IS NULL AND expires_at > clock_timestamp()
  FOR UPDATE;
  IF v_link.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  IF v_site.latest_preview_artifact_key IS NULL THEN RETURN NULL; END IF;
  UPDATE public.brand_site_preview_links
  SET last_viewed_at = clock_timestamp(), view_count = view_count + 1
  WHERE id = v_link.id;
  RETURN jsonb_build_object(
    'link_id', v_link.id,
    'site_id', p_site_id,
    'artifact_key', v_site.latest_preview_artifact_key,
    'expires_at', v_link.expires_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_preview_link(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_preview_link(uuid, text) TO service_role;

-- ── 5. Handover: a member's access to the brand ends ─────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_end_member_access(
  p_brand_id uuid,
  p_user_id uuid,
  p_reason_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_exchanges integer := 0;
  v_links integer := 0;
  v_lock boolean := false;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL THEN RETURN; END IF;
  -- Still able to edit (another role, or the account owner): nothing ends.
  IF public.biz_brand_effective_rank(p_brand_id, p_user_id) >= 20 THEN RETURN; END IF;

  UPDATE public.brand_site_plans
  SET lock_holder = NULL, lock_expires_at = NULL
  WHERE brand_id = p_brand_id AND lock_holder = p_user_id;
  v_lock := FOUND;

  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  IF v_site.id IS NULL THEN RETURN; END IF;

  UPDATE public.brand_site_editor_exchanges
  SET status = 'revoked', revoked_at = now()
  WHERE site_id = v_site.id AND user_id = p_user_id AND status = 'issued';
  GET DIAGNOSTICS v_exchanges = ROW_COUNT;

  UPDATE public.brand_site_preview_links
  SET revoked_at = clock_timestamp(), revoke_reason = 'member_access_ended'
  WHERE site_id = v_site.id AND created_by = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (v_site.id, p_brand_id, auth.uid(), 'system', 'member.access_ended',
    'member', p_user_id::text,
    jsonb_build_object('reason_code', p_reason_code, 'exchanges_revoked', v_exchanges,
      'links_revoked', v_links, 'lock_released', v_lock));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_end_member_access(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.brand_site_member_change_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.brand_site_end_member_access(OLD.brand_id, OLD.user_id, 'MEMBER_REMOVED');
    RETURN OLD;
  END IF;
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    PERFORM public.brand_site_end_member_access(NEW.brand_id, NEW.user_id, 'MEMBER_REMOVED');
  ELSIF NEW.role IS DISTINCT FROM OLD.role OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    PERFORM public.brand_site_end_member_access(NEW.brand_id, NEW.user_id, 'MEMBER_DEMOTED');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_member_change_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_site_member_change ON public.brand_team_members;
CREATE TRIGGER brand_site_member_change
AFTER UPDATE OF removed_at, role, accepted_at OR DELETE ON public.brand_team_members
FOR EACH ROW EXECUTE FUNCTION public.brand_site_member_change_trigger();

CREATE OR REPLACE FUNCTION public.brand_site_owner_change_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.account_id IS NOT NULL AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    PERFORM public.brand_site_end_member_access(NEW.id, OLD.account_id, 'OWNER_CHANGED');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_owner_change_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS brand_site_owner_change ON public.brands;
CREATE TRIGGER brand_site_owner_change
AFTER UPDATE OF account_id ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.brand_site_owner_change_trigger();

COMMIT;
