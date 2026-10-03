-- Issue #3645 PR9 — admin can pause/resume one brand's payouts (audited), and the
-- admin money console can see each brand's outstanding debt + a per-brand payout
-- console (balance, next payout, pause state, debts, history).
--
-- AC (from #3645):
--   * Admins can pause and resume one brand's payouts with a reason; the change is
--     audited. Paused money keeps accruing and releases on resume.
--   * Admins can see each brand's outstanding debt and what has been recovered.
--   * Admin money console: per brand balance, next payout, pause/resume, debts,
--     history.
--
-- Design (subtractive; no parallel rail; no new workflow product):
--   1. The pause state lives in a dedicated ADMIN-ONLY table,
--      brand_payout_admin_holds (brand_id PK → presence of a row == paused), NOT
--      on the broadly-writable brands row. RLS is ON with no authenticated/anon
--      policy and the table grants are service_role-only, so the only reader or
--      writer is a SECURITY DEFINER admin RPC. This is the containment the
--      pause needs: were the state a brands column, the existing authenticated
--      UPDATE grant + "Brand admin plus can update brands" RLS policy would let a
--      brand admin clear their own admin hold (money-unblocking) and read the
--      admin reason directly — the whole point of an admin hold is that only an
--      admin controls and sees it.
--   2. claim_stripe_payout_releases / claim_paystack_payout_releases are REPLACED
--      byte-for-byte from 20270727003645 (PR8) — same releasable_at maturity, same
--      payouts_enabled / recipient fail-closed, same bigint maturity-recredit
--      clamps — with ONE added eligibility clause: the brand must not be
--      admin-paused (no brand_payout_admin_holds row). A paused brand's mature
--      release therefore stays `pending` (money accrues); it is never claimed,
--      never transferred. Resume removes the row and the next sweep claims it.
--      pg_brand_can_payout and the publish/charge gates are untouched: pause is a
--      claim/execute gate ONLY.
--   3. admin_set_brand_payouts_paused(uuid,bool,text) — the ORCH-1271 golden
--      template (is_admin_user() first, reason required, row-locked, audited via
--      admin_write_audit) upserts/removes the hold row and flips a visible
--      error_message='admin_paused' marker on the brand's pending releases
--      (never clobbering waiting_for_bank; cleared on resume). No new outbox alert
--      kind is added (#1217 trap). Audited action: brand.payouts_pause /
--      brand.payouts_resume. A NULL p_paused is rejected (fail closed) so a
--      malformed admin call can never be read as "resume".
--   4. admin_list_organiser_payout_debts(...) — guard-first READ (ORCH-1274
--      containment: SECURITY DEFINER RPC, no admin RLS on the ledger; integer
--      cents, never a formatted string). { rows, total }.
--   5. admin_get_brand_payout_console(uuid) — guard-first READ bundle: pause
--      state, per-currency balance (pending/in-flight/released/waiting/paused),
--      next payout maturity, outstanding + recovered debt, and recent
--      release/debt history. Balances count the adjustment-backed maturity
--      recredit for pending/in-flight money and the delivered cash for released
--      money; the admin-paused figure is derived from the brand's hold state.
--
-- Moves no money. Live brand cutover apply stays admin-gated and awaits Seth +
-- E2E proof on both rails before production use.

BEGIN;

-- ── §1. Pause state: an ADMIN-ONLY table (presence of a row == paused) ────────
-- Kept off the brands row on purpose (see Design note 1). RLS ON with no
-- authenticated/anon policy + service_role-only grants ⇒ the sole reader/writer
-- is a SECURITY DEFINER admin RPC. A non-admin can neither resume a hold nor read
-- its reason.
CREATE TABLE IF NOT EXISTS public.brand_payout_admin_holds (
  brand_id   uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  paused_at  timestamptz NOT NULL DEFAULT now(),
  reason     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_payout_admin_holds_reason_nonempty CHECK (btrim(reason) <> '')
);

ALTER TABLE public.brand_payout_admin_holds ENABLE ROW LEVEL SECURITY;

-- RLS is ENABLED (not FORCEd) so the table owner — i.e. the SECURITY DEFINER
-- admin RPCs — keeps access, while every other role is blocked. No policy is
-- added for anon/authenticated: with RLS on and no permissive policy, the
-- broadly-granted roles can read and write NOTHING. Grants revoked to match.
REVOKE ALL ON TABLE public.brand_payout_admin_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brand_payout_admin_holds TO service_role;

COMMENT ON TABLE public.brand_payout_admin_holds IS
  'Issue #3645 PR9: admin-only brand payout hold. Presence of a row == that brand''s payouts are admin-paused. Written/read ONLY by the SECURITY DEFINER admin RPCs (admin_set_brand_payouts_paused / admin_get_brand_payout_console / claim_*); RLS-on, service_role-only so a brand admin can neither resume their own hold nor read its reason.';

-- ── §2. Claim Stripe — PR8 body + admin-pause exclusion (keeps bigint clamps) ──
CREATE OR REPLACE FUNCTION public.claim_stripe_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  stripe_account_id text,
  currency text,
  net_release_cents integer,
  maturity_recredit_cents integer,
  attempt_count integer,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT
      r.id,
      least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint)::integer AS recredit
    FROM public.brand_payout_releases r
    JOIN public.stripe_connect_accounts sca
      ON sca.brand_id=r.brand_id
     AND sca.detached_at IS NULL
     AND sca.payouts_enabled IS TRUE
    WHERE r.provider='stripe'
      AND r.stripe_payout_id IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      -- #3645 PR9: an admin-paused brand's mature money stays pending (never
      -- claimed); it keeps accruing and the next sweep claims it after resume.
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_payout_admin_holds h
        WHERE h.brand_id=r.brand_id
      )
      AND (
        r.status IN ('pending','blocked_kyc','blocked_balance')
        OR (
          r.status='in_flight'
          AND r.stripe_execution_claimed_at < p_now-interval '10 minutes'
        )
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      -- Due test in bigint: net_release_cents (integer) + the already-clamped
      -- bigint recredit must not be summed as two integers, or a combined due
      -- over int4 max would raise integer overflow and abort the whole claim
      -- RPC (stalling unrelated payouts in the sweep). bigint the predicate.
      AND r.net_release_cents::bigint + least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint) > 0
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.brand_payout_releases r
    SET status='in_flight',
        maturity_recredit_cents=eligible.recredit,
        stripe_execution_claim_id=gen_random_uuid(),
        stripe_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    sca.stripe_account_id,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.stripe_execution_claim_id
  FROM claimed c
  JOIN public.stripe_connect_accounts sca
    ON sca.brand_id=c.brand_id
   AND sca.detached_at IS NULL
   AND sca.payouts_enabled IS TRUE
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_payout_releases(integer,timestamptz)
  TO service_role;

-- ── §3. Claim Paystack — PR8 body + admin-pause exclusion (keeps bigint clamps)─
CREATE OR REPLACE FUNCTION public.claim_paystack_payout_releases(
  p_limit integer DEFAULT 20,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE(
  release_id uuid,
  brand_id uuid,
  recipient_code text,
  currency text,
  net_release_cents integer,
  maturity_recredit_cents integer,
  attempt_count integer,
  claim_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT
      r.id,
      least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint)::integer AS recredit
    FROM public.brand_payout_releases r
    JOIN public.brand_paystack_recipients rec
      ON rec.brand_id=r.brand_id AND rec.is_active
    WHERE r.provider='paystack'
      AND r.paystack_transfer_code IS NULL
      AND r.attempt_count<10
      AND r.releasable_at<=p_now
      -- #3645 PR9: skip admin-paused brands (money accrues, released on resume).
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_payout_admin_holds h
        WHERE h.brand_id=r.brand_id
      )
      AND (
        r.status IN (
          'pending','blocked_balance','blocked_otp','blocked_over_cap',
          'fee_unreconciled'
        )
        OR (
          r.status='in_flight'
          AND r.paystack_execution_claimed_at < p_now-interval '10 minutes'
        )
      )
      AND (
        r.event_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.events e
          WHERE e.id=r.event_id AND e.status<>'cancelled'
        )
      )
      -- Due test in bigint (see claim_stripe_payout_releases): avoid an int4
      -- overflow on net_release_cents + the clamped recredit aborting the RPC.
      AND r.net_release_cents::bigint + least(coalesce((
        SELECT sum(a.amount_cents)
        FROM public.payout_ledger_adjustments a
        WHERE a.release_id=r.id AND a.kind='maturity_recredit'
      ),0), 2147483647::bigint) > 0
    ORDER BY r.releasable_at,r.created_at,r.id
    FOR UPDATE OF r SKIP LOCKED
    LIMIT greatest(1,least(p_limit,100))
  ),
  claimed AS (
    UPDATE public.brand_payout_releases r
    SET status='in_flight',
        maturity_recredit_cents=eligible.recredit,
        paystack_execution_claim_id=gen_random_uuid(),
        paystack_execution_claimed_at=p_now,
        error_message=NULL,
        updated_at=p_now
    FROM eligible
    WHERE r.id=eligible.id
    RETURNING r.*
  )
  SELECT
    c.id,
    c.brand_id,
    rec.recipient_code,
    c.currency,
    c.net_release_cents,
    c.maturity_recredit_cents,
    c.attempt_count,
    c.paystack_execution_claim_id
  FROM claimed c
  JOIN public.brand_paystack_recipients rec
    ON rec.brand_id=c.brand_id AND rec.is_active
  ORDER BY c.releasable_at,c.created_at,c.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paystack_payout_releases(integer,timestamptz)
  TO service_role;

-- ── §4. admin_set_brand_payouts_paused — audited pause/resume (ORCH-1271) ──────
CREATE OR REPLACE FUNCTION public.admin_set_brand_payouts_paused(
  p_brand_id uuid,
  p_paused boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_brand public.brands;
  v_hold public.brand_payout_admin_holds;
BEGIN
  IF NOT public.is_admin_user() THEN                       -- guard FIRST
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- #3645 PR9: a NULL p_paused must NEVER be read as "resume" (the money-
  -- unblocking branch). Fail closed before touching the brand.
  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'paused_required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  SELECT * INTO v_hold FROM public.brand_payout_admin_holds WHERE brand_id = p_brand_id;
  v_before := jsonb_build_object(
    'payouts_admin_paused_at', v_hold.paused_at,
    'payouts_admin_pause_reason', v_hold.reason
  );

  IF p_paused THEN
    -- Upsert the hold. A re-pause keeps the original paused_at (first-held time)
    -- and only refreshes the reason.
    INSERT INTO public.brand_payout_admin_holds (brand_id, paused_at, reason, updated_at)
    VALUES (p_brand_id, now(), btrim(p_reason), now())
    ON CONFLICT (brand_id) DO UPDATE
      SET reason = EXCLUDED.reason, updated_at = now();

    -- Visible (non-alerting) marker on the money that is now held. Never clobber
    -- a waiting_for_bank reason; no new outbox alert kind (#1217 trap).
    UPDATE public.brand_payout_releases
    SET error_message = 'admin_paused', updated_at = now()
    WHERE brand_id = p_brand_id
      AND status = 'pending'
      AND error_message IS NULL;
  ELSE
    DELETE FROM public.brand_payout_admin_holds WHERE brand_id = p_brand_id;

    -- Clear only the marker this RPC set; leave waiting_for_bank etc. intact.
    UPDATE public.brand_payout_releases
    SET error_message = NULL, updated_at = now()
    WHERE brand_id = p_brand_id
      AND status = 'pending'
      AND error_message = 'admin_paused';
  END IF;

  SELECT * INTO v_hold FROM public.brand_payout_admin_holds WHERE brand_id = p_brand_id;
  v_after := jsonb_build_object(
    'brand_id', p_brand_id,
    'payouts_admin_paused_at', v_hold.paused_at,
    'payouts_admin_pause_reason', v_hold.reason,
    'paused', v_hold.brand_id IS NOT NULL
  );

  PERFORM public.admin_write_audit(
    CASE WHEN p_paused THEN 'brand.payouts_pause' ELSE 'brand.payouts_resume' END,
    'brand', p_brand_id::text, p_reason,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  RETURN v_after;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_brand_payouts_paused(uuid, boolean, text)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_brand_payouts_paused(uuid, boolean, text)
  TO authenticated;

COMMENT ON FUNCTION public.admin_set_brand_payouts_paused(uuid, boolean, text) IS
  'Issue #3645 PR9: admin-only (is_admin_user first, NULL paused rejected, reason required, audited via admin_write_audit) pause/resume of a brand''s payouts via the admin-only brand_payout_admin_holds table. Pause stops claim (money accrues, stays pending with a visible admin_paused marker); resume removes the hold so the next sweep claims. Does not touch charge/publish/payout-readiness. Raises not_authorized, paused_required, reason_required, brand_not_found.';

-- ── §5. admin_list_organiser_payout_debts — guard-first READ { rows, total } ──
CREATE OR REPLACE FUNCTION public.admin_list_organiser_payout_debts(
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb; v_total int;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT
      d.id,
      d.brand_id,
      b.name AS brand_name,
      b.slug AS brand_slug,
      d.currency,
      d.kind,
      d.status,
      d.principal_cents,
      d.recovered_cents,
      greatest(d.principal_cents - d.recovered_cents, 0) AS outstanding_cents,
      d.origin_release_id,
      d.maturity_at,
      d.opened_at,
      d.updated_at,
      d.closed_at
    FROM public.organiser_payout_debts d
    LEFT JOIN public.brands b ON b.id = d.brand_id
  ), filtered AS (
    SELECT * FROM base
    WHERE (p_search IS NULL
           OR brand_name ILIKE '%'||p_search||'%'
           OR brand_slug ILIKE '%'||p_search||'%'
           OR id::text = p_search
           OR origin_release_id::text = p_search)
      AND (p_status_filter IS NULL OR status = p_status_filter)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.opened_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
    INTO v_rows, v_total
    FROM (SELECT * FROM filtered ORDER BY opened_at DESC
          LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0)) f;
  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_list_organiser_payout_debts(text,text,uuid,int,int)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_organiser_payout_debts(text,text,uuid,int,int)
  TO authenticated;

-- ── §6. admin_get_brand_payout_console — guard-first per-brand bundle ─────────
CREATE OR REPLACE FUNCTION public.admin_get_brand_payout_console(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_out jsonb;
  v_brand public.brands;
  v_hold public.brand_payout_admin_holds;
  v_is_paused boolean;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT * INTO v_hold FROM public.brand_payout_admin_holds WHERE brand_id = p_brand_id;
  v_is_paused := v_hold.brand_id IS NOT NULL;

  v_out := jsonb_build_object(
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'name', v_brand.name,
      'slug', v_brand.slug,
      'payment_provider', v_brand.payment_provider,
      'payment_country', v_brand.payment_country,
      'pricing_currency', v_brand.pricing_currency,
      'default_currency', v_brand.default_currency
    ),
    'pause', jsonb_build_object(
      'paused', v_is_paused,
      'paused_at', v_hold.paused_at,
      'reason', v_hold.reason
    ),
    -- Per-currency balance roll-up over the ledger (integer cents only). Pending
    -- and in-flight money counts the adjustment-backed maturity recredit (the
    -- same amount claim sends); released money counts the delivered cash.
    -- admin_paused money is derived from the brand's hold state (brand-wide),
    -- not the incidental error_message marker, so releases created after the
    -- pause, blocked rows, and waiting_for_bank rows are all counted as held.
    'balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'currency', q.currency,
               'pending_net_cents', q.pending_net_cents,
               'in_flight_cents', q.in_flight_cents,
               'released_cents', q.released_cents,
               'blocked_cents', q.blocked_cents,
               'waiting_for_bank_cents', q.waiting_for_bank_cents,
               'admin_paused_cents', q.admin_paused_cents
             ) ORDER BY q.currency)
      FROM (
        SELECT
          r.currency,
          COALESCE(sum(r.due_cents) FILTER (WHERE r.status='pending'),0)::bigint AS pending_net_cents,
          COALESCE(sum(r.due_cents) FILTER (WHERE r.status='in_flight'),0)::bigint AS in_flight_cents,
          COALESCE(sum(r.delivered_cents) FILTER (WHERE r.status='released'),0)::bigint AS released_cents,
          -- Blocked releases remain payout obligations; both claim paths send
          -- net_release_cents + maturity_recredit, so count due_cents (a blocked
          -- row with zero net but a positive recredit is still money owed).
          COALESCE(sum(r.due_cents) FILTER (WHERE r.status IN (
            'blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
            'fee_unreconciled','blocked_anchor','reanchored'
          )),0)::bigint AS blocked_cents,
          COALESCE(sum(r.due_cents) FILTER (
            WHERE r.status='pending' AND r.error_message='waiting_for_bank'),0)::bigint AS waiting_for_bank_cents,
          -- Held by the admin pause: when a hold exists, ALL money not yet sent
          -- (pending + blocked statuses) is held by it, regardless of marker.
          COALESCE(sum(r.due_cents) FILTER (
            WHERE v_is_paused AND r.status IN (
              'pending','blocked_kyc','blocked_balance','blocked_otp',
              'blocked_over_cap','fee_unreconciled','blocked_anchor','reanchored'
            )),0)::bigint AS admin_paused_cents
        FROM (
          SELECT
            br.currency,
            br.status,
            br.net_release_cents,
            br.error_message,
            br.net_release_cents + COALESCE((
              SELECT sum(a.amount_cents)
              FROM public.payout_ledger_adjustments a
              WHERE a.release_id = br.id AND a.kind='maturity_recredit'
            ),0) AS due_cents,
            COALESCE(br.organiser_cash_delivered_cents, br.net_release_cents) AS delivered_cents
          FROM public.brand_payout_releases br
          WHERE br.brand_id = p_brand_id
        ) r
        GROUP BY r.currency
      ) q
    ), '[]'::jsonb),
    -- Earliest maturity among not-yet-released money (net + maturity recredit).
    -- This is a MATURITY timestamp, not a claim guarantee: an admin pause or a
    -- waiting-for-bank hold can still keep the money pending past this time.
    'next_payout_at', (
      SELECT min(r.releasable_at)
      FROM public.brand_payout_releases r
      WHERE r.brand_id = p_brand_id
        AND r.status = 'pending'
        AND r.net_release_cents + COALESCE((
              SELECT sum(a.amount_cents)
              FROM public.payout_ledger_adjustments a
              WHERE a.release_id = r.id AND a.kind='maturity_recredit'
            ),0) > 0
    ),
    -- Outstanding + recovered debt per currency.
    'debts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'currency', dq.currency,
               'open_outstanding_cents', dq.open_outstanding_cents,
               'open_count', dq.open_count,
               'recovered_cents', dq.recovered_cents,
               'principal_cents', dq.principal_cents
             ) ORDER BY dq.currency)
      FROM (
        SELECT
          d.currency,
          COALESCE(sum(d.principal_cents - d.recovered_cents) FILTER (WHERE d.status='open'),0)::bigint AS open_outstanding_cents,
          COALESCE(count(*) FILTER (WHERE d.status='open'),0)::int AS open_count,
          COALESCE(sum(d.recovered_cents),0)::bigint AS recovered_cents,
          COALESCE(sum(d.principal_cents),0)::bigint AS principal_cents
        FROM public.organiser_payout_debts d
        WHERE d.brand_id = p_brand_id
        GROUP BY d.currency
      ) dq
    ), '[]'::jsonb),
    -- Recent release history (newest first).
    'release_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id,
               'provider', h.provider,
               'currency', h.currency,
               'status', h.status,
               'net_release_cents', h.net_release_cents,
               'gross_cents', h.gross_cents,
               'releasable_at', h.releasable_at,
               'released_at', h.released_at,
               'error_message', h.error_message,
               'created_at', h.created_at
             ) ORDER BY h.created_at DESC)
      FROM (
        SELECT * FROM public.brand_payout_releases
        WHERE brand_id = p_brand_id
        ORDER BY created_at DESC
        LIMIT 25
      ) h
    ), '[]'::jsonb),
    -- Recent debts (newest first).
    'debt_history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', dh.id,
               'kind', dh.kind,
               'status', dh.status,
               'currency', dh.currency,
               'principal_cents', dh.principal_cents,
               'recovered_cents', dh.recovered_cents,
               'outstanding_cents', greatest(dh.principal_cents - dh.recovered_cents, 0),
               'opened_at', dh.opened_at,
               'closed_at', dh.closed_at
             ) ORDER BY dh.opened_at DESC)
      FROM (
        SELECT * FROM public.organiser_payout_debts
        WHERE brand_id = p_brand_id
        ORDER BY opened_at DESC
        LIMIT 25
      ) dh
    ), '[]'::jsonb)
  );
  RETURN v_out;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_get_brand_payout_console(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_brand_payout_console(uuid) TO authenticated;

-- ── §7. Self-asserts (apply FAILS unless the contract holds) ─────────────────
DO $guard$
DECLARE
  v_stripe text;
  v_paystack text;
BEGIN
  v_stripe := pg_get_functiondef(
    'public.claim_stripe_payout_releases(integer,timestamptz)'::regprocedure
  );
  v_paystack := pg_get_functiondef(
    'public.claim_paystack_payout_releases(integer,timestamptz)'::regprocedure
  );
  IF position('brand_payout_admin_holds' IN v_stripe) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR9: claim_stripe missing admin-pause exclusion';
  END IF;
  IF position('brand_payout_admin_holds' IN v_paystack) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR9: claim_paystack missing admin-pause exclusion';
  END IF;
  -- The hold table is admin-only: broadly-granted roles can neither read nor
  -- write it (the containment the pause depends on).
  IF has_table_privilege('authenticated', 'public.brand_payout_admin_holds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_payout_admin_holds', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.brand_payout_admin_holds', 'INSERT')
     OR has_table_privilege('authenticated', 'public.brand_payout_admin_holds', 'DELETE')
     OR has_table_privilege('anon', 'public.brand_payout_admin_holds', 'SELECT') THEN
    RAISE EXCEPTION 'issue-3645 PR9: brand_payout_admin_holds is reachable by anon/authenticated';
  END IF;
  -- claim RPCs stay service_role-only; admin RPCs stay off anon.
  IF has_function_privilege('anon',
       'public.admin_set_brand_payouts_paused(uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.admin_list_organiser_payout_debts(text,text,uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.admin_get_brand_payout_console(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR9: an admin payout RPC is EXECUTE-able by anon';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.admin_set_brand_payouts_paused(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR9: authenticated lost EXECUTE on admin_set_brand_payouts_paused';
  END IF;
  IF has_function_privilege('anon',
       'public.claim_stripe_payout_releases(integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_stripe_payout_releases(integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645 PR9: claim_stripe became callable by anon/authenticated';
  END IF;
END
$guard$;

COMMIT;

NOTIFY pgrst, 'reload schema';
