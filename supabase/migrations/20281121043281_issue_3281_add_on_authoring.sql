-- issue #3281 — Add-ons on every offering, slice S3: one authoring path.
--
-- Spec: the #3281 comment "## Spec: add-ons on every offering", sections
-- 6.4, 6.8, 7 and 8. Seth approved D-1..D-8 on 2026-11-20.
--
-- Adds the one write path the Host "Add-ons" editor uses on every offering
-- (event, trip, experience, RSVP), draft or live, plus its read:
--   * biz_offering_add_ons(event)                 -> the editor's payload
--   * biz_offering_add_ons_save(event, list, rev) -> saves the whole list
-- and the storage policies for add-on photos under
-- event_covers/add-ons/{eventId}/{uuid}.jpg (+ _thumb.jpg), the path shape
-- S1 already enforces on ticket_add_ons.
--
-- Deviation from the spec (reported on #3281): the revision lives in its own
-- table, offering_add_on_state, instead of a new events column. Several
-- functions serialise whole events rows (row_to_json / to_jsonb of e), so a
-- new events column would change payloads that must stay byte-identical.
-- Every add-on or link write (this editor, the event tier-JSON path, the S1
-- bridge, the date strip) bumps it through one trigger, so a stale editor
-- save is refused whoever wrote last.
--
-- Nothing changes for anyone until the Host flag EXPO_PUBLIC_FF_EXTRAS_ENABLED
-- is on: no existing function is replaced, and the triggers only write the
-- new state table. Conflicts raise PT409 (never 40001).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── Revision per offering ───────────────────────────────────────────────────
CREATE TABLE public.offering_add_on_state (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offering_add_on_state_revision_nonnegative CHECK (revision >= 0)
);

ALTER TABLE public.offering_add_on_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offering_add_on_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.offering_add_on_state TO service_role;

COMMENT ON TABLE public.offering_add_on_state IS
  'issue #3281 S3: one revision per offering, bumped on every add-on or link write; the Host editor saves against it (PT409 add_ons_changed_elsewhere when stale).';

CREATE FUNCTION public.tg_3281_bump_add_on_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event uuid;
BEGIN
  v_event := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  -- The offering itself is being deleted (cascade): nothing to version.
  IF v_event IS NULL OR NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.offering_add_on_state AS s (event_id, revision, updated_at)
  VALUES (v_event, 1, now())
  ON CONFLICT (event_id) DO UPDATE
    SET revision = s.revision + 1, updated_at = now();
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER tg_3281_bump_add_on_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_add_ons
  FOR EACH ROW EXECUTE FUNCTION public.tg_3281_bump_add_on_revision();
CREATE TRIGGER tg_3281_bump_add_on_link_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_add_on_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_3281_bump_add_on_revision();
REVOKE ALL ON FUNCTION public.tg_3281_bump_add_on_revision() FROM PUBLIC, anon, authenticated;

-- ── Shared: who may author, and the editor's payload ────────────────────────
CREATE FUNCTION public.issue_3281_assert_add_on_author(p_event_id uuid)
RETURNS public.events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_event FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  -- Same rank rule as business_event_ticket_extras; a missing offering and a
  -- caller without the rank get the same answer.
  IF NOT FOUND
     OR public.biz_brand_effective_rank(v_event.brand_id, auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'add_ons_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_event;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_assert_add_on_author(uuid) FROM PUBLIC, anon, authenticated;

-- The dates a ticket admits: its own list, or every dated occurrence.
CREATE FUNCTION public.issue_3281_ticket_occurrence_keys(p_ticket_type_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(tt.valid_occurrence_keys, ARRAY(
           SELECT d.occurrence_key FROM public.event_dates d
            WHERE d.event_id = tt.event_id AND d.occurrence_key IS NOT NULL
            ORDER BY d.start_at, d.occurrence_key))
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_ticket_occurrence_keys(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.issue_3281_offering_add_ons_json(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'eventId', e.id::text,
    'eventType', e.event_type,
    'revision', COALESCE((SELECT s.revision FROM public.offering_add_on_state s WHERE s.event_id = e.id), 0),
    'multiLinkEnabled', public.issue_3281_add_on_switch('multi_link_enabled'),
    'freeParentEnabled', public.issue_3281_add_on_switch('free_parent_enabled'),
    'currency', (SELECT min(tt.currency)::text FROM public.ticket_types tt
                  WHERE tt.event_id = e.id AND tt.deleted_at IS NULL),
    'dates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', d.occurrence_key, 'startsAt', d.start_at,
                                          'timezone', d.timezone)
                       ORDER BY d.start_at, d.occurrence_key)
        FROM public.event_dates d
       WHERE d.event_id = e.id AND d.occurrence_key IS NOT NULL), '[]'::jsonb),
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', 'ticket_type', 'ticketTypeId', tt.id::text, 'name', tt.name,
               'isFree', (tt.is_free OR tt.price_cents = 0), 'priceCents', tt.price_cents,
               'validOccurrenceKeys', to_jsonb(tt.valid_occurrence_keys))
             ORDER BY tt.display_order, tt.created_at, tt.id)
        FROM public.ticket_types tt
       WHERE tt.event_id = e.id AND tt.deleted_at IS NULL), '[]'::jsonb)
      || CASE WHEN e.event_type = 'rsvp'
           THEN jsonb_build_array(jsonb_build_object('kind', 'rsvp'))
           ELSE '[]'::jsonb END,
    'addOns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id::text, 'name', a.name, 'description', a.description,
               'priceCents', a.price_cents, 'isUnlimited', a.is_unlimited,
               'quantityTotal', a.quantity_total, 'maxPerTicket', a.max_per_ticket,
               'validOccurrenceKeys', to_jsonb(a.valid_occurrence_keys),
               'photoPath', a.photo_path, 'photoThumbPath', a.photo_thumb_path,
               'showOnPublicPage', a.show_on_public_page, 'sortOrder', a.sort_order,
               'soldCount', public.issue_3281_add_on_sold(a.id, NULL),
               'soldOccurrenceKeys', to_jsonb(ARRAY(
                 SELECT DISTINCT k
                   FROM public.order_add_on_line_items li
                   JOIN public.orders o ON o.id = li.order_id,
                        unnest(li.day_scope_at_order) k
                  WHERE li.ticket_add_on_id = a.id
                    AND o.payment_status IN ('pending', 'paid', 'partial_refund')
                  ORDER BY k)),
               'targets', COALESCE((
                 SELECT jsonb_agg(CASE WHEN l.target_kind = 'rsvp'
                          THEN jsonb_build_object('kind', 'rsvp')
                          ELSE jsonb_build_object('kind', 'ticket_type', 'ticketTypeId', l.ticket_type_id::text) END
                        ORDER BY l.created_at, l.id)
                   FROM public.ticket_add_on_links l
                   LEFT JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
                  WHERE l.add_on_id = a.id
                    AND (l.target_kind = 'rsvp' OR tt.deleted_at IS NULL)), '[]'::jsonb))
             ORDER BY a.sort_order, a.created_at, a.id)
        FROM public.ticket_add_ons a
       WHERE a.event_id = e.id AND a.is_active), '[]'::jsonb))
    FROM public.events e
   WHERE e.id = p_event_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_offering_add_ons_json(uuid) FROM PUBLIC, anon, authenticated;

-- ── Read ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.biz_offering_add_ons(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.issue_3281_assert_add_on_author(p_event_id);
  RETURN public.issue_3281_offering_add_ons_json(p_event_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_offering_add_ons(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_offering_add_ons(uuid) TO authenticated;

-- ── Save: the whole list, against the revision the editor read ──────────────
CREATE FUNCTION public.biz_offering_add_ons_save(
  p_event_id uuid, p_add_ons jsonb, p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_revision bigint;
  v_multi boolean := public.issue_3281_add_on_switch('multi_link_enabled');
  v_free_parent boolean := public.issue_3281_add_on_switch('free_parent_enabled');
  v_item jsonb;
  v_target jsonb;
  v_order bigint;
  v_id uuid;
  v_existing public.ticket_add_ons%ROWTYPE;
  v_name text;
  v_description text;
  v_price integer;
  v_unlimited boolean;
  v_capacity integer;
  v_max integer;
  v_sort integer;
  v_public boolean;
  v_photo text;
  v_thumb text;
  v_keys text[];
  v_allowed text[];
  v_tickets uuid[];
  v_rsvp boolean;
  v_first_ticket uuid;
  v_sold integer;
  v_listed uuid[] := '{}'::uuid[];
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  v_event := public.issue_3281_assert_add_on_author(p_event_id);

  IF jsonb_typeof(p_add_ons) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_add_ons) > 40 THEN
    RAISE EXCEPTION 'add_ons_too_many' USING ERRCODE = '22023';
  END IF;

  -- One lock order with checkout and the tier-JSON path: the offering's
  -- add-ons by id, then this offering's revision row.
  PERFORM 1 FROM public.ticket_add_ons a WHERE a.event_id = p_event_id ORDER BY a.id FOR UPDATE;
  INSERT INTO public.offering_add_on_state (event_id) VALUES (p_event_id)
  ON CONFLICT (event_id) DO NOTHING;
  SELECT s.revision INTO v_revision FROM public.offering_add_on_state s
   WHERE s.event_id = p_event_id FOR UPDATE;
  IF p_expected_revision IS NULL OR v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'add_ons_changed_elsewhere' USING ERRCODE = 'PT409';
  END IF;

  FOR v_item, v_order IN SELECT value, ordinality FROM jsonb_array_elements(p_add_ons) WITH ORDINALITY LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_name := btrim(COALESCE(v_item->>'name', ''));
      v_description := NULLIF(btrim(v_item->>'description'), '');
      v_price := (v_item->>'priceCents')::integer;
      v_unlimited := COALESCE((v_item->>'isUnlimited')::boolean, false);
      v_capacity := NULLIF(v_item->>'quantityTotal', '')::integer;
      v_max := COALESCE(NULLIF(v_item->>'maxPerTicket', '')::integer, 1);
      v_sort := COALESCE(NULLIF(v_item->>'sortOrder', '')::integer, v_order::integer - 1);
      v_public := COALESCE((v_item->>'showOnPublicPage')::boolean, true);
      v_photo := NULLIF(v_item->>'photoPath', '');
      v_thumb := NULLIF(v_item->>'photoThumbPath', '');
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
    END;
    -- Money is integer minor units: a fractional or missing price is refused.
    IF v_price IS NULL OR v_price < 0 OR jsonb_typeof(v_item->'priceCents') <> 'number'
       OR (v_item->>'priceCents') ~ '[.eE]' THEN
      RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'ticket_extra_name_invalid' USING ERRCODE = '22023';
    END IF;
    IF length(COALESCE(v_description, '')) > 280 THEN
      RAISE EXCEPTION 'ticket_extra_description_too_long' USING ERRCODE = '22023';
    END IF;
    IF v_unlimited AND v_capacity IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_extra_capacity_invalid' USING ERRCODE = '22023';
    END IF;
    IF NOT v_unlimited AND COALESCE(v_capacity, 0) < 1 THEN
      RAISE EXCEPTION 'ticket_extra_capacity_required' USING ERRCODE = '22023';
    END IF;
    IF v_max NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'ticket_extra_max_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_photo IS NULL) <> (v_thumb IS NULL)
       OR (v_photo IS NOT NULL AND (
            v_photo !~ '^add-ons/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
         OR v_thumb <> regexp_replace(v_photo, '\.jpg$', '_thumb.jpg')
         OR split_part(v_photo, '/', 2) <> p_event_id::text)) THEN
      RAISE EXCEPTION 'add_on_photo_invalid' USING ERRCODE = '22023';
    END IF;

    -- What it comes with.
    IF jsonb_typeof(v_item->'targets') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_item->'targets') = 0 THEN
      RAISE EXCEPTION 'add_on_target_required' USING ERRCODE = '22023';
    END IF;
    v_tickets := '{}'::uuid[];
    v_rsvp := false;
    FOR v_target IN SELECT value FROM jsonb_array_elements(v_item->'targets') LOOP
      IF v_target->>'kind' = 'rsvp' THEN
        IF v_event.event_type IS DISTINCT FROM 'rsvp' OR v_rsvp THEN
          RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
        END IF;
        v_rsvp := true;
      ELSIF v_target->>'kind' = 'ticket_type' AND v_target->>'ticketTypeId' ~ v_uuid THEN
        IF NOT EXISTS (SELECT 1 FROM public.ticket_types tt
                        WHERE tt.id = (v_target->>'ticketTypeId')::uuid
                          AND tt.event_id = p_event_id AND tt.deleted_at IS NULL)
           OR (v_target->>'ticketTypeId')::uuid = ANY (v_tickets) THEN
          RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
        END IF;
        v_tickets := v_tickets || (v_target->>'ticketTypeId')::uuid;
      ELSE
        RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NOT v_multi AND cardinality(v_tickets) + (CASE WHEN v_rsvp THEN 1 ELSE 0 END) > 1 THEN
      RAISE EXCEPTION 'add_on_multi_link_off' USING ERRCODE = 'P0001';
    END IF;
    -- Free tickets carry paid add-ons only once free parents are switched on.
    IF v_price > 0 AND NOT v_free_parent AND (v_rsvp OR EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.id = ANY (v_tickets) AND (tt.is_free OR tt.price_cents = 0))) THEN
      RAISE EXCEPTION 'paid_extra_on_free_ticket' USING ERRCODE = 'P0001';
    END IF;

    -- Dates: a non-empty list inside the dates its tickets admit.
    IF COALESCE(jsonb_typeof(v_item->'validOccurrenceKeys'), 'null') = 'null' THEN
      v_keys := NULL;
    ELSIF jsonb_typeof(v_item->'validOccurrenceKeys') <> 'array'
       OR jsonb_array_length(v_item->'validOccurrenceKeys') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'validOccurrenceKeys') k
                   WHERE jsonb_typeof(k) <> 'string') THEN
      RAISE EXCEPTION 'ticket_extra_day_scope_empty' USING ERRCODE = '22023';
    ELSE
      SELECT array_agg(DISTINCT k ORDER BY k) INTO v_keys
        FROM jsonb_array_elements_text(v_item->'validOccurrenceKeys') k;
      SELECT array_agg(DISTINCT k) INTO v_allowed
        FROM (SELECT unnest(public.issue_3281_ticket_occurrence_keys(t)) k
                FROM unnest(v_tickets) t
              UNION ALL
              SELECT d.occurrence_key FROM public.event_dates d
               WHERE v_rsvp AND d.event_id = p_event_id AND d.occurrence_key IS NOT NULL) u;
      IF v_allowed IS NULL OR NOT (v_keys <@ v_allowed) THEN
        RAISE EXCEPTION 'add_on_dates_outside_tickets' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_existing := NULL::public.ticket_add_ons;
    IF NULLIF(v_item->>'id', '') IS NOT NULL THEN
      IF NOT (v_item->>'id' ~ v_uuid) THEN
        RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_existing FROM public.ticket_add_ons a
       WHERE a.id = (v_item->>'id')::uuid AND a.event_id = p_event_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
      END IF;
      IF v_existing.id = ANY (v_listed) THEN
        RAISE EXCEPTION 'add_ons_invalid' USING ERRCODE = '22023';
      END IF;
    END IF;

    -- A sold add-on keeps its price, room for what was sold and every date
    -- someone bought it for (today's rules). Unlinking a ticket is allowed:
    -- sold lines keep their own snapshot.
    IF v_existing.id IS NOT NULL THEN
      v_sold := public.issue_3281_add_on_sold(v_existing.id, NULL);
      IF v_sold > 0 THEN
        IF v_keys IS NOT NULL THEN
          SELECT COALESCE(MAX(public.issue_3281_add_on_sold(v_existing.id, k)), 0) INTO v_sold
            FROM unnest(v_keys) k;
        END IF;
        IF v_price <> v_existing.price_cents OR COALESCE(v_capacity, 2147483647) < v_sold THEN
          RAISE EXCEPTION 'sold_extra_mutation_blocked' USING ERRCODE = 'P0001';
        END IF;
        IF v_keys IS NOT NULL AND EXISTS (
          SELECT 1
            FROM public.order_add_on_line_items li
            JOIN public.orders o ON o.id = li.order_id
           WHERE li.ticket_add_on_id = v_existing.id
             AND o.payment_status IN ('pending', 'paid', 'partial_refund')
             AND EXISTS (SELECT 1 FROM unnest(li.day_scope_at_order) k WHERE NOT (k = ANY (v_keys)))
        ) THEN
          RAISE EXCEPTION 'extra_day_scope_drops_sold_day' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;

    -- [TRANSITIONAL] ticket_type_id mirrors the first ticket link until #3281
    -- S8 drops it; the bridge keeps that one link, the loop below the rest.
    v_first_ticket := CASE WHEN cardinality(v_tickets) > 0 THEN v_tickets[1] ELSE NULL END;
    IF v_existing.id IS NOT NULL THEN
      UPDATE public.ticket_add_ons SET
        ticket_type_id = v_first_ticket, name = v_name, description = v_description,
        price_cents = v_price, quantity_total = v_capacity, is_unlimited = v_unlimited,
        max_per_ticket = v_max, sort_order = v_sort, valid_occurrence_keys = v_keys,
        photo_path = v_photo, photo_thumb_path = v_thumb, show_on_public_page = v_public,
        is_active = true, updated_at = now()
      WHERE id = v_existing.id;
      v_id := v_existing.id;
    ELSE
      INSERT INTO public.ticket_add_ons (
        event_id, ticket_type_id, name, description, price_cents, quantity_total,
        is_unlimited, max_per_ticket, sort_order, valid_occurrence_keys,
        photo_path, photo_thumb_path, show_on_public_page
      ) VALUES (
        p_event_id, v_first_ticket, v_name, v_description, v_price, v_capacity,
        v_unlimited, v_max, v_sort, v_keys, v_photo, v_thumb, v_public)
      RETURNING id INTO v_id;
    END IF;
    v_listed := v_listed || v_id;

    DELETE FROM public.ticket_add_on_links l
     WHERE l.add_on_id = v_id
       AND ((l.target_kind = 'ticket_type' AND NOT (l.ticket_type_id = ANY (v_tickets)))
         OR (l.target_kind = 'rsvp' AND NOT v_rsvp));
    INSERT INTO public.ticket_add_on_links (add_on_id, event_id, target_kind, ticket_type_id)
    SELECT v_id, p_event_id, 'ticket_type', t FROM unnest(v_tickets) t
    ON CONFLICT (add_on_id, ticket_type_id) DO NOTHING;
    IF v_rsvp AND NOT EXISTS (SELECT 1 FROM public.ticket_add_on_links l
                               WHERE l.add_on_id = v_id AND l.target_kind = 'rsvp') THEN
      INSERT INTO public.ticket_add_on_links (add_on_id, event_id, target_kind, ticket_type_id)
      VALUES (v_id, p_event_id, 'rsvp', NULL);
    END IF;
  END LOOP;

  -- A ticket comes with up to 20 add-ons (MAX_EXTRAS_PER_TIER).
  IF EXISTS (
    SELECT 1 FROM public.ticket_add_on_links l
      JOIN public.ticket_add_ons a ON a.id = l.add_on_id
     WHERE a.id = ANY (v_listed) AND l.target_kind = 'ticket_type'
     GROUP BY l.ticket_type_id HAVING count(*) > 20
  ) THEN
    RAISE EXCEPTION 'add_ons_too_many_for_ticket' USING ERRCODE = '22023';
  END IF;

  -- Unlisted add-ons stop selling. Rows and links stay, so orders, holds and
  -- the door keep them.
  UPDATE public.ticket_add_ons a SET is_active = false, updated_at = now()
   WHERE a.event_id = p_event_id AND a.is_active AND NOT (a.id = ANY (v_listed));

  RETURN public.issue_3281_offering_add_ons_json(p_event_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_offering_add_ons_save(uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_offering_add_ons_save(uuid, jsonb, bigint) TO authenticated;

COMMENT ON FUNCTION public.biz_offering_add_ons_save(uuid, jsonb, bigint) IS
  'issue #3281 S3: saves an offering''s whole add-on list (event, trip, experience or RSVP) for an event_manager or above; unlisted add-ons stop selling; a stale revision raises PT409 add_ons_changed_elsewhere.';

-- ── Photos: event_covers/add-ons/{eventId}/{file} ───────────────────────────
-- The bucket is public for reads already; writes need the offering's
-- event_manager rank, the same predicate as the trip-day media policies.
DROP POLICY IF EXISTS "Event managers can upload add-on photos" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can update add-on photos" ON storage.objects;
DROP POLICY IF EXISTS "Event managers can delete add-on photos" ON storage.objects;

CREATE POLICY "Event managers can upload add-on photos"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND (storage.foldername(name))[1] = 'add-ons'
  AND name ~ '^add-ons/[0-9a-f-]{36}/[0-9a-f-]{36}(_thumb)?\.jpg$'
  AND EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id::text = (storage.foldername(name))[2]
       AND e.deleted_at IS NULL
       AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can update add-on photos"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND (storage.foldername(name))[1] = 'add-ons'
  AND EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id::text = (storage.foldername(name))[2]
       AND e.deleted_at IS NULL
       AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
)
WITH CHECK (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND (storage.foldername(name))[1] = 'add-ons'
  AND name ~ '^add-ons/[0-9a-f-]{36}/[0-9a-f-]{36}(_thumb)?\.jpg$'
  AND EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id::text = (storage.foldername(name))[2]
       AND e.deleted_at IS NULL
       AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

CREATE POLICY "Event managers can delete add-on photos"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'event_covers'
  AND array_length(storage.foldername(name), 1) = 2
  AND (storage.foldername(name))[1] = 'add-ons'
  AND EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id::text = (storage.foldername(name))[2]
       AND e.deleted_at IS NULL
       AND public.biz_brand_effective_rank_for_caller(e.brand_id) >= public.biz_role_rank('event_manager')
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
