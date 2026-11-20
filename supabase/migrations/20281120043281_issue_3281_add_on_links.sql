-- issue #3281 — Add-ons on every offering, slice S1: links, owner, switches.
--
-- Spec: the #3281 comment "## Spec: add-ons on every offering", sections 4,
-- 6.1 and 6.2. Seth approved D-1..D-8 on 2026-11-20.
--
-- An add-on (table name kept: ticket_add_ons) now belongs to its offering
-- (events.id, which every event, trip, experience and RSVP is) and is linked
-- to the tickets, packages or RSVP it comes with in ticket_add_on_links. Stock
-- stays one number per add-on, shared by every link.
--
-- Nothing visible changes. With every add_on_rollout switch off (the default),
-- quote, session, finalize, public readers and Host authoring behave exactly
-- as before:
--   * every add-on keeps exactly one ticket link, backfilled from
--     ticket_type_id, and the price check refuses the same add-on twice in a
--     cart, as today;
--   * ticket_type_id stays and is still written by the tier-JSON write path.
--     [TRANSITIONAL] the column and tg_3281_add_on_legacy_ticket_bridge are
--     dropped by #3281 S8, once every reader and writer uses the links.
--
-- Re-emitted from their terminal bodies (only the marked link changes):
--   issue_3281_price_extras            from 20280313003281_issue_3281_extras_checkout.sql
--   issue_3281_public_ticket_extras    from 20280315003281_issue_3281_public_extras.sql
--   issue_3281_attach_public_extras    from 20280315003281_issue_3281_public_extras.sql
--   issue_3281_sync_live_tier_extras   from 20280314003281_issue_3281_extras_authoring.sql
--   issue_3281_assert_kept_extras_fit_tier from 20280314003281_issue_3281_extras_authoring.sql
--   issue_3281_tier_extras_json        from 20280314003281_issue_3281_extras_authoring.sql
--   business_event_ticket_extras       from 20280314003281_issue_3281_extras_authoring.sql
-- Not re-emitted here (each still correct while every add-on keeps its
-- ticket_type_id and multi_link_enabled is off; S3 re-emits them before that
-- switch goes on): issue_3281_publish_tier_extras (the bridge links its rows),
-- issue_3281_strip_removed_days and the 20280523003281 live-save date strip
-- (they scope by ticket_type_id -> event), issue_1930_ticket_session_authorized
-- (reads add-ons by id; per-session totals per add-on come with S3), and
-- issue_1930_ticket_checkout_finalize_base (the new order columns take their
-- defaults, which are right for every order S1 can make; S5/S6 copy them).

BEGIN;

-- ── The offering owns the add-on ─────────────────────────────────────────────
ALTER TABLE public.ticket_add_ons
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN photo_path text,
  ADD COLUMN photo_thumb_path text,
  ADD COLUMN show_on_public_page boolean NOT NULL DEFAULT true;

UPDATE public.ticket_add_ons a
   SET event_id = tt.event_id
  FROM public.ticket_types tt
 WHERE tt.id = a.ticket_type_id;

DO $owner$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ticket_add_ons WHERE event_id IS NULL) THEN
    RAISE EXCEPTION 'add_on_owner_backfill_incomplete';
  END IF;
END;
$owner$;

ALTER TABLE public.ticket_add_ons
  ALTER COLUMN event_id SET NOT NULL,
  ALTER COLUMN ticket_type_id DROP NOT NULL,  -- [TRANSITIONAL] dropped by #3281 S8
  ADD CONSTRAINT ticket_add_ons_photo_path_shape CHECK (
    photo_path IS NULL
    OR (photo_path ~ '^add-ons/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
        AND split_part(photo_path, '/', 2) = event_id::text)),
  ADD CONSTRAINT ticket_add_ons_photo_thumb_path_shape CHECK (
    photo_thumb_path IS NULL
    OR (photo_thumb_path ~ '^add-ons/[0-9a-f-]{36}/[0-9a-f-]{36}_thumb\.jpg$'
        AND split_part(photo_thumb_path, '/', 2) = event_id::text)),
  ADD CONSTRAINT ticket_add_ons_photo_pair CHECK (
    (photo_path IS NULL) = (photo_thumb_path IS NULL));

CREATE INDEX idx_ticket_add_ons_event ON public.ticket_add_ons (event_id, sort_order);

COMMENT ON COLUMN public.ticket_add_ons.event_id IS
  'issue #3281: the offering (event, trip, experience or RSVP) that owns this add-on.';
COMMENT ON COLUMN public.ticket_add_ons.ticket_type_id IS
  'issue #3281 [TRANSITIONAL]: the single ticket of the pre-links model, kept in step by tg_3281_add_on_legacy_ticket_bridge; dropped by S8. Read ticket_add_on_links instead.';

-- ── What each add-on comes with ─────────────────────────────────────────────
CREATE TABLE public.ticket_add_on_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  add_on_id uuid NOT NULL REFERENCES public.ticket_add_ons(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  target_kind text NOT NULL,
  ticket_type_id uuid REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_add_on_links_target_kind CHECK (target_kind IN ('ticket_type', 'rsvp')),
  CONSTRAINT ticket_add_on_links_target_shape CHECK (
    (target_kind = 'ticket_type') = (ticket_type_id IS NOT NULL)),
  CONSTRAINT ticket_add_on_links_one_per_ticket UNIQUE (add_on_id, ticket_type_id)
);
CREATE UNIQUE INDEX ticket_add_on_links_one_rsvp
  ON public.ticket_add_on_links (add_on_id) WHERE target_kind = 'rsvp';
CREATE INDEX idx_ticket_add_on_links_ticket_type ON public.ticket_add_on_links (ticket_type_id);
CREATE INDEX idx_ticket_add_on_links_event ON public.ticket_add_on_links (event_id);

-- A link stays on its add-on's offering: the add-on's owner, a ticket of that
-- offering, or the offering itself when it is an RSVP.
CREATE FUNCTION public.tg_3281_add_on_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_add_ons a
     WHERE a.id = NEW.add_on_id AND a.event_id = NEW.event_id
  ) THEN
    RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.target_kind = 'ticket_type' AND NOT EXISTS (
    SELECT 1 FROM public.ticket_types tt
     WHERE tt.id = NEW.ticket_type_id AND tt.event_id = NEW.event_id
  ) THEN
    RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.target_kind = 'rsvp' AND NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = NEW.event_id AND e.event_type = 'rsvp'
  ) THEN
    RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER tg_3281_add_on_link_guard
  BEFORE INSERT OR UPDATE ON public.ticket_add_on_links
  FOR EACH ROW EXECUTE FUNCTION public.tg_3281_add_on_link_guard();

-- Lossless backfill: one ticket link per existing add-on.
INSERT INTO public.ticket_add_on_links (add_on_id, event_id, target_kind, ticket_type_id)
SELECT a.id, a.event_id, 'ticket_type', a.ticket_type_id
  FROM public.ticket_add_ons a
 WHERE a.ticket_type_id IS NOT NULL;

DO $backfill$
DECLARE
  v_add_ons bigint;
  v_links bigint;
BEGIN
  SELECT count(*) INTO v_add_ons FROM public.ticket_add_ons;
  SELECT count(*) INTO v_links FROM public.ticket_add_on_links;
  IF v_links <> v_add_ons OR EXISTS (
    SELECT 1 FROM public.ticket_add_ons a
     WHERE NOT EXISTS (
       SELECT 1 FROM public.ticket_add_on_links l
        WHERE l.add_on_id = a.id AND l.target_kind = 'ticket_type'
          AND l.ticket_type_id = a.ticket_type_id AND l.event_id = a.event_id)
  ) THEN
    RAISE EXCEPTION 'add_on_link_backfill_lossy: % add-ons, % links', v_add_ons, v_links;
  END IF;
END;
$backfill$;

ALTER TABLE public.ticket_add_on_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_add_on_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_add_on_links TO service_role;
REVOKE ALL ON FUNCTION public.tg_3281_add_on_link_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ticket_add_on_links IS
  'issue #3281: which tickets (or the RSVP) each add-on comes with. The only truth for that question; access through SECURITY DEFINER functions.';

-- [TRANSITIONAL] #3281 S8 drops this with ticket_add_ons.ticket_type_id.
-- Writers that still name one ticket (the tier-JSON path, older fixtures) get
-- the owner filled from that ticket and a matching link. The owner never moves.
CREATE FUNCTION public.tg_3281_add_on_legacy_ticket_bridge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ticket_event uuid;
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF NEW.ticket_type_id IS NOT NULL THEN
      SELECT tt.event_id INTO v_ticket_event FROM public.ticket_types tt WHERE tt.id = NEW.ticket_type_id;
      IF TG_OP = 'INSERT' AND NEW.event_id IS NULL THEN
        NEW.event_id := v_ticket_event;
      END IF;
      IF v_ticket_event IS DISTINCT FROM NEW.event_id THEN
        RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'add_on_link_wrong_offering' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.ticket_type_id IS NOT NULL
     AND OLD.ticket_type_id IS DISTINCT FROM NEW.ticket_type_id THEN
    DELETE FROM public.ticket_add_on_links
     WHERE add_on_id = NEW.id AND ticket_type_id = OLD.ticket_type_id;
  END IF;
  IF NEW.ticket_type_id IS NOT NULL THEN
    INSERT INTO public.ticket_add_on_links (add_on_id, event_id, target_kind, ticket_type_id)
    VALUES (NEW.id, NEW.event_id, 'ticket_type', NEW.ticket_type_id)
    ON CONFLICT (add_on_id, ticket_type_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER tg_3281_add_on_legacy_ticket_bridge_before
  BEFORE INSERT OR UPDATE OF ticket_type_id, event_id ON public.ticket_add_ons
  FOR EACH ROW EXECUTE FUNCTION public.tg_3281_add_on_legacy_ticket_bridge();
CREATE TRIGGER tg_3281_add_on_legacy_ticket_bridge_after
  AFTER INSERT OR UPDATE OF ticket_type_id ON public.ticket_add_ons
  FOR EACH ROW EXECUTE FUNCTION public.tg_3281_add_on_legacy_ticket_bridge();
REVOKE ALL ON FUNCTION public.tg_3281_add_on_legacy_ticket_bridge() FROM PUBLIC, anon, authenticated;

-- ── Bought-with parent and plan choice on holds and orders ──────────────────
-- ticket_type_id is the ticket the add-on was bought with; an RSVP parent has
-- none. plan_choice is NULL when the order has no plan (#3281 S5 sets it).
ALTER TABLE public.order_add_on_line_items
  ALTER COLUMN ticket_type_id DROP NOT NULL,
  ADD COLUMN parent_kind text NOT NULL DEFAULT 'ticket_type',
  ADD COLUMN plan_choice text,
  ADD CONSTRAINT order_add_on_line_items_parent_kind CHECK (parent_kind IN ('ticket_type', 'rsvp')),
  ADD CONSTRAINT order_add_on_line_items_parent_shape CHECK (
    (parent_kind = 'ticket_type') = (ticket_type_id IS NOT NULL)),
  ADD CONSTRAINT order_add_on_line_items_plan_choice CHECK (
    plan_choice IS NULL OR plan_choice IN ('today', 'spread'));

ALTER TABLE public.ticket_checkout_session_add_on_items
  ALTER COLUMN ticket_type_id DROP NOT NULL,
  ADD COLUMN parent_kind text NOT NULL DEFAULT 'ticket_type',
  ADD COLUMN plan_choice text,
  ADD CONSTRAINT ticket_checkout_session_add_on_items_parent_kind CHECK (parent_kind IN ('ticket_type', 'rsvp')),
  ADD CONSTRAINT ticket_checkout_session_add_on_items_parent_shape CHECK (
    (parent_kind = 'ticket_type') = (ticket_type_id IS NOT NULL)),
  ADD CONSTRAINT ticket_checkout_session_add_on_items_plan_choice CHECK (
    plan_choice IS NULL OR plan_choice IN ('today', 'spread')),
  DROP CONSTRAINT ticket_checkout_session_add_on_items_one_per_extra,
  -- The same add-on may be bought with two different tickets in one cart.
  ADD CONSTRAINT ticket_checkout_session_add_on_items_one_per_parent
    UNIQUE NULLS NOT DISTINCT (checkout_session_id, ticket_add_on_id, ticket_type_id);

-- ── Rollout switches: server truth for the new checkout rules ───────────────
-- [TRANSITIONAL] each switch is turned on by Seth's approved step (posted on
-- the Work card) and the table is removed once all four are on for a release.
CREATE TABLE public.add_on_rollout (
  id boolean PRIMARY KEY DEFAULT true,
  multi_link_enabled boolean NOT NULL DEFAULT false,
  free_parent_enabled boolean NOT NULL DEFAULT false,
  plan_enabled boolean NOT NULL DEFAULT false,
  rsvp_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT add_on_rollout_one_row CHECK (id)
);
INSERT INTO public.add_on_rollout DEFAULT VALUES;

ALTER TABLE public.add_on_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.add_on_rollout FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.add_on_rollout TO service_role;

COMMENT ON TABLE public.add_on_rollout IS
  'issue #3281: add-on rollout switches, all off by default. Written only by service_role in an approved step.';

-- A missing row or an unknown name reads as off or refuses; never on.
CREATE FUNCTION public.issue_3281_add_on_switch(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.add_on_rollout%ROWTYPE;
BEGIN
  IF p_name IS NULL OR p_name NOT IN
     ('multi_link_enabled', 'free_parent_enabled', 'plan_enabled', 'rsvp_enabled') THEN
    RAISE EXCEPTION 'add_on_switch_unknown';
  END IF;
  SELECT * INTO v_row FROM public.add_on_rollout WHERE id;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN CASE p_name
    WHEN 'multi_link_enabled' THEN v_row.multi_link_enabled
    WHEN 'free_parent_enabled' THEN v_row.free_parent_enabled
    WHEN 'plan_enabled' THEN v_row.plan_enabled
    WHEN 'rsvp_enabled' THEN v_row.rsvp_enabled
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_add_on_switch(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_switch(text) TO service_role;

-- ── Re-emits: which tickets an add-on comes with is read from the links ─────

-- Prices the extras on a cart's lines. The quote calls it without locks; the
-- session calls it with locks, inside the transaction that holds the places.
CREATE OR REPLACE FUNCTION public.issue_3281_price_extras(
  p_event_id uuid, p_lines jsonb, p_day_ids uuid[], p_lock boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_line jsonb;
  v_req jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_seen text[] := '{}'::text[];  -- issue #3281 S1: the cart's dedupe keys
  v_dedupe text;
  v_multi boolean := public.issue_3281_add_on_switch('multi_link_enabled');  -- issue #3281 S1
  v_in_cart jsonb := '{}'::jsonb;  -- issue #3281 S1: places earlier lines of this cart take
  v_add_on public.ticket_add_ons%ROWTYPE;
  v_ticket public.ticket_types%ROWTYPE;
  v_qty integer;
  v_parent integer;
  v_line_days uuid[];
  v_keys text[];
  v_key text;
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN jsonb_build_object('items', v_items, 'totalCents', 0);
  END IF;
  -- Shape first: one entry per extra, each a known id and a whole quantity.
  -- issue #3281 S1: with multi_link_enabled off an add-on appears once in the
  -- whole cart, as before; on, once per ticket it is bought with.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF NOT (v_line ? 'addOns') OR v_line->'addOns' = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(v_line->'addOns') <> 'array' THEN RAISE EXCEPTION 'extras_invalid'; END IF;
    FOR v_req IN SELECT value FROM jsonb_array_elements(v_line->'addOns') LOOP
      IF jsonb_typeof(v_req) <> 'object'
         OR COALESCE(v_req->>'addOnId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         OR jsonb_typeof(v_req->'quantity') <> 'number'
         OR COALESCE(v_req->>'quantity', '') !~ '^[1-9][0-9]{0,5}$' THEN
        RAISE EXCEPTION 'extras_invalid';
      END IF;
      v_dedupe := CASE WHEN v_multi
        THEN COALESCE(v_line->>'ticketTypeId', '') || '|' || lower(v_req->>'addOnId')
        ELSE lower(v_req->>'addOnId') END;
      IF v_dedupe = ANY (v_seen) THEN RAISE EXCEPTION 'extras_invalid'; END IF;
      v_seen := v_seen || v_dedupe;
      IF NOT ((v_req->>'addOnId')::uuid = ANY (v_ids)) THEN
        v_ids := v_ids || (v_req->>'addOnId')::uuid;
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('items', v_items, 'totalCents', 0);
  END IF;

  -- One lock order for every caller, after the ticket and discount locks.
  IF p_lock THEN
    PERFORM 1 FROM public.ticket_add_ons a WHERE a.id = ANY (v_ids) ORDER BY a.id FOR UPDATE;
  END IF;

  FOR v_line, v_req IN
    SELECT l.value, r.value
      FROM jsonb_array_elements(p_lines) AS l,
           jsonb_array_elements(CASE WHEN jsonb_typeof(l.value->'addOns') = 'array'
             THEN l.value->'addOns' ELSE '[]'::jsonb END) AS r
     ORDER BY (r.value->>'addOnId'), (l.value->>'ticketTypeId')
  LOOP
    SELECT a.* INTO v_add_on FROM public.ticket_add_ons a WHERE a.id = (v_req->>'addOnId')::uuid;
    -- issue #3281 S1: the ticket comes from the add-on's links, never from
    -- ticket_add_ons.ticket_type_id.
    SELECT tt.* INTO v_ticket
      FROM public.ticket_add_on_links l
      JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
     WHERE l.add_on_id = v_add_on.id
       AND l.target_kind = 'ticket_type'
       AND l.ticket_type_id::text = (v_line->>'ticketTypeId');
    IF v_add_on.id IS NULL OR NOT v_add_on.is_active
       OR v_ticket.id IS NULL
       OR v_add_on.event_id IS DISTINCT FROM p_event_id
       OR v_ticket.event_id IS DISTINCT FROM p_event_id
       OR v_ticket.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'extra_not_available' USING DETAIL = v_req->>'addOnId';
    END IF;
    v_qty := (v_req->>'quantity')::integer;
    v_parent := CASE WHEN jsonb_typeof(v_line->'byDate') = 'object'
      THEN public.issue_3281_line_qty_sum(v_line)
      ELSE COALESCE((v_line->>'quantity')::integer, 0) END;
    IF v_qty > v_add_on.max_per_ticket * v_parent THEN
      RAISE EXCEPTION 'extra_quantity_above_max' USING DETAIL = v_add_on.id::text;
    END IF;

    -- The dates this line's tickets are for, then the ones this extra covers.
    IF jsonb_typeof(v_line->'byDate') = 'object' THEN
      v_line_days := ARRAY(SELECT q.key::uuid FROM jsonb_each_text(v_line->'byDate') q
                            WHERE COALESCE(q.value::integer, 0) > 0);
    ELSE
      v_line_days := COALESCE(public.issue_3281_days_in_scope(v_ticket.id, p_day_ids), p_day_ids);
    END IF;
    v_keys := ARRAY(
      SELECT d.occurrence_key FROM public.event_dates d
       WHERE d.event_id = p_event_id
         AND d.id = ANY (COALESCE(v_line_days, '{}'::uuid[]))
         AND d.occurrence_key IS NOT NULL
         AND (v_add_on.valid_occurrence_keys IS NULL
           OR d.occurrence_key = ANY (v_add_on.valid_occurrence_keys))
       ORDER BY d.start_at, d.id);
    IF v_add_on.valid_occurrence_keys IS NOT NULL AND cardinality(v_keys) = 0 THEN
      RAISE EXCEPTION 'extra_not_on_chosen_days' USING DETAIL = v_add_on.id::text;
    END IF;

    -- issue #3281 S1: stock is one count per add-on (per date when dated),
    -- shared by every ticket it comes with, so earlier lines of this cart count.
    IF NOT v_add_on.is_unlimited THEN
      IF v_add_on.valid_occurrence_keys IS NOT NULL THEN
        FOREACH v_key IN ARRAY v_keys LOOP
          IF public.issue_3281_add_on_taken(v_add_on.id, v_key, NULL)
             + COALESCE((v_in_cart->>(v_add_on.id::text || '|' || v_key))::integer, 0)
             + v_qty > v_add_on.quantity_total THEN
            RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_key;
          END IF;
          v_in_cart := v_in_cart || jsonb_build_object(v_add_on.id::text || '|' || v_key,
            COALESCE((v_in_cart->>(v_add_on.id::text || '|' || v_key))::integer, 0) + v_qty);
        END LOOP;
      ELSE
        IF public.issue_3281_add_on_taken(v_add_on.id, NULL, NULL)
           + COALESCE((v_in_cart->>(v_add_on.id::text || '|'))::integer, 0)
           + v_qty > v_add_on.quantity_total THEN
          RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_add_on.id::text;
        END IF;
        v_in_cart := v_in_cart || jsonb_build_object(v_add_on.id::text || '|',
          COALESCE((v_in_cart->>(v_add_on.id::text || '|'))::integer, 0) + v_qty);
      END IF;
    END IF;
    IF v_add_on.price_cents > 0 AND v_ticket.currency IS NULL THEN
      RAISE EXCEPTION 'event_currency_required';
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'addOnId', v_add_on.id, 'ticketTypeId', v_ticket.id,
      'addOnName', v_add_on.name, 'ticketName', v_ticket.name,
      'dayScope', CASE WHEN cardinality(v_keys) = 0 THEN NULL ELSE to_jsonb(v_keys) END,
      'quantity', v_qty, 'unitPriceCents', v_add_on.price_cents,
      'totalCents', v_qty * v_add_on.price_cents));
    v_total := v_total + v_qty * v_add_on.price_cents;
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'totalCents', v_total);
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_price_extras(uuid, jsonb, uuid[], boolean) FROM PUBLIC, anon, authenticated;

-- Public extras for one ticket, read through its links.
CREATE OR REPLACE FUNCTION public.issue_3281_public_ticket_extras(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'description', a.description,
      'priceCents', a.price_cents,
      'priceAllInCents', CASE WHEN a.price_cents = 0 THEN 0 ELSE public.compute_all_in_cents(
        a.price_cents,
        COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
        COALESCE(e.pass_service_fee, b.default_pass_service_fee),
        (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
      ) END,
      'maxPerTicket', a.max_per_ticket,
      'isUnlimited', a.is_unlimited,
      'validOccurrenceIds', CASE WHEN a.valid_occurrence_keys IS NULL THEN NULL ELSE to_jsonb(ARRAY(
        SELECT d.id FROM public.event_dates d
         WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
         ORDER BY d.start_at, d.id)) END,
      'remaining', CASE
        WHEN a.is_unlimited THEN NULL
        WHEN a.valid_occurrence_keys IS NULL
          THEN to_jsonb(GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, NULL, NULL), 0))
        ELSE COALESCE((
          SELECT jsonb_object_agg(d.id::text,
                   GREATEST(a.quantity_total - public.issue_3281_add_on_taken(a.id, d.occurrence_key, NULL), 0))
            FROM public.event_dates d
           WHERE d.event_id = e.id AND d.occurrence_key = ANY (a.valid_occurrence_keys)
        ), '{}'::jsonb)
      END
    ) ORDER BY a.sort_order, a.id), '[]'::jsonb)
  FROM public.ticket_add_on_links l  -- issue #3281 S1
  JOIN public.ticket_add_ons a ON a.id = l.add_on_id
  JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
  JOIN public.events e ON e.id = tt.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE l.ticket_type_id = p_ticket_type_id
    AND l.target_kind = 'ticket_type'
    AND a.is_active
    AND tt.deleted_at IS NULL;
$fn$;

-- Adds `extras` to each ticket that has any, keeping the payload's key order
-- (refundPolicy stays last, as #3872 and #3284 require). Anything that isn't an
-- object with an extra on sale comes back untouched, byte for byte.
CREATE OR REPLACE FUNCTION public.issue_3281_attach_public_extras(p_payload json)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_out json;
BEGIN
  IF p_payload IS NULL OR json_typeof(p_payload) <> 'object'
     OR json_typeof(p_payload->'tickets') IS DISTINCT FROM 'array'
     OR NOT EXISTS (
       SELECT 1 FROM json_array_elements(p_payload->'tickets') t
         JOIN public.ticket_add_on_links l  -- issue #3281 S1
           ON l.ticket_type_id = CASE WHEN (t->>'id') ~* v_uuid THEN (t->>'id')::uuid END
          AND l.target_kind = 'ticket_type'
         JOIN public.ticket_add_ons a ON a.id = l.add_on_id
        WHERE a.is_active) THEN
    RETURN p_payload;
  END IF;
  SELECT json_object_agg(entry.key,
      CASE WHEN entry.key = 'tickets' THEN (
        SELECT jsonb_agg(
          item.value::jsonb || CASE WHEN x.extras <> '[]'::jsonb
            THEN jsonb_build_object('extras', x.extras) ELSE '{}'::jsonb END
          ORDER BY item.ordinality)
        FROM json_array_elements(entry.value) WITH ORDINALITY item(value, ordinality)
        -- Each ticket's extras are read once.
        CROSS JOIN LATERAL (
          SELECT CASE WHEN (item.value->>'id') ~* v_uuid
            THEN public.issue_3281_public_ticket_extras((item.value->>'id')::uuid)
            ELSE '[]'::jsonb END AS extras
        ) x
      )::json
      ELSE entry.value END
      ORDER BY entry.ordinality)
    INTO v_out
    FROM json_each(p_payload) WITH ORDINALITY entry(key, value, ordinality);
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_public_ticket_extras(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_attach_public_extras(json) FROM PUBLIC, anon, authenticated;

-- Live edit: the listed extras are the tier's extras. New ones are added,
-- listed ones are updated under the sold locks, and unlisted ones stop selling.
CREATE OR REPLACE FUNCTION public.issue_3281_sync_live_tier_extras(
  p_ticket_type_id uuid, p_event_id uuid, p_extras jsonb, p_tier_free boolean, p_tier_keys text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_extra jsonb;
  v_order bigint;
  v_existing public.ticket_add_ons%ROWTYPE;
  v_keys text[];
  v_price integer;
  v_capacity integer;
  v_sold integer;
  v_listed uuid[] := '{}'::uuid[];
  v_new_id uuid;
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  p_extras := public.issue_3281_normalize_tier_extras(p_extras, p_tier_free);
  -- One lock order with checkout: the tier's extras, by id.
  -- issue #3281 S1: the tier's extras are the ones linked to it.
  PERFORM 1 FROM public.ticket_add_ons a
   WHERE EXISTS (SELECT 1 FROM public.ticket_add_on_links l
                  WHERE l.add_on_id = a.id AND l.ticket_type_id = p_ticket_type_id)
   ORDER BY a.id FOR UPDATE;
  FOR v_extra, v_order IN SELECT value, ordinality FROM jsonb_array_elements(p_extras) WITH ORDINALITY LOOP
    v_existing := NULL::public.ticket_add_ons;
    IF v_extra->>'id' ~ v_uuid THEN
      SELECT * INTO v_existing FROM public.ticket_add_ons a WHERE a.id = (v_extra->>'id')::uuid;
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.ticket_add_on_links l
         WHERE l.add_on_id = v_existing.id AND l.ticket_type_id = p_ticket_type_id
      ) THEN
        RAISE EXCEPTION 'ticket_extra_mismatch';
      END IF;
    END IF;
    v_keys := public.issue_3281_resolve_tier_scope(p_event_id, v_extra, v_existing.valid_occurrence_keys);
    PERFORM public.issue_3281_assert_extra_days_in_tier(v_keys, p_tier_keys);
    v_price := round((v_extra->>'priceGbp')::numeric * 100)::integer;
    v_capacity := NULLIF(v_extra->>'capacity', '')::integer;
    IF v_existing.id IS NOT NULL THEN
      v_sold := public.issue_3281_add_on_sold(v_existing.id, NULL);
      IF v_sold > 0 THEN
        -- The floor follows the capacity mode the extra will have: one shared
        -- count with no list, the busiest listed date with one.
        IF v_keys IS NOT NULL THEN
          SELECT COALESCE(MAX(public.issue_3281_add_on_sold(v_existing.id, k)), 0) INTO v_sold
            FROM unnest(v_keys) k;
        END IF;
        IF v_price <> v_existing.price_cents OR COALESCE(v_capacity, 2147483647) < v_sold THEN
          RAISE EXCEPTION 'sold_extra_mutation_blocked';
        END IF;
        -- A date anyone bought it for stays, whatever the old list said.
        IF v_keys IS NOT NULL AND EXISTS (
          SELECT 1
            FROM public.order_add_on_line_items li
            JOIN public.orders o ON o.id = li.order_id
           WHERE li.ticket_add_on_id = v_existing.id
             AND o.payment_status IN ('pending', 'paid', 'partial_refund')
             AND EXISTS (SELECT 1 FROM unnest(li.day_scope_at_order) k WHERE NOT (k = ANY (v_keys)))
        ) THEN
          RAISE EXCEPTION 'extra_day_scope_drops_sold_day';
        END IF;
      END IF;
      UPDATE public.ticket_add_ons SET
        name = v_extra->>'name', description = v_extra->>'description', price_cents = v_price,
        quantity_total = v_capacity, is_unlimited = (v_extra->>'isUnlimited')::boolean,
        max_per_ticket = (v_extra->>'maxPerTicket')::integer, sort_order = v_order::integer - 1,
        valid_occurrence_keys = v_keys, is_active = true, updated_at = now()
      WHERE id = v_existing.id;
      v_listed := v_listed || v_existing.id;
    ELSE
      -- issue #3281 S1: the offering owns it; the bridge adds its ticket link.
      INSERT INTO public.ticket_add_ons (
        event_id, ticket_type_id, name, description, price_cents, quantity_total, is_unlimited,
        max_per_ticket, sort_order, valid_occurrence_keys
      ) VALUES (
        p_event_id, p_ticket_type_id, v_extra->>'name', v_extra->>'description', v_price, v_capacity,
        (v_extra->>'isUnlimited')::boolean, (v_extra->>'maxPerTicket')::integer,
        v_order::integer - 1, v_keys)
      RETURNING id INTO v_new_id;
      v_listed := v_listed || v_new_id;
    END IF;
  END LOOP;
  -- Unlisted extras stop selling. Rows stay, so orders and holds keep them.
  UPDATE public.ticket_add_ons a SET is_active = false, updated_at = now()
   WHERE a.is_active AND NOT (a.id = ANY (v_listed))
     AND EXISTS (SELECT 1 FROM public.ticket_add_on_links l
                  WHERE l.add_on_id = a.id AND l.ticket_type_id = p_ticket_type_id);
END;
$fn$;

-- A tier edited without its extras keeps them, and they must still fit it:
-- no paid extra on a free tier, and no extra dated outside the tier's dates.
CREATE OR REPLACE FUNCTION public.issue_3281_assert_kept_extras_fit_tier(
  p_ticket_type_id uuid, p_tier_free boolean, p_tier_keys text[]
) RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_tier_free AND EXISTS (
    SELECT 1 FROM public.ticket_add_on_links l  -- issue #3281 S1
      JOIN public.ticket_add_ons a ON a.id = l.add_on_id
     WHERE l.ticket_type_id = p_ticket_type_id AND a.is_active AND a.price_cents > 0
  ) THEN
    RAISE EXCEPTION 'paid_extra_on_free_ticket';
  END IF;
  IF p_tier_keys IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ticket_add_on_links l  -- issue #3281 S1
      JOIN public.ticket_add_ons a ON a.id = l.add_on_id
     WHERE l.ticket_type_id = p_ticket_type_id AND a.is_active
       AND a.valid_occurrence_keys IS NOT NULL AND NOT (a.valid_occurrence_keys <@ p_tier_keys)
  ) THEN
    RAISE EXCEPTION 'extra_day_scope_outside_ticket';
  END IF;
END;
$fn$;

-- A live tier's extras, in the payload shape the wizards edit.
CREATE OR REPLACE FUNCTION public.issue_3281_tier_extras_json(p_ticket_type_id uuid, p_with_sales boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id::text, 'name', a.name, 'description', a.description,
    'priceGbp', a.price_cents / 100.0, 'isUnlimited', a.is_unlimited,
    'capacity', a.quantity_total, 'maxPerTicket', a.max_per_ticket,
    'validDayIds', to_jsonb(a.valid_occurrence_keys)
  ) || CASE WHEN p_with_sales THEN jsonb_build_object(
    -- Total sales lock the price; the capacity floor follows the extra's mode.
    'soldCount', public.issue_3281_add_on_sold(a.id, NULL),
    'capacityFloor', CASE WHEN a.valid_occurrence_keys IS NULL
      THEN public.issue_3281_add_on_sold(a.id, NULL)
      ELSE (SELECT COALESCE(MAX(public.issue_3281_add_on_sold(a.id, k)), 0)
              FROM unnest(a.valid_occurrence_keys) k) END,
    -- The dates someone bought it for: only these are locked on the list.
    'soldDayIds', to_jsonb(ARRAY(
      SELECT DISTINCT k
        FROM public.order_add_on_line_items li
        JOIN public.orders o ON o.id = li.order_id,
             unnest(li.day_scope_at_order) k
       WHERE li.ticket_add_on_id = a.id
         AND o.payment_status IN ('pending', 'paid', 'partial_refund')
       ORDER BY k))
  ) ELSE '{}'::jsonb END ORDER BY a.sort_order, a.id), '[]'::jsonb)
  FROM public.ticket_add_on_links l  -- issue #3281 S1
  JOIN public.ticket_add_ons a ON a.id = l.add_on_id
  WHERE l.ticket_type_id = p_ticket_type_id AND a.is_active;
$fn$;

-- The Host reads tiers straight from ticket_types, which carries no extras, so
-- event managers read a live event's extras here, keyed by ticket type id.
-- Anyone else gets an empty map rather than an error.
CREATE OR REPLACE FUNCTION public.business_event_ticket_extras(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_brand uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL
     OR public.biz_brand_effective_rank(v_brand, auth.uid()) < public.biz_role_rank('event_manager') THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(tt.id::text, public.issue_3281_tier_extras_json(tt.id))
      FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.ticket_add_on_links l  -- issue #3281 S1
                     JOIN public.ticket_add_ons a ON a.id = l.add_on_id
                    WHERE l.ticket_type_id = tt.id AND a.is_active)
  ), '{}'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_event_ticket_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_ticket_extras(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_sync_live_tier_extras(uuid, uuid, jsonb, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_tier_extras_json(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_assert_kept_extras_fit_tier(uuid, boolean, text[]) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
