-- issue #4420 wave 2 (D-S7) — the "booked under another email" page's two
-- recovery actions: "Email me the booking link again" and "Ask {Stay} to
-- change the email".
--
-- Two SERVICE-ROLE-ONLY functions, called by the stay-reservations edge
-- function after the caller's own read of the group was refused:
--
--   issue_4420_stay_group_other_contact_view(uuid)
--     What the page may show a non-owner: the masked address, the Stay's name,
--     the brand (for the enquiry), and the booking reference (so the host can
--     find the booking). Never dates, rooms, totals or the full address.
--
--   issue_4420_stay_group_resend_link(uuid)
--     Re-sends the booking's own guest email to the booking's OWN address,
--     never to the caller. At most once per group per ten minutes (the
--     outbox idempotency key carries the ten-minute bucket), and only while
--     the booking has a guest email to resend ("Your Stay is confirmed" or
--     "Payment needed"). Returns the masked address it went to, or NULL when
--     there is nothing to resend.

CREATE OR REPLACE FUNCTION public.issue_4420_stay_group_other_contact_view(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'masked_email', public.issue_4420_mask_email(g.guest_snapshot->>'email'),
    'public_reference', g.public_reference,
    'venue_name', v.name,
    'brand_slug', b.slug,
    'brand_name', b.name,
    'resendable', g.state IN (
      'confirmed', 'approved_payment_required', 'instant_payment_pending'
    )
  )
  FROM public.stay_reservation_groups g
  JOIN public.venue_listings v ON v.id = g.venue_id
  JOIN public.brands b ON b.id = g.brand_id
  WHERE g.id = p_group_id;
$function$;

COMMENT ON FUNCTION public.issue_4420_stay_group_other_contact_view(uuid) IS
  'issue #4420 — what the booked-under-another-email page may show a non-owner: masked email, Stay and brand names, reference, and whether a resend is possible (service role only).';

REVOKE ALL ON FUNCTION public.issue_4420_stay_group_other_contact_view(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_4420_stay_group_other_contact_view(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_stay_group_other_contact_view(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4420_stay_group_resend_link(p_group_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_email text;
  v_category text;
  v_bucket bigint;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_category := CASE v_group.state
    WHEN 'confirmed' THEN 'stay_reservation_confirmed'
    WHEN 'approved_payment_required' THEN 'stay_payment_required'
    WHEN 'instant_payment_pending' THEN 'stay_payment_required'
    ELSE NULL
  END;
  IF v_category IS NULL THEN
    RETURN NULL;
  END IF;

  -- The booking's OWN address: the contact the guest gave, else the account.
  SELECT COALESCE(
    NULLIF(pg_catalog.btrim(v_group.guest_snapshot->>'email'), ''),
    u.email
  )
  INTO v_email
  FROM (SELECT 1) one
  LEFT JOIN auth.users u ON u.id = v_group.user_id;
  IF v_email IS NULL OR position('@' IN v_email) < 2 THEN
    RETURN NULL;
  END IF;

  v_bucket := floor(extract(epoch FROM pg_catalog.now()) / 600)::bigint;

  -- Email leg only: a country cannot be derived from an email (#1529), so
  -- country_code is an explicit NULL, the same as the Stay producer's email leg.
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key,
    country_code
  ) VALUES (
    v_category,
    v_group.user_id,
    lower(v_email),
    v_group.brand_id,
    jsonb_build_object(
      'stay_group_id', v_group.id,
      'public_reference', v_group.public_reference,
      'venue_id', v_group.venue_id,
      'amount_cents', v_group.total_minor,
      'currency', v_group.currency_code,
      'payment_deadline', v_group.payment_deadline,
      'request_deadline', v_group.request_deadline,
      'title', 'Your Stay reservation',
      'body', CASE v_category
        WHEN 'stay_payment_required'
          THEN 'Here is your Stay booking link again. Complete payment before the deadline.'
        ELSE 'Here is your Stay booking link again.'
      END,
      'resent', true
    ),
    'stay:' || v_group.id || ':' || v_category || ':resend:' || v_bucket,
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN public.issue_4420_mask_email(v_email);
END;
$function$;

COMMENT ON FUNCTION public.issue_4420_stay_group_resend_link(uuid) IS
  'issue #4420 — re-send a Stay booking''s guest email to the booking''s own address (at most once per 10 minutes per group); returns the masked address or NULL (service role only).';

REVOKE ALL ON FUNCTION public.issue_4420_stay_group_resend_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_4420_stay_group_resend_link(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_stay_group_resend_link(uuid) TO service_role;
