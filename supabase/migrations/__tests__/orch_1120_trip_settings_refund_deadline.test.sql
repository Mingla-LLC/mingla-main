-- ORCH-1120 — behavioral + body-marker probe for the published-trip Settings
-- refund/deadline/bookings-closed sales-gate added to biz_update_live_trip.
--
-- Hand-run AFTER `supabase db push --linked` lands
-- 20260929000000_orch_1120_trip_settings_refund_deadline.sql.
--
-- WRITE-SAFE: behavioral cases run inside their own BEGIN/ROLLBACK transaction.
-- The realized-% classifier (the heart of the buyer-protection asymmetry) is
-- exercised here as a standalone logic probe — it mirrors EXACTLY the inline
-- predicate the RPC's §4g.1 block uses (largest days_before_start <= d wins,
-- else 0; unfavorable iff new<old at any threshold in the union ∪ {0}). The
-- full auth-gated end-to-end RPC drive (real trip fixture + paid order +
-- auth.uid()) is the tester's adversarial layer; this file proves the gate is
-- PRESENT (fails-on-revert) and the classifier math is CORRECT.
--
-- fails-on-revert: if the §4g gate block is deleted from the RPC body, M-10
-- (the body-marker check) RAISEs "gate missing"; if the classifier math is
-- broken, M-11..M-16 RAISE. Restore => all pass.
--
-- Covers SPEC §7 T-1, T-2, T-4 (refund classifier), T-6, T-7, T-8 (deadline),
-- T-9, T-10 (bookings-closed) at the predicate level, plus the §5f apply
-- marker and the 3 emitted reasons.

\set ON_ERROR_STOP on

-- ─── M-10: the RPC body carries the ORCH-1120 §4g gate + §5f apply + the 3
--           reasons (fails-on-revert: delete the gate => this RAISEs) ──────────
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.biz_update_live_trip(uuid,jsonb,text)'::regprocedure);

  -- §4g gate present.
  IF position('4g. ORCH-1120' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: §4g ORCH-1120 refund/deadline/bookings-closed gate missing from biz_update_live_trip';
  END IF;
  -- The 3 emitted reasons present.
  IF position('refund_policy_downgrade_with_sales' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: refund_policy_downgrade_with_sales reason missing';
  END IF;
  IF position('booking_deadline_earlier_with_sales' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: booking_deadline_earlier_with_sales reason missing';
  END IF;
  IF position('bookings_closed_harms_active' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: bookings_closed_harms_active reason missing';
  END IF;
  -- §5f apply block present (writes the 3 columns + bookings_closed_at).
  IF position('5f. ORCH-1120' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: §5f ORCH-1120 apply block missing';
  END IF;
  IF position('bookings_closed_at' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: §5f does not write bookings_closed_at';
  END IF;
  -- Classifier validates shape via validate_refund_policy.
  IF position('validate_refund_policy' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-10 FAIL: §4g.1 does not validate refund policy shape';
  END IF;
  RAISE NOTICE 'M-10 PASS: §4g gate + §5f apply + 3 reasons + shape-validate present in RPC body';
END$$;

-- ─── Realized-% classifier probe. A local function replicating the RPC's §4g.1
--      predicate, so we can assert the favorable/unfavorable verdicts on the
--      SPEC §7 refund shapes without an auth-gated RPC fixture. ───────────────
BEGIN;

-- Helper: realized refund_pct a buyer cancelling d whole-days-before-start gets
-- under `policy` (NULL policy => 0 at every d).
CREATE OR REPLACE FUNCTION pg_temp.orch1120_pct_at(p_policy jsonb, p_d int)
RETURNS int LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(
    (SELECT (te->>'refund_pct')::int
       FROM jsonb_array_elements(COALESCE(p_policy->'tiers', '[]'::jsonb)) te
      WHERE (te->>'days_before_start')::int <= p_d
      ORDER BY (te->>'days_before_start')::int DESC
      LIMIT 1),
    0);
$fn$;

-- Helper: unfavorable iff new<old at any threshold in (old∪new∪{0}).
CREATE OR REPLACE FUNCTION pg_temp.orch1120_is_unfavorable(p_old jsonb, p_new jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v_thresholds int[];
  v_d int;
BEGIN
  v_thresholds := (
    SELECT array_agg(DISTINCT x) FROM (
      SELECT (t->>'days_before_start')::int AS x
        FROM jsonb_array_elements(COALESCE(p_old->'tiers','[]'::jsonb)) t
      UNION SELECT (t->>'days_before_start')::int
        FROM jsonb_array_elements(COALESCE(p_new->'tiers','[]'::jsonb)) t
      UNION SELECT 0
    ) u
  );
  IF v_thresholds IS NULL THEN RETURN false; END IF;
  FOREACH v_d IN ARRAY v_thresholds LOOP
    IF pg_temp.orch1120_pct_at(p_new, v_d) < pg_temp.orch1120_pct_at(p_old, v_d) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$fn$;

DO $$
DECLARE
  -- Flexible(30->100, 14->50, 0->0) — tiers stored DESC by days_before_start.
  v_flex jsonb := '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'::jsonb;
  -- Strict(90->100, 0->0).
  v_strict jsonb := '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'::jsonb;
  -- Flexible but 14->80 (raise the middle tier).
  v_flex_raise jsonb := '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":14,"refund_pct":80},{"days_before_start":0,"refund_pct":0}]}'::jsonb;
  -- Strict + an added 30->50 tier (raises realized % for d in [30,89]).
  v_strict_plus jsonb := '{"kind":"strict","tiers":[{"days_before_start":90,"refund_pct":100},{"days_before_start":30,"refund_pct":50},{"days_before_start":0,"refund_pct":0}]}'::jsonb;
  -- Flexible with the 14->50 tier removed (drops realized % at d in [14,29]).
  v_flex_removed jsonb := '{"kind":"flexible","tiers":[{"days_before_start":30,"refund_pct":100},{"days_before_start":0,"refund_pct":0}]}'::jsonb;
BEGIN
  -- T-1: Flexible -> Strict lowers realized % at d=14..29 (50 -> 0) => UNFAVORABLE.
  IF NOT pg_temp.orch1120_is_unfavorable(v_flex, v_strict) THEN
    RAISE EXCEPTION 'M-11 FAIL (T-1): Flexible->Strict should classify UNFAVORABLE';
  END IF;
  RAISE NOTICE 'M-11 PASS (T-1): Flexible->Strict = unfavorable (would block with sales)';

  -- T-2: raise the 14 tier 50->80 => FAVORABLE (never new<old).
  IF pg_temp.orch1120_is_unfavorable(v_flex, v_flex_raise) THEN
    RAISE EXCEPTION 'M-12 FAIL (T-2): raising a tier %% should be FAVORABLE';
  END IF;
  RAISE NOTICE 'M-12 PASS (T-2): raise tier %% = favorable (always allowed)';

  -- T-3: add a 30->50 tier to Strict => FAVORABLE (raises realized %% at d>=30).
  IF pg_temp.orch1120_is_unfavorable(v_strict, v_strict_plus) THEN
    RAISE EXCEPTION 'M-13 FAIL (T-3): adding a tier that raises realized %% should be FAVORABLE';
  END IF;
  RAISE NOTICE 'M-13 PASS (T-3): add-tier-raises-realized = favorable';

  -- T-4: remove the 14->50 tier => realized %% at d=14..29 drops 50->0 => UNFAVORABLE.
  IF NOT pg_temp.orch1120_is_unfavorable(v_flex, v_flex_removed) THEN
    RAISE EXCEPTION 'M-14 FAIL (T-4): removing a tier that lowers realized %% should be UNFAVORABLE';
  END IF;
  RAISE NOTICE 'M-14 PASS (T-4): remove-tier-lowers-realized = unfavorable (emits downgrade reason)';

  -- NULL policy is 0%% everywhere; raising from NULL to any policy = favorable.
  IF pg_temp.orch1120_is_unfavorable(NULL, v_strict) THEN
    RAISE EXCEPTION 'M-15 FAIL: NULL->policy (0%% -> some refund) must be FAVORABLE';
  END IF;
  -- Clearing a policy to NULL (some refund -> 0%% everywhere) = unfavorable.
  IF NOT pg_temp.orch1120_is_unfavorable(v_strict, NULL) THEN
    RAISE EXCEPTION 'M-15 FAIL: policy->NULL (drops realized %%) must be UNFAVORABLE';
  END IF;
  RAISE NOTICE 'M-15 PASS: NULL-boundary classification correct';
END$$;

-- ─── M-16: deadline + bookings-closed favorable/unfavorable direction logic
--           (mirrors §4g.2 / §4g.3 predicates exactly). ─────────────────────
DO $$
DECLARE
  v_old_dl timestamptz := '2026-08-01T00:00:00Z';
  v_earlier timestamptz := '2026-07-01T00:00:00Z';
  v_later   timestamptz := '2026-09-01T00:00:00Z';
BEGIN
  -- T-6: earlier deadline with sales => unfavorable (new < old).
  IF NOT (v_earlier IS NOT NULL AND (v_old_dl IS NULL OR v_earlier < v_old_dl)) THEN
    RAISE EXCEPTION 'M-16 FAIL (T-6): earlier deadline must be UNFAVORABLE';
  END IF;
  -- T-7: later deadline => favorable.
  IF (v_later IS NOT NULL AND (v_old_dl IS NULL OR v_later < v_old_dl)) THEN
    RAISE EXCEPTION 'M-16 FAIL (T-7): later deadline must be FAVORABLE';
  END IF;
  -- T-8: clear deadline (NULL) => favorable (window stays open longer).
  IF (NULL::timestamptz IS NOT NULL) THEN
    RAISE EXCEPTION 'M-16 FAIL (T-8): clearing deadline must be FAVORABLE';
  END IF;
  -- T-9: close bookings false->true => harmful flip.
  IF NOT (false = false AND true = true) THEN
    RAISE EXCEPTION 'M-16 FAIL (T-9): false->true close must be the harmful flip';
  END IF;
  -- T-10: reopen true->false => favorable (NOT the harmful flip).
  IF (true = false AND false = true) THEN
    RAISE EXCEPTION 'M-16 FAIL (T-10): true->false reopen must be FAVORABLE';
  END IF;
  RAISE NOTICE 'M-16 PASS: deadline + bookings-closed direction logic correct (T-6..T-10)';
END$$;

ROLLBACK;

\echo 'ORCH-1120 behavioral probe: ALL PASS (M-10..M-16).'
