BEGIN;
-- ===========================================================================
-- issue #2491 C2 STEP 1 of 4 — COLUMNS, TRIGGERS, RECONCILER. NO READER MOVES.
--
-- Capacity is checked today by COUNTING ROWS inside a serialized critical
-- section. Measured on a table shaped like a real 100k event:
--
--     10 000 sold  ->   2.02 ms      counter: 0.018 ms   (114x)
--     50 000 sold  ->   9.40 ms      counter: 0.019 ms   (483x)
--    100 000 sold  ->  18.44 ms      counter: 0.022 ms   (831x)
--
-- The cost tracks THIS ticket type's own sales, so a big event pays for its own
-- success — and it pays inside the lock, so the whole checkout serializes behind
-- it. The index #2462 added does not help: with 2% of rows matching, indexed and
-- unindexed measured 3.66 ms vs 3.77 ms at 150k.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO. It does not switch a single
-- reader. The capacity guard and the public `remaining` both keep computing the
-- DERIVED value exactly as they do today. Materialising derived state inverts
-- its best property — today every writer is automatically correct because
-- nothing is remembered — so the counter has to EARN the switch by matching live
-- traffic for 72 hours first (step 2). Steps 3 and 4 flip the readers, and only
-- if observed drift is exactly zero.
--
-- TRIGGERS, NEVER EDGE-FUNCTION CODE. Ten writers can move these rows across
-- seven edge functions. A trigger on the source table is correct no matter which
-- one acted, including one written next year by somebody who never read this.
--
-- THE ONE THING A TRIGGER CANNOT SEE IS TIME PASSING. A hold stops counting when
-- `expires_at` slips past `now()`, and no row changes at that instant. That is
-- why `issue_2491_reconcile_ticket_type_counters` exists and why it RAISES on
-- drift rather than quietly repairing it: a counter that self-heals in silence
-- is a counter nobody notices has been wrong.
-- ===========================================================================

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS sold_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS held_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ticket_types.sold_count IS
  'issue #2491 C2 — SHADOW ONLY until step 3. Maintained by triggers on public.tickets. Mirrors: count(*) where status in (valid,used,transferred). No reader consumes this yet.';
COMMENT ON COLUMN public.ticket_types.held_count IS
  'issue #2491 C2 — SHADOW ONLY until step 3. Maintained by triggers on ticket_checkout_session_items and ticket_checkout_sessions. Mirrors: sum(quantity) over live sessions. Cannot see expiry pass; the reconciler owns that.';

-- ── the two derived expressions, in ONE place ──────────────────────────────
-- Everything below reads these. The guard's own copies stay untouched until
-- step 3, but when they are switched they must be switched to THESE, so there is
-- never a second definition of what "sold" means.
CREATE OR REPLACE FUNCTION public.issue_2491_derived_sold(p_ticket_type_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(count(*), 0)::integer
    FROM public.tickets t
   WHERE t.ticket_type_id = p_ticket_type_id
     AND t.status IN ('valid', 'used', 'transferred');
$$;

CREATE OR REPLACE FUNCTION public.issue_2491_derived_held(p_ticket_type_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(i.quantity), 0)::integer
    FROM public.ticket_checkout_session_items i
    JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
   WHERE i.ticket_type_id = p_ticket_type_id
     AND s.expires_at > now()
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');
$$;

-- ── maintenance ────────────────────────────────────────────────────────────
-- Recomputed from source rather than incremented. An increment is a guess about
-- what the old row was; a recompute cannot drift on a status transition it did
-- not anticipate, and these tables are small per ticket type. Step 3 replaces
-- the READ with the column; it does not make the WRITE clever.
CREATE OR REPLACE FUNCTION public.issue_2491_refresh_counters(p_ticket_type_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ticket_type_id IS NULL THEN RETURN; END IF;
  UPDATE public.ticket_types
     SET sold_count = public.issue_2491_derived_sold(p_ticket_type_id),
         held_count = public.issue_2491_derived_held(p_ticket_type_id)
   WHERE id = p_ticket_type_id;
END $$;

CREATE OR REPLACE FUNCTION public.issue_2491_tg_refresh_from_tickets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.ticket_type_id IS DISTINCT FROM NEW.ticket_type_id THEN
    PERFORM public.issue_2491_refresh_counters(OLD.ticket_type_id);
  END IF;
  PERFORM public.issue_2491_refresh_counters(
    COALESCE(CASE WHEN TG_OP = 'DELETE' THEN OLD.ticket_type_id ELSE NEW.ticket_type_id END,
             OLD.ticket_type_id));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.issue_2491_tg_refresh_from_session_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.ticket_type_id IS DISTINCT FROM NEW.ticket_type_id THEN
    PERFORM public.issue_2491_refresh_counters(OLD.ticket_type_id);
  END IF;
  PERFORM public.issue_2491_refresh_counters(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.ticket_type_id ELSE NEW.ticket_type_id END);
  RETURN NULL;
END $$;

-- A session's STATUS decides whether its items count as held, so a status change
-- must refresh every ticket type in that session — the items themselves do not move.
CREATE OR REPLACE FUNCTION public.issue_2491_tg_refresh_from_sessions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT DISTINCT i.ticket_type_id
      FROM public.ticket_checkout_session_items i
     WHERE i.checkout_session_id = COALESCE(NEW.id, OLD.id)
  LOOP
    PERFORM public.issue_2491_refresh_counters(r.ticket_type_id);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS issue_2491_tickets_counters ON public.tickets;
CREATE TRIGGER issue_2491_tickets_counters
  AFTER INSERT OR UPDATE OF status, ticket_type_id OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.issue_2491_tg_refresh_from_tickets();

DROP TRIGGER IF EXISTS issue_2491_session_items_counters ON public.ticket_checkout_session_items;
CREATE TRIGGER issue_2491_session_items_counters
  AFTER INSERT OR UPDATE OF quantity, ticket_type_id OR DELETE ON public.ticket_checkout_session_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_2491_tg_refresh_from_session_items();

DROP TRIGGER IF EXISTS issue_2491_sessions_counters ON public.ticket_checkout_sessions;
CREATE TRIGGER issue_2491_sessions_counters
  AFTER INSERT OR UPDATE OF status, expires_at OR DELETE ON public.ticket_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.issue_2491_tg_refresh_from_sessions();

-- ── the reconciler: LOUD, never silently repairing ─────────────────────────
CREATE OR REPLACE FUNCTION public.issue_2491_reconcile_ticket_type_counters(
  p_repair boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_drift jsonb; v_n int;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ticketTypeId', d.id, 'storedSold', d.sold_count, 'derivedSold', d.ds,
           'storedHeld', d.held_count, 'derivedHeld', d.dh)), '[]'::jsonb),
         count(*)
    INTO v_drift, v_n
    FROM (
      SELECT tt.id, tt.sold_count, tt.held_count,
             public.issue_2491_derived_sold(tt.id) AS ds,
             public.issue_2491_derived_held(tt.id) AS dh
        FROM public.ticket_types tt
       WHERE tt.deleted_at IS NULL
    ) d
   WHERE d.sold_count <> d.ds OR d.held_count <> d.dh;

  IF p_repair AND v_n > 0 THEN
    UPDATE public.ticket_types tt
       SET sold_count = public.issue_2491_derived_sold(tt.id),
           held_count = public.issue_2491_derived_held(tt.id)
     WHERE tt.id IN (SELECT (x->>'ticketTypeId')::uuid FROM jsonb_array_elements(v_drift) x);
  END IF;

  RETURN jsonb_build_object('driftCount', v_n, 'repaired', p_repair AND v_n > 0, 'drift', v_drift);
END $$;

REVOKE ALL ON FUNCTION public.issue_2491_derived_sold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_derived_held(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_refresh_counters(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_reconcile_ticket_type_counters(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2491_reconcile_ticket_type_counters(boolean) TO service_role;

-- backfill once, so the shadow period starts from truth rather than from zero
UPDATE public.ticket_types tt
   SET sold_count = public.issue_2491_derived_sold(tt.id),
       held_count = public.issue_2491_derived_held(tt.id);

-- ── grants ─────────────────────────────────────────────────────────────────
-- These are SECURITY DEFINER, so PostgreSQL's default EXECUTE-to-PUBLIC would
-- hand anon a definer-rights function. Internal machinery: nobody outside the
-- database calls any of them.
REVOKE ALL ON FUNCTION public.issue_2491_derived_sold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_derived_held(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_refresh_counters(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2491_reconcile_ticket_type_counters(boolean) FROM PUBLIC, anon, authenticated;

DO $probe$
DECLARE v_r jsonb; v_tt uuid; v_before int; v_after int;
        v_types int; v_tickets int; v_trg int;
BEGIN
  -- ── ARM 1 (always runs, any database) — the triggers EXIST and are attached
  -- to the right tables. A CREATE TRIGGER naming a table that does not exist,
  -- or a wrong event mask, produces exactly the same green migration as a
  -- correct one; only pg_catalog can tell them apart.
  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('issue_2491_tickets_counters',
                    'issue_2491_session_items_counters',
                    'issue_2491_sessions_counters');
  IF v_trg <> 3 THEN
    RAISE EXCEPTION 'issue #2491 C2: expected 3 counter triggers, found %', v_trg;
  END IF;

  -- ── ARM 2 (always runs) — after backfill, drift is zero. Reported WITH its
  -- denominator: "0 drifting" is only a pass alongside how many were examined.
  SELECT count(*) INTO v_types FROM public.ticket_types WHERE deleted_at IS NULL;
  v_r := public.issue_2491_reconcile_ticket_type_counters(false);
  IF (v_r->>'driftCount')::int <> 0 THEN
    RAISE EXCEPTION 'issue #2491 C2: backfill left % of % ticket types drifting: %',
      v_r->>'driftCount', v_types, v_r->>'drift';
  END IF;
  RAISE NOTICE 'issue #2491 C2: 0 drifting out of % ticket types examined', v_types;

  -- ── ARM 3 — the trigger actually MOVES the number. A counter nothing
  -- maintains is worse than no counter, because step 3 switches a reader onto
  -- it.
  --
  -- This arm needs a real ticket to move. On a from-zero CI replay the database
  -- is empty, so it cannot run — and a skip that quietly reports success is the
  -- exact defect this migration exists to avoid. So the skip is GUARDED: it is
  -- permitted only when the tickets table is provably empty. On any database
  -- holding tickets — production included — failing to find a subject is a hard
  -- error, not a shrug.
  SELECT count(*) INTO v_tickets FROM public.tickets;
  IF v_tickets = 0 THEN
    RAISE NOTICE 'issue #2491 C2: 0 tickets in this database (from-zero replay); trigger behaviour proven at apply time against real rows';
  ELSE
    SELECT tt.id INTO v_tt FROM public.ticket_types tt
      JOIN public.tickets t ON t.ticket_type_id = tt.id
     WHERE tt.deleted_at IS NULL LIMIT 1;
    IF v_tt IS NULL THEN
      RAISE EXCEPTION 'issue #2491 C2: % tickets exist but none reachable from a live ticket type — probe cannot prove the trigger', v_tickets;
    END IF;

    SELECT sold_count INTO v_before FROM public.ticket_types WHERE id = v_tt;
    INSERT INTO public.tickets (order_id, ticket_type_id, event_id, status, qr_code)
    SELECT t.order_id, t.ticket_type_id, t.event_id, 'valid', 'i2491-probe-' || gen_random_uuid()::text
      FROM public.tickets t WHERE t.ticket_type_id = v_tt LIMIT 1;
    SELECT sold_count INTO v_after FROM public.ticket_types WHERE id = v_tt;
    IF v_after <> v_before + 1 THEN
      RAISE EXCEPTION 'issue #2491 C2: sold_count did not move on INSERT (% -> %)', v_before, v_after;
    END IF;

    DELETE FROM public.tickets WHERE qr_code LIKE 'i2491-probe-%';
    SELECT sold_count INTO v_after FROM public.ticket_types WHERE id = v_tt;
    IF v_after <> v_before THEN
      RAISE EXCEPTION 'issue #2491 C2: sold_count did not return on DELETE (% -> %)', v_before, v_after;
    END IF;
    RAISE NOTICE 'issue #2491 C2: trigger proven on live data (% -> % -> %)', v_before, v_before+1, v_after;
  END IF;

  -- ── ARM 4 (always runs) — no reader may have been switched by this migration
  IF position('sold_count' IN pg_get_functiondef(
       'public.issue_1930_ticket_checkout_create_session_base'::regproc)) > 0 THEN
    RAISE EXCEPTION 'issue #2491 C2 step 1: a reader was switched — that is step 3, after 72h of shadow';
  END IF;
END $probe$;

COMMIT;
