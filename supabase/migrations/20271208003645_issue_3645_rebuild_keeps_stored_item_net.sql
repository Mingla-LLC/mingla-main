-- #3645 (Seth, 2026-10-21) — a pending payout's net is rebuilt from the
-- STORED per-item nets, never re-derived from gross and fee.
--
-- 20271206003645_issue_3645_flat_45_host_net.sql made attach_payout_release
-- store each item's net under the flat 4.5% rule (gross − refunds − disputes −
-- mingla_fee), but its plan_pending_payout_partner_legs rebuild recomputed the
-- release net from the item sums with that same formula. The sweep runs the
-- planner on every pending release, so a payout attached BEFORE the change
-- (whose items still carry the provider fee in their stored net) was silently
-- re-netted under the new rule. Seth's decision: payouts created before the
-- flat-4.5% change keep their stored old maths; new-rule items already store
-- gross − mingla_fee, so summing stored nets is correct for both.
--
-- Only the net_release_cents expression changes: it now reads
-- sum(payout_release_items.net_cents) instead of
-- v_gross − v_refunded − v_disputed − v_mingla_fee. Debt withholding,
-- maturity re-credit, partner legs and corrections are unchanged.

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

    -- Rebuild from immutable items plus append-only corrections so retries
    -- cannot double-deduct either principal or transfer costs.
    UPDATE public.brand_payout_releases
    SET gross_cents = v_gross,
        refunded_cents = v_refunded,
        disputed_cents = v_disputed,
        mingla_fee_cents = v_mingla_fee,
        partner_share_cents = v_item_partner_share + v_new_corrections,
        provider_fee_cents = v_provider_fee,
        -- Issue #3872 (F1): partner money is Mingla's (platform balance).
        -- #3645 (Seth 2026-10-21): the host net is the sum of the STORED item
        -- nets, so a pre-flat-4.5% item keeps its old maths and a new-rule
        -- item keeps gross − mingla_fee. Never re-derive it from gross/fee.
        net_release_cents = greatest(
          0,
          v_item_net
          - permanent_debt_withheld_cents - temporary_debt_withheld_cents
          + maturity_recredit_cents
        ),
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
