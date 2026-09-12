-- Issue #1777 / parent #876 — server-owned, fail-closed Brand Circle reach.
-- COMMS-0160: this migration is written for the release handoff; it must not be
-- applied with db push, --include-all, or migration repair.

BEGIN;

DO $preflight$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'issue_1777_requires_pg_cron';
  END IF;
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'issue_1777_requires_pgcrypto';
  END IF;
END;
$preflight$;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES
  ('brand_circle_followers_v1',false,'Business Followers roster rollout'),
  ('brand_circle_extended_v1',false,'Business Extended circle roster rollout'),
  ('brand_circle_extended_controls_ios_v1',false,'Consumer iOS extended-reach controls live'),
  ('brand_circle_extended_controls_android_v1',false,'Consumer Android extended-reach controls live')
ON CONFLICT(flag_key) DO NOTHING;

CREATE TABLE public.brand_circle_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  extended_brand_reach_enabled boolean NOT NULL DEFAULT false,
  extended_brand_reach_decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_circle_preferences_decision_shape CHECK (
    NOT extended_brand_reach_enabled OR extended_brand_reach_decided_at IS NOT NULL
  )
);

CREATE TABLE public.brand_circle_exits (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visibility_exited_at timestamptz,
  delivery_exited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(brand_id,user_id),
  CONSTRAINT brand_circle_exits_has_exit CHECK (
    visibility_exited_at IS NOT NULL OR delivery_exited_at IS NOT NULL
  )
);

CREATE TABLE public.brand_reach_refresh_state (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  snapshot_version bigint NOT NULL DEFAULT 0 CHECK(snapshot_version >= 0),
  followers_status text NOT NULL DEFAULT 'dirty' CHECK(followers_status IN ('disabled','dirty','ready','failed')),
  followers_generation_id uuid,
  followers_member_count bigint,
  followers_truth_digest bytea,
  followers_dirty_at timestamptz,
  followers_refreshed_at timestamptz,
  followers_expires_at timestamptz,
  followers_last_safe_error_code text CHECK(followers_last_safe_error_code IS NULL OR followers_last_safe_error_code IN ('circle_refresh_failed','authority_unavailable')),
  followers_last_duration_ms integer CHECK(followers_last_duration_ms IS NULL OR followers_last_duration_ms >= 0),
  extended_status text NOT NULL DEFAULT 'dirty' CHECK(extended_status IN ('disabled','dirty','ready','failed')),
  extended_generation_id uuid,
  extended_member_count bigint,
  extended_truth_digest bytea,
  extended_dirty_at timestamptz,
  extended_refreshed_at timestamptz,
  extended_expires_at timestamptz,
  extended_last_safe_error_code text CHECK(extended_last_safe_error_code IS NULL OR extended_last_safe_error_code IN ('circle_refresh_failed','authority_unavailable')),
  extended_last_duration_ms integer CHECK(extended_last_duration_ms IS NULL OR extended_last_duration_ms >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_reach_followers_ready_shape CHECK (
    (followers_status='ready' AND followers_generation_id IS NOT NULL AND followers_member_count IS NOT NULL AND followers_member_count >= 0 AND followers_truth_digest IS NOT NULL AND followers_refreshed_at IS NOT NULL AND followers_expires_at > followers_refreshed_at)
    OR (followers_status<>'ready' AND followers_member_count IS NULL AND followers_truth_digest IS NULL)
  ),
  CONSTRAINT brand_reach_extended_ready_shape CHECK (
    (extended_status='ready' AND extended_generation_id IS NOT NULL AND extended_member_count IS NOT NULL AND extended_member_count >= 0 AND extended_truth_digest IS NOT NULL AND extended_refreshed_at IS NOT NULL AND extended_expires_at > extended_refreshed_at)
    OR (extended_status<>'ready' AND extended_member_count IS NULL AND extended_truth_digest IS NULL)
  )
);

CREATE TABLE public.brand_reach_members (
  member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ring text NOT NULL CHECK(ring IN ('follower','extended')),
  ring_order smallint NOT NULL CHECK((ring='follower' AND ring_order=2) OR (ring='extended' AND ring_order=3)),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120 AND display_name !~ '[[:cntrl:]]'),
  avatar_url text,
  reason_code text NOT NULL CHECK(
    (ring='follower' AND reason_code='follows_brand') OR
    (ring='extended' AND reason_code='extended_circle')
  ),
  materialized_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id,generation_id,user_id)
);
CREATE INDEX brand_reach_members_page_idx ON public.brand_reach_members(brand_id,generation_id,ring_order,lower(display_name),member_id);
CREATE INDEX brand_reach_members_invalidation_idx ON public.brand_reach_members(brand_id,user_id);

CREATE TABLE public.brand_reach_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  circuit_open boolean NOT NULL DEFAULT false,
  opened_at timestamptz,
  safe_reason_code text CHECK(safe_reason_code IS NULL OR safe_reason_code='authority_unavailable'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_reach_control_shape CHECK(
    (circuit_open AND opened_at IS NOT NULL AND safe_reason_code='authority_unavailable') OR
    (NOT circuit_open AND opened_at IS NULL AND safe_reason_code IS NULL)
  )
);
INSERT INTO public.brand_reach_control(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;

ALTER TABLE public.brand_circle_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_circle_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_reach_refresh_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_reach_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_reach_control ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_circle_preferences_owner_select ON public.brand_circle_preferences FOR SELECT USING(auth.uid()=user_id);
CREATE POLICY brand_circle_preferences_owner_insert ON public.brand_circle_preferences FOR INSERT WITH CHECK(auth.uid()=user_id);
CREATE POLICY brand_circle_preferences_owner_update ON public.brand_circle_preferences FOR UPDATE USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY brand_circle_preferences_owner_delete ON public.brand_circle_preferences FOR DELETE USING(auth.uid()=user_id);
CREATE POLICY brand_circle_exits_owner_select ON public.brand_circle_exits FOR SELECT USING(auth.uid()=user_id);
CREATE POLICY brand_circle_exits_owner_insert ON public.brand_circle_exits FOR INSERT WITH CHECK(auth.uid()=user_id);
CREATE POLICY brand_circle_exits_owner_update ON public.brand_circle_exits FOR UPDATE USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY brand_circle_exits_owner_delete ON public.brand_circle_exits FOR DELETE USING(auth.uid()=user_id);

REVOKE ALL ON public.brand_circle_preferences,public.brand_circle_exits,public.brand_reach_refresh_state,public.brand_reach_members,public.brand_reach_control FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.brand_circle_preferences,public.brand_circle_exits TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.brand_circle_preferences,public.brand_circle_exits FROM authenticated;
GRANT ALL ON public.brand_circle_preferences,public.brand_circle_exits,public.brand_reach_refresh_state,public.brand_reach_members,public.brand_reach_control TO service_role;

CREATE TRIGGER brand_circle_preferences_touch BEFORE UPDATE ON public.brand_circle_preferences FOR EACH ROW EXECUTE FUNCTION public.issue_1770_touch_updated_at();
CREATE TRIGGER brand_circle_exits_touch BEFORE UPDATE ON public.brand_circle_exits FOR EACH ROW EXECUTE FUNCTION public.issue_1770_touch_updated_at();

CREATE OR REPLACE FUNCTION public.issue_1777_resolve_brand_circle_members(
  p_brand_id uuid,
  p_ring text,
  p_candidate_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(user_id uuid,ring text,display_name text,avatar_url text,reason_code text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
WITH eligible AS MATERIALIZED (
  SELECT p.id AS user_id,
    left(regexp_replace(btrim(CASE
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL AND nullif(btrim(p.last_name),'') IS NOT NULL THEN btrim(p.first_name)||' '||btrim(p.last_name)
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL THEN btrim(p.first_name)
      WHEN nullif(btrim(p.display_name),'') IS NOT NULL THEN btrim(p.display_name)
      WHEN nullif(btrim(p.username),'') IS NOT NULL THEN btrim(p.username)
      ELSE '' END),'[[:space:]]+',' ','g'),120) AS display_name,
    p.avatar_url
  FROM public.profiles p
  JOIN auth.users au ON au.id=p.id
  CROSS JOIN LATERAL (SELECT to_jsonb(au) AS j) auth_identity
  WHERE p.active IS TRUE
    AND (auth_identity.j->>'deleted_at') IS NULL
    AND (
      (auth_identity.j->>'banned_until') IS NULL
      OR (auth_identity.j->>'banned_until')::timestamptz<=statement_timestamp()
    )
    AND p.explorer_deleted_at IS NULL
    AND p.has_completed_onboarding IS TRUE
    AND p.visibility_mode IS NOT NULL AND p.visibility_mode<>'private'
    AND length(regexp_replace(btrim(CASE
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL AND nullif(btrim(p.last_name),'') IS NOT NULL THEN btrim(p.first_name)||' '||btrim(p.last_name)
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL THEN btrim(p.first_name)
      WHEN nullif(btrim(p.display_name),'') IS NOT NULL THEN btrim(p.display_name)
      WHEN nullif(btrim(p.username),'') IS NOT NULL THEN btrim(p.username)
      ELSE '' END),'[[:space:]]+',' ','g')) BETWEEN 1 AND 120
    AND regexp_replace(btrim(CASE
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL AND nullif(btrim(p.last_name),'') IS NOT NULL THEN btrim(p.first_name)||' '||btrim(p.last_name)
      WHEN nullif(btrim(p.first_name),'') IS NOT NULL THEN btrim(p.first_name)
      WHEN nullif(btrim(p.display_name),'') IS NOT NULL THEN btrim(p.display_name)
      WHEN nullif(btrim(p.username),'') IS NOT NULL THEN btrim(p.username)
      ELSE '' END),'[[:space:]]+',' ','g') !~ '[[:cntrl:]]'
),
active_book AS MATERIALIZED (
  SELECT DISTINCT bp.linked_user_id AS user_id FROM public.brand_people bp
  WHERE bp.brand_id=p_brand_id AND bp.record_status='active' AND bp.deleted_at IS NULL AND bp.linked_user_id IS NOT NULL
),
roots AS MATERIALIZED (
  SELECT DISTINCT x.user_id
  FROM (
    SELECT bf.user_id FROM public.brand_follows bf WHERE bf.brand_id=p_brand_id
    UNION
    SELECT ab.user_id FROM active_book ab
  ) x JOIN eligible e ON e.user_id=x.user_id
  WHERE NOT EXISTS(SELECT 1 FROM public.brand_circle_exits bx WHERE bx.brand_id=p_brand_id AND bx.user_id=x.user_id AND bx.visibility_exited_at IS NOT NULL)
),
accepted_edges AS MATERIALIZED (
  SELECT f.user_id AS a,f.friend_user_id AS b,f.updated_at AS recency
  FROM public.friends f WHERE f.status='accepted' AND f.deleted_at IS NULL
  UNION ALL
  SELECT f.friend_user_id,f.user_id,f.updated_at FROM public.friends f WHERE f.status='accepted' AND f.deleted_at IS NULL
),
close_edges AS MATERIALIZED (
  SELECT p.user_a_id AS a,p.user_b_id AS b,p.created_at AS recency FROM public.pairings p
  UNION ALL
  SELECT p.user_b_id,p.user_a_id,p.created_at FROM public.pairings p
),
paid_attendance AS MATERIALIZED (
  SELECT DISTINCT o.buyer_user_id AS user_id,o.event_id,
    COALESCE(max(ed.end_at),max(o.created_at)) AS recency
  FROM public.orders o
  JOIN public.events ev ON ev.id=o.event_id
  LEFT JOIN public.event_dates ed ON ed.event_id=ev.id
  WHERE o.buyer_user_id IS NOT NULL
    AND o.payment_status IN ('paid','partial_refund')
    AND ev.event_type IN ('event','trip') AND ev.deleted_at IS NULL
    AND ev.status IN ('scheduled','live','ended')
    AND EXISTS(SELECT 1 FROM public.tickets t WHERE t.order_id=o.id AND t.event_id=o.event_id AND t.approval_status IN ('auto','approved') AND t.status IN ('valid','used'))
  GROUP BY o.buyer_user_id,o.event_id
),
extended_paths AS MATERIALIZED (
  SELECT r.user_id AS root_id,ce.b AS target_id,1 AS tier,ce.recency FROM roots r JOIN close_edges ce ON ce.a=r.user_id
  UNION ALL
  SELECT r.user_id,ae.b,2,ae.recency FROM roots r JOIN accepted_edges ae ON ae.a=r.user_id
  UNION ALL
  SELECT r.user_id,second.b,3,GREATEST(first.recency,second.recency)
  FROM roots r JOIN accepted_edges first ON first.a=r.user_id JOIN accepted_edges second ON second.a=first.b AND second.b<>r.user_id
  WHERE NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=r.user_id AND bu.blocked_id=first.b) OR (bu.blocker_id=first.b AND bu.blocked_id=r.user_id))
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=first.b AND bu.blocked_id=second.b) OR (bu.blocker_id=second.b AND bu.blocked_id=first.b))
  UNION ALL
  SELECT r.user_id,other.user_id,4,GREATEST(mine.recency,other.recency)
  FROM roots r JOIN paid_attendance mine ON mine.user_id=r.user_id JOIN paid_attendance other ON other.event_id=mine.event_id AND other.user_id<>r.user_id
),
extended AS MATERIALIZED (
  SELECT DISTINCT ON (ep.target_id) ep.target_id AS user_id
  FROM extended_paths ep
  JOIN eligible target ON target.user_id=ep.target_id
  JOIN public.brand_circle_preferences pref ON pref.user_id=ep.target_id
    AND pref.extended_brand_reach_enabled IS TRUE AND pref.extended_brand_reach_decided_at IS NOT NULL
  WHERE ep.target_id<>ep.root_id
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=ep.root_id AND bu.blocked_id=ep.target_id) OR (bu.blocker_id=ep.target_id AND bu.blocked_id=ep.root_id))
    AND NOT EXISTS(SELECT 1 FROM active_book ab WHERE ab.user_id=ep.target_id)
    AND NOT EXISTS(SELECT 1 FROM public.brand_follows bf WHERE bf.brand_id=p_brand_id AND bf.user_id=ep.target_id)
    AND NOT EXISTS(SELECT 1 FROM public.brand_circle_exits bx WHERE bx.brand_id=p_brand_id AND bx.user_id=ep.target_id AND bx.visibility_exited_at IS NOT NULL)
  ORDER BY ep.target_id,ep.tier,ep.recency DESC,ep.root_id
)
SELECT e.user_id,'follower'::text,e.display_name,e.avatar_url,'follows_brand'::text
FROM public.brand_follows bf JOIN eligible e ON e.user_id=bf.user_id
WHERE bf.brand_id=p_brand_id AND p_ring IN ('all','follower')
  AND (p_candidate_user_ids IS NULL OR e.user_id=ANY(p_candidate_user_ids))
  AND NOT EXISTS(SELECT 1 FROM active_book ab WHERE ab.user_id=e.user_id)
  AND NOT EXISTS(SELECT 1 FROM public.brand_circle_exits bx WHERE bx.brand_id=p_brand_id AND bx.user_id=e.user_id AND bx.visibility_exited_at IS NOT NULL)
UNION ALL
SELECT e.user_id,'extended'::text,e.display_name,e.avatar_url,'extended_circle'::text
FROM extended x JOIN eligible e ON e.user_id=x.user_id
WHERE p_ring IN ('all','extended') AND (p_candidate_user_ids IS NULL OR e.user_id=ANY(p_candidate_user_ids));
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_brand_reach_truth_digest(p_brand_id uuid,p_ring text)
RETURNS TABLE(member_count bigint,truth_digest bytea)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
  SELECT count(*)::bigint,
    extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_array(user_id,ring,display_name,avatar_url,reason_code) ORDER BY user_id),'[]'::jsonb)::text,'UTF8'),'sha256')
  FROM public.issue_1777_resolve_brand_circle_members(p_brand_id,p_ring,NULL);
$function$;

REVOKE ALL ON FUNCTION public.issue_1777_resolve_brand_circle_members(uuid,text,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1777_brand_reach_truth_digest(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1777_resolve_brand_circle_members(uuid,text,uuid[]),public.issue_1777_brand_reach_truth_digest(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1777_mark_brand_reach_dirty(p_brand_ids uuid[],p_scope text DEFAULT 'both')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF p_scope NOT IN ('both','follower','extended') THEN RAISE EXCEPTION 'circle_scope_invalid'; END IF;
  INSERT INTO public.brand_reach_refresh_state(brand_id,snapshot_version,followers_status,followers_dirty_at,extended_status,extended_dirty_at)
  SELECT DISTINCT id,1,
    CASE WHEN p_scope IN ('both','follower') THEN 'dirty' ELSE 'disabled' END,
    CASE WHEN p_scope IN ('both','follower') THEN statement_timestamp() END,
    CASE WHEN p_scope IN ('both','extended') THEN 'dirty' ELSE 'disabled' END,
    CASE WHEN p_scope IN ('both','extended') THEN statement_timestamp() END
  FROM unnest(COALESCE(p_brand_ids,'{}'::uuid[])) AS id WHERE id IS NOT NULL
  ON CONFLICT(brand_id) DO UPDATE SET
    snapshot_version=brand_reach_refresh_state.snapshot_version+1,
    followers_status=CASE WHEN p_scope IN ('both','follower') THEN 'dirty' ELSE brand_reach_refresh_state.followers_status END,
    followers_member_count=CASE WHEN p_scope IN ('both','follower') THEN NULL ELSE brand_reach_refresh_state.followers_member_count END,
    followers_truth_digest=CASE WHEN p_scope IN ('both','follower') THEN NULL ELSE brand_reach_refresh_state.followers_truth_digest END,
    followers_dirty_at=CASE WHEN p_scope IN ('both','follower') THEN statement_timestamp() ELSE brand_reach_refresh_state.followers_dirty_at END,
    extended_status=CASE WHEN p_scope IN ('both','extended') THEN 'dirty' ELSE brand_reach_refresh_state.extended_status END,
    extended_member_count=CASE WHEN p_scope IN ('both','extended') THEN NULL ELSE brand_reach_refresh_state.extended_member_count END,
    extended_truth_digest=CASE WHEN p_scope IN ('both','extended') THEN NULL ELSE brand_reach_refresh_state.extended_truth_digest END,
    extended_dirty_at=CASE WHEN p_scope IN ('both','extended') THEN statement_timestamp() ELSE brand_reach_refresh_state.extended_dirty_at END,
    updated_at=statement_timestamp();
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_impacted_brands(p_user_ids uuid[],p_brand_ids uuid[],p_event_ids uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
WITH users AS (SELECT DISTINCT u FROM unnest(COALESCE(p_user_ids,'{}'::uuid[])) u WHERE u IS NOT NULL),
events AS (SELECT DISTINCT e FROM unnest(COALESCE(p_event_ids,'{}'::uuid[])) e WHERE e IS NOT NULL),
brands AS (SELECT DISTINCT b FROM unnest(COALESCE(p_brand_ids,'{}'::uuid[])) b WHERE b IS NOT NULL),
graph_one AS (
  SELECT u.u AS source,u.u AS related FROM users u
  UNION SELECT u.u,p.user_b_id FROM users u JOIN public.pairings p ON p.user_a_id=u.u
  UNION SELECT u.u,p.user_a_id FROM users u JOIN public.pairings p ON p.user_b_id=u.u
  UNION SELECT u.u,f.friend_user_id FROM users u JOIN public.friends f ON f.user_id=u.u AND f.status='accepted' AND f.deleted_at IS NULL
  UNION SELECT u.u,f.user_id FROM users u JOIN public.friends f ON f.friend_user_id=u.u AND f.status='accepted' AND f.deleted_at IS NULL
),
graph_two AS (
  SELECT related FROM graph_one
  UNION SELECT p.user_b_id FROM graph_one g JOIN public.pairings p ON p.user_a_id=g.related
  UNION SELECT p.user_a_id FROM graph_one g JOIN public.pairings p ON p.user_b_id=g.related
  UNION SELECT f.friend_user_id FROM graph_one g JOIN public.friends f ON f.user_id=g.related AND f.status='accepted' AND f.deleted_at IS NULL
  UNION SELECT f.user_id FROM graph_one g JOIN public.friends f ON f.friend_user_id=g.related AND f.status='accepted' AND f.deleted_at IS NULL
),
event_people AS (
  SELECT DISTINCT o.buyer_user_id AS user_id FROM public.orders o JOIN events e ON e.e=o.event_id WHERE o.buyer_user_id IS NOT NULL
  UNION SELECT DISTINCT o2.buyer_user_id FROM public.orders o1 JOIN users u ON u.u=o1.buyer_user_id JOIN public.orders o2 ON o2.event_id=o1.event_id WHERE o2.buyer_user_id IS NOT NULL
),
related AS (SELECT related AS user_id FROM graph_two UNION SELECT user_id FROM event_people UNION SELECT u FROM users),
all_brands AS (
  SELECT b AS brand_id FROM brands
  UNION SELECT ev.brand_id FROM public.events ev JOIN events e ON e.e=ev.id
  UNION SELECT bf.brand_id FROM public.brand_follows bf JOIN related r ON r.user_id=bf.user_id
  UNION SELECT bp.brand_id FROM public.brand_people bp JOIN related r ON r.user_id=bp.linked_user_id WHERE bp.record_status='active' AND bp.deleted_at IS NULL
  UNION SELECT rm.brand_id FROM public.brand_reach_members rm JOIN users u ON u.u=rm.user_id
)
SELECT COALESCE(array_agg(DISTINCT brand_id),'{}'::uuid[]) FROM all_brands WHERE brand_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_after_source_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_old jsonb:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new jsonb:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_users uuid[]:='{}'::uuid[];
  v_brands uuid[]:='{}'::uuid[];
  v_events uuid[]:='{}'::uuid[];
  v_impacted uuid[];
  v_scope text:='both';
  v_flag text:=COALESCE(v_new->>'flag_key',v_old->>'flag_key');
BEGIN
  BEGIN
    IF TG_TABLE_NAME='feature_flags' AND v_flag NOT IN ('brand_circle_followers_v1','brand_circle_extended_v1','brand_circle_extended_controls_ios_v1','brand_circle_extended_controls_android_v1') THEN
      RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_TABLE_NAME='feature_flags' THEN
      SELECT COALESCE(array_agg(id),'{}'::uuid[]) INTO v_impacted FROM public.brands WHERE deleted_at IS NULL;
      v_scope:=CASE WHEN v_flag='brand_circle_followers_v1' THEN 'follower' ELSE 'extended' END;
    ELSE
      v_users:=ARRAY_REMOVE(ARRAY[
        NULLIF(v_old->>'user_id','')::uuid,NULLIF(v_new->>'user_id','')::uuid,
        NULLIF(v_old->>'linked_user_id','')::uuid,NULLIF(v_new->>'linked_user_id','')::uuid,
        NULLIF(v_old->>'blocker_id','')::uuid,NULLIF(v_new->>'blocker_id','')::uuid,
        NULLIF(v_old->>'blocked_id','')::uuid,NULLIF(v_new->>'blocked_id','')::uuid,
        NULLIF(v_old->>'friend_user_id','')::uuid,NULLIF(v_new->>'friend_user_id','')::uuid,
        NULLIF(v_old->>'user_a_id','')::uuid,NULLIF(v_new->>'user_a_id','')::uuid,
        NULLIF(v_old->>'user_b_id','')::uuid,NULLIF(v_new->>'user_b_id','')::uuid,
        NULLIF(v_old->>'buyer_user_id','')::uuid,NULLIF(v_new->>'buyer_user_id','')::uuid,
        NULLIF(v_old->>'id','')::uuid,NULLIF(v_new->>'id','')::uuid
      ],NULL);
      v_brands:=ARRAY_REMOVE(ARRAY[NULLIF(v_old->>'brand_id','')::uuid,NULLIF(v_new->>'brand_id','')::uuid],NULL);
      v_events:=ARRAY_REMOVE(ARRAY[
        NULLIF(v_old->>'event_id','')::uuid,NULLIF(v_new->>'event_id','')::uuid,
        CASE WHEN TG_TABLE_NAME='events' THEN NULLIF(v_old->>'id','')::uuid END,
        CASE WHEN TG_TABLE_NAME='events' THEN NULLIF(v_new->>'id','')::uuid END
      ],NULL);
      IF TG_TABLE_NAME='tickets' THEN
        SELECT array_cat(v_users,COALESCE(array_agg(DISTINCT o.buyer_user_id) FILTER(WHERE o.buyer_user_id IS NOT NULL),'{}'::uuid[]))
          INTO v_users FROM public.orders o WHERE o.id IN (NULLIF(v_old->>'order_id','')::uuid,NULLIF(v_new->>'order_id','')::uuid);
      END IF;
      v_impacted:=public.issue_1777_impacted_brands(v_users,v_brands,v_events);
      IF TG_TABLE_NAME='brand_circle_preferences' THEN v_scope:='extended'; END IF;
      IF TG_TABLE_NAME IN ('friends','pairings','orders','tickets','events','event_dates') THEN v_scope:='extended'; END IF;
      IF TG_TABLE_NAME='brand_follows' THEN v_scope:='both'; END IF;
      IF TG_TABLE_NAME='brand_people' THEN
        DELETE FROM public.brand_reach_members rm WHERE rm.brand_id=ANY(v_impacted) AND rm.user_id=ANY(v_users);
      ELSIF TG_TABLE_NAME IN ('brand_circle_preferences','brand_circle_exits','profiles','blocked_users') THEN
        DELETE FROM public.brand_reach_members rm WHERE rm.user_id=ANY(v_users);
      ELSIF TG_TABLE_NAME='brand_follows' AND TG_OP='DELETE' THEN
        DELETE FROM public.brand_reach_members rm WHERE rm.brand_id=ANY(v_impacted) AND rm.user_id=ANY(v_users);
      END IF;
    END IF;
    PERFORM public.issue_1777_mark_brand_reach_dirty(v_impacted,v_scope);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.brand_reach_control(singleton,circuit_open,opened_at,safe_reason_code,updated_at)
      VALUES(true,true,statement_timestamp(),'authority_unavailable',statement_timestamp())
      ON CONFLICT(singleton) DO UPDATE SET circuit_open=true,opened_at=statement_timestamp(),safe_reason_code='authority_unavailable',updated_at=statement_timestamp();
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE WARNING 'issue_1777_reach_invalidation_failed';
  END;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1777_mark_brand_reach_dirty(uuid[],text),public.issue_1777_impacted_brands(uuid[],uuid[],uuid[]),public.issue_1777_after_source_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1777_mark_brand_reach_dirty(uuid[],text),public.issue_1777_impacted_brands(uuid[],uuid[],uuid[]),public.issue_1777_after_source_change() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1777_refresh_brand_reach(p_brand_id uuid,p_scope text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE
  v_started timestamptz:=clock_timestamp(); v_generation uuid:=gen_random_uuid();
  v_count bigint; v_digest bytea; v_material_count bigint; v_material_digest bytea;
  v_enabled boolean;
BEGIN
  IF p_scope NOT IN ('follower','extended') THEN RAISE EXCEPTION 'circle_scope_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_1777:'||p_brand_id::text||':'||p_scope,0));
  IF p_scope='follower' THEN
    SELECT COALESCE(bool_and(is_enabled),false) INTO v_enabled FROM public.feature_flags WHERE flag_key='brand_circle_followers_v1';
  ELSE
    SELECT count(*)=3 AND bool_and(is_enabled) INTO v_enabled FROM public.feature_flags WHERE flag_key IN ('brand_circle_extended_v1','brand_circle_extended_controls_ios_v1','brand_circle_extended_controls_android_v1');
  END IF;
  INSERT INTO public.brand_reach_refresh_state(brand_id) VALUES(p_brand_id) ON CONFLICT(brand_id) DO NOTHING;
  IF NOT COALESCE(v_enabled,false) THEN
    DELETE FROM public.brand_reach_members WHERE brand_id=p_brand_id AND ring=p_scope;
    IF p_scope='follower' THEN
      UPDATE public.brand_reach_refresh_state SET followers_status='disabled',followers_generation_id=NULL,followers_member_count=NULL,followers_truth_digest=NULL,followers_refreshed_at=NULL,followers_expires_at=NULL,followers_last_safe_error_code=NULL,updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
    ELSE
      UPDATE public.brand_reach_refresh_state SET extended_status='disabled',extended_generation_id=NULL,extended_member_count=NULL,extended_truth_digest=NULL,extended_refreshed_at=NULL,extended_expires_at=NULL,extended_last_safe_error_code=NULL,updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
    END IF;
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS issue_1777_circle_resolved(
    user_id uuid,ring text,display_name text,avatar_url text,reason_code text
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.issue_1777_circle_resolved;
  INSERT INTO pg_temp.issue_1777_circle_resolved SELECT * FROM public.issue_1777_resolve_brand_circle_members(p_brand_id,p_scope,NULL);
  SELECT count(*)::bigint,extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_array(user_id,ring,display_name,avatar_url,reason_code) ORDER BY user_id),'[]'::jsonb)::text,'UTF8'),'sha256')
    INTO v_count,v_digest FROM pg_temp.issue_1777_circle_resolved;
  INSERT INTO public.brand_reach_members(brand_id,generation_id,user_id,ring,ring_order,display_name,avatar_url,reason_code)
  SELECT p_brand_id,v_generation,user_id,ring,CASE ring WHEN 'follower' THEN 2 ELSE 3 END,display_name,avatar_url,reason_code
  FROM pg_temp.issue_1777_circle_resolved;
  SELECT count(*)::bigint,extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_array(user_id,ring,display_name,avatar_url,reason_code) ORDER BY user_id),'[]'::jsonb)::text,'UTF8'),'sha256')
    INTO v_material_count,v_material_digest FROM public.brand_reach_members WHERE brand_id=p_brand_id AND generation_id=v_generation AND ring=p_scope;
  IF v_count<>v_material_count OR v_digest IS DISTINCT FROM v_material_digest THEN RAISE EXCEPTION 'circle_refresh_equivalence_failed'; END IF;
  IF p_scope='follower' THEN
    UPDATE public.brand_reach_refresh_state SET followers_status='ready',followers_generation_id=v_generation,followers_member_count=v_count,followers_truth_digest=v_digest,followers_refreshed_at=statement_timestamp(),followers_expires_at=statement_timestamp()+interval '5 minutes',followers_last_safe_error_code=NULL,followers_last_duration_ms=GREATEST(0,extract(milliseconds FROM clock_timestamp()-v_started)::integer),updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
  ELSE
    UPDATE public.brand_reach_refresh_state SET extended_status='ready',extended_generation_id=v_generation,extended_member_count=v_count,extended_truth_digest=v_digest,extended_refreshed_at=statement_timestamp(),extended_expires_at=statement_timestamp()+interval '5 minutes',extended_last_safe_error_code=NULL,extended_last_duration_ms=GREATEST(0,extract(milliseconds FROM clock_timestamp()-v_started)::integer),updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
  END IF;
  DELETE FROM public.brand_reach_members WHERE brand_id=p_brand_id AND ring=p_scope AND generation_id<>v_generation;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.brand_reach_members WHERE brand_id=p_brand_id AND generation_id=v_generation;
  IF p_scope='follower' THEN
    UPDATE public.brand_reach_refresh_state SET followers_status='failed',followers_member_count=NULL,followers_truth_digest=NULL,followers_last_safe_error_code='circle_refresh_failed',followers_last_duration_ms=GREATEST(0,extract(milliseconds FROM clock_timestamp()-v_started)::integer),updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
  ELSIF p_scope='extended' THEN
    UPDATE public.brand_reach_refresh_state SET extended_status='failed',extended_member_count=NULL,extended_truth_digest=NULL,extended_last_safe_error_code='circle_refresh_failed',extended_last_duration_ms=GREATEST(0,extract(milliseconds FROM clock_timestamp()-v_started)::integer),updated_at=statement_timestamp() WHERE brand_id=p_brand_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_brand_reach_scope_status(p_brand_id uuid,p_ring text)
RETURNS TABLE(scope_state text,safe_reason text,generation_id uuid,member_count bigint,refreshed_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE
  v_state public.brand_reach_refresh_state%ROWTYPE; v_control public.brand_reach_control%ROWTYPE;
  v_live_count bigint; v_live_digest bytea; v_material_count bigint; v_material_digest bytea; v_flags boolean;
BEGIN
  IF p_ring NOT IN ('follower','extended') THEN RAISE EXCEPTION 'circle_ring_invalid'; END IF;
  IF p_ring='follower' THEN
    SELECT count(*)=1 AND bool_and(is_enabled) INTO v_flags FROM public.feature_flags WHERE flag_key='brand_circle_followers_v1';
  ELSE
    SELECT count(*)=3 AND bool_and(is_enabled) INTO v_flags FROM public.feature_flags WHERE flag_key IN ('brand_circle_extended_v1','brand_circle_extended_controls_ios_v1','brand_circle_extended_controls_android_v1');
  END IF;
  IF NOT COALESCE(v_flags,false) THEN
    RETURN QUERY SELECT 'unavailable',CASE WHEN p_ring='extended' THEN 'controls_not_live' ELSE 'rollout_disabled' END,NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO v_control FROM public.brand_reach_control WHERE singleton;
  IF NOT FOUND OR v_control.circuit_open THEN RETURN QUERY SELECT 'unavailable','authority_unavailable',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
  SELECT * INTO v_state FROM public.brand_reach_refresh_state WHERE brand_id=p_brand_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'unavailable','refresh_pending',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
  BEGIN
    SELECT d.member_count,d.truth_digest INTO v_live_count,v_live_digest FROM public.issue_1777_brand_reach_truth_digest(p_brand_id,p_ring) d;
    IF p_ring='follower' THEN
      IF v_state.followers_status<>'ready' THEN RETURN QUERY SELECT 'unavailable',CASE WHEN v_state.followers_status='failed' THEN 'refresh_failed' ELSE 'refresh_pending' END,NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      IF v_state.followers_expires_at<=statement_timestamp() THEN RETURN QUERY SELECT 'unavailable','freshness_expired',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      SELECT count(*)::bigint,extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_array(rm.user_id,rm.ring,rm.display_name,rm.avatar_url,rm.reason_code) ORDER BY rm.user_id),'[]'::jsonb)::text,'UTF8'),'sha256') INTO v_material_count,v_material_digest FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_state.followers_generation_id AND rm.ring='follower';
      IF v_state.followers_member_count<>v_live_count OR v_state.followers_truth_digest IS DISTINCT FROM v_live_digest OR v_material_count<>v_live_count OR v_material_digest IS DISTINCT FROM v_live_digest THEN RETURN QUERY SELECT 'unavailable','refresh_pending',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      RETURN QUERY SELECT 'ready',NULL::text,v_state.followers_generation_id,v_live_count,v_state.followers_refreshed_at,v_state.followers_expires_at; RETURN;
    ELSE
      IF v_state.extended_status<>'ready' THEN RETURN QUERY SELECT 'unavailable',CASE WHEN v_state.extended_status='failed' THEN 'refresh_failed' ELSE 'refresh_pending' END,NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      IF v_state.extended_expires_at<=statement_timestamp() THEN RETURN QUERY SELECT 'unavailable','freshness_expired',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      SELECT count(*)::bigint,extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_array(rm.user_id,rm.ring,rm.display_name,rm.avatar_url,rm.reason_code) ORDER BY rm.user_id),'[]'::jsonb)::text,'UTF8'),'sha256') INTO v_material_count,v_material_digest FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_state.extended_generation_id AND rm.ring='extended';
      IF v_state.extended_member_count<>v_live_count OR v_state.extended_truth_digest IS DISTINCT FROM v_live_digest OR v_material_count<>v_live_count OR v_material_digest IS DISTINCT FROM v_live_digest THEN RETURN QUERY SELECT 'unavailable','refresh_pending',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN; END IF;
      RETURN QUERY SELECT 'ready',NULL::text,v_state.extended_generation_id,v_live_count,v_state.extended_refreshed_at,v_state.extended_expires_at; RETURN;
    END IF;
  EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT 'unavailable','authority_unavailable',NULL::uuid,NULL::bigint,NULL::timestamptz,NULL::timestamptz; RETURN;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_refresh_brand_reach_batch(p_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_row record; v_done integer:=0; v_started timestamptz:=clock_timestamp(); v_opened timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>20 THEN RAISE EXCEPTION 'circle_limit_invalid'; END IF;
  SELECT opened_at INTO v_opened FROM public.brand_reach_control WHERE singleton AND circuit_open;
  IF v_opened IS NOT NULL THEN
    PERFORM public.issue_1777_mark_brand_reach_dirty(array(SELECT id FROM public.brands WHERE deleted_at IS NULL),'both');
  END IF;
  FOR v_row IN
    SELECT s.brand_id,x.scope FROM public.brand_reach_refresh_state s
    CROSS JOIN LATERAL (VALUES('follower',s.followers_status,s.followers_dirty_at,s.followers_expires_at),('extended',s.extended_status,s.extended_dirty_at,s.extended_expires_at)) x(scope,status,dirty_at,expires_at)
    WHERE x.status IN ('dirty','failed') OR (x.status='ready' AND x.expires_at<statement_timestamp()+interval '1 minute')
    ORDER BY CASE x.status WHEN 'dirty' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,COALESCE(x.dirty_at,x.expires_at)
    LIMIT p_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    EXIT WHEN clock_timestamp()-v_started>=interval '45 seconds';
    BEGIN
      PERFORM set_config('statement_timeout','8s',true);
      PERFORM public.issue_1777_refresh_brand_reach(v_row.brand_id,v_row.scope);
      v_done:=v_done+1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  IF v_opened IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.brand_reach_refresh_state s WHERE
      s.followers_status IN ('dirty','failed') OR s.extended_status IN ('dirty','failed') OR
      (s.followers_status='ready' AND s.followers_refreshed_at<v_opened) OR (s.extended_status='ready' AND s.extended_refreshed_at<v_opened)
  ) THEN UPDATE public.brand_reach_control SET circuit_open=false,opened_at=NULL,safe_reason_code=NULL,updated_at=statement_timestamp() WHERE singleton; END IF;
  RETURN v_done;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1777_refresh_brand_reach(uuid,text),public.issue_1777_brand_reach_scope_status(uuid,text),public.issue_1777_refresh_brand_reach_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1777_refresh_brand_reach(uuid,text),public.issue_1777_brand_reach_scope_status(uuid,text),public.issue_1777_refresh_brand_reach_batch(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_brand_circle_reach(
  p_brand_id uuid,p_ring text DEFAULT 'all',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_rank integer; v_snapshot bigint;
  v_f record; v_e record; v_rows jsonb:='[]'::jsonb; v_next jsonb:=NULL; v_has_more boolean:=false;
  v_f_count bigint; v_e_count bigint; v_state text; v_cursor_keys text[];
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='circle_forbidden'; END IF;
  v_rank:=public.biz_brand_effective_rank(p_brand_id,v_actor);
  IF COALESCE(v_rank,-1)<public.biz_role_rank('marketing_manager') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='circle_forbidden'; END IF;
  IF p_ring IS NULL OR p_ring NOT IN ('all','follower','extended') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_ring_invalid'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_limit_invalid'; END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_cursor_invalid'; END IF;
    SELECT array_agg(key ORDER BY key) INTO v_cursor_keys FROM jsonb_object_keys(p_cursor) key;
    IF v_cursor_keys IS DISTINCT FROM ARRAY['memberId','ringOrder','snapshotVersion','sortName']::text[]
      OR jsonb_typeof(p_cursor->'snapshotVersion')<>'number' OR jsonb_typeof(p_cursor->'ringOrder')<>'number'
      OR jsonb_typeof(p_cursor->'sortName')<>'string' OR jsonb_typeof(p_cursor->'memberId')<>'string'
      OR (p_cursor->>'snapshotVersion') !~ '^[0-9]+$'
      OR (p_cursor->>'snapshotVersion')::numeric>9223372036854775807
      OR (p_cursor->>'ringOrder') !~ '^[23]$'
      OR (p_cursor->>'memberId')::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='circle_cursor_invalid'; END IF;
  END IF;

  SELECT * INTO v_f FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'follower');
  SELECT * INTO v_e FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'extended');
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id=p_brand_id;
  IF p_cursor IS NOT NULL AND (v_snapshot IS NULL OR (p_cursor->>'snapshotVersion')::bigint<>v_snapshot) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='circle_cursor_stale'; END IF;

  IF v_f.scope_state='ready' THEN
    SELECT count(*) INTO v_f_count FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_f.generation_id AND rm.ring='follower'
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor));
  END IF;
  IF v_e.scope_state='ready' THEN
    SELECT count(*) INTO v_e_count FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.generation_id=v_e.generation_id AND rm.ring='extended'
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor));
  END IF;

  WITH page AS (
    SELECT rm.member_id,rm.ring,rm.ring_order,rm.display_name,rm.avatar_url,rm.reason_code,lower(rm.display_name) sort_name
    FROM public.brand_reach_members rm
    WHERE rm.brand_id=p_brand_id
      AND ((p_ring IN ('all','follower') AND v_f.scope_state='ready' AND rm.generation_id=v_f.generation_id AND rm.ring='follower') OR
           (p_ring IN ('all','extended') AND v_e.scope_state='ready' AND rm.generation_id=v_e.generation_id AND rm.ring='extended'))
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=v_actor AND bu.blocked_id=rm.user_id) OR (bu.blocker_id=rm.user_id AND bu.blocked_id=v_actor))
      AND (p_cursor IS NULL OR (rm.ring_order,lower(rm.display_name),rm.member_id) > ((p_cursor->>'ringOrder')::smallint,p_cursor->>'sortName',(p_cursor->>'memberId')::uuid))
    ORDER BY rm.ring_order,lower(rm.display_name),rm.member_id LIMIT p_limit+1
  ), sliced AS (SELECT * FROM page ORDER BY ring_order,sort_name,member_id LIMIT p_limit)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'memberId',member_id,'ring',ring,'displayName',display_name,'avatarUrl',avatar_url,
      'reasonCode',reason_code,'reasonLabel',CASE ring WHEN 'follower' THEN 'Follows your brand.' ELSE 'In your extended circle.' END
    ) ORDER BY ring_order,sort_name,member_id),'[]'::jsonb),
    (SELECT count(*)>p_limit FROM page)
  INTO v_rows,v_has_more FROM sliced;

  IF v_has_more AND jsonb_array_length(v_rows)>0 THEN
    WITH last_row AS (SELECT value FROM jsonb_array_elements(v_rows) WITH ORDINALITY x(value,n) ORDER BY n DESC LIMIT 1), member AS (
      SELECT rm.* FROM public.brand_reach_members rm,last_row l WHERE rm.member_id=(l.value->>'memberId')::uuid
    ) SELECT jsonb_build_object('snapshotVersion',v_snapshot,'ringOrder',ring_order,'sortName',lower(display_name),'memberId',member_id) INTO v_next FROM member;
  END IF;
  v_state:=CASE
    WHEN p_ring='follower' THEN CASE WHEN v_f.scope_state='ready' THEN 'ready' ELSE 'unavailable' END
    WHEN p_ring='extended' THEN CASE WHEN v_e.scope_state='ready' THEN 'ready' ELSE 'unavailable' END
    WHEN v_f.scope_state='ready' AND v_e.scope_state='ready' THEN 'ready'
    WHEN v_f.scope_state='ready' OR v_e.scope_state='ready' THEN 'partial' ELSE 'unavailable' END;
  IF v_state='unavailable' THEN v_rows:='[]'::jsonb; v_next:=NULL; END IF;
  RETURN jsonb_build_object(
    'schemaVersion',1,'state',v_state,'snapshotVersion',CASE WHEN v_state='unavailable' THEN NULL ELSE v_snapshot END,
    'counts',jsonb_build_object('followers',CASE WHEN v_f.scope_state='ready' THEN v_f_count ELSE NULL END,'extended',CASE WHEN v_e.scope_state='ready' THEN v_e_count ELSE NULL END,'total',CASE WHEN v_f.scope_state='ready' AND v_e.scope_state='ready' THEN v_f_count+v_e_count ELSE NULL END),
    'availability',jsonb_build_object(
      'followers',jsonb_build_object('state',CASE WHEN v_f.scope_state='ready' THEN 'ready' ELSE 'unavailable' END,'reason',v_f.safe_reason,'refreshedAt',v_f.refreshed_at,'expiresAt',v_f.expires_at),
      'extended',jsonb_build_object('state',CASE WHEN v_e.scope_state='ready' THEN 'ready' ELSE 'unavailable' END,'reason',v_e.safe_reason,'refreshedAt',v_e.refreshed_at,'expiresAt',v_e.expires_at)
    ),'rows',v_rows,'nextCursor',v_next
  );
EXCEPTION
  WHEN SQLSTATE '42501' OR SQLSTATE '22023' OR SQLSTATE '40001' THEN RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object('schemaVersion',1,'state','unavailable','snapshotVersion',NULL,'counts',jsonb_build_object('followers',NULL,'extended',NULL,'total',NULL),'availability',jsonb_build_object('followers',jsonb_build_object('state','unavailable','reason','authority_unavailable','refreshedAt',NULL,'expiresAt',NULL),'extended',jsonb_build_object('state','unavailable','reason','authority_unavailable','refreshedAt',NULL,'expiresAt',NULL)),'rows','[]'::jsonb,'nextCursor',NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1777_revalidate_brand_circle_delivery(
  p_brand_id uuid,p_actor_user_id uuid,p_snapshot_version bigint,p_member_ids uuid[],p_purpose text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_f record; v_e record; v_snapshot bigint; v_rows jsonb;
BEGIN
  IF p_purpose IS NULL OR p_purpose NOT IN ('promotion','offering_invitation') THEN RAISE EXCEPTION 'circle_purpose_invalid'; END IF;
  IF COALESCE(array_length(p_member_ids,1),0)<1 OR array_length(p_member_ids,1)>500 OR (SELECT count(DISTINCT x)<>count(*) FROM unnest(p_member_ids) x) THEN RAISE EXCEPTION 'circle_members_invalid'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,p_actor_user_id),-1)<public.biz_role_rank('marketing_manager') THEN RAISE EXCEPTION 'circle_forbidden'; END IF;
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id=p_brand_id;
  IF p_snapshot_version IS NULL OR v_snapshot IS NULL OR v_snapshot<>p_snapshot_version THEN RETURN jsonb_build_object('schemaVersion',1,'state','unavailable','reason','refresh_pending','rows','[]'::jsonb); END IF;
  IF EXISTS(SELECT 1 FROM public.brand_reach_members rm WHERE rm.member_id=ANY(p_member_ids) AND rm.brand_id<>p_brand_id) OR (SELECT count(*) FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.member_id=ANY(p_member_ids))<>array_length(p_member_ids,1) THEN RAISE EXCEPTION 'circle_members_invalid'; END IF;
  SELECT * INTO v_f FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'follower');
  SELECT * INTO v_e FROM public.issue_1777_brand_reach_scope_status(p_brand_id,'extended');
  IF EXISTS(SELECT 1 FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.member_id=ANY(p_member_ids) AND ((rm.ring='follower' AND v_f.scope_state<>'ready') OR (rm.ring='extended' AND v_e.scope_state<>'ready'))) THEN
    RETURN jsonb_build_object('schemaVersion',1,'state','unavailable','reason','authority_unavailable','rows','[]'::jsonb);
  END IF;
  WITH selected AS MATERIALIZED (
    SELECT rm.* FROM public.brand_reach_members rm WHERE rm.brand_id=p_brand_id AND rm.member_id=ANY(p_member_ids)
  ), live AS MATERIALIZED (
    SELECT r.* FROM public.issue_1777_resolve_brand_circle_members(p_brand_id,'all',array(SELECT user_id FROM selected)) r
  )
  SELECT jsonb_agg(jsonb_build_object(
    'memberId',s.member_id,'recipientUserId',s.user_id,'ring',s.ring,
    'eligibility',CASE WHEN l.user_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=p_actor_user_id AND bu.blocked_id=s.user_id) OR (bu.blocker_id=s.user_id AND bu.blocked_id=p_actor_user_id))
      AND NOT EXISTS(SELECT 1 FROM public.brand_circle_exits bx WHERE bx.brand_id=p_brand_id AND bx.user_id=s.user_id AND (bx.visibility_exited_at IS NOT NULL OR bx.delivery_exited_at IS NOT NULL))
      THEN 'eligible' ELSE 'denied' END,
    'denialReason',CASE WHEN l.user_id IS NULL THEN 'membership_changed' WHEN EXISTS(SELECT 1 FROM public.blocked_users bu WHERE (bu.blocker_id=p_actor_user_id AND bu.blocked_id=s.user_id) OR (bu.blocker_id=s.user_id AND bu.blocked_id=p_actor_user_id)) THEN 'blocked' WHEN EXISTS(SELECT 1 FROM public.brand_circle_exits bx WHERE bx.brand_id=p_brand_id AND bx.user_id=s.user_id AND bx.delivery_exited_at IS NOT NULL) THEN 'delivery_denied' ELSE NULL END,
    'reasonCode',s.reason_code,'reasonLabel',CASE s.ring WHEN 'follower' THEN 'Follows your brand.' ELSE 'In your extended circle.' END
  ) ORDER BY s.ring_order,lower(s.display_name),s.member_id) INTO v_rows
  FROM selected s LEFT JOIN live l ON l.user_id=s.user_id AND l.ring=s.ring;
  RETURN jsonb_build_object('schemaVersion',1,'state','ready','reason',NULL,'rows',COALESCE(v_rows,'[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('schemaVersion',1,'state','unavailable','reason','authority_unavailable','rows','[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_brand_circle_reach(uuid,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_brand_circle_reach(uuid,text,jsonb,integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_1777_revalidate_brand_circle_delivery(uuid,uuid,bigint,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1777_revalidate_brand_circle_delivery(uuid,uuid,bigint,uuid[],text) TO service_role;

CREATE TRIGGER issue_1777_brand_follows_source AFTER INSERT OR DELETE ON public.brand_follows FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_blocked_users_source AFTER INSERT OR DELETE ON public.blocked_users FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_profiles_source AFTER UPDATE OF active,explorer_deleted_at,has_completed_onboarding,visibility_mode,first_name,last_name,display_name,username,avatar_url OR INSERT OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_brand_people_source AFTER UPDATE OF brand_id,linked_user_id,record_status,merged_into_person_id,deleted_at OR INSERT OR DELETE ON public.brand_people FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_preferences_source AFTER UPDATE OF extended_brand_reach_enabled,extended_brand_reach_decided_at OR INSERT OR DELETE ON public.brand_circle_preferences FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_exits_source AFTER INSERT OR UPDATE OR DELETE ON public.brand_circle_exits FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_friends_source AFTER UPDATE OF user_id,friend_user_id,status,deleted_at OR INSERT OR DELETE ON public.friends FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_pairings_source AFTER INSERT OR UPDATE OR DELETE ON public.pairings FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_orders_source AFTER UPDATE OF event_id,buyer_user_id,payment_status OR INSERT OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_tickets_source AFTER UPDATE OF order_id,event_id,status,approval_status OR INSERT OR DELETE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_events_source AFTER UPDATE OF brand_id,event_type,status,deleted_at OR INSERT OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_event_dates_source AFTER UPDATE OF event_id,start_at,end_at OR INSERT OR DELETE ON public.event_dates FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();
CREATE TRIGGER issue_1777_flags_source AFTER UPDATE OF is_enabled OR INSERT OR DELETE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.issue_1777_after_source_change();

DO $cron$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_1777_brand_reach_refresh';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
END;
$cron$;
SELECT cron.schedule('issue_1777_brand_reach_refresh','* * * * *',$cron$SELECT public.issue_1777_refresh_brand_reach_batch(20);$cron$);

ALTER FUNCTION public.issue_1777_resolve_brand_circle_members(uuid,text,uuid[]) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_brand_reach_truth_digest(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_mark_brand_reach_dirty(uuid[],text) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_impacted_brands(uuid[],uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_after_source_change() OWNER TO postgres;
ALTER FUNCTION public.issue_1777_refresh_brand_reach(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_brand_reach_scope_status(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_refresh_brand_reach_batch(integer) OWNER TO postgres;
ALTER FUNCTION public.get_brand_circle_reach(uuid,text,jsonb,integer) OWNER TO postgres;
ALTER FUNCTION public.issue_1777_revalidate_brand_circle_delivery(uuid,uuid,bigint,uuid[],text) OWNER TO postgres;

DO $catalog$
DECLARE v_table text; v_fn regprocedure;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['brand_circle_preferences','brand_circle_exits','brand_reach_refresh_state','brand_reach_members','brand_reach_control'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity) THEN RAISE EXCEPTION 'issue_1777_rls_missing:%',v_table; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('brand_reach_refresh_state','brand_reach_members','brand_reach_control') AND grantee IN ('anon','authenticated')) THEN RAISE EXCEPTION 'issue_1777_private_table_grant'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_reach_members' AND column_name ~* '(email|phone|contact|address|device|appsflyer|event|path|connector|relationship)') THEN RAISE EXCEPTION 'issue_1777_forbidden_member_column'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_circle_preferences' AND column_name IN ('nontransactional_brand_delivery_enabled','delivery_decided_at')) THEN RAISE EXCEPTION 'issue_1777_duplicate_delivery_preference'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND p.proname='issue_1777_after_source_change' AND c.relname IN ('event_rsvps','event_rsvp_guests','refunds','payment_webhook_events'))<>0 THEN RAISE EXCEPTION 'issue_1777_forbidden_source_trigger'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND p.proname='issue_1777_after_source_change' AND (t.tgtype&2)=0)<>13 THEN RAISE EXCEPTION 'issue_1777_source_trigger_count'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='issue_1777_brand_reach_refresh')<>1 THEN RAISE EXCEPTION 'issue_1777_cron_not_unique'; END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_1777_resolve_brand_circle_members(uuid,text,uuid[])'::regprocedure,
    'public.issue_1777_brand_reach_truth_digest(uuid,text)'::regprocedure,
    'public.issue_1777_after_source_change()'::regprocedure,
    'public.issue_1777_refresh_brand_reach(uuid,text)'::regprocedure,
    'public.issue_1777_brand_reach_scope_status(uuid,text)'::regprocedure,
    'public.issue_1777_revalidate_brand_circle_delivery(uuid,uuid,bigint,uuid[],text)'::regprocedure,
    'public.get_brand_circle_reach(uuid,text,jsonb,integer)'::regprocedure
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_fn AND prosecdef AND pg_get_userbyid(proowner)='postgres') THEN RAISE EXCEPTION 'issue_1777_function_security:%',v_fn; END IF;
  END LOOP;
END;
$catalog$;

COMMIT;
