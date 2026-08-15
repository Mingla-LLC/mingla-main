-- Issue #1972 / #424 Pass 4 B1 — canonical event lifecycle + Ari exactly-once.
-- APPLY SURGICALLY: linked migration history is drifted (COMMS-0034).
BEGIN;

-- Pending proposals and execution transitions are Edge-server state, not a
-- user-writable table. Existing un-attested work is expired during rollout so
-- a row forged before this migration cannot be promoted afterward.
ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS server_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_attested_at timestamptz;
UPDATE public.agent_pending_actions SET status='expired'
WHERE status IN('pending','executing') AND server_proposed_at IS NULL;
REVOKE INSERT,UPDATE,DELETE ON public.agent_pending_actions FROM authenticated;
GRANT SELECT ON public.agent_pending_actions TO authenticated;
GRANT ALL ON public.agent_pending_actions TO service_role;

-- ---------------------------------------------------------------------------
-- 1. Generic confirmed-operation receipts (shared with later Ari domains).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_operation_receipts (
  operation_id uuid PRIMARY KEY
    REFERENCES public.agent_pending_actions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_operation_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_operation_receipts_owner_read
  ON public.agent_operation_receipts;
CREATE POLICY agent_operation_receipts_owner_read
  ON public.agent_operation_receipts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.agent_operation_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_operation_receipts TO authenticated;
GRANT ALL ON TABLE public.agent_operation_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.agent_operation_receipt_begin(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pending public.agent_pending_actions%ROWTYPE;
  v_receipt public.agent_operation_receipts%ROWTYPE;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation_id IS NULL OR NULLIF(btrim(p_tool_name), '') IS NULL OR p_args IS NULL THEN
    RAISE EXCEPTION 'invalid_operation_receipt_request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 1972));
  SELECT * INTO v_pending FROM public.agent_pending_actions
   WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_pending.user_id <> v_uid THEN
    RAISE EXCEPTION 'operation_not_found';
  END IF;
  IF v_pending.status <> 'executing' OR v_pending.server_proposed_at IS NULL
     OR v_pending.execution_attested_at IS NULL THEN
    RAISE EXCEPTION 'operation_not_executing';
  END IF;
  IF v_pending.tool_name <> p_tool_name OR v_pending.tool_args IS DISTINCT FROM p_args THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  v_hash := encode(extensions.digest(
    convert_to(p_tool_name || ':' || p_args::text, 'UTF8'), 'sha256'
  ), 'hex');
  SELECT * INTO v_receipt FROM public.agent_operation_receipts
   WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.user_id <> v_uid OR v_receipt.tool_name <> p_tool_name
       OR v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RETURN jsonb_build_object('replay', true, 'result', v_receipt.result,
      'request_hash', v_hash);
  END IF;

  -- Transaction-local proof: complete cannot be called as a separate RPC to
  -- fabricate a receipt. Domain wrappers call begin -> mutate -> complete in
  -- one database transaction.
  PERFORM set_config('mingla.agent_operation_id', p_operation_id::text, true);
  PERFORM set_config('mingla.agent_operation_hash', v_hash, true);
  RETURN jsonb_build_object('replay', false, 'request_hash', v_hash);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.agent_operation_receipt_complete(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb,
  p_result jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pending public.agent_pending_actions%ROWTYPE;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_hash := encode(extensions.digest(
    convert_to(p_tool_name || ':' || p_args::text, 'UTF8'), 'sha256'
  ), 'hex');
  IF current_setting('mingla.agent_operation_id', true) IS DISTINCT FROM p_operation_id::text
     OR current_setting('mingla.agent_operation_hash', true) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'operation_receipt_transaction_required';
  END IF;
  SELECT * INTO v_pending FROM public.agent_pending_actions
   WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_pending.user_id <> v_uid OR v_pending.status <> 'executing'
     OR v_pending.server_proposed_at IS NULL OR v_pending.execution_attested_at IS NULL
     OR v_pending.tool_name <> p_tool_name OR v_pending.tool_args IS DISTINCT FROM p_args THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  INSERT INTO public.agent_operation_receipts(
    operation_id, user_id, tool_name, request_hash, result
  ) VALUES (p_operation_id, v_uid, p_tool_name, v_hash, COALESCE(p_result, 'null'::jsonb));
  RETURN p_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agent_operation_receipt_begin(uuid,text,jsonb),
  public.agent_operation_receipt_complete(uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_operation_receipt_begin(uuid,text,jsonb),
  public.agent_operation_receipt_complete(uuid,text,jsonb,jsonb) TO authenticated, service_role;

-- Pending-action terminal state and its durable tool receipt are one commit.
-- Only the trusted Edge service client may attest a terminal outcome. A
-- caller-JWT tool executor still owns every domain write and its operation
-- receipt; this adapter only closes the server-owned proposal state machine.
CREATE TABLE IF NOT EXISTS public.agent_pending_action_terminal_receipts(
  pending_action_id uuid PRIMARY KEY
    REFERENCES public.agent_pending_actions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN('executed','failed','cancelled','expired')),
  result jsonb,
  failure_reason text,
  prompt_version text NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_pending_action_terminal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pending_action_terminal_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_pending_action_terminal_receipts
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.agent_pending_action_terminal_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.terminalize_agent_pending_action(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_expected_status text,
  p_outcome text,
  p_result jsonb DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_prompt_version text DEFAULT 'tenant-v1',
  p_model_version text DEFAULT 'unknown',
  p_require_operation_receipt boolean DEFAULT false
) RETURNS TABLE(
  id uuid,
  status text,
  cas_won boolean,
  replay boolean,
  executed_result jsonb,
  conversation_id uuid,
  tool_name text,
  source text,
  related_brand_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_pending public.agent_pending_actions%ROWTYPE;
  v_terminal public.agent_pending_action_terminal_receipts%ROWTYPE;
  v_operation public.agent_operation_receipts%ROWTYPE;
  v_result jsonb:=p_result;
  v_claims jsonb;
BEGIN
  -- PostgREST's signed JWT authority is the request.jwt.claims JSON object.
  -- The legacy dotted scalar is not populated consistently and must never be
  -- accepted as an independent privilege source.
  BEGIN
    v_claims:=NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'trusted_terminal_attestation_required';
  END;
  IF jsonb_typeof(v_claims) IS DISTINCT FROM 'object'
     OR v_claims->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'trusted_terminal_attestation_required';
  END IF;
  IF p_outcome NOT IN('executed','failed','cancelled','expired')
     OR p_expected_status NOT IN('pending','executing') THEN
    RAISE EXCEPTION 'invalid_terminal_transition';
  END IF;

  SELECT * INTO v_pending FROM public.agent_pending_actions
  WHERE agent_pending_actions.id=p_pending_action_id
    AND agent_pending_actions.user_id=p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_pending.server_proposed_at IS NULL THEN
    RAISE EXCEPTION 'pending_action_not_found';
  END IF;

  SELECT * INTO v_terminal FROM public.agent_pending_action_terminal_receipts terminal_receipt
  WHERE terminal_receipt.pending_action_id=p_pending_action_id;
  IF FOUND THEN
    IF v_terminal.user_id<>p_user_id OR v_terminal.tool_name<>v_pending.tool_name
       OR v_terminal.outcome<>p_outcome THEN
      RAISE EXCEPTION 'pending_action_terminal_conflict';
    END IF;
    RETURN QUERY SELECT v_pending.id,v_pending.status,false,true,
      v_terminal.result,v_pending.conversation_id,v_pending.tool_name,
      v_pending.source,v_pending.related_brand_id;
    RETURN;
  END IF;

  IF v_pending.status<>p_expected_status THEN
    RAISE EXCEPTION 'pending_action_cas_conflict';
  END IF;
  IF p_outcome='executed' AND p_expected_status<>'executing' THEN
    RAISE EXCEPTION 'executed_requires_executing';
  END IF;
  IF p_outcome IN('cancelled','expired') AND p_expected_status<>'pending' THEN
    RAISE EXCEPTION 'pending_terminal_requires_pending';
  END IF;
  IF p_outcome='executed' AND v_pending.execution_attested_at IS NULL THEN
    RAISE EXCEPTION 'execution_attestation_required';
  END IF;

  IF p_require_operation_receipt THEN
    SELECT * INTO v_operation FROM public.agent_operation_receipts operation_receipt
    WHERE operation_receipt.operation_id=p_pending_action_id
      AND operation_receipt.user_id=p_user_id
      AND operation_receipt.tool_name=v_pending.tool_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'operation_receipt_required';END IF;
    v_result:=v_operation.result;
  END IF;

  UPDATE public.agent_pending_actions AS pending_row SET
    status=p_outcome,
    executed_at=CASE WHEN p_outcome='executed' THEN now() ELSE pending_row.executed_at END,
    executed_result=CASE WHEN p_outcome='executed' THEN v_result ELSE pending_row.executed_result END,
    failure_reason=CASE WHEN p_outcome='failed' THEN p_failure_reason ELSE pending_row.failure_reason END
  WHERE pending_row.id=p_pending_action_id
    AND pending_row.user_id=p_user_id
    AND pending_row.status=p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending_action_cas_conflict';END IF;

  INSERT INTO public.agent_pending_action_terminal_receipts(
    pending_action_id,user_id,tool_name,outcome,result,failure_reason,
    prompt_version,model_version
  ) VALUES(
    p_pending_action_id,p_user_id,v_pending.tool_name,p_outcome,v_result,
    p_failure_reason,p_prompt_version,p_model_version
  );

  IF v_pending.conversation_id IS NOT NULL THEN
    INSERT INTO public.agent_messages(
      conversation_id,user_id,role,content,tool_results,prompt_version,model_version
    ) VALUES(
      v_pending.conversation_id,p_user_id,'tool',jsonb_build_object('text',''),
      jsonb_strip_nulls(jsonb_build_object(
        'tool_name',v_pending.tool_name,
        'pending_action_id',p_pending_action_id,
        'outcome',p_outcome,
        'result',v_result,
        'reason',p_failure_reason
      )),p_prompt_version,p_model_version
    );
  END IF;

  SELECT * INTO v_pending FROM public.agent_pending_actions
  WHERE agent_pending_actions.id=p_pending_action_id;
  RETURN QUERY SELECT v_pending.id,v_pending.status,true,false,v_result,
    v_pending.conversation_id,v_pending.tool_name,v_pending.source,
    v_pending.related_brand_id;
END;$fn$;
REVOKE ALL ON FUNCTION public.terminalize_agent_pending_action(
  uuid,uuid,text,text,jsonb,text,text,text,boolean
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_agent_pending_action(
  uuid,uuid,text,text,jsonb,text,text,text,boolean
) TO service_role;

CREATE TABLE IF NOT EXISTS public.event_cover_selections(
  selection_ref text PRIMARY KEY CHECK(length(selection_ref) BETWEEN 8 AND 128),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  media_url text,
  media_type text,
  poster_url text,
  provider text,
  source_url text,
  credit text,
  credit_url text,
  alt text,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_cover_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cover_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_cover_selections FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.event_cover_selections TO service_role;

CREATE OR REPLACE FUNCTION public.assert_event_cover_selection_source(
  p_event_id uuid,p_brand_id uuid,p_url text,p_type text,p_poster_url text,
  p_provider text,p_source_url text
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,storage,pg_temp AS $fn$
DECLARE v_media_path text;v_poster_path text;
BEGIN
  PERFORM public.assert_cover_media_triplet(p_url,p_type,p_poster_url);
  CASE COALESCE(NULLIF(p_provider,''),'upload')
    WHEN 'upload' THEN
      IF p_type='video' THEN
        IF NOT EXISTS(
          SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id=p_event_id AND j.brand_id=p_brand_id
            AND j.target_kind='event' AND j.status='ready'
            AND j.processed_url=p_url AND j.processed_poster_url=p_poster_url
        ) THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
      ELSE
        v_media_path:=split_part(p_url,'/storage/v1/object/public/event_covers/',2);
        v_poster_path:=split_part(p_poster_url,'/storage/v1/object/public/event_covers/',2);
        IF v_media_path='' OR v_media_path NOT LIKE p_brand_id::text||'/'||p_event_id::text||'/%'
          OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event_covers' AND o.name=v_media_path)
          OR (p_type='gif' AND (
            v_poster_path='' OR v_poster_path NOT LIKE p_brand_id::text||'/'||p_event_id::text||'/%'
            OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='event_covers' AND o.name=v_poster_path)
          ))
        THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
      END IF;
    WHEN 'giphy' THEN
      IF p_type<>'gif'
        OR p_url !~ '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
        OR p_poster_url !~ '^https://([a-z0-9-]+\.)?(giphy\.com|giphy\.net)/'
        OR COALESCE(p_source_url,'') !~ '^https://([a-z0-9-]+\.)?giphy\.com/'
      THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
    WHEN 'pexels' THEN
      IF p_type<>'image' OR p_url<>p_poster_url
        OR p_url !~ '^https://images\.pexels\.com/'
        OR COALESCE(p_source_url,'') !~ '^https://([a-z0-9-]+\.)?pexels\.com/'
      THEN RAISE EXCEPTION 'cover_selection_source_unverified';END IF;
    ELSE RAISE EXCEPTION 'cover_selection_provider_unverified';
  END CASE;
END;$fn$;
REVOKE ALL ON FUNCTION public.assert_event_cover_selection_source(
  uuid,uuid,text,text,text,text,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_event_cover_selection_source(
  uuid,uuid,text,text,text,text,text
) TO service_role;

CREATE OR REPLACE FUNCTION public.business_register_event_cover_selection(
  p_user_id uuid,p_event_id uuid,p_selection_ref text,p_url text,p_type text,p_poster_url text,
  p_provider text DEFAULT NULL,p_source_url text DEFAULT NULL,p_credit text DEFAULT NULL,
  p_credit_url text DEFAULT NULL,p_alt text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_brand_id uuid;v_claims jsonb;
BEGIN
  BEGIN
    v_claims:=NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'trusted_cover_attestation_required';
  END;
  IF jsonb_typeof(v_claims) IS DISTINCT FROM 'object'
     OR v_claims->>'role' IS DISTINCT FROM 'service_role'
     OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'trusted_cover_attestation_required';
  END IF;
  IF length(COALESCE(p_selection_ref,'')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'cover_selection_invalid';END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id=p_event_id AND event_type='event' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_brand_id,p_user_id)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  IF NULLIF(p_url,'') IS NULL OR NULLIF(p_type,'') IS NULL
     OR NULLIF(p_poster_url,'') IS NULL THEN
    RAISE EXCEPTION 'cover_selection_media_required';
  END IF;
  PERFORM public.assert_event_cover_selection_source(
    p_event_id,v_brand_id,NULLIF(p_url,''),NULLIF(p_type,''),
    NULLIF(p_poster_url,''),NULLIF(p_provider,''),NULLIF(p_source_url,'')
  );
  INSERT INTO public.event_cover_selections(selection_ref,user_id,event_id,media_url,media_type,poster_url,provider,source_url,credit,credit_url,alt)
  VALUES(p_selection_ref,p_user_id,p_event_id,NULLIF(p_url,''),NULLIF(p_type,''),NULLIF(p_poster_url,''),NULLIF(p_provider,''),NULLIF(p_source_url,''),NULLIF(p_credit,''),NULLIF(p_credit_url,''),NULLIF(p_alt,''));
  RETURN jsonb_build_object('selection_ref',p_selection_ref,'event_id',p_event_id,'expires_at',now()+interval '30 minutes');
END;$fn$;
REVOKE ALL ON FUNCTION public.business_register_event_cover_selection(uuid,uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_register_event_cover_selection(uuid,uuid,text,text,text,text,text,text,text,text,text) TO service_role;

-- Visibility is a closed contract at every event lifecycle boundary. Accepting
-- JSON text here (instead of coercing with ->>) makes missing, JSON null, and
-- non-string values indistinguishable from neither a valid nor a default
-- choice: all fail closed with the same stable product error.
CREATE OR REPLACE FUNCTION public.business_assert_event_visibility(
  p_value jsonb
) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_visibility text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  v_visibility:=p_value#>>'{}';
  IF v_visibility NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  RETURN v_visibility;
END;$fn$;
REVOKE ALL ON FUNCTION public.business_assert_event_visibility(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_assert_event_visibility(jsonb)
  TO service_role;

-- The legacy publish owner historically mapped every unknown value to public.
-- This trigger is the final persistence boundary, including direct RPC calls:
-- a draft cannot become public/scheduled until its exact stored choice passes
-- the same validator used by draft create/update and Ari.
CREATE OR REPLACE FUNCTION public.business_guard_event_publish_visibility()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE
  v_requested_visibility text;
  v_expected_live_visibility text;
BEGIN
  IF OLD.event_type='event' AND OLD.status='draft'
     AND NEW.status IN('scheduled','live') THEN
    v_requested_visibility:=public.business_assert_event_visibility(
      NEW.theme#>'{business_event,requestedVisibility}'
    );
    v_expected_live_visibility:=CASE v_requested_visibility
      WHEN 'unlisted' THEN 'hidden'
      ELSE v_requested_visibility
    END;
    IF NEW.visibility IS DISTINCT FROM v_expected_live_visibility THEN
      RAISE EXCEPTION 'event_visibility_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION public.business_guard_event_publish_visibility()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS business_guard_event_publish_visibility
  ON public.events;
CREATE TRIGGER business_guard_event_publish_visibility
BEFORE UPDATE OF status,visibility,theme ON public.events
FOR EACH ROW EXECUTE FUNCTION public.business_guard_event_publish_visibility();

-- Business and Ari publish through this poster-preserving owner. Validate the
-- submitted draft before cover or publish work begins; the trigger above is
-- the backstop for callers of the underlying legacy RPC.
CREATE OR REPLACE FUNCTION public.issue_1719_publish_event_with_poster(
  p_event_id uuid,p_draft_payload jsonb,p_client_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;v_url text;v_type text;v_poster text;
BEGIN
  PERFORM public.business_assert_event_visibility(
    p_draft_payload#>'{theme,business_draft,requestedVisibility}'
  );
  v_url:=NULLIF(p_draft_payload->>'cover_media_url','');
  v_type:=NULLIF(p_draft_payload->>'cover_media_type','');
  v_poster:=COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url',''),
    CASE WHEN v_type='image' THEN v_url END);
  PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  v_result:=public.business_publish_event_draft(
    p_event_id,p_draft_payload,p_client_revision
  );
  UPDATE public.events SET cover_media_poster_url=v_poster
  WHERE id=p_event_id AND cover_media_url IS NOT DISTINCT FROM v_url
    AND cover_media_type IS NOT DISTINCT FROM v_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;
  RETURN v_result;
END;$fn$;
REVOKE ALL ON FUNCTION public.issue_1719_publish_event_with_poster(uuid,jsonb,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1719_publish_event_with_poster(uuid,jsonb,integer)
  TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Rebuild the complete editable draft payload from canonical live rows.
--    No orders, attendees, payments, scans, PII, or audit history are copied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_business jsonb;
  v_tickets jsonb;
  v_dates jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi jsonb;
  v_requested_visibility text;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, auth.uid())
       < public.biz_role_rank('scanner') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tt.id::text,
    'name', tt.name,
    'description', tt.description,
    'priceGbp', CASE WHEN tt.price_cents IS NULL THEN NULL ELSE tt.price_cents / 100.0 END,
    'currency', btrim(tt.currency::text),
    'capacity', tt.quantity_total,
    'isFree', tt.is_free,
    'isUnlimited', tt.is_unlimited,
    'visibility', CASE WHEN tt.is_disabled THEN 'disabled' WHEN tt.is_hidden THEN 'hidden' ELSE 'public' END,
    'displayOrder', tt.display_order,
    'approvalRequired', tt.requires_approval,
    'passwordProtected', tt.password_protected,
    'passwordConfigured', tt.password_hash IS NOT NULL,
    'password', NULL,
    'waitlistEnabled', tt.waitlist_enabled,
    'minPurchaseQty', tt.min_purchase_qty,
    'maxPurchaseQty', tt.max_purchase_qty,
    'allowTransfers', tt.allow_transfers,
    'saleStartAt', tt.sale_start_at,
    'saleEndAt', tt.sale_end_at,
    'availableAt', CASE WHEN tt.available_online AND tt.available_in_person THEN 'both'
      WHEN tt.available_online THEN 'online' ELSE 'door' END
  ) ORDER BY tt.display_order, tt.created_at), '[]'::jsonb)
  INTO v_tickets FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL;
  IF v_event.status='draft' THEN
    v_tickets:=COALESCE(v_event.theme#>'{business_draft,tickets}',v_tickets);
  END IF;

  -- Draft schedule topology is typed but deliberately not materialized in
  -- event_dates until publish. Preserve that canonical payload byte-for-byte.
  IF v_event.status = 'draft' THEN
    v_when_mode := COALESCE(v_event.theme#>>'{business_draft,whenMode}', 'single');
    v_when := v_event.theme#>'{business_draft,when}';
    v_multi := v_event.theme#>'{business_draft,multiDates}';
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'startTime', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endTime', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI')
    ) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_dates FROM public.event_dates ed WHERE ed.event_id = p_event_id;

    v_when_mode := CASE WHEN v_event.is_multi_date THEN 'multi_date'
      WHEN v_event.is_recurring THEN 'recurring' ELSE 'single' END;
    SELECT jsonb_build_object(
      'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
      'doorsOpen', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'endsAt', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
      'timezone', v_event.timezone
    ) INTO v_when FROM public.event_dates ed
    WHERE ed.event_id = p_event_id AND ed.is_master ORDER BY ed.start_at LIMIT 1;
    v_multi := CASE WHEN v_when_mode = 'multi_date' THEN v_dates ELSE NULL END;
  END IF;

  IF v_event.status='draft' THEN
    v_requested_visibility:=public.business_assert_event_visibility(
      v_event.theme#>'{business_draft,requestedVisibility}'
    );
  ELSIF v_event.visibility='public' THEN
    v_requested_visibility:='public';
  ELSIF v_event.visibility='hidden' THEN
    v_requested_visibility:='unlisted';
  ELSIF v_event.visibility='private' THEN
    v_requested_visibility:='private';
  ELSE
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;

  v_business := COALESCE(v_event.theme->'business_draft', v_event.theme->'business_event', '{}'::jsonb)
    || jsonb_build_object(
      'schemaVersion', 1,
      'legacyLocalDraftId', NULL,
      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,
      'partyTypes', to_jsonb(COALESCE(v_event.party_types, ARRAY[]::text[])),
      'vibeTags', to_jsonb(COALESCE(v_event.vibe_tags, ARRAY[]::text[])),
      'musicGenres', to_jsonb(COALESCE(v_event.music_genres, ARRAY[]::text[])),
      'city', v_event.city,
      'locationGeo', CASE WHEN v_event.location_geo IS NULL THEN NULL ELSE
        jsonb_build_object('lng', (v_event.location_geo)[0], 'lat', (v_event.location_geo)[1]) END,
      'requestedVisibility', v_requested_visibility,
      'coverHue', COALESCE((v_event.theme->>'coverHue')::numeric, 25),
      'coverProvider', jsonb_build_object(
        'provider', v_event.cover_media_provider,
        'sourceUrl', v_event.cover_media_source_url,
        'credit', v_event.cover_media_credit,
        'creditUrl', v_event.cover_media_credit_url,
        'alt', v_event.cover_media_alt),
      'currency', btrim(v_event.currency::text),
      'whenMode', v_when_mode,
      'when', v_when,
      'recurrenceRule', CASE WHEN v_event.status='draft'
        THEN v_event.theme#>'{business_draft,recurrenceRule}'
        ELSE v_event.recurrence_rules END,
      'multiDates', v_multi,
      'location', CASE WHEN v_event.status='draft' THEN
        COALESCE(v_event.theme#>'{business_draft,location}',
          jsonb_build_object('venueName',v_event.location_text,'address',NULL))
        ELSE jsonb_build_object('venueName',v_event.location_text,'address',NULL) END,
      'tickets', v_tickets,
      'lastStepReached', 6,
      'clientRevision', COALESCE(
        (v_event.theme#>>'{business_draft,clientRevision}')::integer,
        (v_event.theme#>>'{business_event,clientRevision}')::integer,0)
    );

  RETURN to_jsonb(v_event) || jsonb_build_object(
    'theme', (COALESCE(v_event.theme, '{}'::jsonb) - 'business_event' - 'business_draft')
      || jsonb_build_object('business_draft', v_business),
    'visibility', 'draft', 'status', 'draft'
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.business_event_draft_payload_from_graph(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_draft_payload_from_graph(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.business_list_events_for_ari(uuid[],integer);
CREATE OR REPLACE FUNCTION public.business_list_events_for_ari(
  p_brand_ids uuid[],
  p_limit integer DEFAULT 20,
  p_upcoming_only boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT COALESCE(jsonb_agg(row_payload ORDER BY updated_at DESC),'[]'::jsonb)
  FROM (
    SELECT e.updated_at, jsonb_build_object(
      'id',e.id,'brand_id',e.brand_id,'event_type',e.event_type,'title',e.title,
      'status',e.status,'visibility',e.visibility,'timezone',e.timezone,'city',e.city,
      'location_text',e.location_text,'is_online',e.is_online,'online_url',e.online_url,
      'cover',jsonb_build_object('url',e.cover_media_url,'poster_url',e.cover_media_poster_url,'type',e.cover_media_type),
      'when',CASE WHEN e.status='draft' THEN COALESCE(e.theme#>'{business_draft,when}','null'::jsonb)
        ELSE dates.rows END,
      'when_mode',CASE WHEN e.status='draft' THEN COALESCE(e.theme#>>'{business_draft,whenMode}','single')
        WHEN e.is_multi_date THEN 'multi_date' WHEN e.is_recurring THEN 'recurring' ELSE 'single' END,
      'tickets',jsonb_build_object('count',tickets.tier_count,'capacity',tickets.capacity,'free',tickets.all_free),
      'client_revision',COALESCE((e.theme#>>'{business_draft,clientRevision}')::integer,
        (e.theme#>>'{business_event,clientRevision}')::integer,0),
      'updated_at',e.updated_at
    ) AS row_payload
    FROM public.events e
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('start_at',ed.start_at,'end_at',ed.end_at,'is_master',ed.is_master) ORDER BY ed.start_at),'[]'::jsonb) rows
      FROM public.event_dates ed WHERE ed.event_id=e.id
    ) dates ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer tier_count,
        sum(ticket_summary.capacity)::integer capacity,
        bool_and(ticket_summary.is_free) all_free
      FROM (
        SELECT NULLIF(draft_ticket->>'capacity','')::integer capacity,
          COALESCE((draft_ticket->>'isFree')::boolean,
            COALESCE((draft_ticket->>'priceGbp')::numeric,0)=0) is_free
        FROM jsonb_array_elements(
          CASE WHEN e.status='draft'
            THEN COALESCE(e.theme#>'{business_draft,tickets}','[]'::jsonb)
            ELSE '[]'::jsonb END
        ) draft_ticket
        UNION ALL
        SELECT tt.quantity_total,tt.is_free
        FROM public.ticket_types tt
        WHERE e.status<>'draft' AND tt.event_id=e.id AND tt.deleted_at IS NULL
      ) ticket_summary
    ) tickets ON true
    WHERE e.brand_id=ANY(COALESCE(p_brand_ids,ARRAY[]::uuid[])) AND e.event_type='event' AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('scanner')
      AND (NOT COALESCE(p_upcoming_only,false) OR e.status='draft' OR EXISTS(
        SELECT 1 FROM public.event_dates upcoming
        WHERE upcoming.event_id=e.id AND upcoming.end_at>now()
      ))
    ORDER BY e.updated_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50)
  ) scoped;
$fn$;
REVOKE ALL ON FUNCTION public.business_list_events_for_ari(uuid[],integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_list_events_for_ari(uuid[],integer,boolean) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Canonical manual + Ari draft owners.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_create_event_draft(
  p_brand_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_title text;
  v_slug text;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  v_title := COALESCE(NULLIF(btrim(p_payload->>'title'), ''), 'Untitled draft');
  v_slug := 'draft-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN
    v_geo := (p_payload->>'location_geo')::point;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    NULLIF(p_payload->>'cover_media_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_poster_url',''));

  INSERT INTO public.events(
    brand_id, created_by, event_type, title, slug, description, location_text,
    online_url, cover_media_url, cover_media_poster_url, cover_media_type,
    cover_media_provider, cover_media_source_url, cover_media_credit,
    cover_media_credit_url, cover_media_alt, cover_media_gallery, currency,
    is_online, is_recurring, is_multi_date, recurrence_rules, theme,
    visibility, status, timezone, party_types, vibe_tags, music_genres, city,
    location_geo, pass_tax, pass_mingla_fee, pass_service_fee,
    theme_color_override, theme_font_override, theme_animation_override
  ) VALUES (
    p_brand_id, v_uid, 'event', v_title, v_slug,
    NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'location_text',''),
    NULLIF(p_payload->>'online_url',''), NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_poster_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''), NULLIF(p_payload->>'cover_media_source_url',''),
    NULLIF(p_payload->>'cover_media_credit',''), NULLIF(p_payload->>'cover_media_credit_url',''),
    NULLIF(p_payload->>'cover_media_alt',''), COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    NULLIF(p_payload->>'currency','')::character(3), COALESCE((p_payload->>'is_online')::boolean,false),
    COALESCE((p_payload->>'is_recurring')::boolean,false), COALESCE((p_payload->>'is_multi_date')::boolean,false),
    p_payload->'recurrence_rules', COALESCE(p_payload->'theme','{}'::jsonb), 'draft', 'draft',
    COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    NULLIF(p_payload->>'city',''), v_geo,
    (p_payload->>'pass_tax')::boolean, (p_payload->>'pass_mingla_fee')::boolean,
    (p_payload->>'pass_service_fee')::boolean, NULLIF(p_payload->>'theme_color_override',''),
    NULLIF(p_payload->>'theme_font_override',''), NULLIF(p_payload->>'theme_animation_override','')
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object('event', to_jsonb(v_event), 'client_revision',
    COALESCE((p_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.business_update_event_draft(
  p_event_id uuid,
  p_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_stored_revision integer;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'event_draft_not_editable'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  v_stored_revision := COALESCE((v_event.theme#>>'{business_draft,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision <> v_stored_revision + 1 THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN v_geo := (p_payload->>'location_geo')::point; END IF;
  PERFORM public.assert_cover_media_triplet(NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_type',''),NULLIF(p_payload->>'cover_media_poster_url',''));

  UPDATE public.events SET
    title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),'Untitled draft'),
    description=NULLIF(p_payload->>'description',''), location_text=NULLIF(p_payload->>'location_text',''),
    online_url=NULLIF(p_payload->>'online_url',''), cover_media_url=NULLIF(p_payload->>'cover_media_url',''),
    cover_media_poster_url=NULLIF(p_payload->>'cover_media_poster_url',''), cover_media_type=NULLIF(p_payload->>'cover_media_type',''),
    cover_media_provider=NULLIF(p_payload->>'cover_media_provider',''), cover_media_source_url=NULLIF(p_payload->>'cover_media_source_url',''),
    cover_media_credit=NULLIF(p_payload->>'cover_media_credit',''), cover_media_credit_url=NULLIF(p_payload->>'cover_media_credit_url',''),
    cover_media_alt=NULLIF(p_payload->>'cover_media_alt',''), cover_media_gallery=COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    currency=NULLIF(p_payload->>'currency','')::character(3), is_online=COALESCE((p_payload->>'is_online')::boolean,false),
    is_recurring=COALESCE((p_payload->>'is_recurring')::boolean,false), is_multi_date=COALESCE((p_payload->>'is_multi_date')::boolean,false),
    recurrence_rules=p_payload->'recurrence_rules',
    theme=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),
      '{business_draft,clientRevision}',to_jsonb(p_client_revision),true),
    visibility='draft', status='draft', timezone=COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    party_types=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    vibe_tags=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    music_genres=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    city=NULLIF(p_payload->>'city',''), location_geo=v_geo,
    pass_tax=(p_payload->>'pass_tax')::boolean, pass_mingla_fee=(p_payload->>'pass_mingla_fee')::boolean,
    pass_service_fee=(p_payload->>'pass_service_fee')::boolean,
    theme_color_override=NULLIF(p_payload->>'theme_color_override',''), theme_font_override=NULLIF(p_payload->>'theme_font_override',''),
    theme_animation_override=NULLIF(p_payload->>'theme_animation_override',''), updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    p_client_revision);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_create_event_draft(uuid,jsonb),
  public.business_update_event_draft(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_create_event_draft(uuid,jsonb),
  public.business_update_event_draft(uuid,jsonb,integer) TO authenticated, service_role;

-- Core leaf mutation used inside the one transactional live-event owner below.
-- It retains ticket/settings/privacy validation and the single revision gate;
-- Business and Ari must call business_update_live_event_atomic instead.
CREATE OR REPLACE FUNCTION public.business_update_live_event(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_event public.events%ROWTYPE;
  v_ticket jsonb;
  v_ticket_id uuid;
  v_sold integer;
  v_seen uuid[]:=ARRAY[]::uuid[];
  v_settings jsonb;
  v_tickets jsonb;
  v_stored_revision integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status NOT IN('scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_stored_revision:=COALESCE((v_event.theme#>>'{business_event,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision<>v_stored_revision+1 THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;

  v_settings:=COALESCE(v_event.theme#>'{business_event,settings}','{}'::jsonb);
  IF p_patch ? 'hideAddressUntilTicket' THEN v_settings:=jsonb_set(v_settings,'{hideAddressUntilTicket}',p_patch->'hideAddressUntilTicket',true);END IF;
  IF p_patch ? 'requireApproval' THEN v_settings:=jsonb_set(v_settings,'{requireApproval}',p_patch->'requireApproval',true);END IF;
  IF p_patch ? 'allowTransfers' THEN v_settings:=jsonb_set(v_settings,'{allowTransfers}',p_patch->'allowTransfers',true);END IF;
  IF p_patch ? 'passwordProtected' THEN v_settings:=jsonb_set(v_settings,'{passwordProtected}',p_patch->'passwordProtected',true);END IF;
  IF p_patch ? 'inPersonPaymentsEnabled' THEN v_settings:=jsonb_set(v_settings,'{inPersonPaymentsEnabled}',p_patch->'inPersonPaymentsEnabled',true);END IF;

  UPDATE public.events SET
    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,
    description=CASE WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description','') ELSE description END,
    location_text=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') WHEN p_patch ? 'venueName' THEN NULLIF(p_patch->>'venueName','') ELSE location_text END,
    online_url=CASE WHEN p_patch ? 'onlineUrl' THEN NULLIF(p_patch->>'onlineUrl','') ELSE online_url END,
    is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END,
    visibility=CASE WHEN p_patch ? 'visibility' THEN CASE p_patch->>'visibility' WHEN 'unlisted' THEN 'hidden' WHEN 'private' THEN 'private' ELSE 'public' END ELSE visibility END,
    theme=jsonb_set(
      jsonb_set(
        jsonb_set(COALESCE(theme,'{}'::jsonb),'{business_event,settings}',v_settings,true),
        '{business_event,clientRevision}',to_jsonb(p_client_revision),true),
      '{coverHue}',COALESCE(p_patch->'coverHue',theme->'coverHue','25'::jsonb),true),
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;

  IF p_patch ? 'tickets' THEN
    IF jsonb_typeof(p_patch->'tickets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'tickets')=0 THEN RAISE EXCEPTION 'event_ticket_required';END IF;
    FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_patch->'tickets') LOOP
      v_ticket_id:=CASE WHEN COALESCE(v_ticket->>'id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (v_ticket->>'id')::uuid ELSE gen_random_uuid() END;
      SELECT count(*) INTO v_sold FROM public.tickets WHERE ticket_type_id=v_ticket_id AND status NOT IN('void','refunded');
      IF EXISTS(SELECT 1 FROM public.ticket_types WHERE id=v_ticket_id AND event_id=p_event_id AND deleted_at IS NULL) THEN
        IF v_sold>0 AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.id=v_ticket_id AND (tt.price_cents IS DISTINCT FROM round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer OR COALESCE((v_ticket->>'capacity')::integer,tt.quantity_total)<v_sold)) THEN RAISE EXCEPTION 'ticket_change_with_sales';END IF;
        UPDATE public.ticket_types SET
          name=COALESCE(NULLIF(btrim(v_ticket->>'name'),''),name), description=NULLIF(v_ticket->>'description',''),
          price_cents=round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,
          quantity_total=CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          is_unlimited=COALESCE((v_ticket->>'isUnlimited')::boolean,false),is_free=COALESCE((v_ticket->>'isFree')::boolean,false),
          is_hidden=COALESCE(v_ticket->>'visibility','public')='hidden',is_disabled=COALESCE(v_ticket->>'visibility','public')='disabled',
          requires_approval=COALESCE((v_ticket->>'approvalRequired')::boolean,false),allow_transfers=COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          password_protected=COALESCE((v_ticket->>'passwordProtected')::boolean,false),waitlist_enabled=COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          min_purchase_qty=COALESCE((v_ticket->>'minPurchaseQty')::integer,1),max_purchase_qty=NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          sale_start_at=NULLIF(v_ticket->>'saleStartAt','')::timestamptz,sale_end_at=NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          available_online=COALESCE(v_ticket->>'availableAt','both') IN('online','both'),available_in_person=COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          display_order=COALESCE((v_ticket->>'displayOrder')::integer,0),updated_at=now()
        WHERE id=v_ticket_id;
      ELSE
        INSERT INTO public.ticket_types(id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,waitlist_enabled,min_purchase_qty,max_purchase_qty,sale_start_at,sale_end_at,
          available_online,available_in_person,display_order)
        VALUES(v_ticket_id,p_event_id,COALESCE(NULLIF(btrim(v_ticket->>'name'),''),'Ticket'),NULLIF(v_ticket->>'description',''),
          round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,v_event.currency,
          CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          COALESCE((v_ticket->>'isUnlimited')::boolean,false),COALESCE((v_ticket->>'isFree')::boolean,false),
          COALESCE(v_ticket->>'visibility','public')='hidden',COALESCE(v_ticket->>'visibility','public')='disabled',
          COALESCE((v_ticket->>'approvalRequired')::boolean,false),COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          COALESCE((v_ticket->>'passwordProtected')::boolean,false),COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          COALESCE((v_ticket->>'minPurchaseQty')::integer,1),NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          NULLIF(v_ticket->>'saleStartAt','')::timestamptz,NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          COALESCE(v_ticket->>'availableAt','both') IN('online','both'),COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          COALESCE((v_ticket->>'displayOrder')::integer,0));
      END IF;
      v_seen:=array_append(v_seen,v_ticket_id);
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.ticket_types tt JOIN public.tickets t ON t.ticket_type_id=tt.id WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL AND NOT(tt.id=ANY(v_seen)) AND t.status NOT IN('void','refunded')) THEN RAISE EXCEPTION 'ticket_delete_with_sales';END IF;
    UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE event_id=p_event_id AND deleted_at IS NULL AND NOT(id=ANY(v_seen));
  END IF;

  IF p_patch ? 'privateGuestList' OR p_patch ? 'hideRemainingCount' THEN
    PERFORM public.biz_set_event_guest_privacy(p_event_id,
      COALESCE((p_patch->>'privateGuestList')::boolean,(v_settings->>'privateGuestList')::boolean,false),
      COALESCE((p_patch->>'hideRemainingCount')::boolean,(v_settings->>'hideRemainingCount')::boolean,false));
    SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb) INTO v_tickets FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'tickets',v_tickets,'client_revision',p_client_revision);
END;$fn$;
REVOKE ALL ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Unpublish / duplicate / cover owners.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_unpublish_event_to_draft(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;v_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status<>'scheduled' THEN RAISE EXCEPTION 'event_not_unpublishable';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  -- Lock the complete schedule before deciding whether the public lifecycle can
  -- move backwards. Any started first occurrence makes the event immutable.
  PERFORM 1 FROM public.event_dates WHERE event_id=p_event_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=p_event_id)
     OR (SELECT min(start_at) FROM public.event_dates WHERE event_id=p_event_id)<=now()
  THEN RAISE EXCEPTION 'event_unpublish_not_future';END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.scan_events WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvps WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id=g.rsvp_id WHERE r.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvp_contributions WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.waitlist_entries WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.attendance_claim_deliveries WHERE event_id=p_event_id)
  THEN RAISE EXCEPTION 'event_unpublish_has_commitments';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  PERFORM set_config('mingla.business_publish_event_draft','on',true);
  UPDATE public.events SET status='draft',visibility='draft',published_at=NULL,
    show_on_discover=false,show_in_swipeable_deck=false,theme=v_payload->'theme',updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  DELETE FROM public.event_dates WHERE event_id=p_event_id;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    COALESCE((v_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_duplicate_event_as_draft(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_src public.events%ROWTYPE;v_new public.events%ROWTYPE;v_payload jsonb;v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_src FROM public.events WHERE id=p_event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_src.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_src.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  v_title:=left(v_src.title||' (copy)',120);
  INSERT INTO public.events(brand_id,created_by,event_type,title,slug,description,location_text,location_geo,online_url,is_online,
    is_recurring,is_multi_date,recurrence_rules,cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,cover_media_gallery,theme,currency,
    visibility,status,timezone,party_types,vibe_tags,music_genres,city,pass_tax,pass_mingla_fee,pass_service_fee,
    theme_color_override,theme_font_override,theme_animation_override)
  VALUES(v_src.brand_id,v_uid,'event',v_title,'draft-'||substr(replace(gen_random_uuid()::text,'-',''),1,16),v_src.description,
    v_src.location_text,v_src.location_geo,v_src.online_url,v_src.is_online,v_src.is_recurring,v_src.is_multi_date,v_src.recurrence_rules,
    v_src.cover_media_url,v_src.cover_media_poster_url,v_src.cover_media_type,v_src.cover_media_provider,v_src.cover_media_source_url,
    v_src.cover_media_credit,v_src.cover_media_credit_url,v_src.cover_media_alt,v_src.cover_media_gallery,
    jsonb_set(v_payload->'theme','{business_draft,clientRevision}','0'::jsonb,true),v_src.currency,'draft','draft',v_src.timezone,
    v_src.party_types,v_src.vibe_tags,v_src.music_genres,v_src.city,v_src.pass_tax,v_src.pass_mingla_fee,v_src.pass_service_fee,
    v_src.theme_color_override,v_src.theme_font_override,v_src.theme_animation_override)
  RETURNING * INTO v_new;
  RETURN jsonb_build_object('event',to_jsonb(v_new),'client_revision',0);
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_set_event_cover_media(
  p_event_id uuid,p_selection_ref text,p_url text,p_type text,p_poster_url text,
  p_provider text DEFAULT NULL,p_source_url text DEFAULT NULL,p_credit text DEFAULT NULL,
  p_credit_url text DEFAULT NULL,p_alt text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;v_selection public.event_cover_selections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF p_selection_ref IS NULL THEN RAISE EXCEPTION 'cover_selection_required';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  SELECT * INTO v_selection FROM public.event_cover_selections
  WHERE selection_ref=p_selection_ref AND user_id=v_uid AND event_id=p_event_id
    AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND OR v_selection.media_url IS DISTINCT FROM NULLIF(p_url,'')
    OR v_selection.media_type IS DISTINCT FROM NULLIF(p_type,'')
    OR v_selection.poster_url IS DISTINCT FROM NULLIF(p_poster_url,'')
    OR v_selection.provider IS DISTINCT FROM NULLIF(p_provider,'')
    OR v_selection.source_url IS DISTINCT FROM NULLIF(p_source_url,'')
    OR v_selection.credit IS DISTINCT FROM NULLIF(p_credit,'')
    OR v_selection.credit_url IS DISTINCT FROM NULLIF(p_credit_url,'')
    OR v_selection.alt IS DISTINCT FROM NULLIF(p_alt,'')
  THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
  PERFORM public.assert_cover_media_triplet(NULLIF(p_url,''),NULLIF(p_type,''),NULLIF(p_poster_url,''));
  UPDATE public.events SET cover_media_url=NULLIF(p_url,''),cover_media_type=NULLIF(p_type,''),
    cover_media_poster_url=NULLIF(p_poster_url,''),cover_media_provider=NULLIF(p_provider,''),
    cover_media_source_url=NULLIF(p_source_url,''),cover_media_credit=NULLIF(p_credit,''),
    cover_media_credit_url=NULLIF(p_credit_url,''),cover_media_alt=NULLIF(p_alt,''),updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  UPDATE public.event_cover_selections SET consumed_at=now() WHERE selection_ref=p_selection_ref;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'selection_ref',p_selection_ref);
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_clear_event_cover_media(
  p_event_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  UPDATE public.events SET
    cover_media_url=NULL,cover_media_type=NULL,cover_media_poster_url=NULL,
    cover_media_provider=NULL,cover_media_source_url=NULL,cover_media_credit=NULL,
    cover_media_credit_url=NULL,cover_media_alt=NULL,cover_media_gallery='[]'::jsonb,
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'cleared',true);
END;$fn$;

REVOKE ALL ON FUNCTION public.business_unpublish_event_to_draft(uuid),
  public.business_duplicate_event_as_draft(uuid),
  public.business_set_event_cover_media(uuid,text,text,text,text,text,text,text,text,text),
  public.business_clear_event_cover_media(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_unpublish_event_to_draft(uuid),
  public.business_duplicate_event_as_draft(uuid),
  public.business_set_event_cover_media(uuid,text,text,text,text,text,text,text,text,text),
  public.business_clear_event_cover_media(uuid) TO authenticated,service_role;

-- Resolve a user-entered local wall clock without allowing PostgreSQL to
-- silently normalize a daylight-saving gap or choose one side of an ambiguous
-- fall-back hour. Every caller gets the same stable rejection code.
CREATE OR REPLACE FUNCTION public.business_resolve_event_local_datetime(
  p_date text,p_time text,p_timezone text
) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog,pg_temp AS $fn$
DECLARE
  v_local timestamp;
  v_resolved timestamptz;
  v_offset_before interval;
  v_offset_after interval;
  v_shift interval;
BEGIN
  IF NULLIF(btrim(COALESCE(p_date,'')),'') IS NULL
     OR NULLIF(btrim(COALESCE(p_time,'')),'') IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'event_timezone_invalid';
  END IF;
  v_local:=(p_date||' '||p_time)::timestamp;
  v_resolved:=v_local AT TIME ZONE p_timezone;
  IF (v_resolved AT TIME ZONE p_timezone) IS DISTINCT FROM v_local THEN
    RAISE EXCEPTION 'event_date_dst_invalid';
  END IF;
  v_offset_before:=(v_local-interval '12 hours')-
    (((v_local-interval '12 hours') AT TIME ZONE p_timezone) AT TIME ZONE 'UTC');
  v_offset_after:=(v_local+interval '12 hours')-
    (((v_local+interval '12 hours') AT TIME ZONE p_timezone) AT TIME ZONE 'UTC');
  v_shift:=make_interval(secs=>abs(extract(epoch FROM v_offset_after-v_offset_before))::double precision);
  IF v_shift<>interval '0 seconds' AND (
    ((v_resolved-v_shift) AT TIME ZONE p_timezone)=v_local OR
    ((v_resolved+v_shift) AT TIME ZONE p_timezone)=v_local
  ) THEN
    RAISE EXCEPTION 'event_date_dst_invalid';
  END IF;
  RETURN v_resolved;
END;$fn$;
REVOKE ALL ON FUNCTION public.business_resolve_event_local_datetime(text,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_resolve_event_local_datetime(text,text,text)
  TO authenticated,service_role;

-- The Business editor and Ari share this one transactional live-event owner.
-- Existing domain functions retain their validation logic, but every sub-write
-- now occurs inside this function's transaction and one exact revision gate.
CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(
  p_event_id uuid,p_patch jsonb,p_reason text,p_client_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
BEGIN
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;

  -- This call owns auth, event/status/role validation, the row lock, ticket
  -- protections, settings/privacy merge, and the single revision increment.
  PERFORM public.business_update_live_event(
    p_event_id,v_core,p_reason,p_client_revision
  );

  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision','')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,p_reason,p_client_revision
    );
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    UPDATE public.events SET
      pass_tax=NULLIF(p_patch#>>'{pricing,passTax}','')::boolean,
      pass_mingla_fee=NULLIF(p_patch#>>'{pricing,passMinglaFee}','')::boolean,
      pass_service_fee=NULLIF(p_patch#>>'{pricing,passServiceFee}','')::boolean,
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),'tickets',v_tickets,
    'client_revision',p_client_revision
  );
END;$fn$;
REVOKE ALL ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_update_live_event_atomic(uuid,jsonb,text,integer)
  TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. Every cancelled transition opens the refund run in the same transaction.
--    The trigger covers Business, Ari, admin, and any future canonical writer;
--    the edge fan-out remains a latency optimisation over durable queued work.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_event_cancel_refund_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.cancel_event_refund_prepare(NEW.id,now());
  END IF;
  RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION public.prepare_event_cancel_refund_run() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_1972_prepare_event_cancel_refunds ON public.events;
CREATE TRIGGER issue_1972_prepare_event_cancel_refunds
AFTER UPDATE OF status ON public.events FOR EACH ROW
WHEN (NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.prepare_event_cancel_refund_run();

-- ---------------------------------------------------------------------------
-- 6. One transactional Ari event dispatcher: receipt + domain mutation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(
  p_operation_id uuid,p_tool_name text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_payload jsonb;
  v_business jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_revision integer;
  v_event_status text;
  v_when_mode text;
  v_multi_dates jsonb;
  v_recurrence_rule jsonb;
  v_date_item jsonb;
  v_date_index integer:=0;
  v_date_text text;
  v_start_text text;
  v_end_text text;
BEGIN
  IF p_tool_name NOT IN('create_event','update_event','publish_event','unpublish_event','cancel_event',
    'end_event_sales','duplicate_event','patch_event_when','set_event_cover','set_event_guest_privacy','discard_event_draft')
  THEN RAISE EXCEPTION 'unsupported_event_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_event' THEN
      PERFORM public.business_assert_event_visibility(p_args->'visibility');
      v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),'UTC');
      IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_timezone) THEN
        RAISE EXCEPTION 'event_timezone_invalid';
      END IF;
      v_when_mode:=COALESCE(NULLIF(p_args->>'when_mode',''),'single');
      IF v_when_mode NOT IN('single','multi_date','recurring') THEN
        RAISE EXCEPTION 'event_when_mode_invalid';
      END IF;
      v_recurrence_rule:=p_args->'recurrence_rule';
      v_multi_dates:=NULL;
      IF v_when_mode IN('single','recurring') THEN
        IF NULLIF(p_args->>'start_at','') IS NULL THEN RAISE EXCEPTION 'event_start_required';END IF;
        v_start:=(p_args->>'start_at')::timestamptz;
        v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
        IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
        IF v_when_mode='recurring' AND (
          jsonb_typeof(v_recurrence_rule) IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule->>'preset','') NOT IN(
            'daily','weekly','biweekly','monthly_dom','monthly_dow')
          OR jsonb_typeof(v_recurrence_rule->'termination') IS DISTINCT FROM 'object'
          OR COALESCE(v_recurrence_rule#>>'{termination,kind}','') NOT IN('count','until')
          OR (v_recurrence_rule#>>'{termination,kind}'='count' AND (
            COALESCE(v_recurrence_rule#>>'{termination,count}','') !~ '^[0-9]+$'
            OR (v_recurrence_rule#>>'{termination,count}')::integer NOT BETWEEN 1 AND 52))
          OR (v_recurrence_rule#>>'{termination,kind}'='until' AND (
            COALESCE(v_recurrence_rule#>>'{termination,until}','') !~ '^\d{4}-\d{2}-\d{2}$'
            OR (v_recurrence_rule#>>'{termination,until}')::date < (v_start AT TIME ZONE v_timezone)::date
            OR (v_recurrence_rule#>>'{termination,until}')::date > (v_start AT TIME ZONE v_timezone)::date+366))
          OR (v_recurrence_rule->>'preset' IN('weekly','biweekly','monthly_dow')
            AND COALESCE(v_recurrence_rule->>'byDay','') NOT IN('MO','TU','WE','TH','FR','SA','SU'))
          OR (v_recurrence_rule->>'preset'='monthly_dom' AND (
            COALESCE(v_recurrence_rule->>'byMonthDay','') !~ '^[0-9]+$'
            OR (v_recurrence_rule->>'byMonthDay')::integer NOT BETWEEN 1 AND 28))
          OR (v_recurrence_rule->>'preset'='monthly_dow' AND
            COALESCE(v_recurrence_rule->>'bySetPos','') NOT IN('1','2','3','4','-1'))
        ) THEN RAISE EXCEPTION 'event_recurrence_invalid';END IF;
      ELSE
        IF jsonb_typeof(p_args->'multi_dates') IS DISTINCT FROM 'array'
           OR jsonb_array_length(p_args->'multi_dates') NOT BETWEEN 2 AND 24 THEN
          RAISE EXCEPTION 'event_multi_dates_invalid';
        END IF;
        v_multi_dates:='[]'::jsonb;
        FOR v_date_item IN SELECT value FROM jsonb_array_elements(p_args->'multi_dates') LOOP
          v_date_index:=v_date_index+1;
          v_date_text:=NULLIF(v_date_item->>'date','');
          v_start_text:=NULLIF(v_date_item->>'start_time','');
          v_end_text:=NULLIF(v_date_item->>'end_time','');
          IF v_date_text IS NULL OR v_start_text IS NULL OR v_end_text IS NULL THEN
            RAISE EXCEPTION 'event_multi_date_fields_required';
          END IF;
          v_start:=public.business_resolve_event_local_datetime(
            v_date_text,v_start_text,v_timezone
          );
          v_end:=public.business_resolve_event_local_datetime(
            v_date_text,v_end_text,v_timezone
          );
          IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_multi_dates:=v_multi_dates||jsonb_build_array(jsonb_build_object(
            'id',COALESCE(NULLIF(v_date_item->>'id',''),'ari-'||v_date_index::text),
            'date',v_date_text,'startTime',v_start_text,'endTime',v_end_text,
            'overrides',COALESCE(v_date_item->'overrides','{}'::jsonb)));
        END LOOP;
        v_date_item:=v_multi_dates->0;
        v_start:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'startTime',v_timezone
        );
        v_end:=public.business_resolve_event_local_datetime(
          v_date_item->>'date',v_date_item->>'endTime',v_timezone
        );
        IF v_end<=v_start THEN v_end:=v_end+interval '1 day';END IF;
      END IF;
      v_business:=jsonb_build_object(
        'schemaVersion',1,'legacyLocalDraftId',NULL,
        'format',CASE WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online' ELSE 'in_person' END,
        'partyTypes',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibeTags',COALESCE(p_args->'vibe_tags','[]'::jsonb),
        'musicGenres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','locationGeo',NULL,
        'requestedVisibility',p_args->>'visibility',
        'coverHue',25,'coverProvider',jsonb_build_object(
          'provider',p_args->'cover_media_provider','sourceUrl',p_args->'cover_media_source_url',
          'credit',p_args->'cover_media_credit','creditUrl',p_args->'cover_media_credit_url','alt',p_args->'cover_media_alt'),
        'currency',p_args->'currency','whenMode',v_when_mode,
        'when',jsonb_build_object('date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
          'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
          'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),
        'recurrenceRule',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'multiDates',CASE WHEN v_when_mode='multi_date' THEN v_multi_dates ELSE NULL END,
        'location',jsonb_build_object('venueName',p_args->'location_text','address',NULL),
        'hideAddressUntilTicket',false,'tickets',COALESCE(p_args->'tickets','[]'::jsonb),
        'settings',jsonb_build_object('requireApproval',false,'allowTransfers',true,
          'hideRemainingCount',false,'passwordProtected',false,'privateGuestList',false,
          'inPersonPaymentsEnabled',false),
        'isRsvp',false,'rsvpCapacity',NULL,'rsvpAllowPlusOnes',false,'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,'rsvpApprovalMode','auto','rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,'lastStepReached',0,'clientRevision',0);
      v_payload:=jsonb_build_object(
        'title',p_args->>'title','description',p_args->'description','location_text',p_args->'location_text',
        'online_url',p_args->'online_url','is_online',COALESCE(p_args->'is_online','false'::jsonb),
        'is_recurring',v_when_mode='recurring','is_multi_date',v_when_mode='multi_date',
        'recurrence_rules',CASE WHEN v_when_mode='recurring' THEN v_recurrence_rule ELSE NULL END,
        'timezone',v_timezone,
        'cover_media_url',p_args->'cover_media_url','cover_media_type',p_args->'cover_media_type',
        'cover_media_poster_url',p_args->'cover_media_poster_url','cover_media_provider',p_args->'cover_media_provider',
        'cover_media_source_url',p_args->'cover_media_source_url','cover_media_credit',p_args->'cover_media_credit',
        'cover_media_credit_url',p_args->'cover_media_credit_url','cover_media_alt',p_args->'cover_media_alt',
        'currency',p_args->'currency','party_types',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibe_tags',COALESCE(p_args->'vibe_tags','[]'::jsonb),'music_genres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','theme',jsonb_build_object('coverHue',25,'business_draft',v_business));
      v_result:=public.business_create_event_draft((p_args->>'brand_id')::uuid,v_payload);
    WHEN 'update_event' THEN
      SELECT status INTO v_event_status FROM public.events WHERE id=v_event_id AND event_type='event' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
      IF v_event_status='draft' THEN
        v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
        v_business:=COALESCE(v_payload#>'{theme,business_draft}','{}'::jsonb);
        v_revision:=NULLIF(p_args->>'client_revision','')::integer;
        IF p_args ? 'title' THEN v_payload:=jsonb_set(v_payload,'{title}',p_args->'title',true);END IF;
        IF p_args ? 'description' THEN v_payload:=jsonb_set(v_payload,'{description}',p_args->'description',true);END IF;
        IF p_args ? 'location_text' THEN
          v_payload:=jsonb_set(v_payload,'{location_text}',p_args->'location_text',true);
          v_business:=jsonb_set(v_business,'{location,venueName}',p_args->'location_text',true);
        END IF;
        IF p_args ? 'is_online' THEN v_payload:=jsonb_set(v_payload,'{is_online}',p_args->'is_online',true);END IF;
        IF p_args ? 'online_url' THEN v_payload:=jsonb_set(v_payload,'{online_url}',p_args->'online_url',true);END IF;
        IF p_args ? 'visibility' THEN
          PERFORM public.business_assert_event_visibility(p_args->'visibility');
          v_business:=jsonb_set(v_business,'{requestedVisibility}',p_args->'visibility',true);
        END IF;
        IF p_args ? 'start_at' THEN
          v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),v_payload->>'timezone','UTC');
          v_start:=(p_args->>'start_at')::timestamptz;
          v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_business:=jsonb_set(v_business,'{whenMode}','"single"'::jsonb,true);
          v_business:=jsonb_set(v_business,'{when}',jsonb_build_object(
            'date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
            'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
            'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),true);
          v_payload:=jsonb_set(v_payload,'{timezone}',to_jsonb(v_timezone),true);
        END IF;
        v_business:=jsonb_set(v_business,'{clientRevision}',to_jsonb(v_revision),true);
        v_payload:=jsonb_set(v_payload,'{theme,business_draft}',v_business,true);
        v_result:=public.business_update_event_draft(v_event_id,v_payload,v_revision);
      ELSE
        IF p_args ? 'start_at' OR p_args ? 'end_at' OR p_args ? 'timezone' THEN RAISE EXCEPTION 'live_schedule_requires_patch_event_when';END IF;
        v_business:='{}'::jsonb;
        IF p_args ? 'title' THEN v_business:=v_business||jsonb_build_object('name',p_args->'title');END IF;
        IF p_args ? 'description' THEN v_business:=v_business||jsonb_build_object('description',p_args->'description');END IF;
        IF p_args ? 'location_text' THEN v_business:=v_business||jsonb_build_object('address',p_args->'location_text');END IF;
        IF p_args ? 'online_url' THEN v_business:=v_business||jsonb_build_object('onlineUrl',p_args->'online_url');END IF;
        IF p_args ? 'is_online' THEN v_business:=v_business||jsonb_build_object('format',CASE WHEN (p_args->>'is_online')::boolean THEN 'online' ELSE 'in_person' END);END IF;
        IF p_args ? 'visibility' THEN v_business:=v_business||jsonb_build_object('visibility',p_args->'visibility');END IF;
        v_result:=public.business_update_live_event_atomic(
          v_event_id,jsonb_build_object('core',v_business),p_args->>'reason',
          NULLIF(p_args->>'client_revision','')::integer
        );
      END IF;
    WHEN 'publish_event' THEN
      v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
      IF p_args ? 'visibility' THEN
        PERFORM public.business_assert_event_visibility(p_args->'visibility');
        v_payload:=jsonb_set(v_payload,'{visibility}',p_args->'visibility',true);
        v_payload:=jsonb_set(
          v_payload,'{theme,business_draft,requestedVisibility}',
          p_args->'visibility',true
        );
      END IF;
      v_result:=public.issue_1719_publish_event_with_poster(v_event_id,v_payload,
        COALESCE(NULLIF(p_args->>'client_revision','')::integer,(v_payload#>>'{theme,business_draft,clientRevision}')::integer));
    WHEN 'unpublish_event' THEN v_result:=public.business_unpublish_event_to_draft(v_event_id);
    WHEN 'cancel_event' THEN v_result:=public.business_cancel_event(v_event_id);
    WHEN 'end_event_sales' THEN v_result:=public.business_end_event_ticket_sales(v_event_id);
    WHEN 'duplicate_event' THEN v_result:=public.business_duplicate_event_as_draft(v_event_id);
    WHEN 'patch_event_when' THEN
      v_result:=public.business_update_live_event_atomic(
        v_event_id,
        jsonb_build_object('core','{}'::jsonb,'when',p_args->'when_payload'),
        p_args->>'reason',
        NULLIF(p_args->>'client_revision','')::integer
      );
    WHEN 'set_event_cover' THEN
      IF COALESCE((p_args->>'clear_cover')::boolean,false) THEN
        v_result:=public.business_clear_event_cover_media(v_event_id);
      ELSE
        v_result:=public.business_set_event_cover_media(v_event_id,p_args->>'selection_ref',
          p_args->>'cover_media_url',p_args->>'cover_media_type',p_args->>'cover_media_poster_url',p_args->>'cover_media_provider',
          p_args->>'cover_media_source_url',p_args->>'cover_media_credit',p_args->>'cover_media_credit_url',p_args->>'cover_media_alt');
      END IF;
    WHEN 'set_event_guest_privacy' THEN v_result:=public.biz_set_event_guest_privacy(v_event_id,
      (p_args->>'private_guest_list')::boolean,(p_args->>'hide_remaining_count')::boolean);
    WHEN 'discard_event_draft' THEN v_result:=public.business_discard_event_draft(v_event_id);
  END CASE;
  RETURN public.agent_operation_receipt_complete(p_operation_id,p_tool_name,p_args,v_result);
END;$fn$;

REVOKE ALL ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) TO authenticated,service_role;

-- The historical patch-when function was accidentally executable by anon in
-- deployed schema. Restate the intended grants for all lifecycle owners.
REVOKE EXECUTE ON FUNCTION public.business_patch_event_when(uuid,jsonb,text,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.business_patch_event_taxonomy(
  uuid,text,text[],text[],text[],numeric,numeric,text,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_patch_event_when(uuid,jsonb,text,integer),
  public.business_patch_event_taxonomy(
    uuid,text,text[],text[],text[],numeric,numeric,text,text
  ) TO service_role;

COMMENT ON TABLE public.agent_operation_receipts IS '#1972 shared exactly-once receipt; result commits atomically with its domain mutation.';
COMMENT ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) IS '#1972 canonical confirmed event dispatcher; pending action id is the operation id.';

COMMIT;
NOTIFY pgrst, 'reload schema';
