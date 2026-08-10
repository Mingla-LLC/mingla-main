-- ===========================================================================
-- Issue #1790 — Phase 2 of #1767: the venue_orders money rail (DARK).
-- Consumes SPEC #1788 P-1, P-2, P-2a, P-3, P-3a, P-3b, P-3c, P-4, P-4a, P-4b,
-- P-5, P-17..P-21, P-23, P-56. Orchestrator rulings OQ-1 (session table KEPT),
-- OQ-3 (nullable per-item tax_code seam, NO code value chosen here), OQ-5
-- (10 orders/spot/minute, fail-OPEN).
--
-- WHAT THIS IS: a NET-NEW order family. `public.orders` /
-- `public.order_line_items` / `ticket_types` / `tickets` are NOT touched by any
-- statement in this file — `orders.event_id` is NOT NULL
-- (20260505000000_baseline_squash_orch_0729.sql:8527) and
-- `order_line_items.ticket_type_id` is NOT NULL (:8509) with an FK RESTRICT to
-- `ticket_types`, so bending them would mean DROP NOT NULL on the two hottest
-- live money tables. The thrice-proven "thin new table, shared rail" pattern is
-- operator-LOCKED (20261012000002_orch_1148_2_2_reservation_checkout_sessions.sql:4-6)
-- and is what this file follows. Rollback is "stop writing rows".
--
-- ORDERING DEPENDENCY (stated, not hidden): this migration FKs
-- `public.qr_spots` and `public.menu_modifiers`, both created by #1789 (Phase 1,
-- SPEC P-7 / P-11). It MUST apply after #1789's migration. Its filename sorts
-- after any 2027030x Phase-1 stamp.
--
-- THREE PROMISES MADE STRUCTURAL RATHER THAN TESTED
--   1. `fee_basis_cents` is GENERATED from (subtotal + service charge), so a tip
--      cannot enter the number Mingla's take-rate multiplies. Not "untested" —
--      unwritable. (I-PROPOSED-1767-NO-CUT-OF-A-TIP)
--   2. An order cannot be `acknowledged` without a human user id on the row.
--      (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP)
--   3. A `venue_collected` order cannot carry a provider, a fee, or a payout row.
--      (I-PROPOSED-1767-VENUE-COLLECTED-IS-NOT-MINGLA-MONEY)
--
-- DARK: no venue has ordering enabled; no UI reads or writes these tables in
-- this PR. Apply via the Supabase Management-API surgical lane from MERGED main
-- (a blind `supabase db push` is UNSAFE — migration-history drift).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- P-1 / P-2 — the SITTING. Three tables, not two: four design facts (spend per
-- COVER divides the session total; a staff tab needs one lock target and one
-- settlement decision; party size is asked ONCE; the tip choice is a property of
-- the sitting) have nowhere else to live without denormalising onto every round.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_order_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  venue_id           uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  -- WHERE the sitting is. NULL is a FIRST-CLASS state = counter pickup (D-3a).
  qr_spot_id         uuid NULL REFERENCES public.qr_spots(id) ON DELETE SET NULL,
  -- The intelligence link. NEVER inferred from time/table proximity
  -- (I-PROPOSED-1767-MEASURED-MEANS-MEASURED). No reservation_id => not Tier A.
  reservation_id     uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  -- The guest's own estimate, asked ONCE, optional. A metric input, never a
  -- payment mechanic.
  party_size_claimed int  NULL CHECK (party_size_claimed IS NULL
                                      OR (party_size_claimed >= 1 AND party_size_claimed <= 100)),
  currency           text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  -- Tip choice, remembered for the sitting (OQ-2). NULL = not yet asked.
  tip_bps_choice     int  NULL CHECK (tip_bps_choice IS NULL
                                      OR (tip_bps_choice >= 0 AND tip_bps_choice <= 10000)),
  -- Tabs are STAFF-OPENED ONLY. 'none' = pay-per-round, the guest default.
  tab_state          text NOT NULL DEFAULT 'none'
                       CHECK (tab_state IN ('none','open','settling','closed','voided')),
  opened_by_user_id  uuid NULL,                       -- soft ref (auth user); survives departure
  settlement_method  text NULL
                       CHECK (settlement_method IS NULL OR settlement_method IN
                              ('per_round','bill_to_phone','venue_collected')),
  closed_by_user_id  uuid NULL,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  last_order_at      timestamptz NULL,
  closed_at          timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A tab exists only because a human opened it. No staff id => no tab.
  CONSTRAINT venue_order_sessions_tab_is_staff_opened CHECK (
    (tab_state = 'none'  AND opened_by_user_id IS NULL)
    OR (tab_state <> 'none' AND opened_by_user_id IS NOT NULL)),
  -- A closed tab names how it settled and when; an open one names neither.
  CONSTRAINT venue_order_sessions_close_shape CHECK (
    (tab_state IN ('none','open','settling') AND closed_at IS NULL AND closed_by_user_id IS NULL)
    OR (tab_state IN ('closed','voided')     AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)),
  CONSTRAINT venue_order_sessions_settled_names_method CHECK (
    tab_state <> 'closed' OR settlement_method IS NOT NULL)
);

CREATE INDEX venue_order_sessions_venue_opened_idx
  ON public.venue_order_sessions (venue_id, opened_at DESC);
CREATE INDEX venue_order_sessions_brand_venue_idx
  ON public.venue_order_sessions (brand_id, venue_id, opened_at DESC);
CREATE INDEX venue_order_sessions_open_tabs_idx
  ON public.venue_order_sessions (venue_id, tab_state) WHERE tab_state IN ('open','settling');
CREATE INDEX venue_order_sessions_reservation_idx
  ON public.venue_order_sessions (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX venue_order_sessions_spot_idx
  ON public.venue_order_sessions (qr_spot_id) WHERE qr_spot_id IS NOT NULL;

COMMENT ON TABLE public.venue_order_sessions IS
  'SPEC #1788 P-2 (#1767 Phase 2) — one SITTING at a venue. Its total is the '
  'spend-per-cover denominator; its reservation_id is the ONLY legitimate cover '
  'source (I-PROPOSED-1767-MEASURED-MEANS-MEASURED). Tabs are staff-opened only.';

-- ---------------------------------------------------------------------------
-- P-3 — the ORDER. Every intelligence column is bound in NOW (P-56): retrofitting
-- reservation_id / session_id later makes every "measured" claim a guess forever.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES public.venue_order_sessions(id) ON DELETE RESTRICT,
  brand_id              uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  venue_id              uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,

  -- ---- PROVENANCE (RECORDED, never inferred) -------------------------------
  qr_spot_id            uuid NULL REFERENCES public.qr_spots(id) ON DELETE SET NULL,
  spot_label_at_order   text NULL,          -- snapshot: the printed label at order time
  venue_table_id        uuid NULL REFERENCES public.venue_tables(id) ON DELETE SET NULL,
  stay_unit_id          uuid NULL REFERENCES public.stay_units(id) ON DELETE SET NULL,
  zone_at_order         text NULL,          -- snapshot of venue_tables.zone (5-value vocab)
  reservation_id        uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  source                text NOT NULL CHECK (source IN ('guest_qr','guest_page','staff')),
  taken_by_user_id      uuid NULL,          -- soft ref; NOT NULL exactly when source='staff'
  entry_source          text NULL,          -- search|social|organic|direct (#855 PR-2 vocabulary)

  -- ---- COUNTER PICKUP ------------------------------------------------------
  pickup_code           text NULL CHECK (pickup_code IS NULL OR pickup_code ~ '^[0-9]{2,3}$'),

  -- ---- BUYER IDENTITY (nullable by design; required when Mingla moves money) -
  buyer_user_id         uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  buyer_name            text NULL,
  buyer_email           text NULL,
  buyer_phone_e164      text NULL,

  -- ---- MONEY (every number server-computed; a client-sent price is ignored) --
  money_path            text NOT NULL CHECK (money_path IN ('mingla','venue_collected')),
  currency              text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  subtotal_cents        int  NOT NULL CHECK (subtotal_cents >= 0),
  service_charge_bps    int  NOT NULL DEFAULT 0 CHECK (service_charge_bps BETWEEN 0 AND 3000),
  service_charge_cents  int  NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0),
  -- THE FEE BASIS. GENERATED, so a tip can never enter it — neither of its two
  -- inputs is tip_cents, and no code path can add one.
  fee_basis_cents       int  GENERATED ALWAYS AS (subtotal_cents + service_charge_cents) STORED,
  tip_cents             int  NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  effective_take_rate_bps int NOT NULL CHECK (effective_take_rate_bps BETWEEN 0 AND 10000),
  service_fee_bps       int  NOT NULL CHECK (service_fee_bps BETWEEN 0 AND 10000),
  mingla_fee_cents      int  NOT NULL DEFAULT 0 CHECK (mingla_fee_cents >= 0),
  platform_service_fee_cents int NOT NULL DEFAULT 0 CHECK (platform_service_fee_cents >= 0),
  pass_mingla_fee       boolean NOT NULL,
  pass_service_fee      boolean NOT NULL,
  pass_tax              boolean NOT NULL,
  buyer_subtotal_cents  int  NOT NULL CHECK (buyer_subtotal_cents >= 0),
  tax_amount_cents      int  NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
  total_cents           int  NOT NULL CHECK (total_cents >= 0),
  refunded_amount_cents int  NOT NULL DEFAULT 0
                          CHECK (refunded_amount_cents BETWEEN 0 AND total_cents),
  pricing_breakdown     jsonb NULL,         -- buildPricingBreakdown() output, verbatim

  -- ---- PROVIDER (NULL on the venue_collected path) -------------------------
  provider              text NULL CHECK (provider IS NULL OR provider IN ('stripe','paystack')),
  stripe_payment_intent_id  text NULL,
  stripe_checkout_session_id text NULL,
  stripe_charge_id      text NULL,
  stripe_account_id     text NULL,
  paystack_reference    text NULL,
  tax_calculation_id    text NULL,
  stripe_tax_transaction_id text NULL,

  -- ---- LIFECYCLE -----------------------------------------------------------
  payment_status        text NOT NULL DEFAULT 'pending' CHECK (payment_status IN
                          ('pending','paid','failed','refunded','partial_refund','cancelled')),
  fulfillment_status    text NOT NULL DEFAULT 'placed' CHECK (fulfillment_status IN
                          ('placed','acknowledged','in_progress','ready','delivered',
                           'cancelled','refunded')),
  acknowledged_at       timestamptz NULL,
  acknowledged_by_user_id uuid NULL,        -- soft ref; the human who tapped
  in_progress_at        timestamptz NULL,
  ready_at              timestamptz NULL,
  delivered_at          timestamptz NULL,
  cancelled_at          timestamptz NULL,
  refund_requested_at   timestamptz NULL,
  refund_decision       text NULL CHECK (refund_decision IS NULL
                          OR refund_decision IN ('approved','declined')),
  refund_decided_by_user_id uuid NULL,
  escalation_level      smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  escalated_at          timestamptz NULL,

  -- ---- ANON POSSESSION CREDENTIALS (hash-only; the shipped pattern) --------
  buyer_status_token_hash text NULL,
  guest_cancel_token_hash text NULL,

  idempotency_key       text NOT NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at          timestamptz NULL,
  failed_at             timestamptz NULL,
  expires_at            timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- ===================== STRUCTURAL PROMISES ==============================
  -- 1. Mingla's fee is computed on the fee basis, which cannot contain a tip.
  --    P-3a: `round(numeric)` here is half-away-from-zero and every input is
  --    >= 0, so it agrees with the shipped TS `feeFromBps` =
  --    Math.round((base*bps)/10000) (_shared/allInPricingEngine.ts:176-178) on
  --    every value. Parity is fixture-tested both sides (T-M2).
  CONSTRAINT venue_orders_fee_from_basis CHECK (
    mingla_fee_cents = round(fee_basis_cents::numeric * effective_take_rate_bps / 10000)
    AND platform_service_fee_cents = round(fee_basis_cents::numeric * service_fee_bps / 10000)),
  -- 2. The buyer's number is the engine's number.
  CONSTRAINT venue_orders_buyer_subtotal_shape CHECK (
    buyer_subtotal_cents = fee_basis_cents
      + (CASE WHEN pass_mingla_fee  THEN mingla_fee_cents           ELSE 0 END)
      + (CASE WHEN pass_service_fee THEN platform_service_fee_cents ELSE 0 END)),
  -- 3. The tip rides on top of everything and is never fee'd or taxed by Mingla.
  CONSTRAINT venue_orders_total_shape CHECK (
    total_cents = buyer_subtotal_cents + tax_amount_cents + tip_cents),
  -- 4. Venue took the money => no provider, no Mingla fee, no platform fee.
  CONSTRAINT venue_orders_money_path_shape CHECK (
    (money_path = 'mingla'          AND provider IS NOT NULL)
    OR (money_path = 'venue_collected' AND provider IS NULL
        AND mingla_fee_cents = 0 AND platform_service_fee_cents = 0
        AND effective_take_rate_bps = 0 AND service_fee_bps = 0
        AND tax_amount_cents = 0 AND refunded_amount_cents = 0)),
  -- 5. Mingla moved money => the contact triple exists (receipts, status, refunds).
  CONSTRAINT venue_orders_paid_needs_contact CHECK (
    money_path <> 'mingla' OR payment_status <> 'paid'
    OR (buyer_name IS NOT NULL AND buyer_email IS NOT NULL AND buyer_phone_e164 IS NOT NULL)),
  -- 6. Exactly one destination: a spot, or a counter-pickup code with a name.
  CONSTRAINT venue_orders_destination_shape CHECK (
    (qr_spot_id IS NOT NULL AND pickup_code IS NULL)
    OR (qr_spot_id IS NULL AND pickup_code IS NOT NULL AND buyer_name IS NOT NULL)),
  -- 7. A QR order came from a QR; a staff order came from a person.
  CONSTRAINT venue_orders_source_shape CHECK (
    (source = 'guest_qr' AND qr_spot_id IS NOT NULL AND taken_by_user_id IS NULL)
    OR (source = 'guest_page' AND taken_by_user_id IS NULL)
    OR (source = 'staff' AND taken_by_user_id IS NOT NULL)),
  -- 8. ACKNOWLEDGED IS A HUMAN TAP. No timestamp without a person; no advance
  --    past 'placed' without both. The unacknowledged-but-progressing state is
  --    not merely untested — it is unwritable.
  CONSTRAINT venue_orders_ack_is_human CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by_user_id IS NULL)),
  CONSTRAINT venue_orders_ack_precedes_progress CHECK (
    fulfillment_status IN ('placed','cancelled') OR acknowledged_at IS NOT NULL),
  -- 9. A refund decision is a person's, recorded.
  CONSTRAINT venue_orders_refund_decision_shape CHECK (
    (refund_decision IS NULL) = (refund_decided_by_user_id IS NULL))
);

CREATE UNIQUE INDEX venue_orders_idempotency_uniq ON public.venue_orders (idempotency_key);
CREATE UNIQUE INDEX venue_orders_pi_uniq ON public.venue_orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX venue_orders_paystack_ref_uniq ON public.venue_orders (paystack_reference)
  WHERE paystack_reference IS NOT NULL;
CREATE UNIQUE INDEX venue_orders_checkout_session_uniq
  ON public.venue_orders (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
-- A live pickup code is unique per venue; retired codes recycle.
CREATE UNIQUE INDEX venue_orders_live_pickup_code_uniq
  ON public.venue_orders (venue_id, pickup_code)
  WHERE pickup_code IS NOT NULL
    AND fulfillment_status NOT IN ('delivered','cancelled','refunded');
-- The queue's hot path, and the escalation sweep's.
CREATE INDEX venue_orders_queue_idx ON public.venue_orders (venue_id, fulfillment_status, created_at);
CREATE INDEX venue_orders_unacked_idx ON public.venue_orders (created_at)
  WHERE acknowledged_at IS NULL AND fulfillment_status = 'placed';
-- The intelligence rollup's.
CREATE INDEX venue_orders_metrics_idx ON public.venue_orders (brand_id, venue_id, created_at DESC);
CREATE INDEX venue_orders_session_idx ON public.venue_orders (session_id, created_at);
CREATE INDEX venue_orders_reservation_idx ON public.venue_orders (reservation_id)
  WHERE reservation_id IS NOT NULL;
CREATE INDEX venue_orders_spot_idx ON public.venue_orders (qr_spot_id) WHERE qr_spot_id IS NOT NULL;
CREATE INDEX venue_orders_payout_idx ON public.venue_orders (brand_id, payment_status, created_at)
  WHERE money_path = 'mingla';
-- Dispute + webhook resolution by provider charge id (P-51).
CREATE INDEX venue_orders_charge_idx ON public.venue_orders (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

COMMENT ON COLUMN public.venue_orders.fee_basis_cents IS
  'SPEC #1788 P-17 / I-PROPOSED-1767-NO-CUT-OF-A-TIP. GENERATED from '
  'subtotal_cents + service_charge_cents. This is `baseCents` for the shared '
  'all-in engine and NOTHING else, ever. A tip is structurally unwritable into '
  'it: neither input is tip_cents, and the database computes the value.';
COMMENT ON COLUMN public.venue_orders.tip_cents IS
  'Added to total_cents ONLY. Never fee''d, never taxed by Mingla, never entered '
  'into subtotal, spend-per-cover, item velocity, or zone revenue.';
COMMENT ON COLUMN public.venue_orders.money_path IS
  'I-PROPOSED-1767-VENUE-COLLECTED-IS-NOT-MINGLA-MONEY. `venue_collected` = the '
  'venue took cash / their own card machine: no provider, no fee, no tax, no '
  'refund rail, and the payout sweep arm never sees it.';

-- ---------------------------------------------------------------------------
-- P-4 — the LINES. Menus are mutable; history is not.
-- (I-PROPOSED-1767-PRICE-SNAPSHOT-AT-ORDER)
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_order_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_order_id         uuid NOT NULL REFERENCES public.venue_orders(id) ON DELETE CASCADE,
  -- RESTRICT, not SET NULL: a menu item with sales history cannot be hard-deleted
  -- out from under the numbers. Menu removal is `is_available=false`, not DELETE.
  menu_item_id           uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  line_no                int  NOT NULL CHECK (line_no >= 1),
  -- SNAPSHOTS. A later rename / re-price / 86 never mutates a historical order.
  item_name_at_order     text NOT NULL CHECK (length(btrim(item_name_at_order)) > 0),
  unit_price_cents       int  NOT NULL CHECK (unit_price_cents >= 0),
  currency               text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  quantity               int  NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  modifiers_total_cents  int  NOT NULL DEFAULT 0,
  line_total_cents       int  NOT NULL CHECK (line_total_cents >= 0),
  notes                  text NULL CHECK (notes IS NULL OR length(notes) <= 140),
  -- OQ-3 SEAM ONLY. Nullable, and DELIBERATELY UNPOPULATED: launch rides the
  -- shipped degrade-to-flat-absorb ladder, and no F&B Stripe Tax code is chosen
  -- here or anywhere in this PR. The column exists now so deciding the codes
  -- later is a config change, not a migration on a live money table. Any code
  -- written into it MUST first be verified against live Stripe documentation.
  tax_code               text NULL CHECK (tax_code IS NULL
                           OR length(btrim(tax_code)) BETWEEN 1 AND 40),
  prep_state             text NOT NULL DEFAULT 'pending'
                           CHECK (prep_state IN ('pending','fired','ready','served','voided')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_order_items_line_arith CHECK (
    line_total_cents = (unit_price_cents + modifiers_total_cents) * quantity),
  CONSTRAINT venue_order_items_unique_line UNIQUE (venue_order_id, line_no)
);

CREATE TABLE public.venue_order_item_modifiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_order_item_id    uuid NOT NULL REFERENCES public.venue_order_items(id) ON DELETE CASCADE,
  menu_modifier_id       uuid NOT NULL REFERENCES public.menu_modifiers(id) ON DELETE RESTRICT,
  group_name_at_order    text NOT NULL,     -- snapshot
  modifier_name_at_order text NOT NULL,     -- snapshot
  price_delta_cents      int  NOT NULL,     -- snapshot; may be negative
  currency               text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_order_items_order_idx ON public.venue_order_items (venue_order_id, line_no);
CREATE INDEX venue_order_items_velocity_idx ON public.venue_order_items (menu_item_id, created_at DESC);
CREATE INDEX venue_order_item_modifiers_item_idx
  ON public.venue_order_item_modifiers (venue_order_item_id);

COMMENT ON COLUMN public.venue_order_items.currency IS
  'P-4a / I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES. Per row, upper-3 ISO, '
  'NEVER GBP-defaulted — the menu_items.currency rule '
  '(20261118000000_orch_1186c_menus_menu_items.sql:73-76) inherited verbatim. A '
  'mixed-currency cart is rejected at order-create with `mixed_currency`.';

-- ---------------------------------------------------------------------------
-- P-3b — updated_at triggers.
-- NOTE (deviation, stated): P-3b says "all three tables". `venue_order_items`
-- as specified in P-4 carries created_at and NO updated_at column, so it has no
-- trigger — a trigger there could not compile. The exact P-4 DDL wins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_venue_order_sessions_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_venue_orders_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

CREATE TRIGGER trg_venue_order_sessions_updated_at
  BEFORE UPDATE ON public.venue_order_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_order_sessions_set_updated_at();

CREATE TRIGGER trg_venue_orders_updated_at
  BEFORE UPDATE ON public.venue_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_venue_orders_set_updated_at();

-- ---------------------------------------------------------------------------
-- P-3c — brand<->venue integrity. A brand can never stamp another brand's venue
-- onto a sitting or an order. The shared helper reads (NEW.brand_id,
-- NEW.venue_id); `venue_order_items` carries neither, so it has no trigger.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_venue_order_sessions_venue_brand
  BEFORE INSERT OR UPDATE ON public.venue_order_sessions
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

CREATE TRIGGER trg_venue_orders_venue_brand
  BEFORE INSERT OR UPDATE ON public.venue_orders
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

-- ---------------------------------------------------------------------------
-- P-5 — RLS. Writes are service-role edge functions and SECURITY DEFINER RPCs
-- ONLY: there is no INSERT/UPDATE/DELETE policy for anon or authenticated,
-- ever (the reservation_checkout_sessions posture, 20261012000002:117-123).
--
-- The brand-member SELECT policy is REQUIRED and must not be "hardened" away:
-- Supabase `postgres_changes` delivery is RLS-evaluated per subscriber, so with
-- no SELECT policy the Phase-3 Orders queue would receive NO realtime events at
-- all, silently. That is the exact failure class ORCH-0854 exists to prevent.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_order_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_order_item_modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_order_sessions brand member can read" ON public.venue_order_sessions
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

CREATE POLICY "venue_orders brand member can read" ON public.venue_orders
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

CREATE POLICY "venue_order_items brand member can read" ON public.venue_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.venue_orders o
    WHERE o.id = venue_order_items.venue_order_id
      AND public.biz_is_brand_member_for_read_for_caller(o.brand_id)));

CREATE POLICY "venue_order_item_modifiers brand member can read" ON public.venue_order_item_modifiers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.venue_order_items i
    JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE i.id = venue_order_item_modifiers.venue_order_item_id
      AND public.biz_is_brand_member_for_read_for_caller(o.brand_id)));

-- Deliberate asymmetry with venue_tables (which grants writes to authenticated
-- because its writes are RLS-gated upserts). Order writes are NOT.
GRANT SELECT ON public.venue_order_sessions       TO authenticated;
GRANT SELECT ON public.venue_orders               TO authenticated;
GRANT SELECT ON public.venue_order_items          TO authenticated;
GRANT SELECT ON public.venue_order_item_modifiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_sessions       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_orders               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_items          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_item_modifiers TO service_role;

-- ---------------------------------------------------------------------------
-- OQ-5 — the per-spot rate limiter. 10 orders/spot/minute.
-- Exceeding the limit is a SOFT, RETRYABLE message; a failure of the limiter
-- ITSELF fails OPEN with a structured log (the edge fn's try/catch). A blocked
-- legitimate order at a busy table is worse than an extra one.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_order_rate_limits (
  scope_key    text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         int NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (scope_key, window_start)
);
ALTER TABLE public.venue_order_rate_limits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_order_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.pg_venue_order_rate_limit_hit(
  p_scope_key text,
  p_limit     int DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_window timestamptz;
  v_hits   int;
BEGIN
  IF p_scope_key IS NULL OR length(btrim(p_scope_key)) = 0 THEN
    RAISE EXCEPTION 'rate_limit_scope_required' USING ERRCODE = '22023';
  END IF;
  v_window := date_trunc('minute', now());
  INSERT INTO public.venue_order_rate_limits (scope_key, window_start, hits)
  VALUES (p_scope_key, v_window, 1)
  ON CONFLICT (scope_key, window_start)
  DO UPDATE SET hits = public.venue_order_rate_limits.hits + 1
  RETURNING hits INTO v_hits;

  -- Opportunistic sweep so the table cannot grow without bound. Bounded work.
  DELETE FROM public.venue_order_rate_limits
   WHERE window_start < v_window - interval '1 hour';

  RETURN jsonb_build_object(
    'allowed', v_hits <= greatest(1, p_limit),
    'hits', v_hits,
    'limit', greatest(1, p_limit)
  );
END;
$fn$;

-- NOTE: `REVOKE ... FROM PUBLIC` alone is NOT enough on Supabase. The project
-- carries ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public function
-- to anon/authenticated/service_role, which writes an EXPLICIT `anon=X` ACL entry
-- that revoking PUBLIC never touches. anon must be named. (#1171's own grants use
-- exactly this two-line shape, and the ORCH-1392 live-ACL gate is what proves it.)
REVOKE ALL ON FUNCTION public.pg_venue_order_rate_limit_hit(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_rate_limit_hit(text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_rate_limit_hit(text, int) TO service_role;

COMMENT ON FUNCTION public.pg_venue_order_rate_limit_hit(text, int) IS
  'SPEC #1788 OQ-5 — per-spot order limiter. Returns {allowed,hits,limit}; the '
  'CALLER fails OPEN when this function itself errors (structured log), because '
  'a blocked legitimate order at a busy table is worse than an extra one.';

-- ---------------------------------------------------------------------------
-- P-2a — the tab lifecycle. ONE guarded RPC per transition; `open -> settling ->
-- closed` never runs backwards. `per_round` is NOT a valid close method (a
-- per-round session has tab_state='none' and never opens).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_venue_tab_open(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.venue_order_sessions%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_session FROM public.venue_order_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF public.biz_brand_effective_rank_for_caller(v_session.brand_id)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_session.tab_state <> 'none' THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.venue_order_sessions
     SET tab_state = 'open', opened_by_user_id = v_uid, opened_at = now()
   WHERE id = p_session_id;
  RETURN jsonb_build_object('sessionId', p_session_id, 'tabState', 'open');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_venue_tab_close(
  p_session_id uuid,
  p_settlement_method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.venue_order_sessions%ROWTYPE;
  v_uid uuid := auth.uid();
  v_subtotal int;
  v_service_charge int;
  v_tip int;
  v_order_ids uuid[];
  v_non_collected int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_settlement_method NOT IN ('bill_to_phone','venue_collected') THEN
    -- `per_round` is deliberately rejected: a per-round session never opens.
    RAISE EXCEPTION 'invalid_settlement_method' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_session FROM public.venue_order_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF public.biz_brand_effective_rank_for_caller(v_session.brand_id)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_session.tab_state NOT IN ('open','settling') THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;

  -- Every unsettled child of an open tab carries the venue_collected shape
  -- (see the venue-order-staff `create` note: at create NO money has moved and
  -- Mingla has taken nothing, so `venue_collected` is the literally-true shape,
  -- and it is the ONLY shape P-3 CHECK 4 permits without a provider). A tab
  -- holding an already-charged Mingla-path order cannot be bulk-settled — that
  -- would silently strand a real charge.
  SELECT count(*) INTO v_non_collected
    FROM public.venue_orders o
   WHERE o.session_id = p_session_id
     AND o.money_path <> 'venue_collected'
     AND o.payment_status NOT IN ('cancelled','refunded')
     AND coalesce(o.metadata->>'tab_settlement', '') <> 'true';
  IF v_non_collected > 0 THEN
    RAISE EXCEPTION 'tab_has_mingla_orders' USING ERRCODE = 'P0001';
  END IF;

  IF p_settlement_method = 'venue_collected' THEN
    UPDATE public.venue_orders
       SET payment_status = 'paid', confirmed_at = coalesce(confirmed_at, now())
     WHERE session_id = p_session_id
       AND money_path = 'venue_collected'
       AND payment_status = 'pending';
    UPDATE public.venue_order_sessions
       SET tab_state = 'closed', settlement_method = 'venue_collected',
           closed_at = now(), closed_by_user_id = v_uid
     WHERE id = p_session_id;
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'tabState', 'closed',
      'settlementMethod', 'venue_collected',
      'outstandingSubtotalCents', 0, 'outstandingServiceChargeCents', 0,
      'outstandingTipCents', 0, 'orderIds', '[]'::jsonb,
      'currency', v_session.currency);
  END IF;

  -- bill_to_phone: the tab sits at `settling` until the ONE settlement order the
  -- caller mints reaches payment_status='paid'. NO money moves inside this RPC.
  -- The three sums are returned SEPARATELY, never pre-added, because the tip
  -- must never enter the settlement order's fee basis
  -- (I-PROPOSED-1767-NO-CUT-OF-A-TIP): the caller feeds
  -- subtotal + service_charge to the engine and adds the tip last.
  SELECT coalesce(sum(o.subtotal_cents), 0),
         coalesce(sum(o.service_charge_cents), 0),
         coalesce(sum(o.tip_cents), 0),
         coalesce(array_agg(o.id ORDER BY o.created_at), ARRAY[]::uuid[])
    INTO v_subtotal, v_service_charge, v_tip, v_order_ids
    FROM public.venue_orders o
   WHERE o.session_id = p_session_id
     AND o.money_path = 'venue_collected'
     AND o.payment_status = 'pending';

  UPDATE public.venue_order_sessions
     SET tab_state = 'settling', settlement_method = 'bill_to_phone'
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'sessionId', p_session_id, 'tabState', 'settling',
    'settlementMethod', 'bill_to_phone',
    'outstandingSubtotalCents', v_subtotal,
    'outstandingServiceChargeCents', v_service_charge,
    'outstandingTipCents', v_tip,
    'orderIds', to_jsonb(v_order_ids),
    'currency', v_session.currency, 'venueId', v_session.venue_id,
    'brandId', v_session.brand_id, 'qrSpotId', v_session.qr_spot_id);
END;
$fn$;

-- The tab RPCs KEEP `authenticated` — they read auth.uid() and are the venue's own
-- staff control. anon is revoked: a tab is never opened or settled by a stranger.
REVOKE ALL ON FUNCTION public.biz_venue_tab_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_tab_open(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.biz_venue_tab_close(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_tab_close(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_tab_open(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_venue_tab_close(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P-13 support — the VENUE'S OWN CLOCK. A menu service window is evaluated in
-- venue-local time using the shipped 3-step ladder
-- (20270201001403_issue_1403_venue_reservation_rollup.sql:65-90):
--   venue_availability_config.iana_timezone -> place_pool.utc_offset_minutes -> 'UTC'
-- NEVER the server's clock, never the device's. One RPC so the ladder has ONE
-- implementation rather than a SQL copy and a TypeScript copy that drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_local_now(
  p_brand_id uuid,
  p_venue_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tz text;
  v_confidence text;
  v_offset_min int;
  v_local timestamp;
  v_place uuid;
BEGIN
  SELECT availability.iana_timezone INTO v_tz
    FROM public.venue_availability_config availability
    JOIN public.analytics_iana_timezones valid_timezone
      ON valid_timezone.name = availability.iana_timezone
   WHERE availability.brand_id = p_brand_id
     AND availability.venue_id = p_venue_id
   LIMIT 1;

  IF v_tz IS NOT NULL THEN
    v_confidence := 'iana';
    v_local := p_now AT TIME ZONE v_tz;
  ELSE
    SELECT v.place_pool_id INTO v_place FROM public.venue_listings v WHERE v.id = p_venue_id;
    SELECT place.utc_offset_minutes INTO v_offset_min
      FROM public.place_pool place
     WHERE place.id = v_place AND place.utc_offset_minutes IS NOT NULL;
    IF v_offset_min IS NOT NULL THEN
      v_confidence := 'offset';
      v_local := (p_now AT TIME ZONE 'UTC') + make_interval(mins => v_offset_min);
    ELSE
      v_confidence := 'utc';
      v_tz := 'UTC';
      v_local := p_now AT TIME ZONE 'UTC';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'iso_dow', extract(isodow FROM v_local)::int,
    'minutes', (extract(hour FROM v_local)::int * 60 + extract(minute FROM v_local)::int),
    'timezone', v_tz,
    'tz_confidence', v_confidence
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.pg_venue_local_now(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_local_now(uuid, uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_local_now(uuid, uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- D-3a — the counter-pickup code. 2-3 digits, unique among the venue's LIVE
-- orders, and recycled once an order is delivered/cancelled/refunded (the
-- partial UNIQUE index is the authority; this only proposes). Server-side only:
-- a client-composed code would collide two guests onto one number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_order_next_pickup_code(p_venue_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_code text;
BEGIN
  SELECT lpad(g::text, 2, '0') INTO v_code
    FROM generate_series(10, 999) g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.venue_orders o
      WHERE o.venue_id = p_venue_id
        AND o.pickup_code = lpad(g::text, 2, '0')
        AND o.fulfillment_status NOT IN ('delivered','cancelled','refunded'))
   ORDER BY g
   LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'pickup_codes_exhausted' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_code;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pg_venue_order_next_pickup_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_next_pickup_code(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_next_pickup_code(uuid) TO service_role;

COMMENT ON FUNCTION public.biz_venue_tab_close(uuid, text) IS
  'SPEC #1788 P-2a — the ONLY tab close path. `venue_collected` closes '
  'immediately with no provider call, no fee, and no payout row; '
  '`bill_to_phone` moves the tab to `settling` and returns the outstanding '
  'total for the caller to mint ONE settlement order on the normal rail. '
  '`per_round` is rejected.';

COMMIT;
