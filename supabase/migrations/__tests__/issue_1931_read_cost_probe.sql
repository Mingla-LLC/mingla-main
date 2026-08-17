-- #1931 READ-COST PROBE — Amendment 5 §F.6, and tester finding P2-3.
--
-- Byte-identity was the right safety premise but it is NOT sufficient on its own: it
-- cannot see COST. `issue_1931_event_ordinary_read_blocked` is SECURITY DEFINER, so the
-- planner can never inline it, and it therefore executes once per candidate row on the
-- anonymous `events` read path. Amendment 5 §F.6 anticipated exactly this and chose
-- measure-and-record over a pass/fail latency gate, because a latency threshold in a
-- success criterion fails correct code on fixture and hardware variance.
--
-- This probe therefore does TWO different things, deliberately:
--   1. It MEASURES and PRINTS the A/B ratio on identical data in one transaction, so the
--      number in the implementation report is reproducible rather than asserted.
--   2. It fails ONLY above a deliberately generous CATASTROPHE ceiling. That ceiling is
--      not a performance target; it exists to catch a structural blow-up (for example a
--      per-row sequential scan appearing inside the helper), which no amount of hardware
--      jitter produces.
--
-- THE AGREED OPERATING CEILING — recorded here so the next person does not have to find
-- it on the issue, and does not chase machine variance.
--
--   Agreed ceiling ............ 3.0x   (orchestrator decision, Amendment 6 §D.5)
--   Implementor measurement ... 1.73x  (single A/B on the reference fixture)
--   Independent worst reading . 2.10x  (tester: nine measurements spanning 1.72x-2.10x)
--   Observed worst OVERALL .... 2.61x  (implementor, on a CONTENDED container; the three
--                                       immediate re-runs gave 1.65x / 1.83x / 1.81x)
--   Effective headroom ........ ~1.4x against the tester's band, and the 2.61x outlier
--                               shows variance alone can breach the 2.10x lower bound of
--                               the re-run band on a loaded machine. That is exactly what
--                               the re-run rule is for; it is NOT evidence of a regression.
--
--   RE-RUN RULE: a single reading between 2.10x and 3.0x is RE-RUN before it is treated
--   as an incident. That band is inside observed machine variance for this measurement,
--   so one reading in it is not evidence of a regression. Two consecutive readings above
--   2.10x, or any reading above 3.0x, is a stop-and-amend condition under Amendment 6 §I
--   — NOT an automatic criterion failure, and NOT something to "fix" by widening this
--   probe.
--
-- The tester also confirmed the criterion reds at 56.57x on a genuine structural blow-up,
-- so the catastrophe ceiling below is proven in both directions rather than assumed.
\set ON_ERROR_STOP on

BEGIN;

DO $probe$
DECLARE
  v_brand uuid := '77777777-7777-4777-8777-000000000002';
  v_user  uuid := '77777777-7777-4777-8777-000000000001';
  v_t0 timestamptz; v_with numeric; v_without numeric; v_ratio numeric;
  v_n bigint; v_i int;
  -- CATASTROPHE ceiling only -- deliberately NOT the 3.0x operating ceiling, which is a
  -- human decision routed to stop-and-amend. 6x sits above the observed 1.72x-2.10x band
  -- and above the agreed 3.0x, and below the 56.57x a real structural blow-up produces
  -- (independently measured), so it fires on a blow-up and never on variance.
  c_catastrophe constant numeric := 6.0;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_user, 'i1931 cost', 'i1931-cost', 'NGN', 'NGN', 'paystack');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility,
                             timezone, currency, published_at, show_on_discover, city)
  SELECT gen_random_uuid(), v_brand, 'cost ' || g, 'i1931-cost-' || g, 'event', 'scheduled',
         'public', 'Africa/Lagos', 'NGN', now(), true, 'Lagos'
  FROM generate_series(1, 5000) g;
  ANALYZE public.events;

  -- A — as shipped, with the deny-only conjunct in the events SELECT policy.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.events;          -- warm
  v_t0 := clock_timestamp();
  FOR v_i IN 1..3 LOOP SELECT count(*) INTO v_n FROM public.events; END LOOP;
  v_with := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000 / 3;
  RESET ROLE;

  -- B — the pre-#1931 policy shape, same data, same transaction, same machine.
  DROP POLICY "Public can read published events (anon or authenticated)" ON public.events;
  CREATE POLICY "Public can read published events (anon or authenticated)"
  ON public.events FOR SELECT TO authenticated, anon
  USING (deleted_at IS NULL AND visibility = 'public'
         AND status = ANY (ARRAY['scheduled'::text,'live'::text,'ended'::text,'cancelled'::text]));

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.events;          -- warm
  v_t0 := clock_timestamp();
  FOR v_i IN 1..3 LOOP SELECT count(*) INTO v_n FROM public.events; END LOOP;
  v_without := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000 / 3;
  RESET ROLE;

  v_ratio := round(v_with / GREATEST(v_without, 0.001), 2);

  RAISE NOTICE '#1931 READ COST — anon full scan of % events: with block % ms, without % ms, ratio %x (agreed ceiling 3.0x; a single reading in the 2.10x-3.0x band is RE-RUN, not an incident)',
    v_n, round(v_with, 2), round(v_without, 2), v_ratio;

  IF v_ratio > 2.10 AND v_ratio <= 3.0 THEN
    RAISE NOTICE '#1931 READ COST — %x is inside the re-run band. Re-run this probe before treating it as a regression.', v_ratio;
  ELSIF v_ratio > 3.0 THEN
    RAISE WARNING '#1931 READ COST — %x EXCEEDS the agreed 3.0x operating ceiling. Stop-and-amend under Amendment 6 §I; do not widen this probe.', v_ratio;
  END IF;

  IF v_ratio > c_catastrophe THEN
    RAISE EXCEPTION '#1931 read-cost CATASTROPHE: ratio %x exceeds the structural ceiling %x — the helper is no longer index-backed',
      v_ratio, c_catastrophe;
  END IF;
END $probe$;

ROLLBACK;
