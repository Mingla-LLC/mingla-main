-- Issue #1772, parent #876: authenticated Book identity maintenance and
-- verified, support-only erasure for brand-owned non-user contacts.
-- Forward-only. No production data is mutated by this migration.

BEGIN;

-- A manual merge may supersede a durable "different people" decision. The
-- older decision remains immutable history and is restored only by exact split.
ALTER TABLE public.brand_person_identity_separations
  ADD COLUMN superseded_at timestamptz NULL,
  -- Immutable actor snapshot: intentionally no auth.users foreign key.
  ADD COLUMN superseded_by uuid NULL,
  ADD COLUMN superseded_by_merge_event_id uuid NULL
    REFERENCES public.brand_person_merge_events(id) ON DELETE RESTRICT,
  ADD CONSTRAINT issue_1772_separation_supersession_shape CHECK (
    (superseded_at IS NULL AND superseded_by IS NULL AND superseded_by_merge_event_id IS NULL)
    OR
    (superseded_at IS NOT NULL AND superseded_by IS NOT NULL AND superseded_by_merge_event_id IS NOT NULL)
  );
DROP INDEX public.brand_person_separations_uniq;
CREATE UNIQUE INDEX brand_person_separations_uniq
  ON public.brand_person_identity_separations(brand_id, person_id, normalized_name)
  WHERE superseded_at IS NULL;

ALTER TABLE public.brand_offering_invites
  DROP CONSTRAINT brand_offering_invites_removal_reason_check;
ALTER TABLE public.brand_offering_invites
  ADD CONSTRAINT brand_offering_invites_removal_reason_check CHECK (
    removal_reason IS NULL OR removal_reason IN ('host_removed','identity_merge','privacy_erasure')
  );

CREATE TABLE public.brand_person_maintenance_operations (
  client_request_id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('manual_merge','split','promote_primary')),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  required_rank smallint NOT NULL CHECK (required_rank IN (20,50)),
  outcome text NOT NULL CHECK (outcome IN ('completed','unchanged','escalated')),
  result_json jsonb NOT NULL CHECK (jsonb_typeof(result_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.brand_person_erasure_keys (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE RESTRICT,
  key_material bytea NOT NULL CHECK (octet_length(key_material)=32),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.brand_person_erasure_challenges (
  id uuid PRIMARY KEY,
  client_request_id uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  case_reference text NOT NULL CHECK (case_reference ~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$'),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  contact_method_id uuid NOT NULL REFERENCES public.brand_person_contact_methods(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email','phone')),
  contact_fingerprint char(64) NOT NULL CHECK (contact_fingerprint ~ '^[0-9a-f]{64}$'),
  code_hash char(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  delivery_state text NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','dispatching','sent','failed')),
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  consumed_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_1772_challenge_consumption_shape CHECK (
    consumed_at IS NULL OR (delivery_state='sent' AND invalidated_at IS NULL)
  )
);
CREATE INDEX issue_1772_erasure_challenge_active_lookup
  ON public.brand_person_erasure_challenges(brand_id,person_id,contact_method_id,expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL
    AND delivery_state IN ('pending','dispatching','sent');

CREATE TABLE public.brand_person_erasure_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  challenge_id uuid NOT NULL UNIQUE REFERENCES public.brand_person_erasure_challenges(id) ON DELETE RESTRICT,
  case_reference text NOT NULL CHECK (case_reference ~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$'),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  reason_code text NOT NULL DEFAULT 'privacy_request' CHECK (reason_code='privacy_request'),
  state text NOT NULL CHECK (state IN ('db_erased','cleanup_retryable','completed')),
  count_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(count_summary)='object'),
  cleanup_paths jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cleanup_paths)='array'),
  safe_code text NULL CHECK (safe_code IS NULL OR safe_code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  db_erased_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.brand_person_erasure_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('email','phone')),
  address_fingerprint char(64) NOT NULL CHECK (address_fingerprint ~ '^[0-9a-f]{64}$'),
  erasure_operation_id uuid NOT NULL REFERENCES public.brand_person_erasure_operations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id,channel,address_fingerprint)
);

CREATE TABLE public.brand_person_erasure_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NULL REFERENCES public.brand_person_erasure_operations(id) ON DELETE RESTRICT,
  challenge_id uuid NULL REFERENCES public.brand_person_erasure_challenges(id) ON DELETE RESTRICT,
  case_reference text NOT NULL CHECK (case_reference ~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$'),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN (
    'challenge_created','challenge_dispatch_claimed','challenge_sent','challenge_failed','verification_rejected',
    'db_erased','cleanup_retryable','completed','refused'
  )),
  verification_channel text NULL CHECK (verification_channel IS NULL OR verification_channel IN ('email','phone')),
  contact_fingerprint char(64) NULL CHECK (contact_fingerprint IS NULL OR contact_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_code text NULL CHECK (reason_code IS NULL OR reason_code ~ '^[a-z0-9_]{1,80}$'),
  safe_code text NULL CHECK (safe_code IS NULL OR safe_code ~ '^[a-z0-9_]{1,80}$'),
  count_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(count_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_person_maintenance_operations','brand_person_erasure_keys',
    'brand_person_erasure_challenges','brand_person_erasure_operations',
    'brand_person_erasure_tombstones','brand_person_erasure_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',v_table);
  END LOOP;
  GRANT SELECT,INSERT ON public.brand_person_maintenance_operations TO service_role;
  GRANT SELECT,INSERT ON public.brand_person_erasure_keys TO service_role;
  GRANT SELECT,INSERT,UPDATE ON public.brand_person_erasure_challenges TO service_role;
  GRANT SELECT,INSERT,UPDATE ON public.brand_person_erasure_operations TO service_role;
  GRANT SELECT,INSERT ON public.brand_person_erasure_tombstones TO service_role;
  GRANT SELECT,INSERT ON public.brand_person_erasure_audit TO service_role;
END
$rls$;

CREATE OR REPLACE FUNCTION public.issue_1772_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'people_immutable_record' USING ERRCODE='42501';
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_reject_immutable_mutation() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER issue_1772_maintenance_operations_immutable
  BEFORE UPDATE OR DELETE ON public.brand_person_maintenance_operations
  FOR EACH ROW EXECUTE FUNCTION public.issue_1772_reject_immutable_mutation();
CREATE TRIGGER issue_1772_erasure_keys_immutable
  BEFORE UPDATE OR DELETE ON public.brand_person_erasure_keys
  FOR EACH ROW EXECUTE FUNCTION public.issue_1772_reject_immutable_mutation();
CREATE TRIGGER issue_1772_erasure_tombstones_immutable
  BEFORE UPDATE OR DELETE ON public.brand_person_erasure_tombstones
  FOR EACH ROW EXECUTE FUNCTION public.issue_1772_reject_immutable_mutation();
CREATE TRIGGER issue_1772_erasure_audit_immutable
  BEFORE UPDATE OR DELETE ON public.brand_person_erasure_audit
  FOR EACH ROW EXECUTE FUNCTION public.issue_1772_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION public.issue_1772_frame(p_value text)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
  SELECT CASE WHEN p_value IS NULL THEN decode('00','hex')
    ELSE decode('01','hex')||int4send(octet_length(convert_to(p_value,'UTF8')))||convert_to(p_value,'UTF8') END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_brand_person_version(p_person_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
  SELECT encode(extensions.digest(
    public.issue_1772_frame(p.id::text)||public.issue_1772_frame(p.brand_id::text)||
    public.issue_1772_frame(p.record_status)||public.issue_1772_frame(p.updated_at::text)||
    public.issue_1772_frame(p.linked_user_id::text)||
    public.issue_1772_frame(COALESCE((SELECT string_agg(format('%s:%s:%s:%s',n.id,n.active,n.name_kind,n.retired_at),',' ORDER BY n.id) FROM public.brand_person_names n WHERE n.brand_person_id=p.id),''))||
    public.issue_1772_frame(COALESCE((SELECT string_agg(format('%s:%s:%s:%s',c.id,c.channel,c.record_state,c.is_primary),',' ORDER BY c.id) FROM public.brand_person_contact_methods c WHERE c.brand_person_id=p.id),''))||
    public.issue_1772_frame(COALESCE((SELECT string_agg(format('%s:%s',l.id,l.detached_at),',' ORDER BY l.id) FROM public.brand_person_source_links l WHERE l.brand_person_id=p.id),''))||
    public.issue_1772_frame(COALESCE((SELECT string_agg(format('%s:%s',x.id,x.status),',' ORDER BY x.id) FROM public.brand_person_identity_conflicts x WHERE p.id=ANY(x.candidate_person_ids) AND x.status='open'),''))||
    public.issue_1772_frame(COALESCE((SELECT string_agg(format('%s:%s',m.id,m.status),',' ORDER BY m.id) FROM public.brand_person_merge_events m WHERE m.winner_person_id=p.id OR m.loser_person_id=p.id),'')),
    'sha256'),'hex')
  FROM public.brand_people p WHERE p.id=p_person_id
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_merge_event_version(p_merge_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
  SELECT encode(extensions.digest(
    public.issue_1772_frame(m.id::text)||public.issue_1772_frame(m.status)||
    public.issue_1772_frame(m.reversal_manifest::text)||
    public.issue_1772_frame(public.issue_1772_brand_person_version(m.winner_person_id))||
    public.issue_1772_frame(public.issue_1772_brand_person_version(m.loser_person_id)),
    'sha256'),'hex')
  FROM public.brand_person_merge_events m WHERE m.id=p_merge_event_id
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_erasure_fingerprint(p_brand_id uuid,p_channel text,p_value text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_key bytea;
BEGIN
  IF p_channel NOT IN ('email','phone') OR p_value IS NULL OR btrim(p_value)='' THEN RETURN NULL; END IF;
  SELECT key_material INTO v_key FROM public.brand_person_erasure_keys WHERE brand_id=p_brand_id;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  RETURN encode(extensions.hmac(
    public.issue_1772_frame('mingla:brand-person-erasure:v1')||
    public.issue_1772_frame(p_brand_id::text)||public.issue_1772_frame(p_channel)||
    public.issue_1772_frame(CASE WHEN p_channel='email' THEN public.issue_1770_normalize_email(p_value) ELSE public.issue_1770_normalize_phone(p_value) END),
    v_key,'sha256'),'hex');
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_erasure_tombstoned(p_brand_id uuid,p_channel text,p_value text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
  SELECT EXISTS(
    SELECT 1 FROM public.brand_person_erasure_tombstones t
    WHERE t.brand_id=p_brand_id AND t.channel=p_channel
      AND t.address_fingerprint=public.issue_1772_erasure_fingerprint(p_brand_id,p_channel,p_value)
  )
$f$;

-- Serialize canonical-address creation and erasure by the exact brand/channel/
-- normalized-address tuple. This private service helper prevents a contact from
-- racing into a brand while the same address is being erased.
CREATE OR REPLACE FUNCTION public.issue_1772_lock_brand_person_address(
  p_brand_id uuid,p_channel text,p_value text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_channel text:=lower(btrim(COALESCE(p_channel,''))); v_normalized text;
BEGIN
  IF p_brand_id IS NULL OR v_channel NOT IN ('email','phone') OR p_value IS NULL OR btrim(p_value)='' THEN
    RAISE EXCEPTION 'people_contact_invalid' USING ERRCODE='22023';
  END IF;
  v_normalized:=CASE WHEN v_channel='email'
    THEN public.issue_1770_normalize_email(p_value)
    ELSE public.issue_1770_normalize_phone(p_value) END;
  IF v_normalized IS NULL OR btrim(v_normalized)='' THEN
    RAISE EXCEPTION 'people_contact_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(encode(
    public.issue_1772_frame('mingla:brand-person-address-lock:v1')||
    public.issue_1772_frame(p_brand_id::text)||public.issue_1772_frame(v_channel)||
    public.issue_1772_frame(v_normalized),'hex'),1772));
  RETURN v_normalized;
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_assert_support_actor(p_actor_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id
     OR NOT public.is_support_staff(p_actor_id) THEN
    RAISE EXCEPTION 'people_support_forbidden' USING ERRCODE='42501';
  END IF;
END
$f$;

REVOKE ALL ON FUNCTION public.issue_1772_frame(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_brand_person_version(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_merge_event_version(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_erasure_fingerprint(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_erasure_tombstoned(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_lock_brand_person_address(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_1772_assert_support_actor(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1772_frame(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_brand_person_version(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_merge_event_version(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_erasure_fingerprint(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_erasure_tombstoned(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_lock_brand_person_address(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1772_assert_support_actor(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_1772_reject_tombstoned_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  IF NEW.record_state='active' THEN
    -- Person-first ordering is shared with erasure. A writer targeting a person
    -- being erased waits, then fails closed after the row becomes non-active.
    PERFORM 1 FROM public.brand_people p
      WHERE p.id=NEW.brand_person_id AND p.brand_id=NEW.brand_id
        AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
    NEW.normalized_value:=public.issue_1772_lock_brand_person_address(NEW.brand_id,NEW.channel,NEW.normalized_value);
    IF public.issue_1772_erasure_tombstoned(NEW.brand_id,NEW.channel,NEW.normalized_value) THEN
      RAISE EXCEPTION 'people_erased_contact_suppressed' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_reject_tombstoned_contact() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_reject_tombstoned_contact() TO service_role;
CREATE TRIGGER issue_1772_contact_tombstone_guard
  BEFORE INSERT OR UPDATE OF brand_id,channel,normalized_value,record_state
  ON public.brand_person_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.issue_1772_reject_tombstoned_contact();

CREATE OR REPLACE FUNCTION public.issue_1772_require_brand_rank(p_brand_id uuid,p_rank integer)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL
     OR COALESCE(public.biz_brand_effective_rank(p_brand_id,v_actor),-1)<p_rank THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN v_actor;
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_require_brand_rank(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_require_brand_rank(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1772_person_summary(p_person_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
  SELECT jsonb_build_object(
    'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,
    'updatedAt',p.updated_at,'linked',p.linked_user_id IS NOT NULL,
    'identityVersion',public.issue_1772_brand_person_version(p.id),
    'alternateNames',COALESCE((
      SELECT jsonb_agg(n.display_name ORDER BY n.created_at,n.id)
      FROM public.brand_person_names n
      WHERE n.brand_person_id=p.id AND n.active
        AND n.normalized_name<>lower(regexp_replace(btrim(p.display_name),'[[:space:]]+',' ','g'))
    ),'[]'::jsonb),
    'contacts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary
      ) ORDER BY c.channel,c.is_primary DESC,c.created_at,c.id)
      FROM public.brand_person_contact_methods c
      WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
    ),'[]'::jsonb)
  ) FROM public.brand_people p WHERE p.id=p_person_id
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_person_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_person_summary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_get_brand_person(p_brand_id uuid,p_person_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid; v_rank integer; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,20);
  v_rank:=public.biz_brand_effective_rank(p_brand_id,v_actor);
  SELECT public.issue_1772_person_summary(p.id)||jsonb_build_object(
    'suppressions',COALESCE((SELECT jsonb_agg(jsonb_build_object('channel',s.channel,'scope',s.scope) ORDER BY s.channel,s.scope)
      FROM public.brand_person_channel_suppressions s WHERE s.brand_person_id=p.id AND s.lifted_at IS NULL),'[]'::jsonb),
    'capabilities',jsonb_build_object(
      'canMerge',v_rank>=50,'canPromotePrimary',v_rank>=20,
      'canViewMergeHistory',v_rank>=20,
      'canSplit',v_rank>=50 AND EXISTS(SELECT 1 FROM public.brand_person_merge_events m WHERE m.status='active' AND (m.winner_person_id=p.id OR m.loser_person_id=p.id))
    )
  ) INTO v_result
  FROM public.brand_people p
  WHERE p.id=p_person_id AND p.brand_id=p_brand_id AND p.record_status='active'
    AND public.biz_brand_person_canonical(p.id)=p.id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  RETURN v_result;
END
$f$;
REVOKE ALL ON FUNCTION public.biz_get_brand_person(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_brand_person(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_list_brand_person_merge_candidates(
  p_brand_id uuid,p_person_id uuid,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_rows jsonb; v_search text;
BEGIN
  PERFORM public.issue_1772_require_brand_rank(p_brand_id,50);
  IF p_limit<1 OR p_limit>50 OR char_length(COALESCE(p_search,''))>120 THEN
    RAISE EXCEPTION 'people_query_invalid' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_people WHERE id=p_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id) THEN
    RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002';
  END IF;
  v_search:=replace(replace(replace(lower(btrim(COALESCE(p_search,''))),'\','\\'),'%','\%'),'_','\_');
  SELECT COALESCE(jsonb_agg(summary ORDER BY updated_at DESC,id DESC),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT p.id,p.updated_at,public.issue_1772_person_summary(p.id)||jsonb_build_object(
      'matchedContact',CASE WHEN v_search<>'' THEN (
        SELECT jsonb_build_object('id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary)
        FROM public.brand_person_contact_methods c
        WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
          AND lower(c.normalized_value) ILIKE '%'||v_search||'%' ESCAPE '\'
        ORDER BY c.is_primary DESC,c.channel,c.id LIMIT 1
      ) ELSE NULL END
    ) summary
    FROM public.brand_people p
    WHERE p.brand_id=p_brand_id AND p.record_status='active' AND p.id<>p_person_id
      AND public.biz_brand_person_canonical(p.id)=p.id
      AND (v_search='' OR lower(p.display_name) ILIKE '%'||v_search||'%' ESCAPE '\'
        OR EXISTS(SELECT 1 FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
            AND lower(c.normalized_value) ILIKE '%'||v_search||'%' ESCAPE '\'))
      AND (p_cursor IS NULL OR (p.updated_at,p.id)<((p_cursor->>'updatedAt')::timestamptz,(p_cursor->>'personId')::uuid))
    ORDER BY p.updated_at DESC,p.id DESC LIMIT p_limit
  ) page;
  RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit
    THEN jsonb_build_object('updatedAt',v_rows->-1->>'updatedAt','personId',v_rows->-1->>'personId') ELSE NULL END);
END
$f$;
REVOKE ALL ON FUNCTION public.biz_list_brand_person_merge_candidates(uuid,uuid,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_list_brand_person_merge_candidates(uuid,uuid,text,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_preview_brand_person_merge(
  p_brand_id uuid,p_left_person_id uuid,p_right_person_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_left public.brand_people%ROWTYPE; v_right public.brand_people%ROWTYPE; v_state text:='ready';
BEGIN
  PERFORM public.issue_1772_require_brand_rank(p_brand_id,50);
  IF p_left_person_id=p_right_person_id THEN RAISE EXCEPTION 'people_merge_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_left FROM public.brand_people WHERE id=p_left_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id;
  SELECT * INTO v_right FROM public.brand_people WHERE id=p_right_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id;
  IF v_left.id IS NULL OR v_right.id IS NULL THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts c WHERE c.brand_id=p_brand_id AND c.status='open' AND (p_left_person_id=ANY(c.candidate_person_ids) OR p_right_person_id=ANY(c.candidate_person_ids))) THEN
    v_state:='open_conflict';
  ELSIF v_left.linked_user_id IS NOT NULL AND v_right.linked_user_id IS NOT NULL AND v_left.linked_user_id<>v_right.linked_user_id THEN
    v_state:='distinct_linked_users';
  END IF;
  RETURN jsonb_build_object(
    'state',v_state,'left',public.issue_1772_person_summary(v_left.id),
    'right',public.issue_1772_person_summary(v_right.id),
    'leftVersion',public.issue_1772_brand_person_version(v_left.id),
    'rightVersion',public.issue_1772_brand_person_version(v_right.id),
    'hadOpenConflict',v_state='open_conflict',
    'hadPriorSeparation',EXISTS(SELECT 1 FROM public.brand_person_identity_separations s
      WHERE s.brand_id=p_brand_id AND s.superseded_at IS NULL AND s.separated_person_id IS NOT NULL
        AND ((s.person_id=v_left.id AND s.separated_person_id=v_right.id)
          OR (s.person_id=v_right.id AND s.separated_person_id=v_left.id)))
  );
END
$f$;
REVOKE ALL ON FUNCTION public.biz_preview_brand_person_merge(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_preview_brand_person_merge(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_1772_maintenance_replay(
  p_request uuid,p_brand uuid,p_actor uuid,p_operation text,p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.brand_person_maintenance_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.brand_person_maintenance_operations WHERE client_request_id=p_request;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.brand_id IS DISTINCT FROM p_brand OR v_row.actor_id IS DISTINCT FROM p_actor
     OR v_row.operation IS DISTINCT FROM p_operation OR v_row.request_hash IS DISTINCT FROM p_hash THEN
    RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505';
  END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand,p_actor),-1)<v_row.required_rank THEN
    RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN v_row.result_json||jsonb_build_object('replayed',true);
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_maintenance_replay(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_maintenance_replay(uuid,uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_merge_brand_people_manual(
  p_brand_id uuid,p_winner_person_id uuid,p_loser_person_id uuid,
  p_winner_version text,p_loser_version text,p_client_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid; v_hash text; v_replay jsonb; v_preview jsonb; v_merge uuid; v_sep_ids uuid[]; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,50);
  IF p_client_request_id IS NULL OR p_winner_person_id=p_loser_person_id THEN RAISE EXCEPTION 'people_merge_invalid' USING ERRCODE='22023'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('winner',p_winner_person_id,'loser',p_loser_person_id,'winnerVersion',p_winner_version,'loserVersion',p_loser_version)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  v_replay:=public.issue_1772_maintenance_replay(p_client_request_id,p_brand_id,v_actor,'manual_merge',v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.brand_people WHERE id IN (p_winner_person_id,p_loser_person_id) ORDER BY id FOR UPDATE;
  IF public.issue_1772_brand_person_version(p_winner_person_id) IS DISTINCT FROM p_winner_version
     OR public.issue_1772_brand_person_version(p_loser_person_id) IS DISTINCT FROM p_loser_version THEN
    RAISE EXCEPTION 'people_identity_stale' USING ERRCODE='40001';
  END IF;
  v_preview:=public.biz_preview_brand_person_merge(p_brand_id,p_winner_person_id,p_loser_person_id);
  IF v_preview->>'state'='open_conflict' THEN RAISE EXCEPTION 'people_merge_open_conflict' USING ERRCODE='23514'; END IF;
  IF v_preview->>'state'='distinct_linked_users' THEN RAISE EXCEPTION 'people_merge_distinct_linked_users' USING ERRCODE='23514'; END IF;
  SELECT array_agg(s.id ORDER BY s.id) INTO v_sep_ids FROM public.brand_person_identity_separations s
  WHERE s.brand_id=p_brand_id AND s.superseded_at IS NULL AND s.separated_person_id IS NOT NULL
    AND ((s.person_id=p_winner_person_id AND s.separated_person_id=p_loser_person_id)
      OR (s.person_id=p_loser_person_id AND s.separated_person_id=p_winner_person_id));
  v_merge:=public.biz_merge_brand_people(p_winner_person_id,p_loser_person_id,'manual_resolution',NULL,v_actor);
  UPDATE public.brand_person_identity_separations SET superseded_at=now(),superseded_by=v_actor,superseded_by_merge_event_id=v_merge
    WHERE id=ANY(COALESCE(v_sep_ids,'{}'));
  UPDATE public.brand_person_merge_events SET reversal_manifest=reversal_manifest||jsonb_build_object('supersededSeparationIds',to_jsonb(COALESCE(v_sep_ids,'{}'::uuid[]))) WHERE id=v_merge;
  v_result:=jsonb_build_object('operationId',p_client_request_id,'mergeEventId',v_merge,
    'survivorPersonId',p_winner_person_id,'absorbedPersonId',p_loser_person_id,
    'identityVersion',public.issue_1772_brand_person_version(p_winner_person_id),'replayed',false);
  INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'manual_merge',v_hash,50,'completed',v_result,now());
  RETURN v_result;
END
$f$;
REVOKE ALL ON FUNCTION public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_promote_brand_person_contact(
  p_brand_id uuid,p_person_id uuid,p_contact_method_id uuid,p_person_version text,p_client_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid; v_hash text; v_replay jsonb; v_contact public.brand_person_contact_methods%ROWTYPE; v_outcome text; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,20);
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('person',p_person_id,'contact',p_contact_method_id,'version',p_person_version)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  v_replay:=public.issue_1772_maintenance_replay(p_client_request_id,p_brand_id,v_actor,'promote_primary',v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM 1 FROM public.brand_people WHERE id=p_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  IF public.issue_1772_brand_person_version(p_person_id) IS DISTINCT FROM p_person_version THEN RAISE EXCEPTION 'people_identity_stale' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_contact FROM public.brand_person_contact_methods
    WHERE id=p_contact_method_id AND brand_id=p_brand_id AND brand_person_id=p_person_id
      AND record_state='active' AND provenance_scope='brand_owned' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_contact_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.brand_person_contact_methods WHERE brand_person_id=p_person_id AND channel=v_contact.channel AND record_state='active' ORDER BY id FOR UPDATE;
  IF v_contact.is_primary THEN v_outcome:='unchanged';
  ELSE
    UPDATE public.brand_person_contact_methods SET is_primary=false,updated_at=now() WHERE brand_person_id=p_person_id AND channel=v_contact.channel AND record_state='active' AND is_primary;
    UPDATE public.brand_person_contact_methods SET is_primary=true,updated_at=now() WHERE id=v_contact.id;
    UPDATE public.brand_people SET updated_at=now() WHERE id=p_person_id;
    v_outcome:='completed';
  END IF;
  v_result:=jsonb_build_object('operationId',p_client_request_id,'outcome',v_outcome,'personId',p_person_id,
    'contactMethodId',p_contact_method_id,'channel',v_contact.channel,
    'identityVersion',public.issue_1772_brand_person_version(p_person_id),'replayed',false);
  INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'promote_primary',v_hash,20,v_outcome,v_result,now());
  RETURN v_result;
END
$f$;
REVOKE ALL ON FUNCTION public.biz_promote_brand_person_contact(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_promote_brand_person_contact(uuid,uuid,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_list_brand_person_merge_history(
  p_brand_id uuid,p_person_id uuid,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid; v_rank integer; v_rows jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,20);
  v_rank:=public.biz_brand_effective_rank(p_brand_id,v_actor);
  IF p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'people_query_invalid' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_people WHERE id=p_person_id AND brand_id=p_brand_id) THEN RAISE EXCEPTION 'people_not_found' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(jsonb_agg(row_json ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_rows FROM (
    SELECT m.id,m.created_at,jsonb_build_object(
      'mergeEventId',m.id,'status',m.status,'createdAt',m.created_at,'reversedAt',m.reversed_at,
      'survivorPersonId',m.winner_person_id,
      'survivorLabel',CASE WHEN winner.record_status='deleted' THEN 'an erased contact' ELSE winner.display_name END,
      'counterpartPersonId',CASE WHEN p_person_id=m.winner_person_id THEN m.loser_person_id ELSE m.winner_person_id END,
      'counterpartLabel',CASE WHEN counterpart.record_status='deleted' THEN 'an erased contact' ELSE counterpart.display_name END,
      'canSplit',v_rank>=50 AND m.status='active',
      'eventVersion',public.issue_1772_merge_event_version(m.id)
    ) row_json
    FROM public.brand_person_merge_events m
    JOIN public.brand_people winner ON winner.id=m.winner_person_id
    JOIN public.brand_people counterpart ON counterpart.id=CASE WHEN p_person_id=m.winner_person_id THEN m.loser_person_id ELSE m.winner_person_id END
    WHERE m.brand_id=p_brand_id AND (m.winner_person_id=p_person_id OR m.loser_person_id=p_person_id)
      AND (p_cursor IS NULL OR (m.created_at,m.id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'mergeEventId')::uuid))
    ORDER BY m.created_at DESC,m.id DESC LIMIT p_limit
  ) page;
  RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit
    THEN jsonb_build_object('createdAt',v_rows->-1->>'createdAt','mergeEventId',v_rows->-1->>'mergeEventId') ELSE NULL END);
END
$f$;
REVOKE ALL ON FUNCTION public.biz_list_brand_person_merge_history(uuid,uuid,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_list_brand_person_merge_history(uuid,uuid,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_1772_split_preflight(p_brand_id uuid,p_merge_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_event public.brand_person_merge_events%ROWTYPE; v_version text; v_reference text; v_safe boolean:=true; v_item jsonb; v_sep uuid;
BEGIN
  SELECT * INTO v_event FROM public.brand_person_merge_events WHERE id=p_merge_event_id AND brand_id=p_brand_id;
  v_version:=public.issue_1772_merge_event_version(p_merge_event_id);
  v_reference:='BP-'||upper(substr(encode(extensions.digest(convert_to(COALESCE(p_brand_id::text,'')||':'||COALESCE(p_merge_event_id::text,'')||':'||COALESCE(v_version,''),'UTF8'),'sha256'),'hex'),1,12));
  IF v_event.id IS NULL OR v_event.status<>'active'
     OR NOT EXISTS(SELECT 1 FROM public.brand_people p WHERE p.id=v_event.winner_person_id AND p.brand_id=p_brand_id AND p.record_status='active' AND public.biz_brand_person_canonical(p.id)=p.id)
     OR NOT EXISTS(SELECT 1 FROM public.brand_people p WHERE p.id=v_event.loser_person_id AND p.brand_id=p_brand_id AND p.record_status='merged' AND p.merged_into_person_id=v_event.winner_person_id)
     OR EXISTS(SELECT 1 FROM public.brand_person_merge_events m WHERE m.id<>p_merge_event_id AND m.status='active'
       AND (m.winner_person_id IN (v_event.winner_person_id,v_event.loser_person_id) OR m.loser_person_id IN (v_event.winner_person_id,v_event.loser_person_id)))
     OR jsonb_typeof(v_event.reversal_manifest->'sourceLinkIds')<>'array'
     OR jsonb_typeof(v_event.reversal_manifest->'contactMethodIds')<>'array'
     OR jsonb_typeof(v_event.reversal_manifest->'nameIds')<>'array'
     OR jsonb_typeof(v_event.reversal_manifest->'winnerContactKeys')<>'array'
     OR jsonb_typeof(v_event.reversal_manifest->'winnerNameKeys')<>'array'
     OR jsonb_typeof(v_event.reversal_manifest->'inviteStates')<>'array'
     OR jsonb_typeof(COALESCE(v_event.reversal_manifest->'manualGroupMemberships','[]'::jsonb))<>'array'
     OR jsonb_typeof(COALESCE(v_event.reversal_manifest->'supersededSeparationIds','[]'::jsonb))<>'array' THEN
    v_safe:=false;
  END IF;
  IF v_safe AND EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(v_event.reversal_manifest->'sourceLinkIds') x
    LEFT JOIN public.brand_person_source_links old_link ON old_link.id=x.value::uuid
    WHERE old_link.id IS NULL OR old_link.brand_person_id<>v_event.loser_person_id OR old_link.detached_at IS NULL
      OR NOT EXISTS(SELECT 1 FROM public.brand_person_source_links live
        WHERE live.source_kind=old_link.source_kind AND live.source_id=old_link.source_id
          AND live.brand_person_id=v_event.winner_person_id AND live.detached_at IS NULL)
  ) THEN v_safe:=false; END IF;
  IF v_safe AND EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(v_event.reversal_manifest->'contactMethodIds') x
    LEFT JOIN public.brand_person_contact_methods old_contact ON old_contact.id=x.value::uuid
    WHERE old_contact.id IS NULL OR old_contact.brand_person_id<>v_event.loser_person_id OR old_contact.record_state<>'retired'
      OR NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods live
        WHERE live.brand_person_id=v_event.winner_person_id AND live.channel=old_contact.channel
          AND live.normalized_value=old_contact.normalized_value AND live.record_state='active')
  ) THEN v_safe:=false; END IF;
  IF v_safe AND EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(v_event.reversal_manifest->'nameIds') x
    LEFT JOIN public.brand_person_names old_name ON old_name.id=x.value::uuid
    WHERE old_name.id IS NULL OR old_name.brand_person_id<>v_event.loser_person_id OR old_name.active
      OR NOT EXISTS(SELECT 1 FROM public.brand_person_names live
        WHERE live.brand_person_id=v_event.winner_person_id AND live.normalized_name=old_name.normalized_name AND live.active)
  ) THEN v_safe:=false; END IF;
  IF v_safe AND EXISTS(
    SELECT 1 FROM public.brand_people loser
    WHERE loser.id=v_event.loser_person_id AND loser.linked_user_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.brand_people other WHERE other.brand_id=p_brand_id AND other.id<>loser.id
        AND other.record_status='active' AND other.linked_user_id=loser.linked_user_id)
  ) THEN v_safe:=false; END IF;
  IF v_safe THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_event.reversal_manifest->'manualGroupMemberships','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.marketing_audiences a WHERE a.id=(v_item->>'audienceId')::uuid AND a.deleted_at IS NULL)
         OR NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships mm
           WHERE mm.id=(v_item->>'loserMembershipId')::uuid AND mm.state='merged' AND mm.merge_event_id=p_merge_event_id)
         OR (COALESCE((v_item->>'winnerPreexisting')::boolean,false)
           AND NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships mm
             WHERE mm.audience_id=(v_item->>'audienceId')::uuid AND mm.brand_person_id=v_event.winner_person_id AND mm.state='active'))
         OR (NULLIF(v_item->>'winnerMembershipId','') IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM public.marketing_manual_group_memberships mm
             WHERE mm.id=(v_item->>'winnerMembershipId')::uuid AND mm.state='active'
               AND mm.source='merge_projection' AND mm.merge_event_id=p_merge_event_id)) THEN
        v_safe:=false; EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_safe THEN
    FOR v_sep IN SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_event.reversal_manifest->'supersededSeparationIds','[]'::jsonb)) LOOP
      IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations s WHERE s.id=v_sep AND s.superseded_by_merge_event_id=p_merge_event_id AND s.superseded_at IS NOT NULL)
         OR EXISTS(SELECT 1 FROM public.brand_person_identity_separations old_s JOIN public.brand_person_identity_separations active_s
           ON active_s.brand_id=old_s.brand_id AND active_s.person_id=old_s.person_id AND active_s.normalized_name=old_s.normalized_name
           WHERE old_s.id=v_sep AND active_s.id<>old_s.id AND active_s.superseded_at IS NULL) THEN
        v_safe:=false; EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_safe THEN
    RETURN jsonb_build_object('state','safe','mergeEventId',p_merge_event_id,'splitVersion',v_version,
      'left',(SELECT jsonb_build_object(
        'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'updatedAt',p.updated_at,
        'linked',p.linked_user_id IS NOT NULL,'identityVersion',public.issue_1772_brand_person_version(p.id),
        'alternateNames',COALESCE((SELECT jsonb_agg(n.display_name ORDER BY n.created_at,n.id)
          FROM public.brand_person_names n
          WHERE n.brand_person_id=p.id AND n.active
            AND n.normalized_name<>lower(regexp_replace(btrim(p.display_name),'[[:space:]]+',' ','g'))
            AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_event.reversal_manifest->'winnerNameKeys') k(value)
              WHERE k.value=n.normalized_name)),'[]'::jsonb),
        'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary
        ) ORDER BY c.channel,c.is_primary DESC,c.created_at,c.id)
          FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id=p.id AND c.record_state='active' AND c.provenance_scope='brand_owned'
            AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_event.reversal_manifest->'winnerContactKeys') k(value)
              WHERE k.value->>'channel'=c.channel AND k.value->>'value'=c.normalized_value)),'[]'::jsonb)
      ) FROM public.brand_people p WHERE p.id=v_event.winner_person_id),
      'right',(SELECT jsonb_build_object(
        'personId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'updatedAt',p.updated_at,
        'linked',p.linked_user_id IS NOT NULL,'identityVersion',public.issue_1772_brand_person_version(p.id),
        'alternateNames',COALESCE((SELECT jsonb_agg(n.display_name ORDER BY n.created_at,n.id)
          FROM public.brand_person_names n
          WHERE n.brand_person_id=p.id
            AND n.id IN(SELECT value::uuid FROM jsonb_array_elements_text(v_event.reversal_manifest->'nameIds'))
            AND n.normalized_name<>lower(regexp_replace(btrim(p.display_name),'[[:space:]]+',' ','g'))),'[]'::jsonb),
        'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',c.id,'channel',c.channel,'value',c.normalized_value,'isPrimary',c.is_primary
        ) ORDER BY c.channel,c.is_primary DESC,c.created_at,c.id)
          FROM public.brand_person_contact_methods c
          WHERE c.brand_person_id=p.id AND c.provenance_scope='brand_owned'
            AND c.id IN(SELECT value::uuid FROM jsonb_array_elements_text(v_event.reversal_manifest->'contactMethodIds'))),'[]'::jsonb)
      ) FROM public.brand_people p WHERE p.id=v_event.loser_person_id));
  END IF;
  RETURN jsonb_build_object('state','unsafe','supportReference',v_reference);
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_split_preflight(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_split_preflight(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_preview_brand_person_split(p_brand_id uuid,p_merge_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  PERFORM public.issue_1772_require_brand_rank(p_brand_id,50);
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_merge_events WHERE id=p_merge_event_id AND brand_id=p_brand_id) THEN RAISE EXCEPTION 'people_merge_not_found' USING ERRCODE='P0002'; END IF;
  RETURN public.issue_1772_split_preflight(p_brand_id,p_merge_event_id);
END
$f$;
REVOKE ALL ON FUNCTION public.biz_preview_brand_person_split(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_preview_brand_person_split(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_reverse_brand_person_merge_manual(
  p_brand_id uuid,p_merge_event_id uuid,p_split_version text,p_client_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid; v_hash text; v_replay jsonb; v_preview jsonb; v_event public.brand_person_merge_events%ROWTYPE; v_raw jsonb; v_result jsonb;
BEGIN
  v_actor:=public.issue_1772_require_brand_rank(p_brand_id,50);
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('mergeEvent',p_merge_event_id,'splitVersion',p_split_version)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  v_replay:=public.issue_1772_maintenance_replay(p_client_request_id,p_brand_id,v_actor,'split',v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_event FROM public.brand_person_merge_events WHERE id=p_merge_event_id AND brand_id=p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_merge_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.brand_people WHERE id IN(v_event.winner_person_id,v_event.loser_person_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.brand_offering_invites WHERE brand_person_id IN(v_event.winner_person_id,v_event.loser_person_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.marketing_manual_group_memberships WHERE brand_person_id IN(v_event.winner_person_id,v_event.loser_person_id) ORDER BY id FOR UPDATE;
  v_preview:=public.issue_1772_split_preflight(p_brand_id,p_merge_event_id);
  IF p_split_version IS DISTINCT FROM public.issue_1772_merge_event_version(p_merge_event_id) OR v_preview->>'state'<>'safe' THEN
    v_result:=jsonb_build_object('operationId',p_client_request_id,'outcome','escalated',
      'supportReference',COALESCE(v_preview->>'supportReference','BP-'||upper(substr(v_hash,1,12))),'replayed',false);
    INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'split',v_hash,50,'escalated',v_result,now());
    RETURN v_result;
  END IF;
  v_raw:=public.biz_reverse_brand_person_merge(p_merge_event_id,v_actor);
  IF v_raw->>'status'<>'reversed' THEN
    v_result:=jsonb_build_object('operationId',p_client_request_id,'outcome','escalated','supportReference','BP-'||upper(substr(v_hash,1,12)),'replayed',false);
    INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'split',v_hash,50,'escalated',v_result,now());
    RETURN v_result;
  END IF;
  UPDATE public.brand_person_identity_separations SET superseded_at=NULL,superseded_by=NULL,superseded_by_merge_event_id=NULL
    WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_event.reversal_manifest->'supersededSeparationIds','[]'::jsonb)))
      AND superseded_by_merge_event_id=p_merge_event_id;
  v_result:=jsonb_build_object('operationId',p_client_request_id,'outcome','reversed','restoredPersonId',v_event.loser_person_id,'replayed',false);
  INSERT INTO public.brand_person_maintenance_operations VALUES(p_client_request_id,p_brand_id,v_actor,'split',v_hash,50,'completed',v_result,now());
  RETURN v_result;
END
$f$;
REVOKE ALL ON FUNCTION public.biz_reverse_brand_person_merge_manual(uuid,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_reverse_brand_person_merge_manual(uuid,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.biz_get_brand_person_maintenance_operation(p_brand_id uuid,p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_actor uuid:=auth.uid(); v_row public.brand_person_maintenance_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.brand_person_maintenance_operations WHERE client_request_id=p_client_request_id AND brand_id=p_brand_id;
  IF NOT FOUND OR v_actor IS NULL OR v_row.actor_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'people_operation_not_found' USING ERRCODE='P0002'; END IF;
  IF COALESCE(public.biz_brand_effective_rank(p_brand_id,v_actor),-1)<v_row.required_rank THEN RAISE EXCEPTION 'people_forbidden' USING ERRCODE='42501'; END IF;
  RETURN v_row.result_json||jsonb_build_object('replayed',true);
END
$f$;
REVOKE ALL ON FUNCTION public.biz_get_brand_person_maintenance_operation(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_brand_person_maintenance_operation(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_1772_require_support_service(p_actor_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  IF p_actor_id IS NULL OR NOT public.is_support_staff(p_actor_id) THEN
    RAISE EXCEPTION 'people_support_forbidden' USING ERRCODE='42501';
  END IF;
END
$f$;
REVOKE ALL ON FUNCTION public.issue_1772_require_support_service(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1772_require_support_service(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1772_create_brand_person_erasure_challenge(
  p_challenge_id uuid,p_client_request_id uuid,p_case_reference text,p_brand_id uuid,
  p_person_id uuid,p_contact_method_id uuid,p_code_hash text,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_hash text; v_existing public.brand_person_erasure_challenges%ROWTYPE; v_active public.brand_person_erasure_challenges%ROWTYPE;
  v_person public.brand_people%ROWTYPE; v_contact public.brand_person_contact_methods%ROWTYPE; v_fingerprint text;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  IF p_challenge_id IS NULL OR p_client_request_id IS NULL
     OR p_case_reference !~ '^[A-Z0-9][A-Z0-9._/-]{2,79}$'
     OR p_code_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'people_erasure_input_invalid' USING ERRCODE='22023'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('caseReference',p_case_reference,
    'brand',p_brand_id,'person',p_person_id,'contact',p_contact_method_id)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  SELECT * INTO v_existing FROM public.brand_person_erasure_challenges WHERE client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash OR v_existing.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('challengeId',v_existing.id,'deliveryState',v_existing.delivery_state,
      'existing',true,'shouldDispatch',false);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    encode(public.issue_1772_frame(p_brand_id::text)||public.issue_1772_frame(p_person_id::text)||public.issue_1772_frame(p_contact_method_id::text),'hex'),1772));
  UPDATE public.brand_person_erasure_challenges SET invalidated_at=now(),updated_at=now()
    WHERE brand_id=p_brand_id AND person_id=p_person_id AND contact_method_id=p_contact_method_id
      AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at<=now()
      AND delivery_state IN('pending','dispatching','sent');
  SELECT * INTO v_active FROM public.brand_person_erasure_challenges
    WHERE brand_id=p_brand_id AND person_id=p_person_id AND contact_method_id=p_contact_method_id
      AND consumed_at IS NULL AND invalidated_at IS NULL AND expires_at>now()
      AND delivery_state IN('pending','dispatching','sent')
    ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('challengeId',v_active.id,'deliveryState',v_active.delivery_state,
      'existing',true,'shouldDispatch',false);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_person_id::text,1772));
  SELECT * INTO v_person FROM public.brand_people
    WHERE id=p_person_id AND brand_id=p_brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id FOR UPDATE;
  IF NOT FOUND OR v_person.linked_user_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts c WHERE c.brand_id=p_brand_id AND c.status='open' AND p_person_id=ANY(c.candidate_person_ids))
     OR EXISTS(SELECT 1 FROM public.brand_person_merge_events m WHERE m.brand_id=p_brand_id AND m.status='active' AND (m.winner_person_id=p_person_id OR m.loser_person_id=p_person_id)) THEN
    INSERT INTO public.brand_person_erasure_audit(case_reference,brand_id,person_id,actor_id,event,reason_code)
      VALUES(p_case_reference,p_brand_id,p_person_id,p_actor_id,'refused','identity_not_unambiguous');
    RETURN jsonb_build_object('state','refused','safeCode','identity_not_unambiguous','existing',false,'shouldDispatch',false);
  END IF;
  SELECT * INTO v_contact FROM public.brand_person_contact_methods
    WHERE id=p_contact_method_id AND brand_id=p_brand_id AND brand_person_id=p_person_id
      AND record_state='active' AND provenance_scope='brand_owned' AND channel IN('email','phone') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_erasure_contact_invalid' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.brand_person_erasure_keys(brand_id,key_material) VALUES(p_brand_id,extensions.gen_random_bytes(32)) ON CONFLICT(brand_id) DO NOTHING;
  v_fingerprint:=public.issue_1772_erasure_fingerprint(p_brand_id,v_contact.channel,v_contact.normalized_value);
  INSERT INTO public.brand_person_erasure_challenges(
    id,client_request_id,request_hash,case_reference,brand_id,person_id,contact_method_id,channel,
    contact_fingerprint,code_hash,expires_at,created_by
  ) VALUES(p_challenge_id,p_client_request_id,v_hash,p_case_reference,p_brand_id,p_person_id,p_contact_method_id,
    v_contact.channel,v_fingerprint,p_code_hash,now()+interval '15 minutes',p_actor_id);
  INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,verification_channel,contact_fingerprint)
    VALUES(p_challenge_id,p_case_reference,p_brand_id,p_person_id,p_actor_id,'challenge_created',v_contact.channel,v_fingerprint);
  RETURN jsonb_build_object('challengeId',p_challenge_id,'channel',v_contact.channel,
    'destination',v_contact.normalized_value,'deliveryState','pending','existing',false,'shouldDispatch',true);
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_claim_erasure_challenge_delivery(
  p_challenge_id uuid,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.brand_person_erasure_challenges%ROWTYPE;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  SELECT * INTO v_row FROM public.brand_person_erasure_challenges WHERE id=p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_row.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_erasure_challenge_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.consumed_at IS NOT NULL OR v_row.invalidated_at IS NOT NULL THEN
    RETURN jsonb_build_object('challengeId',v_row.id,'claimed',false,'deliveryState',v_row.delivery_state);
  END IF;
  IF v_row.expires_at<=now() THEN
    UPDATE public.brand_person_erasure_challenges SET invalidated_at=now(),updated_at=now() WHERE id=v_row.id;
    RETURN jsonb_build_object('challengeId',v_row.id,'claimed',false,'deliveryState',v_row.delivery_state);
  END IF;
  IF v_row.delivery_state<>'pending' THEN
    RETURN jsonb_build_object('challengeId',v_row.id,'claimed',false,'deliveryState',v_row.delivery_state);
  END IF;
  UPDATE public.brand_person_erasure_challenges SET delivery_state='dispatching',updated_at=now() WHERE id=v_row.id;
  INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,verification_channel,contact_fingerprint)
    VALUES(v_row.id,v_row.case_reference,v_row.brand_id,v_row.person_id,p_actor_id,'challenge_dispatch_claimed',v_row.channel,v_row.contact_fingerprint);
  RETURN jsonb_build_object('challengeId',v_row.id,'claimed',true,'deliveryState','dispatching');
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_finish_erasure_challenge_delivery(
  p_challenge_id uuid,p_actor_id uuid,p_state text,p_safe_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.brand_person_erasure_challenges%ROWTYPE;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  IF p_state NOT IN('sent','failed') OR (p_safe_code IS NOT NULL AND p_safe_code !~ '^[a-z0-9_]{1,80}$') THEN RAISE EXCEPTION 'people_erasure_input_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.brand_person_erasure_challenges WHERE id=p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_row.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_erasure_challenge_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.delivery_state=p_state THEN RETURN jsonb_build_object('challengeId',v_row.id,'deliveryState',v_row.delivery_state,'replayed',true); END IF;
  IF v_row.delivery_state='pending' AND p_state='failed' THEN
    IF p_safe_code NOT IN('no_contact','invalid_recipient','country_unresolved','provider_kill_switch_off','ng_operator_embargo','provider_config_missing','provider_protocol_error','pre_dispatch_failed') THEN
      RAISE EXCEPTION 'people_erasure_delivery_transition_invalid' USING ERRCODE='23514';
    END IF;
  ELSIF v_row.delivery_state='dispatching' AND p_state='sent' THEN
    IF p_safe_code IS NOT NULL THEN RAISE EXCEPTION 'people_erasure_delivery_transition_invalid' USING ERRCODE='23514'; END IF;
  ELSIF v_row.delivery_state='dispatching' AND p_state='failed' THEN
    IF p_safe_code NOT IN('provider_config_missing','recipient_opted_out','provider_rejected','provider_rate_limited') THEN
      RAISE EXCEPTION 'people_erasure_delivery_transition_invalid' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'people_erasure_delivery_transition_invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.brand_person_erasure_challenges SET delivery_state=p_state,updated_at=now(),
    invalidated_at=CASE WHEN p_state='failed' THEN now() ELSE invalidated_at END WHERE id=p_challenge_id;
  INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,verification_channel,contact_fingerprint,safe_code)
    VALUES(v_row.id,v_row.case_reference,v_row.brand_id,v_row.person_id,p_actor_id,
      CASE WHEN p_state='sent' THEN 'challenge_sent' ELSE 'challenge_failed' END,
      v_row.channel,v_row.contact_fingerprint,p_safe_code);
  RETURN jsonb_build_object('challengeId',v_row.id,'deliveryState',p_state,'replayed',false);
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_execute_brand_person_erasure(
  p_challenge_id uuid,p_verification_hash text,p_client_request_id uuid,p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_challenge public.brand_person_erasure_challenges%ROWTYPE; v_existing public.brand_person_erasure_operations%ROWTYPE;
  v_person public.brand_people%ROWTYPE; v_operation uuid:=gen_random_uuid(); v_hash text; v_attempts integer;
  v_cleanup jsonb:='[]'::jsonb; v_counts jsonb; v_contact_count integer:=0; v_name_count integer:=0;
  v_source_count integer:=0; v_invite_count integer:=0; v_export_count integer:=0; v_import_count integer:=0;
  v_locked record;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  IF p_client_request_id IS NULL OR p_verification_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'people_erasure_input_invalid' USING ERRCODE='22023'; END IF;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('challenge',p_challenge_id,'verificationHash',p_verification_hash)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_request_id::text,1772));
  SELECT * INTO v_existing FROM public.brand_person_erasure_operations WHERE client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash OR v_existing.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_idempotency_conflict' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('operationId',v_existing.id,'state',v_existing.state,'cleanupPaths',v_existing.cleanup_paths,
      'countSummary',v_existing.count_summary,'replayed',true);
  END IF;
  SELECT * INTO v_challenge FROM public.brand_person_erasure_challenges WHERE id=p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_challenge.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_erasure_challenge_not_found' USING ERRCODE='P0002'; END IF;
  IF v_challenge.delivery_state='dispatching' AND v_challenge.consumed_at IS NULL
     AND v_challenge.invalidated_at IS NULL AND v_challenge.expires_at>now() THEN
    RETURN jsonb_build_object('state','delivery_unknown','safeCode','challenge_state_unknown');
  END IF;
  IF v_challenge.delivery_state<>'sent' OR v_challenge.consumed_at IS NOT NULL OR v_challenge.invalidated_at IS NOT NULL OR v_challenge.expires_at<=now() THEN
    UPDATE public.brand_person_erasure_challenges SET invalidated_at=COALESCE(invalidated_at,now()),updated_at=now() WHERE id=p_challenge_id AND consumed_at IS NULL;
    INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,verification_channel,contact_fingerprint,reason_code)
      VALUES(v_challenge.id,v_challenge.case_reference,v_challenge.brand_id,v_challenge.person_id,p_actor_id,'verification_rejected',v_challenge.channel,v_challenge.contact_fingerprint,'challenge_unavailable');
    RETURN jsonb_build_object('state','verification_rejected','safeCode','challenge_unavailable','attemptsRemaining',0);
  END IF;
  IF v_challenge.code_hash<>p_verification_hash THEN
    v_attempts:=LEAST(v_challenge.attempt_count+1,5);
    UPDATE public.brand_person_erasure_challenges SET attempt_count=v_attempts,
      invalidated_at=CASE WHEN v_attempts>=5 THEN now() ELSE NULL END,updated_at=now() WHERE id=p_challenge_id;
    INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,verification_channel,contact_fingerprint,reason_code,count_metadata)
      VALUES(v_challenge.id,v_challenge.case_reference,v_challenge.brand_id,v_challenge.person_id,p_actor_id,'verification_rejected',v_challenge.channel,v_challenge.contact_fingerprint,
        CASE WHEN v_attempts>=5 THEN 'challenge_locked' ELSE 'verification_mismatch' END,jsonb_build_object('attemptCount',v_attempts));
    RETURN jsonb_build_object('state','verification_rejected','safeCode',CASE WHEN v_attempts>=5 THEN 'challenge_locked' ELSE 'verification_mismatch' END,'attemptsRemaining',5-v_attempts);
  END IF;
  -- Lock the target person first, matching the canonical contact trigger. This
  -- prevents a novel address (which cannot be present in the scan yet) from
  -- committing to the target while erasure is in flight.
  PERFORM 1 FROM public.brand_people
    WHERE id=v_challenge.person_id AND brand_id=v_challenge.brand_id
      AND record_status='active' AND public.biz_brand_person_canonical(id)=id
    FOR UPDATE;
  -- Acquire every current address lock in a stable order, then re-read the
  -- canonical graph while those locks are held.
  FOR v_locked IN
    SELECT c.channel,c.normalized_value,c.id
    FROM public.brand_person_contact_methods c
    WHERE c.brand_person_id=v_challenge.person_id AND c.brand_id=v_challenge.brand_id
      AND c.channel IN('email','phone') AND c.normalized_value NOT LIKE 'erased:%'
    ORDER BY c.channel,c.normalized_value,c.id
  LOOP
    PERFORM public.issue_1772_lock_brand_person_address(v_challenge.brand_id,v_locked.channel,v_locked.normalized_value);
  END LOOP;
  SELECT * INTO v_person FROM public.brand_people WHERE id=v_challenge.person_id AND brand_id=v_challenge.brand_id AND record_status='active' AND public.biz_brand_person_canonical(id)=id FOR UPDATE;
  IF NOT FOUND OR v_person.linked_user_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts c WHERE c.brand_id=v_challenge.brand_id AND c.status='open' AND v_challenge.person_id=ANY(c.candidate_person_ids))
     OR EXISTS(SELECT 1 FROM public.brand_person_merge_events m WHERE m.brand_id=v_challenge.brand_id AND m.status='active' AND (m.winner_person_id=v_challenge.person_id OR m.loser_person_id=v_challenge.person_id))
     OR EXISTS(
       SELECT 1
       FROM public.brand_person_contact_methods target_contact
       JOIN public.brand_person_contact_methods other_contact
         ON other_contact.brand_id=target_contact.brand_id
        AND other_contact.channel=target_contact.channel
        AND other_contact.normalized_value=target_contact.normalized_value
        AND other_contact.brand_person_id IS DISTINCT FROM target_contact.brand_person_id
        AND other_contact.record_state='active' AND other_contact.provenance_scope='brand_owned'
       JOIN public.brand_people other_person ON other_person.id=other_contact.brand_person_id
       WHERE target_contact.brand_person_id=v_challenge.person_id
         AND target_contact.brand_id=v_challenge.brand_id
         AND target_contact.record_state='active' AND target_contact.provenance_scope='brand_owned'
         AND other_person.brand_id=v_challenge.brand_id AND other_person.record_status='active'
         AND public.biz_brand_person_canonical(other_person.id)=other_person.id
     ) THEN
    UPDATE public.brand_person_erasure_challenges SET invalidated_at=now(),updated_at=now() WHERE id=p_challenge_id;
    INSERT INTO public.brand_person_erasure_audit(challenge_id,case_reference,brand_id,person_id,actor_id,event,reason_code)
      VALUES(v_challenge.id,v_challenge.case_reference,v_challenge.brand_id,v_challenge.person_id,p_actor_id,'refused','identity_not_unambiguous');
    RETURN jsonb_build_object('state','refused','safeCode','identity_not_unambiguous');
  END IF;
  UPDATE public.brand_person_erasure_challenges SET consumed_at=now(),updated_at=now() WHERE id=p_challenge_id;
  INSERT INTO public.brand_person_erasure_operations(id,client_request_id,request_hash,challenge_id,case_reference,brand_id,person_id,actor_id,state)
    VALUES(v_operation,p_client_request_id,v_hash,p_challenge_id,v_challenge.case_reference,v_challenge.brand_id,v_challenge.person_id,p_actor_id,'db_erased');
  INSERT INTO public.brand_person_erasure_tombstones(brand_id,channel,address_fingerprint,erasure_operation_id)
    SELECT v_challenge.brand_id,c.channel,public.issue_1772_erasure_fingerprint(v_challenge.brand_id,c.channel,c.normalized_value),v_operation
    FROM public.brand_person_contact_methods c WHERE c.brand_person_id=v_challenge.person_id AND c.channel IN('email','phone')
      AND c.normalized_value NOT LIKE 'erased:%'
    ON CONFLICT(brand_id,channel,address_fingerprint) DO NOTHING;
  WITH changed AS (UPDATE public.brand_person_contact_method_sources SET active=false,retired_at=COALESCE(retired_at,now())
    WHERE contact_method_id IN(SELECT id FROM public.brand_person_contact_methods WHERE brand_person_id=v_challenge.person_id) AND active RETURNING 1)
    SELECT count(*) INTO v_source_count FROM changed;
  UPDATE public.brand_person_source_links SET detached_at=COALESCE(detached_at,now()),updated_at=now()
    WHERE brand_person_id=v_challenge.person_id AND detached_at IS NULL;
  UPDATE public.brand_person_contact_methods SET normalized_value='erased:'||id::text,record_state='retired',is_primary=false,
    is_exportable=false,suppression_eligible=false,retired_at=COALESCE(retired_at,now()),updated_at=now()
    WHERE brand_person_id=v_challenge.person_id;
  GET DIAGNOSTICS v_contact_count=ROW_COUNT;
  UPDATE public.brand_person_names SET display_name='Erased contact',normalized_name='erased:'||id::text,
    active=false,retired_at=COALESCE(retired_at,now()) WHERE brand_person_id=v_challenge.person_id;
  GET DIAGNOSTICS v_name_count=ROW_COUNT;
  UPDATE public.marketing_manual_group_pending_memberships SET state='dismissed',completed_at=now()
    WHERE resolved_person_id=v_challenge.person_id AND state='pending';
  UPDATE public.brand_contact_import_rows r SET name=NULL,email=NULL,phone_e164=NULL,phone_country=NULL,duplicate_key=NULL,
    canonical_person_id=NULL,conflict_id=NULL,outcome='invalid',reason_code='erased_contact',executed_at=COALESCE(executed_at,now())
    WHERE EXISTS(
      SELECT 1 FROM public.brand_contact_import_batches b
      WHERE b.id=r.batch_id AND b.brand_id=v_challenge.brand_id
    ) AND (
      r.canonical_person_id=v_challenge.person_id
      OR (r.email IS NOT NULL AND public.issue_1772_erasure_tombstoned(v_challenge.brand_id,'email',r.email))
      OR (r.phone_e164 IS NOT NULL AND public.issue_1772_erasure_tombstoned(v_challenge.brand_id,'phone',r.phone_e164))
    );
  GET DIAGNOSTICS v_import_count=ROW_COUNT;
  WITH removed AS (UPDATE public.brand_offering_invites SET status='removed',removal_reason='privacy_erasure',removed_at=now(),updated_at=now()
    WHERE brand_person_id=v_challenge.person_id AND status='active' RETURNING id)
    SELECT count(*) INTO v_invite_count FROM removed;
  UPDATE public.brand_offering_invite_tokens SET revoked_at=COALESCE(revoked_at,now()),contact_method_id=NULL,linked_user_id=NULL
    WHERE invite_id IN(SELECT id FROM public.brand_offering_invites WHERE brand_person_id=v_challenge.person_id);
  UPDATE public.brand_offering_invite_delivery_attempts SET status='suppressed',is_retryable=false,safe_reason_code='privacy_erasure',updated_at=now()
    WHERE invite_id IN(SELECT id FROM public.brand_offering_invites WHERE brand_person_id=v_challenge.person_id)
      AND channel IN('email','sms') AND status='queued';
  UPDATE public.brand_offering_invite_delivery_attempts SET is_retryable=false,safe_reason_code='privacy_erasure',updated_at=now()
    WHERE invite_id IN(SELECT id FROM public.brand_offering_invites WHERE brand_person_id=v_challenge.person_id)
      AND channel IN('email','sms') AND status='sending';
  SELECT COALESCE(jsonb_agg(path ORDER BY path),'[]'::jsonb) INTO v_cleanup FROM (
    SELECT storage_path path FROM public.brand_people_export_jobs WHERE brand_id=v_challenge.brand_id AND export_kind='brand_book' AND status IN('queued','running','ready') AND storage_path IS NOT NULL
    UNION SELECT prepared_storage_path FROM public.brand_people_export_jobs WHERE brand_id=v_challenge.brand_id AND export_kind='brand_book' AND status IN('queued','running','ready') AND prepared_storage_path IS NOT NULL
  ) paths;
  WITH expired AS (UPDATE public.brand_people_export_jobs SET status='expired',
    safe_error_code='privacy_erasure',expires_at=now(),updated_at=now()
    WHERE brand_id=v_challenge.brand_id AND export_kind='brand_book' AND status IN('queued','running','ready') RETURNING 1)
    SELECT count(*) INTO v_export_count FROM expired;
  UPDATE public.brand_people SET record_status='deleted',display_name='Erased contact',avatar_url=NULL,linked_user_id=NULL,
    merged_into_person_id=NULL,deleted_at=now(),updated_at=now() WHERE id=v_challenge.person_id;
  v_counts:=jsonb_build_object('contactCount',v_contact_count,'nameCount',v_name_count,'sourceEdgeCount',v_source_count,
    'inviteCount',v_invite_count,'exportJobCount',v_export_count,'importRowCount',v_import_count);
  UPDATE public.brand_person_erasure_operations SET count_summary=v_counts,cleanup_paths=v_cleanup,updated_at=now() WHERE id=v_operation;
  INSERT INTO public.brand_person_erasure_audit(operation_id,challenge_id,case_reference,brand_id,person_id,actor_id,event,count_metadata)
    VALUES(v_operation,p_challenge_id,v_challenge.case_reference,v_challenge.brand_id,v_challenge.person_id,p_actor_id,'db_erased',v_counts);
  RETURN jsonb_build_object('operationId',v_operation,'state','db_erased','cleanupPaths',v_cleanup,'countSummary',v_counts,'replayed',false);
END
$f$;

CREATE OR REPLACE FUNCTION public.issue_1772_complete_brand_person_erasure_cleanup(
  p_operation_id uuid,p_actor_id uuid,p_success boolean,p_safe_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.brand_person_erasure_operations%ROWTYPE; v_state text;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  IF p_safe_code IS NOT NULL AND p_safe_code !~ '^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'people_erasure_input_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.brand_person_erasure_operations WHERE id=p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_row.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'people_erasure_operation_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.state='completed' THEN
    RETURN jsonb_build_object('operationId',v_row.id,'state','completed','replayed',true);
  END IF;
  IF v_row.state NOT IN('db_erased','cleanup_retryable') THEN
    RAISE EXCEPTION 'people_erasure_cleanup_state_invalid' USING ERRCODE='23514';
  END IF;
  v_state:=CASE WHEN p_success THEN 'completed' ELSE 'cleanup_retryable' END;
  UPDATE public.brand_person_erasure_operations SET state=v_state,safe_code=p_safe_code,
    completed_at=CASE WHEN p_success THEN now() ELSE NULL END,updated_at=now() WHERE id=p_operation_id;
  INSERT INTO public.brand_person_erasure_audit(operation_id,challenge_id,case_reference,brand_id,person_id,actor_id,event,safe_code,count_metadata)
    VALUES(v_row.id,v_row.challenge_id,v_row.case_reference,v_row.brand_id,v_row.person_id,p_actor_id,
      CASE WHEN p_success THEN 'completed' ELSE 'cleanup_retryable' END,p_safe_code,v_row.count_summary);
  RETURN jsonb_build_object('operationId',v_row.id,'state',v_state,'replayed',false);
END
$f$;

-- The worker clears an exact path only after Storage confirms deletion. Privacy
-- erasure markers are eligible immediately; ordinary ready/expired jobs retain
-- the original expiry condition.
CREATE OR REPLACE FUNCTION public.biz_expire_brand_people_export(
  p_job_id uuid,p_storage_path text
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp
AS $f$
  WITH updated AS (
    UPDATE public.brand_people_export_jobs
    SET status='expired',
      storage_path=CASE WHEN storage_path=p_storage_path THEN NULL ELSE storage_path END,
      prepared_storage_path=CASE WHEN prepared_storage_path=p_storage_path THEN NULL ELSE prepared_storage_path END,
      updated_at=now()
    WHERE id=p_job_id
      AND p_storage_path IS NOT NULL
      AND p_storage_path IN(storage_path,prepared_storage_path)
      AND (
        (status='expired' AND safe_error_code='privacy_erasure')
        OR (status IN('ready','expired') AND expires_at<=now())
      )
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated)
$f$;
REVOKE ALL ON FUNCTION public.biz_expire_brand_people_export(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_expire_brand_people_export(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1772_get_brand_person_erasure_operation(p_operation_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_row public.brand_person_erasure_operations%ROWTYPE;
BEGIN
  PERFORM public.issue_1772_require_support_service(p_actor_id);
  SELECT * INTO v_row FROM public.brand_person_erasure_operations WHERE id=p_operation_id AND actor_id=p_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'people_erasure_operation_not_found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('operationId',v_row.id,'state',v_row.state,'cleanupPaths',v_row.cleanup_paths,
    'countSummary',v_row.count_summary,'safeCode',v_row.safe_code,'caseReference',v_row.case_reference);
END
$f$;

DO $grants$
DECLARE v_proc regprocedure;
BEGIN
  FOREACH v_proc IN ARRAY ARRAY[
    'public.issue_1772_create_brand_person_erasure_challenge(uuid,uuid,text,uuid,uuid,uuid,text,uuid)'::regprocedure,
    'public.issue_1772_claim_erasure_challenge_delivery(uuid,uuid)'::regprocedure,
    'public.issue_1772_finish_erasure_challenge_delivery(uuid,uuid,text,text)'::regprocedure,
    'public.issue_1772_execute_brand_person_erasure(uuid,text,uuid,uuid)'::regprocedure,
    'public.issue_1772_complete_brand_person_erasure_cleanup(uuid,uuid,boolean,text)'::regprocedure,
    'public.issue_1772_get_brand_person_erasure_operation(uuid,uuid)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',v_proc);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_proc);
  END LOOP;
END
$grants$;

-- Preserve the latest #1857/#2305 bodies byte-for-byte except for teaching
-- every separation predicate/index inference that superseded rows are history.
DO $forward_replace$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure) INTO v_def;
  v_before:=v_def;
  v_def:=replace(v_def,'WHERE s.brand_id=v_brand','WHERE s.superseded_at IS NULL AND s.brand_id=v_brand');
  IF v_def=v_before OR v_def NOT LIKE '%s.superseded_at IS NULL%' THEN RAISE EXCEPTION 'issue_1772_source_separation_patch_failed'; END IF;
  EXECUTE v_def;

  SELECT pg_get_functiondef('public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure) INTO v_def;
  v_before:=v_def;
  v_def:=replace(v_def,'ON CONFLICT (brand_id,person_id,normalized_name) DO NOTHING',
    'ON CONFLICT (brand_id,person_id,normalized_name) WHERE superseded_at IS NULL DO NOTHING');
  IF v_def=v_before OR v_def NOT LIKE '%WHERE superseded_at IS NULL DO NOTHING%' THEN RAISE EXCEPTION 'issue_1772_conflict_separation_patch_failed'; END IF;
  EXECUTE v_def;

  -- Preserve the qualified #1774 digest body; refuse erased addresses before
  -- the first person/source/conflict write.
  SELECT pg_get_functiondef('public.biz_add_brand_person(uuid,text,text,text,text,uuid)'::regprocedure) INTO v_def;
  v_before:=v_def;
  v_def:=replace(v_def,
    'IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION ''people_contact_required'' USING ERRCODE=''22023''; END IF;',
    'IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION ''people_contact_required'' USING ERRCODE=''22023''; END IF;
  IF (v_email IS NOT NULL AND public.issue_1772_erasure_tombstoned(p_brand_id,''email'',v_email))
     OR (v_phone IS NOT NULL AND public.issue_1772_erasure_tombstoned(p_brand_id,''phone'',v_phone)) THEN
    RAISE EXCEPTION ''people_erased_contact_suppressed'' USING ERRCODE=''23514'';
  END IF;');
  IF v_def=v_before OR v_def NOT LIKE '%people_erased_contact_suppressed%' THEN RAISE EXCEPTION 'issue_1772_manual_add_patch_failed'; END IF;
  EXECUTE v_def;

  -- Preserve #1775 execution semantics and continue the batch after a
  -- tombstoned row is scrubbed and terminally classified.
  SELECT pg_get_functiondef('public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text)'::regprocedure) INTO v_def;
  v_before:=v_def;
  v_def:=replace(v_def,
    'FOR r IN SELECT * FROM public.brand_contact_import_rows WHERE batch_id=p_batch ORDER BY row_number FOR UPDATE LOOP
   IF r.outcome IN (''invalid'',''duplicate'') THEN CONTINUE; END IF;',
    'FOR r IN SELECT * FROM public.brand_contact_import_rows WHERE batch_id=p_batch ORDER BY row_number FOR UPDATE LOOP
   IF (r.email IS NOT NULL AND public.issue_1772_erasure_tombstoned(p_brand,''email'',r.email))
      OR (r.phone_e164 IS NOT NULL AND public.issue_1772_erasure_tombstoned(p_brand,''phone'',r.phone_e164)) THEN
     UPDATE public.brand_contact_import_rows SET name=NULL,email=NULL,phone_e164=NULL,phone_country=NULL,duplicate_key=NULL,
       canonical_person_id=NULL,conflict_id=NULL,outcome=''invalid'',reason_code=''erased_contact'',executed_at=now() WHERE id=r.id;
     CONTINUE;
   END IF;
   IF r.outcome IN (''invalid'',''duplicate'') THEN CONTINUE; END IF;');
  IF v_def=v_before OR v_def NOT LIKE '%reason_code=''erased_contact''%' THEN RAISE EXCEPTION 'issue_1772_import_patch_failed'; END IF;
  EXECUTE v_def;
END
$forward_replace$;

REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.biz_add_brand_person(uuid,text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_add_brand_person(uuid,text,text,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text) TO service_role;

DO $assert$
DECLARE v_table text; v_def text; v_actor_shape text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_person_maintenance_operations','brand_person_erasure_keys','brand_person_erasure_challenges',
    'brand_person_erasure_operations','brand_person_erasure_tombstones','brand_person_erasure_audit'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=format('public.%I',v_table)::regclass AND c.relrowsecurity AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION 'issue_1772_private_table_rls_drift:%',v_table;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=v_table) THEN
      RAISE EXCEPTION 'issue_1772_private_table_policy_drift:%',v_table;
    END IF;
    IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name=v_table AND grantee IN('anon','authenticated')) THEN
      RAISE EXCEPTION 'issue_1772_private_table_grant_drift:%',v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated','public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_reverse_brand_person_merge(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1772_raw_engine_grant_drift';
  END IF;
  IF has_function_privilege('anon','public.biz_merge_brand_people_manual(uuid,uuid,uuid,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.biz_promote_brand_person_contact(uuid,uuid,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.biz_reverse_brand_person_merge_manual(uuid,uuid,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1772_anon_rpc_grant_drift';
  END IF;
  SELECT pg_get_functiondef('public.biz_resolve_brand_person_source(uuid,uuid,text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%s.superseded_at IS NULL%' THEN RAISE EXCEPTION 'issue_1772_source_separation_predicate_drift'; END IF;
  SELECT pg_get_functiondef('public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%WHERE superseded_at IS NULL DO NOTHING%' THEN RAISE EXCEPTION 'issue_1772_conflict_separation_predicate_drift'; END IF;
  SELECT pg_get_functiondef('public.biz_add_brand_person(uuid,text,text,text,text,uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%people_erased_contact_suppressed%' OR v_def NOT LIKE '%extensions.digest(%' THEN RAISE EXCEPTION 'issue_1772_manual_add_tombstone_drift'; END IF;
  SELECT pg_get_functiondef('public.issue_1775_execute_import(uuid,uuid,uuid,text,text,text,text,text,uuid,text)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%reason_code=''erased_contact''%' THEN RAISE EXCEPTION 'issue_1772_import_tombstone_drift'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.brand_person_contact_methods'::regclass AND tgname='issue_1772_contact_tombstone_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'issue_1772_contact_tombstone_trigger_missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='issue_1772_erasure_challenge_active_lookup'
    AND indexdef LIKE '%delivery_state = ANY%pending%dispatching%sent%') THEN
    RAISE EXCEPTION 'issue_1772_active_challenge_lookup_drift';
  END IF;
  SELECT pg_get_functiondef('public.issue_1772_claim_erasure_challenge_delivery(uuid,uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%challenge_dispatch_claimed%' OR v_def NOT LIKE '%SET delivery_state=''dispatching''%'
     OR has_function_privilege('authenticated','public.issue_1772_claim_erasure_challenge_delivery(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1772_dispatch_claim_contract_drift';
  END IF;
  SELECT pg_get_functiondef('public.issue_1772_reject_tombstoned_contact()'::regprocedure) INTO v_def;
  IF position('PERFORM 1' in v_def)=0
     OR position('PERFORM 1' in v_def)>position('issue_1772_lock_brand_person_address' in v_def)
     OR position('issue_1772_lock_brand_person_address' in v_def)=0
     OR position('issue_1772_lock_brand_person_address' in v_def)>position('issue_1772_erasure_tombstoned' in v_def) THEN
    RAISE EXCEPTION 'issue_1772_address_lock_order_drift';
  END IF;
  IF has_function_privilege('anon','public.issue_1772_lock_brand_person_address(uuid,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_1772_lock_brand_person_address(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.issue_1772_lock_brand_person_address(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1772_address_lock_grant_drift';
  END IF;
  SELECT pg_get_functiondef('public.issue_1772_execute_brand_person_erasure(uuid,text,uuid,uuid)'::regprocedure) INTO v_def;
  IF position('PERFORM 1 FROM public.brand_people' in v_def)=0
     OR position('PERFORM 1 FROM public.brand_people' in v_def)>position('FOR v_locked IN' in v_def)
     OR v_def NOT LIKE '%ORDER BY c.channel,c.normalized_value,c.id%'
     OR v_def NOT LIKE '%other_contact.brand_person_id IS DISTINCT FROM target_contact.brand_person_id%'
     OR v_def NOT LIKE '%brand_contact_import_batches b%AND b.brand_id=v_challenge.brand_id%' THEN
    RAISE EXCEPTION 'issue_1772_erasure_lock_or_scope_drift';
  END IF;
  SELECT pg_get_functiondef('public.issue_1772_complete_brand_person_erasure_cleanup(uuid,uuid,boolean,text)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%IF v_row.state=''completed'' THEN%'
     OR v_def NOT LIKE '%people_erasure_cleanup_state_invalid%' THEN
    RAISE EXCEPTION 'issue_1772_cleanup_absorbing_drift';
  END IF;
  SELECT pg_get_functiondef('public.biz_expire_brand_people_export(uuid,text)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%privacy_erasure%'
     OR v_def NOT LIKE '%prepared_storage_path%'
     OR v_def NOT LIKE '%p_storage_path%' THEN
    RAISE EXCEPTION 'issue_1772_export_marker_cleanup_drift';
  END IF;
  FOREACH v_actor_shape IN ARRAY ARRAY[
    'brand_person_identity_separations.superseded_by',
    'brand_person_maintenance_operations.actor_id',
    'brand_person_erasure_challenges.created_by',
    'brand_person_erasure_operations.actor_id',
    'brand_person_erasure_audit.actor_id'
  ] LOOP
    IF EXISTS(
      SELECT 1 FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=ANY(con.conkey)
      WHERE con.contype='f' AND con.conrelid=format('public.%I',split_part(v_actor_shape,'.',1))::regclass
        AND att.attname=split_part(v_actor_shape,'.',2)
    ) THEN
      RAISE EXCEPTION 'issue_1772_actor_snapshot_fk_drift:%',v_actor_shape;
    END IF;
  END LOOP;
END
$assert$;

COMMIT;
