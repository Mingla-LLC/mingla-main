-- Issue #3645 — refunds and disputes on payouts that have not gone out yet.
--
-- payout_release_items is append-only (trigger payout_release_items_append_only,
-- 20270110000001). Three paths still tried to rewrite it, or lost money:
--
--   1. issue_1389_record_stay_dispute: a Stripe dispute on a stay whose payout
--      was still pending UPDATEd the item, so the webhook raised
--      payout_ledger_append_only and Stripe retried it forever.
--   2. issue_1389_sync_source_refund (trigger on source_refunds): a stay refund
--      reaching 'processed' while the payout was pending UPDATEd the item, so
--      the refund itself could never be recorded.
--   3. plan_pending_payout_partner_legs rebuilt every pending release from the
--      item sums right before both claims, and refresh_paystack_dispute_release_
--      projection dropped the debt already recovered from the release. Any
--      hold was wiped before payout and recovered debt could be paid again.
--
-- Fix, forward-only (no existing row is rewritten):
--   * stay_payout_release_holds: an append-only record of each refund and
--     dispute that lands on an unpaid stay release.
--   * issue_3645_release_projected_totals: ONE formula for a release's
--     refunded, disputed and net — Σ items, stay holds, Paystack dispute holds,
--     minus withheld debt, plus recredit. The planner and both projections use
--     it, so nothing can rebuild a release without its holds.
--   * A stay payout is refused while a held dispute is open (as Paystack does).
--     Won returns the hold; lost keeps it and lets the rest pay out. A dispute
--     already held before payout is never charged again afterwards.
--
-- Invariants and proofs: __tests__/issue_3645_unpaid_release_holds.pg17.test.sql.

BEGIN;

-- §1. Holds recorded while a stay release is unpaid. Append-only.
CREATE TABLE public.stay_payout_release_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL
    REFERENCES public.brand_payout_releases(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL
    REFERENCES public.stay_reservation_lines(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (
    kind IN ('refund', 'dispute_opened', 'dispute_won', 'dispute_lost')
  ),
  refunded_cents integer NOT NULL,
  disputed_cents integer NOT NULL,
  net_hold_cents integer NOT NULL,
  -- The refund id for 'refund', the provider dispute id otherwise.
  provider_ref text NOT NULL CHECK (char_length(provider_ref) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_payout_release_holds_one_per_kind
    UNIQUE (release_id, line_id, provider_ref, kind),
  CONSTRAINT stay_payout_release_holds_amounts CHECK (
    CASE kind
      WHEN 'refund' THEN refunded_cents >= 0 AND disputed_cents = 0
        AND net_hold_cents BETWEEN 0 AND refunded_cents
      WHEN 'dispute_opened' THEN refunded_cents = 0 AND disputed_cents >= 0
        AND net_hold_cents = disputed_cents
      WHEN 'dispute_won' THEN refunded_cents = 0 AND disputed_cents <= 0
        AND net_hold_cents = disputed_cents
      ELSE refunded_cents = 0 AND disputed_cents = 0 AND net_hold_cents = 0
    END
  )
);

CREATE INDEX stay_payout_release_holds_release_idx
  ON public.stay_payout_release_holds (release_id, line_id);

CREATE TRIGGER stay_payout_release_holds_append_only
  BEFORE UPDATE OR DELETE ON public.stay_payout_release_holds
  FOR EACH ROW EXECUTE FUNCTION public.reject_payout_append_only_mutation();

ALTER TABLE public.stay_payout_release_holds ENABLE ROW LEVEL SECURITY;
-- #1856 grant class: tables arrive with ALL for anon/authenticated by default.
REVOKE ALL ON public.stay_payout_release_holds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stay_payout_release_holds FROM service_role;
-- Only the SECURITY DEFINER dispute/refund paths write holds (a direct insert
-- would skip the projection), so the service role can read but not write.
GRANT SELECT ON public.stay_payout_release_holds TO service_role;

COMMENT ON TABLE public.stay_payout_release_holds IS
  'Issue #3645: append-only refunds and disputes recorded against an unpaid stay payout release; issue_3645_release_projected_totals reads them.';

-- §2. The one release projection.
CREATE OR REPLACE FUNCTION public.issue_3645_release_projected_totals(
  p_release_id uuid
) RETURNS TABLE (
  refunded_cents integer,
  disputed_cents integer,
  net_release_cents integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH rel AS (
    SELECT r.id, r.provider,
      r.permanent_debt_withheld_cents::bigint AS permanent_withheld,
      r.temporary_debt_withheld_cents::bigint AS temporary_withheld
    FROM public.brand_payout_releases r
    WHERE r.id = p_release_id
  ), items AS (
    SELECT
      item.gross_cents::bigint AS gross,
      item.refunded_cents::bigint AS refunded,
      item.disputed_cents::bigint AS disputed,
      item.net_cents::bigint AS net,
      -- Paystack: same evidence as paystack_release_has_unresolved_dispute
      -- (unresolved, or resolved against the merchant).
      CASE WHEN rel.provider = 'paystack' THEN coalesce((
        SELECT sum(dispute.amount_cents::bigint)
        FROM public.paystack_disputes dispute
        WHERE (
            (item.source_type = 'order' AND dispute.order_id = item.source_id)
            OR (
              item.source_type = 'rsvp_contribution'
              AND dispute.rsvp_contribution_id = item.source_id
            )
            OR (
              item.source_type = 'venue_menu_order'
              AND dispute.venue_menu_order_id = item.source_id
            )
            OR (
              item.source_type = 'order_installment'
              AND dispute.order_installment_id = item.source_id
            )
            OR (
              item.source_type = 'venue_reservation'
              AND EXISTS (
                SELECT 1
                FROM public.reservation_checkout_sessions checkout
                WHERE checkout.id = item.source_id
                  AND checkout.reservation_id = dispute.venue_reservation_id
              )
            )
          )
          AND (
            dispute.is_resolved IS NOT TRUE
            OR lower(coalesce(dispute.resolution, '')) IN (
              'merchant-accepted', 'merchant_accepted', 'accepted'
            )
          )
      ), 0) ELSE 0 END AS paystack_hold,
      coalesce(stay.refunded, 0) AS stay_refunded,
      greatest(coalesce(stay.disputed, 0), 0) AS stay_disputed,
      greatest(coalesce(stay.net_hold, 0), 0) AS stay_net_hold
    FROM rel
    JOIN public.payout_release_items item ON item.release_id = rel.id
    LEFT JOIN LATERAL (
      SELECT
        sum(hold.refunded_cents)::bigint AS refunded,
        sum(hold.disputed_cents)::bigint AS disputed,
        sum(hold.net_hold_cents)::bigint AS net_hold
      FROM public.stay_payout_release_holds hold
      WHERE item.source_type = 'stay_reservation'
        AND hold.release_id = rel.id
        AND hold.line_id = item.source_id
    ) stay ON true
  ), per_item AS (
    SELECT
      least(gross, refunded + stay_refunded) AS refunded,
      disputed + least(net, paystack_hold) + stay_disputed AS disputed,
      net - least(net, paystack_hold + stay_net_hold) AS net
    FROM items
  )
  SELECT
    least(coalesce(sum(per_item.refunded), 0), 2147483647)::integer,
    least(coalesce(sum(per_item.disputed), 0), 2147483647)::integer,
    -- maturity_recredit_cents stays out: claims pay net + recredit.
    greatest(0, least(
      coalesce(sum(per_item.net), 0)
        - rel.permanent_withheld - rel.temporary_withheld,
      2147483647
    ))::integer
  FROM rel
  LEFT JOIN per_item ON true
  GROUP BY rel.permanent_withheld, rel.temporary_withheld;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_release_projected_totals(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_release_projected_totals(uuid)
  TO service_role;

COMMENT ON FUNCTION public.issue_3645_release_projected_totals(uuid) IS
  'Issue #3645: a pending release''s refunded, disputed and net from immutable items, stay holds and Paystack dispute holds, minus withheld debt (the maturity recredit is paid on top by the claims). The only formula the planner and projections use.';

-- §3. Is a dispute held on this stay release still open?
CREATE OR REPLACE FUNCTION public.issue_3645_stay_release_has_open_dispute(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.stay_payout_release_holds opened
    WHERE opened.release_id = p_release_id
      AND opened.kind = 'dispute_opened'
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_payout_release_holds closed
        WHERE closed.release_id = opened.release_id
          AND closed.line_id = opened.line_id
          AND closed.provider_ref = opened.provider_ref
          AND closed.kind IN ('dispute_won', 'dispute_lost')
      )
  );
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_stay_release_has_open_dispute(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_stay_release_has_open_dispute(uuid)
  TO service_role;

-- §4. Re-project an unpaid stay release after a hold.
CREATE OR REPLACE FUNCTION public.issue_3645_refresh_stay_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_totals record;
  v_open boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payout_release_items item
    WHERE item.release_id = p_release_id
      AND item.source_type = 'stay_reservation'
  ) THEN
    RAISE EXCEPTION 'stay_release_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_release.status = 'released' THEN
    RETURN jsonb_build_object('release_id', p_release_id, 'projected', false);
  END IF;
  -- Never move a release while its payout is being sent: a claimed release,
  -- or a Paystack release whose transfer legs are planned or under way
  -- (a re-claim reuses those legs). The caller's event fails retryably and is
  -- redelivered once the payout settles (post-payout path) or is released.
  IF v_release.status = 'in_flight' OR EXISTS (
    SELECT 1 FROM public.payout_transfer_legs leg
    WHERE leg.release_id = p_release_id
      AND leg.status NOT IN ('failed', 'reversed')
  ) THEN
    RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';
  END IF;

  SELECT * INTO v_totals
  FROM public.issue_3645_release_projected_totals(p_release_id);
  v_open := public.issue_3645_stay_release_has_open_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET refunded_cents = v_totals.refunded_cents,
      disputed_cents = v_totals.disputed_cents,
      net_release_cents = v_totals.net_release_cents,
      -- Never overwrite another reason the release is waiting.
      error_message = CASE
        WHEN v_open THEN coalesce(error_message, 'stay_dispute_open')
        WHEN error_message = 'stay_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'projected', true,
    'refunded_cents', v_totals.refunded_cents,
    'disputed_cents', v_totals.disputed_cents,
    'net_release_cents', v_totals.net_release_cents,
    'dispute_open', v_open
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_refresh_stay_release_projection(
  uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_refresh_stay_release_projection(
  uuid, timestamptz
) TO service_role;

-- ---- issue_1389_record_stay_dispute (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.issue_1389_record_stay_dispute(p_provider_event_id text, p_provider_event_type text, p_provider_charge_ref text, p_dispute_ref text, p_amount_minor integer, p_currency_code text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_event_id uuid;
  v_line record;
  -- #3645: Stripe's 'prevented' also returns the funds.
  v_resolved boolean := lower(p_status) IN ('won', 'warning_closed', 'prevented');
  v_release public.brand_payout_releases%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor < 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_charge_ref, '')) NOT BETWEEN 3 AND 200
     OR char_length(COALESCE(p_dispute_ref, '')) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = 'stripe'
    AND (
      provider_charge_ref = p_provider_charge_ref
      OR provider_payment_ref = p_provider_charge_ref
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  IF v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR p_amount_minor > v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_provider_evidence_mismatch'
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type,
    payment_attempt_id, event_fingerprint, safe_payload
  ) VALUES (
    'stripe', p_provider_event_id, p_provider_event_type,
    v_attempt.id,
    encode(extensions.digest(
      pg_catalog.convert_to(
        p_provider_event_id || ':' || p_dispute_ref || ':' || p_status,
        'UTF8'
      ),
      'sha256'
    ), 'hex'),
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'groupId', v_group.id,
      'replayed', true
    );
  END IF;

  IF v_resolved THEN
    UPDATE public.stay_reservation_lines
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'reconciliation_required';
    UPDATE public.stay_reservation_groups
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE id = v_group.id
      AND state = 'reconciliation_required'
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = v_group.id
          AND refund_row.state IN (
            'submitted', 'processing', 'manual_reconciliation'
          )
      );
  ELSE
    UPDATE public.stay_reservation_lines
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id AND state = 'confirmed';
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN ('confirmed', 'partially_cancelled');
  END IF;

  FOR v_line IN
    WITH weights AS (
      SELECT
        line.id,
        line.total_minor,
        floor(
          p_amount_minor::numeric * line.total_minor
            / v_attempt.amount_minor
        )::integer AS amount_floor,
        (
          p_amount_minor::numeric * line.total_minor
            - floor(
              p_amount_minor::numeric * line.total_minor
                / v_attempt.amount_minor
            ) * v_attempt.amount_minor
        ) AS remainder
      FROM public.stay_reservation_lines line
      WHERE line.group_id = v_group.id
        AND line.state <> 'cancelled'
    ),
    ranked AS (
      SELECT
        weights.*,
        row_number() OVER (ORDER BY remainder DESC, id) AS remainder_rank,
        p_amount_minor - sum(amount_floor) OVER () AS extras
      FROM weights
    )
    SELECT
      id AS line_id,
      amount_floor
        + CASE WHEN remainder_rank <= extras THEN 1 ELSE 0 END
        AS disputed_minor
    FROM ranked
    ORDER BY id
  LOOP
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row
      ON release_row.id = item.release_id
    WHERE item.source_type = 'stay_reservation'
      AND item.source_id = v_line.line_id
    FOR UPDATE OF release_row;
    IF FOUND AND v_release.status <> 'released' THEN
      -- #3645: payout_release_items is append-only. An unpaid release records
      -- the dispute as a hold and its totals are re-projected; the payout is
      -- refused while the dispute is open (authorize_stripe_payout_execution).
      IF v_release.status = 'in_flight' THEN
        -- A payout is being sent right now. Fail retryably: Stripe redelivers
        -- once the release is released (post-payout path) or pending (hold).
        RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';
      END IF;
      IF v_resolved THEN
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        )
        SELECT
          opened.release_id, opened.line_id, 'dispute_won', 0,
          -opened.disputed_cents, -opened.net_hold_cents, opened.provider_ref,
          'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':won'
        FROM public.stay_payout_release_holds opened
        WHERE opened.release_id = v_release.id
          AND opened.line_id = v_line.line_id
          AND opened.provider_ref = p_dispute_ref
          AND opened.kind = 'dispute_opened'
          AND NOT EXISTS (
            SELECT 1 FROM public.stay_payout_release_holds closed
            WHERE closed.release_id = opened.release_id
              AND closed.line_id = opened.line_id
              AND closed.provider_ref = opened.provider_ref
              AND closed.kind IN ('dispute_won', 'dispute_lost')
          )
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        )
        SELECT
          v_release.id, v_line.line_id, 'dispute_opened', 0,
          v_line.disputed_minor, v_line.disputed_minor, p_dispute_ref,
          'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':opened'
        -- An older event delivered after the dispute was already won must not
        -- reopen it (Stripe does not guarantee delivery order).
        WHERE NOT EXISTS (
          SELECT 1 FROM public.stay_money_ledger resolved
          WHERE resolved.idempotency_key =
            'stay:dispute:' || p_dispute_ref || ':' || v_line.line_id || ':resolved'
        )
        ON CONFLICT DO NOTHING;
        IF lower(p_status) = 'lost' THEN
          -- Lost is final: the hold stays and the release may pay the rest.
          INSERT INTO public.stay_payout_release_holds (
            release_id, line_id, kind, refunded_cents, disputed_cents,
            net_hold_cents, provider_ref, idempotency_key
          )
          SELECT
            v_release.id, v_line.line_id, 'dispute_lost', 0, 0, 0, p_dispute_ref,
            'stay-dispute-hold:' || p_dispute_ref || ':' || v_line.line_id || ':lost'
          WHERE NOT EXISTS (
            SELECT 1 FROM public.stay_payout_release_holds closed
            WHERE closed.release_id = v_release.id
              AND closed.line_id = v_line.line_id
              AND closed.provider_ref = p_dispute_ref
              AND closed.kind IN ('dispute_won', 'dispute_lost')
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
      PERFORM public.issue_3645_refresh_stay_release_projection(
        v_release.id, now()
      );
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0
      -- #3645: money already held back before payout is never charged again.
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_payout_release_holds held
        WHERE held.release_id = v_release.id
          AND held.line_id = v_line.line_id
          AND held.provider_ref = p_dispute_ref
      ) THEN
      INSERT INTO public.payout_ledger_adjustments (
        release_id, brand_id, currency, kind, amount_cents,
        provider_ref, idempotency_key
      ) VALUES (
        v_release.id, v_release.brand_id, v_release.currency,
        CASE WHEN v_resolved
          THEN 'dispute_reversal' ELSE 'post_release_dispute' END,
        v_line.disputed_minor, p_dispute_ref,
        'stay-dispute:' || p_dispute_ref || ':' ||
          v_line.line_id || ':' ||
          CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      IF NOT v_resolved THEN
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_dispute',
          LEAST(
            v_line.disputed_minor,
            v_release.organiser_cash_delivered_cents
          ),
          now()
        );
      END IF;
    END IF;

    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.line_id, v_attempt.id,
      CASE WHEN v_resolved THEN 'payout_reversed' ELSE 'chargeback' END,
      v_line.disputed_minor, v_attempt.currency_code, p_dispute_ref,
      'stay:dispute:' || p_dispute_ref || ':' || v_line.line_id ||
        ':' || CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
      jsonb_build_object('status', lower(p_status))
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id,
    CASE WHEN v_resolved
      THEN 'stay_dispute_resolved' ELSE 'stay_dispute_recorded' END,
    'service',
    'dispute:' || p_dispute_ref || ':' ||
      CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN jsonb_build_object(
    'matched', true,
    'groupId', v_group.id,
    'brandId', v_group.brand_id,
    'resolved', v_resolved
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_record_stay_dispute(
  text, text, text, text, integer, text, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1389_record_stay_dispute(
  text, text, text, text, integer, text, text
) TO service_role;

-- ---- issue_1389_sync_source_refund (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.issue_1389_sync_source_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_refund public.stay_refunds%ROWTYPE;
  v_line record;
  v_release public.brand_payout_releases%ROWTYPE;
  v_adjustment_id uuid;
  v_target integer;
BEGIN
  IF NEW.source_type <> 'stay_reservation' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_refund
  FROM public.stay_refunds
  WHERE source_refund_id = NEW.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.stay_refunds
  SET state = CASE
        WHEN NEW.financial_state = 'reconciled' THEN 'succeeded'
        WHEN NEW.financial_state = 'failed_terminal' THEN 'failed'
        WHEN NEW.financial_state = 'needs_attention'
          THEN 'manual_reconciliation'
        WHEN NEW.buyer_state IN ('provider_pending', 'queued')
          THEN 'processing'
        ELSE state
      END,
      provider_ref = COALESCE(NEW.provider_refund_id, provider_ref),
      failure_code = NEW.last_error_code,
      processed_at = CASE
        WHEN NEW.financial_state = 'reconciled'
          THEN COALESCE(processed_at, now())
        ELSE processed_at
      END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  IF NEW.buyer_state = 'processed'
     AND OLD.buyer_state IS DISTINCT FROM 'processed' THEN
    UPDATE public.stay_refund_allocations
    SET state = 'succeeded'
    WHERE refund_id = v_refund.id
      AND state IN ('submitted', 'processing');
    UPDATE public.stay_payment_allocations payment_allocation
    SET refunded_minor = payment_allocation.refunded_minor + totals.amount_minor
    FROM (
      SELECT
        refund_allocation.payment_allocation_id,
        sum(refund_allocation.amount_minor)::bigint AS amount_minor
      FROM public.stay_refund_allocations refund_allocation
      WHERE refund_allocation.refund_id = v_refund.id
      GROUP BY refund_allocation.payment_allocation_id
    ) totals
    WHERE payment_allocation.id = totals.payment_allocation_id;

    FOR v_line IN
      SELECT
        refund_allocation.reservation_line_id AS line_id,
        sum(refund_allocation.amount_minor)::bigint AS refund_minor,
        sum(refund_allocation.organizer_liability_minor)::bigint
          AS organizer_minor
      FROM public.stay_refund_allocations refund_allocation
      WHERE refund_allocation.refund_id = v_refund.id
      GROUP BY refund_allocation.reservation_line_id
      ORDER BY refund_allocation.reservation_line_id
    LOOP
      INSERT INTO public.stay_money_ledger (
        group_id, line_id, payment_attempt_id, refund_id, entry_type,
        amount_minor, currency_code, provider_reference,
        idempotency_key, metadata
      ) VALUES (
        v_refund.group_id, v_line.line_id, v_refund.payment_attempt_id,
        v_refund.id, 'refund_succeeded', v_line.refund_minor,
        v_refund.currency_code, NEW.provider_refund_id,
        'stay:refund_succeeded:' || v_refund.id || ':' || v_line.line_id,
        jsonb_build_object('sourceRefundId', NEW.id)
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      SELECT release_row.* INTO v_release
      FROM public.payout_release_items item
      JOIN public.brand_payout_releases release_row
        ON release_row.id = item.release_id
      WHERE item.source_type = 'stay_reservation'
        AND item.source_id = v_line.line_id
      FOR UPDATE OF release_row;
      IF FOUND AND v_release.status = 'released' AND v_line.organizer_minor > 0
      THEN
        INSERT INTO public.payout_ledger_adjustments (
          release_id, brand_id, currency, kind, amount_cents,
          provider_ref, idempotency_key
        ) VALUES (
          v_release.id, v_release.brand_id, v_release.currency,
          'post_release_refund',
          LEAST(v_line.organizer_minor, 2147483647)::integer,
          NEW.provider_refund_id,
          'stay-refund-liability:' || v_refund.id || ':' || v_line.line_id
        ) ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_adjustment_id;
        SELECT LEAST(
          COALESCE(sum(adjustment.amount_cents), 0)::integer,
          v_release.organiser_cash_delivered_cents
        ) INTO v_target
        FROM public.payout_ledger_adjustments adjustment
        WHERE adjustment.release_id = v_release.id
          AND adjustment.kind = 'post_release_refund';
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_refund',
          v_target,
          now()
        );
        INSERT INTO public.stay_money_ledger (
          group_id, line_id, payment_attempt_id, refund_id,
          payout_release_id, entry_type, amount_minor, currency_code,
          provider_reference, idempotency_key, metadata
        ) VALUES (
          v_refund.group_id, v_line.line_id, v_refund.payment_attempt_id,
          v_refund.id, v_release.id, 'payout_reversal_owed',
          v_line.organizer_minor, v_refund.currency_code,
          NEW.provider_refund_id,
          'stay:payout_reversal_owed:' || v_refund.id || ':' || v_line.line_id,
          jsonb_build_object('adjustmentId', v_adjustment_id)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      ELSIF FOUND AND v_release.status <> 'released' THEN
        -- #3645: payout_release_items is append-only. The host bears only the
        -- organiser share of the refund (Mingla returns its fee share); record
        -- it as a hold and re-project the unpaid release.
        IF v_release.status = 'in_flight' THEN
          -- A payout is being sent right now: fail retryably (the refund
          -- event is redelivered once the release settles either way).
          RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';
        END IF;
        INSERT INTO public.stay_payout_release_holds (
          release_id, line_id, kind, refunded_cents, disputed_cents,
          net_hold_cents, provider_ref, idempotency_key
        ) VALUES (
          v_release.id, v_line.line_id, 'refund',
          LEAST(v_line.refund_minor, 2147483647)::integer, 0,
          LEAST(v_line.organizer_minor, 2147483647)::integer,
          v_refund.id::text,
          'stay-refund-hold:' || v_refund.id || ':' || v_line.line_id
        )
        ON CONFLICT DO NOTHING;
        PERFORM public.issue_3645_refresh_stay_release_projection(
          v_release.id, now()
        );
      END IF;
    END LOOP;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_refund.group_id, 'stay_refund_succeeded', 'service',
      'refund-succeeded:' || v_refund.id,
      jsonb_build_object(
        'refundId', v_refund.id,
        'amountMinor', v_refund.amount_minor::text,
        'currencyCode', v_refund.currency_code
      )
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  ELSIF NEW.buyer_state = 'failed_terminal'
        AND OLD.buyer_state IS DISTINCT FROM 'failed_terminal' THEN
    UPDATE public.stay_refund_allocations
    SET state = 'failed'
    WHERE refund_id = v_refund.id
      AND state IN ('submitted', 'processing');
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, refund_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_refund.group_id, v_refund.payment_attempt_id, v_refund.id,
      'refund_failed', v_refund.amount_minor, v_refund.currency_code,
      NEW.provider_refund_id,
      'stay:refund_failed:' || v_refund.id,
      jsonb_build_object('failureCode', NEW.last_error_code)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_refund.group_id, 'stay_refund_attention_required', 'service',
      'refund-failed:' || v_refund.id,
      jsonb_build_object('refundId', v_refund.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_sync_source_refund()
  FROM public, anon, authenticated;

-- ---- plan_pending_payout_partner_legs (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.plan_pending_payout_partner_legs(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_release record;
  v_split record;
  v_planned integer := 0;
  v_fee integer;
  v_stamp integer;
  v_partner_cost integer;
  v_principal_corrections integer := 0;
  v_new_corrections integer;
  v_gross integer;
  v_refunded integer;
  v_disputed integer;
  v_mingla_fee integer;
  v_item_partner_share integer;
  v_provider_fee integer;
  v_item_net integer;
  v_projected record;  -- #3645
  v_missing_attributions integer;
  v_blocked_attributions integer := 0;
BEGIN
  FOR v_release IN
    SELECT r.id
    FROM public.brand_payout_releases r
    WHERE r.status = 'pending'
    ORDER BY r.releasable_at, r.id
    LIMIT greatest(1, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*)::integer
      INTO v_missing_attributions
    FROM public.payout_release_items i
    LEFT JOIN public.payout_partner_attributions a
      ON a.order_id = i.source_id
    WHERE i.release_id = v_release.id
      AND i.source_type = 'order'
      AND i.mingla_fee_cents > 0
      AND a.order_id IS NULL;
    IF v_missing_attributions > 0 THEN
      v_blocked_attributions :=
        v_blocked_attributions + v_missing_attributions;
      CONTINUE;
    END IF;

    v_new_corrections :=
      public.reconcile_payout_partner_principal(v_release.id);
    v_principal_corrections :=
      v_principal_corrections + v_new_corrections;

    FOR v_split IN
      SELECT DISTINCT ps.id, ps.provider, ps.partner_share_cents
      FROM public.payout_release_items i
      JOIN public.partner_splits ps
        ON ps.order_id = i.source_id
       AND i.source_type = 'order'
      WHERE i.release_id = v_release.id
        AND ps.status = 'held'
        AND ps.release_id IS NULL
      ORDER BY ps.id
    LOOP
      -- Paystack cannot move a partner leg below its verified ₦50 floor.
      -- The split remains held and incurs no fee until a later contract
      -- explicitly aggregates sub-floor partner principal.
      IF v_split.provider = 'paystack'
         AND v_split.partner_share_cents < 5000 THEN
        CONTINUE;
      END IF;

      IF v_split.provider = 'paystack' THEN
        v_fee := CASE
          WHEN v_split.partner_share_cents <= 500000 THEN 1000
          WHEN v_split.partner_share_cents <= 5000000 THEN 2500
          ELSE 5000
        END;
        v_stamp := CASE
          WHEN v_split.partner_share_cents >= 1000000 THEN 5000
          ELSE 0
        END;
      ELSE
        v_fee := 0;
        v_stamp := 0;
      END IF;

      INSERT INTO public.payout_transfer_legs (
        release_id,
        partner_split_id,
        kind,
        chunk_index,
        principal_cents,
        estimated_fee_cents,
        stamp_duty_cents,
        fee_schedule_version
      )
      VALUES (
        v_release.id,
        v_split.id,
        'partner',
        0,
        v_split.partner_share_cents,
        v_fee,
        v_stamp,
        CASE
          WHEN v_split.provider = 'paystack' THEN 'verified-2026-07-24'
          ELSE 'stripe-platform-transfer-v1'
        END
      )
      ON CONFLICT (release_id, kind, partner_split_id, chunk_index)
      DO NOTHING;
      IF FOUND THEN v_planned := v_planned + 1; END IF;
    END LOOP;

    SELECT coalesce(sum(estimated_fee_cents + stamp_duty_cents), 0)::integer
      INTO v_partner_cost
    FROM public.payout_transfer_legs
    WHERE release_id = v_release.id
      AND kind = 'partner';

    SELECT
      coalesce(sum(gross_cents), 0)::integer,
      coalesce(sum(refunded_cents), 0)::integer,
      coalesce(sum(disputed_cents), 0)::integer,
      coalesce(sum(mingla_fee_cents), 0)::integer,
      coalesce(sum(partner_share_cents), 0)::integer,
      coalesce(sum(provider_fee_cents), 0)::integer,
      coalesce(sum(net_cents), 0)::integer
    INTO
      v_gross,
      v_refunded,
      v_disputed,
      v_mingla_fee,
      v_item_partner_share,
      v_provider_fee,
      v_item_net
    FROM public.payout_release_items
    WHERE release_id = v_release.id;

    SELECT coalesce(sum(amount_cents), 0)::integer
      INTO v_new_corrections
    FROM public.payout_ledger_adjustments
    WHERE release_id = v_release.id
      AND kind = 'partner_principal_correction';

    -- #3645: refunded, disputed and net come from the shared projection, so
    -- holds recorded while a release is unpaid survive every rebuild.
    SELECT * INTO v_projected
    FROM public.issue_3645_release_projected_totals(v_release.id);

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_projected.refunded_cents,
        disputed_cents = v_projected.disputed_cents,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        -- Issue #3872 (F1): partner money is Mingla's (platform balance).
        -- #3645 (Seth 2026-10-21): the host net is the sum of the STORED item
        -- nets, so a pre-flat-4.5% item keeps its old maths and a new-rule
        -- item keeps gross − mingla_fee. Never re-derive it from gross/fee.
        -- #3645: Σ item net − holds − withheld debt, computed by
        -- issue_3645_release_projected_totals. The maturity recredit is no
        -- longer folded in here: every claim and authorize already pays
        -- net_release_cents + maturity_recredit_cents, so adding it to net
        -- paid it twice.
        net_release_cents = v_projected.net_release_cents,
        updated_at = now()
    WHERE id = v_release.id;
  END LOOP;

  RETURN jsonb_build_object(
    'planned_partner_legs', v_planned,
    'partner_principal_corrections', v_principal_corrections,
    'blocked_partner_attributions', v_blocked_attributions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_pending_payout_partner_legs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_pending_payout_partner_legs(integer)
  TO service_role;

-- ---- refresh_paystack_dispute_release_projection (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.refresh_paystack_dispute_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_disputed integer;
  v_net integer;
  v_unresolved boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
    AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.status = 'released' THEN
    RAISE EXCEPTION 'pending_paystack_release_required' USING ERRCODE = 'P0001';
  END IF;

  -- #3645: one formula for every pending release (items, holds, withheld
  -- debt, recredit), shared with plan_pending_payout_partner_legs, so the
  -- debt recovered from this release is never paid out again.
  SELECT projected.disputed_cents, projected.net_release_cents
  INTO v_disputed, v_net
  FROM public.issue_3645_release_projected_totals(p_release_id) projected;

  v_unresolved := public.paystack_release_has_unresolved_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET disputed_cents = v_disputed,
      net_release_cents = v_net,
      status = CASE WHEN status = 'in_flight' THEN 'pending' ELSE status END,
      paystack_execution_claim_id = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claim_id END,
      paystack_execution_claimed_at = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claimed_at END,
      error_message = CASE
        WHEN v_unresolved THEN 'paystack_dispute_open'
        WHEN error_message = 'paystack_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'disputed_cents', v_disputed,
    'net_release_cents', v_net,
    'unresolved', v_unresolved
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.refresh_paystack_dispute_release_projection(
  uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_paystack_dispute_release_projection(
  uuid, timestamptz
) TO service_role, postgres;

-- ---- authorize_stripe_payout_execution (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.authorize_stripe_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_amount_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases;
  v_event_status text;
  v_expected integer;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id=p_release_id AND provider='stripe'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stripe_release_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_release.stripe_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status<>'in_flight'
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale_stripe_execution_claim' USING ERRCODE='P0001';
  END IF;
  -- #3645: like Paystack, fail closed while a stay dispute held on this
  -- unpaid release is open. Won returns the hold; lost keeps it and unblocks.
  IF public.issue_3645_stay_release_has_open_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='stay_dispute_open',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;
  v_expected:=v_release.net_release_cents+v_release.maturity_recredit_cents;
  IF p_amount_cents IS DISTINCT FROM v_expected OR v_expected<=0 THEN
    RAISE EXCEPTION 'stripe_release_amount_not_ledger_exact'
      USING ERRCODE='P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id=v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status='blocked_anchor',
          error_message='missing_live_event_truth',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
    IF v_event_status='cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status='cancelled_event',
          error_message='event_cancelled_before_stripe_payout',
          stripe_execution_claim_id=NULL,
          stripe_execution_claimed_at=NULL,
          updated_at=p_now
      WHERE id=p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status='pending',
        error_message='release_no_longer_mature',
        stripe_execution_claim_id=NULL,
        stripe_execution_claimed_at=NULL,
        updated_at=p_now
    WHERE id=p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_stripe_payout_execution(
  uuid,uuid,integer,timestamptz
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_stripe_payout_execution(
  uuid,uuid,integer,timestamptz
) TO service_role;

-- ---- claim_stripe_payout_releases (source and hunks: __tests__/issue_3645_reemit_hunks.ts)
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
      -- #3645: a stay release held by an open dispute waits without taking
      -- one of the claim slots, so it cannot starve newer payouts.
      AND NOT public.issue_3645_stay_release_has_open_dispute(r.id)
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

COMMIT;
