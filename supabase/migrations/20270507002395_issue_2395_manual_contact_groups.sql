-- Issue #2395: Manual contact groups are auditable membership overlays over Brand People.
-- Additive only. The feature is dark by default and this migration performs no backfill.
BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('manual_contact_groups_v1',false,'Dark launch: manual Book contact groups')
ON CONFLICT(flag_key) DO NOTHING;

ALTER TABLE public.marketing_audiences
  ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS membership_version bigint NOT NULL DEFAULT 0 CHECK(membership_version>=0);
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS audience_name_snapshot text NULL;

ALTER TABLE public.marketing_audiences DROP CONSTRAINT IF EXISTS marketing_audiences_query_kind_valid;
ALTER TABLE public.marketing_audiences ADD CONSTRAINT marketing_audiences_query_kind_valid CHECK (
  jsonb_typeof(query_definition)='object' AND (
    (query_definition->>'kind') IN ('brand_buyers','event_buyers','brand_followers','custom_segment','offering_send_group')
    OR (query_definition->>'kind'='all_brand_people'
      AND query_definition-ARRAY['kind','brand_id']='{}'::jsonb
      AND query_definition->>'brand_id'=brand_id::text AND is_system_generated)
    OR (query_definition='{"kind":"manual_group"}'::jsonb
      AND brand_id IS NOT NULL AND NOT is_system_generated)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_2395_manual_group_name_unique
  ON public.marketing_audiences(brand_id,lower(btrim(name)))
  WHERE query_definition='{"kind":"manual_group"}'::jsonb AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS issue_2395_audience_same_brand_parent
  ON public.marketing_audiences(id,brand_id);
CREATE UNIQUE INDEX IF NOT EXISTS issue_2395_person_same_brand_parent
  ON public.brand_people(id,brand_id);

CREATE TABLE public.marketing_manual_group_memberships(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  audience_id uuid NOT NULL,
  brand_person_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK(state IN('active','removed','merged','person_deleted','group_deleted')),
  source text NOT NULL CHECK(source IN('book_picker','import','conflict_resolution','merge_projection','split_restore')),
  origin_import_row_id uuid NULL REFERENCES public.brand_contact_import_rows(id) ON DELETE RESTRICT,
  origin_membership_id uuid NULL REFERENCES public.marketing_manual_group_memberships(id) ON DELETE RESTRICT,
  merge_event_id uuid NULL REFERENCES public.brand_person_merge_events(id) ON DELETE RESTRICT,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at timestamptz NULL,
  end_reason text NULL,
  FOREIGN KEY(audience_id,brand_id) REFERENCES public.marketing_audiences(id,brand_id) ON DELETE RESTRICT,
  FOREIGN KEY(brand_person_id,brand_id) REFERENCES public.brand_people(id,brand_id) ON DELETE RESTRICT,
  CONSTRAINT issue_2395_membership_state_shape CHECK(
    (state='active' AND ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR (state<>'active' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX issue_2395_active_membership_unique
  ON public.marketing_manual_group_memberships(audience_id,brand_person_id) WHERE state='active';
CREATE INDEX issue_2395_members_page
  ON public.marketing_manual_group_memberships(audience_id,state,created_at,id);
CREATE INDEX issue_2395_members_person
  ON public.marketing_manual_group_memberships(brand_person_id,state);

CREATE TABLE public.marketing_manual_group_pending_memberships(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  audience_id uuid NOT NULL,
  import_row_id uuid NOT NULL REFERENCES public.brand_contact_import_rows(id) ON DELETE RESTRICT,
  conflict_id uuid NOT NULL REFERENCES public.brand_person_identity_conflicts(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','completed','dismissed','group_deleted')),
  resolved_person_id uuid NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  FOREIGN KEY(audience_id,brand_id) REFERENCES public.marketing_audiences(id,brand_id) ON DELETE RESTRICT,
  UNIQUE(audience_id,import_row_id),
  CONSTRAINT issue_2395_pending_state_shape CHECK(
    (state='pending' AND resolved_person_id IS NULL AND completed_at IS NULL)
    OR (state='completed' AND resolved_person_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state IN('dismissed','group_deleted') AND completed_at IS NOT NULL)
  )
);
CREATE INDEX issue_2395_pending_conflict
  ON public.marketing_manual_group_pending_memberships(conflict_id) WHERE state='pending';

CREATE TABLE public.marketing_manual_group_mutation_receipts(
  client_request_id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN('create','add','remove','rename','delete')),
  request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
  response_json jsonb NOT NULL CHECK(jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.marketing_manual_group_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  audience_id uuid NULL,
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK(action IN('create','rename','members_added','members_removed','pending_completed','pending_dismissed','merge_projected','split_restored','person_deleted','delete_blocked','deleted','campaign_used')),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(audience_id,brand_id) REFERENCES public.marketing_audiences(id,brand_id) ON DELETE RESTRICT
);

DO $block$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['marketing_manual_group_memberships','marketing_manual_group_pending_memberships','marketing_manual_group_mutation_receipts','marketing_manual_group_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',v_table);
  END LOOP;
  GRANT SELECT,INSERT,UPDATE ON public.marketing_manual_group_memberships,public.marketing_manual_group_pending_memberships,public.marketing_manual_group_mutation_receipts TO service_role;
  GRANT SELECT,INSERT ON public.marketing_manual_group_audit TO service_role;
END $block$;

CREATE OR REPLACE FUNCTION public.issue_2395_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN RAISE EXCEPTION 'manual_group_audit_append_only' USING ERRCODE='42501'; END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_reject_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER issue_2395_audit_append_only BEFORE UPDATE OR DELETE ON public.marketing_manual_group_audit
FOR EACH ROW EXECUTE FUNCTION public.issue_2395_reject_audit_mutation();

CREATE OR REPLACE FUNCTION public.issue_2395_feature_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='manual_contact_groups_v1'),false)
$f$;
REVOKE ALL ON FUNCTION public.issue_2395_feature_enabled() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_feature_enabled() TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2395_assert_actor(p_brand_id uuid,p_mutation boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_uid uuid:=auth.uid();
BEGIN
 IF v_uid IS NULL OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_uid),-1)<public.biz_role_rank('marketing_manager') THEN
   RAISE EXCEPTION 'manual_group_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_mutation AND NOT public.issue_2395_feature_enabled() THEN
   RAISE EXCEPTION 'manual_group_feature_disabled' USING ERRCODE='55000';
 END IF;
 RETURN v_uid;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_assert_actor(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_assert_actor(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2395_normalize_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $f$
DECLARE v_name text:=regexp_replace(btrim(COALESCE(p_name,'')),'[[:space:]]+',' ','g');
BEGIN
 IF v_name='' THEN RAISE EXCEPTION 'manual_group_name_required' USING ERRCODE='22023'; END IF;
 IF char_length(v_name)>60 THEN RAISE EXCEPTION 'manual_group_name_too_long' USING ERRCODE='22023'; END IF;
 IF v_name~'[[:cntrl:]]' THEN RAISE EXCEPTION 'manual_group_name_invalid' USING ERRCODE='22023'; END IF;
 IF lower(v_name)=lower('Your Book') THEN RAISE EXCEPTION 'manual_group_name_reserved' USING ERRCODE='22023'; END IF;
 RETURN v_name;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_normalize_name(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_normalize_name(text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2395_manual_group_json(p_group_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT jsonb_build_object('groupId',a.id,'name',a.name,'kind','manual','memberCount',
   (SELECT count(*) FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id AND p.record_status='active' WHERE m.audience_id=a.id AND m.state='active'),
   'pendingReviewCount',(SELECT count(*) FROM public.marketing_manual_group_pending_memberships i WHERE i.audience_id=a.id AND i.state='pending'),
   'membershipVersion',a.membership_version,'lastUsedAt',(SELECT max(c.updated_at) FROM public.marketing_campaigns c WHERE c.audience_id=a.id),
   'createdAt',a.created_at,'updatedAt',a.updated_at)
 FROM public.marketing_audiences a WHERE a.id=p_group_id AND a.query_definition='{"kind":"manual_group"}'::jsonb AND a.deleted_at IS NULL
$f$;
REVOKE ALL ON FUNCTION public.issue_2395_manual_group_json(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_manual_group_json(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2395_receipt_replay(p_request uuid,p_brand uuid,p_actor uuid,p_operation text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.marketing_manual_group_mutation_receipts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,2395));
 SELECT * INTO v_row FROM public.marketing_manual_group_mutation_receipts WHERE client_request_id=p_request;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_row.brand_id<>p_brand OR v_row.actor_id<>p_actor OR v_row.operation<>p_operation OR v_row.request_hash<>p_hash THEN
   RAISE EXCEPTION 'manual_group_idempotency_conflict' USING ERRCODE='23505';
 END IF;
 RETURN v_row.response_json;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_receipt_replay(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_receipt_replay(uuid,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_2395_membership_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
 IF NEW.state='active' AND NOT EXISTS(
   SELECT 1 FROM public.marketing_audiences a JOIN public.brand_people p ON p.id=NEW.brand_person_id
   WHERE a.id=NEW.audience_id AND a.brand_id=NEW.brand_id AND a.deleted_at IS NULL
     AND a.query_definition='{"kind":"manual_group"}'::jsonb AND NOT a.is_system_generated
     AND p.brand_id=NEW.brand_id AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id
 ) THEN RAISE EXCEPTION 'manual_group_membership_invalid' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_membership_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_membership_guard() TO service_role;
CREATE CONSTRAINT TRIGGER issue_2395_membership_guard AFTER INSERT OR UPDATE ON public.marketing_manual_group_memberships
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.issue_2395_membership_guard();

-- Manual rows never inherit account_id=auth.uid() direct-table authority.
DROP POLICY IF EXISTS marketing_audiences_select ON public.marketing_audiences;
CREATE POLICY marketing_audiences_select ON public.marketing_audiences FOR SELECT TO authenticated USING(
  CASE WHEN query_definition='{"kind":"manual_group"}'::jsonb THEN
    deleted_at IS NULL AND brand_id IS NOT NULL AND COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),-1)>=public.biz_role_rank('marketing_manager')
  ELSE account_id=auth.uid() OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id,'brand_member')) END
);
DROP POLICY IF EXISTS marketing_audiences_insert ON public.marketing_audiences;
CREATE POLICY marketing_audiences_insert ON public.marketing_audiences FOR INSERT TO authenticated WITH CHECK(
  query_definition<>'{"kind":"manual_group"}'::jsonb AND account_id=auth.uid() AND (brand_id IS NULL OR public.mkt_brand_min_rank(brand_id,'event_manager'))
);
DROP POLICY IF EXISTS marketing_audiences_update ON public.marketing_audiences;
CREATE POLICY marketing_audiences_update ON public.marketing_audiences FOR UPDATE TO authenticated
 USING(query_definition<>'{"kind":"manual_group"}'::jsonb AND (account_id=auth.uid() OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id,'event_manager'))))
 WITH CHECK(query_definition<>'{"kind":"manual_group"}'::jsonb AND (account_id=auth.uid() OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id,'event_manager'))));
DROP POLICY IF EXISTS marketing_audiences_delete ON public.marketing_audiences;
CREATE POLICY marketing_audiences_delete ON public.marketing_audiences FOR DELETE TO authenticated USING(
  query_definition<>'{"kind":"manual_group"}'::jsonb AND (account_id=auth.uid() OR (brand_id IS NOT NULL AND public.mkt_brand_min_rank(brand_id,'event_manager')))
);

CREATE OR REPLACE FUNCTION public.biz_list_people_manual_groups_v1(p_brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_groups jsonb;
BEGIN
 PERFORM public.issue_2395_assert_actor(p_brand_id,false);
 IF NOT public.issue_2395_feature_enabled() THEN RETURN jsonb_build_object('groups','[]'::jsonb); END IF;
 SELECT COALESCE(jsonb_agg(public.issue_2395_manual_group_json(a.id) ORDER BY a.updated_at DESC,a.id),'[]') INTO v_groups
 FROM public.marketing_audiences a WHERE a.brand_id=p_brand_id AND a.query_definition='{"kind":"manual_group"}'::jsonb AND a.deleted_at IS NULL;
 RETURN jsonb_build_object('groups',v_groups);
END $f$;
REVOKE ALL ON FUNCTION public.biz_list_people_manual_groups_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_list_people_manual_groups_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_get_manual_group_v1(p_brand_id uuid,p_group_id uuid,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_rows jsonb; v_total integer; v_filtered integer; v_search text;
BEGIN
 PERFORM public.issue_2395_assert_actor(p_brand_id,false);
 IF NOT public.issue_2395_feature_enabled() THEN RAISE EXCEPTION 'manual_group_feature_disabled' USING ERRCODE='55000'; END IF;
 IF p_limit<1 OR p_limit>100 OR char_length(COALESCE(p_search,''))>120 THEN RAISE EXCEPTION 'manual_group_query_invalid' USING ERRCODE='22023'; END IF;
 v_search:=replace(replace(replace(lower(btrim(COALESCE(p_search,''))),'\','\\'),'%','\%'),'_','\_');
 IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}'::jsonb AND deleted_at IS NULL) THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO v_total FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id WHERE m.audience_id=p_group_id AND m.state='active' AND p.record_status='active';
 SELECT count(*) INTO v_filtered FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id WHERE m.audience_id=p_group_id AND m.state='active' AND p.record_status='active' AND (v_search='' OR lower(p.display_name) ILIKE '%'||v_search||'%' ESCAPE '\' OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned' AND lower(c.normalized_value) ILIKE '%'||v_search||'%' ESCAPE '\'));
 SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at,id),'[]') INTO v_rows FROM(
   SELECT m.created_at,m.id,jsonb_build_object('personId',p.id,'membershipId',m.id,'createdAt',m.created_at,'displayName',p.display_name,'avatarUrl',p.avatar_url,
    'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary)) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'),'[]'),
    'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope)) FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]')) row_json
   FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id
   WHERE m.audience_id=p_group_id AND m.state='active' AND p.record_status='active'
    AND (v_search='' OR lower(p.display_name) ILIKE '%'||v_search||'%' ESCAPE '\' OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned' AND lower(c.normalized_value) ILIKE '%'||v_search||'%' ESCAPE '\'))
    AND (p_cursor IS NULL OR (m.created_at,m.id)>((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'membershipId')::uuid)) ORDER BY m.created_at,m.id LIMIT p_limit
 ) q;
 RETURN jsonb_build_object('group',public.issue_2395_manual_group_json(p_group_id),'members',v_rows,'totalMembers',v_total,'filteredTotal',v_filtered,
  'pendingReviewCount',(SELECT count(*) FROM public.marketing_manual_group_pending_memberships WHERE audience_id=p_group_id AND state='pending'),
  'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object('createdAt',v_rows->-1->>'createdAt','membershipId',v_rows->-1->>'membershipId') ELSE NULL END);
END $f$;
REVOKE ALL ON FUNCTION public.biz_get_manual_group_v1(uuid,uuid,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_manual_group_v1(uuid,uuid,text,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_get_manual_group_book_picker_v1(p_brand_id uuid,p_group_id uuid DEFAULT NULL,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_rows jsonb; v_search text;
BEGIN
 PERFORM public.issue_2395_assert_actor(p_brand_id,false);
 IF NOT public.issue_2395_feature_enabled() THEN RAISE EXCEPTION 'manual_group_feature_disabled' USING ERRCODE='55000'; END IF;
 IF p_limit<1 OR p_limit>100 OR char_length(COALESCE(p_search,''))>120 THEN RAISE EXCEPTION 'manual_group_query_invalid' USING ERRCODE='22023'; END IF;
 v_search:=replace(replace(replace(lower(btrim(COALESCE(p_search,''))),'\','\\'),'%','\%'),'_','\_');
 IF p_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}'::jsonb AND deleted_at IS NULL) THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 SELECT COALESCE(jsonb_agg(row_json ORDER BY updated_at DESC,id DESC),'[]') INTO v_rows FROM(
   SELECT p.id,p.updated_at,jsonb_build_object('personId',p.id,'updatedAt',p.updated_at,'displayName',p.display_name,'avatarUrl',p.avatar_url,
    'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary)) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'),'[]'),
    'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope)) FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]'),
    'isMember',EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships m WHERE m.audience_id=p_group_id AND m.brand_person_id=p.id AND m.state='active')) row_json
   FROM public.brand_people p WHERE p.brand_id=p_brand_id AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id
    AND (v_search='' OR lower(p.display_name) ILIKE '%'||v_search||'%' ESCAPE '\' OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned' AND lower(c.normalized_value) ILIKE '%'||v_search||'%' ESCAPE '\'))
    AND (p_cursor IS NULL OR (p.updated_at,p.id)<((p_cursor->>'updatedAt')::timestamptz,(p_cursor->>'personId')::uuid)) ORDER BY p.updated_at DESC,p.id DESC LIMIT p_limit
 ) q;
 RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object('updatedAt',v_rows->-1->>'updatedAt','personId',v_rows->-1->>'personId') ELSE NULL END);
END $f$;
REVOKE ALL ON FUNCTION public.biz_get_manual_group_book_picker_v1(uuid,uuid,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_manual_group_book_picker_v1(uuid,uuid,text,jsonb,integer) TO authenticated;

-- Return bounded aggregate truth for Review without exposing the group's full
-- membership set through a paged detail response.
CREATE OR REPLACE FUNCTION public.biz_preview_manual_group_result_v1(p_brand_id uuid,p_group_id uuid,p_person_ids uuid[] DEFAULT '{}',p_import_batch_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,false); v_current integer; v_resulting integer;
BEGIN
 IF NOT public.issue_2395_feature_enabled() THEN RAISE EXCEPTION 'manual_group_feature_disabled' USING ERRCODE='55000'; END IF;
 IF cardinality(COALESCE(p_person_ids,'{}'))>100 OR cardinality(COALESCE(p_import_batch_ids,'{}'))>20 THEN RAISE EXCEPTION 'manual_group_input_too_large' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}'::jsonb AND deleted_at IS NULL) THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(COALESCE(p_person_ids,'{}')) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.brand_people p WHERE p.id=requested.id AND p.brand_id=p_brand_id AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id)) THEN RAISE EXCEPTION 'manual_group_person_invalid' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(COALESCE(p_import_batch_ids,'{}')) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.brand_contact_import_batches b WHERE b.id=requested.id AND b.brand_id=p_brand_id AND b.actor_user_id=v_actor AND b.state='completed')) THEN RAISE EXCEPTION 'manual_group_import_batch_invalid' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_current FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id WHERE m.audience_id=p_group_id AND m.state='active' AND p.record_status='active';
 WITH candidate_ids AS(
   SELECT m.brand_person_id id FROM public.marketing_manual_group_memberships m JOIN public.brand_people p ON p.id=m.brand_person_id AND p.brand_id=m.brand_id WHERE m.audience_id=p_group_id AND m.state='active' AND p.record_status='active'
   UNION SELECT id FROM unnest(COALESCE(p_person_ids,'{}')) requested(id)
   UNION SELECT public.biz_brand_person_canonical(r.canonical_person_id) FROM public.brand_contact_import_rows r WHERE r.batch_id=ANY(COALESCE(p_import_batch_ids,'{}')) AND r.outcome IN('added','updated','unchanged') AND r.canonical_person_id IS NOT NULL
 ) SELECT count(DISTINCT id) INTO v_resulting FROM candidate_ids;
 RETURN jsonb_build_object('currentMemberCount',v_current,'resultingMemberCount',v_resulting,'newMemberCount',v_resulting-v_current);
END $f$;
REVOKE ALL ON FUNCTION public.biz_preview_manual_group_result_v1(uuid,uuid,uuid[],uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_preview_manual_group_result_v1(uuid,uuid,uuid[],uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_2395_add_people(p_brand uuid,p_group uuid,p_actor uuid,p_person_ids uuid[],p_batch_ids uuid[],p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_person uuid; v_batch uuid; v_row public.brand_contact_import_rows%ROWTYPE; v_added integer:=0; v_already integer:=0; v_pending integer:=0; v_rejected integer:=0; v_suppressed integer:=0;
BEGIN
 IF cardinality(COALESCE(p_person_ids,'{}'))>100 OR cardinality(COALESCE(p_batch_ids,'{}'))>20 THEN RAISE EXCEPTION 'manual_group_input_too_large' USING ERRCODE='22023'; END IF;
 FOR v_person IN SELECT DISTINCT unnest(COALESCE(p_person_ids,'{}')) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.brand_people p WHERE p.id=v_person AND p.brand_id=p_brand AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id) THEN RAISE EXCEPTION 'manual_group_person_invalid' USING ERRCODE='23514'; END IF;
   INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,created_by) VALUES(p_brand,p_group,v_person,p_source,p_actor) ON CONFLICT(audience_id,brand_person_id) WHERE state='active' DO NOTHING;
   IF FOUND THEN v_added:=v_added+1; ELSE v_already:=v_already+1; END IF;
 END LOOP;
 FOR v_batch IN SELECT DISTINCT unnest(COALESCE(p_batch_ids,'{}')) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.brand_contact_import_batches b WHERE b.id=v_batch AND b.brand_id=p_brand AND b.actor_user_id=p_actor AND b.state='completed') THEN RAISE EXCEPTION 'manual_group_import_batch_invalid' USING ERRCODE='23514'; END IF;
   FOR v_row IN SELECT * FROM public.brand_contact_import_rows WHERE batch_id=v_batch ORDER BY row_number LOOP
     IF v_row.outcome IN('added','updated','unchanged') AND v_row.canonical_person_id IS NOT NULL THEN
       INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,origin_import_row_id,created_by) VALUES(p_brand,p_group,public.biz_brand_person_canonical(v_row.canonical_person_id),'import',v_row.id,p_actor) ON CONFLICT(audience_id,brand_person_id) WHERE state='active' DO NOTHING;
       IF FOUND THEN v_added:=v_added+1; ELSE v_already:=v_already+1; END IF;
       IF v_row.email_suppressed OR v_row.sms_suppressed THEN v_suppressed:=v_suppressed+1; END IF;
     ELSIF v_row.outcome='review' AND v_row.conflict_id IS NOT NULL THEN
       INSERT INTO public.marketing_manual_group_pending_memberships(brand_id,audience_id,import_row_id,conflict_id,created_by) VALUES(p_brand,p_group,v_row.id,v_row.conflict_id,p_actor) ON CONFLICT(audience_id,import_row_id) DO NOTHING;
       IF FOUND THEN v_pending:=v_pending+1; END IF;
     ELSE v_rejected:=v_rejected+1; END IF;
   END LOOP;
 END LOOP;
 IF v_added>0 THEN UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=p_group; END IF;
 RETURN jsonb_build_object('addedCount',v_added,'alreadyMemberCount',v_already,'pendingReviewCount',v_pending,'rejectedCount',v_rejected,'suppressedMemberCount',v_suppressed);
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_add_people(uuid,uuid,uuid,uuid[],uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_add_people(uuid,uuid,uuid,uuid[],uuid[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_create_manual_group_v1(p_brand_id uuid,p_name text,p_person_ids uuid[] DEFAULT '{}',p_import_batch_ids uuid[] DEFAULT '{}',p_client_request_id uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,true); v_name text:=public.issue_2395_normalize_name(p_name); v_hash text; v_replay jsonb; v_group uuid; v_counts jsonb; v_result jsonb; v_constraint text;
BEGIN
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('name',v_name,'people',(SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]') FROM unnest(COALESCE(p_person_ids,'{}')) x),'batches',(SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]') FROM unnest(COALESCE(p_import_batch_ids,'{}')) x))::text,'UTF8'),'sha256'),'hex');
 v_replay:=public.issue_2395_receipt_replay(p_client_request_id,p_brand_id,v_actor,'create',v_hash); IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 IF EXISTS(SELECT 1 FROM public.marketing_audiences WHERE brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}' AND deleted_at IS NULL AND lower(btrim(name))=lower(v_name)) THEN RAISE EXCEPTION 'manual_group_name_conflict' USING ERRCODE='23505'; END IF;
 BEGIN
  INSERT INTO public.marketing_audiences(account_id,brand_id,name,query_definition,is_system_generated,created_by) VALUES(v_actor,p_brand_id,v_name,'{"kind":"manual_group"}',false,v_actor) RETURNING id INTO v_group;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
  IF v_constraint='issue_2395_manual_group_name_unique' THEN RAISE EXCEPTION 'manual_group_name_conflict' USING ERRCODE='23505'; END IF;
  RAISE;
 END;
 v_counts:=public.issue_2395_add_people(p_brand_id,v_group,v_actor,p_person_ids,p_import_batch_ids,'book_picker');
 v_result:=v_counts||jsonb_build_object('group',public.issue_2395_manual_group_json(v_group),'membershipVersion',(SELECT membership_version FROM public.marketing_audiences WHERE id=v_group));
 INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(p_brand_id,v_group,v_actor,'create',jsonb_build_object('memberCount',(v_result->'group'->>'memberCount')::int,'pendingCount',(v_result->>'pendingReviewCount')::int));
 INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'create',v_hash,v_result,now()); RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_create_manual_group_v1(uuid,text,uuid[],uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_create_manual_group_v1(uuid,text,uuid[],uuid[],uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_add_manual_group_people_v1(p_brand_id uuid,p_group_id uuid,p_person_ids uuid[] DEFAULT '{}',p_import_batch_ids uuid[] DEFAULT '{}',p_client_request_id uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,true); v_hash text; v_replay jsonb; v_counts jsonb; v_result jsonb;
BEGIN
 IF COALESCE(cardinality(p_person_ids),0)=0 AND COALESCE(cardinality(p_import_batch_ids),0)=0 THEN RAISE EXCEPTION 'manual_group_people_required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('group',p_group_id,'people',(SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]') FROM unnest(COALESCE(p_person_ids,'{}')) x),'batches',(SELECT COALESCE(jsonb_agg(x ORDER BY x),'[]') FROM unnest(COALESCE(p_import_batch_ids,'{}')) x))::text,'UTF8'),'sha256'),'hex');
 v_replay:=public.issue_2395_receipt_replay(p_client_request_id,p_brand_id,v_actor,'add',v_hash); IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 v_counts:=public.issue_2395_add_people(p_brand_id,p_group_id,v_actor,p_person_ids,p_import_batch_ids,'book_picker'); v_result:=v_counts||jsonb_build_object('group',public.issue_2395_manual_group_json(p_group_id),'membershipVersion',(SELECT membership_version FROM public.marketing_audiences WHERE id=p_group_id));
 INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(p_brand_id,p_group_id,v_actor,'members_added',v_counts);
 INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'add',v_hash,v_result,now()); RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_add_manual_group_people_v1(uuid,uuid,uuid[],uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_add_manual_group_people_v1(uuid,uuid,uuid[],uuid[],uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_remove_manual_group_people_v1(p_brand_id uuid,p_group_id uuid,p_person_ids uuid[],p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,true); v_hash text; v_replay jsonb; v_removed integer; v_result jsonb;
BEGIN
 IF cardinality(COALESCE(p_person_ids,'{}'))<1 OR cardinality(p_person_ids)>100 THEN RAISE EXCEPTION 'manual_group_people_required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('group',p_group_id,'people',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_person_ids) x))::text,'UTF8'),'sha256'),'hex'); v_replay:=public.issue_2395_receipt_replay(p_client_request_id,p_brand_id,v_actor,'remove',v_hash); IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 WITH ended AS(UPDATE public.marketing_manual_group_memberships SET state='removed',ended_by=v_actor,ended_at=now(),end_reason='host_removed' WHERE audience_id=p_group_id AND state='active' AND brand_person_id=ANY(p_person_ids) RETURNING 1) SELECT count(*) INTO v_removed FROM ended;
 IF v_removed>0 THEN UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=p_group_id; END IF;
 v_result:=jsonb_build_object('removedCount',v_removed,'notMemberCount',(SELECT count(DISTINCT x) FROM unnest(p_person_ids) x)-v_removed,'memberCount',(public.issue_2395_manual_group_json(p_group_id)->>'memberCount')::int,'membershipVersion',(SELECT membership_version FROM public.marketing_audiences WHERE id=p_group_id));
 INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(p_brand_id,p_group_id,v_actor,'members_removed',jsonb_build_object('removedCount',v_removed)); INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'remove',v_hash,v_result,now()); RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_remove_manual_group_people_v1(uuid,uuid,uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_remove_manual_group_people_v1(uuid,uuid,uuid[],uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_rename_manual_group_v1(p_brand_id uuid,p_group_id uuid,p_name text,p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,true); v_name text:=public.issue_2395_normalize_name(p_name); v_hash text; v_replay jsonb; v_result jsonb; v_constraint text;
BEGIN
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('group',p_group_id,'name',v_name)::text,'UTF8'),'sha256'),'hex'); v_replay:=public.issue_2395_receipt_replay(p_client_request_id,p_brand_id,v_actor,'rename',v_hash); IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 BEGIN
  UPDATE public.marketing_audiences SET name=v_name,updated_at=now() WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}' AND deleted_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
  IF v_constraint='issue_2395_manual_group_name_unique' THEN RAISE EXCEPTION 'manual_group_name_conflict' USING ERRCODE='23505'; END IF;
  RAISE;
 END;
 v_result:=jsonb_build_object('groupId',p_group_id,'name',v_name,'updatedAt',(SELECT updated_at FROM public.marketing_audiences WHERE id=p_group_id)); INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action) VALUES(p_brand_id,p_group_id,v_actor,'rename'); INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'rename',v_hash,v_result,now()); RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_rename_manual_group_v1(uuid,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_rename_manual_group_v1(uuid,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_delete_manual_group_v1(p_brand_id uuid,p_group_id uuid,p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $f$
DECLARE v_actor uuid:=public.issue_2395_assert_actor(p_brand_id,true); v_hash text; v_replay jsonb; v_block integer; v_count integer; v_deleted timestamptz:=now(); v_result jsonb;
BEGIN
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('group',p_group_id)::text,'UTF8'),'sha256'),'hex'); v_replay:=public.issue_2395_receipt_replay(p_client_request_id,p_brand_id,v_actor,'delete',v_hash); IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
 PERFORM 1 FROM public.marketing_audiences WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}'::jsonb AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO v_block FROM public.marketing_campaigns WHERE audience_id=p_group_id AND brand_id=p_brand_id AND status IN('draft','scheduled','sending');
 IF v_block>0 THEN
  v_result:=jsonb_build_object('code','manual_group_delete_blocked','blockingCampaignCount',v_block);
  INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(p_brand_id,p_group_id,v_actor,'delete_blocked',jsonb_build_object('blockingCampaignCount',v_block));
  INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'delete',v_hash,v_result,now());
  RETURN v_result;
 END IF;
 SELECT count(*) INTO v_count FROM public.marketing_manual_group_memberships WHERE audience_id=p_group_id AND state='active'; UPDATE public.marketing_audiences SET deleted_at=v_deleted,deleted_by=v_actor,membership_version=membership_version+1,updated_at=v_deleted WHERE id=p_group_id AND brand_id=p_brand_id AND query_definition='{"kind":"manual_group"}' AND deleted_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'manual_group_not_found' USING ERRCODE='P0002'; END IF;
 UPDATE public.marketing_manual_group_memberships SET state='group_deleted',ended_at=v_deleted,ended_by=v_actor,end_reason='group_deleted' WHERE audience_id=p_group_id AND state='active'; UPDATE public.marketing_manual_group_pending_memberships SET state='group_deleted',completed_at=v_deleted WHERE audience_id=p_group_id AND state='pending';
 v_result:=jsonb_build_object('groupId',p_group_id,'deletedAt',v_deleted,'peoplePreservedCount',v_count); INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(p_brand_id,p_group_id,v_actor,'deleted',jsonb_build_object('peoplePreservedCount',v_count)); INSERT INTO public.marketing_manual_group_mutation_receipts VALUES(p_client_request_id,p_brand_id,v_actor,'delete',v_hash,v_result,now()); RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_delete_manual_group_v1(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_delete_manual_group_v1(uuid,uuid,uuid) TO authenticated;

-- Conflict completion: the existing rank-50 resolver writes the import row first.
CREATE OR REPLACE FUNCTION public.issue_2395_import_resolution_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_intent public.marketing_manual_group_pending_memberships%ROWTYPE; v_person uuid;
BEGIN
 IF OLD.outcome<>'review' OR NEW.outcome NOT IN('added','updated') OR NEW.canonical_person_id IS NULL THEN RETURN NEW; END IF;
 v_person:=public.biz_brand_person_canonical(NEW.canonical_person_id);
 FOR v_intent IN SELECT * FROM public.marketing_manual_group_pending_memberships WHERE import_row_id=NEW.id AND state='pending' FOR UPDATE LOOP
   IF EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=v_intent.audience_id AND deleted_at IS NULL AND query_definition='{"kind":"manual_group"}') THEN
     INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,origin_import_row_id,created_by) VALUES(v_intent.brand_id,v_intent.audience_id,v_person,'conflict_resolution',NEW.id,v_intent.created_by) ON CONFLICT(audience_id,brand_person_id) WHERE state='active' DO NOTHING;
     UPDATE public.marketing_manual_group_pending_memberships SET state='completed',resolved_person_id=v_person,completed_at=now() WHERE id=v_intent.id; UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=v_intent.audience_id;
     INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(v_intent.brand_id,v_intent.audience_id,NULL,'pending_completed',jsonb_build_object('importRowId',NEW.id,'conflictId',NEW.conflict_id));
   ELSE UPDATE public.marketing_manual_group_pending_memberships SET state='group_deleted',completed_at=now() WHERE id=v_intent.id; END IF;
 END LOOP; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_import_resolution_projection() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_import_resolution_projection() TO service_role;
CREATE TRIGGER issue_2395_import_resolution_projection AFTER UPDATE OF outcome,canonical_person_id ON public.brand_contact_import_rows FOR EACH ROW EXECUTE FUNCTION public.issue_2395_import_resolution_projection();

CREATE OR REPLACE FUNCTION public.issue_2395_conflict_dismiss_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row record;
BEGIN
 IF OLD.status='open' AND NEW.status='resolved_dismissed' THEN
   FOR v_row IN UPDATE public.marketing_manual_group_pending_memberships SET state='dismissed',completed_at=now() WHERE conflict_id=NEW.id AND state='pending' RETURNING brand_id,audience_id,id LOOP
     UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=v_row.audience_id;
     INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(v_row.brand_id,v_row.audience_id,NEW.resolved_by,'pending_dismissed',jsonb_build_object('conflictId',NEW.id));
   END LOOP;
 END IF; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_conflict_dismiss_projection() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_conflict_dismiss_projection() TO service_role;
CREATE TRIGGER issue_2395_conflict_dismiss_projection AFTER UPDATE OF status ON public.brand_person_identity_conflicts FOR EACH ROW EXECUTE FUNCTION public.issue_2395_conflict_dismiss_projection();

-- Merge projection is triggered by the canonical merge ledger INSERT before the loser is retired.
CREATE OR REPLACE FUNCTION public.issue_2395_merge_membership_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.marketing_manual_group_memberships%ROWTYPE; v_manifest jsonb:='[]'; v_winner_preexisting boolean; v_winner_membership uuid;
BEGIN
 FOR v_row IN SELECT * FROM public.marketing_manual_group_memberships WHERE brand_person_id=NEW.loser_person_id AND state='active' FOR UPDATE LOOP
   SELECT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships WHERE audience_id=v_row.audience_id AND brand_person_id=NEW.winner_person_id AND state='active') INTO v_winner_preexisting;
   UPDATE public.marketing_manual_group_memberships SET state='merged',ended_at=now(),ended_by=NEW.acted_by,end_reason='identity_merge',merge_event_id=NEW.id WHERE id=v_row.id;
   v_winner_membership:=NULL;
   IF NOT v_winner_preexisting THEN INSERT INTO public.marketing_manual_group_memberships(brand_id,audience_id,brand_person_id,source,origin_membership_id,merge_event_id,created_by) VALUES(v_row.brand_id,v_row.audience_id,NEW.winner_person_id,'merge_projection',v_row.id,NEW.id,NEW.acted_by) RETURNING id INTO v_winner_membership; END IF;
   v_manifest:=v_manifest||jsonb_build_array(jsonb_build_object('loserMembershipId',v_row.id,'audienceId',v_row.audience_id,'winnerPreexisting',v_winner_preexisting,'winnerMembershipId',v_winner_membership));
   UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=v_row.audience_id;
   INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(v_row.brand_id,v_row.audience_id,NEW.acted_by,'merge_projected',jsonb_build_object('mergeEventId',NEW.id));
 END LOOP;
 UPDATE public.brand_person_merge_events SET reversal_manifest=reversal_manifest||jsonb_build_object('manualGroupMemberships',v_manifest) WHERE id=NEW.id;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_merge_membership_projection() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_merge_membership_projection() TO service_role;
CREATE TRIGGER issue_2395_merge_membership_projection AFTER INSERT ON public.brand_person_merge_events FOR EACH ROW EXECUTE FUNCTION public.issue_2395_merge_membership_projection();

CREATE OR REPLACE FUNCTION public.issue_2395_split_membership_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_item jsonb; v_membership uuid; v_winner_membership uuid; v_audience uuid;
BEGIN
 IF OLD.status='active' AND NEW.status='reversed' THEN
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.reversal_manifest->'manualGroupMemberships','[]')) LOOP
   v_membership:=(v_item->>'loserMembershipId')::uuid; v_winner_membership:=NULLIF(v_item->>'winnerMembershipId','')::uuid; v_audience:=(v_item->>'audienceId')::uuid;
   IF EXISTS(SELECT 1 FROM public.marketing_audiences WHERE id=v_audience AND deleted_at IS NULL) THEN
    UPDATE public.marketing_manual_group_memberships SET state='removed',ended_at=now(),ended_by=NEW.reversed_by,end_reason='split_restore' WHERE id=v_winner_membership AND audience_id=v_audience AND merge_event_id=NEW.id AND source='merge_projection' AND state='active';
    UPDATE public.marketing_manual_group_memberships SET state='active',source='split_restore',ended_at=NULL,ended_by=NULL,end_reason=NULL WHERE id=v_membership AND state='merged';
    UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=v_audience;
    INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(NEW.brand_id,v_audience,NEW.reversed_by,'split_restored',jsonb_build_object('mergeEventId',NEW.id));
   END IF;
  END LOOP;
 END IF; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_split_membership_restore() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_split_membership_restore() TO service_role;
CREATE TRIGGER issue_2395_split_membership_restore AFTER UPDATE OF status ON public.brand_person_merge_events FOR EACH ROW EXECUTE FUNCTION public.issue_2395_split_membership_restore();

CREATE OR REPLACE FUNCTION public.issue_2395_person_delete_memberships()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_audience uuid;
BEGIN
 IF OLD.record_status='active' AND NEW.record_status='deleted' THEN
  FOR v_audience IN SELECT DISTINCT audience_id FROM public.marketing_manual_group_memberships WHERE brand_person_id=NEW.id AND state='active' LOOP
   UPDATE public.marketing_manual_group_memberships SET state='person_deleted',ended_at=now(),end_reason='person_deleted' WHERE audience_id=v_audience AND brand_person_id=NEW.id AND state='active';
   UPDATE public.marketing_manual_group_pending_memberships SET state='dismissed',completed_at=now() WHERE audience_id=v_audience AND resolved_person_id=NEW.id AND state='pending';
   UPDATE public.marketing_audiences SET membership_version=membership_version+1,updated_at=now() WHERE id=v_audience;
   INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,action,safe_metadata) VALUES(NEW.brand_id,v_audience,'person_deleted',jsonb_build_object('removedCount',1));
  END LOOP;
 END IF; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.issue_2395_person_delete_memberships() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2395_person_delete_memberships() TO service_role;
CREATE TRIGGER issue_2395_person_delete_memberships AFTER UPDATE OF record_status ON public.brand_people FOR EACH ROW EXECUTE FUNCTION public.issue_2395_person_delete_memberships();

-- Generalize #1995 candidates while preserving the v1 function name consumed by old clients.
CREATE OR REPLACE FUNCTION public.biz_marketing_book_quote_candidates(p_actor_id uuid,p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE; v_rows jsonb; v_selected integer; v_manual boolean;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_audience FROM public.marketing_audiences WHERE id=v_campaign.audience_id AND brand_id=v_campaign.brand_id; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 v_manual:=v_audience.query_definition='{"kind":"manual_group"}'::jsonb;
 IF NOT public.issue_1995_flags_enabled() OR (v_manual AND NOT public.issue_2395_feature_enabled()) THEN RAISE EXCEPTION 'book_blast_flag_disabled' USING ERRCODE='55000'; END IF;
 IF v_campaign.status<>'draft' OR v_campaign.channel NOT IN('email','sms')
  OR (v_manual AND public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('marketing_manager'))
  OR (NOT v_manual AND public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('event_manager')) THEN RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE='42501'; END IF;
 IF v_manual AND v_audience.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT v_manual AND NOT(v_audience.is_system_generated AND v_audience.query_definition=jsonb_build_object('kind','all_brand_people','brand_id',v_campaign.brand_id::text)) THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO v_selected FROM public.brand_people p WHERE p.brand_id=v_campaign.brand_id AND p.record_status='active' AND (NOT v_manual OR EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships m WHERE m.audience_id=v_audience.id AND m.brand_person_id=p.id AND m.state='active'));
 SELECT COALESCE(jsonb_agg(jsonb_build_object('brandPersonId',p.id,'contactMethodId',a.contact_method_id,'normalizedContact',a.normalized_contact,'allowed',COALESCE(a.allowed,false),'safeReasonCode',CASE WHEN a.contact_method_id IS NULL THEN 'channel_unavailable' ELSE a.reason END,'audienceVersion',v_audience.membership_version) ORDER BY p.id),'[]') INTO v_rows
 FROM public.brand_people p LEFT JOIN LATERAL public.biz_brand_person_authorized_contact_v2(v_campaign.brand_id,p.id,v_campaign.channel,'marketing_blast') a ON true WHERE p.brand_id=v_campaign.brand_id AND p.record_status='active' AND (NOT v_manual OR EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships m WHERE m.audience_id=v_audience.id AND m.brand_person_id=p.id AND m.state='active'));
 RETURN jsonb_build_object('brandId',v_campaign.brand_id,'channel',v_campaign.channel,'selectedCount',v_selected,'content',v_campaign.channel_payload,'candidates',v_rows,'audienceId',v_audience.id,'audienceKind',v_audience.query_definition->>'kind','audienceVersion',v_audience.membership_version,'audienceName',v_audience.name);
END $f$;
REVOKE ALL ON FUNCTION public.biz_marketing_book_quote_candidates(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_book_quote_candidates(uuid,uuid) TO service_role;

-- Preserve #1995's rank-40 Book replay gate while allowing rank-20 Manual replay.
CREATE OR REPLACE FUNCTION public.biz_marketing_book_existing_result_v1(
 p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_hash text,p_quoted_at timestamptz,
 p_expected_cost_minor bigint,p_currency text,p_scheduled_for timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_execution public.marketing_book_send_executions%ROWTYPE; v_campaign public.marketing_campaigns%ROWTYPE; v_manual boolean;
 v_delivered integer; v_deferred integer; v_failed integer; v_preview integer; v_queued integer; v_rows integer;
 v_requested_send_mode text:=CASE WHEN p_scheduled_for IS NULL THEN 'now' ELSE 'scheduled' END;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
 SELECT a.query_definition='{"kind":"manual_group"}'::jsonb INTO v_manual
 FROM public.marketing_audiences a WHERE a.id=v_campaign.audience_id AND a.brand_id=v_campaign.brand_id;
 IF NOT FOUND
  OR (v_manual AND public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('marketing_manager'))
  OR (NOT v_manual AND v_campaign.account_id<>p_actor_id AND public.biz_brand_effective_rank(v_campaign.brand_id,p_actor_id)<public.biz_role_rank('event_manager'))
 THEN RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_execution FROM public.marketing_book_send_executions WHERE campaign_id=p_campaign_id;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.marketing_book_send_executions WHERE brand_id=v_campaign.brand_id AND client_request_id=p_client_request_id) THEN RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE='23505'; END IF;
  RETURN NULL;
 END IF;
 IF v_execution.actor_id<>p_actor_id THEN RAISE EXCEPTION 'book_blast_forbidden' USING ERRCODE='42501'; END IF;
 IF v_execution.client_request_id<>p_client_request_id OR v_execution.quote_hash<>p_quote_hash
  OR v_execution.quoted_at IS DISTINCT FROM p_quoted_at OR v_execution.estimated_cost_minor IS DISTINCT FROM p_expected_cost_minor
  OR v_execution.currency IS DISTINCT FROM p_currency OR v_execution.send_mode IS DISTINCT FROM v_requested_send_mode
  OR (v_execution.send_mode='scheduled' AND v_execution.scheduled_for IS DISTINCT FROM p_scheduled_for) THEN RAISE EXCEPTION 'book_blast_idempotency_conflict' USING ERRCODE='23505'; END IF;
 SELECT count(*) FILTER(WHERE status IN ('sent','delivered','opened','clicked','unsubscribed')),count(*) FILTER(WHERE status='deferred'),
  count(*) FILTER(WHERE status IN ('failed','bounced')),count(*) FILTER(WHERE status='preview_skipped'),count(*) FILTER(WHERE status='queued'),count(*)
 INTO v_delivered,v_deferred,v_failed,v_preview,v_queued,v_rows FROM public.marketing_messages WHERE campaign_id=p_campaign_id;
 RETURN jsonb_build_object('executionId',v_execution.id,'campaignId',p_campaign_id,'scheduledFor',v_execution.scheduled_for,'sendMode',v_execution.send_mode,
  'campaignStatus',v_campaign.status,'campaignFailed',EXISTS(SELECT 1 FROM public.marketing_book_send_failures WHERE campaign_id=p_campaign_id),
  'sealedReachable',v_execution.reachable_count,'delivered',v_delivered,'deferred',v_deferred,'recipientFailed',v_failed,'previewSkipped',v_preview,'queued',v_queued,'messageRows',v_rows);
END $f$;
REVOKE ALL ON FUNCTION public.biz_marketing_book_existing_result_v1(uuid,uuid,uuid,text,timestamptz,bigint,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_book_existing_result_v1(uuid,uuid,uuid,text,timestamptz,bigint,text,timestamptz) TO service_role;

-- The legacy confirm body remains the sealed owner; this wrapper locks and snapshots Manual identity first.
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_people_send_v2(p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_snapshot jsonb,p_scheduled_for timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE; v_live jsonb; v_result jsonb;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_audience FROM public.marketing_audiences WHERE id=v_campaign.audience_id AND brand_id=v_campaign.brand_id FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 IF v_audience.query_definition='{"kind":"manual_group"}'::jsonb THEN
  v_live:=public.biz_marketing_book_quote_candidates(p_actor_id,p_campaign_id);
  IF v_audience.deleted_at IS NOT NULL OR p_quote_snapshot->>'audienceId' IS DISTINCT FROM v_audience.id::text
   OR p_quote_snapshot->>'audienceKind' IS DISTINCT FROM 'manual_group'
   OR (p_quote_snapshot->>'audienceVersion')::bigint IS DISTINCT FROM v_audience.membership_version
   OR p_quote_snapshot->>'audienceName' IS DISTINCT FROM v_audience.name THEN RAISE EXCEPTION 'manual_group_preview_stale' USING ERRCODE='23514'; END IF;
 END IF;
 v_result:=public.biz_confirm_marketing_book_send_v1(p_actor_id,p_campaign_id,p_client_request_id,p_quote_snapshot,p_scheduled_for);
 IF v_audience.query_definition='{"kind":"manual_group"}'::jsonb THEN
  UPDATE public.marketing_campaigns SET audience_name_snapshot=v_audience.name WHERE id=p_campaign_id;
  INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(v_campaign.brand_id,v_audience.id,p_actor_id,'campaign_used',jsonb_build_object('campaignId',p_campaign_id,'membershipVersion',v_audience.membership_version));
 END IF; RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_confirm_marketing_people_send_v2(uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_confirm_marketing_people_send_v2(uuid,uuid,uuid,jsonb,timestamptz) TO service_role;

-- Replace v1 with a compatibility dispatcher so current Book clients remain unchanged.
ALTER FUNCTION public.biz_confirm_marketing_book_send_v1(uuid,uuid,uuid,jsonb,timestamptz) RENAME TO issue_2395_confirm_marketing_book_send_legacy;
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_book_send_v1(p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_snapshot jsonb,p_scheduled_for timestamptz)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT public.biz_confirm_marketing_people_send_v2(p_actor_id,p_campaign_id,p_client_request_id,p_quote_snapshot,p_scheduled_for)
$f$;
-- Point v2 at the renamed sealed owner to avoid recursion.
CREATE OR REPLACE FUNCTION public.biz_confirm_marketing_people_send_v2(p_actor_id uuid,p_campaign_id uuid,p_client_request_id uuid,p_quote_snapshot jsonb,p_scheduled_for timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_campaign public.marketing_campaigns%ROWTYPE; v_audience public.marketing_audiences%ROWTYPE; v_live jsonb; v_result jsonb;
BEGIN
 SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_audience FROM public.marketing_audiences WHERE id=v_campaign.audience_id AND brand_id=v_campaign.brand_id FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'book_blast_audience_not_found' USING ERRCODE='P0002'; END IF;
 IF v_audience.query_definition='{"kind":"manual_group"}'::jsonb THEN
  v_live:=public.biz_marketing_book_quote_candidates(p_actor_id,p_campaign_id);
  IF v_audience.deleted_at IS NOT NULL OR p_quote_snapshot->>'audienceId' IS DISTINCT FROM v_audience.id::text
   OR p_quote_snapshot->>'audienceKind' IS DISTINCT FROM 'manual_group'
   OR (p_quote_snapshot->>'audienceVersion')::bigint IS DISTINCT FROM v_audience.membership_version
   OR p_quote_snapshot->>'audienceName' IS DISTINCT FROM v_audience.name THEN RAISE EXCEPTION 'manual_group_preview_stale' USING ERRCODE='23514'; END IF;
 END IF;
 v_result:=public.issue_2395_confirm_marketing_book_send_legacy(p_actor_id,p_campaign_id,p_client_request_id,p_quote_snapshot,p_scheduled_for);
 IF v_audience.query_definition='{"kind":"manual_group"}'::jsonb THEN UPDATE public.marketing_campaigns SET audience_name_snapshot=v_audience.name WHERE id=p_campaign_id; INSERT INTO public.marketing_manual_group_audit(brand_id,audience_id,actor_id,action,safe_metadata) VALUES(v_campaign.brand_id,v_audience.id,p_actor_id,'campaign_used',jsonb_build_object('campaignId',p_campaign_id,'membershipVersion',v_audience.membership_version)); END IF;
 RETURN v_result;
END $f$;
REVOKE ALL ON FUNCTION public.biz_confirm_marketing_book_send_v1(uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_confirm_marketing_book_send_v1(uuid,uuid,uuid,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_marketing_people_send_audience_v2(p_campaign_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT public.biz_marketing_book_send_audience(p_campaign_id)
$f$;
REVOKE ALL ON FUNCTION public.biz_marketing_people_send_audience_v2(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_people_send_audience_v2(uuid) TO service_role;

-- Confirmed Manual sends, like Your Book, are claimable only with a sealed execution.
CREATE OR REPLACE FUNCTION public.mkt_claim_campaigns(p_limit integer DEFAULT 10,p_campaign_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,account_id uuid,brand_id uuid,audience_id uuid,channel text,channel_payload jsonb,name text,scheduled_for timestamptz)
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
 RETURN QUERY UPDATE public.marketing_campaigns mc SET status='sending',updated_at=now() WHERE mc.id IN(
  SELECT c.id FROM public.marketing_campaigns c JOIN public.marketing_audiences a ON a.id=c.audience_id WHERE c.status='scheduled' AND c.scheduled_for<=now() AND (p_campaign_id IS NULL OR c.id=p_campaign_id)
   AND (a.query_definition->>'kind' NOT IN('all_brand_people','manual_group') OR EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=c.id)) ORDER BY c.scheduled_for LIMIT p_limit FOR UPDATE OF c SKIP LOCKED)
 RETURNING mc.id,mc.account_id,mc.brand_id,mc.audience_id,mc.channel,mc.channel_payload,mc.name,mc.scheduled_for;
END $f$;
REVOKE ALL ON FUNCTION public.mkt_claim_campaigns(integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_claim_campaigns(integer,uuid) TO service_role;

COMMENT ON TABLE public.marketing_manual_group_memberships IS '#2395 DRAFT invariant: Book-only canonical same-brand Manual membership.';
COMMENT ON FUNCTION public.biz_marketing_people_send_audience_v2(uuid) IS '#2395 DRAFT invariant: confirmed Manual send resolves immutable sealed targets only.';

COMMIT;
