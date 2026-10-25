BEGIN;
SET LOCAL lock_timeout = '10s';

-- #4063 Wave 1: public claim pointers and separately verified extra contacts.
-- A claim link identifies a subject for display. It never grants ownership.
CREATE TABLE IF NOT EXISTS public.claim_links (
  code text PRIMARY KEY CHECK (code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
  purpose text NOT NULL DEFAULT 'claim'
    CHECK (purpose IN ('claim','handoff','redirect')),
  subject_kind text NOT NULL
    CHECK (subject_kind IN (
      'order','rsvp','rsvp_guest','reservation','stay_group','venue_order',
      'ticket','waitlist_offer'
    )),
  subject_id uuid NOT NULL,
  parent_code text NULL REFERENCES public.claim_links(code) ON DELETE CASCADE,
  target_url text NULL,
  requester_ip_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT claim_links_handoff_shape
    CHECK ((purpose = 'handoff') = (parent_code IS NOT NULL)),
  CONSTRAINT claim_links_redirect_target_shape
    CHECK ((purpose = 'redirect') = (target_url IS NOT NULL)),
  CONSTRAINT claim_links_redirect_kind_shape
    CHECK (purpose <> 'redirect' OR subject_kind = 'waitlist_offer'),
  CONSTRAINT claim_links_waitlist_shape
    CHECK (purpose = 'redirect' OR subject_kind <> 'waitlist_offer'),
  CONSTRAINT claim_links_target_origin
    CHECK (target_url IS NULL OR target_url ~ '^https://([a-z0-9-]+\.)*usemingla\.com/checkout/'),
  CONSTRAINT claim_links_target_no_bearer
    CHECK (target_url IS NULL OR target_url !~ '[#?&](attentionToken|token)=')
);

CREATE UNIQUE INDEX IF NOT EXISTS claim_links_one_active_per_subject
  ON public.claim_links (purpose, subject_kind, subject_id)
  WHERE purpose IN ('claim','redirect') AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS claim_links_handoff_recent
  ON public.claim_links (parent_code, requester_ip_hash, created_at DESC)
  WHERE purpose = 'handoff';

ALTER TABLE public.claim_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.claim_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.claim_links TO service_role;

CREATE TABLE IF NOT EXISTS public.contact_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('claim_sign_in','add_contact')),
  channel text NOT NULL CHECK (channel IN ('email','phone')),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_code text NULL REFERENCES public.claim_links(code) ON DELETE CASCADE,
  target_value text NOT NULL,
  code_hash text NULL,
  ip_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz NULL,
  CONSTRAINT contact_challenges_shape CHECK (
    (purpose = 'add_contact' AND user_id IS NOT NULL AND claim_code IS NULL)
    OR (purpose = 'claim_sign_in' AND user_id IS NULL
      AND claim_code IS NOT NULL AND channel = 'email')
  ),
  CONSTRAINT contact_challenges_email_hash
    CHECK (channel <> 'email' OR code_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS contact_challenges_target_recent
  ON public.contact_challenges (target_value, created_at DESC);
CREATE INDEX IF NOT EXISTS contact_challenges_claim_recent
  ON public.contact_challenges (claim_code, created_at DESC)
  WHERE claim_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_challenges_user_recent
  ON public.contact_challenges (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contact_challenges_ip_recent
  ON public.contact_challenges (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

ALTER TABLE public.contact_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_challenges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_challenges
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4063_claim_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions
AS $function$
DECLARE
  v_bits bit(64) := ('x' || encode(extensions.gen_random_bytes(8), 'hex'))::bit(64);
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text := '';
  v_i integer;
BEGIN
  FOR v_i IN 0..9 LOOP
    v_code := v_code || substr(
      v_alphabet,
      substring(v_bits FROM v_i * 5 + 1 FOR 5)::integer + 1,
      1
    );
  END LOOP;
  RETURN v_code;
END;
$function$;

-- Internal service-role helper. The full contact fields returned here are
-- stripped by resolve_claim_link before any anonymous response is produced.
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
      WHERE g.id = p_subject_id;

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
  IF p_subject_kind = 'ticket' THEN
    RAISE EXCEPTION 'claim_kind_unavailable' USING ERRCODE = '22023';
  END IF;
  IF p_subject_kind NOT IN (
    'order','rsvp','rsvp_guest','reservation','stay_group','venue_order'
  ) OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'claim_kind_invalid' USING ERRCODE = '22023';
  END IF;

  v_subject := public.issue_4063_claim_subject(p_subject_kind, p_subject_id);
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

CREATE OR REPLACE FUNCTION public.mint_redirect_link(
  p_subject_kind text,
  p_subject_id uuid,
  p_target_url text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_code text;
  v_try integer;
BEGIN
  IF p_subject_kind <> 'waitlist_offer' OR p_subject_id IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'redirect_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.waitlist_entries w WHERE w.id = p_subject_id
  ) THEN
    RAISE EXCEPTION 'claim_subject_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- The table constraints are the final allow-list for the target URL.
  FOR v_try IN 1..5 LOOP
    SELECT l.code INTO v_code
      FROM public.claim_links l
     WHERE l.purpose = 'redirect' AND l.subject_kind = p_subject_kind
       AND l.subject_id = p_subject_id AND l.revoked_at IS NULL;
    IF v_code IS NOT NULL THEN
      UPDATE public.claim_links
         SET target_url = p_target_url,
             expires_at = greatest(expires_at, p_expires_at)
       WHERE code = v_code;
      RETURN jsonb_build_object('code', v_code, 'expiresAt',
        greatest((SELECT expires_at FROM public.claim_links WHERE code = v_code), p_expires_at));
    END IF;
    v_code := public.issue_4063_claim_code();
    BEGIN
      INSERT INTO public.claim_links(
        code, purpose, subject_kind, subject_id, target_url, expires_at
      ) VALUES (
        v_code, 'redirect', p_subject_kind, p_subject_id,
        p_target_url, p_expires_at
      );
      RETURN jsonb_build_object('code', v_code, 'expiresAt', p_expires_at);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'claim_code_unavailable' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.mint_claim_link_handoff(
  p_code text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_parent text := upper(btrim(coalesce(p_code, '')));
  v_code text;
  v_expiry timestamptz := now() + interval '10 minutes';
  v_try integer;
BEGIN
  IF v_parent !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'
     OR nullif(btrim(coalesce(p_ip_hash, '')), '') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.claim_links l
        WHERE l.code = v_parent AND l.purpose = 'claim'
          AND l.revoked_at IS NULL AND l.expires_at >= now()
     ) THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  IF (
    SELECT count(*) FROM public.claim_links l
     WHERE l.purpose = 'handoff' AND l.parent_code = v_parent
       AND l.requester_ip_hash = p_ip_hash
       AND l.created_at > now() - interval '10 minutes'
  ) >= 5 THEN
    RETURN jsonb_build_object('outcome', 'rate_limited');
  END IF;

  FOR v_try IN 1..5 LOOP
    v_code := public.issue_4063_claim_code();
    BEGIN
      INSERT INTO public.claim_links(
        code, purpose, subject_kind, subject_id, parent_code,
        requester_ip_hash, expires_at
      )
      SELECT v_code, 'handoff', subject_kind, subject_id, code,
             p_ip_hash, v_expiry
        FROM public.claim_links WHERE code = v_parent;
      RETURN jsonb_build_object(
        'outcome', 'ok', 'code', v_code, 'expiresAt', v_expiry
      );
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'claim_code_unavailable' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_claim_link(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_link public.claim_links%ROWTYPE;
  v_parent public.claim_links%ROWTYPE;
  v_subject jsonb;
  v_status text;
  v_redirect_code text;
  v_email text;
  v_phone text;
BEGIN
  IF v_code !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  SELECT * INTO v_link FROM public.claim_links WHERE code = v_code;
  IF NOT FOUND OR v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_link.purpose = 'redirect' THEN
    IF v_link.expires_at < now() THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    RETURN jsonb_build_object('status', 'redirect', 'url', v_link.target_url);
  END IF;

  IF v_link.purpose = 'handoff' THEN
    UPDATE public.claim_links
       SET consumed_at = now()
     WHERE code = v_link.code AND consumed_at IS NULL
       AND revoked_at IS NULL AND expires_at >= now()
    RETURNING * INTO v_link;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_redirect_code := v_link.parent_code;
    SELECT * INTO v_parent FROM public.claim_links
      WHERE code = v_link.parent_code AND purpose = 'claim'
        AND revoked_at IS NULL;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found');
    END IF;
    v_link := v_parent;
  END IF;

  IF v_link.subject_kind = 'ticket' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_subject := public.issue_4063_claim_subject(
    v_link.subject_kind, v_link.subject_id
  );
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_status := CASE WHEN v_link.expires_at < now() THEN 'expired' ELSE 'active' END;
  v_email := nullif(v_subject->>'email', '');
  v_phone := nullif(v_subject->>'phone', '');

  RETURN jsonb_build_object(
    'status', v_status,
    'code', v_link.code,
    'redirectCode', v_redirect_code,
    'kind', v_link.subject_kind,
    'noun', v_subject->>'noun',
    'title', v_subject->>'title',
    'brandName', v_subject->>'brandName',
    'orderLabel', v_subject->>'orderLabel',
    'startsAt', v_subject->>'startsAt',
    'timezone', v_subject->>'timezone',
    'quantity', coalesce((v_subject->>'quantity')::integer, 1),
    'emailMasked', public.mask_contact_for_claim(v_email, 'email'),
    'phoneLast4', CASE WHEN v_phone ~ '^\+[1-9][0-9]{4,14}$'
      THEN right(v_phone, 4) ELSE NULL END,
    'preferredProof', coalesce(v_subject->>'preferredProof', 'any')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_revoke_claim_links(
  p_kind text,
  p_subject_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.claim_links
     SET revoked_at = now()
   WHERE subject_kind = p_kind AND subject_id = p_subject_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_claim_prefill(
  p_code text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_link public.claim_links%ROWTYPE;
  v_subject jsonb;
  v_name text;
  v_first text;
  v_last text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_proven');
  END IF;
  SELECT * INTO v_link FROM public.claim_links l
   WHERE l.code = upper(btrim(coalesce(p_code, '')))
     AND l.purpose = 'claim' AND l.revoked_at IS NULL;
  IF NOT FOUND OR v_link.subject_kind = 'ticket' THEN
    RETURN jsonb_build_object('outcome', 'not_proven');
  END IF;
  v_subject := public.issue_4063_claim_subject(
    v_link.subject_kind, v_link.subject_id
  );
  IF v_subject IS NULL OR NOT public.account_owns_contact(
    p_user_id, nullif(v_subject->>'email', ''), NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'not_proven');
  END IF;
  v_name := btrim(coalesce(v_subject->>'name', ''));
  v_first := nullif(split_part(v_name, ' ', 1), '');
  v_last := nullif(btrim(substr(v_name, length(coalesce(v_first, '')) + 1)), '');
  RETURN jsonb_build_object(
    'outcome', 'ok', 'firstName', v_first, 'lastName', v_last,
    'phoneE164', nullif(v_subject->>'phone', '')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_contact_conflict(
  p_user_id uuid,
  p_channel text,
  p_value text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_value text;
  v_other uuid;
  v_conflict boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_channel NOT IN ('email','phone') THEN
    RETURN 'invalid';
  END IF;
  v_value := CASE WHEN p_channel = 'email'
    THEN lower(btrim(coalesce(p_value, '')))
    ELSE btrim(coalesce(p_value, '')) END;
  IF (p_channel = 'email' AND v_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (p_channel = 'phone' AND v_value !~ '^\+[1-9][0-9]{1,14}$') THEN
    RETURN 'invalid';
  END IF;
  IF public.account_owns_contact(
    p_user_id,
    CASE WHEN p_channel = 'email' THEN v_value END,
    CASE WHEN p_channel = 'phone' THEN v_value END
  ) THEN
    RETURN 'already_on_this_account';
  END IF;

  IF p_channel = 'phone' THEN
    IF EXISTS (
      SELECT 1 FROM public.verified_phone_identities p
       WHERE p.phone_e164 = v_value AND p.user_id <> p_user_id
    ) THEN RETURN 'already_other_account'; END IF;
    IF to_regclass('auth.identities') IS NOT NULL THEN
      EXECUTE $ev$
        SELECT EXISTS (
          SELECT 1 FROM auth.identities i
           WHERE i.user_id <> $1 AND i.provider = 'phone'
             AND '+' || regexp_replace(
               coalesce(i.identity_data->>'phone', ''), '[^0-9]', '', 'g'
             ) = $2
        )
      $ev$ INTO v_conflict USING p_user_id, v_value;
      IF v_conflict THEN RETURN 'already_other_account'; END IF;
    END IF;
  ELSE
    IF to_regclass('auth.users') IS NOT NULL THEN
      FOR v_other IN EXECUTE $ev$
        SELECT id FROM auth.users
         WHERE id <> $1 AND lower(btrim(coalesce(email, ''))) = $2
      $ev$ USING p_user_id, v_value LOOP
        IF public.account_owns_contact(v_other, v_value, NULL) THEN
          RETURN 'already_other_account';
        END IF;
      END LOOP;
    END IF;
    IF to_regclass('auth.identities') IS NOT NULL THEN
      EXECUTE $ev$
        SELECT EXISTS (
          SELECT 1 FROM auth.identities i
           WHERE i.user_id <> $1
             AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = $2
             AND lower(coalesce(i.identity_data->>'email_verified', '')) IN ('true','t')
        )
      $ev$ INTO v_conflict USING p_user_id, v_value;
      IF v_conflict THEN RETURN 'already_other_account'; END IF;
    END IF;
  END IF;

  IF (
    SELECT count(*) FROM public.account_claim_contacts c
     WHERE c.user_id = p_user_id AND c.revoked_at IS NULL
  ) >= 5 THEN
    RETURN 'limit_reached';
  END IF;
  RETURN 'available';
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_begin_contact_challenge(
  p_challenge_id uuid,
  p_purpose text,
  p_channel text,
  p_user_id uuid,
  p_claim_code text,
  p_value text,
  p_code_hash text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_value text;
  v_claim text := upper(btrim(coalesce(p_claim_code, '')));
  v_subject jsonb;
  v_link public.claim_links%ROWTYPE;
  v_conflict text;
BEGIN
  IF p_challenge_id IS NULL OR p_purpose NOT IN ('claim_sign_in','add_contact')
     OR p_channel NOT IN ('email','phone') THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  IF p_purpose = 'claim_sign_in' THEN
    IF p_channel <> 'email' OR p_user_id IS NOT NULL OR p_value IS NOT NULL
       OR v_claim !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$' THEN
      RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    SELECT * INTO v_link FROM public.claim_links l
     WHERE l.code = v_claim AND l.purpose = 'claim'
       AND l.revoked_at IS NULL;
    IF NOT FOUND OR v_link.subject_kind = 'ticket' THEN
      RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    v_subject := public.issue_4063_claim_subject(
      v_link.subject_kind, v_link.subject_id
    );
    v_value := lower(btrim(coalesce(v_subject->>'email', '')));
    IF v_value = '' THEN
      RETURN jsonb_build_object('outcome', 'no_email');
    END IF;
    IF (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.ip_hash = p_ip_hash
         AND c.created_at > now() - interval '10 minutes'
    ) >= 10 OR (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.claim_code = v_claim AND c.ip_hash = p_ip_hash
         AND c.created_at > now() - interval '10 minutes'
    ) >= 3 OR (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.purpose = 'claim_sign_in' AND c.target_value = v_value
         AND c.created_at > now() - interval '24 hours'
    ) >= 20 THEN
      RETURN jsonb_build_object('outcome', 'rate_limited');
    END IF;
  ELSE
    IF p_user_id IS NULL OR p_claim_code IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'invalid');
    END IF;
    v_value := CASE WHEN p_channel = 'email'
      THEN lower(btrim(coalesce(p_value, '')))
      ELSE btrim(coalesce(p_value, '')) END;
    v_conflict := public.issue_4063_contact_conflict(
      p_user_id, p_channel, v_value
    );
    IF v_conflict <> 'available' THEN
      RETURN jsonb_build_object('outcome', v_conflict);
    END IF;
    IF (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.user_id = p_user_id
         AND c.created_at > now() - interval '10 minutes'
    ) >= 5 OR (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.user_id = p_user_id
         AND c.created_at > now() - interval '24 hours'
    ) >= 20 OR (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.user_id = p_user_id AND c.target_value = v_value
         AND c.purpose = 'add_contact'
         AND c.created_at > now() - interval '1 hour'
    ) >= 3 OR (p_channel = 'phone' AND (
      SELECT count(*) FROM public.contact_challenges c
       WHERE c.channel = 'phone' AND c.target_value = v_value
         AND c.created_at > now() - interval '10 minutes'
    ) >= 2) THEN
      RETURN jsonb_build_object('outcome', 'rate_limited');
    END IF;
  END IF;

  IF p_channel = 'email' AND nullif(btrim(coalesce(p_code_hash, '')), '') IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  INSERT INTO public.contact_challenges(
    id, purpose, channel, user_id, claim_code, target_value,
    code_hash, ip_hash
  ) VALUES (
    p_challenge_id, p_purpose, p_channel, p_user_id,
    CASE WHEN p_purpose = 'claim_sign_in' THEN v_claim END,
    v_value, p_code_hash, p_ip_hash
  );
  RETURN jsonb_build_object(
    'outcome', 'started', 'challengeId', p_challenge_id, 'target', v_value
  );
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('outcome', 'invalid');
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_settle_contact_challenge(
  p_challenge_id uuid,
  p_code_hash text,
  p_provider_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.contact_challenges%ROWTYPE;
  v_success boolean;
BEGIN
  SELECT * INTO v_row FROM public.contact_challenges
   WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_row.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN jsonb_build_object('outcome', 'locked');
  END IF;

  UPDATE public.contact_challenges SET attempts = attempts + 1
   WHERE id = p_challenge_id
  RETURNING * INTO v_row;
  v_success := CASE WHEN v_row.channel = 'email'
    THEN v_row.code_hash = p_code_hash
    ELSE p_provider_approved IS TRUE END;
  IF NOT v_success THEN
    RETURN jsonb_build_object(
      'outcome', 'bad_code', 'attemptsLeft', greatest(0, 5 - v_row.attempts)
    );
  END IF;
  UPDATE public.contact_challenges SET consumed_at = now()
   WHERE id = p_challenge_id;
  RETURN jsonb_build_object(
    'outcome', 'ok', 'purpose', v_row.purpose, 'channel', v_row.channel,
    'value', v_row.target_value, 'userId', v_row.user_id,
    'claimCode', v_row.claim_code
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_contact_challenge_for_user(
  p_challenge_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'outcome', 'ok', 'channel', c.channel, 'value', c.target_value
    )
      FROM public.contact_challenges c
     WHERE c.id = p_challenge_id AND c.purpose = 'add_contact'
       AND c.user_id = p_user_id AND c.consumed_at IS NULL
  ), jsonb_build_object('outcome', 'invalid'));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_record_claim_contact(
  p_user_id uuid,
  p_channel text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_value text;
  v_result text;
  v_try integer;
BEGIN
  v_value := CASE WHEN p_channel = 'email'
    THEN lower(btrim(coalesce(p_value, '')))
    ELSE btrim(coalesce(p_value, '')) END;
  v_result := public.issue_4063_contact_conflict(p_user_id, p_channel, v_value);
  IF v_result <> 'available' THEN
    RETURN jsonb_build_object('result', v_result);
  END IF;

  FOR v_try IN 1..2 LOOP
    BEGIN
      UPDATE public.account_claim_contacts
         SET revoked_at = now()
       WHERE channel = p_channel AND value = v_value
         AND user_id <> p_user_id AND revoked_at IS NULL;
      INSERT INTO public.account_claim_contacts(
        user_id, channel, value, verified_via
      ) VALUES (
        p_user_id, p_channel, v_value,
        CASE WHEN p_channel = 'email' THEN 'email_code' ELSE 'twilio_verify' END
      );
      RETURN jsonb_build_object('result', 'recorded');
    EXCEPTION WHEN unique_violation THEN
      IF v_try = 2 THEN
        RETURN jsonb_build_object('result', 'retry');
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('result', 'retry');
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4063_auth_user_for_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $ev$
    SELECT id FROM auth.users
     WHERE lower(btrim(coalesce(email, ''))) = lower(btrim($1))
     ORDER BY created_at LIMIT 1
  $ev$ INTO v_user_id USING p_email;
  RETURN v_user_id;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_my_claim_identifiers()
RETURNS TABLE(kind text, value text, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT DISTINCT ON (x.kind, x.value) x.kind, x.value, x.source
    FROM (
      SELECT v.kind, v.value, 'account'::text AS source
        FROM public.verified_account_identifiers(auth.uid()) v
       WHERE public.account_owns_contact(
         auth.uid(),
         CASE WHEN v.kind = 'email' THEN v.value END,
         CASE WHEN v.kind = 'phone' THEN v.value END
       )
      UNION ALL
      SELECT c.channel, c.value, 'added'::text
        FROM public.account_claim_contacts c
       WHERE c.user_id = auth.uid() AND c.revoked_at IS NULL
    ) x
   ORDER BY x.kind, x.value,
     CASE WHEN x.source = 'added' THEN 0 ELSE 1 END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4063_claim_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_claim_subject(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_claim_link(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_redirect_link(text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mint_claim_link_handoff(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_claim_link(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_revoke_claim_links(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_claim_prefill(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_contact_conflict(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_begin_contact_challenge(uuid, text, text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_settle_contact_challenge(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_contact_challenge_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_record_claim_contact(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4063_auth_user_for_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pg_my_claim_identifiers() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.issue_4063_claim_code() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_claim_subject(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mint_claim_link(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mint_redirect_link(text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mint_claim_link_handoff(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_claim_link(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_revoke_claim_links(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_claim_prefill(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_contact_conflict(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_begin_contact_challenge(uuid, text, text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_settle_contact_challenge(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_contact_challenge_for_user(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_record_claim_contact(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4063_auth_user_for_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pg_my_claim_identifiers() TO authenticated, service_role;

COMMENT ON TABLE public.claim_links IS
  '#4063: non-authoritative pointers to claimable purchase subjects; link possession never writes ownership.';
COMMENT ON TABLE public.contact_challenges IS
  '#4063: short-lived verification challenges for claim sign-in and account-only extra contacts.';

COMMIT;
