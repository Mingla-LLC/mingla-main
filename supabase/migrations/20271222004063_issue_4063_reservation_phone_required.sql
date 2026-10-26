-- Issue #4063 Wave 5b / M9 — host-created bookings require a guest phone.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_reservation_create(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text DEFAULT 'phone',
  p_guest_name text DEFAULT NULL,
  p_guest_phone_e164 text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_table_id uuid DEFAULT NULL,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'::text[],
  p_status text DEFAULT 'confirmed'
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand uuid;
  v_uid uuid := auth.uid();
  v_phone text := NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT v.brand_id INTO v_brand
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership: SAME rank helper, against the DERIVED brand (D-1: one team).
  -- Re-asserted BEFORE the INSERT so the SECURITY DEFINER RETURNING cannot
  -- leak another brand's row (RLS-RETURNING-OWNER-GAP note, SPEC §4.A.4).
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- A manual booking starts in a non-terminal, sensible state only.
  IF p_status NOT IN ('requested','confirmed','seated') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla','phone','walk_in','website','instagram') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'reservation_phone_required' USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE = '22023';
  END IF;

  -- D-1 guard, now VENUE-scoped: an assigned table MUST belong to the SAME
  -- venue as the reservation being created. NULL p_table_id is allowed.
  -- (Error literal kept as table_brand_mismatch — same cross-tenant-splice
  -- class the clients already map; it now also fires for a same-brand
  -- OTHER-venue table.)
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = p_venue_id
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, p_venue_id USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.reservations (
    brand_id, venue_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, table_id, occasion,
    guest_notes, tags
  ) VALUES (
    v_brand, p_venue_id, p_reserved_for, p_party_size, p_status, p_source, 'operator',
    p_guest_name, v_phone, p_guest_email, p_table_id, p_occasion,
    p_guest_notes, COALESCE(p_tags, '{}'::text[])
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.create',
    'reservation', v_row.id::text,
    jsonb_build_object(
      'source', p_source, 'party_size', p_party_size,
      'reserved_for', p_reserved_for, 'status', p_status, 'created_via', 'operator',
      'venue_id', p_venue_id
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_reservation_create(
  uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_create(
  uuid,timestamptz,integer,text,text,text,text,uuid,text,text,text[],text
) TO authenticated;

COMMIT;
