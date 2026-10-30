-- Issue #4188: staff-created Stay reservations use the same quote and inventory
-- truth as guest checkout while keeping property-collected money outside Mingla.
-- INVARIANT: {"id":"I-4188-STAFF-STAY-EXTERNAL-MONEY-TRUTH","rule":"A staff-created Stay booking may commit inventory without a Mingla charge only when it is explicitly marked property-collected; it never creates provider payment/refund truth and never appears in the staff actor's guest itinerary."}

BEGIN;

-- A venue-scoped operator is deliberately rank -1 in the legacy brand hierarchy.
-- Rank 0 already means NO MEMBERSHIP and has a special brandless UI carve-out;
-- every positive rank can unlock generic brand-wide reads. The negative sentinel
-- keeps both paths closed while venue-capability policies grant selected access.
ALTER TABLE public.brand_team_members
  DROP CONSTRAINT IF EXISTS brand_team_members_role_check;
ALTER TABLE public.brand_team_members
  ADD CONSTRAINT brand_team_members_role_check
  CHECK (role = ANY (ARRAY[
    'brand_owner'::text,
    'brand_admin'::text,
    'event_manager'::text,
    'finance_manager'::text,
    'marketing_manager'::text,
    'scanner'::text,
    'venue_staff'::text
  ]));

ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_role_check;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_role_check
  CHECK (role = ANY (ARRAY[
    'brand_owner'::text,
    'brand_admin'::text,
    'event_manager'::text,
    'finance_manager'::text,
    'marketing_manager'::text,
    'scanner'::text,
    'venue_staff'::text
  ]));

CREATE OR REPLACE FUNCTION public.biz_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE trim(lower(coalesce(p_role, '')))
    WHEN 'venue_staff' THEN -1
    WHEN 'scanner' THEN 10
    WHEN 'marketing_manager' THEN 20
    WHEN 'finance_manager' THEN 30
    WHEN 'event_manager' THEN 40
    WHEN 'brand_admin' THEN 50
    WHEN 'brand_owner' THEN 60
    ELSE 0
  END;
$function$;

CREATE TABLE public.brand_invitation_venue_grants (
  invitation_id uuid NOT NULL
    REFERENCES public.brand_invitations(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  access_profile text NOT NULL CHECK (access_profile IN (
    'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
  )),
  capabilities text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, venue_id),
  CONSTRAINT brand_invitation_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations'
    ]::text[]
  )
);

CREATE TABLE public.brand_team_member_venue_grants (
  member_id uuid NOT NULL
    REFERENCES public.brand_team_members(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  access_profile text NOT NULL CHECK (access_profile IN (
    'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
  )),
  capabilities text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, venue_id),
  CONSTRAINT brand_team_member_venue_capabilities_valid CHECK (
    capabilities <@ ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations'
    ]::text[]
  )
);

CREATE INDEX brand_team_member_venue_grants_venue_idx
  ON public.brand_team_member_venue_grants(venue_id, member_id);

ALTER TABLE public.brand_invitation_venue_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_team_member_venue_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invitation venue grants admins can read"
  ON public.brand_invitation_venue_grants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.brand_invitations invitation
    WHERE invitation.id = invitation_id
      AND public.biz_brand_effective_rank_for_caller(invitation.brand_id)
        >= public.biz_role_rank('brand_admin')
  ));
CREATE POLICY "member venue grants admins or self can read"
  ON public.brand_team_member_venue_grants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.brand_team_members member
    WHERE member.id = member_id
      AND (
        member.user_id = auth.uid()
        OR public.biz_brand_effective_rank_for_caller(member.brand_id)
          >= public.biz_role_rank('brand_admin')
      )
  ));

-- The generic brand-member helper is intentionally false for rank -1. Allow a
-- scoped operator to hydrate the selected brand shell without granting any
-- other brand-owned table; every operational row remains venue-capability gated.
CREATE POLICY "venue staff can select assigned brand"
  ON public.brands
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members member
      JOIN public.brand_team_member_venue_grants grant_row
        ON grant_row.member_id = member.id
      WHERE member.brand_id = brands.id
        AND member.user_id = auth.uid()
        AND member.role = 'venue_staff'
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  );

REVOKE ALL ON public.brand_invitation_venue_grants
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.brand_team_member_venue_grants
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brand_invitation_venue_grants TO authenticated;
GRANT SELECT ON public.brand_team_member_venue_grants TO authenticated;
GRANT ALL ON public.brand_invitation_venue_grants TO service_role;
GRANT ALL ON public.brand_team_member_venue_grants TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4188_has_venue_capability(
  p_venue_id uuid,
  p_user_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_user_id = auth.uid()
    AND p_capability = ANY(ARRAY[
      'stay.view_reservations',
      'stay.create_reservations',
      'stay.manage_reservations',
      'stay.view_availability',
      'restaurant.view_orders',
      'restaurant.manage_orders',
      'restaurant.manage_menu',
      'restaurant.manage_qr',
      'restaurant.manage_reservations'
    ]::text[])
    AND EXISTS (
      SELECT 1
      FROM public.brand_team_members member
      JOIN public.brand_team_member_venue_grants grant_row
        ON grant_row.member_id = member.id
      JOIN public.venue_listings venue
        ON venue.id = grant_row.venue_id
       AND venue.brand_id = member.brand_id
      WHERE member.user_id = p_user_id
        AND member.role = 'venue_staff'
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
        AND grant_row.venue_id = p_venue_id
        AND p_capability = ANY(grant_row.capabilities)
    );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_my_venue_access(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
  v_capabilities text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT member.* INTO v_member
  FROM public.brand_team_members member
  JOIN public.venue_listings venue ON venue.brand_id = member.brand_id
  WHERE venue.id = p_venue_id
    AND member.user_id = auth.uid()
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  LIMIT 1;
  IF NOT FOUND OR v_member.role <> 'venue_staff' THEN
    RETURN jsonb_build_object('scoped', false, 'capabilities', '[]'::jsonb);
  END IF;
  SELECT grant_row.capabilities INTO v_capabilities
  FROM public.brand_team_member_venue_grants grant_row
  WHERE grant_row.member_id = v_member.id
    AND grant_row.venue_id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'scoped', true,
    'capabilities', to_jsonb(v_capabilities)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_copy_invitation_venue_grants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member_id uuid;
BEGIN
  IF NEW.status <> 'accepted'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR NEW.accepted_by_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT member.id INTO v_member_id
  FROM public.brand_team_members member
  WHERE member.brand_id = NEW.brand_id
    AND member.user_id = NEW.accepted_by_account_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  ORDER BY member.accepted_at DESC, member.id
  LIMIT 1;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'venue_grant_member_missing' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.brand_team_member_venue_grants (
    member_id, venue_id, access_profile, capabilities
  )
  SELECT
    v_member_id, grant_row.venue_id, grant_row.access_profile,
    grant_row.capabilities
  FROM public.brand_invitation_venue_grants grant_row
  WHERE grant_row.invitation_id = NEW.id
  ON CONFLICT (member_id, venue_id) DO UPDATE
  SET access_profile = EXCLUDED.access_profile,
      capabilities = EXCLUDED.capabilities,
      updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER brand_invitations_copy_venue_grants
  AFTER UPDATE OF status, accepted_by_account_id
  ON public.brand_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.issue_4188_copy_invitation_venue_grants();

CREATE OR REPLACE FUNCTION public.issue_4188_set_member_venue_grants(
  p_brand_id uuid,
  p_member_id uuid,
  p_grants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_grants) <> 'array'
     OR jsonb_array_length(p_grants) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT grant_row->>'venueId')
    FROM jsonb_array_elements(p_grants) grant_row
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_member
  FROM public.brand_team_members member
  WHERE member.id = p_member_id
    AND member.brand_id = p_brand_id
    AND member.role = 'venue_staff'
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_grants) grant_row
    WHERE jsonb_typeof(grant_row) <> 'object'
      OR NOT (grant_row ? 'venueId')
      OR NOT (grant_row ? 'profile')
      OR NOT (grant_row ? 'capabilities')
      OR jsonb_typeof(grant_row->'capabilities') <> 'array'
      OR jsonb_array_length(grant_row->'capabilities') = 0
      OR grant_row->>'profile' NOT IN (
        'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.venue_listings venue
        WHERE venue.id = (grant_row->>'venueId')::uuid
          AND venue.brand_id = p_brand_id
          AND (
            (
              venue.venue_category = 'stay'
              AND grant_row->>'profile' IN ('front_desk', 'custom')
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'stay.%'
              )
            )
            OR (
              venue.venue_category = 'restaurant'
              AND grant_row->>'profile' IN (
                'restaurant_manager', 'kitchen_bar', 'custom'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'restaurant.%'
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(grant_row->'capabilities') capability
        WHERE capability <> ALL(ARRAY[
          'stay.view_reservations',
          'stay.create_reservations',
          'stay.manage_reservations',
          'stay.view_availability',
          'restaurant.view_orders',
          'restaurant.manage_orders',
          'restaurant.manage_menu',
          'restaurant.manage_qr',
          'restaurant.manage_reservations'
        ]::text[])
      )
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.brand_team_member_venue_grants
  WHERE member_id = p_member_id;
  INSERT INTO public.brand_team_member_venue_grants (
    member_id, venue_id, access_profile, capabilities
  )
  SELECT
    p_member_id,
    (grant_row->>'venueId')::uuid,
    grant_row->>'profile',
    ARRAY(
      SELECT DISTINCT capability
      FROM jsonb_array_elements_text(grant_row->'capabilities') capability
      ORDER BY capability
    )
  FROM jsonb_array_elements(p_grants) grant_row;

  RETURN jsonb_build_object(
    'memberId', p_member_id,
    'venueCount', jsonb_array_length(p_grants)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4188_has_venue_capability(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4188_has_venue_capability(uuid,uuid,text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4188_my_venue_access(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4188_my_venue_access(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)
  TO authenticated;

-- Selected-venue reads and writes are additive policies. Legacy brand roles
-- continue through their existing policies; venue_staff reaches only rows whose
-- venue grant contains the required capability.
CREATE POLICY "venue listings scoped staff can read"
  ON public.venue_listings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.brand_team_members member
    JOIN public.brand_team_member_venue_grants grant_row
      ON grant_row.member_id = member.id
    WHERE member.user_id = auth.uid()
      AND member.role = 'venue_staff'
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND grant_row.venue_id = venue_listings.id
  ));

CREATE POLICY "venue reservation settings scoped staff can read"
  ON public.venue_reservation_settings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.brand_team_members member
    JOIN public.brand_team_member_venue_grants grant_row
      ON grant_row.member_id = member.id
    WHERE member.user_id = auth.uid()
      AND member.role = 'venue_staff'
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND grant_row.venue_id = venue_reservation_settings.venue_id
  ));

CREATE POLICY "menus scoped staff can read"
  ON public.menus
  FOR SELECT TO authenticated
  USING (
    public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.manage_menu'
    )
    OR public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.view_orders'
    )
  );
CREATE POLICY "menus scoped staff can write"
  ON public.menus
  FOR ALL TO authenticated
  USING (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_menu'
  ))
  WITH CHECK (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_menu'
  ));

CREATE POLICY "menu items scoped staff can read"
  ON public.menu_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menus menu
    WHERE menu.id = menu_items.menu_id
      AND (
        public.issue_4188_has_venue_capability(
          menu.venue_id, auth.uid(), 'restaurant.manage_menu'
        )
        OR public.issue_4188_has_venue_capability(
          menu.venue_id, auth.uid(), 'restaurant.view_orders'
        )
      )
  ));
CREATE POLICY "menu items scoped staff can write"
  ON public.menu_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menus menu
    WHERE menu.id = menu_items.menu_id
      AND public.issue_4188_has_venue_capability(
        menu.venue_id, auth.uid(), 'restaurant.manage_menu'
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.menus menu
    WHERE menu.id = menu_items.menu_id
      AND public.issue_4188_has_venue_capability(
        menu.venue_id, auth.uid(), 'restaurant.manage_menu'
      )
  ));

CREATE POLICY "venue tables scoped staff can read"
  ON public.venue_tables
  FOR SELECT TO authenticated
  USING (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_reservations'
  ));
CREATE POLICY "venue tables scoped staff can write"
  ON public.venue_tables
  FOR ALL TO authenticated
  USING (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_reservations'
  ))
  WITH CHECK (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_reservations'
  ));

CREATE POLICY "qr spots scoped staff can read"
  ON public.qr_spots
  FOR SELECT TO authenticated
  USING (public.issue_4188_has_venue_capability(
    serving_venue_id, auth.uid(), 'restaurant.manage_qr'
  ));
CREATE POLICY "qr spots scoped staff can write"
  ON public.qr_spots
  FOR ALL TO authenticated
  USING (public.issue_4188_has_venue_capability(
    serving_venue_id, auth.uid(), 'restaurant.manage_qr'
  ))
  WITH CHECK (public.issue_4188_has_venue_capability(
    serving_venue_id, auth.uid(), 'restaurant.manage_qr'
  ));

CREATE POLICY "reservations scoped staff can read"
  ON public.reservations
  FOR SELECT TO authenticated
  USING (public.issue_4188_has_venue_capability(
    venue_id, auth.uid(), 'restaurant.manage_reservations'
  ));

CREATE POLICY "venue orders scoped staff can read"
  ON public.venue_orders
  FOR SELECT TO authenticated
  USING (
    public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.view_orders'
    )
    OR public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.manage_orders'
    )
  );
CREATE POLICY "venue order sessions scoped staff can read"
  ON public.venue_order_sessions
  FOR SELECT TO authenticated
  USING (
    public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.view_orders'
    )
    OR public.issue_4188_has_venue_capability(
      venue_id, auth.uid(), 'restaurant.manage_orders'
    )
  );
CREATE POLICY "venue order items scoped staff can read"
  ON public.venue_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.venue_orders order_row
    WHERE order_row.id = venue_order_items.venue_order_id
      AND (
        public.issue_4188_has_venue_capability(
          order_row.venue_id, auth.uid(), 'restaurant.view_orders'
        )
        OR public.issue_4188_has_venue_capability(
          order_row.venue_id, auth.uid(), 'restaurant.manage_orders'
        )
      )
  ));
CREATE POLICY "venue order modifiers scoped staff can read"
  ON public.venue_order_item_modifiers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.venue_order_items item
    JOIN public.venue_orders order_row ON order_row.id = item.venue_order_id
    WHERE item.id = venue_order_item_modifiers.venue_order_item_id
      AND (
        public.issue_4188_has_venue_capability(
          order_row.venue_id, auth.uid(), 'restaurant.view_orders'
        )
        OR public.issue_4188_has_venue_capability(
          order_row.venue_id, auth.uid(), 'restaurant.manage_orders'
        )
      )
  ));

-- The operator RPCs are SECURITY DEFINER, so RLS alone cannot grant scoped
-- staff their actions. Their existing brand-role gate remains intact and the
-- selected-venue capability is an explicit alternative.
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand uuid;
  v_uid uuid := auth.uid();
  v_phone text := NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  SELECT venue.brand_id INTO v_brand FROM public.venue_listings venue
  WHERE venue.id = p_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue_not_found' USING ERRCODE='P0002'; END IF;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager')
     AND NOT public.issue_4188_has_venue_capability(
       p_venue_id, v_uid, 'restaurant.manage_reservations'
     ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('requested','confirmed','seated') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE='23514';
  END IF;
  IF p_source NOT IN ('mingla','phone','walk_in','website','instagram') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE='23514';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'reservation_phone_required' USING ERRCODE='22023';
  END IF;
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE='22023';
  END IF;
  IF p_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_tables table_row
    WHERE table_row.id=p_table_id AND table_row.venue_id=p_venue_id
  ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id,p_venue_id USING ERRCODE='23514';
  END IF;
  INSERT INTO public.reservations (
    brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    guest_name,guest_phone_e164,guest_email,table_id,occasion,guest_notes,tags
  ) VALUES (
    v_brand,p_venue_id,p_reserved_for,p_party_size,p_status,p_source,'operator',
    p_guest_name,v_phone,p_guest_email,p_table_id,p_occasion,p_guest_notes,
    COALESCE(p_tags,'{}'::text[])
  ) RETURNING * INTO v_row;
  INSERT INTO public.audit_log(user_id,brand_id,action,target_type,target_id,after)
  VALUES (v_uid,v_brand,'venue_reservation.create','reservation',v_row.id::text,
    jsonb_build_object('source',p_source,'party_size',p_party_size,
      'reserved_for',p_reserved_for,'status',p_status,'created_via','operator',
      'venue_id',p_venue_id));
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_reservation_transition(
  p_reservation_id uuid,
  p_to_status text,
  p_table_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_from text;
  v_brand uuid;
  v_venue uuid;
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_to_status='cancelled_by_venue' THEN
    SELECT * INTO v_row FROM public.reservations WHERE id=p_reservation_id;
    IF FOUND AND v_row.payment_status='paid' AND v_row.status<>'seated'
       AND public.pg_reservation_transition_is_legal(v_row.status,'cancelled_by_venue')
       AND EXISTS (SELECT 1 FROM public.reservation_checkout_sessions session
         WHERE session.reservation_id=p_reservation_id
           AND session.status='completed' AND session.amount_cents>0) THEN
      PERFORM public.biz_venue_cancel_paid_reservation(p_reservation_id,p_reason);
      SELECT * INTO v_row FROM public.reservations WHERE id=p_reservation_id;
      RETURN v_row;
    END IF;
  END IF;
  SELECT * INTO v_row FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found' USING ERRCODE='P0002'; END IF;
  v_from:=v_row.status; v_brand:=v_row.brand_id; v_venue:=v_row.venue_id;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager')
     AND NOT public.issue_4188_has_venue_capability(
       v_venue,v_uid,'restaurant.manage_reservations'
     ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public.pg_reservation_transition_is_legal(v_from,p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%',v_from,p_to_status USING ERRCODE='23514';
  END IF;
  IF p_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_tables table_row
    WHERE table_row.id=p_table_id AND table_row.venue_id=v_venue
  ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id,v_venue USING ERRCODE='23514';
  END IF;
  IF p_to_status='no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
    FROM public.venue_reservation_settings WHERE venue_id=v_venue;
  END IF;
  UPDATE public.reservations SET status=p_to_status,
    table_id=COALESCE(p_table_id,table_id),updated_at=now()
  WHERE id=p_reservation_id RETURNING * INTO v_row;
  INSERT INTO public.audit_log(user_id,brand_id,action,target_type,target_id,before,after)
  VALUES (v_uid,v_brand,'venue_reservation.transition','reservation',p_reservation_id::text,
    jsonb_build_object('status',v_from),
    jsonb_build_object('status',p_to_status,'table_id',v_row.table_id,
      'reason',p_reason,'no_show_fee_policy',v_policy));
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_venue_order_transition(
  p_order_id uuid,
  p_to text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_uid uuid:=auth.uid();
  v_rank int;
  v_scoped boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p_to IS NULL OR p_to NOT IN ('acknowledged','in_progress','ready','delivered','cancelled') THEN
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
  v_rank:=public.biz_brand_effective_rank_for_caller(v_order.brand_id);
  v_scoped:=public.issue_4188_has_venue_capability(
    v_order.venue_id,v_uid,'restaurant.manage_orders'
  );
  IF v_rank<=0 AND NOT v_scoped THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_to='cancelled'
     AND v_rank<public.biz_role_rank('event_manager')
     AND NOT v_scoped THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF NOT public.pg_venue_order_transition_is_legal(v_order.fulfillment_status,p_to) THEN
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE='P0001';
  END IF;
  UPDATE public.venue_orders SET fulfillment_status=p_to,
    acknowledged_at=CASE WHEN p_to='acknowledged' THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,
    acknowledged_by_user_id=CASE WHEN p_to='acknowledged' THEN COALESCE(acknowledged_by_user_id,v_uid) ELSE acknowledged_by_user_id END,
    in_progress_at=CASE WHEN p_to='in_progress' THEN COALESCE(in_progress_at,now()) ELSE in_progress_at END,
    ready_at=CASE WHEN p_to='ready' THEN COALESCE(ready_at,now()) ELSE ready_at END,
    delivered_at=CASE WHEN p_to='delivered' THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
    cancelled_at=CASE WHEN p_to='cancelled' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
    metadata=CASE WHEN p_reason IS NULL OR length(btrim(p_reason))=0 THEN metadata
      ELSE metadata||jsonb_build_object('last_transition_reason',left(btrim(p_reason),280)) END
  WHERE id=p_order_id;
  RETURN jsonb_build_object('orderId',p_order_id,'fulfillmentStatus',p_to,'actorUserId',v_uid);
END;
$function$;

ALTER TABLE public.stay_reservation_groups
  ADD COLUMN booking_source text NOT NULL DEFAULT 'guest'
    CHECK (booking_source IN (
      'guest', 'phone', 'walk_in', 'website', 'instagram', 'mingla'
    )),
  ADD COLUMN payment_collection text NOT NULL DEFAULT 'mingla'
    CHECK (payment_collection IN ('mingla', 'property')),
  ADD COLUMN created_by_staff_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stay_reservation_groups.booking_source IS
  'How this reservation entered Mingla. guest is public checkout; every other value is an operator-recorded source.';
COMMENT ON COLUMN public.stay_reservation_groups.payment_collection IS
  'mingla means provider money truth; property means Mingla committed inventory but did not collect or refund money.';
COMMENT ON COLUMN public.stay_reservation_groups.created_by_staff_user_id IS
  'Authenticated staff actor that created the reservation; null for public guest checkout.';

CREATE TABLE public.stay_staff_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_reservation_groups(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  email_requested boolean NOT NULL DEFAULT false,
  sms_requested boolean NOT NULL DEFAULT false,
  email_status text NOT NULL DEFAULT 'not_requested'
    CHECK (email_status IN ('not_requested', 'pending', 'sent', 'failed')),
  sms_status text NOT NULL DEFAULT 'not_requested'
    CHECK (sms_status IN ('not_requested', 'pending', 'sent', 'failed')),
  email_error_code text,
  sms_error_code text,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (expires_at > created_at)
);

ALTER TABLE public.stay_staff_payment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stay_staff_payment_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stay_staff_payment_links TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4188_guard_stay_group_source_truth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.booking_source <> 'guest'
       OR NEW.payment_collection <> 'mingla'
       OR NEW.created_by_staff_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'stay_group_source_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.booking_source IS NOT DISTINCT FROM OLD.booking_source
     AND NEW.payment_collection IS NOT DISTINCT FROM OLD.payment_collection
     AND NEW.created_by_staff_user_id
       IS NOT DISTINCT FROM OLD.created_by_staff_user_id THEN
    RETURN NEW;
  END IF;
  IF OLD.payment_collection = 'property'
     AND NEW.booking_source = OLD.booking_source
     AND NEW.payment_collection = OLD.payment_collection
     AND OLD.created_by_staff_user_id IS NOT NULL
     AND NEW.created_by_staff_user_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM auth.users user_row
       WHERE user_row.id = OLD.created_by_staff_user_id
     ) THEN
    -- Preserve account deletion/erasure. The booking and immutable source stay
    -- intact; only the FK actor pointer is cleared after the auth row is gone.
    RETURN NEW;
  END IF;
  IF OLD.booking_source = 'guest'
     AND OLD.payment_collection = 'mingla'
     AND OLD.created_by_staff_user_id IS NULL
     AND NEW.booking_source IN (
       'phone', 'walk_in', 'website', 'instagram', 'mingla'
     )
     AND NEW.payment_collection = 'property'
     AND NEW.created_by_staff_user_id = auth.uid()
     AND OLD.state = 'finalizing'
     AND NEW.state = 'confirmed'
     AND current_setting(
       'mingla.issue_4188_staff_conversion', true
     ) = NEW.id::text
     AND public.issue_4188_has_stay_permission(
       NEW.venue_id, NEW.brand_id, auth.uid(), 'create'
     ) THEN
    RETURN NEW;
  END IF;
  IF OLD.booking_source = 'guest'
     AND OLD.payment_collection = 'mingla'
     AND OLD.created_by_staff_user_id IS NULL
     AND NEW.booking_source IN (
       'phone', 'walk_in', 'website', 'instagram', 'mingla'
     )
     AND NEW.payment_collection = 'mingla'
     AND NEW.created_by_staff_user_id = auth.uid()
     AND NEW.state IN ('instant_payment_pending', 'approved_payment_required')
     AND current_setting(
       'mingla.issue_4188_staff_conversion', true
     ) = NEW.id::text
     AND public.issue_4188_has_stay_permission(
       NEW.venue_id, NEW.brand_id, auth.uid(), 'create'
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stay_group_source_immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER stay_reservation_groups_source_truth_guard
  BEFORE INSERT OR UPDATE ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_4188_guard_stay_group_source_truth();

CREATE OR REPLACE FUNCTION public.issue_1426_has_stay_permission(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_role text;
  v_overrides jsonb := '{}'::jsonb;
  v_key text;
  v_base boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid()
     OR v_action NOT IN ('view', 'create', 'respond', 'cancel', 'finance') THEN
    RETURN false;
  END IF;
  IF public.is_admin_user() OR EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = p_brand_id
      AND brand.account_id = p_user_id
      AND brand.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  SELECT member.role, member.permissions_override
  INTO v_role, v_overrides
  FROM public.brand_team_members member
  WHERE member.brand_id = p_brand_id
    AND member.user_id = p_user_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  v_base := CASE v_action
    WHEN 'view' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager', 'finance_manager'
    )
    WHEN 'create' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager'
    )
    WHEN 'respond' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager'
    )
    WHEN 'cancel' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager'
    )
    WHEN 'finance' THEN v_role IN (
      'brand_owner', 'brand_admin', 'finance_manager'
    )
    ELSE false
  END;
  v_key := 'stay.' || v_action;
  IF jsonb_typeof(v_overrides->v_key) = 'boolean' THEN
    RETURN v_base AND (v_overrides->>v_key)::boolean;
  END IF;
  RETURN v_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_has_stay_permission(
  p_venue_id uuid,
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND venue.brand_id = p_brand_id
  )
  AND (
    public.issue_1426_has_stay_permission(p_brand_id, p_user_id, p_action)
    OR public.issue_4188_has_venue_capability(
      p_venue_id,
      p_user_id,
      CASE lower(pg_catalog.btrim(COALESCE(p_action, '')))
        WHEN 'view' THEN 'stay.view_reservations'
        WHEN 'create' THEN 'stay.create_reservations'
        WHEN 'respond' THEN 'stay.manage_reservations'
        WHEN 'cancel' THEN 'stay.manage_reservations'
        WHEN 'finance' THEN 'stay.finance'
        ELSE 'invalid'
      END
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_staff_stay_details(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue record;
  v_settings public.stay_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT
    venue.id,
    venue.brand_id,
    brand.slug AS brand_slug,
    brand.name AS brand_name,
    venue.slug,
    venue.name
  INTO v_venue
  FROM public.venue_listings venue
  JOIN public.brands brand ON brand.id = venue.brand_id
  WHERE venue.id = p_venue_id
    AND venue.venue_category = 'stay'
    AND venue.claim_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_venue.id, v_venue.brand_id, v_uid, 'view'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_settings
  FROM public.stay_settings settings
  WHERE settings.venue_id = p_venue_id
    AND settings.booking_state = 'active';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- This mirrors the guest selector shape consumed by the shared Room/Place
  -- booking UI, but it is permissioned and intentionally independent of the
  -- STAY_PUBLIC_PAGES flag and venue_public_view publication gate.
  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'brandId', v_venue.brand_id,
    'brandSlug', v_venue.brand_slug,
    'brandName', v_venue.brand_name,
    'venueSlug', v_venue.slug,
    'venueName', v_venue.name,
    'propertyKind', v_settings.property_kind,
    'timezone', v_settings.timezone,
    'defaultBookingMode', v_settings.default_booking_mode,
    'checkInTime', v_settings.check_in_time,
    'checkOutTime', v_settings.check_out_time,
    'bookingHorizonDays', v_settings.booking_horizon_days,
    'houseRules', v_settings.house_rules,
    'offerings', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', offering.id,
          'kind', offering.kind,
          'name', offering.name,
          'summary', offering.summary,
          'description', offering.description,
          'confirmationMode', COALESCE(
            offering.confirmation_mode,
            v_settings.default_booking_mode
          ),
          'inventoryBasis', offering.inventory_basis,
          'unitNamingMode', offering.unit_naming_mode,
          'quantity', offering.quantity,
          'capacity', offering.capacity,
          'minGuests', offering.min_guests,
          'maxGuests', offering.max_guests,
          'maxAdults', offering.max_adults,
          'maxChildren', offering.max_children,
          'placePricingBasis', offering.place_pricing_basis,
          'minNoticeMinutes', offering.min_notice_minutes,
          'maxAdvanceDays', offering.max_advance_days,
          'amenities', offering.amenities,
          'safetyRules', offering.safety_rules,
          'accessibilityFeatures', offering.accessibility_features,
          'accessScope', offering.access_scope,
          'price', jsonb_build_object(
            'amountMinor', price.amount_minor::text,
            'currencyCode', price.currency_code,
            'pricingUnit', price.pricing_unit
          ),
          'fees', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'label', fee.label,
              'kind', fee.fee_kind,
              'calculation', fee.calculation,
              'amountMinor', CASE
                WHEN fee.amount_minor IS NULL THEN NULL
                ELSE fee.amount_minor::text
              END,
              'basisPoints', fee.basis_points,
              'currencyCode', fee.currency_code,
              'displayMode', fee.display_mode
            ) ORDER BY fee.fee_key)
            FROM public.stay_fee_versions fee
            WHERE fee.offering_id = offering.id
              AND fee.effective_to IS NULL
          ), '[]'::jsonb),
          'policy', jsonb_build_object(
            'cancellationPolicy', policy.cancellation_policy,
            'freeCancelCutoffMinutes', policy.free_cancel_cutoff_minutes,
            'requestTerms', policy.request_terms,
            'houseRules', policy.house_rules
          ),
          'media', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'path', media.storage_object_name,
              'mimeType', media.mime_type,
              'altText', media.alt_text,
              'isCover', media.is_cover,
              'sortOrder', media.sort_order
            ) ORDER BY media.sort_order, media.id)
            FROM public.stay_offering_media media
            WHERE media.offering_id = offering.id
              AND media.status = 'ready'
          ), '[]'::jsonb),
          'placeWindows', CASE
            WHEN offering.kind = 'place' THEN COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', place_window.id,
                'localDate', place_window.local_date,
                'startsAt', place_window.starts_at,
                'endsAt', place_window.ends_at,
                'sellableUnits', place_window.sellable_units,
                'sellableCapacity', place_window.sellable_capacity,
                'priceOverrideMinor', CASE
                  WHEN place_window.price_override_minor IS NULL THEN NULL
                  ELSE place_window.price_override_minor::text
                END,
                'currencyCode', place_window.currency_code
              ) ORDER BY place_window.starts_at, place_window.id)
              FROM (
                SELECT bounded_window.*
                FROM public.stay_place_windows bounded_window
                WHERE bounded_window.offering_id = offering.id
                  AND NOT bounded_window.stop_sell
                  AND bounded_window.ends_at > now()
                  AND bounded_window.starts_at
                    < now() + pg_catalog.make_interval(
                      days => LEAST(
                        v_settings.booking_horizon_days,
                        COALESCE(offering.max_advance_days, 120)
                      )
                    )
                ORDER BY bounded_window.starts_at, bounded_window.id
                LIMIT 500
              ) place_window
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        )
        ORDER BY offering.kind, offering.created_at, offering.id
      )
      FROM public.stay_offerings offering
      JOIN public.stay_price_versions price
        ON price.offering_id = offering.id
       AND price.effective_to IS NULL
      JOIN public.stay_policy_versions policy
        ON policy.offering_id = offering.id
       AND policy.effective_to IS NULL
      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_create_staff_stay_group(
  p_quote_id uuid,
  p_idempotency_key text,
  p_guest jsonb,
  p_source text,
  p_expected_quote_version bigint,
  p_payment_method text,
  p_token_hash bytea,
  p_send_email boolean,
  p_send_sms boolean,
  p_link_expires_at timestamptz,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_source text := lower(pg_catalog.btrim(COALESCE(p_source, '')));
  v_payment_method text := lower(pg_catalog.btrim(COALESCE(p_payment_method, '')));
  v_quote public.stay_quotes%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_created jsonb;
  v_group_id uuid;
  v_initial_event_id uuid;
  v_slice_count integer;
  v_commitment_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_source NOT IN ('phone', 'walk_in', 'website', 'instagram', 'mingla')
     OR v_payment_method NOT IN ('link', 'property')
     OR p_expected_quote_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF v_payment_method = 'link' AND (
    p_token_hash IS NULL
    OR octet_length(p_token_hash) <> 32
    OR p_link_expires_at IS NULL
    OR p_link_expires_at <= now()
    OR p_link_expires_at > now() + interval '7 days'
    OR NOT (COALESCE(p_send_email, false) OR COALESCE(p_send_sms, false))
  ) THEN
    RAISE EXCEPTION 'stay_invalid_payment_link' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_quote
  FROM public.stay_quotes
  WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_quote.venue_id, v_quote.brand_id, v_uid, 'create'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- The existing create owner is deliberately reused for every quote, stale
  -- version, inventory lock, allocation and hold decision. This function only
  -- converts its newly-created hold into a property-collected commitment.
  v_created := public.issue_1388_create_stay_group(
    p_quote_id,
    p_idempotency_key,
    p_guest,
    p_expected_quote_version,
    p_request_id
  );
  v_group_id := (v_created->>'groupId')::uuid;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_group_id
  FOR UPDATE;
  IF v_group.payment_collection = 'property' THEN
    IF v_payment_method <> 'property'
       OR v_group.created_by_staff_user_id IS DISTINCT FROM v_uid
       OR v_group.booking_source <> v_source THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1426_staff_group_projection(v_group.id);
  END IF;
  IF v_group.payment_collection = 'mingla'
     AND v_group.booking_source <> 'guest'
     AND v_group.created_by_staff_user_id = v_uid THEN
    IF v_payment_method <> 'link'
       OR v_group.booking_source <> v_source
       OR NOT EXISTS (
         SELECT 1 FROM public.stay_staff_payment_links link
         WHERE link.group_id = v_group.id
       ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    -- The plaintext token is intentionally never persisted. A retried HTTP
    -- request therefore brings a newly-minted token; atomically replace the
    -- old hash before the edge function returns or delivers that new URL.
    -- This keeps the business operation idempotent while guaranteeing that
    -- every URL returned after a lost response is the one currently valid.
    UPDATE public.stay_staff_payment_links
    SET token_hash = p_token_hash,
        expires_at = p_link_expires_at,
        revoked_at = NULL,
        created_by_user_id = v_uid,
        email_requested = COALESCE(p_send_email, false),
        sms_requested = COALESCE(p_send_sms, false),
        email_status = CASE WHEN COALESCE(p_send_email, false)
          THEN 'pending' ELSE 'not_requested' END,
        sms_status = CASE WHEN COALESCE(p_send_sms, false)
          THEN 'pending' ELSE 'not_requested' END,
        email_error_code = NULL,
        sms_error_code = NULL,
        email_sent_at = NULL,
        sms_sent_at = NULL,
        last_opened_at = NULL,
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id;
    UPDATE public.stay_reservation_groups
    SET payment_deadline = p_link_expires_at,
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET expires_at = p_link_expires_at,
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'active';
    RETURN public.issue_1426_staff_group_projection(v_group.id);
  END IF;
  IF v_group.payment_collection <> 'mingla'
     OR v_group.booking_source <> 'guest' THEN
    RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = v_group.id
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
  END IF;

  IF v_payment_method = 'link' THEN
    PERFORM set_config(
      'mingla.issue_4188_staff_conversion', v_group.id::text, true
    );
    IF v_group.state = 'request_pending' THEN
      UPDATE public.stay_reservation_lines
      SET state = 'approved_payment_required',
          version = version + 1,
          updated_at = now()
      WHERE group_id = v_group.id
        AND state = 'request_pending';
    END IF;
    UPDATE public.stay_reservation_groups
    SET booking_source = v_source,
        created_by_staff_user_id = v_uid,
        user_id = NULL,
        state = CASE WHEN state = 'request_pending'
          THEN 'approved_payment_required' ELSE state END,
        payment_deadline = p_link_expires_at,
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET expires_at = p_link_expires_at,
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id;
    INSERT INTO public.stay_staff_payment_links (
      group_id, token_hash, expires_at, created_by_user_id,
      email_requested, sms_requested, email_status, sms_status
    ) VALUES (
      v_group.id, p_token_hash, p_link_expires_at, v_uid,
      COALESCE(p_send_email, false), COALESCE(p_send_sms, false),
      CASE WHEN COALESCE(p_send_email, false) THEN 'pending' ELSE 'not_requested' END,
      CASE WHEN COALESCE(p_send_sms, false) THEN 'pending' ELSE 'not_requested' END
    );
    SELECT event_row.id INTO v_initial_event_id
    FROM public.stay_reservation_events event_row
    WHERE event_row.group_id = v_group.id
      AND event_row.idempotency_key =
        'create:' || pg_catalog.btrim(p_idempotency_key);
    IF v_initial_event_id IS NOT NULL THEN
      DELETE FROM public.notification_outbox outbox
      WHERE outbox.idempotency_key LIKE
        'stay:' || v_initial_event_id::text || ':%';
    END IF;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, request_id,
      idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_staff_payment_link_created', 'staff', v_uid,
      p_request_id, 'staff-link:' || pg_catalog.btrim(p_idempotency_key),
      jsonb_build_object(
        'bookingSource', v_source,
        'emailRequested', COALESCE(p_send_email, false),
        'smsRequested', COALESCE(p_send_sms, false),
        'expiresAt', p_link_expires_at
      )
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1426_staff_group_projection(v_group.id);
  END IF;

  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id,
    room_date, place_window_id, quantity, exclusive_unit_id
  )
  SELECT
    v_group.id, slice_row.reservation_line_id, slice_row.resource_type,
    slice_row.offering_id, slice_row.room_date, slice_row.place_window_id,
    slice_row.quantity, slice_row.exclusive_unit_id
  FROM public.stay_inventory_hold_slices slice_row
  WHERE slice_row.hold_id = v_hold.id
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_slice_count
  FROM public.stay_inventory_hold_slices
  WHERE hold_id = v_hold.id;
  SELECT count(*) INTO v_commitment_count
  FROM public.stay_inventory_commitments
  WHERE group_id = v_group.id AND state = 'active';
  IF v_slice_count = 0 OR v_commitment_count <> v_slice_count THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config(
    'mingla.issue_4188_staff_conversion', v_group.id::text, true
  );

  UPDATE public.stay_inventory_holds
  SET state = 'converted',
      reason = 'staff_property_booking',
      version = version + 1,
      updated_at = now()
  WHERE id = v_hold.id;

  IF v_group.state = 'request_pending' THEN
    UPDATE public.stay_reservation_lines
    SET state = 'approved_payment_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'request_pending';
    UPDATE public.stay_reservation_groups
    SET state = 'approved_payment_required',
        payment_deadline = now() + interval '5 minutes',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
  END IF;

  UPDATE public.stay_reservation_groups
  SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_reservation_lines
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND state IN ('payment_pending', 'approved_payment_required');
  UPDATE public.stay_reservation_groups
  SET booking_source = v_source,
      payment_collection = 'property',
      created_by_staff_user_id = v_uid,
      user_id = NULL,
      state = 'confirmed',
      request_deadline = NULL,
      payment_deadline = NULL,
      version = version + 1,
      updated_at = now()
  WHERE id = v_group.id;

  -- Request-mode guest creation normally notifies staff. This is the same
  -- transaction and has not committed, so remove only that superseded outbox
  -- fanout before a worker can observe it. The immutable event stays as audit
  -- history but staff projections hide it in favour of the truthful event.
  SELECT event_row.id INTO v_initial_event_id
  FROM public.stay_reservation_events event_row
  WHERE event_row.group_id = v_group.id
    AND event_row.idempotency_key =
      'create:' || pg_catalog.btrim(p_idempotency_key);
  IF v_initial_event_id IS NOT NULL THEN
    DELETE FROM public.notification_outbox outbox
    WHERE outbox.idempotency_key LIKE
      'stay:' || v_initial_event_id::text || ':%';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_staff_reservation_created', 'staff', v_uid,
    p_request_id, 'staff-create:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'bookingSource', v_source,
      'paymentCollection', 'property',
      'amountMinor', v_group.total_minor::text,
      'currencyCode', v_group.currency_code
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;

  RETURN public.issue_1426_staff_group_projection(v_group.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_staff_group_projection(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_base jsonb;
  v_can_finance boolean;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, v_uid, 'view'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_can_finance := public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, v_uid, 'finance'
  );
  v_base := public.issue_1388_group_projection(p_group_id);

  -- The guest creation event remains immutable audit evidence, but it is not
  -- an operator-facing description of a property booking.
  IF v_group.payment_collection = 'property' THEN
    v_base := jsonb_set(
      v_base,
      '{events}',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'eventType', event_row.event_type,
          'actorType', event_row.actor_type,
          'metadata', event_row.safe_metadata,
          'createdAt', event_row.created_at
        ) ORDER BY event_row.created_at, event_row.id)
        FROM public.stay_reservation_events event_row
        WHERE event_row.group_id = p_group_id
          AND event_row.event_type NOT IN (
            'stay_instant_payment_pending', 'stay_request_submitted'
          )
      ), '[]'::jsonb),
      true
    );
  END IF;

  RETURN v_base || jsonb_build_object(
    'bookingSource', v_group.booking_source,
    'paymentCollection', v_group.payment_collection,
    'createdByStaffUserId', v_group.created_by_staff_user_id,
    'permissions', jsonb_build_object(
      'canView', true,
      'canCreate', public.issue_4188_has_stay_permission(
        v_group.venue_id, v_group.brand_id, v_uid, 'create'
      ),
      'canRespond', public.issue_4188_has_stay_permission(
        v_group.venue_id, v_group.brand_id, v_uid, 'respond'
      ),
      'canCancel', public.issue_4188_has_stay_permission(
        v_group.venue_id, v_group.brand_id, v_uid, 'cancel'
      ),
      'canViewFinance', v_can_finance
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', line.id,
        'offeringId', line.offering_id,
        'kind', line.kind,
        'state', line.state,
        'roomCheckIn', line.room_check_in,
        'roomCheckOut', line.room_check_out,
        'roomQuantity', line.room_quantity,
        'placeWindowId', line.place_window_id,
        'placeUnits', line.place_units,
        'placeGuests', line.place_guests,
        'adults', line.adults,
        'children', line.children,
        'baseMinor', line.base_minor::text,
        'feeMinor', line.fee_minor::text,
        'taxMinor', line.tax_minor::text,
        'totalMinor', line.total_minor::text,
        'dependencyRoomLineId', line.dependency_room_line_id,
        'offering', line.offering_snapshot,
        'price', line.price_snapshot,
        'policy', line.policy_snapshot,
        'schedule', quote_line.inventory_snapshot,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ordinal', allocation.allocation_ordinal,
            'adults', allocation.adults,
            'children', allocation.children,
            'namedUnitPreference', allocation.named_unit_preference
          ) ORDER BY allocation.allocation_ordinal)
          FROM public.stay_quote_allocations allocation
          WHERE allocation.quote_line_id = line.quote_line_id
        ), '[]'::jsonb),
        'fees', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', fee.name,
            'kind', fee.fee_kind,
            'amountMinor', fee.amount_minor::text,
            'includedInBase', fee.included_in_base,
            'refundTreatment', fee.refund_treatment
          ) ORDER BY fee.name, fee.id)
          FROM public.stay_quote_fee_lines fee
          WHERE fee.quote_line_id = line.quote_line_id
        ), '[]'::jsonb)
      ) ORDER BY line.kind, line.offering_id, line.place_window_id NULLS FIRST)
      FROM public.stay_reservation_lines line
      JOIN public.stay_quote_lines quote_line
        ON quote_line.id = line.quote_line_id
      WHERE line.group_id = p_group_id
    ), '[]'::jsonb),
    'paymentLink', (
      SELECT jsonb_build_object(
        'expiresAt', link.expires_at,
        'revokedAt', link.revoked_at,
        'emailRequested', link.email_requested,
        'smsRequested', link.sms_requested,
        'emailStatus', link.email_status,
        'smsStatus', link.sms_status,
        'emailSentAt', link.email_sent_at,
        'smsSentAt', link.sms_sent_at,
        'lastOpenedAt', link.last_opened_at,
        'version', link.version
      )
      FROM public.stay_staff_payment_links link
      WHERE link.group_id = p_group_id
    ),
    'payment', CASE WHEN v_group.payment_collection = 'property' THEN NULL
      ELSE (
        SELECT jsonb_build_object(
          'state', payment.state,
          'provider', payment.provider,
          'amountMinor', payment.amount_minor::text,
          'applicationFeeMinor', CASE WHEN v_can_finance
            THEN payment.application_fee_minor::text ELSE NULL END,
          'succeededAt', payment.succeeded_at,
          'updatedAt', payment.updated_at
        )
        FROM public.stay_payment_attempts payment
        WHERE payment.group_id = p_group_id
        ORDER BY payment.attempt_ordinal DESC
        LIMIT 1
      ) END,
    'refunds', CASE WHEN v_group.payment_collection = 'property'
      THEN '[]'::jsonb
      ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'refundId', refund.id,
          'state', refund.state,
          'amountMinor', refund.amount_minor::text,
          'reason', refund.reason,
          'requestedByType', refund.requested_by_type,
          'createdAt', refund.created_at,
          'updatedAt', refund.updated_at
        ) ORDER BY refund.created_at DESC, refund.id DESC)
        FROM public.stay_refunds refund
        WHERE refund.group_id = p_group_id
      ), '[]'::jsonb) END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_list_staff_stay_reservations(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_venue.id, v_venue.brand_id, v_uid, 'view'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'permissions', jsonb_build_object(
      'canView', true,
      'canCreate', public.issue_4188_has_stay_permission(
        v_venue.id, v_venue.brand_id, v_uid, 'create'
      ),
      'canRespond', public.issue_4188_has_stay_permission(
        v_venue.id, v_venue.brand_id, v_uid, 'respond'
      ),
      'canCancel', public.issue_4188_has_stay_permission(
        v_venue.id, v_venue.brand_id, v_uid, 'cancel'
      ),
      'canViewFinance', public.issue_4188_has_stay_permission(
        v_venue.id, v_venue.brand_id, v_uid, 'finance'
      )
    ),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', group_row.id,
        'publicReference', group_row.public_reference,
        'venueId', group_row.venue_id,
        'brandId', group_row.brand_id,
        'currencyCode', group_row.currency_code,
        'mode', group_row.mode,
        'state', group_row.state,
        'guest', group_row.guest_snapshot,
        'bookingSource', group_row.booking_source,
        'paymentCollection', group_row.payment_collection,
        'totalMinor', group_row.total_minor::text,
        'lineCount', counts.line_count,
        'roomCount', counts.room_count,
        'placeCount', counts.place_count,
        'requestDeadline', group_row.request_deadline,
        'paymentDeadline', group_row.payment_deadline,
        'paymentState', payment.state,
        'paymentLink', CASE WHEN payment_link.group_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'expiresAt', payment_link.expires_at,
            'revokedAt', payment_link.revoked_at,
            'emailStatus', payment_link.email_status,
            'smsStatus', payment_link.sms_status,
            'version', payment_link.version
          ) END,
        'refundState', refund.state,
        'version', group_row.version,
        'createdAt', group_row.created_at,
        'updatedAt', group_row.updated_at
      ) ORDER BY
        CASE group_row.state
          WHEN 'request_pending' THEN 0
          WHEN 'reconciliation_required' THEN 1
          WHEN 'approved_payment_required' THEN 2
          WHEN 'confirmed' THEN 3
          WHEN 'partially_cancelled' THEN 4
          ELSE 5
        END,
        group_row.created_at DESC,
        group_row.id DESC)
      FROM public.stay_reservation_groups group_row
      CROSS JOIN LATERAL (
        SELECT
          count(*)::integer AS line_count,
          count(*) FILTER (WHERE line.kind = 'room')::integer AS room_count,
          count(*) FILTER (WHERE line.kind = 'place')::integer AS place_count
        FROM public.stay_reservation_lines line
        WHERE line.group_id = group_row.id
      ) counts
      LEFT JOIN LATERAL (
        SELECT attempt.state
        FROM public.stay_payment_attempts attempt
        WHERE attempt.group_id = group_row.id
        ORDER BY attempt.attempt_ordinal DESC
        LIMIT 1
      ) payment ON group_row.payment_collection = 'mingla'
      LEFT JOIN public.stay_staff_payment_links payment_link
        ON payment_link.group_id = group_row.id
      LEFT JOIN LATERAL (
        SELECT refund_row.state
        FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = group_row.id
        ORDER BY refund_row.created_at DESC, refund_row.id DESC
        LIMIT 1
      ) refund ON group_row.payment_collection = 'mingla'
      WHERE group_row.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.issue_4188_prepare_staff_link_payment(
  p_token_hash bytea,
  p_idempotency_key text,
  p_expected_group_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_link public.stay_staff_payment_links%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_result jsonb;
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
  WHERE reservation_group.id = v_link.group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.created_by_staff_user_id IS NULL
     OR v_group.booking_source = 'guest' THEN
    RAISE EXCEPTION 'stay_payment_link_not_actionable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_reservation_groups
  SET user_id = v_group.created_by_staff_user_id
  WHERE id = v_group.id;
  PERFORM set_config(
    'request.jwt.claim.sub', v_group.created_by_staff_user_id::text, true
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_group.created_by_staff_user_id,
      'role', 'authenticated'
    )::text,
    true
  );
  v_result := public.issue_1389_prepare_payment(
    v_group.id,
    p_idempotency_key,
    p_expected_group_version,
    p_request_id
  );
  UPDATE public.stay_reservation_groups
  SET user_id = NULL
  WHERE id = v_group.id;
  UPDATE public.stay_reservation_events
  SET actor_type = 'service',
      actor_user_id = NULL,
      safe_metadata = safe_metadata || jsonb_build_object(
        'staffPaymentLink', true,
        'createdByStaffUserId', v_group.created_by_staff_user_id
      )
  WHERE group_id = v_group.id
    AND idempotency_key = 'payment-prepared:' || (v_result ->> 'attemptId');
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_update_staff_link_delivery(
  p_group_id uuid,
  p_email_status text,
  p_sms_status text,
  p_email_error_code text DEFAULT NULL,
  p_sms_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role()
     OR p_email_status NOT IN ('not_requested', 'pending', 'sent', 'failed')
     OR p_sms_status NOT IN ('not_requested', 'pending', 'sent', 'failed') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.stay_staff_payment_links
  SET email_status = p_email_status,
      sms_status = p_sms_status,
      email_error_code = CASE WHEN p_email_status = 'failed'
        THEN left(COALESCE(p_email_error_code, 'send_failed'), 80) ELSE NULL END,
      sms_error_code = CASE WHEN p_sms_status = 'failed'
        THEN left(COALESCE(p_sms_error_code, 'send_failed'), 80) ELSE NULL END,
      email_sent_at = CASE WHEN p_email_status = 'sent' THEN now() ELSE email_sent_at END,
      sms_sent_at = CASE WHEN p_sms_status = 'sent' THEN now() ELSE sms_sent_at END,
      version = version + 1,
      updated_at = now()
  WHERE group_id = p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_rotate_staff_payment_link(
  p_group_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz,
  p_send_email boolean,
  p_send_sms boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups reservation_group
  WHERE reservation_group.id = p_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, auth.uid(), 'create'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_group.state NOT IN ('instant_payment_pending', 'approved_payment_required')
     OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR p_expires_at <= now() OR p_expires_at > now() + interval '7 days' THEN
    RAISE EXCEPTION 'stay_payment_link_not_actionable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_staff_payment_links
  SET token_hash = p_token_hash,
      expires_at = p_expires_at,
      revoked_at = NULL,
      email_requested = COALESCE(p_send_email, false),
      sms_requested = COALESCE(p_send_sms, false),
      email_status = CASE WHEN COALESCE(p_send_email, false) THEN 'pending' ELSE 'not_requested' END,
      sms_status = CASE WHEN COALESCE(p_send_sms, false) THEN 'pending' ELSE 'not_requested' END,
      email_error_code = NULL,
      sms_error_code = NULL,
      version = version + 1,
      updated_at = now()
  WHERE group_id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_link_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.stay_inventory_holds
  SET expires_at = p_expires_at, version = version + 1, updated_at = now()
  WHERE group_id = p_group_id AND state = 'active';
  UPDATE public.stay_reservation_groups
  SET payment_deadline = p_expires_at, version = version + 1, updated_at = now()
  WHERE id = p_group_id;
  RETURN public.issue_1426_staff_group_projection(p_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_revoke_staff_payment_link(
  p_group_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups reservation_group
  WHERE reservation_group.id = p_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, auth.uid(), 'cancel'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_group.state NOT IN ('instant_payment_pending', 'approved_payment_required')
     OR EXISTS (
       SELECT 1 FROM public.stay_payment_attempts attempt
       WHERE attempt.group_id = p_group_id
         AND attempt.state IN ('created', 'pending', 'processing', 'succeeded')
     ) THEN
    RAISE EXCEPTION 'stay_payment_link_not_actionable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_staff_payment_links
  SET revoked_at = now(), version = version + 1, updated_at = now()
  WHERE group_id = p_group_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_link_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.stay_inventory_holds
  SET state = 'released', reason = 'staff_payment_link_revoked',
      version = version + 1, updated_at = now()
  WHERE group_id = p_group_id AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = p_group_id
    AND state IN ('payment_pending', 'approved_payment_required');
  UPDATE public.stay_reservation_groups
  SET state = 'cancelled', payment_deadline = NULL,
      version = version + 1, updated_at = now()
  WHERE id = p_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_staff_payment_link_revoked', 'staff', auth.uid(),
    'staff-link-revoked:' || p_group_id::text,
    jsonb_build_object('reason', left(pg_catalog.btrim(COALESCE(p_reason, '')), 500))
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN public.issue_1426_staff_group_projection(p_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_property_cancel_preview(
  p_group_id uuid,
  p_selected_line_ids uuid[],
  p_expected_group_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_selected uuid[];
  v_actor_type text;
  v_preview_id uuid := gen_random_uuid();
  v_hash text;
  v_expires_at timestamptz := now() + interval '10 minutes';
  v_commitment_count integer := 0;
  v_room_quantity bigint := 0;
  v_place_quantity bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR cardinality(p_selected_line_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_selected_line_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT selected_id ORDER BY selected_id)
  INTO v_selected
  FROM unnest(p_selected_line_ids) selected_id;
  IF cardinality(v_selected) <> cardinality(p_selected_line_ids) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.payment_collection <> 'property' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, v_uid, 'cancel'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_actor_type := CASE WHEN public.is_admin_user()
    THEN 'admin' ELSE 'staff' END;
  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF (
    SELECT count(*) FROM public.stay_reservation_lines line
    WHERE line.group_id = p_group_id
      AND line.id = ANY(v_selected)
      AND line.state = 'confirmed'
  ) <> cardinality(v_selected) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_selected)
      AND room_line.kind = 'room'
      AND place_line.group_id = p_group_id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_selected))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(commitment.quantity) FILTER (
      WHERE commitment.resource_type = 'room_night'
    ), 0),
    COALESCE(sum(commitment.quantity) FILTER (
      WHERE commitment.resource_type = 'place_window'
    ), 0)
  INTO v_commitment_count, v_room_quantity, v_place_quantity
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = p_group_id
    AND commitment.reservation_line_id = ANY(v_selected)
    AND commitment.state = 'active';

  v_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'previewId', v_preview_id,
        'groupId', p_group_id,
        'groupVersion', v_group.version,
        'actorUserId', v_uid,
        'selectedLineIds', to_jsonb(v_selected),
        'paymentCollection', 'property',
        'expiresAt', v_expires_at
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  INSERT INTO public.stay_cancel_previews (
    id, group_id, actor_user_id, actor_type, selected_line_ids,
    group_version, amount_minor, allocation_snapshot, preview_hash, expires_at
  ) VALUES (
    v_preview_id, p_group_id, v_uid, v_actor_type, v_selected,
    v_group.version, 0, '[]'::jsonb, v_hash, v_expires_at
  );

  RETURN jsonb_build_object(
    'previewId', v_preview_id,
    'previewHash', v_hash,
    'groupId', p_group_id,
    'groupVersion', v_group.version,
    'selectedLineIds', to_jsonb(v_selected),
    'amountMinor', '0',
    'retainedAmountMinor', '0',
    'currencyCode', v_group.currency_code,
    'allocations', '[]'::jsonb,
    'paymentCollection', 'property',
    'externalRefundHandledBy', 'property',
    'expiresAt', v_expires_at,
    'inventoryRelease', jsonb_build_object(
      'lineCount', cardinality(v_selected),
      'commitmentCount', v_commitment_count,
      'roomNightQuantity', v_room_quantity,
      'placeQuantity', v_place_quantity
    ),
    'payoutEffect', jsonb_build_object(
      'applicationFeeReversalMinor', '0',
      'organizerLiabilityMinor', '0',
      'alreadyReleasedMinor', '0',
      'payoutReversalMinor', '0',
      'futureReleaseReductionMinor', '0',
      'requiresPayoutReversal', false
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_property_cancel(
  p_preview_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_reason text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_prior public.stay_reservation_events%ROWTYPE;
  v_all_cancelled boolean;
  v_event_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview_id IS NULL
     OR p_preview_hash !~ '^[a-f0-9]{64}$'
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
       NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-property-cancel:' || p_preview_id::text,
      4188
    )
  );
  SELECT * INTO v_preview
  FROM public.stay_cancel_previews
  WHERE id = p_preview_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_preview.actor_user_id <> v_uid
     OR v_preview.preview_hash <> p_preview_hash THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_preview.group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.payment_collection <> 'property' THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4188_has_stay_permission(
    v_group.venue_id, v_group.brand_id, v_uid, 'cancel'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prior
  FROM public.stay_reservation_events event_row
  WHERE event_row.group_id = v_group.id
    AND event_row.idempotency_key =
      'cancel:' || pg_catalog.btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_prior.safe_metadata->'selectedLineIds'
       IS DISTINCT FROM to_jsonb(v_preview.selected_line_ids) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'refundId', NULL,
      'groupId', v_group.id,
      'state', 'not_applicable',
      'amountMinor', '0',
      'currencyCode', v_group.currency_code,
      'paymentCollection', 'property',
      'group', public.issue_1426_staff_group_projection(v_group.id)
    );
  END IF;
  IF v_preview.consumed_at IS NOT NULL OR v_preview.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_cancel_preview_expired' USING ERRCODE = '22023';
  END IF;
  IF v_group.version <> v_preview.group_version
     OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_preview.selected_line_ids)
      AND room_line.kind = 'room'
      AND place_line.group_id = v_group.id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_preview.selected_line_ids))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = v_group.id
    AND commitment.reservation_line_id = ANY(v_preview.selected_line_ids)
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;
  UPDATE public.stay_inventory_commitments
  SET state = 'released',
      released_at = now(),
      release_reason = 'reservation_cancelled'
  WHERE group_id = v_group.id
    AND reservation_line_id = ANY(v_preview.selected_line_ids)
    AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND id = ANY(v_preview.selected_line_ids)
    AND state = 'confirmed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  SELECT NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_lines line
    WHERE line.group_id = v_group.id AND line.state = 'confirmed'
  ) INTO v_all_cancelled;
  UPDATE public.stay_reservation_groups
  SET state = CASE WHEN v_all_cancelled
        THEN 'cancelled' ELSE 'partially_cancelled' END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_cancel_previews
  SET consumed_at = now()
  WHERE id = v_preview.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_cancelled', v_preview.actor_type, v_uid,
    p_request_id, 'cancel:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'selectedLineIds', to_jsonb(v_preview.selected_line_ids),
      'amountMinor', '0',
      'currencyCode', v_group.currency_code,
      'paymentCollection', 'property',
      'externalRefundHandledBy', 'property',
      'reason', pg_catalog.btrim(p_reason)
    )
  ) RETURNING id INTO v_event_id;
  -- Property bookings do not have a Mingla guest identity. The shared Stay
  -- notification trigger would otherwise attach the staff actor's user_id to
  -- the guest snapshot contact, so suppress that same-transaction outbox and
  -- leave offline guest communication to the property.
  DELETE FROM public.notification_outbox outbox
  WHERE outbox.idempotency_key LIKE 'stay:' || v_event_id::text || ':%';

  RETURN jsonb_build_object(
    'refundId', NULL,
    'groupId', v_group.id,
    'state', 'not_applicable',
    'amountMinor', '0',
    'currencyCode', v_group.currency_code,
    'paymentCollection', 'property',
    'group', public.issue_1426_staff_group_projection(v_group.id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_cancel_preview(
  p_group_id uuid,
  p_selected_line_ids uuid[],
  p_expected_group_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_collection text;
BEGIN
  SELECT payment_collection INTO v_collection
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_collection = 'property' THEN
    RETURN public.issue_4188_property_cancel_preview(
      p_group_id,
      p_selected_line_ids,
      p_expected_group_version,
      p_request_id
    );
  END IF;
  RETURN public.issue_1426_cancel_preview(
    p_group_id,
    p_selected_line_ids,
    p_expected_group_version,
    p_request_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4188_cancel(
  p_preview_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_reason text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_collection text;
BEGIN
  SELECT reservation_group.payment_collection INTO v_collection
  FROM public.stay_cancel_previews preview
  JOIN public.stay_reservation_groups reservation_group
    ON reservation_group.id = preview.group_id
  WHERE preview.id = p_preview_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_collection = 'property' THEN
    RETURN public.issue_4188_property_cancel(
      p_preview_id,
      p_preview_hash,
      p_idempotency_key,
      p_reason,
      p_request_id
    );
  END IF;
  RETURN public.issue_1426_cancel(
    p_preview_id,
    p_preview_hash,
    p_idempotency_key,
    p_reason,
    p_request_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_my_stay_reservation_groups()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'groupId', reservation_group.id,
      'publicReference', reservation_group.public_reference,
      'venueId', reservation_group.venue_id,
      'venueName', venue.name,
      'venueSlug', venue.slug,
      'brandId', reservation_group.brand_id,
      'brandName', brand.name,
      'brandSlug', brand.slug,
      'currencyCode', reservation_group.currency_code,
      'mode', reservation_group.mode,
      'state', reservation_group.state,
      'requestDeadline', reservation_group.request_deadline,
      'paymentDeadline', reservation_group.payment_deadline,
      'totalMinor', reservation_group.total_minor::text,
      'version', reservation_group.version,
      'createdAt', reservation_group.created_at,
      'updatedAt', reservation_group.updated_at,
      'lines', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lineId', reservation_line.id,
          'kind', reservation_line.kind,
          'state', reservation_line.state,
          'name', reservation_line.offering_snapshot->>'name',
          'roomCheckIn', reservation_line.room_check_in,
          'roomCheckOut', reservation_line.room_check_out,
          'roomQuantity', reservation_line.room_quantity,
          'placeStartsAt', place_window.starts_at,
          'placeEndsAt', place_window.ends_at,
          'placeGuests', reservation_line.place_guests,
          'totalMinor', reservation_line.total_minor::text
        ) ORDER BY reservation_line.kind, reservation_line.id)
        FROM public.stay_reservation_lines reservation_line
        LEFT JOIN public.stay_place_windows place_window
          ON place_window.id = reservation_line.place_window_id
        WHERE reservation_line.group_id = reservation_group.id
      ), '[]'::jsonb)
    ) ORDER BY reservation_group.created_at DESC, reservation_group.id DESC)
    FROM public.stay_reservation_groups reservation_group
    JOIN public.venue_listings venue ON venue.id = reservation_group.venue_id
    JOIN public.brands brand ON brand.id = reservation_group.brand_id
    WHERE reservation_group.user_id = v_uid
      AND reservation_group.payment_collection = 'mingla'
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4188_create_staff_stay_group(
  uuid, text, jsonb, text, bigint, text, bytea, boolean, boolean,
  timestamptz, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_4188_staff_stay_details(uuid)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_4188_has_stay_permission(
  uuid, uuid, uuid, text
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_guard_stay_group_source_truth()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_property_cancel_preview(
  uuid, uuid[], bigint, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_property_cancel(
  uuid, text, text, text, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_cancel_preview(
  uuid, uuid[], bigint, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_4188_cancel(
  uuid, text, text, text, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_4188_staff_payment_link_details(bytea)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_prepare_staff_link_payment(
  bytea, text, bigint, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_update_staff_link_delivery(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4188_rotate_staff_payment_link(
  uuid, bytea, timestamptz, boolean, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_4188_revoke_staff_payment_link(uuid, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.issue_4188_create_staff_stay_group(
  uuid, text, jsonb, text, bigint, text, bytea, boolean, boolean,
  timestamptz, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_staff_stay_details(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_cancel_preview(
  uuid, uuid[], bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_cancel(
  uuid, text, text, text, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_staff_payment_link_details(bytea)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_prepare_staff_link_payment(
  bytea, text, bigint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_update_staff_link_delivery(
  uuid, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_rotate_staff_payment_link(
  uuid, bytea, timestamptz, boolean, boolean
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_4188_revoke_staff_payment_link(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.issue_4188_create_staff_stay_group(
  uuid, text, jsonb, text, bigint, text, bytea, boolean, boolean,
  timestamptz, uuid
) IS 'Issue #4188: permissioned staff front-desk booking using canonical Stay quote and inventory truth, with property collection or a revocable guest payment link.';
COMMENT ON FUNCTION public.issue_4188_staff_stay_details(uuid) IS
  'Issue #4188: permissioned Room/Place selector data for staff booking, independent of public-page publication.';
COMMENT ON FUNCTION public.issue_4188_cancel_preview(
  uuid, uuid[], bigint, uuid
) IS 'Issue #4188: routes property-collected Stay cancellations away from provider refund logic.';
COMMENT ON FUNCTION public.pg_my_stay_reservation_groups() IS
  'Issue #4188: authenticated guest Stay itinerary excludes staff-created property-collected reservations.';

COMMIT;

NOTIFY pgrst, 'reload schema';
