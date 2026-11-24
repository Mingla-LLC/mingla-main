-- Issue #4490, Explorer app W1: handoff and app-only pass.
-- 1. Claim links gain venue_booking, venue_membership, venue_waitlist and
--    venue_till_sale (claim purpose). Redirect shape rules are unchanged.
-- 2. mint_claim_link (latest 20271219014063) accepts the new kinds.
-- 3. issue_4063_claim_subject (latest 20271218034063): stay_group no longer
--    resolves an offer booking; the new kinds resolve with nouns the app knows
--    (pass, pass, booking; receipt for Till once spec 08 adds Till payments).
-- 4. Booking and member projections (latest 20281203164490, 20281203244490)
--    gain only 'passInApp'. The QR rule is unchanged.
-- 5. Flags VENUE_APP_HANDOFF and VENUE_PASS_APP_ONLY, both off.

ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS claim_links_subject_kind_check;
ALTER TABLE public.claim_links ADD CONSTRAINT claim_links_subject_kind_check
  CHECK (subject_kind IN (
    'order','rsvp','rsvp_guest','reservation','stay_group','venue_order',
    'ticket','waitlist_offer','event_page',
    'venue_booking','venue_membership','venue_waitlist','venue_till_sale'
  ));

-- Re-emitted from 20271218034063_issue_4063_claim_links_and_contacts.sql.
CREATE OR REPLACE FUNCTION public.issue_4063_claim_subject(
  p_subject_kind text,
  p_subject_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  CASE p_subject_kind
    WHEN 'order' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(o.buyer_email, ''))),
        'phone', nullif(btrim(coalesce(o.buyer_phone_e164, '')), ''),
        'name', nullif(btrim(coalesce(o.buyer_name, '')), ''),
        'title', e.title,
        'brandName', b.name,
        'startsAt', coalesce(ed.start_at, o.booked_start_at, md.start_at),
        'anchor', coalesce(ed.end_at, o.booked_end_at, md.end_at, o.created_at),
        'timezone', coalesce(ed.timezone, e.timezone),
        'quantity', greatest(1, coalesce((
          SELECT sum(greatest(1, li.quantity))::integer
            FROM public.order_line_items li WHERE li.order_id = o.id
        ), (
          SELECT count(*)::integer FROM public.tickets t WHERE t.order_id = o.id
        ), 1)),
        'noun', CASE
          WHEN o.source = 'door_sale' THEN 'receipt'
          WHEN coalesce(e.event_type, 'event') IN ('trip','experience') THEN 'booking'
          ELSE 'ticket'
        END,
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(o.buyer_email, '')), '') IS NOT NULL
            AND (
              nullif(btrim(coalesce(o.buyer_phone_e164, '')), '') IS NULL
              OR (o.source = 'online_checkout' AND o.purchased_by_user_id IS NULL)
              OR (o.ticket_link_id IS NOT NULL AND o.comp_party_lead_order_id IS NULL)
            ) THEN 'email'
          WHEN nullif(btrim(coalesce(o.buyer_phone_e164, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', o.buyer_user_id IS NOT NULL
      ) INTO v_result
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      LEFT JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates ed ON ed.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at
          FROM public.event_dates d
         WHERE d.event_id = o.event_id AND d.is_master
         ORDER BY d.start_at LIMIT 1
      ) md ON true
      WHERE o.id = p_subject_id;

    WHEN 'rsvp' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(r.guest_email, ''))),
        'phone', nullif(btrim(coalesce(r.guest_phone, '')), ''),
        'name', nullif(btrim(coalesce(r.guest_name, '')), ''),
        'title', e.title,
        'brandName', b.name,
        'startsAt', md.start_at,
        'anchor', coalesce(md.end_at, r.created_at),
        'timezone', e.timezone,
        'quantity', 1 + coalesce(r.plus_count, 0),
        'noun', 'pass',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(r.guest_email, '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(r.guest_phone, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', r.user_id IS NOT NULL
      ) INTO v_result
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      LEFT JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at
          FROM public.event_dates d
         WHERE d.event_id = r.event_id AND d.is_master
         ORDER BY d.start_at LIMIT 1
      ) md ON true
      WHERE r.id = p_subject_id;

    WHEN 'rsvp_guest' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(g.email, ''))),
        'phone', nullif(btrim(coalesce(g.phone, '')), ''),
        'name', nullif(btrim(coalesce(g.name, '')), ''),
        'title', e.title,
        'brandName', b.name,
        'startsAt', md.start_at,
        'anchor', coalesce(md.end_at, g.created_at),
        'timezone', e.timezone,
        'quantity', 1,
        'noun', 'pass',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(g.email, '')), '') IS NOT NULL
            AND nullif(btrim(coalesce(g.phone, '')), '') IS NULL THEN 'email'
          WHEN nullif(btrim(coalesce(g.phone, '')), '') IS NOT NULL THEN 'phone'
          WHEN nullif(btrim(coalesce(g.email, '')), '') IS NOT NULL THEN 'email'
          ELSE 'any'
        END,
        'claimed', g.matched_user_id IS NOT NULL
      ) INTO v_result
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      LEFT JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.end_at
          FROM public.event_dates d
         WHERE d.event_id = r.event_id AND d.is_master
         ORDER BY d.start_at LIMIT 1
      ) md ON true
      WHERE g.id = p_subject_id;

    WHEN 'reservation' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(r.guest_email, ''))),
        'phone', nullif(btrim(coalesce(r.guest_phone_e164, '')), ''),
        'name', nullif(btrim(coalesce(r.guest_name, '')), ''),
        'title', coalesce(v.name, b.name, 'Venue booking'),
        'brandName', b.name,
        'startsAt', r.reserved_for,
        'anchor', r.reserved_for,
        'timezone', CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
          ELSE vac.iana_timezone END,
        'quantity', greatest(1, coalesce(r.party_size, 1)),
        'noun', 'booking',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(r.guest_email, '')), '') IS NOT NULL
            AND (nullif(btrim(coalesce(r.guest_phone_e164, '')), '') IS NULL
              OR r.created_via IN ('consumer','guest')) THEN 'email'
          WHEN nullif(btrim(coalesce(r.guest_phone_e164, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', r.consumer_user_id IS NOT NULL
      ) INTO v_result
      FROM public.reservations r
      LEFT JOIN public.venue_listings v ON v.id = r.venue_id
      LEFT JOIN public.brands b ON b.id = r.brand_id
      LEFT JOIN LATERAL (
        SELECT c.iana_timezone, c.iana_timezone_source
          FROM public.venue_availability_config c
         WHERE c.venue_id = r.venue_id
         ORDER BY c.updated_at DESC LIMIT 1
      ) vac ON true
      WHERE r.id = p_subject_id;

    WHEN 'stay_group' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(g.guest_snapshot->>'email', ''))),
        'phone', nullif(btrim(coalesce(g.guest_snapshot->>'phoneE164',
          g.guest_snapshot->>'phone', '')), ''),
        'name', nullif(btrim(coalesce(g.guest_snapshot->>'name', '')), ''),
        'title', coalesce(v.name, b.name, 'Stay booking'),
        'brandName', b.name,
        'startsAt', g.created_at,
        'anchor', now(),
        'timezone', NULL,
        'quantity', 1,
        'noun', 'booking',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(g.guest_snapshot->>'email', '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(g.guest_snapshot->>'phoneE164',
            g.guest_snapshot->>'phone', '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', g.user_id IS NOT NULL
      ) INTO v_result
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings v ON v.id = g.venue_id
      LEFT JOIN public.brands b ON b.id = g.brand_id
      -- #4490 explorer W1: venue offer bookings have their own kind.
      WHERE g.id = p_subject_id AND g.offer_kind IS NULL;

    -- #4490 explorer W1: a venue offer booking (entry, package, hire, by the hour).
    WHEN 'venue_booking' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(g.guest_snapshot->>'email', ''))),
        'phone', nullif(btrim(coalesce(g.guest_snapshot->>'phoneE164',
          g.guest_snapshot->>'phone', '')), ''),
        'name', nullif(btrim(coalesce(g.guest_snapshot->>'name', '')), ''),
        'title', coalesce(v.name, b.name, 'Venue booking'),
        'brandName', b.name,
        'startsAt', w.starts_at,
        'anchor', coalesce(w.ends_at, w.starts_at, g.created_at),
        'timezone', CASE WHEN v.id IS NULL THEN NULL ELSE public.issue_4490_venue_timezone(v.id) END,
        'quantity', greatest(1, coalesce((
          SELECT sum(greatest(1, coalesce(l.place_guests, 1)))::integer
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id
        ), 1)),
        'noun', 'pass',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(g.guest_snapshot->>'email', '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(g.guest_snapshot->>'phoneE164',
            g.guest_snapshot->>'phone', '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', g.user_id IS NOT NULL
      ) INTO v_result
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings v ON v.id = g.venue_id
      LEFT JOIN public.brands b ON b.id = g.brand_id
      LEFT JOIN public.stay_place_windows w ON w.id = public.issue_4490_group_window_id(g.id)
      WHERE g.id = p_subject_id
        AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        -- N156: a pass exists only for a paid, live booking. Held, unpaid,
        -- reconciliation_required, declined, expired and cancelled bookings
        -- resolve to nothing, so no claim link is minted for them.
        AND g.state IN ('confirmed', 'partially_cancelled');

    -- #4490 explorer W1: a membership (the plan name is the title).
    WHEN 'venue_membership' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(s.member_email, ''))),
        'phone', nullif(btrim(coalesce(s.member_phone, '')), ''),
        'name', nullif(btrim(coalesce(s.member_name, '')), ''),
        'title', p.name,
        'brandName', b.name,
        'startsAt', coalesce(s.current_period_start, s.start_on::timestamptz),
        'anchor', coalesce(s.current_period_end, s.created_at),
        'timezone', CASE WHEN v.id IS NULL THEN NULL ELSE public.issue_4490_venue_timezone(v.id) END,
        'quantity', 1,
        'noun', 'pass',
        'orderLabel', NULL,
        'preferredProof', 'email',
        'claimed', s.user_id IS NOT NULL
      ) INTO v_result
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      LEFT JOIN public.stay_offerings o ON o.id = p.offering_id
      LEFT JOIN public.venue_listings v ON v.id = o.venue_id
      LEFT JOIN public.brands b ON b.id = s.brand_id
      -- N156: only a paid membership has a member pass.
      WHERE s.id = p_subject_id AND s.status IN ('active', 'payment_due', 'grace');

    -- #4490 explorer W1: an open place in a venue's line.
    WHEN 'venue_waitlist' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(wl.guest_email, ''))),
        'phone', nullif(btrim(coalesce(wl.guest_phone_e164, '')), ''),
        'name', nullif(btrim(coalesce(wl.guest_name, '')), ''),
        'title', coalesce(v.name, b.name, 'Waitlist'),
        'brandName', b.name,
        'startsAt', CASE WHEN wl.desired_date IS NULL THEN NULL
          ELSE ((wl.desired_date + coalesce(wl.desired_from, time '00:00'))
                AT TIME ZONE public.issue_4490_venue_timezone(v.id)) END,
        'anchor', coalesce(CASE WHEN wl.desired_date IS NULL THEN NULL
          ELSE ((wl.desired_date + coalesce(wl.desired_to, time '23:59'))
                AT TIME ZONE public.issue_4490_venue_timezone(v.id)) END, wl.created_at),
        'timezone', public.issue_4490_venue_timezone(v.id),
        'quantity', greatest(1, wl.party_size),
        'noun', 'booking',
        'orderLabel', NULL,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(wl.guest_email, '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(wl.guest_phone_e164, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', wl.consumer_user_id IS NOT NULL
      ) INTO v_result
      FROM public.venue_waitlist wl
      JOIN public.venue_listings v ON v.id = wl.venue_id
      LEFT JOIN public.brands b ON b.id = wl.brand_id
      WHERE wl.id = p_subject_id AND wl.status IN ('waiting', 'notified');

    -- #4490 explorer W1 addendum: Till receipts. The Till payment table is
    -- created by spec 08; until it exists no Till subject resolves, so a mint
    -- answers claim_subject_not_found and "Open in Mingla" stays hidden.
    WHEN 'venue_till_sale' THEN
      v_result := NULL;

    WHEN 'venue_order' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(o.buyer_email, ''))),
        'phone', nullif(btrim(coalesce(o.buyer_phone_e164, '')), ''),
        'name', nullif(btrim(coalesce(o.buyer_name, '')), ''),
        'title', coalesce(v.name, b.name, 'Food order'),
        'brandName', b.name,
        'startsAt', o.created_at,
        'anchor', o.created_at,
        'timezone', NULL,
        'quantity', greatest(1, coalesce((
          SELECT sum(greatest(1, i.quantity))::integer
            FROM public.venue_order_items i WHERE i.venue_order_id = o.id
        ), 1)),
        'noun', 'receipt',
        'orderLabel', CASE WHEN nullif(btrim(coalesce(o.pickup_code, '')), '') IS NOT NULL
          THEN 'Order #' || btrim(o.pickup_code)
          ELSE 'Order ' || upper(left(replace(o.id::text, '-', ''), 8)) END,
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(o.buyer_email, '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(o.buyer_phone_e164, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', o.buyer_user_id IS NOT NULL
      ) INTO v_result
      FROM public.venue_orders o
      LEFT JOIN public.venue_listings v ON v.id = o.venue_id
      LEFT JOIN public.brands b ON b.id = o.brand_id
      WHERE o.id = p_subject_id;

    WHEN 'ticket' THEN
      RAISE EXCEPTION 'claim_kind_unavailable' USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'claim_kind_invalid' USING ERRCODE = '22023';
  END CASE;
  RETURN v_result;
END;
$function$;

-- Re-emitted from 20271219014063_issue_4063_ticket_send_to_friend.sql.
CREATE OR REPLACE FUNCTION public.mint_claim_link(
  p_subject_kind text,
  p_subject_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_subject jsonb;
  v_expiry timestamptz;
  v_existing_expiry timestamptz;
  v_code text;
  v_try integer;
BEGIN
  IF p_subject_kind NOT IN (
    'order','rsvp','rsvp_guest','reservation','stay_group','venue_order','ticket',
    -- #4490 explorer W1: venue offer bookings, memberships, waitlist places and Till receipts.
    'venue_booking','venue_membership','venue_waitlist','venue_till_sale'
  ) OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'claim_kind_invalid' USING ERRCODE = '22023';
  END IF;

  v_subject := CASE WHEN p_subject_kind = 'ticket'
    THEN public.issue_4063_ticket_claim_subject(p_subject_id)
    ELSE public.issue_4063_claim_subject(p_subject_kind, p_subject_id) END;
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'claim_subject_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_expiry := greatest(
    now() + interval '30 days',
    coalesce((v_subject->>'anchor')::timestamptz, now()) + interval '7 days'
  );

  UPDATE public.claim_links
     SET expires_at = greatest(expires_at, v_expiry)
   WHERE purpose = 'claim' AND subject_kind = p_subject_kind
     AND subject_id = p_subject_id AND revoked_at IS NULL
  RETURNING code, expires_at INTO v_code, v_existing_expiry;
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object(
      'code', v_code, 'expiresAt', v_existing_expiry,
      'claimed', coalesce((v_subject->>'claimed')::boolean, false)
    );
  END IF;

  FOR v_try IN 1..5 LOOP
    v_code := public.issue_4063_claim_code();
    BEGIN
      INSERT INTO public.claim_links(
        code, purpose, subject_kind, subject_id, expires_at
      ) VALUES (v_code, 'claim', p_subject_kind, p_subject_id, v_expiry);
      RETURN jsonb_build_object(
        'code', v_code, 'expiresAt', v_expiry,
        'claimed', coalesce((v_subject->>'claimed')::boolean, false)
      );
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.claim_links
         SET expires_at = greatest(expires_at, v_expiry)
       WHERE purpose = 'claim' AND subject_kind = p_subject_kind
         AND subject_id = p_subject_id AND revoked_at IS NULL
      RETURNING code, expires_at INTO v_code, v_existing_expiry;
      IF v_code IS NOT NULL THEN
        RETURN jsonb_build_object(
          'code', v_code, 'expiresAt', v_existing_expiry,
          'claimed', coalesce((v_subject->>'claimed')::boolean, false)
        );
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'claim_code_unavailable' USING ERRCODE = 'P0001';
END;
$function$;

-- Re-emitted from 20281203164490_issue_4490_p5_tables_floor_hour.sql.
CREATE OR REPLACE FUNCTION public.issue_4490_booking_projection(p_group_id uuid, p_qr_pepper text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'groupId', g.id,
    'reference', g.public_reference,
    'offerKind', g.offer_kind,
    'state', g.state,
    'version', g.version,
    'bookingSource', g.booking_source,
    'paymentCollection', g.payment_collection,
    'currencyCode', g.currency_code,
    'subtotalMinor', g.source_subtotal_minor,
    'feeMinor', g.fee_total_minor,
    'taxMinor', g.tax_total_minor,
    'totalMinor', g.total_minor,
    'paidMinor', COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
                           WHERE a.group_id = g.id AND a.state = 'succeeded'), 0),
    'refundedMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = g.id AND r.state IN ('submitted', 'processing', 'succeeded')), 0),
    'balanceDueMinor', money.balance,
    -- #4490 P4: while an approved hire is on hold, what is due now is the
    -- deposit (or everything when no deposit applies).
    'amountDueNowMinor', CASE
      WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla' THEN g.total_minor
      WHEN g.state = 'approved_payment_required' AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now() THEN g.deposit_minor ELSE money.total_due END
      ELSE money.balance END,
    'holdUntil', (SELECT h.expires_at FROM public.stay_inventory_holds h
                  WHERE h.group_id = g.id AND h.state = 'active'),
    'guest', jsonb_build_object(
      'name', g.guest_snapshot->>'name',
      'email', g.guest_snapshot->>'email',
      'phone', g.guest_snapshot->>'phone'),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug,
                'brandSlug', b.slug, 'brandName', b.name, 'address', v.address, 'city', v.city,
                'lat', v.lat, 'lng', v.lng, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = g.venue_id),
    'offer', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style)
              FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'window', (SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
               FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id, 'state', l.state, 'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'bookedGuests', l.place_guests, 'unit', l.price_snapshot->>'unit',
        'packageMinor', (l.price_snapshot->>'packageMinor')::bigint,
        'extrasMinor', (l.price_snapshot->>'extrasMinor')::bigint,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor, 'taxMinor', l.tax_minor, 'feeMinor', l.fee_minor, 'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = g.id), '[]'::jsonb),
    'policy', jsonb_build_object(
      'text', g.payment_plan_snapshot->>'policyText',
      'refundLadder', g.payment_plan_snapshot->'refundLadder',
      'dateChangeRule', g.payment_plan_snapshot->'dateChangeRule'),
    'vatMode', g.payment_plan_snapshot->>'vatMode',
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,
        'holderName', p.holder_name, 'idCheckLabel', p.id_check_label, 'idCheckCount', p.id_check_count,
        'qrPayload', CASE WHEN p_qr_pepper IS NOT NULL AND p.status = 'valid'
                          THEN public.issue_4490_pass_qr_payload(p.id, p.qr_token_hash, p_qr_pepper) END)
        ORDER BY p.created_at)
      FROM public.venue_passes p WHERE p.group_id = g.id), '[]'::jsonb),
    'createdAt', g.created_at,
    'updatedAt', g.updated_at,
    -- #4490 explorer W1: the app-only pass switch. The QR rule itself is
    -- unchanged (qrPayload only with a pepper); the edge withholds the pepper.
    'passInApp', public.issue_4490_flag_on('VENUE_PASS_APP_ONLY')
  ) || jsonb_build_object(
    'totalDueMinor', money.total_due,
    'paidOnlineMinor', money.paid_online,
    'paidAtVenueMinor', money.paid_offline,
    'changesMinor', money.changes_minor,
    'depositMinor', g.deposit_minor,
    'balanceDueAt', g.balance_due_at,
    'payModes', CASE
      WHEN g.state IN ('instant_payment_pending', 'approved_payment_required') AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now()
             THEN jsonb_build_array(
               jsonb_build_object('mode', 'deposit', 'amountMinor', g.deposit_minor),
               jsonb_build_object('mode', 'full', 'amountMinor', money.total_due))
             ELSE jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', money.total_due)) END
      ELSE '[]'::jsonb END,
    'extras', COALESCE((
      SELECT jsonb_agg(x ORDER BY ord)
      FROM (
        SELECT x, 1 AS ord FROM public.stay_reservation_lines l, jsonb_array_elements(COALESCE(l.price_snapshot->'extras', '[]'::jsonb)) x
        WHERE l.group_id = g.id
        UNION ALL
        SELECT x || jsonb_build_object('addedAt', a.created_at), 2 FROM public.venue_booking_amendments a,
          jsonb_array_elements(a.extras) x
        WHERE a.group_id = g.id AND a.kind = 'add_extras'
      ) all_extras), '[]'::jsonb),
    'answers', g.booking_answers,
    'inclusions', (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'kind', COALESCE(i->>'kind', 'item'), 'label', i->>'label', 'qtyPer', i->>'qty_per',
          'staffRatio', (i->>'staff_ratio')::integer)) ORDER BY ord), '[]'::jsonb)
        FROM public.stay_reservation_lines l
        JOIN public.stay_offerings o ON o.id = l.offering_id,
        jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)
        WHERE l.id = (SELECT l2.id FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                      ORDER BY l2.created_at, l2.id LIMIT 1)),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'changeId', a.id, 'kind', a.kind, 'fromGuests', a.from_guests, 'toGuests', a.to_guests,
        'fromDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.from_window_id),
        'toDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.to_window_id),
        'extras', CASE WHEN jsonb_array_length(a.extras) > 0 THEN a.extras END,
        'amountMinor', a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor,
        'feeMinor', a.policy_fee_minor, 'refundMinor', a.refund_minor, 'by', a.actor_type,
        'createdAt', a.created_at)) ORDER BY a.created_at)
      FROM public.venue_booking_amendments a WHERE a.group_id = g.id), '[]'::jsonb),
    'changeRules', public.issue_4490_change_rules(g.id),
    'requestDeadline', g.request_deadline,
    'paymentDeadline', g.payment_deadline,
    'hire', public.issue_4490_hire_booking_facts(g.id),
    -- #4490 P5: by the hour (the unit claimed, the hours, no-show release).
    'hour', public.issue_4490_hour_booking_facts(g.id)
  )
  FROM public.stay_reservation_groups g
  CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) money
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;

-- Re-emitted from 20281203244490_issue_4490_fix3_event_takes_space.sql.
CREATE OR REPLACE FUNCTION public.issue_4490_member_projection(p_subscription_id uuid, p_view text, p_qr_pepper text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_venue record;
  v_tz text;
  v_open public.venue_membership_periods%ROWTYPE;
  v_today date;
  v_result jsonb;
  v_can_enter boolean;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug, b.name AS brand_name INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT * INTO v_open FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id);
  v_can_enter := v_sub.status IN ('active', 'payment_due', 'grace') AND v_sub.start_on <= v_today;
  v_result := jsonb_build_object(
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'memberName', v_sub.member_name,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'interval', v_plan.period, 'inclusions', v_plan.inclusions, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'discountKinds', to_jsonb(v_plan.discount_kinds),
      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id),
    'terms', v_sub.terms,
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug,
      'brandSlug', v_venue.brand_slug, 'brandName', v_venue.brand_name, 'timezone', v_tz),
    'startOn', v_sub.start_on,
    'startedAt', v_sub.started_at,
    'activeUntil', v_sub.current_period_end,
    'currentPeriod', CASE WHEN v_sub.current_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'start', v_sub.current_period_start, 'end', v_sub.current_period_end) END,
    'renewsOn', CASE WHEN v_sub.status IN ('active', 'payment_due', 'grace', 'lapsed')
                      AND NOT v_sub.pause_at_period_end
                      AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                     THEN v_sub.current_period_end END,
    'renewalEmailOn', CASE WHEN v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end
                            AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                           THEN v_sub.current_period_end - make_interval(days => v_plan.renewal_notice_days) END,
    'canCheckIn', v_can_enter,
    'paymentDue', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'periodId', v_open.id, 'amountMinor', v_open.amount_minor, 'currencyCode', v_open.currency_code,
      'periodStart', v_open.period_start, 'periodEnd', v_open.period_end, 'dueAt', v_open.due_at,
      'status', v_open.status, 'graceEndsAt', v_open.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)),
      'paying', EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_open.group_id
                        AND a.state IN ('pending', 'ambiguous'))) END,
    'leaving', CASE WHEN v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled'
                    THEN jsonb_build_object('endsAt', v_sub.cancel_at, 'by', v_sub.cancel_requested_by) END,
    'pausing', CASE WHEN v_sub.pause_at_period_end THEN jsonb_build_object('from', v_sub.current_period_end,
                    'by', v_sub.pause_requested_by) END,
    'paused', CASE WHEN v_sub.status = 'paused' THEN jsonb_build_object('since', v_sub.paused_since, 'by', v_sub.pause_reason) END,
    'endedAt', v_sub.cancelled_at,
    'endReason', v_sub.end_reason,
    'credits', jsonb_build_object(
      'roomHoursLeft', public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()),
      'roomHoursPerMonth', v_plan.room_hours_per_period,
      'guestPassesLeft', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()),
      'guestPassesPerMonth', v_plan.guest_passes_per_period),
    'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                       AND x.local_date = v_today AND x.undone_at IS NULL),
    'canLeave', v_sub.status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused') AND v_sub.cancel_at IS NULL,
    'canStay', v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled' AND v_sub.cancel_requested_by = 'member',
    'canPause', v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end AND v_sub.cancel_at IS NULL,
    'canResume', v_sub.status = 'paused' OR v_sub.pause_at_period_end,
    -- #4490 fix round 1 (B5): the months paid, newest first (the member, and
    -- staff who may see members; never a stranger: every caller checks first).
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'periodId', pp.id, 'start', pp.period_start, 'end', pp.period_end,
        'amountMinor', pp.amount_minor, 'currencyCode', pp.currency_code,
        'paidMinor', CASE WHEN pp.paid_via = 'online' THEN (SELECT NULLIF(sum(a.amount_minor), 0) FROM public.stay_payment_attempts a
                                                             WHERE a.group_id = pp.group_id AND a.state = 'succeeded') END,
        'paidAt', pp.paid_at, 'paidVia', pp.paid_via)
        ORDER BY pp.period_start DESC)
      FROM public.venue_membership_periods pp
      WHERE pp.subscription_id = v_sub.id AND pp.status = 'paid'), '[]'::jsonb),
    'memberPath', '/visit/plan/' || v_sub.id,
    'version', v_sub.version,
    -- #4490 explorer W1: the app-only pass switch (see the booking projection).
    'passInApp', public.issue_4490_flag_on('VENUE_PASS_APP_ONLY'),
    'createdAt', v_sub.created_at);
  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL AND v_sub.status <> 'cancelled' THEN
    v_result := v_result || jsonb_build_object('pass', jsonb_build_object(
      'qrPayload', public.issue_4490_member_qr_payload(v_sub.id, v_sub.qr_token_hash, p_qr_pepper),
      'valid', v_can_enter));
  END IF;
  -- #4490 fix 3 (N87): the member's own email, so a booking made as this
  -- member starts with their name and email filled in (the guest view is
  -- read only with the member's own token).
  IF p_view = 'guest' THEN
    v_result := v_result || jsonb_build_object('memberEmail', v_sub.member_email);
  END IF;
  IF p_view = 'host' THEN
    v_result := v_result || jsonb_build_object(
      'email', v_sub.member_email,
      'phone', v_sub.member_phone,
      'signedIn', v_sub.user_id IS NOT NULL,
      'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'sequence', p.sequence, 'start', p.period_start, 'end', p.period_end,
          'amountMinor', p.amount_minor, 'currencyCode', p.currency_code, 'dueAt', p.due_at, 'status', p.status,
          'paidAt', p.paid_at, 'paidVia', p.paid_via, 'paidMethod', p.paid_method, 'remindersSent', to_jsonb(p.reminder_steps))
          ORDER BY p.period_start DESC)
        FROM public.venue_membership_periods p WHERE p.subscription_id = v_sub.id), '[]'::jsonb),
      'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', e.event_type, 'by', e.actor_type, 'at', e.created_at, 'periodId', e.period_id, 'detail', e.detail)
          ORDER BY e.created_at, e.id)
        FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id), '[]'::jsonb),
      'visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('localDate', x.local_date, 'guests', x.guests,
          'at', x.created_at, 'undone', x.undone_at IS NOT NULL) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM public.venue_member_visits WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 20) x),
        '[]'::jsonb),
      'credits', (v_result->'credits') || jsonb_build_object(
        'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('credit', l.credit, 'entry', l.entry, 'amount', l.amount,
            'at', l.created_at, 'groupId', l.group_id) ORDER BY l.created_at DESC)
          FROM (SELECT * FROM public.venue_credit_ledger WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 40) l),
          '[]'::jsonb)),
      'canManage', public.issue_4490_user_can_manage_members(v_venue.id, auth.uid()),
      'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, auth.uid()));
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_claim_subject(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4063_claim_subject(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mint_claim_link(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_claim_link(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_booking_projection(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_booking_projection(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_member_projection(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_member_projection(uuid, text, text) TO service_role;

INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_APP_HANDOFF', false, '#4490 explorer W1: claim links for venue bookings and Open in Mingla in venue emails and texts'),
  ('VENUE_PASS_APP_ONLY', false, '#4490 explorer W1: venue passes are shown only in the Mingla app; web token reads get no QR')
ON CONFLICT (flag_key) DO NOTHING;

-- 6. "Text me the link" (design web:desk; spec 06 names no endpoint, so this
--    is the smallest server action): re-send the booking's app link by text to
--    the guest phone already on the booking. No number can be typed in; at
--    most 3 texts per booking; the existing SMS path (notification_outbox ->
--    notify-outbox-drain -> notify-dispatch -> smsAdapter) sends it, and the
--    drain mints the claim link when the text is sent.
CREATE OR REPLACE FUNCTION public.issue_4490_text_claim_link(p_group_id uuid, p_token_hash bytea, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_phone text;
  v_sent integer;
BEGIN
  SELECT * INTO v_group FROM public.stay_reservation_groups
  WHERE id = p_group_id AND offer_kind IS NOT NULL AND offer_kind <> 'membership'
  FOR UPDATE;
  -- Only the booking's token holder or its signed-in owner.
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_APP_HANDOFF') THEN
    RAISE EXCEPTION 'claim_text_unavailable' USING ERRCODE = 'P0001';
  END IF;
  -- N156: no "your pass is in the app" text for a booking without a pass.
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'claim_text_not_confirmed' USING ERRCODE = 'P0001';
  END IF;
  v_phone := public.mingla_e164_normalize(NULLIF(v_group.guest_snapshot->>'phone', ''));
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'claim_text_no_phone' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_sent FROM public.notification_outbox
  WHERE idempotency_key LIKE 'venue-claim-text:' || v_group.id || ':%';
  IF v_sent >= 3 THEN
    RAISE EXCEPTION 'claim_text_limit' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    'venue_booking_confirmed', NULL, v_phone, v_group.brand_id,
    jsonb_build_object('venue_group_id', v_group.id, 'channel_hint', 'sms', 'claim_text', true),
    'venue-claim-text:' || v_group.id || ':' || (v_sent + 1),
    public.mingla_e164_country(v_phone)
  );
  RETURN jsonb_build_object('sent', true, 'remaining', 2 - v_sent,
    'phoneLast4', right(regexp_replace(v_phone, '\D', '', 'g'), 4));
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_text_claim_link(uuid, bytea, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_text_claim_link(uuid, bytea, uuid) TO service_role;

-- N162: the verified-identity sweep has always attached anonymous Stays by
-- setting stay_reservation_groups.user_id, but #4490's latest immutable-row
-- guard froze that ownership link along with the booking snapshot. Keep the
-- money, guest, answer and inventory snapshots immutable; permit only the
-- one-way NULL -> verified owner attachment on a live booking. The sweep also
-- skips unpaid and closed groups, so one matching reconciliation hold cannot
-- abort every other purchase claim for the account.
CREATE FUNCTION pg_temp.issue_4490_w1_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, '')))
    / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, '')))
    / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION
      'issue_4490 W1 patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

SELECT pg_temp.issue_4490_w1_patch(
  'public.issue_1388_guard_immutable_rows()'::regprocedure,
  $old$ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF NEW.id <> OLD.id
       OR NEW.public_reference <> OLD.public_reference
       OR NEW.quote_id <> OLD.quote_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.actor_key_hash <> OLD.actor_key_hash$old$,
  $new$ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF NEW.id <> OLD.id
       OR NEW.public_reference <> OLD.public_reference
       OR NEW.quote_id <> OLD.quote_id
       OR (
         NEW.user_id IS DISTINCT FROM OLD.user_id
         AND NOT (
           OLD.user_id IS NULL
           AND NEW.user_id IS NOT NULL
           AND NEW.state IS NOT DISTINCT FROM OLD.state
           AND NEW.state IN ('confirmed', 'partially_cancelled')
           AND public.account_owns_contact(
             NEW.user_id,
             OLD.guest_snapshot->>'email',
             OLD.guest_snapshot->>'phone'
           )
         )
       )
       OR NEW.actor_key_hash <> OLD.actor_key_hash$new$
);

SELECT pg_temp.issue_4490_w1_patch(
  'public.claim_attendance_by_verified_identity(uuid)'::regprocedure,
  $old$     WHERE g.user_id IS NULL
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)$old$,
  $new$     WHERE g.user_id IS NULL
       AND g.state IN ('confirmed', 'partially_cancelled')
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)$new$
);

DROP FUNCTION pg_temp.issue_4490_w1_patch(regprocedure, text, text);
