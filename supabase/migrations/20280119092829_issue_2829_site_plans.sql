-- #2829 W9a (AD-11, Phase 3) — the website plan, saved per brand.
--
-- The 8-part plan a brand works through to get a website ("Build your
-- website" on the Home to-do list) lives here, OUTSIDE any chat: the Business
-- plan screen drives it whatever state Ari is in (#3355 owns Ari's loop).
--
--   * brand_site_plans           one row per brand; revision compare-and-set;
--                                a 10-minute lock with take-over
--   * brand_site_plan_status     the 8 done-checks, computed from Mingla's
--                                own state (server truth, never the client)
--   * brand_site_plan_get        plan + status + lock, rank 20 and above
--   * brand_site_plan_save       allowlisted keys; rank 50 except active_part
--   * brand_site_plan_heartbeat  takes or renews a free lock (rank 50)
--   * brand_site_plan_take_over  rank 50
--   * brand_site_plan_authorize_compose / brand_site_plan_record_build
--                                "Create website draft" (rank 50; the build
--                                is recorded only after Studio confirmed it)
--   * brand_site_record_look_saved  Studio reports the first look save
--   * brand_site_request_start   rank 20-49 "Ask an admin to start it"
--                                (notification business.site_start_requested)
--
-- Forward-only. No row is created for any brand by this migration.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Columns Studio reports into ─────────────────────────────────────────
ALTER TABLE public.brand_sites
  ADD COLUMN tokens_saved_at timestamptz;

-- ── 2. The plan ────────────────────────────────────────────────────────────
-- Part keys, in plan order. Kept in one function so every check and every
-- refusal reads the same list.
CREATE OR REPLACE FUNCTION public.brand_site_plan_parts()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['offer','brand','look','story','approve','build','first_offering','publish'];
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_parts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_parts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_plan_offering_keys()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['trips','events','experiences','venue_food_drink','venue_play',
    'venue_creative_arts','venue_stay'];
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_offering_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_offering_keys() TO authenticated, service_role;

-- A text map whose keys are all allowed and whose values are strings of at
-- most p_max characters.
CREATE OR REPLACE FUNCTION public.brand_site_plan_text_map_ok(
  p_value jsonb, p_keys text[], p_max integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object'
    AND public.brand_site_json_keys_allowed(p_value, p_keys)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_value) AS entry
      WHERE jsonb_typeof(entry.value) <> 'string'
        OR length(entry.value #>> '{}') > p_max
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_text_map_ok(jsonb, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_text_map_ok(jsonb, text[], integer) TO service_role;

CREATE TABLE public.brand_site_plans (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  -- NULL = not answered yet; an empty array = "nothing yet" (part 1 is done).
  offerings_selected text[]
    CHECK (offerings_selected IS NULL OR (
      offerings_selected <@ public.brand_site_plan_offering_keys()
      AND cardinality(offerings_selected) <= 7
    )),
  venue_descriptor text CHECK (venue_descriptor IS NULL OR length(venue_descriptor) BETWEEN 1 AND 60),
  story jsonb CHECK (public.brand_site_plan_text_map_ok(story, ARRAY['who','why','main_action'], 300)),
  approved_plan jsonb CHECK (public.brand_site_plan_text_map_ok(
    approved_plan, ARRAY['for','leads_with','main_action','look','pages','wont_do'], 300)),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  skipped_parts text[] NOT NULL DEFAULT '{}'
    CHECK (skipped_parts <@ ARRAY['look','first_offering']),
  active_part text CHECK (active_part IS NULL OR active_part = ANY (public.brand_site_plan_parts())),
  -- What "Create website draft" built (page keys), recorded after Studio confirmed it.
  built_pages text[] CHECK (built_pages IS NULL OR (
    built_pages <@ ARRAY['home','trips','events','experiences','menu','visit','rooms','about','contact']
  )),
  built_at timestamptz,
  lock_holder uuid REFERENCES auth.users(id),
  lock_expires_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT brand_site_plans_approval_ck CHECK (
    (approved_at IS NULL) = (approved_by IS NULL)
    AND (approved_at IS NULL OR approved_plan IS NOT NULL)
  ),
  CONSTRAINT brand_site_plans_lock_ck CHECK ((lock_holder IS NULL) = (lock_expires_at IS NULL))
);
ALTER TABLE public.brand_site_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_site_plans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_site_plans TO service_role;

-- ── 3. Audit and receipts vocabularies (a plan exists before its site) ────
ALTER TABLE public.brand_site_audit_log
  DROP CONSTRAINT brand_site_audit_log_action_check,
  DROP CONSTRAINT brand_site_audit_log_scope_ck,
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
    'plan.saved','plan.taken_over','plan.built','plan.start_requested'
  )),
  ADD CONSTRAINT brand_site_audit_log_scope_ck CHECK (
    (site_id IS NOT NULL AND brand_id IS NOT NULL)
    OR (site_id IS NULL AND brand_id IS NOT NULL AND action IN (
      'entitlement.granted','entitlement.revoked',
      'plan.saved','plan.taken_over','plan.start_requested'
    ))
    OR (site_id IS NULL AND brand_id IS NULL AND action = 'label.reserved')
  ),
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved','hostname',
        'publication_id','status_code','reachable','digest_ok','label',
        'dns_state','tls_state','registrar','host_kind',
        'revision','fields','part','pages','previous_holder']
    )
  );

-- ── 4. Notification for "Ask an admin to start it" ─────────────────────────
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.site_start_requested', 'business', true, 'normal',
    ARRAY['inapp', 'push']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

-- ── 5. Helpers ─────────────────────────────────────────────────────────────
-- Who a member is to the team: their profile name, else "A teammate" (never
-- an email address).
CREATE OR REPLACE FUNCTION public.brand_site_plan_person_name(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    NULLIF(btrim(profile.display_name), ''),
    NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    'A teammate'
  )
  FROM (SELECT p_user_id AS id) wanted
  LEFT JOIN public.profiles profile ON profile.id = wanted.id;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_person_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_person_name(uuid) TO service_role;

-- Public, not deleted, published offerings of one plan offering kind.
-- p_live_only: also not ended and not cancelled (the "you have 2 live events"
-- warning). Venue kinds have no offering pages yet: always 0.
CREATE OR REPLACE FUNCTION public.brand_site_plan_offering_count(
  p_brand_id uuid, p_kind text, p_live_only boolean
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
  FROM public.events event
  WHERE event.brand_id = p_brand_id
    AND event.deleted_at IS NULL
    AND event.visibility IN ('public','discover')
    AND event.status <> 'draft'
    AND (NOT p_live_only OR event.status IN ('scheduled','live'))
    AND event.event_type = ANY (CASE p_kind
      WHEN 'trips' THEN ARRAY['trip']
      WHEN 'events' THEN ARRAY['event','rsvp']
      WHEN 'experiences' THEN ARRAY['experience']
      ELSE ARRAY[]::text[] END);
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_offering_count(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_offering_count(uuid, text, boolean) TO service_role;

-- What Mingla already knows the brand offers: the offering kinds with at
-- least one public offering, or NULL when it has none (an empty profile is
-- pre-filled with nothing). A brand with live trips opens its plan with
-- "What you'll offer" already answered (design contract: every path).
CREATE OR REPLACE FUNCTION public.brand_site_plan_prefill_offerings(p_brand_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(ARRAY(
    SELECT kind FROM unnest(ARRAY['trips','events','experiences']) WITH ORDINALITY AS k(kind, position)
    WHERE public.brand_site_plan_offering_count(p_brand_id, kind, false) > 0
    ORDER BY position
  ), ARRAY[]::text[]);
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_prefill_offerings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_prefill_offerings(uuid) TO service_role;

-- The pages a plan's offerings ask for (M1 vocabulary).
CREATE OR REPLACE FUNCTION public.brand_site_plan_offering_pages(p_offerings text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT page), ARRAY[]::text[])
  FROM unnest(COALESCE(p_offerings, ARRAY[]::text[])) AS offering
  CROSS JOIN LATERAL (SELECT CASE offering
    WHEN 'trips' THEN 'trips'
    WHEN 'events' THEN 'events'
    WHEN 'experiences' THEN 'experiences'
    WHEN 'venue_food_drink' THEN 'menu'
    WHEN 'venue_play' THEN 'visit'
    WHEN 'venue_creative_arts' THEN 'visit'
    WHEN 'venue_stay' THEN 'rooms'
  END AS page) mapped
  WHERE page IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_offering_pages(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_offering_pages(text[]) TO authenticated, service_role;

-- ── 6. Done-checks (server truth) ──────────────────────────────────────────
-- 1 offer      offerings_selected answered (an empty list counts)
-- 2 brand      a name AND one line about the brand (tagline and bio share
--              brands.description in Mingla)
-- 3 look       the site has a design and the owner saved its look once, or skipped
-- 4 story      all three story answers
-- 5 approve    an approved plan
-- 6 build      a site exists and every selected offering kind has its page
-- 7 first_offering  a public offering for each selected offering kind that
--              has offerings (trips/events/experiences), or skipped (optional)
-- 8 publish    the site has been published at least once
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
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
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
    'approve', v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL,
    'build', v_site.id IS NOT NULL AND v_plan.built_at IS NOT NULL
      AND v_plan.offerings_selected IS NOT NULL
      AND v_needed <@ COALESCE(v_plan.built_pages, ARRAY[]::text[]),
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

CREATE OR REPLACE FUNCTION public.brand_site_plan_status(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN public.brand_site_plan_status_internal(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_status(uuid) TO authenticated, service_role;

-- ── 7. Read ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_plan_get(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_lock_active boolean;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RETURN jsonb_build_object('brand_id', p_brand_id, 'entitled', false, 'rank', v_rank);
  END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_lock_active := v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now();

  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'entitled', true,
    'rank', v_rank,
    'can_manage', v_rank >= 50,
    'site', CASE WHEN v_site.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_site.id,
      'status', v_site.status,
      'design_key', v_site.design_key,
      'published', v_site.last_successful_publication_id IS NOT NULL,
      'paused', v_site.status = 'suspended'
    ) END,
    'plan', CASE WHEN v_plan.brand_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revision', v_plan.revision,
      'offerings_selected', to_jsonb(v_plan.offerings_selected),
      'venue_descriptor', v_plan.venue_descriptor,
      'story', v_plan.story,
      'approved_plan', v_plan.approved_plan,
      'approved_at', v_plan.approved_at,
      'skipped_parts', to_jsonb(v_plan.skipped_parts),
      'active_part', v_plan.active_part,
      'built_pages', to_jsonb(v_plan.built_pages),
      'built_at', v_plan.built_at,
      'started_at', v_plan.started_at,
      'started_by_me', v_plan.started_by = v_actor,
      'started_by_name', CASE WHEN v_plan.started_by IS NULL THEN NULL
        ELSE public.brand_site_plan_person_name(v_plan.started_by) END,
      'updated_at', v_plan.updated_at
    ) END,
    'status', public.brand_site_plan_status_internal(p_brand_id),
    'prefill_offerings', to_jsonb(public.brand_site_plan_prefill_offerings(p_brand_id)),
    'live_counts', jsonb_build_object(
      'trips', public.brand_site_plan_offering_count(p_brand_id, 'trips', true),
      'events', public.brand_site_plan_offering_count(p_brand_id, 'events', true),
      'experiences', public.brand_site_plan_offering_count(p_brand_id, 'experiences', true)
    ),
    'lock', jsonb_build_object(
      'active', v_lock_active,
      'held_by_me', v_lock_active AND v_plan.lock_holder = v_actor,
      'holder_name', CASE WHEN v_lock_active
        THEN public.brand_site_plan_person_name(v_plan.lock_holder) ELSE NULL END,
      'expires_at', CASE WHEN v_lock_active THEN v_plan.lock_expires_at ELSE NULL END
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_get(uuid) TO authenticated, service_role;

-- ── 8. Write ───────────────────────────────────────────────────────────────
-- The common gate for every write: signed in, rank, entitlement, the site not
-- suspended by Mingla (the plan pauses with the site).
CREATE OR REPLACE FUNCTION public.brand_site_plan_gate(p_brand_id uuid, p_min_rank integer)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, auth.uid());
  IF auth.uid() IS NULL OR v_rank < p_min_rank THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_not_entitled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_sites site
    WHERE site.brand_id = p_brand_id AND site.status = 'suspended') THEN
    RAISE EXCEPTION 'sites_plan_paused';
  END IF;
  RETURN v_rank;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_gate(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_gate(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_plan_save(
  p_brand_id uuid, p_revision integer, p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_plan public.brand_site_plans%ROWTYPE;
  v_keys text[];
  v_status jsonb;
  v_offerings text[];
  v_skipped text[];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
    OR NOT public.brand_site_json_keys_allowed(p_patch, ARRAY[
      'offerings_selected','venue_descriptor','story','approve','approved_plan',
      'skipped_parts','active_part']) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_patch));
  -- #2829 — only active_part ("Do it with Ari") is open to rank 20-49.
  v_rank := public.brand_site_plan_gate(p_brand_id,
    CASE WHEN v_keys = ARRAY['active_part'] THEN 20 ELSE 50 END);

  INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
  VALUES (p_brand_id, v_actor, v_actor, public.brand_site_plan_prefill_offerings(p_brand_id))
  ON CONFLICT (brand_id) DO NOTHING;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;

  IF p_revision IS NULL OR p_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;

  IF p_patch ? 'offerings_selected' THEN
    IF jsonb_typeof(p_patch->'offerings_selected') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch->'offerings_selected') value
        WHERE jsonb_typeof(value) <> 'string') THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_offerings := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_patch->'offerings_selected') value);
    IF NOT v_offerings <@ public.brand_site_plan_offering_keys() THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    -- Changing what the brand offers changes the plan: it needs approving again.
    IF v_plan.offerings_selected IS DISTINCT FROM v_offerings THEN
      v_plan.approved_at := NULL;
      v_plan.approved_by := NULL;
    END IF;
    v_plan.offerings_selected := v_offerings;
  END IF;
  IF p_patch ? 'venue_descriptor' THEN
    v_plan.venue_descriptor := NULLIF(btrim(p_patch->>'venue_descriptor'), '');
  END IF;
  IF p_patch ? 'story' THEN
    IF jsonb_typeof(p_patch->'story') = 'null' THEN
      v_plan.story := NULL;
    ELSIF NOT public.brand_site_plan_text_map_ok(p_patch->'story', ARRAY['who','why','main_action'], 300) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    ELSE
      IF v_plan.story IS DISTINCT FROM p_patch->'story' THEN
        v_plan.approved_at := NULL;
        v_plan.approved_by := NULL;
      END IF;
      v_plan.story := p_patch->'story';
    END IF;
  END IF;
  IF p_patch ? 'skipped_parts' THEN
    IF jsonb_typeof(p_patch->'skipped_parts') <> 'array' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_skipped := ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_patch->'skipped_parts') value);
    IF NOT v_skipped <@ ARRAY['look','first_offering'] THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_plan.skipped_parts := v_skipped;
  END IF;
  IF p_patch ? 'active_part' THEN
    IF jsonb_typeof(p_patch->'active_part') = 'null' THEN
      v_plan.active_part := NULL;
    ELSIF NOT ((p_patch->>'active_part') = ANY (public.brand_site_plan_parts())) THEN
      RAISE EXCEPTION 'sites_validation_failed';
    ELSE
      v_plan.active_part := p_patch->>'active_part';
    END IF;
  END IF;
  IF p_patch ? 'approve' THEN
    IF jsonb_typeof(p_patch->'approve') <> 'boolean' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    IF (p_patch->>'approve')::boolean THEN
      IF NOT public.brand_site_plan_text_map_ok(p_patch->'approved_plan',
          ARRAY['for','leads_with','main_action','look','pages','wont_do'], 300)
        OR p_patch->'approved_plan' IS NULL OR jsonb_typeof(p_patch->'approved_plan') <> 'object' THEN
        RAISE EXCEPTION 'sites_validation_failed';
      END IF;
      -- A plan is approved only once Mingla knows what the brand offers and
      -- has its name and one line about it (the edge case "skip every
      -- question": those two are the only required answers).
      IF v_plan.offerings_selected IS NULL OR NOT (
        (public.brand_site_plan_status_internal(p_brand_id)->'parts'->1->>'done')::boolean
      ) THEN
        RAISE EXCEPTION 'sites_plan_not_ready';
      END IF;
      v_plan.approved_plan := p_patch->'approved_plan';
      v_plan.approved_at := now();
      v_plan.approved_by := v_actor;
    ELSE
      v_plan.approved_at := NULL;
      v_plan.approved_by := NULL;
    END IF;
  ELSIF p_patch ? 'approved_plan' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  UPDATE public.brand_site_plans SET
    revision = v_plan.revision + 1,
    offerings_selected = v_plan.offerings_selected,
    venue_descriptor = v_plan.venue_descriptor,
    story = v_plan.story,
    approved_plan = v_plan.approved_plan,
    approved_at = v_plan.approved_at,
    approved_by = v_plan.approved_by,
    skipped_parts = v_plan.skipped_parts,
    active_part = v_plan.active_part,
    -- Rank 50 holds the lock while working; rank 20-49 never takes it.
    lock_holder = CASE WHEN v_rank >= 50 THEN v_actor ELSE v_plan.lock_holder END,
    lock_expires_at = CASE WHEN v_rank >= 50 THEN now() + interval '10 minutes'
      ELSE v_plan.lock_expires_at END,
    updated_at = now(),
    updated_by = v_actor
  WHERE brand_id = p_brand_id;

  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES ((SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id), p_brand_id,
    v_actor, 'user', 'plan.saved', 'brand_site_plan', p_brand_id::text,
    jsonb_build_object('revision', v_plan.revision + 1, 'fields', to_jsonb(v_keys)));

  RETURN public.brand_site_plan_get(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_save(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_save(uuid, integer, jsonb) TO authenticated, service_role;

-- The plan screen calls this while it is open (and Ari's plan tools will):
-- a free or expired lock is taken, the caller's own lock renewed; someone
-- else's live lock is left alone (the screen shows the take-over banner).
CREATE OR REPLACE FUNCTION public.brand_site_plan_heartbeat(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
  VALUES (p_brand_id, v_actor, v_actor, public.brand_site_plan_prefill_offerings(p_brand_id))
  ON CONFLICT (brand_id) DO NOTHING;
  UPDATE public.brand_site_plans
  SET lock_holder = v_actor, lock_expires_at = now() + interval '10 minutes'
  WHERE brand_id = p_brand_id
    AND (lock_holder IS NULL OR lock_expires_at <= now() OR lock_holder = v_actor);
  RETURN public.brand_site_plan_get(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_heartbeat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_heartbeat(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_plan_take_over(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_previous uuid;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  INSERT INTO public.brand_site_plans(brand_id, started_by, updated_by, offerings_selected)
  VALUES (p_brand_id, v_actor, v_actor, public.brand_site_plan_prefill_offerings(p_brand_id))
  ON CONFLICT (brand_id) DO NOTHING;
  SELECT lock_holder INTO v_previous FROM public.brand_site_plans
  WHERE brand_id = p_brand_id FOR UPDATE;
  UPDATE public.brand_site_plans
  SET lock_holder = v_actor, lock_expires_at = now() + interval '10 minutes',
    updated_at = now(), updated_by = v_actor
  WHERE brand_id = p_brand_id;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES ((SELECT id FROM public.brand_sites WHERE brand_id = p_brand_id), p_brand_id,
    v_actor, 'user', 'plan.taken_over', 'brand_site_plan', p_brand_id::text,
    jsonb_build_object('previous_holder', v_previous IS NOT NULL AND v_previous <> v_actor));
  RETURN public.brand_site_plan_get(p_brand_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_take_over(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_take_over(uuid) TO authenticated, service_role;

-- ── 9. "Create website draft" ──────────────────────────────────────────────
-- Checked BEFORE Studio composes: rank 50, entitled, not paused, the caller
-- may write the plan (lock), a site exists, the plan is approved. Returns the
-- composer's inputs; Studio writes only what these facts and the owner's
-- answers say (no invented text).
CREATE OR REPLACE FUNCTION public.brand_site_plan_authorize_compose(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_brand public.brands%ROWTYPE;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR v_plan.approved_at IS NULL OR v_plan.offerings_selected IS NULL THEN
    RAISE EXCEPTION 'sites_plan_not_ready';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN
    RAISE EXCEPTION 'sites_plan_locked';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  IF v_site.id IS NULL OR v_site.status IN ('provisioning','error') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  RETURN jsonb_build_object(
    'site_id', v_site.id,
    'brand_id', p_brand_id,
    'revision', v_plan.revision,
    'offerings_selected', to_jsonb(v_plan.offerings_selected),
    'venue_descriptor', v_plan.venue_descriptor,
    'story', v_plan.story,
    'brand', jsonb_build_object(
      'name', v_brand.name,
      'description', v_brand.description,
      'contact_email', v_brand.contact_email,
      'city', v_brand.city,
      'address', v_brand.address
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_authorize_compose(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_authorize_compose(uuid) TO authenticated, service_role;

-- Recorded only after Studio confirmed the pages exist (no fabricated tick).
CREATE OR REPLACE FUNCTION public.brand_site_plan_record_build(
  p_brand_id uuid, p_site_id uuid, p_actor uuid, p_pages text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_sites site
    WHERE site.id = p_site_id AND site.brand_id = p_brand_id) THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  IF p_pages IS NULL OR NOT p_pages <@ ARRAY['home','trips','events','experiences','menu','visit','rooms','about','contact'] THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  UPDATE public.brand_site_plans
  SET built_pages = p_pages, built_at = now(), revision = revision + 1,
    updated_at = now(), updated_by = p_actor
  WHERE brand_id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_user_id, actor_kind,
    action, resource_kind, resource_id, metadata)
  VALUES (p_site_id, p_brand_id, p_actor, 'user', 'plan.built', 'brand_site_plan',
    p_brand_id::text, jsonb_build_object('pages', to_jsonb(p_pages)));
  RETURN jsonb_build_object('built_pages', to_jsonb(p_pages));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_record_build(uuid, uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_record_build(uuid, uuid, uuid, text[]) TO service_role;

-- ── 10. Studio reports the look was saved ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_record_look_saved(
  p_site_id uuid, p_design_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_design_key IS NULL OR p_design_key !~ '^[a-z][a-z0-9-]{1,31}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  UPDATE public.brand_sites
  SET design_key = p_design_key,
    tokens_saved_at = COALESCE(tokens_saved_at, now()),
    updated_at = now()
  WHERE id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  RETURN jsonb_build_object('site_id', p_site_id, 'design_key', p_design_key);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_record_look_saved(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_look_saved(uuid, text) TO service_role;

-- ── 11. "Ask an admin to start it" (rank 20-49) ────────────────────────────
-- One notice per asker per brand per day; every brand admin and the owner get it.
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
        'body', v_name || ' asked you to start ' || COALESCE(v_brand_name, 'your brand') ||
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

COMMIT;
