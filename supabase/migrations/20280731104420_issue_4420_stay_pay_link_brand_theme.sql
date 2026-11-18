-- =====================================================================================
-- Issue #4420 — the Stay pay link (/stay/pay/{token}) wears the host's colours.
--
-- WHAT. issue_4188_staff_payment_link_details (service role only, called by the
-- stay-staff-payment-link edge function) now also returns the brand's PUBLIC display
-- fields that every other public page themes itself with:
--   brandSlug   brands.slug
--   brandTheme  { color, font, animation, gradient }  from brands.theme_color /
--               theme_font / theme_animation / theme_gradient — the same four columns
--               business_public_brands_view and business_public_events_view expose to anon.
-- A deleted brand (deleted_at set) returns null for both, exactly as the public views hide it.
-- Nothing private is added: no contact fields, account ids or payout details.
--
-- HOW. CREATE OR REPLACE with the current body from
-- 20280212004188_issue_4188_staff_stay_reservations.sql; every guard (service role,
-- not found / revoked, expired, not actionable), the last_opened_at stamp and every
-- existing key are unchanged. Grants are restated (service_role only).
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.issue_4188_staff_payment_link_details(
  p_token_hash bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_link public.stay_staff_payment_links%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_link
  FROM public.stay_staff_payment_links link
  WHERE link.token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND OR v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'stay_payment_link_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_payment_link_expired' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups reservation_group
  WHERE reservation_group.id = v_link.group_id;
  IF NOT FOUND OR v_group.state NOT IN (
    'instant_payment_pending', 'approved_payment_required', 'finalizing',
    'confirmed'
  ) THEN
    RAISE EXCEPTION 'stay_payment_link_not_actionable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_staff_payment_links
  SET last_opened_at = now(), updated_at = now()
  WHERE id = v_link.id;
  RETURN jsonb_build_object(
    'groupId', v_group.id,
    'publicReference', v_group.public_reference,
    'state', v_group.state,
    'version', v_group.version,
    'currencyCode', v_group.currency_code,
    'totalMinor', v_group.total_minor::text,
    'guestName', v_group.guest_snapshot->>'name',
    'venueName', (SELECT venue.name FROM public.venue_listings venue WHERE venue.id = v_group.venue_id),
    'brandName', (SELECT brand.name FROM public.brands brand WHERE brand.id = v_group.brand_id),
    -- #4420: the brand's public slug and theme (null for a deleted brand).
    'brandSlug', (
      SELECT brand.slug FROM public.brands brand
      WHERE brand.id = v_group.brand_id AND brand.deleted_at IS NULL
    ),
    'brandTheme', (
      SELECT jsonb_build_object(
        'color', brand.theme_color,
        'font', brand.theme_font,
        'animation', brand.theme_animation,
        'gradient', brand.theme_gradient
      )
      FROM public.brands brand
      WHERE brand.id = v_group.brand_id AND brand.deleted_at IS NULL
    ),
    'expiresAt', v_link.expires_at,
    'paid', v_group.state = 'confirmed',
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', line.kind,
        'name', line.offering_snapshot->>'name',
        'roomCheckIn', line.room_check_in,
        'roomCheckOut', line.room_check_out,
        'roomQuantity', line.room_quantity,
        'placeGuests', line.place_guests,
        'totalMinor', line.total_minor::text
      ) ORDER BY line.kind, line.id)
      FROM public.stay_reservation_lines line
      WHERE line.group_id = v_group.id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4188_staff_payment_link_details(bytea)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4188_staff_payment_link_details(bytea)
  TO service_role;
