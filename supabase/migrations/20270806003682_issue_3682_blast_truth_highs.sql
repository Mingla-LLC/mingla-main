-- #3682 Wave 1 Highs: real first_name on book/group/follower/circle sends + Last call starter tokens.
-- Append-only. Replaces hard-coded first_name 'there' in book + circle send resolvers
-- and rewrites the broken "Last call" starter template to use supported tokens only.
-- Sorts after 20270805003682 (auto-follow) so a fresh chain and db push both apply it.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_marketing_book_send_audience(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $f$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.marketing_book_send_executions WHERE campaign_id = p_campaign_id
  ) THEN
    RAISE EXCEPTION 'book_blast_unconfirmed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'contact_key', t.brand_person_id::text,
        'display_name', COALESCE(NULLIF(btrim(p.display_name), ''), 'there'),
        'first_name', COALESCE(
          NULLIF(split_part(btrim(COALESCE(p.display_name, '')), ' ', 1), ''),
          'there'
        ),
        'raw_email', CASE WHEN v_campaign.channel = 'email' THEN a.normalized_contact END,
        'raw_phone', CASE WHEN v_campaign.channel = 'sms' THEN a.normalized_contact END,
        'order_count', 0,
        'total_spend_minor', 0,
        'total_spend_currency', 'USD',
        'last_event_id', NULL,
        'last_event_name', NULL,
        'last_purchase_at', NULL,
        'email_marketing_ok', v_campaign.channel = 'email' AND a.allowed,
        'sms_marketing_ok', v_campaign.channel = 'sms' AND a.allowed,
        'receive_reason', COALESCE(
          (
            SELECT CASE s.source_kind
              WHEN 'order' THEN 'bought'
              WHEN 'ticket_holder' THEN 'bought'
              WHEN 'event_rsvp' THEN 'rsvp'
              WHEN 'rsvp_plus_one' THEN 'rsvp'
              WHEN 'reservation' THEN 'booking'
              WHEN 'import' THEN 'imported'
              WHEN 'manual' THEN 'added'
              ELSE 'added'
            END
            FROM public.brand_person_source_links s
            WHERE s.brand_person_id = t.brand_person_id
              AND s.detached_at IS NULL
            ORDER BY s.source_occurred_at DESC NULLS LAST
            LIMIT 1
          ),
          'added'
        )
      )
      ORDER BY t.brand_person_id
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.marketing_book_send_targets t
  JOIN public.marketing_book_send_executions e ON e.id = t.execution_id
  JOIN public.brand_people p ON p.id = t.brand_person_id
  JOIN LATERAL public.biz_brand_person_authorized_contact_v2(
    e.brand_id,
    t.brand_person_id,
    t.channel,
    'marketing_blast'
  ) a ON a.contact_method_id = t.contact_method_id AND a.allowed
  WHERE e.campaign_id = p_campaign_id
    AND t.outcome = 'queued'
    AND t.contact_value_digest = encode(
      extensions.digest(convert_to(a.normalized_contact, 'UTF8'), 'sha256'),
      'hex'
    );

  RETURN jsonb_build_object(
    'rows', v_rows,
    'brand_id', v_campaign.brand_id,
    'reach', jsonb_build_object(
      'total', jsonb_array_length(v_rows),
      'reachable_email', CASE WHEN v_campaign.channel = 'email' THEN jsonb_array_length(v_rows) ELSE 0 END,
      'reachable_sms', CASE WHEN v_campaign.channel = 'sms' THEN jsonb_array_length(v_rows) ELSE 0 END
    )
  );
END
$f$;

REVOKE ALL ON FUNCTION public.biz_marketing_book_send_audience(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_book_send_audience(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.biz_marketing_circle_send_audience_v1(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE; v_kind text; v_ring text; v_rows jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.marketing_campaigns WHERE id=p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  SELECT a.query_definition->>'kind' INTO v_kind FROM public.marketing_audiences a
  WHERE a.id=v_campaign.audience_id AND a.brand_id=v_campaign.brand_id;
  IF NOT FOUND OR v_kind NOT IN('brand_followers','brand_circle_extended')
    OR NOT EXISTS(SELECT 1 FROM public.marketing_book_send_executions e WHERE e.campaign_id=p_campaign_id)
  THEN RAISE EXCEPTION 'circle_blast_unconfirmed' USING ERRCODE='42501'; END IF;
  v_ring:=CASE v_kind WHEN 'brand_followers' THEN 'follower' ELSE 'extended' END;

  IF NOT public.issue_1995_flags_enabled()
    OR NOT public.issue_1778_ring_channel_enabled(v_kind,v_campaign.channel)
  THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object(
      'total',0,'reachable_email',0,'reachable_sms',0));
  END IF;

  WITH sealed AS MATERIALIZED (
    SELECT t.*,e.brand_id,e.actor_id
    FROM public.marketing_book_send_targets t
    JOIN public.marketing_book_send_executions e ON e.id=t.execution_id
    WHERE e.campaign_id=p_campaign_id AND t.outcome='queued'
      AND t.recipient_user_id IS NOT NULL AND t.ring=v_ring
  ), live AS MATERIALIZED (
    SELECT r.user_id,r.ring,r.display_name
    FROM public.issue_1777_resolve_brand_circle_members(
      v_campaign.brand_id,v_ring,array(SELECT s.recipient_user_id FROM sealed s)
    ) r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contact_key',t.recipient_user_id::text,
    'display_name',COALESCE(
      NULLIF(btrim(bp.display_name),''),
      NULLIF(btrim(l.display_name),''),
      'Mingla member'
    ),
    'first_name',COALESCE(
      NULLIF(split_part(btrim(COALESCE(
        NULLIF(btrim(bp.display_name),''),
        NULLIF(btrim(l.display_name),''),
        ''
      )),' ',1),''),
      'there'
    ),
    'raw_email',CASE WHEN v_campaign.channel='email' THEN a.normalized_contact END,
    'raw_phone',CASE WHEN v_campaign.channel='sms' THEN a.normalized_contact END,
    'order_count',0,'total_spend_minor',0,'total_spend_currency','USD',
    'last_event_id',NULL,'last_event_name',NULL,'last_purchase_at',NULL,
    'email_marketing_ok',v_campaign.channel='email' AND a.allowed,
    'sms_marketing_ok',v_campaign.channel='sms' AND a.allowed,
    'receive_reason',CASE v_kind
      WHEN 'brand_followers' THEN 'follows'
      ELSE 'friend_of_follower'
    END
  ) ORDER BY t.recipient_user_id),'[]'::jsonb) INTO v_rows
  FROM sealed t
  JOIN live l ON l.user_id=t.recipient_user_id AND l.ring=t.ring
  LEFT JOIN LATERAL (
    SELECT bp.display_name
    FROM public.brand_people bp
    WHERE bp.brand_id=t.brand_id
      AND bp.linked_user_id=t.recipient_user_id
      AND bp.record_status='active'
      AND bp.deleted_at IS NULL
    ORDER BY bp.updated_at DESC NULLS LAST
    LIMIT 1
  ) bp ON TRUE
  JOIN LATERAL public.issue_1778_circle_authorized_contact(t.brand_id,t.recipient_user_id,t.channel) a ON a.allowed
  WHERE t.contact_value_digest=encode(extensions.digest(convert_to(a.normalized_contact,'UTF8'),'sha256'),'hex')
    AND NOT EXISTS(SELECT 1 FROM public.blocked_users b WHERE
      (b.blocker_id=t.actor_id AND b.blocked_id=t.recipient_user_id) OR
      (b.blocker_id=t.recipient_user_id AND b.blocked_id=t.actor_id));
  RETURN jsonb_build_object('rows',v_rows,'brand_id',v_campaign.brand_id,'reach',jsonb_build_object(
    'total',jsonb_array_length(v_rows),
    'reachable_email',CASE WHEN v_campaign.channel='email' THEN jsonb_array_length(v_rows) ELSE 0 END,
    'reachable_sms',CASE WHEN v_campaign.channel='sms' THEN jsonb_array_length(v_rows) ELSE 0 END));
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_marketing_circle_send_audience_v1(uuid) TO service_role;

UPDATE public.marketing_templates
SET
  subject_template = 'Almost sold out — see you {event_date}',
  body_template =
    'Hi {first_name},'
    || E'\n\n'
    || 'Just a heads up — tickets for {event_name} on {event_date} are going fast. '
    || 'See you there.'
    || E'\n\n'
    || '— {brand_name} via Mingla',
  updated_at = now()
WHERE id = '00000815-0001-0000-0000-000000000001'::uuid
  AND is_starter_pack = true;

COMMIT;
