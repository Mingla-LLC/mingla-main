-- #3872 R1 Discounts — schema, SQL-owned pricing engine, loaders and Host writers.
-- MINGLA-INVARIANT: I-3872-ENGINE-SINGLE-OWNER | issue #3872 | public.issue_3872_discount_apply is the sole discount-money arithmetic owner.
-- MINGLA-INVARIANT: I-3872-SNAPSHOT | issue #3872 | order_discount_lines rows are immutable after insert.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- DM-1 / DM-2: definitions and targets.
-- ---------------------------------------------------------------------------
CREATE TABLE public.brand_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('code','automatic','sale_price','voucher')),
  code text,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  value_type text NOT NULL CHECK (value_type IN ('percent','amount','set_price')),
  value_bps integer CHECK (value_bps BETWEEN 1 AND 10000),
  value_minor integer CHECK (value_minor > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  scope_kind text NOT NULL CHECK (scope_kind IN ('brand','listing_kinds','listings','items')),
  combines_with text NOT NULL DEFAULT 'automatic_only'
    CHECK (combines_with IN ('none','automatic_only','any')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  schedule jsonb,
  ends_after_count integer CHECK (ends_after_count > 0),
  max_total_uses integer CHECK (max_total_uses > 0),
  max_uses_per_buyer integer CHECK (max_uses_per_buyer > 0),
  min_subtotal_minor integer CHECK (min_subtotal_minor > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','ended')),
  ended_reason text CHECK (ended_reason IN ('host','window','count','uses')),
  needs_attention text CHECK (needs_attention IN ('target_deleted','currency_mismatch')),
  source text NOT NULL DEFAULT 'host' CHECK (source IN ('host','ari','gig','referral')),
  source_ref uuid,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  notified_limit80_at timestamptz,
  notified_ended_at timestamptz,
  notified_attention_at timestamptz,
  CONSTRAINT bd_value_shape CHECK (
    (value_type = 'percent' AND value_bps IS NOT NULL AND value_minor IS NULL AND currency IS NULL)
    OR (value_type IN ('amount','set_price') AND value_minor IS NOT NULL AND value_bps IS NULL AND currency IS NOT NULL)
  ),
  CONSTRAINT bd_code_shape CHECK (
    (kind IN ('code','voucher') AND code IS NOT NULL AND code ~ '^[A-Z0-9]{4,16}$')
    OR (kind IN ('automatic','sale_price') AND code IS NULL)
  ),
  CONSTRAINT bd_count_end CHECK (ends_after_count IS NULL OR kind IN ('automatic','sale_price')),
  CONSTRAINT bd_schedule_kind CHECK (schedule IS NULL OR kind IN ('automatic','sale_price')),
  CONSTRAINT bd_schedule_shape CHECK (schedule IS NULL OR (
    jsonb_typeof(schedule->'days') = 'array'
    AND jsonb_array_length(schedule->'days') BETWEEN 1 AND 7
    AND schedule->>'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND schedule->>'to' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND schedule->>'from' < schedule->>'to'
  )),
  CONSTRAINT bd_window CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT bd_set_price_items CHECK (value_type <> 'set_price' OR scope_kind = 'items'),
  CONSTRAINT bd_sale_price_items CHECK (kind <> 'sale_price' OR scope_kind = 'items'),
  CONSTRAINT bd_ended_reason CHECK ((status = 'ended') = (ended_reason IS NOT NULL))
);

CREATE UNIQUE INDEX brand_discounts_code_uq ON public.brand_discounts (brand_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL AND status <> 'ended';
CREATE INDEX brand_discounts_live_idx ON public.brand_discounts (brand_id, status, starts_at)
  WHERE deleted_at IS NULL;

CREATE TABLE public.brand_discount_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id uuid NOT NULL REFERENCES public.brand_discounts(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN
    ('listing_kind','event','ticket_type','venue_menu','menu_item','venue_deposit')),
  listing_kind text CHECK (listing_kind IN
    ('event','experience','trip','venue_order','reservation_deposit')),
  target_id uuid,
  orphaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bdt_shape CHECK (
    (target_kind = 'listing_kind' AND listing_kind IS NOT NULL AND target_id IS NULL)
    OR (target_kind <> 'listing_kind' AND listing_kind IS NULL AND target_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX bdt_listing_kind_uq ON public.brand_discount_targets (discount_id, listing_kind)
  WHERE target_kind = 'listing_kind';
CREATE UNIQUE INDEX bdt_target_uq ON public.brand_discount_targets (discount_id, target_kind, target_id)
  WHERE target_kind <> 'listing_kind';
CREATE INDEX bdt_lookup_idx ON public.brand_discount_targets (target_kind, target_id)
  WHERE orphaned_at IS NULL;

CREATE OR REPLACE FUNCTION public.issue_3872_bd_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER bd_touch BEFORE UPDATE ON public.brand_discounts
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_bd_touch();

CREATE OR REPLACE FUNCTION public.issue_3872_target_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  v_discount public.brand_discounts%ROWTYPE;
BEGIN
  SELECT * INTO v_discount FROM public.brand_discounts WHERE id = NEW.discount_id;
  IF v_discount.value_type = 'set_price' OR v_discount.kind = 'sale_price' THEN
    IF NEW.target_kind NOT IN ('ticket_type','menu_item','venue_deposit') THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.brand_discount_targets
      WHERE discount_id = NEW.discount_id AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
  END IF;

  IF v_discount.kind = 'sale_price' AND EXISTS (
    SELECT 1
    FROM public.brand_discount_targets t
    JOIN public.brand_discounts d ON d.id = t.discount_id
    WHERE t.discount_id <> NEW.discount_id
      AND t.target_kind = NEW.target_kind
      AND t.target_id = NEW.target_id
      AND t.orphaned_at IS NULL
      AND d.brand_id = v_discount.brand_id
      AND d.kind = 'sale_price'
      AND d.status IN ('active','paused')
      AND d.deleted_at IS NULL
      AND tstzrange(d.starts_at, d.ends_at, '[)') &&
          tstzrange(v_discount.starts_at, v_discount.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'sale_price_overlap';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER bd_set_price_single_target
BEFORE INSERT OR UPDATE ON public.brand_discount_targets
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_target_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_orphan_targets(p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ids uuid[];
BEGIN
  WITH changed AS (
    UPDATE public.brand_discount_targets
    SET orphaned_at = COALESCE(orphaned_at, now())
    WHERE target_kind = p_kind AND target_id = p_id AND orphaned_at IS NULL
    RETURNING discount_id
  )
  SELECT array_agg(discount_id) INTO v_ids FROM changed;

  IF v_ids IS NOT NULL THEN
    UPDATE public.brand_discounts
    SET needs_attention = 'target_deleted'
    WHERE id = ANY(v_ids) AND deleted_at IS NULL;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_orphan_targets(text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_orphan_targets(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_orphan_target_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.issue_3872_orphan_targets(TG_ARGV[0], OLD.id);
    RETURN OLD;
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM public.issue_3872_orphan_targets(TG_ARGV[0], NEW.id);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER issue_3872_event_orphan
AFTER UPDATE OF deleted_at OR DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_orphan_target_trigger('event');
CREATE TRIGGER issue_3872_ticket_type_orphan
AFTER UPDATE OF deleted_at OR DELETE ON public.ticket_types
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_orphan_target_trigger('ticket_type');
CREATE TRIGGER issue_3872_menu_item_orphan
AFTER DELETE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_orphan_target_trigger('menu_item');
CREATE TRIGGER issue_3872_venue_orphan
AFTER DELETE ON public.venue_listings
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_orphan_target_trigger('venue_menu');

-- ---------------------------------------------------------------------------
-- DM-3 / DM-6: allow switches and explicit snapshot columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN discounts_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE public.ticket_types ADD COLUMN discounts_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE public.menu_items ADD COLUMN discounts_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE public.venue_reservation_settings ADD COLUMN discounts_allowed boolean NOT NULL DEFAULT true;

ALTER TABLE public.ticket_checkout_session_items
  ADD COLUMN list_unit_price_cents integer,
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN units_counted integer,
  ADD COLUMN applied_discounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT tcsi_list_ge_net CHECK (
    list_unit_price_cents IS NULL OR list_unit_price_cents >= unit_price_cents
  );

ALTER TABLE public.order_line_items
  ADD COLUMN list_unit_price_cents integer,
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN checkout_session_item_id uuid,
  ADD CONSTRAINT ol_list_ge_net CHECK (
    list_unit_price_cents IS NULL OR list_unit_price_cents >= unit_price_cents
  );

ALTER TABLE public.venue_orders
  ADD COLUMN list_subtotal_cents integer,
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN discount_snapshot jsonb,
  ADD CONSTRAINT vo_list_identity CHECK (
    list_subtotal_cents IS NULL OR subtotal_cents = list_subtotal_cents - discount_cents
  );
ALTER TABLE public.venue_order_items
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);

ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN deposit_list_cents integer,
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  ADD COLUMN discount_code text,
  ADD COLUMN discount_snapshot jsonb,
  ADD CONSTRAINT rcs_deposit_identity CHECK (
    deposit_list_cents IS NULL OR deposit_list_cents >= discount_cents
  );

CREATE OR REPLACE FUNCTION public.issue_3872_allow_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_setting('mingla.discounts_allowed_writer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'discounts_allowed_writer_required';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_events_allow_guard BEFORE UPDATE OF discounts_allowed ON public.events
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_allow_guard();
CREATE TRIGGER issue_3872_ticket_types_allow_guard BEFORE UPDATE OF discounts_allowed ON public.ticket_types
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_allow_guard();
CREATE TRIGGER issue_3872_menu_items_allow_guard BEFORE UPDATE OF discounts_allowed ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_allow_guard();
CREATE TRIGGER issue_3872_deposits_allow_guard BEFORE UPDATE OF discounts_allowed ON public.venue_reservation_settings
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_allow_guard();

CREATE OR REPLACE FUNCTION public.biz_set_discounts_allowed(
  p_kind text, p_ids uuid[], p_allowed boolean
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $fn$
DECLARE v_count integer := 0; v_bad boolean := false;
BEGIN
  IF p_kind NOT IN ('event','ticket_type','menu_item','venue_deposit')
     OR COALESCE(array_length(p_ids,1),0) = 0 THEN
    RAISE EXCEPTION 'discount_scope_invalid';
  END IF;

  IF COALESCE(auth.role(),'') <> 'service_role' THEN
    IF p_kind = 'event' THEN
      SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = ANY(p_ids)
        AND COALESCE(public.biz_brand_effective_rank(e.brand_id,auth.uid()),0) < 30)
        INTO v_bad;
    ELSIF p_kind = 'ticket_type' THEN
      SELECT EXISTS (SELECT 1 FROM public.ticket_types t JOIN public.events e ON e.id=t.event_id
        WHERE t.id = ANY(p_ids)
          AND COALESCE(public.biz_brand_effective_rank(e.brand_id,auth.uid()),0) < 30)
        INTO v_bad;
    ELSIF p_kind = 'menu_item' THEN
      SELECT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = ANY(p_ids)
        AND COALESCE(public.biz_brand_effective_rank(m.brand_id,auth.uid()),0) < 30)
        INTO v_bad;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = ANY(p_ids)
        AND COALESCE(public.biz_brand_effective_rank(b.id,auth.uid()),0) < 30)
        INTO v_bad;
    END IF;
    IF v_bad THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  END IF;

  PERFORM set_config('mingla.discounts_allowed_writer','on',true);
  IF p_kind = 'event' THEN
    UPDATE public.events SET discounts_allowed=p_allowed WHERE id=ANY(p_ids);
  ELSIF p_kind = 'ticket_type' THEN
    UPDATE public.ticket_types SET discounts_allowed=p_allowed WHERE id=ANY(p_ids);
  ELSIF p_kind = 'menu_item' THEN
    UPDATE public.menu_items SET discounts_allowed=p_allowed WHERE id=ANY(p_ids);
  ELSE
    INSERT INTO public.venue_reservation_settings(brand_id,reservations_enabled,discounts_allowed)
    SELECT id,false,p_allowed FROM unnest(p_ids) AS id
    ON CONFLICT (brand_id) DO UPDATE SET discounts_allowed=EXCLUDED.discounts_allowed;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_set_discounts_allowed(text,uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_set_discounts_allowed(text,uuid[],boolean)
  TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- DM-4 / DM-5: live uses and immutable discount snapshots.
-- ---------------------------------------------------------------------------
CREATE TABLE public.discount_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id uuid NOT NULL REFERENCES public.brand_discounts(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL,
  checkout_kind text NOT NULL CHECK (checkout_kind IN ('ticket','venue_order','reservation_deposit')),
  checkout_ref_id uuid NOT NULL,
  order_id uuid,
  buyer_user_id uuid,
  buyer_email_norm text,
  buyer_phone_e164 text,
  status text NOT NULL CHECK (status IN ('reserved','consumed','released')),
  units integer NOT NULL CHECK (units >= 0),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  channel text NOT NULL DEFAULT 'online' CHECK (channel IN ('online','staff')),
  CONSTRAINT du_identity CHECK (
    channel='staff' OR buyer_email_norm IS NOT NULL OR buyer_phone_e164 IS NOT NULL OR buyer_user_id IS NOT NULL
  ),
  CONSTRAINT du_staff_shape CHECK (channel='online' OR checkout_kind='venue_order'),
  CONSTRAINT du_status_shape CHECK (
    (status='reserved' AND consumed_at IS NULL AND released_at IS NULL)
    OR (status='consumed' AND consumed_at IS NOT NULL AND released_at IS NULL)
    OR (status='released' AND released_at IS NOT NULL AND consumed_at IS NULL)
  ),
  UNIQUE(discount_id,checkout_kind,checkout_ref_id)
);
CREATE INDEX du_discount_live_idx ON public.discount_uses(discount_id,status,expires_at);
CREATE INDEX du_email_idx ON public.discount_uses(discount_id,buyer_email_norm)
  WHERE buyer_email_norm IS NOT NULL;
CREATE INDEX du_phone_idx ON public.discount_uses(discount_id,buyer_phone_e164)
  WHERE buyer_phone_e164 IS NOT NULL;
CREATE INDEX du_user_idx ON public.discount_uses(discount_id,buyer_user_id)
  WHERE buyer_user_id IS NOT NULL;

CREATE TABLE public.order_discount_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_kind text NOT NULL CHECK (order_kind IN ('ticket','venue_order','reservation_deposit')),
  order_id uuid NOT NULL,
  line_ref text,
  discount_id uuid NOT NULL REFERENCES public.brand_discounts(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL,
  kind text NOT NULL,
  code_snapshot text,
  name_snapshot text NOT NULL,
  value_type text NOT NULL,
  value_bps integer,
  value_minor integer,
  units integer NOT NULL CHECK (units > 0),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  applied_seq smallint NOT NULL CHECK (applied_seq >= 1),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_kind,order_id,line_ref,discount_id)
);
CREATE UNIQUE INDEX odl_null_line_uq ON public.order_discount_lines(order_kind,order_id,discount_id)
  WHERE line_ref IS NULL;
CREATE INDEX odl_order_idx ON public.order_discount_lines(order_kind,order_id);
CREATE INDEX odl_discount_idx ON public.order_discount_lines(discount_id,created_at);

CREATE OR REPLACE FUNCTION public.issue_3872_odl_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'order_discount_lines_immutable'; END;
$fn$;
CREATE TRIGGER odl_immutable BEFORE UPDATE OR DELETE ON public.order_discount_lines
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_odl_immutable();

CREATE OR REPLACE FUNCTION public.issue_3872_discount_use_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'ticket_checkout_sessions' THEN
    IF NEW.status IN ('expired','failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='ticket' AND checkout_ref_id=NEW.id AND status='reserved';
    END IF;
  ELSIF TG_TABLE_NAME = 'venue_orders' THEN
    IF NEW.payment_status='paid' AND (TG_OP='INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
      UPDATE public.discount_uses SET status='consumed',consumed_at=now(),order_id=NEW.id
      WHERE checkout_kind='venue_order' AND checkout_ref_id=NEW.id AND status='reserved';
    ELSIF NEW.payment_status IN ('failed','cancelled')
      AND (TG_OP='INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status) THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='venue_order' AND checkout_ref_id=NEW.id AND status='reserved';
    END IF;
  ELSE
    IF NEW.status='completed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      UPDATE public.discount_uses SET status='consumed',consumed_at=now(),order_id=NEW.reservation_id
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=NEW.id AND status='reserved';
    ELSIF NEW.status IN ('expired','failed')
      AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      UPDATE public.discount_uses SET status='released',released_at=now()
      WHERE checkout_kind='reservation_deposit' AND checkout_ref_id=NEW.id AND status='reserved';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_ticket_use_release AFTER UPDATE OF status ON public.ticket_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_discount_use_transition();
CREATE TRIGGER issue_3872_venue_use_transition AFTER INSERT OR UPDATE OF payment_status ON public.venue_orders
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_discount_use_transition();
CREATE TRIGGER issue_3872_deposit_use_transition AFTER INSERT OR UPDATE OF status ON public.reservation_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.issue_3872_discount_use_transition();

-- ---------------------------------------------------------------------------
-- DM-7: rollout and code-attempt budget.
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('discounts_enabled',false,'#3872 R1 global kill switch')
ON CONFLICT(flag_key) DO UPDATE SET description=EXCLUDED.description;

CREATE TABLE public.program_brand_rollouts (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  program text NOT NULL CHECK (program IN ('discounts','referrals','creator_gigs')),
  phase text NOT NULL CHECK (phase IN ('dark','pilot','ga')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(brand_id,program)
);

CREATE TABLE public.discount_code_attempts (
  id bigserial PRIMARY KEY,
  scope_hash text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dca_scope_idx ON public.discount_code_attempts(scope_hash,failed_at);

CREATE OR REPLACE FUNCTION public.issue_3872_discounts_on(p_brand_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='discounts_enabled'),false)
    AND EXISTS (
      SELECT 1 FROM public.program_brand_rollouts
      WHERE brand_id=p_brand_id AND program='discounts' AND phase IN ('pilot','ga')
    )
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discounts_on(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discounts_on(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_code_attempt(
  p_scope_hashes text[], p_record_failure boolean
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_allowed boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_scope_hashes,'{}'::text[])) s
    WHERE (SELECT count(*) FROM public.discount_code_attempts a
           WHERE a.scope_hash=s AND a.failed_at > now()-interval '10 minutes') >= 10
  ) INTO v_allowed;
  IF p_record_failure THEN
    INSERT INTO public.discount_code_attempts(scope_hash)
    SELECT DISTINCT s FROM unnest(COALESCE(p_scope_hashes,'{}'::text[])) s
    WHERE s IS NOT NULL AND length(s)>0;
  END IF;
  RETURN v_allowed;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_code_attempt(text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_code_attempt(text[],boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- EN-0..EN-14: the one discount arithmetic owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_apply(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_currency text := upper(COALESCE(p_input->>'currency',''));
  v_at timestamptz := COALESCE((p_input->>'at')::timestamptz,now());
  v_queued boolean := COALESCE((p_input->>'queued')::boolean,false);
  v_lines jsonb := '[]'::jsonb;
  v_ranked jsonb := '[]'::jsonb;
  v_chosen jsonb := '[]'::jsonb;
  v_state jsonb := '[]'::jsonb;
  v_notices jsonb := '[]'::jsonb;
  v_code jsonb := p_input->'code';
  v_lookup text := COALESCE(p_input->>'codeLookup','none');
  v_internal boolean := COALESCE((p_input->>'_skipConflict')::boolean,false);
  v_line jsonb; v_d jsonb; v_other jsonb; v_target jsonb; v_ap jsonb;
  v_eligible boolean; v_live boolean; v_compatible boolean;
  v_qty integer; v_value_scale integer; v_count_scale integer;
  v_list integer; v_old integer; v_new integer; v_line_minor integer;
  v_score bigint; v_eligible_list bigint; v_eligible_net bigint;
  v_remaining bigint; v_required bigint; v_units integer; v_seq integer;
  v_code_reason text; v_with text; v_candidate jsonb; v_filtered jsonb;
  v_a_net bigint; v_b_net bigint; v_replaced jsonb;
  v_code_outcome jsonb := jsonb_build_object('status','none','reason',NULL,'required',NULL,'with',NULL,'replaced','[]'::jsonb);
  v_applied jsonb; v_list_total bigint; v_net_total bigint; v_digest text; v_list_digest text;
  v_score_notices jsonb;
BEGIN
  IF jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'discount_lines_invalid';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'lineRef',x->>'lineRef','itemKind',x->>'itemKind','itemId',x->'itemId',
      'listingId',x->'listingId','listingKind',x->>'listingKind',
      'listUnitMinor',GREATEST(0,COALESCE((x->>'listUnitMinor')::integer,0)),
      'qty',GREATEST(1,COALESCE((x->>'qty')::integer,1)),
      'valueScale',GREATEST(1,COALESCE((x->>'valueScale')::integer,1)),
      'countScale',GREATEST(1,COALESCE((x->>'countScale')::integer,1)),
      'allowed',COALESCE((x->>'allowed')::boolean,false),
      'tz',COALESCE(NULLIF(x->>'tz',''),'UTC')
    ) ORDER BY x->>'lineRef'
  ),'[]'::jsonb) INTO v_lines
  FROM jsonb_array_elements(p_input->'lines') x;

  -- Score live automatic discounts independently, then sort deterministically.
  FOR v_d IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'automatics','[]'::jsonb))
  LOOP
    v_live := COALESCE(v_d->>'status','active')='active'
      AND (v_d->'deletedAt' IS NULL OR v_d->>'deletedAt' IS NULL)
      AND (v_d->'needsAttention' IS NULL OR v_d->>'needsAttention' IS NULL)
      AND COALESCE((v_d->>'startsAt')::timestamptz,'-infinity'::timestamptz) <= v_at
      AND COALESCE((v_d->>'endsAt')::timestamptz,'infinity'::timestamptz) > v_at
      AND (v_d->'currency' IS NULL OR v_d->>'currency' IS NULL OR upper(v_d->>'currency')=v_currency)
      AND (NOT v_queued OR NOT COALESCE((v_d->>'limited')::boolean,false));
    IF NOT v_live OR COALESCE(v_d->>'kind','') NOT IN ('automatic','sale_price') THEN CONTINUE; END IF;

    v_eligible_list := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule' <> 'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      IF v_eligible THEN
        v_eligible_list := v_eligible_list
          + (v_line->>'listUnitMinor')::bigint*(v_line->>'qty')::integer;
      END IF;
    END LOOP;
    IF v_eligible_list < COALESCE((v_d->>'minSubtotalMinor')::bigint,0) THEN CONTINUE; END IF;

    v_score := 0;
    v_score_notices := '[]'::jsonb;
    v_remaining := CASE WHEN v_d->'remainingUnits' IS NULL OR v_d->>'remainingUnits' IS NULL
      THEN NULL ELSE (v_d->>'remainingUnits')::bigint END;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule'<>'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      IF NOT v_eligible THEN CONTINUE; END IF;
      v_qty := (v_line->>'qty')::integer;
      v_count_scale := (v_line->>'countScale')::integer;
      IF v_remaining IS NOT NULL AND v_remaining < v_qty*v_count_scale THEN
        v_score_notices := v_score_notices || jsonb_build_array(jsonb_build_object(
          'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
          'remaining',floor(v_remaining::numeric/v_count_scale)::integer
        ));
        CONTINUE;
      END IF;
      IF v_remaining IS NOT NULL THEN v_remaining := v_remaining-v_qty*v_count_scale; END IF;
      v_old := (v_line->>'listUnitMinor')::integer;
      v_value_scale := (v_line->>'valueScale')::integer;
      IF v_d->>'valueType'='set_price' THEN
        v_new := LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
      ELSIF v_d->>'valueType'='percent' THEN
        v_new := v_old-round(v_old::numeric*COALESCE((v_d->>'valueBps')::integer,0)/10000)::integer;
      ELSE
        v_new := v_old-LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
      END IF;
      v_score := v_score+GREATEST(0,v_old-v_new)*v_qty;
    END LOOP;
    IF v_score > 0 THEN
      v_ranked := v_ranked || jsonb_build_array(jsonb_build_object('d',v_d,'saving',v_score));
    ELSE
      v_notices := v_notices || v_score_notices;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'saving')::bigint DESC,
    COALESCE((x->'d'->>'createdAt')::timestamptz,'infinity'::timestamptz),x->'d'->>'id'),'[]'::jsonb)
    INTO v_ranked FROM jsonb_array_elements(v_ranked) x;

  FOR v_d IN SELECT value->'d' FROM jsonb_array_elements(v_ranked) LOOP
    v_compatible := true;
    FOR v_other IN SELECT value FROM jsonb_array_elements(v_chosen) LOOP
      IF NOT (
        ((v_d->>'combinesWith'='any') OR (v_d->>'combinesWith'='automatic_only' AND v_other->>'kind' IN ('automatic','sale_price')))
        AND ((v_other->>'combinesWith'='any') OR (v_other->>'combinesWith'='automatic_only' AND v_d->>'kind' IN ('automatic','sale_price')))
      ) THEN v_compatible:=false; EXIT; END IF;
    END LOOP;
    IF v_compatible THEN v_chosen:=v_chosen||jsonb_build_array(v_d); END IF;
  END LOOP;

  -- State starts from the sorted list lines.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    v_state := v_state || jsonb_build_array(v_line || jsonb_build_object(
      'netUnitMinor',(v_line->>'listUnitMinor')::integer,'applied','[]'::jsonb
    ));
  END LOOP;

  -- Apply the chosen automatics in type order and chosen order.
  FOR v_d IN
    SELECT c.value FROM jsonb_array_elements(v_chosen) WITH ORDINALITY c(value,ord)
    ORDER BY CASE c.value->>'valueType' WHEN 'set_price' THEN 1 WHEN 'percent' THEN 2 ELSE 3 END,c.ord
  LOOP
    v_remaining := CASE WHEN v_d->'remainingUnits' IS NULL OR v_d->>'remainingUnits' IS NULL
      THEN NULL ELSE (v_d->>'remainingUnits')::bigint END;
    v_lines := '[]'::jsonb;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
      v_eligible := COALESCE((v_line->>'allowed')::boolean,false)
        AND (v_line->>'listUnitMinor')::integer > 0
        AND (
          v_d->>'scopeKind'='brand'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_d->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId'
                   AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          )
        );
      IF v_eligible AND v_d->'schedule' IS NOT NULL AND v_d->'schedule'<>'null'::jsonb THEN
        v_eligible := EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_d->'schedule'->'days') day
          WHERE day::integer=extract(isodow FROM (v_at AT TIME ZONE (v_line->>'tz')))::integer
        ) AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') >= v_d->'schedule'->>'from'
          AND to_char(v_at AT TIME ZONE (v_line->>'tz'),'HH24:MI') < v_d->'schedule'->>'to';
      END IF;
      v_qty:=(v_line->>'qty')::integer; v_count_scale:=(v_line->>'countScale')::integer;
      IF v_eligible AND v_remaining IS NOT NULL AND v_remaining < v_qty*v_count_scale THEN
        v_notices := v_notices || jsonb_build_array(jsonb_build_object(
          'type','sale_limited','discountId',v_d->>'id','lineRef',v_line->>'lineRef',
          'remaining',floor(v_remaining::numeric/v_count_scale)::integer
        ));
        v_eligible:=false;
      END IF;
      IF v_eligible THEN
        IF v_remaining IS NOT NULL THEN v_remaining:=v_remaining-v_qty*v_count_scale; END IF;
        v_old:=(v_line->>'netUnitMinor')::integer; v_value_scale:=(v_line->>'valueScale')::integer;
        IF v_d->>'valueType'='set_price' THEN
          v_new:=LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        ELSIF v_d->>'valueType'='percent' THEN
          v_new:=v_old-round(v_old::numeric*COALESCE((v_d->>'valueBps')::integer,0)/10000)::integer;
        ELSE
          v_new:=v_old-LEAST(v_old,COALESCE((v_d->>'valueMinor')::integer,0)*v_value_scale);
        END IF;
        v_new:=GREATEST(0,v_new); v_line_minor:=(v_old-v_new)*v_qty;
        IF v_line_minor>0 THEN
          v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty*v_count_scale;
          v_ap:=jsonb_build_object(
            'discountId',v_d->>'id','kind',v_d->>'kind','name',v_d->>'name','code',v_d->'code',
            'valueType',v_d->>'valueType','valueBps',v_d->'valueBps','valueMinor',v_d->'valueMinor',
            'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq
          );
          v_line:=jsonb_set(jsonb_set(v_line,'{netUnitMinor}',to_jsonb(v_new)),'{applied}',(v_line->'applied')||jsonb_build_array(v_ap));
        END IF;
      END IF;
      v_lines:=v_lines||jsonb_build_array(v_line);
    END LOOP;
    v_state:=v_lines;
  END LOOP;

  -- Validate the code in the fixed EN-9 order.
  IF v_lookup='none' THEN v_code_reason:=NULL;
  ELSIF v_lookup<>'found' OR v_code IS NULL OR v_code='null'::jsonb THEN v_code_reason:='not_found';
  ELSIF COALESCE(v_code->>'status','active')='paused' OR (v_code->'needsAttention' IS NOT NULL AND v_code->>'needsAttention' IS NOT NULL) THEN v_code_reason:='paused';
  ELSIF COALESCE((v_code->>'startsAt')::timestamptz,'-infinity')>v_at THEN v_code_reason:='not_started';
  ELSIF COALESCE(v_code->>'status','active')='ended' OR COALESCE((v_code->>'endsAt')::timestamptz,'infinity')<=v_at THEN v_code_reason:='ended';
  ELSIF v_code->'remainingTotalUses' IS NOT NULL AND (v_code->>'remainingTotalUses')::integer<=0 THEN v_code_reason:='used_up';
  ELSIF v_code->'remainingBuyerUses' IS NOT NULL AND (v_code->>'remainingBuyerUses')::integer<=0 THEN v_code_reason:='buyer_limit';
  ELSIF v_queued THEN v_code_reason:='queue';
  ELSE
    v_eligible_net:=0; v_eligible_list:=0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) LOOP
      v_eligible:=COALESCE((v_line->>'allowed')::boolean,false) AND (v_line->>'listUnitMinor')::integer>0
        AND (v_code->>'scopeKind'='brand' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_code->'targets','[]'::jsonb)) t
          WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
             OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'listingKind' IN ('event','experience','trip'))
             OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='menu_item')
             OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='venue_deposit')
             OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
        ));
      IF v_eligible THEN
        v_eligible_list:=v_eligible_list+(v_line->>'listUnitMinor')::bigint*(v_line->>'qty')::integer;
        v_eligible_net:=v_eligible_net+(v_line->>'netUnitMinor')::bigint*(v_line->>'qty')::integer;
      END IF;
    END LOOP;
    IF v_eligible_list=0 THEN v_code_reason:='not_applicable';
    ELSIF v_eligible_net<COALESCE((v_code->>'minSubtotalMinor')::bigint,0) THEN
      v_code_reason:='min_subtotal'; v_required:=COALESCE((v_code->>'minSubtotalMinor')::bigint,0)-v_eligible_net;
    END IF;
  END IF;

  IF v_code_reason IS NOT NULL THEN
    v_code_outcome:=jsonb_build_object('status','rejected','reason',v_code_reason,'required',v_required,'with',NULL,'replaced','[]'::jsonb);
  ELSIF v_lookup='found' THEN
    v_compatible:=true; v_with:=NULL;
    FOR v_other IN SELECT value FROM jsonb_array_elements(v_chosen) LOOP
      IF NOT (
        ((v_code->>'combinesWith'='any') OR (v_code->>'combinesWith'='automatic_only' AND v_other->>'kind' IN ('automatic','sale_price')))
        AND ((v_other->>'combinesWith'='any') OR (v_other->>'combinesWith'='automatic_only' AND v_code->>'kind' IN ('automatic','sale_price')))
      ) THEN v_compatible:=false; IF v_with IS NULL THEN v_with:=v_other->>'name'; END IF; END IF;
    END LOOP;

    IF NOT v_internal THEN
      IF v_compatible THEN v_filtered:=COALESCE(p_input->'automatics','[]'::jsonb);
      ELSE
        SELECT COALESCE(jsonb_agg(a),'[]'::jsonb) INTO v_filtered
        FROM jsonb_array_elements(COALESCE(p_input->'automatics','[]'::jsonb)) a
        WHERE ((v_code->>'combinesWith'='any') OR (v_code->>'combinesWith'='automatic_only' AND a->>'kind' IN ('automatic','sale_price')))
          AND ((a->>'combinesWith'='any') OR (a->>'combinesWith'='automatic_only' AND v_code->>'kind' IN ('automatic','sale_price')));
      END IF;
      v_candidate:=public.issue_3872_discount_apply(
        jsonb_set(jsonb_set(p_input,'{automatics}',v_filtered),'{_skipConflict}','true'::jsonb)
      );
      SELECT COALESCE(sum((x->>'netUnitMinor')::bigint*(x->>'qty')::integer),0) INTO v_a_net FROM jsonb_array_elements(v_state) x;
      v_b_net:=(v_candidate->>'netSubtotalMinor')::bigint;
      IF v_compatible OR v_b_net<v_a_net THEN
        IF NOT v_compatible THEN
          SELECT COALESCE(jsonb_agg(c->>'name'),'[]'::jsonb) INTO v_replaced
          FROM jsonb_array_elements(v_chosen) c
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_filtered) f WHERE f->>'id'=c->>'id');
          v_candidate:=jsonb_set(v_candidate,'{codeOutcome,replaced}',v_replaced,true);
        END IF;
        RETURN v_candidate;
      END IF;
      v_code_outcome:=jsonb_build_object('status','rejected','reason','incompatible_better_automatic','required',NULL,'with',v_with,'replaced','[]'::jsonb);
    ELSE
      -- Internal compatible candidate: apply the code last.
      v_lines:='[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
        v_eligible:=COALESCE((v_line->>'allowed')::boolean,false) AND (v_line->>'listUnitMinor')::integer>0
          AND (v_code->>'scopeKind'='brand' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(v_code->'targets','[]'::jsonb)) t
            WHERE (t->>'targetKind'='listing_kind' AND t->>'listingKind'=v_line->>'listingKind')
               OR (t->>'targetKind'='event' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'listingKind' IN ('event','experience','trip'))
               OR (t->>'targetKind'='venue_menu' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='menu_item')
               OR (t->>'targetKind'='venue_deposit' AND t->>'targetId'=v_line->>'listingId' AND v_line->>'itemKind'='venue_deposit')
               OR (t->>'targetKind' IN ('ticket_type','menu_item') AND t->>'targetId'=v_line->>'itemId')
          ));
        IF v_eligible THEN
          v_old:=(v_line->>'netUnitMinor')::integer; v_qty:=(v_line->>'qty')::integer;
          v_value_scale:=(v_line->>'valueScale')::integer; v_count_scale:=(v_line->>'countScale')::integer;
          IF v_code->>'valueType'='set_price' THEN v_new:=LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale);
          ELSIF v_code->>'valueType'='percent' THEN v_new:=v_old-round(v_old::numeric*COALESCE((v_code->>'valueBps')::integer,0)/10000)::integer;
          ELSE v_new:=v_old-LEAST(v_old,COALESCE((v_code->>'valueMinor')::integer,0)*v_value_scale); END IF;
          v_new:=GREATEST(0,v_new); v_line_minor:=(v_old-v_new)*v_qty;
          IF v_line_minor>0 THEN
            v_seq:=jsonb_array_length(v_line->'applied')+1; v_units:=v_qty*v_count_scale;
            v_ap:=jsonb_build_object('discountId',v_code->>'id','kind',v_code->>'kind','name',v_code->>'name','code',v_code->'code',
              'valueType',v_code->>'valueType','valueBps',v_code->'valueBps','valueMinor',v_code->'valueMinor',
              'perUnitMinor',v_old-v_new,'lineMinor',v_line_minor,'units',v_units,'seq',v_seq);
            v_line:=jsonb_set(jsonb_set(v_line,'{netUnitMinor}',to_jsonb(v_new)),'{applied}',(v_line->'applied')||jsonb_build_array(v_ap));
          END IF;
        END IF;
        v_lines:=v_lines||jsonb_build_array(v_line);
      END LOOP;
      v_state:=v_lines;
      v_code_outcome:=jsonb_build_object('status','applied','reason',NULL,'required',NULL,'with',NULL,'replaced','[]'::jsonb);
    END IF;
  END IF;

  -- Finalise line totals, aggregate applied discounts, and calculate digests.
  v_lines:='[]'::jsonb;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_state) ORDER BY value->>'lineRef' LOOP
    v_list:=(v_line->>'listUnitMinor')::integer; v_new:=(v_line->>'netUnitMinor')::integer; v_qty:=(v_line->>'qty')::integer;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'lineRef',v_line->>'lineRef','listUnitMinor',v_list,'netUnitMinor',v_new,'qty',v_qty,
      'unitsCounted',v_qty*(v_line->>'countScale')::integer,
      'lineListMinor',v_list*v_qty,'lineNetMinor',v_new*v_qty,'lineDiscountMinor',(v_list-v_new)*v_qty,
      'applied',v_line->'applied'
    ));
  END LOOP;
  SELECT COALESCE(sum((x->>'lineListMinor')::bigint),0),COALESCE(sum((x->>'lineNetMinor')::bigint),0)
    INTO v_list_total,v_net_total FROM jsonb_array_elements(v_lines) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',discount_id,'kind',kind,'name',name,'code',code,
    'amountMinor',amount_minor,'units',units
  ) ORDER BY first_seq,discount_id),'[]'::jsonb) INTO v_applied
  FROM (
    SELECT a->>'discountId' discount_id,min(a->>'kind') kind,min(a->>'name') name,min(a->>'code') code,
      sum((a->>'lineMinor')::bigint) amount_minor,sum((a->>'units')::integer) units,min((a->>'seq')::integer) first_seq
    FROM jsonb_array_elements(v_lines) l CROSS JOIN LATERAL jsonb_array_elements(l->'applied') a
    GROUP BY a->>'discountId'
  ) q;
  SELECT md5(COALESCE(string_agg(
    (x->>'lineRef')||'|'||(x->>'qty')||'|'||(x->>'listUnitMinor')||'|'||(x->>'netUnitMinor')||'|'||
      COALESCE((SELECT string_agg(a->>'discountId',',' ORDER BY a->>'discountId') FROM jsonb_array_elements(x->'applied') a),''),
    ';' ORDER BY x->>'lineRef'), '')||'|code:'||(v_code_outcome->>'status')||':'||COALESCE(v_code_outcome->>'reason','-')),
    md5(COALESCE(string_agg((x->>'lineRef')||'|'||(x->>'qty')||'|'||(x->>'listUnitMinor'),';' ORDER BY x->>'lineRef'),''))
    INTO v_digest,v_list_digest FROM jsonb_array_elements(v_lines) x;
  RETURN jsonb_build_object('lines',v_lines,'listSubtotalMinor',v_list_total,'discountMinor',v_list_total-v_net_total,
    'netSubtotalMinor',v_net_total,'applied',v_applied,'codeOutcome',v_code_outcome,'notices',v_notices,
    'digest',v_digest,'listDigest',v_list_digest);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_apply(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_apply(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- EN-15: candidate loader and reservation lifecycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_candidates(
  p_brand_id uuid,p_lines jsonb,p_code text,p_buyer jsonb,p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_automatics jsonb; v_code jsonb; v_lookup text:='none'; v_email text; v_phone text; v_user uuid;
BEGIN
  v_email:=NULLIF(lower(btrim(COALESCE(p_buyer->>'email',''))),'');
  v_phone:=NULLIF(btrim(COALESCE(p_buyer->>'phone','')),'');
  v_user:=NULLIF(p_buyer->>'userId','')::uuid;
  IF p_code IS NOT NULL AND v_email IS NULL AND v_phone IS NULL AND v_user IS NULL THEN
    RAISE EXCEPTION 'discount_code_not_accepted';
  END IF;
  IF NOT public.issue_3872_discounts_on(p_brand_id) THEN
    RETURN jsonb_build_object('automatics','[]'::jsonb,'code',NULL,'codeLookup',CASE WHEN p_code IS NULL THEN 'none' ELSE 'not_found' END);
  END IF;

  SELECT COALESCE(jsonb_agg(def ORDER BY def->>'createdAt',def->>'id'),'[]'::jsonb) INTO v_automatics
  FROM (
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',d.status,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id))
                          FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(u.units) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
      'limited',(d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ) def
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind IN ('automatic','sale_price') AND d.deleted_at IS NULL
      AND (d.max_uses_per_buyer IS NULL OR v_email IS NOT NULL OR v_phone IS NOT NULL OR v_user IS NOT NULL)
  ) q;

  IF p_code IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',d.status,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id)) FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',NULL,'limited',(d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ),'found' INTO v_code,v_lookup
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind='code' AND d.code=p_code AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC LIMIT 1;
    IF NOT FOUND THEN v_lookup:='not_found'; END IF;
  END IF;
  RETURN jsonb_build_object('automatics',v_automatics,'code',v_code,'codeLookup',v_lookup);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_lock_limited_discounts(p_ids uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM 1 FROM public.brand_discounts WHERE id=ANY(COALESCE(p_ids,'{}'::uuid[]))
    AND (ends_after_count IS NOT NULL OR max_total_uses IS NOT NULL OR max_uses_per_buyer IS NOT NULL)
  ORDER BY id FOR UPDATE;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_lock_limited_discounts(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_lock_limited_discounts(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_discount_quote_lines(
  p_brand_id uuid,p_currency text,p_lines jsonb,p_code text,p_buyer jsonb,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_candidates jsonb;
BEGIN
  v_candidates:=public.issue_3872_discount_candidates(p_brand_id,p_lines,p_code,COALESCE(p_buyer,'{}'::jsonb),p_at);
  RETURN public.issue_3872_discount_apply(jsonb_build_object(
    'currency',upper(p_currency),'at',p_at,'queued',false,'lines',p_lines,
    'automatics',v_candidates->'automatics','code',v_candidates->'code','codeLookup',v_candidates->>'codeLookup'
  ));
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_quote_lines(uuid,text,jsonb,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_quote_lines(uuid,text,jsonb,text,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_reserve_discount_uses(
  p_kind text,p_ref_id uuid,p_brand_id uuid,p_currency text,p_lines jsonb,p_code text,p_buyer jsonb,
  p_expected_digest text,p_expires_at timestamptz,p_consume boolean,p_channel text DEFAULT 'online'
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_candidates jsonb; v_quote jsonb; v_ids uuid[]; v_ap jsonb; v_email text; v_phone text; v_user uuid;
BEGIN
  IF p_kind NOT IN ('ticket','venue_order','reservation_deposit') OR p_channel NOT IN ('online','staff') THEN
    RAISE EXCEPTION 'discount_reservation_invalid';
  END IF;
  v_candidates:=public.issue_3872_discount_candidates(p_brand_id,p_lines,p_code,COALESCE(p_buyer,'{}'::jsonb),now());
  SELECT COALESCE(array_agg((x->>'id')::uuid),'{}'::uuid[]) INTO v_ids FROM (
    SELECT value x FROM jsonb_array_elements(v_candidates->'automatics')
    UNION ALL SELECT v_candidates->'code' WHERE v_candidates->'code' IS NOT NULL
  ) q;
  PERFORM public.issue_3872_lock_limited_discounts(v_ids);
  v_candidates:=public.issue_3872_discount_candidates(p_brand_id,p_lines,p_code,COALESCE(p_buyer,'{}'::jsonb),now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',upper(p_currency),'at',now(),'queued',(p_expires_at='infinity'::timestamptz),'lines',p_lines,
    'automatics',v_candidates->'automatics','code',v_candidates->'code','codeLookup',v_candidates->>'codeLookup'
  ));
  IF p_expected_digest IS NOT NULL AND p_expected_digest<>v_quote->>'digest' THEN
    RETURN jsonb_build_object('ok',false,'quote',v_quote);
  END IF;
  v_email:=NULLIF(lower(btrim(COALESCE(p_buyer->>'email',''))),'');
  v_phone:=NULLIF(btrim(COALESCE(p_buyer->>'phone','')),'');
  v_user:=NULLIF(p_buyer->>'userId','')::uuid;
  FOR v_ap IN SELECT value FROM jsonb_array_elements(v_quote->'applied') LOOP
    INSERT INTO public.discount_uses(discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_user_id,buyer_email_norm,buyer_phone_e164,status,units,amount_minor,expires_at,consumed_at,channel)
    VALUES((v_ap->>'discountId')::uuid,p_brand_id,p_kind,p_ref_id,v_user,v_email,v_phone,
      CASE WHEN p_consume THEN 'consumed' ELSE 'reserved' END,(v_ap->>'units')::integer,(v_ap->>'amountMinor')::integer,p_expires_at,
      CASE WHEN p_consume THEN now() ELSE NULL END,p_channel)
    ON CONFLICT(discount_id,checkout_kind,checkout_ref_id) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'quote',v_quote);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_reserve_discount_uses(text,uuid,uuid,text,jsonb,text,jsonb,text,timestamptz,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_reserve_discount_uses(text,uuid,uuid,text,jsonb,text,jsonb,text,timestamptz,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_release_discount_uses(p_kind text,p_ref_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE public.discount_uses SET status='released',released_at=now()
  WHERE checkout_kind=p_kind AND checkout_ref_id=p_ref_id AND status='reserved';
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_release_discount_uses(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_release_discount_uses(text,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Host write seam and editor preview.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_upsert_discount(p_actor uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public,auth,pg_temp AS $fn$
DECLARE v_id uuid; v_brand uuid; v_kind text; v_rank integer; v_row public.brand_discounts%ROWTYPE; v_t jsonb; v_target_brand uuid;
BEGIN
  v_id:=NULLIF(p_payload->>'id','')::uuid; v_brand:=(p_payload->>'brandId')::uuid;
  IF v_id IS NOT NULL THEN SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id FOR UPDATE; v_brand:=v_row.brand_id; END IF;
  v_kind:=COALESCE(p_payload->>'kind',v_row.kind);
  v_rank:=COALESCE(public.biz_brand_effective_rank(v_brand,p_actor),0);
  IF v_rank < (CASE WHEN v_kind='code' THEN 20 ELSE 30 END) THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  IF v_kind='voucher' THEN RAISE EXCEPTION 'kind_not_available'; END IF;
  IF p_action='create' THEN
    IF v_kind IN ('automatic','sale_price') AND (SELECT count(*) FROM public.brand_discounts WHERE brand_id=v_brand AND kind IN ('automatic','sale_price') AND status='active' AND deleted_at IS NULL)>=20 THEN RAISE EXCEPTION 'too_many_automatics'; END IF;
    INSERT INTO public.brand_discounts(brand_id,kind,code,name,value_type,value_bps,value_minor,currency,scope_kind,combines_with,starts_at,ends_at,schedule,ends_after_count,max_total_uses,max_uses_per_buyer,min_subtotal_minor,status,source,source_ref,created_by)
    VALUES(v_brand,v_kind,NULLIF(upper(regexp_replace(btrim(COALESCE(p_payload->>'code','')),'[\s-]','','g')),''),p_payload->>'name',p_payload->>'valueType',
      NULLIF(p_payload->>'valueBps','')::integer,NULLIF(p_payload->>'valueMinor','')::integer,
      CASE WHEN p_payload->>'valueType'='percent' THEN NULL ELSE upper((SELECT pricing_currency FROM public.brands WHERE id=v_brand)) END,
      p_payload->>'scopeKind',COALESCE(
        p_payload->>'combinesWith',
        CASE WHEN v_kind IN ('automatic','sale_price') THEN 'any' ELSE 'automatic_only' END
      ),COALESCE((p_payload->>'startsAt')::timestamptz,now()),NULLIF(p_payload->>'endsAt','')::timestamptz,p_payload->'schedule',
      NULLIF(p_payload->>'endsAfterCount','')::integer,NULLIF(p_payload->>'maxTotalUses','')::integer,NULLIF(p_payload->>'maxUsesPerBuyer','')::integer,NULLIF(p_payload->>'minSubtotalMinor','')::integer,
      COALESCE(p_payload->>'status','active'),COALESCE(p_payload->>'source','host'),NULLIF(p_payload->>'sourceRef','')::uuid,p_actor)
    RETURNING * INTO v_row; v_id:=v_row.id;
  ELSIF p_action='update' THEN
    IF v_id IS NULL OR v_row.id IS NULL THEN RAISE EXCEPTION 'discount_not_found'; END IF;
    IF v_row.version<>COALESCE((p_payload->>'version')::integer,-1) THEN RAISE EXCEPTION 'version_conflict'; END IF;
    UPDATE public.brand_discounts SET name=COALESCE(p_payload->>'name',name),combines_with=COALESCE(p_payload->>'combinesWith',combines_with),
      starts_at=COALESCE((p_payload->>'startsAt')::timestamptz,starts_at),ends_at=CASE WHEN p_payload?'endsAt' THEN NULLIF(p_payload->>'endsAt','')::timestamptz ELSE ends_at END,
      schedule=CASE WHEN p_payload?'schedule' THEN p_payload->'schedule' ELSE schedule END,
      max_total_uses=CASE WHEN p_payload?'maxTotalUses' THEN NULLIF(p_payload->>'maxTotalUses','')::integer ELSE max_total_uses END,
      max_uses_per_buyer=CASE WHEN p_payload?'maxUsesPerBuyer' THEN NULLIF(p_payload->>'maxUsesPerBuyer','')::integer ELSE max_uses_per_buyer END,
      min_subtotal_minor=CASE WHEN p_payload?'minSubtotalMinor' THEN NULLIF(p_payload->>'minSubtotalMinor','')::integer ELSE min_subtotal_minor END
    WHERE id=v_id RETURNING * INTO v_row;
    DELETE FROM public.brand_discount_targets WHERE discount_id=v_id;
  ELSIF p_action IN ('pause','resume','end') THEN
    IF v_id IS NULL OR v_row.id IS NULL THEN RAISE EXCEPTION 'discount_not_found'; END IF;
    UPDATE public.brand_discounts SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active' ELSE 'ended' END,
      ended_reason=CASE WHEN p_action='end' THEN 'host' ELSE NULL END WHERE id=v_id RETURNING * INTO v_row;
  ELSIF p_action='delete_draft' THEN
    IF v_row.status<>'draft' OR (v_row.created_by<>p_actor AND v_rank<50) THEN RAISE EXCEPTION 'delete_not_allowed'; END IF;
    UPDATE public.brand_discounts SET deleted_at=now() WHERE id=v_id RETURNING * INTO v_row;
  ELSE RAISE EXCEPTION 'discount_action_invalid'; END IF;

  IF p_action IN ('create','update') THEN
    FOR v_t IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'targets','[]'::jsonb)) LOOP
      IF v_t->>'targetKind'='event' THEN SELECT brand_id INTO v_target_brand FROM public.events WHERE id=(v_t->>'targetId')::uuid AND event_type<>'rsvp' AND deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='ticket_type' THEN SELECT e.brand_id INTO v_target_brand FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id WHERE tt.id=(v_t->>'targetId')::uuid AND tt.deleted_at IS NULL AND e.deleted_at IS NULL;
      ELSIF v_t->>'targetKind'='menu_item' THEN SELECT brand_id INTO v_target_brand FROM public.menu_items WHERE id=(v_t->>'targetId')::uuid;
      ELSIF v_t->>'targetKind' IN ('venue_menu','venue_deposit') THEN SELECT brand_id INTO v_target_brand FROM public.venue_listings WHERE id=(v_t->>'targetId')::uuid;
      ELSE v_target_brand:=v_brand; END IF;
      IF v_target_brand IS NULL THEN RAISE EXCEPTION 'target_not_discountable'; END IF;
      IF v_target_brand<>v_brand THEN RAISE EXCEPTION 'target_not_in_brand'; END IF;
      INSERT INTO public.brand_discount_targets(discount_id,target_kind,listing_kind,target_id)
      VALUES(v_id,v_t->>'targetKind',NULLIF(v_t->>'listingKind',''),NULLIF(v_t->>'targetId','')::uuid);
    END LOOP;
    IF (v_row.value_type='set_price' OR v_row.kind='sale_price') AND (SELECT count(*) FROM public.brand_discount_targets WHERE discount_id=v_id)<>1 THEN RAISE EXCEPTION 'set_price_needs_one_item'; END IF;
  END IF;
  SELECT * INTO v_row FROM public.brand_discounts WHERE id=v_id;
  RETURN to_jsonb(v_row)||jsonb_build_object('targets',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.brand_discount_targets t WHERE t.discount_id=v_id),'[]'::jsonb));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'code_taken';
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_upsert_discount(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_discount_preview(p_brand_id uuid,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_rank integer; v_lines jsonb; v_def jsonb; v_quote jsonb;
BEGIN
  v_rank:=COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0);
  IF v_rank<20 AND COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  SELECT COALESCE(jsonb_agg(line ORDER BY line->>'lineRef'),'[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object('lineRef',tt.id::text,'itemKind','ticket_type','itemId',tt.id,'listingId',e.id,
      'listingKind',e.event_type,'listUnitMinor',tt.price_cents,'qty',1,'valueScale',1,'countScale',1,
      'allowed',e.discounts_allowed AND tt.discounts_allowed AND NOT COALESCE(tt.is_free,false),'tz',COALESCE(e.timezone,'UTC')) line
    FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id
    WHERE e.brand_id=p_brand_id AND e.deleted_at IS NULL AND tt.deleted_at IS NULL AND tt.price_cents>0
    ORDER BY tt.created_at LIMIT 5
  ) q;
  v_def:=p_draft||jsonb_build_object('id',COALESCE(p_draft->>'id',gen_random_uuid()::text),'createdAt',now(),'status','active','deletedAt',NULL,'needsAttention',NULL,'limited',false,'remainingUnits',NULL,'remainingTotalUses',NULL,'remainingBuyerUses',NULL);
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object('currency',upper((SELECT pricing_currency FROM public.brands WHERE id=p_brand_id)),
    'at',now(),'queued',false,'lines',v_lines,'automatics',CASE WHEN v_def->>'kind'='code' THEN '[]'::jsonb ELSE jsonb_build_array(v_def) END,
    'code',CASE WHEN v_def->>'kind'='code' THEN v_def ELSE NULL END,'codeLookup',CASE WHEN v_def->>'kind'='code' THEN 'found' ELSE 'none' END));
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemName',tt.name,'listUnitMinor',(l->>'listUnitMinor')::integer,'netUnitMinor',(l->>'netUnitMinor')::integer,
    'allInListCents',public.compute_all_in_cents((l->>'listUnitMinor')::integer,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),COALESCE(e.pass_service_fee,b.default_pass_service_fee),(SELECT effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id))),
    'allInNetCents',public.compute_all_in_cents((l->>'netUnitMinor')::integer,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),COALESCE(e.pass_service_fee,b.default_pass_service_fee),(SELECT effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id)))
  )),'[]'::jsonb) FROM jsonb_array_elements(v_quote->'lines') l JOIN public.ticket_types tt ON tt.id=(l->>'lineRef')::uuid JOIN public.events e ON e.id=tt.event_id JOIN public.brands b ON b.id=e.brand_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_preview(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_preview(uuid,jsonb) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- DM-8: RLS and least privilege.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_discount_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_discount_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_brand_rollouts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.brand_discounts,public.brand_discount_targets,public.discount_uses,
  public.order_discount_lines,public.discount_code_attempts,public.program_brand_rollouts
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.brand_discounts,public.brand_discount_targets TO authenticated;
GRANT ALL ON public.brand_discounts,public.brand_discount_targets,public.discount_uses,
  public.order_discount_lines,public.discount_code_attempts,public.program_brand_rollouts TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.discount_code_attempts_id_seq TO service_role;

CREATE POLICY bd_read ON public.brand_discounts FOR SELECT TO authenticated
USING (deleted_at IS NULL AND COALESCE(public.biz_brand_effective_rank(brand_id,auth.uid()),0)>=20);
CREATE POLICY bdt_read ON public.brand_discount_targets FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.brand_discounts d WHERE d.id=discount_id AND d.deleted_at IS NULL
  AND COALESCE(public.biz_brand_effective_rank(d.brand_id,auth.uid()),0)>=20));

NOTIFY pgrst,'reload schema';
COMMIT;
