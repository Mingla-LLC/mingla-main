-- ===========================================================================
-- Issue #1792 — Phase 3b of #1767: WAITER MODE (the order pad).
--
-- Phase 2 (#1790) already shipped the four money-bearing staff actions
-- (`create`, `settle`, `tab_open`, `tab_close`) and Phase 3 (#1791) shipped the
-- queue those tickets land in. This phase builds the surface a waiter actually
-- touches — and, in building it, found three ways a tab could go wrong in a
-- real service. All three are fixed HERE, in the database, because each one is a
-- promise that costs money when it quietly stops being true.
--
-- ---------------------------------------------------------------------------
-- 1. THE SETTLEMENT MARKER IS PERMANENT (the double-count bug).
--
-- `biz_venue_tab_close(..., 'bill_to_phone')` mints ONE settlement order that
-- carries the tab's outstanding total, marked `metadata.tab_settlement = true`.
-- THREE separate mechanisms already read that marker:
--   * `pg_venue_order_finalize_payment` (20270312001790:546) — a paid settlement
--     order is what CLOSES the tab and settles its children. Lose the marker and
--     the tab is stuck at `settling` forever, its rounds stuck at `pending`.
--   * `biz_venue_tab_close` (20270310001790:566) — the `tab_has_mingla_orders`
--     guard excludes the settlement order from its own tab. Lose the marker and
--     a RETRIED close raises `tab_has_mingla_orders`: the tab can never close.
--   * Phase 6 (#1795), by binding requirement — revenue must count the CHILD
--     rounds (which hold the items) and never the settlement row on top.
--
-- And `metadata` is a whole-column jsonb write from every PostgREST caller: a
-- later `update({ metadata: { … } })` REPLACES the object rather than merging
-- it. The edge function is fixed to merge, but a marker three subsystems depend
-- on cannot rest on every future caller remembering to. This trigger makes the
-- marker unloseable: once a row is a settlement row, it stays one.
--
-- ---------------------------------------------------------------------------
-- 2. A STRANDED SETTLEMENT ROW MAY NEVER BE COUNTED AS A ROUND.
--
-- The settlement order is INSERTed in the `venue_collected` shape and only then
-- moved onto the Mingla rail (it is never momentarily a `mingla` order with no
-- provider — P-3 CHECK 4). If the provider call fails in between, a
-- `venue_collected` + `pending` settlement row is left on the session. The old
-- `biz_venue_tab_close` body summed EXACTLY that shape as "outstanding", so a
-- retried close billed the table for its rounds PLUS a copy of its own bill;
-- and a `venue_collected` close marked the stranded bill `paid` beside the
-- rounds it was a copy of. Both arms now exclude settlement rows from the sum
-- and the `venue_collected` arm CANCELS the stranded instrument instead of
-- paying it. One exclusion rule, stated once, applied by both arms.
--
-- ---------------------------------------------------------------------------
-- 3. THE PAD NEEDS THE TAB'S RUNNING TOTAL, AND THE SERVER OWNS EVERY NUMBER.
--
-- `biz_venue_tab_summaries` is the open-tabs read the order pad renders. It
-- exists rather than a client-side sum for the same reason every other number in
-- this programme is server-computed (P-20): the client is handed money, never
-- asked to make it. It applies the SAME settlement exclusion as the close RPC,
-- so what a waiter sees on the tab card and what the close RPC bills are the
-- same arithmetic by construction.
--
-- ---------------------------------------------------------------------------
-- 4. P-16's TAB SWITCH HAD NO ENFORCEMENT POINT.
--
-- `venue_ordering_settings.staff_tabs_enabled` shipped in Phase 1 and P-26 says
-- the tab actions are gated on it, but nothing in the product ever read it — a
-- venue that switched staff tabs off could still have one opened on them. The
-- gate goes into `biz_venue_tab_open`, beside the rank floor, because a rule the
-- database does not enforce is a rule the next caller forgets.
--
-- Additive only. No table is created, no column is added, no live money row
-- changes shape. Three functions are CREATE OR REPLACE'd (ACL preserved), one
-- trigger and one function are new.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 — the settlement marker survives every future write.
--
-- Re-asserts rather than raises: an UPDATE that forgets the marker is a caller
-- bug, not an attack, and refusing the whole write would take a payment status
-- down with it. Re-adding the two keys keeps every dependent mechanism correct
-- while the write it rode in on still lands.
--
-- The marker is only ever ADDED by this trigger, never removed and never
-- invented: a row that was not a settlement row cannot become one here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._issue_1792_settlement_marker_is_permanent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF coalesce(OLD.metadata->>'tab_settlement', '') <> 'true' THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.metadata->>'tab_settlement', '') = 'true'
     AND coalesce(NEW.metadata->>'settles_session_id', '')
         = coalesce(OLD.metadata->>'settles_session_id', '') THEN
    RETURN NEW;
  END IF;
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
    || jsonb_build_object('tab_settlement', true)
    || CASE
         WHEN OLD.metadata->>'settles_session_id' IS NULL THEN '{}'::jsonb
         ELSE jsonb_build_object(
           'settles_session_id', OLD.metadata->>'settles_session_id')
       END;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public._issue_1792_settlement_marker_is_permanent() IS
  'Issue #1792 — a tab settlement row can never stop being one. Three '
  'mechanisms read metadata.tab_settlement (the finalize RPC that closes the '
  'tab, the close RPC''s own mingla-order guard, and Phase 6 revenue), and '
  'jsonb columns are whole-column writes through PostgREST. Without this a '
  'single forgetful update strands the tab at `settling` forever AND makes '
  'Phase 6 count the tab twice.';

DROP TRIGGER IF EXISTS trg_venue_orders_settlement_marker_permanent
  ON public.venue_orders;
CREATE TRIGGER trg_venue_orders_settlement_marker_permanent
  BEFORE UPDATE ON public.venue_orders
  FOR EACH ROW
  EXECUTE FUNCTION public._issue_1792_settlement_marker_is_permanent();

-- ---------------------------------------------------------------------------
-- 1b — P-16's tab switch gets its ONE enforcement point.
--
-- `venue_ordering_settings.staff_tabs_enabled` shipped in Phase 1 and P-26 says
-- tab_open / tab_close are "`staff_tabs_enabled` gated" — but nothing anywhere
-- read it. A venue that switched staff tabs OFF could still have a tab opened on
-- them, which is the venue's own credit decision being made for them. The gate
-- goes in `biz_venue_tab_open` rather than in the edge function, for the same
-- reason the rank floor did: it is the database that must refuse, or the next
-- caller simply forgets.
--
-- FAIL CLOSED on a missing settings row. A venue with no row has never switched
-- ordering on at all, so there is no service to extend credit against.
--
-- Body is 20270310001790:498-522 with exactly ONE addition, marked `#1792`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_venue_tab_open(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.venue_order_sessions%ROWTYPE;
  v_uid uuid := auth.uid();
  v_tabs_enabled boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_session FROM public.venue_order_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF public.biz_brand_effective_rank_for_caller(v_session.brand_id)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- #1792 — P-16's switch, enforced for the first time.
  SELECT coalesce(s.staff_tabs_enabled, false) INTO v_tabs_enabled
    FROM public.venue_ordering_settings s
   WHERE s.venue_id = v_session.venue_id;
  IF coalesce(v_tabs_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'staff_tabs_disabled' USING ERRCODE = 'P0001';
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

REVOKE ALL ON FUNCTION public.biz_venue_tab_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_tab_open(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_tab_open(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_venue_tab_open(uuid) IS
  'SPEC #1788 P-2a / P-16 — the ONLY tab open path. Rank >= event_manager (a '
  'tab is the venue extending credit), and Issue #1792 adds the '
  'staff_tabs_enabled gate P-26 always specified and nothing ever read. Fails '
  'CLOSED when a venue has no ordering settings row at all.';

-- ---------------------------------------------------------------------------
-- 2 — the close RPC, with the settlement row excluded from BOTH arms.
--
-- Body is 20270310001790_issue_1790_venue_order_family.sql:524-619 with exactly
-- three edits, each marked `#1792`:
--   a. the outstanding sum excludes settlement rows;
--   b. the venue_collected paid-flip excludes settlement rows;
--   c. the venue_collected arm cancels a stranded settlement instrument.
-- Nothing else changes: same signature, same rank floor, same FOR UPDATE, same
-- `per_round` rejection, same return shape.
-- ---------------------------------------------------------------------------
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
    -- #1792 (c) — a settlement instrument stranded by a failed provider call is
    -- a BILL FOR THESE ROUNDS, not another round. Marking it paid beside the
    -- rounds it copies would book the table's money twice.
    --
    -- Which way it resolves depends on whether a provider was ever called, and
    -- that distinction is the whole point of `money_path`:
    --   * still `venue_collected` -> the insert landed, the provider call did
    --     not. No bill exists anywhere. Cancel it.
    --   * already `mingla` -> a PaymentIntent or Paystack transaction is LIVE on
    --     the guest's phone. Cancelling it here would leave the venue taking
    --     cash while a chargeable bill is still out. REFUSE, and say so: the
    --     venue finishes the bill it sent or the guest lets it lapse.
    SELECT count(*) INTO v_non_collected
      FROM public.venue_orders o
     WHERE o.session_id = p_session_id
       AND coalesce(o.metadata->>'tab_settlement', '') = 'true'
       AND o.money_path = 'mingla'
       AND o.payment_status = 'pending';
    IF v_non_collected > 0 THEN
      RAISE EXCEPTION 'tab_bill_already_sent' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.venue_orders
       SET payment_status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
           fulfillment_status = 'cancelled'
     WHERE session_id = p_session_id
       AND coalesce(metadata->>'tab_settlement', '') = 'true'
       AND money_path = 'venue_collected'
       AND payment_status = 'pending';
    -- #1792 (b) — and it is never counted among the rounds being settled.
    UPDATE public.venue_orders
       SET payment_status = 'paid', confirmed_at = coalesce(confirmed_at, now())
     WHERE session_id = p_session_id
       AND money_path = 'venue_collected'
       AND payment_status = 'pending'
       AND coalesce(metadata->>'tab_settlement', '') <> 'true';
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
  --
  -- #1792 (a) — THE SETTLEMENT ROW IS NOT A ROUND. It is inserted in the
  -- venue_collected shape and only then moved onto the Mingla rail, so a failed
  -- provider call leaves one sitting in exactly the shape this sum matches. Left
  -- in, a retried close bills the table for its rounds plus a copy of its own
  -- bill. The exclusion is the same predicate the guard above uses.
  SELECT coalesce(sum(o.subtotal_cents), 0),
         coalesce(sum(o.service_charge_cents), 0),
         coalesce(sum(o.tip_cents), 0),
         coalesce(array_agg(o.id ORDER BY o.created_at), ARRAY[]::uuid[])
    INTO v_subtotal, v_service_charge, v_tip, v_order_ids
    FROM public.venue_orders o
   WHERE o.session_id = p_session_id
     AND o.money_path = 'venue_collected'
     AND o.payment_status = 'pending'
     AND coalesce(o.metadata->>'tab_settlement', '') <> 'true';

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

-- CREATE OR REPLACE preserves the ACL #1790 gave this function. Re-stated
-- belt-and-braces, and idempotent: anon may never open or settle a tab.
REVOKE ALL ON FUNCTION public.biz_venue_tab_close(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_tab_close(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_tab_close(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_venue_tab_close(uuid, text) IS
  'SPEC #1788 P-2a — the ONLY tab close path. `venue_collected` closes '
  'immediately with no provider call, no fee, and no payout row; '
  '`bill_to_phone` moves the tab to `settling` and returns the outstanding '
  'total for the caller to mint ONE settlement order on the normal rail. '
  '`per_round` is rejected. Issue #1792: both arms exclude a tab settlement '
  'row from the rounds, so a tab can never be billed for a copy of its own '
  'bill.';

-- ---------------------------------------------------------------------------
-- 3 — the order pad's open-tabs read.
--
-- Brand-scoped, member floor (the same floor `venue_order_sessions`' SELECT
-- policy applies, restated here because SECURITY DEFINER bypasses RLS), and it
-- sums the SAME rows `biz_venue_tab_close` would bill — settlement rows
-- excluded by the same predicate. A waiter looking at the tab card and the
-- close RPC therefore cannot disagree about what the table owes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_venue_tab_summaries(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF NOT public.biz_is_brand_member_for_read_for_caller(p_brand_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t."openedAt"), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id                                   AS "sessionId",
      s.venue_id                             AS "venueId",
      s.qr_spot_id                           AS "qrSpotId",
      s.tab_state                            AS "tabState",
      s.currency                             AS "currency",
      s.opened_at                            AS "openedAt",
      s.last_order_at                        AS "lastOrderAt",
      s.party_size_claimed                   AS "partySizeClaimed",
      coalesce(agg.spot_label, spot.label)   AS "spotLabel",
      coalesce(agg.round_count, 0)           AS "roundCount",
      coalesce(agg.subtotal_cents, 0)        AS "outstandingSubtotalCents",
      coalesce(agg.service_charge_cents, 0)  AS "outstandingServiceChargeCents",
      coalesce(agg.tip_cents, 0)             AS "outstandingTipCents",
      coalesce(agg.total_cents, 0)           AS "outstandingTotalCents"
    FROM public.venue_order_sessions s
    LEFT JOIN public.qr_spots spot ON spot.id = s.qr_spot_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int                      AS round_count,
             sum(o.subtotal_cents)::int         AS subtotal_cents,
             sum(o.service_charge_cents)::int   AS service_charge_cents,
             sum(o.tip_cents)::int              AS tip_cents,
             sum(o.total_cents)::int            AS total_cents,
             max(o.spot_label_at_order)         AS spot_label
        FROM public.venue_orders o
       WHERE o.session_id = s.id
         AND o.money_path = 'venue_collected'
         AND o.payment_status = 'pending'
         -- The bill for these rounds is not one of them (see #1792 (a)).
         AND coalesce(o.metadata->>'tab_settlement', '') <> 'true'
    ) agg ON true
    WHERE s.brand_id = p_brand_id
      AND s.tab_state IN ('open','settling')
  ) t;

  RETURN jsonb_build_object('tabs', v_rows);
END;
$fn$;

-- NOTE: `REVOKE ... FROM PUBLIC` alone is NOT enough on Supabase. The project
-- carries ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public function
-- to anon/authenticated/service_role, which writes an EXPLICIT `anon=X` ACL entry
-- that revoking PUBLIC never touches. anon must be named.
REVOKE ALL ON FUNCTION public.biz_venue_tab_summaries(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.biz_venue_tab_summaries(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_tab_summaries(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_venue_tab_summaries(uuid) IS
  'Issue #1792 (#1767 Phase 3b) — the order pad''s open-tabs read. The SERVER '
  'sums a tab, never the client (P-20), and it excludes tab settlement rows by '
  'the same predicate biz_venue_tab_close uses, so the card and the bill cannot '
  'disagree.';

COMMIT;
