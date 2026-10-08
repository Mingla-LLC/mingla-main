-- #3682 Wave 1 Highs: real first_name on book/group/follower sends + Last call starter tokens.
-- Append-only. Replaces the hard-coded first_name 'there' in biz_marketing_book_send_audience
-- and rewrites the broken "Last call" starter template to use supported tokens only.

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
              WHEN 'event_rsvp' THEN 'bought'
              WHEN 'rsvp_plus_one' THEN 'bought'
              WHEN 'reservation' THEN 'bought'
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

-- Last call starter: drop unsupported short-date and empty event-card tokens.
-- Use {event_date}; composers may still embed a real {{event:UUID}} card.
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
