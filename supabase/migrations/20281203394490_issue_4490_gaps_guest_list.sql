-- Issue #4490, spec 07 I: private venue guest lists and promoter links.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Invariants I-4490-GUEST-LIST-BOUNDARY and I-4490-GUEST-LIST-PRICE are declared in
-- __tests__/issue_4490_gaps_guest_list.implementor.pg17.test.sql, which proves them.

CREATE TABLE public.venue_guest_list_terms (
  venue_id uuid PRIMARY KEY REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  free_until time,
  reduced_until time,
  reduced_price_option_id uuid REFERENCES public.venue_offer_price_options(id) ON DELETE RESTRICT,
  plus_ones_max smallint NOT NULL DEFAULT 3 CHECK (plus_ones_max BETWEEN 0 AND 10),
  closes_minutes_before smallint NOT NULL DEFAULT 60 CHECK (closes_minutes_before BETWEEN 0 AND 1440),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_guest_list_terms_reduced_shape CHECK (
    reduced_until IS NULL OR (
      reduced_price_option_id IS NOT NULL
      -- Equal cutoffs are nonsensical. A numerically earlier reduced cutoff
      -- is valid: 00:30 follows 23:00 on a past-midnight service day.
      AND (free_until IS NULL OR reduced_until <> free_until)
    )
  )
);

CREATE TABLE public.venue_guest_list_promoters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  phone_e164 text,
  email text,
  link_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(link_token_hash) = 32),
  names_per_night smallint CHECK (names_per_night BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX venue_guest_list_promoters_venue_idx
  ON public.venue_guest_list_promoters (venue_id, active, created_at);

CREATE TABLE public.venue_guest_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  guest_name text NOT NULL CHECK (char_length(btrim(guest_name)) BETWEEN 1 AND 120),
  plus_ones smallint NOT NULL DEFAULT 0 CHECK (plus_ones BETWEEN 0 AND 10),
  phone_e164 text,
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  added_by_kind text NOT NULL CHECK (added_by_kind IN ('staff', 'promoter')),
  added_by_user uuid,
  promoter_id uuid REFERENCES public.venue_guest_list_promoters(id) ON DELETE RESTRICT,
  arrived smallint NOT NULL DEFAULT 0,
  arrived_at timestamptz,
  status text NOT NULL DEFAULT 'on_list' CHECK (status IN ('on_list', 'removed')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_guest_list_entries_arrived_check CHECK (arrived BETWEEN 0 AND 1 + plus_ones),
  CONSTRAINT venue_guest_list_entries_actor_shape CHECK (
    (added_by_kind = 'staff' AND added_by_user IS NOT NULL)
    OR (added_by_kind = 'promoter' AND promoter_id IS NOT NULL)
  )
);
CREATE INDEX venue_guest_list_entries_venue_day_idx
  ON public.venue_guest_list_entries (venue_id, local_date, status, created_at);
CREATE INDEX venue_guest_list_entries_promoter_hour_idx
  ON public.venue_guest_list_entries (promoter_id, created_at)
  WHERE promoter_id IS NOT NULL;
CREATE UNIQUE INDEX venue_guest_list_entries_name_uniq
  ON public.venue_guest_list_entries (venue_id, local_date, lower(btrim(guest_name)))
  WHERE status = 'on_list';

-- A paid reduced-price arrival is an ordinary Entry booking. This private
-- join records which list row that booking fulfils; the group-state trigger
-- also covers a pay-link that confirms after the door device has moved on.
CREATE TABLE public.venue_guest_list_sales (
  group_id uuid PRIMARY KEY REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES public.venue_guest_list_entries(id) ON DELETE RESTRICT,
  admit_count smallint NOT NULL CHECK (admit_count BETWEEN 1 AND 11),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_guest_list_sales_entry_idx
  ON public.venue_guest_list_sales (entry_id, applied_at);

ALTER TABLE public.venue_guest_list_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_guest_list_promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_guest_list_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_guest_list_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_guest_list_terms, public.venue_guest_list_promoters,
  public.venue_guest_list_entries, public.venue_guest_list_sales
FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_guest_list_terms, public.venue_guest_list_promoters,
  public.venue_guest_list_entries, public.venue_guest_list_sales TO service_role;

CREATE TRIGGER issue_4490_guest_list_terms_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_guest_list_terms
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_guest_list_promoter_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_guest_list_promoters
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();
CREATE TRIGGER issue_4490_guest_list_entry_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

CREATE OR REPLACE FUNCTION public.issue_4490_assert_guest_list_terms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_option public.venue_offer_price_options%ROWTYPE;
BEGIN
  IF NEW.reduced_price_option_id IS NULL THEN
    IF NEW.reduced_until IS NOT NULL THEN
      RAISE EXCEPTION 'guest_list_reduced_price_required' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT option_row.* INTO v_option
  FROM public.venue_offer_price_options option_row
  JOIN public.stay_offerings offering ON offering.id = option_row.offering_id
  WHERE option_row.id = NEW.reduced_price_option_id
    AND option_row.venue_id = NEW.venue_id
    AND option_row.status = 'active'
    AND offering.kind = 'entry'
    AND offering.status = 'live';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest_list_reduced_price_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_guest_list_terms_price
  BEFORE INSERT OR UPDATE OF venue_id, reduced_price_option_id, reduced_until
  ON public.venue_guest_list_terms
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_guest_list_terms();

CREATE OR REPLACE FUNCTION public.issue_4490_assert_guest_list_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  NEW.guest_name := btrim(NEW.guest_name);
  NEW.phone_e164 := NULLIF(btrim(NEW.phone_e164), '');
  NEW.note := NULLIF(btrim(NEW.note), '');
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events event_row
    WHERE event_row.id = NEW.event_id AND event_row.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'guest_list_event_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.promoter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_guest_list_promoters promoter
    WHERE promoter.id = NEW.promoter_id AND promoter.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'guest_list_promoter_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.arrived > 1 + NEW.plus_ones THEN
    RAISE EXCEPTION 'guest_list_arrived_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_guest_list_entry_shape
  BEFORE INSERT OR UPDATE ON public.venue_guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_guest_list_entry();

-- First opening time of the service day. A special day replaces weekly hours.
CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_open_at(p_venue_id uuid, p_local_date date)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text := public.issue_4490_venue_timezone(p_venue_id);
  v_time time;
  v_special public.venue_special_hours%ROWTYPE;
BEGIN
  SELECT * INTO v_special FROM public.venue_special_hours
  WHERE venue_id = p_venue_id AND local_date = p_local_date;
  IF FOUND THEN
    IF v_special.is_closed THEN RETURN NULL; END IF;
    SELECT min((window_row->>'open')::time) INTO v_time
    FROM jsonb_array_elements(v_special.windows) window_row;
  ELSE
    SELECT min(hours.open_time) INTO v_time
    FROM public.brand_hours hours
    WHERE hours.venue_id = p_venue_id
      AND hours.weekday = extract(isodow FROM p_local_date)::integer - 1
      AND NOT hours.is_closed AND hours.open_time IS NOT NULL;
  END IF;
  RETURN CASE WHEN v_time IS NULL THEN NULL
    ELSE (p_local_date + v_time) AT TIME ZONE v_tz END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_cutoff_at(
  p_venue_id uuid, p_local_date date, p_cutoff time
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_open timestamptz := public.issue_4490_guest_list_open_at(p_venue_id, p_local_date);
  v_open_time time;
  v_tz text := public.issue_4490_venue_timezone(p_venue_id);
BEGIN
  IF p_cutoff IS NULL OR v_open IS NULL THEN RETURN NULL; END IF;
  v_open_time := v_open AT TIME ZONE v_tz;
  RETURN (p_local_date + CASE WHEN p_cutoff <= v_open_time THEN 1 ELSE 0 END + p_cutoff)
    AT TIME ZONE v_tz;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_close_at(p_venue_id uuid, p_local_date date)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_guest_list_open_at(p_venue_id, p_local_date)
    - make_interval(mins => COALESCE((SELECT t.closes_minutes_before
      FROM public.venue_guest_list_terms t WHERE t.venue_id = p_venue_id), 60));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_terms_projection(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'venueId', venue.id,
    'freeUntil', to_char(terms.free_until, 'HH24:MI'),
    'reducedUntil', to_char(terms.reduced_until, 'HH24:MI'),
    'reducedPriceOptionId', terms.reduced_price_option_id,
    'reducedPrice', CASE WHEN option_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'optionId', option_row.id, 'offeringId', option_row.offering_id,
      'name', option_row.name, 'priceMinor', price.amount_minor,
      'currencyCode', price.currency_code) END,
    'plusOnesMax', COALESCE(terms.plus_ones_max, 3),
    'closesMinutesBefore', COALESCE(terms.closes_minutes_before, 60),
    'version', COALESCE(terms.version, 0),
    'opensAt', public.issue_4490_guest_list_open_at(venue.id, p_local_date),
    'closesAt', public.issue_4490_guest_list_close_at(venue.id, p_local_date))
  FROM public.venue_listings venue
  LEFT JOIN public.venue_guest_list_terms terms ON terms.venue_id = venue.id
  LEFT JOIN public.venue_offer_price_options option_row ON option_row.id = terms.reduced_price_option_id
  LEFT JOIN public.stay_price_versions price ON price.offering_id = option_row.offering_id
    AND price.price_option_id = option_row.id AND price.effective_to IS NULL
  WHERE venue.id = p_venue_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_entry_projection(p_entry_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', entry_row.id, 'venueId', entry_row.venue_id, 'localDate', entry_row.local_date,
    'eventId', entry_row.event_id, 'guestName', entry_row.guest_name,
    'plusOnes', entry_row.plus_ones, 'phone', entry_row.phone_e164, 'note', entry_row.note,
    'addedByKind', entry_row.added_by_kind, 'promoterId', entry_row.promoter_id,
    'promoterName', promoter.name, 'arrived', entry_row.arrived,
    'arrivedAt', entry_row.arrived_at, 'status', entry_row.status,
    'version', entry_row.version, 'createdAt', entry_row.created_at)
  FROM public.venue_guest_list_entries entry_row
  LEFT JOIN public.venue_guest_list_promoters promoter ON promoter.id = entry_row.promoter_id
  WHERE entry_row.id = p_entry_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_date date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.issue_4490_user_can_manage_bookings(p_venue_id, auth.uid())
    OR public.issue_4490_can_check_in(p_venue_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id, 'localDate', v_date,
    'terms', public.issue_4490_guest_list_terms_projection(p_venue_id, v_date),
    'entries', COALESCE((SELECT jsonb_agg(public.issue_4490_guest_list_entry_projection(e.id)
      ORDER BY COALESCE(p.name, ''), e.guest_name, e.id)
      FROM public.venue_guest_list_entries e
      LEFT JOIN public.venue_guest_list_promoters p ON p.id = e.promoter_id
      WHERE e.venue_id = p_venue_id AND e.local_date = v_date AND e.status = 'on_list'), '[]'::jsonb),
    'promoters', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'phone', p.phone_e164, 'email', p.email,
      'namesPerNight', p.names_per_night, 'active', p.active, 'version', p.version,
      'names', COALESCE((SELECT sum(1 + e.plus_ones) FROM public.venue_guest_list_entries e
        WHERE e.promoter_id = p.id AND e.local_date = v_date AND e.status = 'on_list'), 0),
      'in', COALESCE((SELECT sum(e.arrived) FROM public.venue_guest_list_entries e
        WHERE e.promoter_id = p.id AND e.local_date = v_date AND e.status = 'on_list'), 0))
      ORDER BY p.name, p.id) FROM public.venue_guest_list_promoters p
      WHERE p.venue_id = p_venue_id), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
      'names', COALESCE(sum(1 + e.plus_ones) FILTER (WHERE e.status = 'on_list'), 0),
      'in', COALESCE(sum(e.arrived) FILTER (WHERE e.status = 'on_list'), 0))
      FROM public.venue_guest_list_entries e
      WHERE e.venue_id = p_venue_id AND e.local_date = v_date));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_manage_guest_list(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_entry public.venue_guest_list_entries%ROWTYPE;
  v_promoter public.venue_guest_list_promoters%ROWTYPE;
  v_terms public.venue_guest_list_terms%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_token text;
  v_free time;
  v_reduced time;
  v_plus smallint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.issue_4490_user_can_manage_bookings(p_venue_id, v_uid) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set_terms','add_entry','edit_entry','remove_entry','add_promoter',
      'edit_promoter','new_promoter_link','pause_promoter')
     OR jsonb_typeof(COALESCE(p_payload, 'null'::jsonb)) <> 'object'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venueId', p_venue_id, 'payload', p_payload,
    'expectedVersion', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('guest_list:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay || jsonb_build_object('replayed', true); END IF;

  IF p_action = 'set_terms' THEN
    IF COALESCE(p_payload->>'freeUntil', '') <> ''
       AND p_payload->>'freeUntil' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'guest_list_time_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'reducedUntil', '') <> ''
       AND p_payload->>'reducedUntil' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'guest_list_time_invalid' USING ERRCODE = '22023';
    END IF;
    v_free := NULLIF(p_payload->>'freeUntil', '')::time;
    v_reduced := NULLIF(p_payload->>'reducedUntil', '')::time;
    INSERT INTO public.venue_guest_list_terms (
      venue_id, brand_id, free_until, reduced_until, reduced_price_option_id,
      plus_ones_max, closes_minutes_before, updated_by
    ) VALUES (
      p_venue_id, v_venue.brand_id, v_free, v_reduced,
      NULLIF(p_payload->>'reducedPriceOptionId', '')::uuid,
      COALESCE((p_payload->>'plusOnesMax')::smallint, 3),
      COALESCE((p_payload->>'closesMinutesBefore')::smallint, 60), v_uid
    ) ON CONFLICT (venue_id) DO UPDATE SET
      free_until = EXCLUDED.free_until, reduced_until = EXCLUDED.reduced_until,
      reduced_price_option_id = EXCLUDED.reduced_price_option_id,
      plus_ones_max = EXCLUDED.plus_ones_max,
      closes_minutes_before = EXCLUDED.closes_minutes_before,
      version = public.venue_guest_list_terms.version + 1,
      updated_at = now(), updated_by = v_uid
      WHERE p_expected_version IS NULL OR public.venue_guest_list_terms.version = p_expected_version
    RETURNING * INTO v_terms;
    IF NOT FOUND THEN RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409'; END IF;
    v_result := jsonb_build_object('terms', public.issue_4490_guest_list_terms_projection(
      p_venue_id, public.issue_4490_venue_local_date(p_venue_id)));

  ELSIF p_action = 'add_entry' THEN
    v_plus := COALESCE((p_payload->>'plusOnes')::smallint, 0);
    IF char_length(btrim(COALESCE(p_payload->>'guestName', ''))) NOT BETWEEN 1 AND 120
       OR COALESCE(p_payload->>'localDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
       OR v_plus < 0 OR v_plus > COALESCE((SELECT plus_ones_max
          FROM public.venue_guest_list_terms WHERE venue_id = p_venue_id), 3) THEN
      RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
    END IF;
    BEGIN
      INSERT INTO public.venue_guest_list_entries (
        venue_id, brand_id, local_date, event_id, guest_name, plus_ones,
        phone_e164, note, added_by_kind, added_by_user, promoter_id
      ) VALUES (
        p_venue_id, v_venue.brand_id, (p_payload->>'localDate')::date,
        NULLIF(p_payload->>'eventId', '')::uuid, btrim(p_payload->>'guestName'), v_plus,
        NULLIF(p_payload->>'phone', ''), NULLIF(p_payload->>'note', ''), 'staff', v_uid,
        NULLIF(p_payload->>'promoterId', '')::uuid
      ) RETURNING * INTO v_entry;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'already_on_list' USING ERRCODE = 'PT409';
    END;
    v_result := jsonb_build_object('entry', public.issue_4490_guest_list_entry_projection(v_entry.id));

  ELSIF p_action IN ('edit_entry', 'remove_entry') THEN
    SELECT * INTO v_entry FROM public.venue_guest_list_entries
    WHERE id = NULLIF(p_payload->>'entryId', '')::uuid AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002'; END IF;
    IF p_expected_version IS NOT NULL AND v_entry.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
    IF p_action = 'remove_entry' THEN
      UPDATE public.venue_guest_list_entries SET status = 'removed', version = version + 1, updated_at = now()
      WHERE id = v_entry.id RETURNING * INTO v_entry;
    ELSE
      v_plus := COALESCE((p_payload->>'plusOnes')::smallint, v_entry.plus_ones);
      IF char_length(btrim(COALESCE(p_payload->>'guestName', v_entry.guest_name))) NOT BETWEEN 1 AND 120
         OR v_plus < v_entry.arrived
         OR v_plus > COALESCE((SELECT plus_ones_max FROM public.venue_guest_list_terms
            WHERE venue_id = p_venue_id), 3) THEN
        RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
      END IF;
      BEGIN
        UPDATE public.venue_guest_list_entries SET
          guest_name = btrim(COALESCE(p_payload->>'guestName', guest_name)),
          plus_ones = v_plus, phone_e164 = CASE WHEN p_payload ? 'phone' THEN NULLIF(p_payload->>'phone', '') ELSE phone_e164 END,
          note = CASE WHEN p_payload ? 'note' THEN NULLIF(p_payload->>'note', '') ELSE note END,
          promoter_id = CASE WHEN p_payload ? 'promoterId' THEN NULLIF(p_payload->>'promoterId', '')::uuid ELSE promoter_id END,
          version = version + 1, updated_at = now()
        WHERE id = v_entry.id RETURNING * INTO v_entry;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'already_on_list' USING ERRCODE = 'PT409';
      END;
    END IF;
    v_result := jsonb_build_object('entry', public.issue_4490_guest_list_entry_projection(v_entry.id));

  ELSIF p_action = 'add_promoter' THEN
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
    END IF;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.venue_guest_list_promoters (
      venue_id, brand_id, name, phone_e164, email, link_token_hash,
      names_per_night, created_by
    ) VALUES (
      p_venue_id, v_venue.brand_id, btrim(p_payload->>'name'),
      NULLIF(p_payload->>'phone', ''), NULLIF(lower(btrim(p_payload->>'email')), ''),
      pg_catalog.sha256(convert_to(v_token, 'UTF8')),
      NULLIF(p_payload->>'namesPerNight', '')::smallint, v_uid
    ) RETURNING * INTO v_promoter;
    v_result := jsonb_build_object('promoter', jsonb_build_object(
      'id', v_promoter.id, 'name', v_promoter.name, 'active', v_promoter.active,
      'namesPerNight', v_promoter.names_per_night, 'version', v_promoter.version),
      'token', v_token);

  ELSE
    SELECT * INTO v_promoter FROM public.venue_guest_list_promoters
    WHERE id = NULLIF(p_payload->>'promoterId', '')::uuid AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_promoter_not_found' USING ERRCODE = 'P0002'; END IF;
    IF p_expected_version IS NOT NULL AND v_promoter.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
    IF p_action = 'new_promoter_link' THEN
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      UPDATE public.venue_guest_list_promoters
      SET link_token_hash = pg_catalog.sha256(convert_to(v_token, 'UTF8')),
          version = version + 1, updated_at = now()
      WHERE id = v_promoter.id RETURNING * INTO v_promoter;
    ELSIF p_action = 'pause_promoter' THEN
      UPDATE public.venue_guest_list_promoters
      SET active = false, version = version + 1, updated_at = now()
      WHERE id = v_promoter.id RETURNING * INTO v_promoter;
    ELSE
      UPDATE public.venue_guest_list_promoters SET
        name = btrim(COALESCE(p_payload->>'name', name)),
        phone_e164 = CASE WHEN p_payload ? 'phone' THEN NULLIF(p_payload->>'phone', '') ELSE phone_e164 END,
        email = CASE WHEN p_payload ? 'email' THEN NULLIF(lower(btrim(p_payload->>'email')), '') ELSE email END,
        names_per_night = CASE WHEN p_payload ? 'namesPerNight' THEN NULLIF(p_payload->>'namesPerNight', '')::smallint ELSE names_per_night END,
        active = COALESCE((p_payload->>'active')::boolean, active),
        version = version + 1, updated_at = now()
      WHERE id = v_promoter.id RETURNING * INTO v_promoter;
    END IF;
    v_result := jsonb_build_object('promoter', jsonb_build_object(
      'id', v_promoter.id, 'name', v_promoter.name, 'phone', v_promoter.phone_e164,
      'email', v_promoter.email, 'namesPerNight', v_promoter.names_per_night,
      'active', v_promoter.active, 'version', v_promoter.version));
    IF v_token IS NOT NULL THEN v_result := v_result || jsonb_build_object('token', v_token); END IF;
  END IF;

  -- Link secrets are returned by the creating call only. The idempotency
  -- receipt deliberately retains the public result without the raw token.
  PERFORM public.issue_4490_receipt_store('guest_list:' || p_venue_id::text,
    p_idempotency_key, v_hash, v_result - 'token');
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Signed-out promoter reads and writes. The edge hashes the raw token before
-- calling these service-role-only functions.
CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_promoter_get(p_token_hash bytea)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_promoter public.venue_guest_list_promoters%ROWTYPE;
  v_today date;
BEGIN
  IF NOT public.issue_1389_service_role() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_promoter FROM public.venue_guest_list_promoters
  WHERE link_token_hash = p_token_hash AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_link_not_found' USING ERRCODE = 'P0002'; END IF;
  v_today := public.issue_4490_venue_local_date(v_promoter.venue_id);
  RETURN jsonb_build_object(
    'promoter', jsonb_build_object('id', v_promoter.id, 'name', v_promoter.name,
      'namesPerNight', v_promoter.names_per_night),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name) FROM public.venue_listings v WHERE v.id = v_promoter.venue_id),
    'today', v_today, 'lastDate', v_today + 7,
    'nights', (SELECT jsonb_agg(jsonb_build_object(
      'localDate', d::date, 'terms', public.issue_4490_guest_list_terms_projection(v_promoter.venue_id, d::date),
      'entries', COALESCE((SELECT jsonb_agg(public.issue_4490_guest_list_entry_projection(e.id) ORDER BY e.created_at, e.id)
        FROM public.venue_guest_list_entries e WHERE e.promoter_id = v_promoter.id
          AND e.local_date = d::date AND e.status = 'on_list'), '[]'::jsonb)) ORDER BY d)
      FROM generate_series(v_today, v_today + 7, interval '1 day') day_row(d)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_promoter_write(
  p_token_hash bytea, p_action text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_promoter public.venue_guest_list_promoters%ROWTYPE;
  v_entry public.venue_guest_list_entries%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_today date;
  v_date date;
  v_plus smallint;
  v_max smallint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_promoter FROM public.venue_guest_list_promoters
  WHERE link_token_hash = p_token_hash AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_link_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_promoter.venue_id;
  v_today := public.issue_4490_venue_local_date(v_promoter.venue_id);
  v_date := NULLIF(p_payload->>'localDate', '')::date;
  IF v_date IS NULL OR v_date NOT BETWEEN v_today AND v_today + 7 THEN
    RAISE EXCEPTION 'guest_list_date_invalid' USING ERRCODE = '22023';
  END IF;
  IF public.issue_4490_guest_list_open_at(v_promoter.venue_id, v_date) IS NULL THEN
    RAISE EXCEPTION 'guest_list_hours_missing' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_guest_list_close_at(v_promoter.venue_id, v_date) THEN
    RAISE EXCEPTION 'guest_list_closed' USING ERRCODE = 'PT409';
  END IF;
  IF p_action = 'add' THEN
    v_plus := COALESCE((p_payload->>'plusOnes')::smallint, 0);
    v_max := COALESCE((SELECT plus_ones_max FROM public.venue_guest_list_terms
      WHERE venue_id = v_promoter.venue_id), 3);
    IF char_length(btrim(COALESCE(p_payload->>'guestName', ''))) NOT BETWEEN 1 AND 120
       OR v_plus NOT BETWEEN 0 AND v_max THEN
      RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.venue_guest_list_entries e
        WHERE e.promoter_id = v_promoter.id AND e.created_at > now() - interval '1 hour') >= 60 THEN
      RAISE EXCEPTION 'guest_list_rate_limited' USING ERRCODE = 'PT429';
    END IF;
    IF v_promoter.names_per_night IS NOT NULL AND
       (SELECT count(*) FROM public.venue_guest_list_entries e
        WHERE e.promoter_id = v_promoter.id AND e.local_date = v_date AND e.status = 'on_list')
       >= v_promoter.names_per_night THEN
      RAISE EXCEPTION 'guest_list_night_limit' USING ERRCODE = 'PT409';
    END IF;
    BEGIN
      INSERT INTO public.venue_guest_list_entries (
        venue_id, brand_id, local_date, guest_name, plus_ones,
        phone_e164, added_by_kind, promoter_id
      ) VALUES (
        v_promoter.venue_id, v_venue.brand_id, v_date, btrim(p_payload->>'guestName'),
        v_plus, NULLIF(p_payload->>'phone', ''), 'promoter', v_promoter.id
      ) RETURNING * INTO v_entry;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'already_on_list' USING ERRCODE = 'PT409';
    END;
  ELSIF p_action = 'remove' THEN
    SELECT * INTO v_entry FROM public.venue_guest_list_entries
    WHERE id = NULLIF(p_payload->>'entryId', '')::uuid
      AND promoter_id = v_promoter.id AND local_date = v_date FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_entry.arrived > 0 THEN RAISE EXCEPTION 'guest_list_entry_arrived' USING ERRCODE = 'PT409'; END IF;
    UPDATE public.venue_guest_list_entries
    SET status = 'removed', version = version + 1, updated_at = now()
    WHERE id = v_entry.id RETURNING * INTO v_entry;
  ELSE
    RAISE EXCEPTION 'guest_list_invalid_payload' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('entry', public.issue_4490_guest_list_entry_projection(v_entry.id));
END;
$function$;

-- Add the list subject and the two contract values to the append-only door log.
ALTER TABLE public.venue_check_in_log
  ADD COLUMN guest_list_entry_id uuid REFERENCES public.venue_guest_list_entries(id) ON DELETE RESTRICT;
CREATE INDEX venue_check_in_log_guest_list_idx ON public.venue_check_in_log (guest_list_entry_id)
  WHERE guest_list_entry_id IS NOT NULL;
ALTER TABLE public.venue_check_in_log DROP CONSTRAINT venue_check_in_log_result_check;
ALTER TABLE public.venue_check_in_log ADD CONSTRAINT venue_check_in_log_result_check CHECK (result IN (
  'admitted', 'already_used', 'wrong_day', 'not_yet', 'void', 'not_found',
  'wrong_venue', 'id_required', 'id_refused', 'days_used', 'day_full',
  'list_closed_for_price', 'undone'
));
ALTER TABLE public.venue_check_in_log DROP CONSTRAINT venue_check_in_log_method_check;
ALTER TABLE public.venue_check_in_log ADD CONSTRAINT venue_check_in_log_method_check CHECK (
  method IN ('scan', 'manual', 'gate_sale', 'guest_list', 'undo')
);

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_entry_pool(p_entry_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT offering.capacity_pool_id
     FROM public.venue_guest_list_entries entry_row
     JOIN public.venue_guest_list_terms terms ON terms.venue_id = entry_row.venue_id
     JOIN public.venue_offer_price_options option_row ON option_row.id = terms.reduced_price_option_id
     JOIN public.stay_offerings offering ON offering.id = option_row.offering_id
     WHERE entry_row.id = p_entry_id AND offering.kind = 'entry' AND offering.status = 'live'),
    (SELECT offering.capacity_pool_id
     FROM public.venue_guest_list_entries entry_row
     JOIN public.stay_offerings offering ON offering.venue_id = entry_row.venue_id
     WHERE entry_row.id = p_entry_id AND offering.kind = 'entry'
       AND offering.status = 'live' AND offering.capacity_pool_id IS NOT NULL
     ORDER BY offering.sort_order, offering.created_at, offering.id LIMIT 1));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_admit_guest_list(
  p_venue_id uuid, p_entry_id uuid, p_count integer, p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_entry public.venue_guest_list_entries%ROWTYPE;
  v_terms public.venue_guest_list_terms%ROWTYPE;
  v_today date;
  v_count integer;
  v_free_at timestamptz;
  v_reduced_at timestamptz;
  v_pool uuid;
  v_usage record;
  v_log uuid;
  v_option public.venue_offer_price_options%ROWTYPE;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_today := public.issue_4490_venue_local_date(p_venue_id);
  SELECT * INTO v_entry FROM public.venue_guest_list_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_entry.venue_id <> p_venue_id THEN
    RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_entry.local_date <> v_today OR v_entry.status <> 'on_list' THEN
    RAISE EXCEPTION 'guest_list_wrong_day' USING ERRCODE = 'PT409';
  END IF;
  v_count := COALESCE(p_count, 1 + v_entry.plus_ones - v_entry.arrived);
  IF v_count < 1 OR v_entry.arrived + v_count > 1 + v_entry.plus_ones THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_terms FROM public.venue_guest_list_terms WHERE venue_id = p_venue_id;
  v_free_at := public.issue_4490_guest_list_cutoff_at(p_venue_id, v_today, v_terms.free_until);
  v_reduced_at := public.issue_4490_guest_list_cutoff_at(p_venue_id, v_today, v_terms.reduced_until);

  IF v_free_at IS NOT NULL AND now() < v_free_at THEN
    v_pool := public.issue_4490_guest_list_entry_pool(v_entry.id);
    IF v_pool IS NOT NULL THEN
      PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_pool FOR UPDATE;
      SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_pool, v_today);
      IF COALESCE(v_usage.closed, true) OR COALESCE(v_usage.online_left, 0) < v_count THEN
        RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409';
      END IF;
    END IF;
    UPDATE public.venue_guest_list_entries
    SET arrived = arrived + v_count, arrived_at = COALESCE(arrived_at, now()),
        version = version + 1, updated_at = now()
    WHERE id = v_entry.id RETURNING * INTO v_entry;
    INSERT INTO public.venue_check_in_log (
      venue_id, brand_id, guest_list_entry_id, result, admitted_delta,
      method, scanner_user_id, local_date, detail
    ) VALUES (
      v_venue.id, v_venue.brand_id, v_entry.id, 'admitted', v_count,
      'guest_list', p_scanner_user_id, v_today,
      jsonb_build_object('kind', 'guest_list', 'free', true, 'poolId', v_pool)
    ) RETURNING id INTO v_log;
    RETURN jsonb_build_object('result', 'admitted', 'kind', 'guest_list',
      'admitted', v_count, 'logId', v_log,
      'entry', public.issue_4490_guest_list_entry_projection(v_entry.id));
  END IF;

  IF v_reduced_at IS NOT NULL AND now() < v_reduced_at THEN
    SELECT * INTO v_option FROM public.venue_offer_price_options
    WHERE id = v_terms.reduced_price_option_id AND venue_id = p_venue_id AND status = 'active';
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.stay_offerings offering
      WHERE offering.id = v_option.offering_id AND offering.kind = 'entry' AND offering.status = 'live') THEN
      RAISE EXCEPTION 'guest_list_reduced_price_invalid' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('result', 'sell', 'kind', 'guest_list',
      'guestListEntryId', v_entry.id, 'count', v_count,
      'offeringId', v_option.offering_id, 'priceOptionId', v_option.id,
      'entry', public.issue_4490_guest_list_entry_projection(v_entry.id));
  END IF;

  INSERT INTO public.venue_check_in_log (
    venue_id, brand_id, guest_list_entry_id, result, admitted_delta,
    method, scanner_user_id, local_date, detail
  ) VALUES (
    v_venue.id, v_venue.brand_id, v_entry.id, 'list_closed_for_price', 0,
    'guest_list', p_scanner_user_id, v_today, jsonb_build_object('kind', 'guest_list')
  ) RETURNING id INTO v_log;
  RETURN jsonb_build_object('result', 'list_closed_for_price', 'kind', 'guest_list',
    'guestListEntryId', v_entry.id, 'count', v_count, 'logId', v_log,
    'entry', public.issue_4490_guest_list_entry_projection(v_entry.id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_apply_guest_list_sale(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_guest_list_sales%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.venue_guest_list_sales WHERE group_id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_sale.applied_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN RETURN; END IF;
  UPDATE public.venue_guest_list_entries
  SET arrived = arrived + v_sale.admit_count,
      arrived_at = COALESCE(arrived_at, now()), version = version + 1, updated_at = now()
  WHERE id = v_sale.entry_id AND status = 'on_list'
    AND arrived + v_sale.admit_count <= 1 + plus_ones;
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_arrived_invalid' USING ERRCODE = 'PT409'; END IF;
  UPDATE public.venue_guest_list_sales SET applied_at = now() WHERE group_id = p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_on_guest_list_sale_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('confirmed', 'partially_cancelled') THEN
    PERFORM public.issue_4490_apply_guest_list_sale(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_guest_list_sale_state
  AFTER UPDATE OF state ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_guest_list_sale_state();

CREATE OR REPLACE FUNCTION public.issue_4490_guest_list_gate_sale(
  p_venue_id uuid, p_entry_id uuid, p_count integer, p_method text,
  p_buyer jsonb, p_idempotency_key text, p_scanner_user_id uuid,
  p_group_id uuid DEFAULT NULL, p_buyer_token_hash bytea DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry public.venue_guest_list_entries%ROWTYPE;
  v_terms public.venue_guest_list_terms%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_result jsonb;
  v_group_id uuid;
  v_existing_group uuid;
  v_existing_sale public.venue_guest_list_sales%ROWTYPE;
BEGIN
  PERFORM public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  SELECT * INTO v_entry FROM public.venue_guest_list_entries
  WHERE id = p_entry_id AND venue_id = p_venue_id FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'on_list' THEN
    RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT group_row.id INTO v_existing_group
  FROM public.stay_reservation_groups group_row
  WHERE group_row.actor_key_hash = encode(pg_catalog.sha256(convert_to(
      'gate:' || p_scanner_user_id::text, 'UTF8')), 'hex')
    AND group_row.idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    SELECT * INTO v_existing_sale FROM public.venue_guest_list_sales
    WHERE group_id = v_existing_group;
    IF NOT FOUND OR v_existing_sale.entry_id <> p_entry_id
       OR v_existing_sale.admit_count <> p_count THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'method', p_method,
      'booking', public.issue_4490_booking_projection(v_existing_group, NULL),
      'passId', (SELECT pass.id FROM public.venue_passes pass WHERE pass.group_id = v_existing_group),
      'guestListEntryId', p_entry_id);
  END IF;
  IF p_count < 1 OR v_entry.arrived + p_count > 1 + v_entry.plus_ones THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_terms FROM public.venue_guest_list_terms WHERE venue_id = p_venue_id;
  IF v_terms.reduced_until IS NULL OR now() >= public.issue_4490_guest_list_cutoff_at(
      p_venue_id, v_entry.local_date, v_terms.reduced_until) THEN
    RAISE EXCEPTION 'guest_list_reduced_window_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_option FROM public.venue_offer_price_options
  WHERE id = v_terms.reduced_price_option_id AND venue_id = p_venue_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_list_reduced_price_invalid' USING ERRCODE = 'PT409'; END IF;
  v_result := public.issue_4490_gate_sale(
    p_venue_id, v_option.offering_id,
    jsonb_build_array(jsonb_build_object('priceOptionId', v_option.id, 'guests', p_count)),
    p_method, COALESCE(p_buyer, '{}'::jsonb), p_idempotency_key,
    p_scanner_user_id, p_group_id, p_buyer_token_hash);
  v_group_id := (v_result#>>'{booking,groupId}')::uuid;
  INSERT INTO public.venue_guest_list_sales (group_id, entry_id, admit_count)
  VALUES (v_group_id, v_entry.id, p_count)
  ON CONFLICT (group_id) DO NOTHING;
  PERFORM public.issue_4490_apply_guest_list_sale(v_group_id);
  RETURN v_result || jsonb_build_object('guestListEntryId', v_entry.id);
END;
$function$;

-- Patch later definitions without copying unrelated booking/check-in bodies.
CREATE OR REPLACE FUNCTION pg_temp.issue_4490_guest_list_patch(
  p_proc regprocedure, p_old text, p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_source text := pg_get_functiondef(p_proc);
BEGIN
  IF strpos(v_source, p_old) = 0 THEN
    RAISE EXCEPTION 'guest_list_patch_target_missing:%', p_proc::text;
  END IF;
  EXECUTE replace(v_source, p_old, p_new);
END;
$function$;

-- Free list admits consume Entry capacity as online usage, never the kept
-- walk-in reserve. Paid arrivals are already counted by their commitment.
SELECT pg_temp.issue_4490_guest_list_patch(
  'public.issue_4490_pool_day_usage(uuid,date)'::regprocedure,
  $old$  ) usage_rows;$old$,
  $new$    UNION ALL
    SELECT GREATEST(entry_row.arrived - COALESCE((
             SELECT sum(sale.admit_count) FROM public.venue_guest_list_sales sale
             WHERE sale.entry_id = entry_row.id AND sale.applied_at IS NOT NULL), 0), 0)::integer,
           false
    FROM public.venue_guest_list_entries entry_row
    WHERE entry_row.local_date = p_local_date
      AND entry_row.status = 'on_list'
      AND entry_row.arrived > COALESCE((SELECT sum(sale.admit_count)
        FROM public.venue_guest_list_sales sale
        WHERE sale.entry_id = entry_row.id AND sale.applied_at IS NOT NULL), 0)
      AND public.issue_4490_guest_list_entry_pool(entry_row.id) = p_pool_id
  ) usage_rows;$new$
);

-- The free-list undo branch needs its row variable before its body is added.
SELECT pg_temp.issue_4490_guest_list_patch(
  'public.issue_4490_check_in_undo(uuid,uuid,uuid)'::regprocedure,
  $old$  v_day public.venue_pass_days%ROWTYPE;$old$,
  $new$  v_day public.venue_pass_days%ROWTYPE;
  v_entry public.venue_guest_list_entries%ROWTYPE;$new$
);

-- Undo a free list admission through the same ten-minute door affordance.
SELECT pg_temp.issue_4490_guest_list_patch(
  'public.issue_4490_check_in_undo(uuid,uuid,uuid)'::regprocedure,
  $old$  IF v_log.subscription_id IS NOT NULL THEN$old$,
  $new$  IF v_log.guest_list_entry_id IS NOT NULL THEN
    IF v_log.result <> 'admitted' OR v_log.admitted_delta < 1 THEN
      RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
    END IF;
    IF v_log.created_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'check_in_undo_too_late' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_check_in_log u WHERE u.undoes_log_id = v_log.id) THEN
      RAISE EXCEPTION 'check_in_already_undone' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_guest_list_entries
    SET arrived = arrived - v_log.admitted_delta,
        arrived_at = CASE WHEN arrived - v_log.admitted_delta = 0 THEN NULL ELSE arrived_at END,
        version = version + 1, updated_at = now()
    WHERE id = v_log.guest_list_entry_id AND arrived >= v_log.admitted_delta
    RETURNING * INTO v_entry;
    IF NOT FOUND THEN RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409'; END IF;
    INSERT INTO public.venue_check_in_log (
      venue_id, brand_id, guest_list_entry_id, result, admitted_delta, method,
      undoes_log_id, scanner_user_id, local_date, detail
    ) VALUES (
      v_venue.id, v_venue.brand_id, v_log.guest_list_entry_id, 'undone',
      -v_log.admitted_delta, 'undo', v_log.id, p_scanner_user_id,
      v_log.local_date, '{"kind":"guest_list"}'::jsonb
    ) RETURNING id INTO v_new;
    RETURN jsonb_build_object('result', 'undone', 'kind', 'guest_list',
      'logId', v_new, 'undid', v_log.admitted_delta,
      'entry', public.issue_4490_guest_list_entry_projection(v_log.guest_list_entry_id));
  END IF;
  IF v_log.subscription_id IS NOT NULL THEN$new$
);

-- Current check-in read plus list rows, keeping all prior pass/member fixes.
SELECT pg_temp.issue_4490_guest_list_patch(
  'public.issue_4490_check_in_list(uuid,date,uuid)'::regprocedure,
  $old$    'totals', ($old$,
  $new$    'guestList', COALESCE((
      SELECT jsonb_agg(public.issue_4490_guest_list_entry_projection(e.id)
        || jsonb_build_object('kind', 'guest_list', 'holderName', e.guest_name,
          'admits', 1 + e.plus_ones, 'admittedCount', e.arrived,
          'remaining', 1 + e.plus_ones - e.arrived,
          'time', public.issue_4490_guest_list_open_at(e.venue_id, e.local_date))
        ORDER BY e.guest_name, e.id)
      FROM public.venue_guest_list_entries e
      WHERE e.venue_id = p_venue_id AND e.local_date = v_date AND e.status = 'on_list'), '[]'::jsonb),
    'totals', ($new$
);

SELECT pg_temp.issue_4490_guest_list_patch(
  'public.issue_4490_venue_day(uuid,date)'::regprocedure,
  $old$    'checkIn', ($old$,
  $new$    'guestList', (SELECT jsonb_build_object(
      'names', COALESCE(sum(1 + e.plus_ones) FILTER (WHERE e.status = 'on_list'), 0),
      'in', COALESCE(sum(e.arrived) FILTER (WHERE e.status = 'on_list'), 0))
      FROM public.venue_guest_list_entries e
      WHERE e.venue_id = p_venue_id AND e.local_date = v_date),
    'checkIn', ($new$
);

DROP FUNCTION pg_temp.issue_4490_guest_list_patch(regprocedure, text, text);

-- The feature may now be enabled.
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages', 'private_hire', 'floor_plan', 'pick_a_table', 'min_spend_tables',
               'by_the_hour', 'memberships', 'guest_list']::text[];
$function$;

REVOKE ALL ON FUNCTION
  public.issue_4490_assert_guest_list_terms(),
  public.issue_4490_assert_guest_list_entry(),
  public.issue_4490_guest_list_open_at(uuid,date),
  public.issue_4490_guest_list_cutoff_at(uuid,date,time),
  public.issue_4490_guest_list_close_at(uuid,date),
  public.issue_4490_guest_list_terms_projection(uuid,date),
  public.issue_4490_guest_list_entry_projection(uuid),
  public.issue_4490_guest_list_entry_pool(uuid),
  public.issue_4490_apply_guest_list_sale(uuid),
  public.issue_4490_on_guest_list_sale_state()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_guest_list_open_at(uuid,date),
  public.issue_4490_guest_list_cutoff_at(uuid,date,time),
  public.issue_4490_guest_list_close_at(uuid,date),
  public.issue_4490_guest_list_terms_projection(uuid,date),
  public.issue_4490_guest_list_entry_projection(uuid),
  public.issue_4490_guest_list_entry_pool(uuid),
  public.issue_4490_apply_guest_list_sale(uuid),
  public.issue_4490_guest_list_promoter_get(bytea),
  public.issue_4490_guest_list_promoter_write(bytea,text,jsonb),
  public.issue_4490_admit_guest_list(uuid,uuid,integer,uuid),
  public.issue_4490_guest_list_gate_sale(uuid,uuid,integer,text,jsonb,text,uuid,uuid,bytea)
TO service_role;
REVOKE ALL ON FUNCTION
  public.issue_4490_guest_list_promoter_get(bytea),
  public.issue_4490_guest_list_promoter_write(bytea,text,jsonb),
  public.issue_4490_admit_guest_list(uuid,uuid,integer,uuid),
  public.issue_4490_guest_list_gate_sale(uuid,uuid,integer,text,jsonb,text,uuid,uuid,bytea)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_guest_list_day(uuid,date),
  public.issue_4490_manage_guest_list(text,uuid,jsonb,bigint,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_guest_list_day(uuid,date),
  public.issue_4490_manage_guest_list(text,uuid,jsonb,bigint,text)
TO authenticated, service_role;

COMMIT;
