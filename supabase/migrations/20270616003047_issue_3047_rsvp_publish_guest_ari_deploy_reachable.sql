-- #3047 — make the REST of the #1977 RSVP surface reachable by `supabase db push`.
--
-- WHAT IS BROKEN IN PRODUCTION
-- Seven routines authored in
-- `20270530001977_issue_1977_ari_rsvp_guest_contribution.sql` do not exist on
-- `gqnoajqerqhnvulmnyvv`. Three of them have LIVE shipped callers:
--
--   business_publish_rsvp_graph      mingla-business/src/services/rsvpEvents.ts
--     → PROVEN broken. Driving an RSVP draft to Preview (6/6) → Publish RSVP →
--       Publish on a real iOS Simulator against the shipped production build
--       produced, twice:
--         POST | 404 | .../rest/v1/rpc/business_publish_rsvp_graph
--       and the row stayed status='draft'. NOBODY can publish an RSVP event.
--
--   business_set_rsvp_guest_status   guestRosterService.ts, rsvpApprovals.ts ×2
--     → approving or declining a guest.
--
--   ari_execute_rsvp_operation       supabase/functions/_shared/agentDomainTools.ts
--     → every RSVP action Ari can take.
--
-- The remaining four (business_list_rsvp_roster, business_list_rsvp_contributions,
-- issue_1977_agent_rsvp_payload, issue_1977_current_rsvp_publish_payload) have no
-- shipped caller today, but they ship here rather than being left behind as a
-- second stranded set. issue_1977_current_rsvp_publish_payload is a hard
-- dependency of business_publish_rsvp_graph, so it MUST be in this same file.
--
-- WHY THE SOURCE MIGRATION CANNOT DELIVER THEM (do not re-litigate)
--   1. `20270530001977` is VERSION-SHADOWED. It was added to git on 2026-08-31,
--      by which time 23 migrations with higher versions were already applied.
--      Its version sorts below the remote head, so `supabase db push` skips it
--      permanently. It is not pending — it is unreachable.
--   2. `--include-all` does not rescue it. It would also sweep in the unrelated
--      unapplied 20270529002060 / 20270610002060 (the COMMS-0160 ordered-chain
--      hazard).
--   3. It would abort anyway. Its tail guard demands exactly 120 rows in
--      ari_cert_capability_requirements; production holds 132, and the
--      migration's own DELETE(1)+INSERT(1) keeps it at 132, so it raises
--      `issue_1977_expected_120_certification_requirements:132`.
--
-- WHAT THIS DOES
-- Re-publishes those seven routines at a version a plain `db push` reaches.
-- Every definition below is a VERBATIM copy of the #1977 source, so the two
-- migrations are order-independent: each statement is CREATE OR REPLACE, and
-- applying them in either order (or both) yields identical objects. There is no
-- competing second owner — this file adds no behaviour of its own.
--
-- DELIBERATELY NOT INCLUDED
--   * The entire `ari_cert_capability_requirements` block — that is the guard
--     that makes #1977 abort, and repairing it is #1977's own work, not this
--     issue's. Until it is resolved, every future change to that file needs the
--     same rescue treatment.
--   * `rsvp_domain_operation_receipts`, `issue_1977_rsvp_graph`,
--     `business_create_rsvp_draft_graph`, `business_update_rsvp_graph`,
--     `business_discard_rsvp_draft` — already published to production by
--     `20270615003044` (#3044). Re-declaring them here would add a third copy
--     of objects that are already correct.
--   * `biz_prepare_rsvp_contribution_refund`, `host_bulk_approve_rsvps`,
--     `host_set_rsvp_status`, `biz_guest_roster_set_rsvp_approval` — already
--     present in production from earlier applied migrations.
--
-- MONOTONIC VERSION 20270616003047 — strictly greater than the max local version
-- (20270614002987), the highest version applied to production (20270615003044,
-- applied 2026-09-02 for #3044), and the max version across all 54 sibling
-- worktrees under ~/Desktop/mingla-orchs/*/supabase/migrations/ (20270615003044,
-- in 3044-rsvp-draft-graph-rpc). No file with prefix 20270616 or suffix 003047
-- exists anywhere. Scanned per-worktree, not with a shallow `find -maxdepth 3`
-- (which returns zero results here because the migration dirs are one level
-- deeper, and would have read as "no collisions" for the wrong reason).
--
-- SELF-WRAPPED TRANSACTION. This file carries its own BEGIN;/COMMIT;. The
-- Management API `/database/query` endpoint does NOT wrap a multi-statement
-- body, so an unwrapped file applies NON-ATOMICALLY. Matches #3044's shipped
-- file, and this is the route the migration will actually take: the Supabase
-- CLI is drift-wedged (27 remote-only versions, `db push` refuses outright).
--
-- Dependencies these bodies call, verified present in production before writing:
--   biz_brand_effective_rank, biz_role_rank, business_publish_rsvp_draft,
--   issue_1977_rsvp_graph (#3044), rsvp_domain_operation_receipts (#3044),
--   business_create_rsvp_draft_graph / business_update_rsvp_graph (#3044),
--   biz_prepare_rsvp_contribution_refund, enqueue_rsvp_pass,
--   agent_operation_receipt_begin / agent_operation_receipt_complete,
--   extensions.digest (pgcrypto), and the guest_roster_change_events,
--   event_rsvps, event_rsvp_guests, event_rsvp_contributions, source_refunds,
--   rsvp_notifications, profiles tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1/7 — issue_1977_current_rsvp_publish_payload (verbatim, 20270530001977 L62-L90).
-- Hard dependency of business_publish_rsvp_graph below: publish reads the draft
-- through this projection, so shipping publish without it would 42883 at run
-- time instead of 404-ing at the gateway. Same file, by requirement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1977_current_rsvp_publish_payload(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v public.events%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.events
  WHERE id=p_event_id AND event_type='rsvp' AND status='draft' AND visibility='draft'
    AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id) THEN
    RAISE EXCEPTION 'rsvp_draft_graph_invalid';
  END IF;
  RETURN jsonb_build_object(
    'title',v.title,'description',v.description,'location_text',v.location_text,
    'online_url',v.online_url,'cover_media_url',v.cover_media_url,
    'cover_media_poster_url',v.cover_media_poster_url,'cover_media_type',v.cover_media_type,
    'cover_media_provider',v.cover_media_provider,'cover_media_source_url',v.cover_media_source_url,
    'cover_media_credit',v.cover_media_credit,'cover_media_credit_url',v.cover_media_credit_url,
    'cover_media_alt',v.cover_media_alt,'cover_media_gallery',COALESCE(v.cover_media_gallery,'[]'::jsonb),
    'currency',v.currency,'is_online',v.is_online,'timezone',v.timezone,'theme',v.theme
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2/7 — business_publish_rsvp_graph (verbatim, 20270530001977 L307-L343).
-- The 404 in this issue. `rsvpEvents.publishRsvpDraft` is its only caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_publish_rsvp_graph(
  p_event_id uuid,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_payload jsonb; v_result jsonb; v_hash text;
  v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_revision integer; v_event public.events%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp';
  IF NOT FOUND OR public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_publish:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='publish' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  v_payload:=public.issue_1977_current_rsvp_publish_payload(p_event_id);
  v_revision:=COALESCE((v_payload#>>'{theme,business_draft,clientRevision}')::integer,0);
  PERFORM public.business_publish_rsvp_draft(p_event_id,v_payload,v_revision);
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'publish',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3/7 — business_list_rsvp_roster (verbatim, 20270530001977 L380-L426).
-- No shipped caller today; shipped here so it is not left as a second stranded
-- set behind the same shadowed version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_list_rsvp_roster(
  p_event_id uuid,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_search text; v_watermark bigint; v_rows jsonb; v_summary jsonb;
  v_cursor_created timestamptz; v_cursor_id uuid; v_last jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'rsvp_roster_limit_invalid' USING ERRCODE='22023'; END IF;
  v_search:=lower(btrim(COALESCE(p_search,'')));
  IF length(v_search)>120 OR v_search~E'[\\x00-\\x1F\\x7F]' THEN RAISE EXCEPTION 'rsvp_roster_search_invalid' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_cursor IS NOT NULL THEN
    IF (p_cursor->>'watermark')::bigint<>v_watermark THEN RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='40001'; END IF;
    v_cursor_created:=(p_cursor->>'createdAt')::timestamptz; v_cursor_id:=(p_cursor->>'rsvpId')::uuid;
  END IF;
  WITH projected AS (
    SELECT r.id,r.created_at,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP') display_name,
      r.rsvp_status,r.approval_status,1+r.plus_count party_size,
      (r.checked_in_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)) checked_in
    FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
    WHERE r.event_id=p_event_id
      AND (v_search='' OR strpos(lower(COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP')),v_search)>0)
      AND (p_cursor IS NULL OR (r.created_at,r.id)>(v_cursor_created,v_cursor_id))
    ORDER BY r.created_at,r.id LIMIT p_limit
  ), safe_rows AS (
    SELECT jsonb_build_object('rosterKey','rsvp:'||id::text,'displayName',display_name,
      'attendanceStatus',rsvp_status,'approvalStatus',approval_status,'partySize',party_size,
      'checkedIn',checked_in,'canApprove',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','denied')),
      'canDeny',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','approved')),
      'createdAt',created_at) row_data FROM projected
  ) SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'createdAt',row_data->>'rosterKey'),'[]'::jsonb)
    INTO v_rows FROM safe_rows;
  SELECT jsonb_build_object('all',count(*),'pending',count(*) FILTER(WHERE approval_status='pending'),
    'goingPeople',COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0),
    'checkedIn',count(*) FILTER(WHERE checked_in_at IS NOT NULL),'watermark',v_watermark)
    INTO v_summary FROM public.event_rsvps WHERE event_id=p_event_id;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'summary',v_summary,'watermark',v_watermark,
    'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object(
      'createdAt',v_last->>'createdAt','rsvpId',substring(v_last->>'rosterKey' from 6),'watermark',v_watermark) ELSE NULL END);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4/7 — business_set_rsvp_guest_status (verbatim, 20270530001977 L428-L530).
-- Approve / decline a guest. Three shipped call sites: guestRosterService
-- setGuestRosterRsvpApproval, and rsvpApprovals setRsvpStatus + bulkApproveRsvps.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_set_rsvp_guest_status(
  p_event_id uuid,p_decision text,p_scope text,p_roster_keys text[] DEFAULT NULL,
  p_expected_watermark bigint DEFAULT NULL,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.events%ROWTYPE; v_ids uuid[]; v_id uuid; v_row public.event_rsvps%ROWTYPE;
  v_target text; v_confirmed integer; v_requested integer; v_free integer; v_applied integer:=0;
  v_unchanged integer:=0; v_skipped integer:=0; v_results jsonb:='[]'::jsonb; v_pending integer; v_going integer;
  v_watermark bigint; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_decision NOT IN ('approve','deny') OR p_scope NOT IN ('selected','all_pending') THEN
    RAISE EXCEPTION 'rsvp_guest_action_invalid' USING ERRCODE='22023';
  END IF;
  v_target:=CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'denied' END;
  IF p_scope='selected' THEN
    IF p_roster_keys IS NULL OR cardinality(p_roster_keys) NOT BETWEEN 1 AND 100
       OR cardinality(p_roster_keys)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_roster_keys)))
       OR EXISTS(SELECT 1 FROM unnest(p_roster_keys) k WHERE k!~'^rsvp:[0-9a-f-]{36}$') THEN
      RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(substring(k from 6)::uuid ORDER BY substring(k from 6)::uuid) INTO v_ids FROM unnest(p_roster_keys) k;
  ELSE
    IF p_roster_keys IS NOT NULL THEN RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023'; END IF;
    v_ids:='{}'::uuid[];
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_decision||':'||p_scope||':'||
    COALESCE(to_jsonb(p_roster_keys)::text,'null')||':'||COALESCE(p_expected_watermark::text,'null'),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_guest_status:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='guest_status' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_expected_watermark IS NOT NULL AND p_expected_watermark<>v_watermark THEN
    RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='40001';
  END IF;
  IF p_scope='all_pending' THEN
    SELECT array_agg(id ORDER BY created_at,id) INTO v_ids FROM public.event_rsvps
      WHERE event_id=p_event_id AND approval_status='pending';
    v_ids:=COALESCE(v_ids,'{}'::uuid[]);
  END IF;
  PERFORM 1 FROM public.event_rsvps WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
  IF p_scope='selected' AND (SELECT count(*) FROM public.event_rsvps WHERE id=ANY(v_ids) AND event_id=p_event_id)<>cardinality(v_ids) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='40001';
  END IF;
  IF p_scope='selected' AND EXISTS(SELECT 1 FROM public.event_rsvps WHERE id=ANY(v_ids) AND
      (event_id<>p_event_id OR rsvp_status NOT IN ('going','waitlisted') OR approval_status NOT IN ('pending','approved','denied'))) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(sum(1+plus_count),0) INTO v_confirmed FROM public.event_rsvps
    WHERE event_id=p_event_id AND rsvp_status='going' AND approval_status='approved'
      AND NOT(id=ANY(v_ids));
  IF p_decision='approve' AND p_scope='selected' AND v_event.rsvp_capacity IS NOT NULL THEN
    SELECT COALESCE(sum(1+plus_count),0) INTO v_requested FROM public.event_rsvps WHERE id=ANY(v_ids);
    IF v_confirmed+v_requested>v_event.rsvp_capacity THEN RAISE EXCEPTION 'rsvp_capacity_full' USING ERRCODE='23514'; END IF;
  END IF;
  v_free:=CASE WHEN v_event.rsvp_capacity IS NULL THEN NULL ELSE v_event.rsvp_capacity-v_confirmed END;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_row FROM public.event_rsvps WHERE id=v_id;
    IF p_decision='approve' AND p_scope='all_pending' AND v_free IS NOT NULL AND 1+v_row.plus_count>v_free THEN
      v_skipped:=v_skipped+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','skipped_for_capacity')); CONTINUE;
    END IF;
    IF v_row.approval_status=v_target THEN
      v_unchanged:=v_unchanged+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','unchanged')); CONTINUE;
    END IF;
    IF p_decision='approve' THEN
      UPDATE public.event_rsvps SET approval_status='approved',rsvp_status=CASE WHEN rsvp_status='waitlisted' THEN 'going' ELSE rsvp_status END WHERE id=v_id;
      IF (SELECT rsvp_status FROM public.event_rsvps WHERE id=v_id)='going' THEN PERFORM public.enqueue_rsvp_pass(v_id,NULL); END IF;
      IF v_free IS NOT NULL THEN v_free:=v_free-(1+v_row.plus_count); END IF;
    ELSE
      UPDATE public.event_rsvps SET approval_status='denied' WHERE id=v_id;
      INSERT INTO public.rsvp_notifications(event_id,rsvp_id,channel,recipient,status,template_key,payload,idempotency_key,attempt_count)
      VALUES(p_event_id,v_id,NULL,NULL,'pending',CASE WHEN v_row.approval_status='approved' THEN 'rsvp_removed' ELSE 'rsvp_denied' END,
        jsonb_build_object('rsvp_id',v_id,'event_id',p_event_id),
        'rsvp_approval:'||v_id::text||':'||v_row.approval_status||':denied',0) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    v_applied:=v_applied+1; v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'rosterKey','rsvp:'||v_id,'outcome','applied','approvalStatus',v_target,
      'wasRemoved',(p_decision='deny' AND v_row.approval_status='approved')));
  END LOOP;
  SELECT count(*) FILTER(WHERE approval_status='pending'),
    COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0)
    INTO v_pending,v_going FROM public.event_rsvps WHERE event_id=p_event_id;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  v_result:=jsonb_build_object('requestedCount',cardinality(v_ids),'appliedCount',v_applied,'unchangedCount',v_unchanged,
    'skippedForCapacity',v_skipped,'outcomes',v_results,'pendingRemaining',v_pending,'goingPersonCount',v_going,'watermark',v_watermark);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'guest_status',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5/7 — business_list_rsvp_contributions (verbatim, 20270530001977 L562-L596).
-- No shipped caller today; same reasoning as the roster lister above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_list_rsvp_contributions(
  p_event_id uuid,p_status text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_created timestamptz; v_id uuid; v_rows jsonb; v_last jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('finance_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('paid','partially_refunded','refunded') OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'rsvp_contribution_filter_invalid' USING ERRCODE='22023';
  END IF;
  IF p_cursor IS NOT NULL THEN v_created:=(p_cursor->>'createdAt')::timestamptz; v_id:=(p_cursor->>'contributionId')::uuid; END IF;
  WITH page AS (
    SELECT c.*,COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(c.guest_name),''),'Unnamed contribution') display_label,
      GREATEST(0,c.amount_cents-c.application_fee_amount_cents-c.refunded_amount_cents) discretionary_cents,
      GREATEST(0,c.buyer_total_cents-c.refunded_amount_cents) cancellation_cents,
      sr.financial_state refund_state
    FROM public.event_rsvp_contributions c LEFT JOIN public.profiles p ON p.id=c.user_id
    LEFT JOIN LATERAL(SELECT financial_state FROM public.source_refunds s
      WHERE s.source_type='rsvp_contribution' AND s.source_id=c.id ORDER BY s.requested_at DESC LIMIT 1) sr ON true
    WHERE c.event_id=p_event_id AND (p_status IS NULL OR c.status=p_status)
      AND (p_cursor IS NULL OR (c.created_at,c.id)>(v_created,v_id))
    ORDER BY c.created_at,c.id LIMIT p_limit
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contributionId',id,'displayLabel',display_label,'currency',upper(currency),
    'buyerTotalCents',buyer_total_cents,'refundable',jsonb_build_object('discretionaryCents',discretionary_cents,'cancellationCents',cancellation_cents),
    'contributionState',status,'refundState',refund_state,'createdAt',created_at
  ) ORDER BY created_at,id),'[]'::jsonb) INTO v_rows FROM page;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object(
    'createdAt',v_last->>'createdAt','contributionId',v_last->>'contributionId') ELSE NULL END);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6/7 — issue_1977_agent_rsvp_payload (verbatim, 20270530001977 L650-L679).
-- Argument shaper for ari_execute_rsvp_operation; no direct caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1977_agent_rsvp_payload(p_args jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title',p_args->'title','description',p_args->'description',
    'timezone',p_args->'timezone','format',p_args->'format',
    'location_text',p_args->'location_text','online_url',p_args->'online_url',
    'city',p_args->'city','partyTypes',p_args->'party_types',
    'vibeTags',p_args->'vibe_tags','musicGenres',p_args->'music_genres',
    'requestedVisibility',p_args->'requested_visibility',
    'rsvpCapacity',p_args->'capacity',
    'rsvpAllowPlusOnes',p_args->'allow_plus_ones',
    'rsvpPlusOnesMax',p_args->'plus_ones_max',
    'rsvpWaitlistEnabled',p_args->'waitlist_enabled',
    'rsvpApprovalMode',p_args->'approval_mode',
    'rsvpDiscoverable',p_args->'discoverable',
    'privateGuestList',p_args->'private_guest_list',
    'hideRemainingCount',p_args->'hide_remaining_count',
    'hideAddressUntilTicket',p_args->'hide_address_until_rsvp',
    'rsvpContributionEnabled',p_args->'contribution_enabled',
    'rsvpContributionSuggestedCents',p_args->'suggested_cents',
    'rsvpContributionMinCents',p_args->'minimum_cents',
    'when',CASE WHEN p_args ? 'date' OR p_args ? 'doors_open' OR p_args ? 'ends_at'
      THEN jsonb_strip_nulls(jsonb_build_object(
        'date',p_args->'date','doorsOpen',p_args->'doors_open',
        'endsAt',p_args->'ends_at','timezone',p_args->'timezone'))
      ELSE NULL END,
    'is_online',CASE WHEN p_args->>'format' IN('online','hybrid') THEN 'true'::jsonb
      WHEN p_args ? 'format' THEN 'false'::jsonb ELSE NULL END
  ))
$function$;

-- ---------------------------------------------------------------------------
-- 7/7 — ari_execute_rsvp_operation (verbatim, 20270530001977 L681-L724).
-- Every RSVP action Ari can take routes through this one entry point, so all
-- four agent call sites fail while it is absent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ari_execute_rsvp_operation(
  p_operation_id uuid,p_tool_name text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_begin jsonb; v_result jsonb; v_event_id uuid; v_payload jsonb;
BEGIN
  IF p_tool_name NOT IN(
    'create_rsvp','update_rsvp','publish_rsvp',
    'update_rsvp_contribution_settings','set_rsvp_guest_status',
    'refund_rsvp_contribution'
  ) THEN RAISE EXCEPTION 'unsupported_rsvp_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_rsvp' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_create_rsvp_draft_graph(
        (p_args->>'brand_id')::uuid,v_payload,NULL);
    WHEN 'update_rsvp' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_update_rsvp_graph(
        v_event_id,v_payload,NULLIF(p_args->>'reason',''),NULL);
    WHEN 'update_rsvp_contribution_settings' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_update_rsvp_graph(
        v_event_id,v_payload,NULLIF(p_args->>'reason',''),NULL);
    WHEN 'publish_rsvp' THEN
      v_result:=public.business_publish_rsvp_graph(v_event_id,NULL);
    WHEN 'set_rsvp_guest_status' THEN
      v_result:=public.business_set_rsvp_guest_status(
        v_event_id,p_args->>'decision',p_args->>'scope',
        CASE WHEN p_args ? 'roster_keys' THEN
          ARRAY(SELECT jsonb_array_elements_text(p_args->'roster_keys'))
        ELSE NULL END,
        NULLIF(p_args->>'roster_watermark','')::bigint,NULL);
    WHEN 'refund_rsvp_contribution' THEN
      v_result:=public.biz_prepare_rsvp_contribution_refund(
        v_event_id,(p_args->>'contribution_id')::uuid,p_args->>'mode',
        p_args->>'reason',p_operation_id::text);
  END CASE;
  RETURN public.agent_operation_receipt_complete(
    p_operation_id,p_tool_name,p_args,v_result);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Privileges — verbatim from 20270530001977 L727/730/732/733/734/739/740 and
-- L745/747/748/749/754, matching what that file declares for EACH function.
--
-- A freshly created function carries a default EXECUTE grant to PUBLIC, which
-- both anon and authenticated inherit (the trap in
-- reference_new_public_tables_inherit_anon_grants). The REVOKE strips it; the
-- GRANT re-adds only the roles that function actually needs.
--
-- Note the two deliberate asymmetries, copied exactly rather than tidied:
--   * issue_1977_current_rsvp_publish_payload and issue_1977_agent_rsvp_payload
--     are REVOKEd and never GRANTed. They are internal helpers reached only from
--     inside SECURITY DEFINER bodies, which execute as the owner, so no client
--     role needs EXECUTE. Granting them here would widen the surface beyond what
--     #1977 declares.
--   * Every other function below gets `authenticated, service_role`, the same
--     shape business_create_event_draft uses at 20270422001972 L833-L836.
-- anon must never reach any of these.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_1977_current_rsvp_publish_payload(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_publish_rsvp_graph(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_list_rsvp_roster(uuid,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_list_rsvp_contributions(uuid,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1977_agent_rsvp_payload(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ari_execute_rsvp_operation(uuid,text,jsonb) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.business_publish_rsvp_graph(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_list_rsvp_roster(uuid,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_list_rsvp_contributions(uuid,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ari_execute_rsvp_operation(uuid,text,jsonb) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- #3047 reachability markers. These COMMENTs exist ONLY on the db-push-reachable
-- publish; 20270530001977 sets no function comments at all. The SQL contract
-- test asserts them, so deleting this migration turns that test red even in a
-- CI database built from every migration file on disk — where the shadowed
-- #1977 definition is still present and would satisfy any behaviour-only
-- assertion. That is the whole reason a behavioural test cannot see this bug.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.business_publish_rsvp_graph(uuid,uuid) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.issue_1977_current_rsvp_publish_payload(uuid) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.business_list_rsvp_roster(uuid,text,jsonb,integer) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.business_list_rsvp_contributions(uuid,text,jsonb,integer) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.issue_1977_agent_rsvp_payload(jsonb) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.ari_execute_rsvp_operation(uuid,text,jsonb) IS
  '#3047 db-push-reachable publish of the #1977 RSVP publish/guest-status/Ari surface. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';

COMMIT;
