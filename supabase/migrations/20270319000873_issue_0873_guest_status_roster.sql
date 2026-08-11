-- Issue #873: one person-first guest roster derived from invitation, RSVP,
-- commerce, and admission evidence. Orders remain the financial authority.

BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES
  ('guest_roster_read_enabled',false,'#873 person-first guest roster reads'),
  ('guest_roster_single_actions_enabled',false,'#873 single guest actions'),
  ('guest_roster_bulk_actions_enabled',false,'#873 bulk guest actions'),
  ('guest_roster_export_enabled',false,'#873 audited guest roster export')
ON CONFLICT(flag_key) DO UPDATE SET description=EXCLUDED.description;

CREATE TABLE public.guest_roster_brand_rollouts (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'dark' CHECK (phase IN (
    'dark','internal_read','cohort_read','single_actions','bulk_actions','ga'
  )),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.guest_roster_brand_rollouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_roster_brand_rollouts FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.guest_roster_brand_rollouts TO service_role;

CREATE TABLE public.guest_roster_change_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  roster_key text NULL CHECK (roster_key IS NULL OR length(roster_key) BETWEEN 1 AND 100),
  fact_kind text NOT NULL CHECK (fact_kind IN (
    'identity','invitation','delivery','rsvp','party','order','ticket','admission','rollout'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_roster_change_events_event_idx
  ON public.guest_roster_change_events(event_id,id DESC);
ALTER TABLE public.guest_roster_change_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY guest_roster_change_events_manager_read
  ON public.guest_roster_change_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id=guest_roster_change_events.event_id
      AND public.biz_brand_effective_rank(e.brand_id,auth.uid())
          >= public.biz_role_rank('event_manager')
  ));
REVOKE ALL ON TABLE public.guest_roster_change_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.guest_roster_change_events TO authenticated;
GRANT ALL ON TABLE public.guest_roster_change_events TO service_role;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public'
      AND tablename='guest_roster_change_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_roster_change_events;
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_phase_rank(p_phase text)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=''
AS $function$
  SELECT CASE p_phase
    WHEN 'dark' THEN 0 WHEN 'internal_read' THEN 1 WHEN 'cohort_read' THEN 2
    WHEN 'single_actions' THEN 3 WHEN 'bulk_actions' THEN 4 WHEN 'ga' THEN 5
    ELSE 0 END
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_rollout(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE
  v_phase text := 'dark';
  v_read boolean := false;
  v_single boolean := false;
  v_bulk boolean := false;
  v_export boolean := false;
BEGIN
  SELECT r.phase INTO v_phase
  FROM public.guest_roster_brand_rollouts r WHERE r.brand_id=p_brand_id;
  v_phase := COALESCE(v_phase,'dark');
  SELECT COALESCE(bool_or(f.flag_key='guest_roster_read_enabled' AND f.is_enabled),false),
         COALESCE(bool_or(f.flag_key='guest_roster_single_actions_enabled' AND f.is_enabled),false),
         COALESCE(bool_or(f.flag_key='guest_roster_bulk_actions_enabled' AND f.is_enabled),false),
         COALESCE(bool_or(f.flag_key='guest_roster_export_enabled' AND f.is_enabled),false)
  INTO v_read,v_single,v_bulk,v_export
  FROM public.feature_flags f
  WHERE f.flag_key IN ('guest_roster_read_enabled','guest_roster_single_actions_enabled',
                       'guest_roster_bulk_actions_enabled','guest_roster_export_enabled');
  RETURN jsonb_build_object(
    'phase',v_phase,
    'readEnabled',v_read AND public.biz_guest_roster_phase_rank(v_phase)>=1,
    'singleActionsEnabled',v_single AND public.biz_guest_roster_phase_rank(v_phase)>=3,
    'bulkActionsEnabled',v_bulk AND public.biz_guest_roster_phase_rank(v_phase)>=4,
    'exportEnabled',v_export AND public.biz_guest_roster_phase_rank(v_phase)>=4
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_access(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_brand uuid; v_rollout jsonb;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e
  WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand,auth.uid())
        < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  RETURN jsonb_build_object('enabled',COALESCE((v_rollout->>'readEnabled')::boolean,false),
    'phase',v_rollout->>'phase');
END;
$function$;

-- Service-only common projection. Each row is one canonical person, or one
-- truthful unlinked source record when reconciliation has not safely linked it.
CREATE OR REPLACE FUNCTION public.biz_guest_roster_project(p_event_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
WITH event_row AS (
  SELECT e.id,e.brand_id FROM public.events e
  WHERE e.id=p_event_id AND e.deleted_at IS NULL
), canonical_people AS (
  SELECT DISTINCT p.id,p.display_name,p.avatar_url
  FROM event_row e
  JOIN public.brand_people p ON p.brand_id=e.brand_id AND p.record_status='active'
  WHERE EXISTS (SELECT 1 FROM public.brand_offering_invites i WHERE i.event_id=e.id AND i.brand_person_id=p.id)
     OR EXISTS (
       SELECT 1 FROM public.brand_person_source_links l
       LEFT JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
       LEFT JOIN public.event_rsvp_guests rg ON l.source_kind='rsvp_plus_one' AND rg.id=l.source_id
       LEFT JOIN public.event_rsvps rr ON rr.id=rg.rsvp_id
       LEFT JOIN public.orders o ON l.source_kind='order' AND o.id=l.source_id
       LEFT JOIN public.tickets st ON l.source_kind='ticket_holder' AND st.id=l.source_id
       WHERE l.brand_person_id=p.id AND l.detached_at IS NULL
         AND COALESCE(r.event_id,rr.event_id,o.event_id,st.event_id)=e.id
     )
), projected AS (
  SELECT
    'person:'||p.id::text AS roster_key,
    p.id AS person_id,
    p.display_name,
    p.avatar_url,
    invite.id AS invite_id,
    invite.status AS invite_record_status,
    invite.invited_at,
    rsvp.id AS rsvp_id,
    rsvp.rsvp_status,
    rsvp.approval_status,
    rsvp.updated_at AS rsvp_at,
    COALESCE(1+rsvp.plus_count,0) AS rsvp_party_size,
    COALESCE(commerce.order_ids,'{}'::uuid[]) AS order_ids,
    COALESCE(commerce.active_tickets,0) AS active_tickets,
    COALESCE(commerce.refunded_tickets,0) AS refunded_tickets,
    COALESCE(commerce.transferred_tickets,0) AS transferred_tickets,
    GREATEST(COALESCE(commerce.checked_in,0),
      CASE WHEN rsvp.checked_in_at IS NOT NULL THEN 1 ELSE 0 END
        + COALESCE(rsvp_party.checked_in,0)) AS checked_in,
    COALESCE(commerce.has_buyer,false) AS has_buyer,
    COALESCE(commerce.has_refund,false) AS has_refund,
    COALESCE(commerce.has_cancel,false) AS has_cancel,
    COALESCE(commerce.has_transfer,false) AS has_transfer,
    COALESCE(delivery.accepted,false) AS accepted,
    COALESCE(delivery.has_inflight,false) AS has_inflight,
    COALESCE(delivery.has_failure,false) AS has_failure,
    COALESCE(delivery.all_policy_blocked,false) AS all_policy_blocked,
    COALESCE(delivery.retryable,false) AS retryable,
    COALESCE(delivery.attempts,'[]'::jsonb) AS attempts,
    delivery.last_contact_at,
    contact.contact_label,
    GREATEST(p.updated_at,invite.updated_at,rsvp.updated_at,commerce.activity_at,delivery.activity_at) AS activity_at
  FROM canonical_people p
  LEFT JOIN LATERAL (
    SELECT i.* FROM public.brand_offering_invites i
    WHERE i.event_id=p_event_id AND i.brand_person_id=p.id
    ORDER BY i.updated_at DESC,i.id DESC LIMIT 1
  ) invite ON true
  LEFT JOIN LATERAL (
    SELECT r.* FROM public.brand_person_source_links l
    JOIN public.event_rsvps r ON r.id=l.source_id
    WHERE l.brand_person_id=p.id AND l.source_kind='event_rsvp'
      AND l.detached_at IS NULL AND r.event_id=p_event_id
    ORDER BY r.updated_at DESC,r.id DESC LIMIT 1
  ) rsvp ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE g.checked_in_at IS NOT NULL)::integer AS checked_in
    FROM public.event_rsvp_guests g WHERE g.rsvp_id=rsvp.id
  ) rsvp_party ON true
  LEFT JOIN LATERAL (
    WITH person_orders AS (
      SELECT DISTINCT o.* FROM public.brand_person_source_links l
      JOIN public.orders o ON (
        (l.source_kind='order' AND o.id=l.source_id)
        OR (l.source_kind='ticket_holder' AND EXISTS (
          SELECT 1 FROM public.tickets lt WHERE lt.id=l.source_id AND lt.order_id=o.id
        ))
      )
      WHERE l.brand_person_id=p.id AND l.detached_at IS NULL AND o.event_id=p_event_id
    )
    SELECT array_agg(DISTINCT o.id ORDER BY o.id) AS order_ids,
      count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS active_tickets,
      count(t.id) FILTER (WHERE t.status='refunded')::integer AS refunded_tickets,
      count(t.id) FILTER (WHERE t.status='transferred')::integer AS transferred_tickets,
      count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)::integer AS checked_in,
      count(DISTINCT o.id)>0 AS has_buyer,
      bool_or(o.payment_status IN ('refunded','partial_refund') OR t.status='refunded') AS has_refund,
      bool_or(t.status='void') AS has_cancel,
      bool_or(t.status='transferred') AS has_transfer,
      max(GREATEST(o.updated_at,t.created_at,COALESCE(t.used_at,t.created_at))) AS activity_at
    FROM person_orders o LEFT JOIN public.tickets t ON t.order_id=o.id
  ) commerce ON true
  LEFT JOIN LATERAL (
    SELECT
      bool_or(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')) AS accepted,
      bool_or(a.status IN ('queued','sending') AND a.provider_accepted_at IS NULL) AS has_inflight,
      bool_or(a.status='failed') AS has_failure,
      bool_and(a.status='suppressed') AS all_policy_blocked,
      bool_or(a.status='failed' AND a.is_retryable) AS retryable,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)) AS activity_at,
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) AS last_contact_at,
      jsonb_agg(jsonb_build_object(
        'channel',a.channel,'status',a.status,
        'providerAccepted',(a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered')),
        'retryable',a.is_retryable,'reason',a.safe_reason_code,
        'occurredAt',COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at,a.failed_at,a.queued_at,a.created_at)
      ) ORDER BY a.created_at DESC,a.id DESC) AS attempts
    FROM public.brand_offering_invite_delivery_attempts a WHERE a.invite_id=invite.id
  ) delivery ON true
  LEFT JOIN LATERAL (
    SELECT c.normalized_value AS contact_label
    FROM public.brand_person_contact_methods c
    WHERE c.brand_person_id=p.id AND c.record_state='active'
      AND c.provenance_scope='brand_owned' AND c.is_exportable
    ORDER BY c.is_primary DESC,c.created_at,c.id LIMIT 1
  ) contact ON true
), classified AS (
  SELECT x.*,
    CASE
      WHEN x.active_tickets>0 THEN 'bought_ticket'
      WHEN x.rsvp_status='going' AND x.approval_status='approved' THEN 'going'
      WHEN x.rsvp_status='going' AND x.approval_status='pending' THEN 'awaiting_approval'
      WHEN x.approval_status='denied' THEN 'denied'
      WHEN x.rsvp_status='waitlisted' THEN 'waitlisted'
      WHEN x.rsvp_status='not_going' THEN 'declined'
      WHEN x.has_refund THEN 'refunded'
      WHEN x.has_cancel THEN 'cancelled'
      WHEN x.has_transfer THEN 'transferred'
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'not_responded'
      WHEN x.invite_id IS NOT NULL AND x.has_inflight THEN 'sending'
      WHEN x.invite_id IS NOT NULL AND x.has_failure THEN 'invite_failed'
      WHEN x.invite_id IS NOT NULL AND x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      WHEN x.rsvp_id IS NOT NULL THEN 'existing_rsvp'
      WHEN x.has_buyer THEN 'existing_buyer'
      ELSE 'unlinked_guest'
    END AS primary_status,
    CASE
      WHEN x.invite_record_status='removed' THEN 'removed'
      WHEN x.accepted THEN 'invited'
      WHEN x.has_inflight THEN 'sending'
      WHEN x.has_failure THEN 'failed'
      WHEN x.all_policy_blocked THEN 'suppressed_or_skipped'
      WHEN x.invite_id IS NOT NULL THEN 'not_sent'
      ELSE 'none'
    END AS invitation_status
  FROM projected x
), canonical_json AS (
  SELECT jsonb_build_object(
    'rosterKey',c.roster_key,'personId',c.person_id,'displayName',c.display_name,
    'avatarUrl',c.avatar_url,'contactLabel',c.contact_label,
    'primaryStatus',c.primary_status,'invitationStatus',c.invitation_status,
    'invitationLabel',NULL,'attempts',c.attempts,
    'party',jsonb_build_object('size',GREATEST(1,c.rsvp_party_size,c.active_tickets+c.refunded_tickets+c.transferred_tickets),
      'activeTickets',c.active_tickets,'refundedTickets',c.refunded_tickets,
      'transferredTickets',c.transferred_tickets,'checkedIn',c.checked_in),
    'rsvpId',c.rsvp_id,'orderIds',to_jsonb(c.order_ids),
    'latestActivityAt',COALESCE(c.activity_at,now()),'checkedIn',c.checked_in>0,
    'canRemind',c.primary_status='not_responded',
    'canRetry',c.primary_status='invite_failed' AND c.retryable,
    'canApprove',c.primary_status='awaiting_approval','canDeny',c.primary_status='awaiting_approval',
    'isExportable',c.person_id IS NOT NULL
  ) AS row_data FROM classified c
), unlinked_rsvps AS (
  SELECT jsonb_build_object(
    'rosterKey','rsvp:'||r.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(r.guest_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,
    'primaryStatus','unlinked_guest','invitationStatus','none','invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',1+r.plus_count,'activeTickets',0,'refundedTickets',0,'transferredTickets',0,'checkedIn',0),
    'rsvpId',r.id,'orderIds','[]'::jsonb,'latestActivityAt',r.updated_at,'checkedIn',false,
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false
  ) AS row_data
  FROM public.event_rsvps r WHERE r.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.source_kind='event_rsvp' AND l.source_id=r.id AND l.detached_at IS NULL
  )
), unlinked_orders AS (
  SELECT jsonb_build_object(
    'rosterKey','order:'||o.id::text,'personId',NULL,'displayName',COALESCE(NULLIF(btrim(o.buyer_name),''),'Unlinked guest'),
    'avatarUrl',NULL,'contactLabel',NULL,'primaryStatus','unlinked_guest','invitationStatus','none',
    'invitationLabel',NULL,'attempts','[]'::jsonb,
    'party',jsonb_build_object('size',GREATEST(1,count(t.id)),'activeTickets',count(t.id) FILTER (WHERE t.status IN ('valid','used')),
      'refundedTickets',count(t.id) FILTER (WHERE t.status='refunded'),'transferredTickets',count(t.id) FILTER (WHERE t.status='transferred'),
      'checkedIn',count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)),
    'rsvpId',NULL,'orderIds',jsonb_build_array(o.id),'latestActivityAt',o.updated_at,
    'checkedIn',bool_or(t.status='used' OR t.used_at IS NOT NULL),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false
  ) AS row_data
  FROM public.orders o LEFT JOIN public.tickets t ON t.order_id=o.id
  WHERE o.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.source_kind='order' AND l.source_id=o.id AND l.detached_at IS NULL
  ) GROUP BY o.id
)
SELECT row_data FROM canonical_json
UNION ALL SELECT row_data FROM unlinked_rsvps
UNION ALL SELECT row_data FROM unlinked_orders
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_list(
  p_event_id uuid,p_filter text DEFAULT 'all',p_search text DEFAULT NULL,
  p_sort text DEFAULT 'action_priority',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_search text; v_rows jsonb; v_all jsonb; v_count integer;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL OR public.biz_brand_effective_rank(v_brand,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>'readEnabled')::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_disabled' USING ERRCODE='42501';
  END IF;
  IF p_filter NOT IN ('all','rsvpd','ticketed','not_yet','suppressed','needs_attention','no_response','confirmed',
    'checked_in','not_checked_in','delivery_failed','removed','going','maybe','awaiting_approval','waitlisted',
    'declined','denied','bought_ticket','refunded','cancelled','transferred')
    OR p_sort NOT IN ('action_priority','name_asc','name_desc','recent_first')
    OR p_limit NOT BETWEEN 1 AND 100 OR p_cursor IS NOT NULL THEN
    RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
  END IF;
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\s+',' ','g'));
  IF length(v_search)>200 OR v_search~E'[\x00-\x1F\x7F]' THEN RAISE EXCEPTION 'guest_roster_search_invalid' USING ERRCODE='22023'; END IF;
  WITH all_rows AS MATERIALIZED (SELECT row_data r FROM public.biz_guest_roster_project(p_event_id)),
  filtered AS (
    SELECT r FROM all_rows WHERE
      (v_search='' OR strpos(lower(r->>'displayName'),v_search)>0 OR strpos(lower(COALESCE(r->>'contactLabel','')),v_search)>0)
      AND CASE p_filter
        WHEN 'all' THEN true WHEN 'no_response' THEN r->>'primaryStatus'='not_responded'
        WHEN 'confirmed' THEN r->>'primaryStatus' IN ('bought_ticket','going')
        WHEN 'needs_attention' THEN r->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')
        WHEN 'not_yet' THEN r->>'primaryStatus' IN ('not_responded','not_sent','sending','invite_failed','suppressed_or_skipped')
        WHEN 'delivery_failed' THEN r->>'primaryStatus'='invite_failed'
        WHEN 'suppressed' THEN r->>'primaryStatus'='suppressed_or_skipped'
        WHEN 'checked_in' THEN (r->>'checkedIn')::boolean
        WHEN 'not_checked_in' THEN NOT (r->>'checkedIn')::boolean
        WHEN 'rsvpd' THEN r->>'rsvpId' IS NOT NULL
        WHEN 'ticketed' THEN jsonb_array_length(r->'orderIds')>0
        WHEN 'maybe' THEN false ELSE r->>'primaryStatus'=p_filter END
  ), ordered AS (
    SELECT r FROM filtered ORDER BY
      CASE WHEN p_sort='action_priority' THEN CASE r->>'primaryStatus'
        WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1 WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END END,
      CASE WHEN p_sort='recent_first' THEN (r->>'latestActivityAt')::timestamptz END DESC NULLS LAST,
      CASE WHEN p_sort IN ('action_priority','name_asc') THEN lower(r->>'displayName') END ASC,
      CASE WHEN p_sort='name_desc' THEN lower(r->>'displayName') END DESC,r->>'rosterKey' LIMIT p_limit
  ) SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) INTO v_rows FROM ordered;
  WITH all_rows AS MATERIALIZED (SELECT row_data r FROM public.biz_guest_roster_project(p_event_id))
  SELECT COALESCE(jsonb_agg(r),'[]'::jsonb),count(*) INTO v_all,v_count FROM all_rows;
  RETURN jsonb_build_object('rows',v_rows,'summary',jsonb_build_object(
    'all',v_count,
    'notResponded',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus'='not_responded'),
    'confirmed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus' IN ('bought_ticket','going')),
    'needsAttention',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')),
    'invited',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='invited'),
    'notSent',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='not_sent'),
    'sending',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='sending'),
    'inviteFailed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='failed'),
    'watermark',(SELECT COALESCE(max(id),0) FROM public.guest_roster_change_events WHERE event_id=p_event_id),
    'generatedAt',now()),'nextCursor',NULL,'staleAfter',now()+interval '30 seconds',
    'canExport',COALESCE((v_rollout->>'exportEnabled')::boolean,false));
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_summary(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
  SELECT public.biz_guest_roster_list(p_event_id,'all',NULL,'action_priority',NULL,1)->'summary'
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_detail(p_event_id uuid,p_roster_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_guard jsonb; v_row jsonb;
BEGIN
  v_guard:=public.biz_guest_roster_list(p_event_id,'all',NULL,'action_priority',NULL,1);
  SELECT row_data INTO v_row FROM public.biz_guest_roster_project(p_event_id)
  WHERE row_data->>'rosterKey'=p_roster_key;
  IF v_row IS NULL THEN RAISE EXCEPTION 'guest_roster_not_found' USING ERRCODE='P0002'; END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_offering_guest_roster_export_rows(p_job_id uuid)
RETURNS TABLE(row_data jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_job public.brand_people_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.brand_people_export_jobs WHERE id=p_job_id;
  IF NOT FOUND OR v_job.export_kind<>'offering_guest_roster' THEN
    RAISE EXCEPTION 'export_job_not_found' USING ERRCODE='P0002';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'personId',r.row_data->'personId','name',r.row_data->'displayName',
    'contact',r.row_data->'contactLabel','primaryStatus',r.row_data->'primaryStatus',
    'invitationStatus',r.row_data->'invitationStatus','party',r.row_data->'party',
    'checkedIn',r.row_data->'checkedIn','orderCount',jsonb_array_length(r.row_data->'orderIds'),
    'lastActivityAt',r.row_data->'latestActivityAt'
  ) FROM public.biz_guest_roster_project(v_job.scope_id) r
  WHERE (r.row_data->>'isExportable')::boolean
    AND (v_job.filter_json->>'search'='' OR strpos(lower(r.row_data->>'displayName'),v_job.filter_json->>'search')>0
      OR strpos(lower(COALESCE(r.row_data->>'contactLabel','')),v_job.filter_json->>'search')>0)
    AND CASE v_job.filter_json->>'filter'
      WHEN 'all' THEN true WHEN 'no_response' THEN r.row_data->>'primaryStatus'='not_responded'
      WHEN 'confirmed' THEN r.row_data->>'primaryStatus' IN ('bought_ticket','going')
      WHEN 'needs_attention' THEN r.row_data->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')
      WHEN 'delivery_failed' THEN r.row_data->>'primaryStatus'='invite_failed'
      WHEN 'suppressed' THEN r.row_data->>'primaryStatus'='suppressed_or_skipped'
      WHEN 'checked_in' THEN (r.row_data->>'checkedIn')::boolean
      WHEN 'not_checked_in' THEN NOT (r.row_data->>'checkedIn')::boolean
      WHEN 'not_yet' THEN r.row_data->>'primaryStatus' IN ('not_responded','not_sent','sending','invite_failed','suppressed_or_skipped')
      WHEN 'rsvpd' THEN r.row_data->>'rsvpId' IS NOT NULL
      WHEN 'ticketed' THEN jsonb_array_length(r.row_data->'orderIds')>0
      WHEN 'maybe' THEN false ELSE r.row_data->>'primaryStatus'=v_job.filter_json->>'filter' END
  ORDER BY lower(r.row_data->>'displayName'),r.row_data->>'rosterKey';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_0873_emit_roster_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_event uuid; v_person uuid; v_kind text:=TG_ARGV[0];
BEGIN
  IF TG_TABLE_NAME='brand_offering_invites' THEN v_event:=NEW.event_id; v_person:=NEW.brand_person_id;
  ELSIF TG_TABLE_NAME='brand_offering_invite_delivery_attempts' THEN
    SELECT i.event_id,i.brand_person_id INTO v_event,v_person FROM public.brand_offering_invites i WHERE i.id=NEW.invite_id;
  ELSIF TG_TABLE_NAME='event_rsvps' THEN v_event:=NEW.event_id;
  ELSIF TG_TABLE_NAME='event_rsvp_guests' THEN SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id=NEW.rsvp_id;
  ELSIF TG_TABLE_NAME='orders' THEN v_event:=NEW.event_id;
  ELSIF TG_TABLE_NAME='tickets' THEN v_event:=NEW.event_id;
  END IF;
  IF v_event IS NOT NULL THEN
    INSERT INTO public.guest_roster_change_events(event_id,roster_key,fact_kind)
    VALUES(v_event,CASE WHEN v_person IS NULL THEN NULL ELSE 'person:'||v_person::text END,v_kind);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_0873_invite_change AFTER INSERT OR UPDATE ON public.brand_offering_invites
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('invitation');
CREATE TRIGGER issue_0873_delivery_change AFTER INSERT OR UPDATE ON public.brand_offering_invite_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('delivery');
CREATE TRIGGER issue_0873_rsvp_change AFTER INSERT OR UPDATE ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('rsvp');
CREATE TRIGGER issue_0873_party_change AFTER INSERT OR UPDATE ON public.event_rsvp_guests
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('party');
CREATE TRIGGER issue_0873_order_change AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('order');
CREATE TRIGGER issue_0873_ticket_change AFTER INSERT OR UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('ticket');

REVOKE ALL ON FUNCTION public.biz_guest_roster_phase_rank(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_rollout(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_project(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_0873_emit_roster_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_phase_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_rollout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_project(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_0873_emit_roster_change() TO service_role;

REVOKE ALL ON FUNCTION public.biz_guest_roster_access(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_summary(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_detail(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_access(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_summary(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_detail(uuid,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) TO service_role;

COMMIT;
