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

CREATE TABLE public.guest_roster_action_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('reminder','retry_delivery')),
  selection jsonb NOT NULL,
  selected_count integer NOT NULL CHECK (selected_count BETWEEN 1 AND 500),
  channels text[] NOT NULL CHECK (channels <@ ARRAY['email','sms','push']::text[]),
  quote_hash text NOT NULL CHECK (quote_hash~'^[0-9a-f]{64}$'),
  estimated_cost_minor bigint NOT NULL CHECK (estimated_cost_minor>=0),
  currency char(3) NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  execute_client_request_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_roster_preview_consumed_shape CHECK (
    (consumed_at IS NULL AND execute_client_request_id IS NULL)
    OR (consumed_at IS NOT NULL AND execute_client_request_id IS NOT NULL)
  )
);
CREATE INDEX guest_roster_action_previews_expiry_idx
  ON public.guest_roster_action_previews(expires_at) WHERE consumed_at IS NULL;
ALTER TABLE public.guest_roster_action_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_roster_action_previews FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.guest_roster_action_previews TO service_role;

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
    'bulkActionsEnabled',v_single AND v_bulk AND public.biz_guest_roster_phase_rank(v_phase)>=4,
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

-- #873 exercises the #1770 resolved-selection lane on fresh Supabase PG17.
-- Supabase auth.users has banned_until but no deleted_at column; the prior
-- helper referenced a production-only drift column and made this lane fail on
-- a canonical fresh schema. Preserve the actor/rank/lock contract without it.
CREATE OR REPLACE FUNCTION public.issue_1770_offering_actor_brand(
  p_actor_id uuid,p_event_id uuid,p_lock boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $function$
DECLARE v_brand_id uuid;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=p_actor_id
      AND (u.banned_until IS NULL OR u.banned_until<=now())
  ) THEN RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501'; END IF;
  IF p_lock THEN
    SELECT e.brand_id INTO v_brand_id FROM public.events e JOIN public.brands b ON b.id=e.brand_id
    WHERE e.id=p_event_id AND e.deleted_at IS NULL AND b.deleted_at IS NULL FOR UPDATE OF e,b;
  ELSE
    SELECT e.brand_id INTO v_brand_id FROM public.events e JOIN public.brands b ON b.id=e.brand_id
    WHERE e.id=p_event_id AND e.deleted_at IS NULL AND b.deleted_at IS NULL;
  END IF;
  IF v_brand_id IS NULL OR public.biz_brand_effective_rank(v_brand_id,p_actor_id)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  RETURN v_brand_id;
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
  SELECT DISTINCT p.id,p.display_name,p.avatar_url,p.updated_at
  FROM event_row e
  JOIN public.brand_people p ON p.brand_id=e.brand_id AND p.record_status='active'
  WHERE EXISTS (SELECT 1 FROM public.brand_offering_invites i WHERE i.event_id=e.id AND i.brand_person_id=p.id)
     OR EXISTS (
       SELECT 1 FROM public.brand_person_source_links l
       LEFT JOIN public.event_rsvps r ON l.source_kind='event_rsvp' AND r.id=l.source_id
       LEFT JOIN public.orders o ON l.source_kind='order' AND o.id=l.source_id
       WHERE l.brand_person_id=p.id AND l.detached_at IS NULL
         AND COALESCE(r.event_id,o.event_id)=e.id
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
    delivery.last_reminder_at,
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
      JOIN public.orders o ON l.source_kind='order' AND o.id=l.source_id
      WHERE l.brand_person_id=p.id AND l.detached_at IS NULL AND o.event_id=p_event_id
    )
    SELECT array_agg(DISTINCT o.id ORDER BY o.id) AS order_ids,
      count(t.id) FILTER (WHERE o.payment_status IN ('paid','partial_refund') AND t.status IN ('valid','used'))::integer AS active_tickets,
      count(t.id) FILTER (WHERE t.status='refunded')::integer AS refunded_tickets,
      count(t.id) FILTER (WHERE t.status='transferred')::integer AS transferred_tickets,
      count(t.id) FILTER (WHERE t.status='used' OR t.used_at IS NOT NULL)::integer AS checked_in,
      count(DISTINCT o.id)>0 AS has_buyer,
      bool_or(o.payment_status IN ('refunded','partial_refund') OR t.status='refunded') AS has_refund,
      bool_or(o.payment_status='cancelled' OR t.status='void') AS has_cancel,
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
      max(COALESCE(a.delivered_at,a.sent_at,a.provider_accepted_at)) FILTER (
        WHERE a.attempt_kind='reminder'
          AND (a.provider_accepted_at IS NOT NULL OR a.status IN ('sent','delivered'))
      ) AS last_reminder_at,
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
      WHEN x.rsvp_status='maybe' THEN 'maybe'
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
    'rsvpId',c.rsvp_id,'rsvpStatus',c.rsvp_status,'rsvpApprovalStatus',c.approval_status,
    'orderIds',to_jsonb(c.order_ids),
    'latestActivityAt',COALESCE(c.activity_at,now()),'checkedIn',c.checked_in>0,
    'canRemind',c.primary_status='not_responded'
      AND (c.last_reminder_at IS NULL OR c.last_reminder_at<=now()-interval '24 hours'),
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
    'rsvpId',r.id,'rsvpStatus',r.rsvp_status,'rsvpApprovalStatus',r.approval_status,
    'orderIds','[]'::jsonb,'latestActivityAt',r.updated_at,'checkedIn',false,
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
    'rsvpId',NULL,'rsvpStatus',NULL,'rsvpApprovalStatus',NULL,
    'orderIds',jsonb_build_array(o.id),'latestActivityAt',o.updated_at,
    'checkedIn',bool_or(t.status='used' OR t.used_at IS NOT NULL),
    'canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false,'isExportable',false
  ) AS row_data
  FROM public.orders o LEFT JOIN public.tickets t ON t.order_id=o.id
  WHERE o.event_id=p_event_id AND NOT EXISTS (
    SELECT 1 FROM public.brand_person_source_links l
    WHERE l.detached_at IS NULL AND l.source_kind='order' AND l.source_id=o.id
  ) GROUP BY o.id
)
SELECT row_data FROM canonical_json
UNION ALL SELECT row_data FROM unlinked_rsvps
UNION ALL SELECT row_data FROM unlinked_orders
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_resolve_action(
  p_actor_id uuid,p_event_id uuid,p_action text,p_roster_keys text[],p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,auth,pg_temp
AS $function$
DECLARE
  v_brand uuid; v_rollout jsonb; v_people uuid[]; v_attempts uuid[]; v_hash text;
BEGIN
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF p_action NOT IN ('reminder','retry_delivery') OR p_roster_keys IS NULL
     OR cardinality(p_roster_keys) NOT BETWEEN 1 AND 500
     OR cardinality(p_roster_keys)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_roster_keys)))
     OR p_channels IS NULL OR cardinality(p_channels) NOT BETWEEN 1 AND 3
     OR p_channels IS DISTINCT FROM ARRAY(SELECT DISTINCT x FROM unnest(p_channels) x ORDER BY x)
     OR NOT p_channels<@ARRAY['email','push','sms']::text[]
     OR NOT COALESCE((v_rollout->>CASE WHEN cardinality(p_roster_keys)>1 THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_invalid' USING ERRCODE='22023';
  END IF;
  WITH selected AS (
    SELECT row_data FROM public.biz_guest_roster_project(p_event_id)
    WHERE row_data->>'rosterKey'=ANY(p_roster_keys)
  )
  SELECT array_agg((row_data->>'personId')::uuid ORDER BY row_data->>'personId') INTO v_people
  FROM selected
  WHERE row_data->>'personId' IS NOT NULL
    AND CASE p_action WHEN 'reminder' THEN (row_data->>'canRemind')::boolean
      ELSE (row_data->>'canRetry')::boolean END;
  IF cardinality(COALESCE(v_people,'{}'))<>cardinality(p_roster_keys) THEN
    RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='40001';
  END IF;
  IF p_action='retry_delivery' THEN
    SELECT array_agg(id ORDER BY id) INTO v_attempts FROM (
      SELECT DISTINCT ON (i.brand_person_id,a.channel) a.id
      FROM public.brand_offering_invite_delivery_attempts a
      JOIN public.brand_offering_invites i ON i.id=a.invite_id
      WHERE i.event_id=p_event_id AND i.brand_person_id=ANY(v_people)
        AND a.channel=ANY(p_channels) AND a.status='failed' AND a.is_retryable
        AND NOT EXISTS (SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
          WHERE later.invite_id=a.invite_id AND later.channel=a.channel
            AND later.attempt_ordinal>a.attempt_ordinal)
      ORDER BY i.brand_person_id,a.channel,a.attempt_ordinal DESC
    ) q;
    IF cardinality(COALESCE(v_attempts,'{}'))=0 THEN
      RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='40001';
    END IF;
  END IF;
  v_hash:=encode(extensions.digest(convert_to(
    p_event_id::text||':'||p_action||':'||array_to_string(p_roster_keys,',')||':'||array_to_string(p_channels,','),'UTF8'
  ),'sha256'),'hex');
  IF p_action='reminder' THEN
    RETURN jsonb_build_object('selection',jsonb_build_object(
      'kind','resolved_brand_people_v1','brandPersonIds',to_jsonb(v_people),
      'selectionHash',v_hash,'source','guest_roster_actions'),
      'selectedCount',cardinality(p_roster_keys));
  END IF;
  RETURN jsonb_build_object('selection',jsonb_build_object(
    'kind','failed_attempts_v1','failedAttemptIds',to_jsonb(v_attempts),
    'selectionHash',v_hash,'source','guest_roster_actions'),
    'selectedCount',cardinality(p_roster_keys));
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_store_preview(
  p_actor_id uuid,p_event_id uuid,p_action text,p_selection jsonb,p_channels text[],
  p_selected_count integer,p_quote_hash text,p_estimated_cost_minor bigint,p_currency text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_brand uuid; v_id uuid;
BEGIN
  v_brand:=public.issue_1770_offering_actor_brand(p_actor_id,p_event_id,false);
  IF p_action NOT IN ('reminder','retry_delivery') OR p_selection->>'source'<>'guest_roster_actions'
     OR p_selected_count NOT BETWEEN 1 AND 500
     OR p_quote_hash!~'^[0-9a-f]{64}$' OR p_estimated_cost_minor<0
     OR (p_currency IS NOT NULL AND p_currency!~'^[A-Z]{3}$') THEN
    RAISE EXCEPTION 'guest_roster_preview_invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.guest_roster_action_previews(
    brand_id,event_id,actor_id,action,selection,selected_count,channels,quote_hash,
    estimated_cost_minor,currency,expires_at
  ) VALUES(v_brand,p_event_id,p_actor_id,p_action,p_selection,p_selected_count,p_channels,p_quote_hash,
    p_estimated_cost_minor,p_currency,now()+interval '5 minutes') RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_get_preview(
  p_actor_id uuid,p_preview_id uuid,p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v public.guest_roster_action_previews%ROWTYPE; v_rollout jsonb;
BEGIN
  SELECT * INTO v FROM public.guest_roster_action_previews WHERE id=p_preview_id FOR UPDATE;
  IF NOT FOUND OR v.actor_id<>p_actor_id
     OR public.issue_1770_offering_actor_brand(p_actor_id,v.event_id,false)<>v.brand_id THEN
    RAISE EXCEPTION 'guest_roster_preview_forbidden' USING ERRCODE='42501';
  END IF;
  IF v.consumed_at IS NOT NULL AND v.execute_client_request_id<>p_client_request_id THEN
    RAISE EXCEPTION 'guest_roster_preview_consumed' USING ERRCODE='23505';
  END IF;
  IF v.expires_at<now() AND v.consumed_at IS NULL THEN
    RAISE EXCEPTION 'guest_roster_preview_expired' USING ERRCODE='40001';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v.brand_id);
  IF NOT COALESCE((v_rollout->>CASE WHEN v.selected_count>1
    THEN 'bulkActionsEnabled' ELSE 'singleActionsEnabled' END)::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_action_disabled' USING ERRCODE='42501';
  END IF;
  IF v.consumed_at IS NULL AND v.action='reminder' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v.selection->'brandPersonIds') person_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.biz_guest_roster_project(v.event_id) r
      WHERE r.row_data->>'personId'=person_id AND (r.row_data->>'canRemind')::boolean
    )
  ) THEN RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('eventId',v.event_id,'action',v.action,'selection',v.selection,
    'channels',to_jsonb(v.channels),'quoteHash',v.quote_hash,
    'estimatedCostMinor',v.estimated_cost_minor,'currency',v.currency,
    'replayed',v.consumed_at IS NOT NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_consume_preview(
  p_actor_id uuid,p_preview_id uuid,p_client_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
BEGIN
  UPDATE public.guest_roster_action_previews SET consumed_at=COALESCE(consumed_at,now()),
    execute_client_request_id=COALESCE(execute_client_request_id,p_client_request_id)
  WHERE id=p_preview_id AND actor_id=p_actor_id
    AND (execute_client_request_id IS NULL OR execute_client_request_id=p_client_request_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_roster_preview_forbidden' USING ERRCODE='42501'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_list(
  p_event_id uuid,p_filter text DEFAULT 'all',p_search text DEFAULT NULL,
  p_sort text DEFAULT 'action_priority',p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_search text; v_rows jsonb; v_all jsonb;
  v_count integer; v_rank integer; v_watermark bigint; v_query_hash text; v_last jsonb;
  v_cursor_rank integer; v_cursor_name text; v_cursor_activity timestamptz; v_cursor_key text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rank:=public.biz_brand_effective_rank(v_brand,auth.uid());
  IF v_rank<public.biz_role_rank('event_manager') THEN
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
    OR p_limit NOT BETWEEN 1 AND 100
    OR (p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor)<>'object'
      OR public.issue_1770_json_keys(p_cursor)<>
        ARRAY['activityAt','name','queryHash','rank','rosterKey','watermark']::text[])) THEN
    RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
  END IF;
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\s+',' ','g'));
  IF length(v_search)>200 OR v_search~E'[\\x00-\\x1F\\x7F]' THEN RAISE EXCEPTION 'guest_roster_search_invalid' USING ERRCODE='22023'; END IF;
  v_query_hash:=encode(extensions.digest(convert_to(
    p_event_id::text||':'||p_filter||':'||v_search||':'||p_sort,'UTF8'
  ),'sha256'),'hex');
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events
  WHERE event_id=p_event_id;
  BEGIN
    IF p_cursor IS NOT NULL AND (
      (p_cursor->>'watermark')::bigint<>v_watermark
      OR p_cursor->>'queryHash'<>v_query_hash
    ) THEN RAISE EXCEPTION 'guest_roster_cursor_stale' USING ERRCODE='40001'; END IF;
    IF p_cursor IS NOT NULL THEN
      v_cursor_rank:=(p_cursor->>'rank')::integer;
      v_cursor_name:=p_cursor->>'name';
      v_cursor_activity:=(p_cursor->>'activityAt')::timestamptz;
      v_cursor_key:=p_cursor->>'rosterKey';
      IF v_cursor_name IS NULL OR v_cursor_key IS NULL OR v_cursor_activity IS NULL
         OR v_cursor_rank NOT BETWEEN 0 AND 9 THEN
        RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
      END IF;
    END IF;
  EXCEPTION WHEN serialization_failure THEN RAISE;
    WHEN OTHERS THEN RAISE EXCEPTION 'guest_roster_filter_invalid' USING ERRCODE='22023';
  END;
  WITH all_rows AS MATERIALIZED (SELECT row_data r FROM public.biz_guest_roster_project(p_event_id)),
  filtered AS (
    SELECT r FROM all_rows WHERE
      (v_search='' OR strpos(lower(r->>'displayName'),v_search)>0
        OR strpos(lower(COALESCE(r->>'contactLabel','')),v_search)>0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'orderIds') order_id WHERE lower(order_id)=v_search)
        OR EXISTS (
          SELECT 1 FROM public.brand_person_contact_methods contact
          WHERE contact.brand_person_id=(r->>'personId')::uuid
            AND contact.record_state='active' AND contact.provenance_scope='brand_owned'
            AND contact.is_exportable AND strpos(lower(contact.normalized_value),v_search)>0
        ))
      AND CASE p_filter
        WHEN 'all' THEN true WHEN 'no_response' THEN r->>'primaryStatus'='not_responded'
        WHEN 'confirmed' THEN r->>'primaryStatus' IN ('bought_ticket','going')
        WHEN 'needs_attention' THEN r->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')
        WHEN 'not_yet' THEN r->>'primaryStatus' IN ('not_responded','not_sent','sending','invite_failed','suppressed_or_skipped')
        WHEN 'delivery_failed' THEN r->>'invitationStatus'='failed'
        WHEN 'suppressed' THEN r->>'invitationStatus'='suppressed_or_skipped'
        WHEN 'checked_in' THEN (r->>'checkedIn')::boolean
        WHEN 'not_checked_in' THEN NOT (r->>'checkedIn')::boolean
        WHEN 'rsvpd' THEN r->>'rsvpId' IS NOT NULL
        WHEN 'ticketed' THEN (r->'party'->>'activeTickets')::integer>0
        ELSE r->>'primaryStatus'=p_filter END
  ), enriched AS (
    SELECT r,
      CASE r->>'primaryStatus' WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1
        WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END AS sort_rank,
      lower(r->>'displayName') AS sort_name,
      (r->>'latestActivityAt')::timestamptz AS sort_activity,
      r->>'rosterKey' AS sort_key
    FROM filtered
  ), after_cursor AS (
    SELECT * FROM enriched e WHERE p_cursor IS NULL OR CASE p_sort
      WHEN 'action_priority' THEN (e.sort_rank,e.sort_name,e.sort_key)>(v_cursor_rank,v_cursor_name,v_cursor_key)
      WHEN 'name_asc' THEN (e.sort_name,e.sort_key)>(v_cursor_name,v_cursor_key)
      WHEN 'name_desc' THEN e.sort_name<v_cursor_name OR (e.sort_name=v_cursor_name AND e.sort_key>v_cursor_key)
      WHEN 'recent_first' THEN e.sort_activity<v_cursor_activity OR (e.sort_activity=v_cursor_activity AND e.sort_key>v_cursor_key)
      ELSE false END
  ), page_rows AS (
    SELECT * FROM after_cursor ORDER BY
      CASE WHEN p_sort='action_priority' THEN sort_rank END,
      CASE WHEN p_sort='recent_first' THEN sort_activity END DESC,
      CASE WHEN p_sort IN ('action_priority','name_asc') THEN sort_name END,
      CASE WHEN p_sort='name_desc' THEN sort_name END DESC,
      sort_key LIMIT p_limit
  )
  SELECT
    COALESCE((SELECT jsonb_agg(
      CASE WHEN COALESCE((v_rollout->>'singleActionsEnabled')::boolean,false)
        THEN r ELSE r||jsonb_build_object('canRemind',false,'canRetry',false,'canApprove',false,'canDeny',false) END
      ORDER BY CASE WHEN p_sort='action_priority' THEN sort_rank END,
        CASE WHEN p_sort='recent_first' THEN sort_activity END DESC,
        CASE WHEN p_sort IN ('action_priority','name_asc') THEN sort_name END,
        CASE WHEN p_sort='name_desc' THEN sort_name END DESC,sort_key
    ) FROM page_rows),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(r) FROM all_rows),'[]'::jsonb),
    (SELECT count(*) FROM all_rows)
  INTO v_rows,v_all,v_count;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'summary',jsonb_build_object(
    'all',v_count,
    'notResponded',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus'='not_responded'),
    'confirmed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus' IN ('bought_ticket','going')),
    'needsAttention',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')),
    'invited',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='invited'),
    'notSent',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='not_sent'),
    'sending',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='sending'),
    'inviteFailed',(SELECT count(*) FROM jsonb_array_elements(v_all) x WHERE x->>'invitationStatus'='failed'),
    'watermark',v_watermark,
    'generatedAt',now()),'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit
      THEN jsonb_build_object(
        'rank',CASE v_last->>'primaryStatus' WHEN 'invite_failed' THEN 0 WHEN 'awaiting_approval' THEN 1
          WHEN 'not_responded' THEN 2 WHEN 'waitlisted' THEN 3 ELSE 9 END,
        'name',lower(v_last->>'displayName'),'activityAt',v_last->>'latestActivityAt',
        'rosterKey',v_last->>'rosterKey','queryHash',v_query_hash,'watermark',v_watermark
      ) ELSE NULL END,
    'staleAfter',now()+interval '30 seconds',
    'canBulkActions',COALESCE((v_rollout->>'bulkActionsEnabled')::boolean,false),
    'canExport',COALESCE((v_rollout->>'exportEnabled')::boolean,false)
      AND v_rank>=public.biz_role_rank('brand_admin'));
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

CREATE OR REPLACE FUNCTION public.biz_guest_roster_set_rsvp_approval(
  p_event_id uuid,p_roster_key text,p_decision text,p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_brand uuid; v_rollout jsonb; v_row jsonb; v_rsvp uuid; v_target text;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'guest_roster_forbidden' USING ERRCODE='42501';
  END IF;
  v_rollout:=public.biz_guest_roster_rollout(v_brand);
  IF NOT COALESCE((v_rollout->>'singleActionsEnabled')::boolean,false)
     OR p_decision NOT IN ('approve','deny') OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'guest_roster_action_invalid' USING ERRCODE='22023';
  END IF;
  SELECT row_data INTO v_row FROM public.biz_guest_roster_project(p_event_id)
  WHERE row_data->>'rosterKey'=p_roster_key;
  v_rsvp:=(v_row->>'rsvpId')::uuid;
  v_target:=CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'denied' END;
  IF v_rsvp IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.event_rsvps r WHERE r.id=v_rsvp
      AND r.event_id=p_event_id AND r.rsvp_status='going'
      AND r.approval_status IN ('pending',v_target)
  ) THEN RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='40001'; END IF;
  UPDATE public.event_rsvps SET approval_status=v_target WHERE id=v_rsvp AND approval_status<>v_target;
  SELECT row_data INTO v_row FROM public.biz_guest_roster_project(p_event_id)
  WHERE row_data->>'rosterKey'=p_roster_key;
  RETURN v_row;
END;
$function$;

-- Retry confirmation has a dedicated, locked execution boundary. Locking the
-- predecessor attempts first makes a concurrent second confirmation wait; the
-- fresh statement below then sees the first retry and fails closed.
CREATE OR REPLACE FUNCTION public.biz_execute_offering_delivery_retry(
  p_actor_id uuid,p_event_id uuid,p_failed_attempt_ids uuid[],p_channels text[],
  p_client_request_id uuid,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_selection jsonb; v_locked_count integer;
BEGIN
  IF p_failed_attempt_ids IS NULL OR cardinality(p_failed_attempt_ids) NOT BETWEEN 1 AND 500
     OR cardinality(p_failed_attempt_ids)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_failed_attempt_ids))) THEN
    RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
  END IF;
  PERFORM a.id FROM public.brand_offering_invite_delivery_attempts a
  WHERE a.id=ANY(p_failed_attempt_ids) ORDER BY a.id FOR UPDATE;
  SELECT count(*) INTO v_locked_count FROM public.brand_offering_invite_delivery_attempts a
  WHERE a.id=ANY(p_failed_attempt_ids);
  IF v_locked_count<>cardinality(p_failed_attempt_ids)
     OR EXISTS (
       SELECT 1 FROM public.brand_offering_invite_delivery_attempts a
       JOIN public.brand_offering_invites i ON i.id=a.invite_id
       WHERE a.id=ANY(p_failed_attempt_ids)
         AND (i.event_id<>p_event_id OR a.status<>'failed' OR NOT a.is_retryable
           OR NOT (a.channel=ANY(p_channels))
           OR EXISTS (
             SELECT 1 FROM public.brand_offering_invite_delivery_attempts later
             WHERE later.invite_id=a.invite_id AND later.channel=a.channel
               AND later.attempt_ordinal>a.attempt_ordinal
           ))
     ) THEN
    RAISE EXCEPTION 'guest_roster_status_changed' USING ERRCODE='40001';
  END IF;
  IF p_failed_attempt_ids IS DISTINCT FROM ARRAY(
    SELECT DISTINCT (x->>'predecessorAttemptId')::uuid
    FROM jsonb_array_elements(p_execution_snapshot->'candidates') x ORDER BY 1
  ) THEN
    RAISE EXCEPTION 'retry_attempt_selection_mismatch' USING ERRCODE='22023';
  END IF;
  v_selection:=jsonb_build_object(
    'kind','failed_attempts_v1','failedAttemptIds',to_jsonb(p_failed_attempt_ids),
    'selectionHash',p_execution_snapshot->>'selectionHash','source','guest_roster_actions'
  );
  RETURN public.biz_execute_offering_send_group(
    p_actor_id,p_event_id,'retry_delivery',v_selection,p_channels,
    p_client_request_id,p_execution_snapshot
  );
END;
$function$;

-- Keep the audited #1770 export owner, but teach its request boundary the
-- complete #873 roster filter vocabulary and enforce the export rollout before
-- a job is persisted. Brand-book behavior remains byte-for-byte equivalent.
CREATE OR REPLACE FUNCTION public.biz_export_brand_people(
  p_scope text,p_event_id uuid DEFAULT NULL,p_filter text DEFAULT 'all',p_search text DEFAULT NULL,
  p_sort text DEFAULT 'action_priority',p_filter_snapshot jsonb DEFAULT '{}'::jsonb,
  p_client_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp
AS $function$
DECLARE v_brand uuid; v_actor uuid:=auth.uid(); v_job public.brand_people_export_jobs%ROWTYPE;
  v_snapshot jsonb; v_hash text; v_search text;
BEGIN
  v_search:=lower(regexp_replace(btrim(COALESCE(p_search,'')),'\\s+',' ','g'));
  IF p_scope NOT IN ('brand_book','offering_guest_roster')
     OR (p_scope='brand_book' AND (p_event_id IS NOT NULL OR p_filter NOT IN ('all','reachable','suppressed')))
     OR (p_scope='offering_guest_roster' AND (p_event_id IS NULL OR p_filter NOT IN (
       'all','rsvpd','ticketed','not_yet','suppressed','needs_attention','no_response','confirmed',
       'checked_in','not_checked_in','delivery_failed','removed','going','maybe','awaiting_approval',
       'waitlisted','declined','denied','bought_ticket','refunded','cancelled','transferred')))
     OR p_sort NOT IN ('action_priority','name_asc','name_desc','recent_first')
     OR length(v_search)>200 OR v_search~E'[\\x00-\\x1F\\x7F]'
     OR p_filter_snapshot IS NULL OR jsonb_typeof(p_filter_snapshot)<>'object'
     OR p_filter_snapshot<>'{}'::jsonb THEN
    RAISE EXCEPTION 'export_filter_invalid' USING ERRCODE='22023';
  END IF;
  IF p_scope='offering_guest_roster' THEN
    SELECT brand_id INTO v_brand FROM public.events WHERE id=p_event_id AND deleted_at IS NULL;
  ELSE
    SELECT b.id INTO v_brand FROM public.brands b WHERE b.account_id=v_actor AND b.deleted_at IS NULL
    ORDER BY b.created_at,b.id LIMIT 1;
  END IF;
  IF v_actor IS NULL OR v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand,v_actor)<public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'brand_people_export_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_scope='offering_guest_roster'
     AND NOT COALESCE((public.biz_guest_roster_rollout(v_brand)->>'exportEnabled')::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_export_disabled' USING ERRCODE='42501';
  END IF;
  v_snapshot:=jsonb_build_object('filter',p_filter,'search',v_search,'sort',p_sort);
  v_hash:=encode(extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_job FROM public.brand_people_export_jobs
  WHERE brand_id=v_brand AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_job.filter_hash<>v_hash OR v_job.export_kind<>p_scope
       OR v_job.scope_id IS DISTINCT FROM p_event_id THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO public.brand_people_export_jobs(
      brand_id,export_kind,scope_id,filter_json,filter_hash,client_request_id,requested_by
    ) VALUES(v_brand,p_scope,p_event_id,v_snapshot,v_hash,p_client_request_id,v_actor)
    RETURNING * INTO v_job;
  END IF;
  RETURN jsonb_build_object('jobId',v_job.id,'status',v_job.status,'exportableCount',v_job.row_count,
    'omittedPersonCount',v_job.omitted_person_count,'omittedFieldCount',v_job.omitted_field_count,
    'result',CASE WHEN v_job.status='ready' THEN jsonb_build_object(
      'fileName',regexp_replace(v_job.storage_path,'^.*/',''),'expiresAt',v_job.expires_at
    ) ELSE NULL END);
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
  IF NOT COALESCE((public.biz_guest_roster_rollout(v_job.brand_id)->>'exportEnabled')::boolean,false) THEN
    RAISE EXCEPTION 'guest_roster_export_disabled' USING ERRCODE='42501';
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
      OR strpos(lower(COALESCE(r.row_data->>'contactLabel','')),v_job.filter_json->>'search')>0
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.row_data->'orderIds') order_id
        WHERE lower(order_id)=v_job.filter_json->>'search')
      OR EXISTS (
        SELECT 1 FROM public.brand_person_contact_methods contact
        WHERE contact.brand_person_id=(r.row_data->>'personId')::uuid
          AND contact.record_state='active' AND contact.provenance_scope='brand_owned'
          AND contact.is_exportable
          AND strpos(lower(contact.normalized_value),v_job.filter_json->>'search')>0
      ))
    AND CASE v_job.filter_json->>'filter'
      WHEN 'all' THEN true WHEN 'no_response' THEN r.row_data->>'primaryStatus'='not_responded'
      WHEN 'confirmed' THEN r.row_data->>'primaryStatus' IN ('bought_ticket','going')
      WHEN 'needs_attention' THEN r.row_data->>'primaryStatus' IN ('not_responded','invite_failed','awaiting_approval','waitlisted')
      WHEN 'delivery_failed' THEN r.row_data->>'invitationStatus'='failed'
      WHEN 'suppressed' THEN r.row_data->>'invitationStatus'='suppressed_or_skipped'
      WHEN 'checked_in' THEN (r.row_data->>'checkedIn')::boolean
      WHEN 'not_checked_in' THEN NOT (r.row_data->>'checkedIn')::boolean
      WHEN 'not_yet' THEN r.row_data->>'primaryStatus' IN ('not_responded','not_sent','sending','invite_failed','suppressed_or_skipped')
      WHEN 'rsvpd' THEN r.row_data->>'rsvpId' IS NOT NULL
      WHEN 'ticketed' THEN (r.row_data->'party'->>'activeTickets')::integer>0
      ELSE r.row_data->>'primaryStatus'=v_job.filter_json->>'filter' END
  ORDER BY
    CASE WHEN v_job.filter_json->>'sort'='action_priority' THEN
      CASE r.row_data->>'primaryStatus'
        WHEN 'invite_failed' THEN 1 WHEN 'awaiting_approval' THEN 2 WHEN 'waitlisted' THEN 3
        WHEN 'not_responded' THEN 4 ELSE 5 END END,
    CASE WHEN v_job.filter_json->>'sort'='recent_first' THEN r.row_data->>'latestActivityAt' END DESC NULLS LAST,
    CASE WHEN v_job.filter_json->>'sort' IN ('action_priority','name_asc') THEN lower(r.row_data->>'displayName') END,
    CASE WHEN v_job.filter_json->>'sort'='name_desc' THEN lower(r.row_data->>'displayName') END DESC,
    r.row_data->>'rosterKey';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_0873_emit_roster_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_event uuid; v_person uuid; v_kind text:=TG_ARGV[0];
BEGIN
  IF TG_TABLE_NAME='brand_people' THEN
    INSERT INTO public.guest_roster_change_events(event_id,roster_key,fact_kind)
    SELECT DISTINCT event_id,'person:'||(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END)::text,'identity' FROM (
      SELECT i.event_id FROM public.brand_offering_invites i WHERE i.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END)
      UNION ALL SELECT r.event_id FROM public.brand_person_source_links l JOIN public.event_rsvps r
        ON l.source_kind='event_rsvp' AND r.id=l.source_id WHERE l.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) AND l.detached_at IS NULL
      UNION ALL SELECT o.event_id FROM public.brand_person_source_links l JOIN public.orders o
        ON l.source_kind='order' AND o.id=l.source_id WHERE l.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) AND l.detached_at IS NULL
    ) affected;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='brand_person_contact_methods' THEN
    INSERT INTO public.guest_roster_change_events(event_id,roster_key,fact_kind)
    SELECT DISTINCT event_id,'person:'||(CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END)::text,'identity' FROM (
      SELECT i.event_id FROM public.brand_offering_invites i WHERE i.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END)
      UNION ALL SELECT r.event_id FROM public.brand_person_source_links l JOIN public.event_rsvps r
        ON l.source_kind='event_rsvp' AND r.id=l.source_id WHERE l.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END) AND l.detached_at IS NULL
      UNION ALL SELECT o.event_id FROM public.brand_person_source_links l JOIN public.orders o
        ON l.source_kind='order' AND o.id=l.source_id WHERE l.brand_person_id=(CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END) AND l.detached_at IS NULL
    ) affected;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='brand_person_source_links' THEN
    v_person:=CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END;
    IF (CASE WHEN TG_OP='DELETE' THEN OLD.source_kind ELSE NEW.source_kind END)='event_rsvp' THEN SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id=(CASE WHEN TG_OP='DELETE' THEN OLD.source_id ELSE NEW.source_id END);
    ELSIF (CASE WHEN TG_OP='DELETE' THEN OLD.source_kind ELSE NEW.source_kind END)='order' THEN SELECT o.event_id INTO v_event FROM public.orders o WHERE o.id=(CASE WHEN TG_OP='DELETE' THEN OLD.source_id ELSE NEW.source_id END);
    END IF;
  ELSIF TG_TABLE_NAME='guest_roster_brand_rollouts' THEN
    INSERT INTO public.guest_roster_change_events(event_id,roster_key,fact_kind)
    SELECT e.id,NULL,'rollout' FROM public.events e WHERE e.brand_id=(CASE WHEN TG_OP='DELETE' THEN OLD.brand_id ELSE NEW.brand_id END) AND e.deleted_at IS NULL;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='brand_offering_invites' THEN v_event:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END; v_person:=CASE WHEN TG_OP='DELETE' THEN OLD.brand_person_id ELSE NEW.brand_person_id END;
  ELSIF TG_TABLE_NAME='brand_offering_invite_delivery_attempts' THEN
    SELECT i.event_id,i.brand_person_id INTO v_event,v_person FROM public.brand_offering_invites i WHERE i.id=(CASE WHEN TG_OP='DELETE' THEN OLD.invite_id ELSE NEW.invite_id END);
  ELSIF TG_TABLE_NAME='event_rsvps' THEN v_event:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  ELSIF TG_TABLE_NAME='event_rsvp_guests' THEN SELECT r.event_id INTO v_event FROM public.event_rsvps r WHERE r.id=(CASE WHEN TG_OP='DELETE' THEN OLD.rsvp_id ELSE NEW.rsvp_id END);
  ELSIF TG_TABLE_NAME='orders' THEN v_event:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  ELSIF TG_TABLE_NAME='tickets' THEN v_event:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  END IF;
  IF v_event IS NOT NULL THEN
    INSERT INTO public.guest_roster_change_events(event_id,roster_key,fact_kind)
    VALUES(v_event,CASE WHEN v_person IS NULL THEN NULL ELSE 'person:'||v_person::text END,v_kind);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'issue_0873_roster_invalidation_failed table=% operation=% state=%',TG_TABLE_NAME,TG_OP,SQLSTATE;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE TRIGGER issue_0873_invite_change AFTER INSERT OR UPDATE OR DELETE ON public.brand_offering_invites
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('invitation');
CREATE TRIGGER issue_0873_delivery_change AFTER INSERT OR UPDATE OR DELETE ON public.brand_offering_invite_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('delivery');
CREATE TRIGGER issue_0873_rsvp_change AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('rsvp');
CREATE TRIGGER issue_0873_party_change AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvp_guests
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('party');
CREATE TRIGGER issue_0873_order_change AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('order');
CREATE TRIGGER issue_0873_ticket_change AFTER INSERT OR UPDATE OR DELETE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('ticket');
CREATE TRIGGER issue_0873_person_change AFTER UPDATE OF display_name,avatar_url,record_status,merged_into_person_id OR DELETE ON public.brand_people
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('identity');
CREATE TRIGGER issue_0873_contact_change AFTER INSERT OR UPDATE OF normalized_value,record_state,is_exportable,provenance_scope OR DELETE ON public.brand_person_contact_methods
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('identity');
CREATE TRIGGER issue_0873_source_link_change AFTER INSERT OR UPDATE OF brand_person_id,detached_at OR DELETE ON public.brand_person_source_links
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('identity');
CREATE TRIGGER issue_0873_rollout_change AFTER INSERT OR UPDATE OF phase OR DELETE ON public.guest_roster_brand_rollouts
FOR EACH ROW EXECUTE FUNCTION public.issue_0873_emit_roster_change('rollout');

CREATE OR REPLACE FUNCTION public.issue_0873_purge_roster_changes(p_limit integer DEFAULT 10000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $function$
DECLARE v_deleted integer;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'guest_roster_retention_limit_invalid' USING ERRCODE='22023'; END IF;
  WITH doomed AS (
    SELECT id FROM public.guest_roster_change_events
    WHERE occurred_at<now()-interval '7 days' ORDER BY id LIMIT p_limit
  ) DELETE FROM public.guest_roster_change_events e USING doomed d WHERE e.id=d.id;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

SELECT cron.schedule(
  'issue-0873-guest-roster-change-retention',
  '17 3 * * *',
  $$SELECT public.issue_0873_purge_roster_changes(10000);$$
);

REVOKE ALL ON FUNCTION public.biz_guest_roster_phase_rank(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_rollout(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_project(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_resolve_action(uuid,uuid,text,text[],text[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_store_preview(uuid,uuid,text,jsonb,text[],integer,text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_get_preview(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.biz_guest_roster_consume_preview(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_0873_emit_roster_change() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.issue_0873_purge_roster_changes(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_phase_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_rollout(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_project(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_resolve_action(uuid,uuid,text,text[],text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_store_preview(uuid,uuid,text,jsonb,text[],integer,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_get_preview(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_consume_preview(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_0873_emit_roster_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_0873_purge_roster_changes(integer) TO service_role;

REVOKE ALL ON FUNCTION public.biz_guest_roster_access(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_summary(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_detail(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_set_rsvp_approval(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_access(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_summary(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_detail(uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_set_rsvp_approval(uuid,text,text,uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_offering_guest_roster_export_rows(uuid) TO service_role;

COMMIT;
