/**
 * issue #3645 bundle 2d — the ONLY authorised hunks for every function
 * 20280508003645 re-emits. issue_3645_debt_return_reemit_hunks.structural.test.ts
 * proves each body equals the latest earlier definition with exactly these
 * replacements applied. Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280508003645_issue_3645_payout_debt_returns.sql";

/** Functions this migration defines for the first time (not re-emits). */
export const DEBT_RETURN_NEW_FUNCTIONS = [
  "issue_3645_check_debt_application_return",
  "issue_3645_application_returned_cents",
  "issue_3645_release_effective_withheld",
  "issue_3645_release_settleable",
  "issue_3645_return_unrecovered_release_debt",
  "issue_3645_settle_release_projection",
];

export const DEBT_RETURN_REEMITS: Reemit[] = [
  {
    fn: "issue_3645_release_projected_totals",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "also return the item net and the effective withheld the returner needs",
        old: "  net_release_cents integer\n)\n",
        new: "  net_release_cents integer,\n  items_net_cents bigint,\n  withheld_cents bigint\n)\n",
      },
      {
        name: "withheld debt is the applications' effective amount, net of conversions and returns",
        old: "      r.permanent_debt_withheld_cents::bigint AS permanent_withheld,\n      r.temporary_debt_withheld_cents::bigint AS temporary_withheld\n",
        new: "      -- #3645 2d: Σ(amount − converted − returned) over the release's\n      -- applications, not the attach-time columns, so debt handed back by\n      -- issue_3645_return_unrecovered_release_debt is no longer withheld.\n      public.issue_3645_release_effective_withheld(r.id) AS withheld\n",
      },
      {
        name: "subtract the effective withheld",
        old: "        - rel.permanent_withheld - rel.temporary_withheld,\n",
        new: "        - rel.withheld,\n",
      },
      {
        name: "report N and W",
        old: "    ))::integer\n  FROM rel\n",
        new: "    ))::integer,\n    coalesce(sum(per_item.net), 0)::bigint,\n    rel.withheld\n  FROM rel\n",
      },
      {
        name: "group by the effective withheld",
        old: "  GROUP BY rel.permanent_withheld, rel.temporary_withheld;\n",
        new: "  GROUP BY rel.withheld;\n",
      },
    ],
  },
  {
    fn: "issue_3645_refresh_stay_release_projection",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "only an organiser leg under way blocks the refresh (partner money is Mingla's)",
        old: "    WHERE leg.release_id = p_release_id\n      AND leg.status NOT IN ('failed', 'reversed')\n  ) THEN\n    RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';\n",
        new: "    WHERE leg.release_id = p_release_id\n      AND leg.kind = 'organiser'  -- #3645 2d: partner legs never block\n      AND leg.status NOT IN ('failed', 'reversed')\n  ) THEN\n    RAISE EXCEPTION 'stay_release_payout_in_flight' USING ERRCODE = '55P03';\n",
      },
      {
        name: "project through settle, which first hands back debt the holds left unrecovered",
        old: "  FROM public.issue_3645_release_projected_totals(p_release_id);\n  v_open := ",
        new: "  FROM public.issue_3645_settle_release_projection(p_release_id, p_now);\n  v_open := ",
      },
    ],
  },
  {
    fn: "refresh_paystack_dispute_release_projection",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "reset an in-flight claim before settling, so the returner sees the release as unpaid",
        old: "  -- #3645: one formula for every pending release (items, holds, withheld\n",
        new: "  -- #3645 2d: release an in-flight claim first (the same reset as below),\n  -- so settle sees the release as unpaid and can hand back unrecovered debt.\n  IF v_release.status = 'in_flight' THEN\n    UPDATE public.brand_payout_releases\n    SET status = 'pending',\n        paystack_execution_claim_id = NULL,\n        paystack_execution_claimed_at = NULL,\n        updated_at = p_now\n    WHERE id = p_release_id;\n  END IF;\n\n  -- #3645: one formula for every pending release (items, holds, withheld\n",
      },
      {
        name: "project through settle",
        old: "  FROM public.issue_3645_release_projected_totals(p_release_id) projected;\n",
        new: "  FROM public.issue_3645_settle_release_projection(p_release_id, p_now) projected;\n",
      },
    ],
  },
  {
    fn: "plan_pending_payout_partner_legs",
    source: "supabase/migrations/20280422003645_issue_3645_unpaid_release_holds.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the lock timeout holder",
        old: "  v_projected record;  -- #3645\n",
        new: "  v_projected record;  -- #3645\n  v_lock_timeout text;  -- #3645 2d\n",
      },
      {
        name: "settle each release; a failure falls back to today's projection and never stops the batch",
        old: "    SELECT * INTO v_projected\n    FROM public.issue_3645_release_projected_totals(v_release.id);\n",
        new: "    -- #3645 2d: settle first hands back debt that holds left unrecovered.\n    -- A failure on one release (a busy debt, a broken invariant) must not stop\n    -- every payout: roll back just that settle, warn with the SQLSTATE, and\n    -- use today's projection; the next pass retries.\n    v_lock_timeout := current_setting('lock_timeout');\n    BEGIN\n      PERFORM set_config('lock_timeout', '2s', true);\n      SELECT * INTO v_projected\n      FROM public.issue_3645_settle_release_projection(v_release.id, now());\n      PERFORM set_config('lock_timeout', v_lock_timeout, true);\n    EXCEPTION WHEN OTHERS THEN\n      PERFORM set_config('lock_timeout', v_lock_timeout, true);\n      RAISE WARNING 'issue_3645_settle_failed release=% sqlstate=% message=%',\n        v_release.id, SQLSTATE, SQLERRM;\n      SELECT * INTO v_projected\n      FROM public.issue_3645_release_projected_totals(v_release.id);\n    END;\n",
      },
    ],
  },
  {
    fn: "mature_postponement_debts",
    source: "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the per-application effective amount",
        old: "DECLARE v_debt record; v_app record; v_recredit integer; v_count integer:=0;\n",
        new: "DECLARE v_debt record; v_app record; v_recredit integer; v_count integer:=0;\n  v_return_id uuid;  -- #3645 2d\n",
      },
      {
        name: "lock every release the debt returns into without waiting; skip the whole debt this tick if one is busy or in flight",
        old: "     ORDER BY maturity_at,id FOR UPDATE SKIP LOCKED\n  LOOP\n",
        new: "     ORDER BY maturity_at,id FOR UPDATE SKIP LOCKED\n  LOOP\n    -- #3645 2d: every release this debt touches is locked up front, without\n    -- waiting (the returner locks release, then debt). If one is busy, or a\n    -- payout is in flight on it, nothing of this debt is done this tick:\n    -- no released_at, no recredit, no return, no writeoff, no close.\n    BEGIN\n      PERFORM 1 FROM public.brand_payout_releases r\n      WHERE r.id IN (\n        SELECT a.release_id FROM public.payout_debt_applications a\n        WHERE a.debt_id=v_debt.id AND a.released_at IS NULL\n      )\n      ORDER BY r.id FOR UPDATE NOWAIT;\n      -- and every debt withheld from those releases, so settling them below\n      -- never waits on another transaction.\n      PERFORM 1 FROM public.organiser_payout_debts d\n      WHERE d.id IN (\n        SELECT a2.debt_id FROM public.payout_debt_applications a2\n        WHERE a2.release_id IN (\n          SELECT a.release_id FROM public.payout_debt_applications a\n          WHERE a.debt_id=v_debt.id AND a.released_at IS NULL\n        )\n      )\n      ORDER BY d.id FOR UPDATE NOWAIT;\n    EXCEPTION WHEN lock_not_available THEN\n      CONTINUE;\n    END;\n    IF EXISTS (\n      SELECT 1 FROM public.payout_debt_applications a\n      JOIN public.brand_payout_releases r ON r.id=a.release_id\n      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL\n        AND r.status='in_flight'\n    ) THEN\n      CONTINUE;\n    END IF;\n    -- #3645 2d: settle each unpaid release first, so the part holds left\n    -- uncovered is handed back as a 'hold' return (and written off below)\n    -- before maturity hands the rest back through net. Maturity and settle\n    -- then end in the same state whichever runs first.\n    PERFORM public.issue_3645_return_unrecovered_release_debt(x.release_id, p_now)\n    FROM (\n      SELECT DISTINCT a.release_id FROM public.payout_debt_applications a\n      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL\n    ) x;\n    -- Store the settled projection on each of those unpaid releases now: a\n    -- hand-back above may leave nothing for maturity to return below, and a\n    -- blocked release is claimed (Stripe) without the planner re-projecting.\n    UPDATE public.brand_payout_releases r SET\n      refunded_cents=projected.refunded_cents,\n      disputed_cents=projected.disputed_cents,\n      net_release_cents=projected.net_release_cents,\n      updated_at=p_now\n    FROM (\n      SELECT DISTINCT a.release_id FROM public.payout_debt_applications a\n      WHERE a.debt_id=v_debt.id AND a.released_at IS NULL\n    ) x\n    CROSS JOIN LATERAL public.issue_3645_release_projected_totals(x.release_id) projected\n    WHERE r.id=x.release_id AND public.issue_3645_release_settleable(r.id);\n    SELECT * INTO v_debt FROM public.organiser_payout_debts WHERE id=v_debt.id;\n",
      },
      {
        name: "an unpaid release gets the withheld part back through net instead of a recredit on top",
        old: "      v_recredit:=v_app.amount_cents-v_app.converted_cents;\n      IF v_recredit>0 THEN\n",
        new: "      -- #3645 2d: what this application still withholds.\n      v_recredit:=v_app.amount_cents-v_app.converted_cents\n        -public.issue_3645_application_returned_cents(v_app.id);\n      IF v_recredit>0 AND public.issue_3645_release_settleable(v_app.release_id) THEN\n        -- #3645 2d: the release is unpaid, so hand the withheld part back\n        -- through net (a 'matured' return) instead of booking a recredit on\n        -- top: net = max(0, N − W) cannot overpay when holds shrank N, and a\n        -- recredit can. recovered_cents is NOT lowered: the debt is closed\n        -- below and its writeoff stays principal − recovered as read above.\n        INSERT INTO public.payout_debt_application_returns(\n          application_id,debt_id,release_id,reason,amount_cents,idempotency_key,created_at\n        ) VALUES(\n          v_app.id,v_debt.id,v_app.release_id,'matured',v_recredit,\n          'postpone-return:'||v_app.id,p_now\n        ) ON CONFLICT(idempotency_key) DO NOTHING\n        RETURNING id INTO v_return_id;\n        IF v_return_id IS NOT NULL THEN\n          UPDATE public.brand_payout_releases r SET\n            net_release_cents=projected.net_release_cents,updated_at=p_now\n          FROM public.issue_3645_release_projected_totals(v_app.release_id) projected\n          WHERE r.id=v_app.release_id;\n          INSERT INTO public.payout_debt_events(\n            debt_id,event_kind,amount_cents,anchor_at,release_id,idempotency_key\n          ) VALUES(\n            v_debt.id,'future_value_released',v_recredit,v_debt.maturity_at,\n            v_app.release_id,'postpone-released:'||v_app.id\n          ) ON CONFLICT(idempotency_key) DO NOTHING;\n        END IF;\n      ELSIF v_recredit>0 THEN\n",
      },
    ],
  },
  {
    fn: "apply_open_payout_debts",
    source: "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
    target: TARGET,
    hunks: [
      {
        name: "the cleared key names the release, so a reopened debt clears again",
        old: "            'permanent-cleared:'||v_debt.id,p_now\n",
        new: "            'permanent-cleared:'||v_debt.id||':'||p_release_id,p_now  -- #3645 2d\n",
      },
    ],
  },
  {
    fn: "convert_postponement_debt_to_permanent",
    source: "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
    target: TARGET,
    hunks: [
      {
        name: "key-share the target releases before locking the postponement debt",
        old: "  SELECT * INTO v_temp FROM public.organiser_payout_debts\n  WHERE origin_release_id=p_origin_release_id\n    AND kind='post_release_postponement' AND status='open'\n  FOR UPDATE;\n",
        new: "  -- #3645 2d: key-share the releases a conversion may insert onto before any\n  -- debt lock, as settle locks release then debt (else the two deadlock).\n  PERFORM 1 FROM public.brand_payout_releases r\n  WHERE r.id IN (\n    SELECT a.release_id FROM public.payout_debt_applications a\n    JOIN public.organiser_payout_debts d ON d.id=a.debt_id\n    WHERE d.origin_release_id=p_origin_release_id\n      AND d.kind='post_release_postponement' AND a.released_at IS NULL\n  )\n  ORDER BY r.id FOR KEY SHARE;\n  SELECT * INTO v_temp FROM public.organiser_payout_debts\n  WHERE origin_release_id=p_origin_release_id\n    AND kind='post_release_postponement' AND status='open'\n  FOR UPDATE;\n",
      },
      {
        name: "pick only applications with an unreturned part",
        old: "      WHERE debt_id=v_temp.id AND released_at IS NULL\n        AND amount_cents>converted_cents\n      ORDER BY created_at,id FOR UPDATE\n",
        new: "      WHERE debt_id=v_temp.id AND released_at IS NULL\n        AND amount_cents>converted_cents\n          +public.issue_3645_application_returned_cents(id)  -- #3645 2d\n      ORDER BY created_at,id FOR UPDATE\n",
      },
      {
        name: "take at most the unreturned part",
        old: "      v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents);\n",
        new: "      v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents\n        -public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d\n",
      },
    ],
  },
  {
    fn: "record_paystack_refund_outcome",
    source: "supabase/migrations/20280204003645_issue_3645_installment_refunds_disputes_payouts.sql",
    target: TARGET,
    hunks: [
      {
        name: "lock this release's refund and postponement debts in id order (the returner's order)",
        old: "  SELECT * INTO v_debt FROM public.organiser_payout_debts\n  WHERE origin_release_id=v_release.id AND kind='post_release_refund'\n  FOR UPDATE;\n",
        new: "  -- #3645 2d: key-share the releases a conversion may insert onto, then\n  -- lock both debts in id order: settle locks release, then debts.\n  PERFORM 1 FROM public.brand_payout_releases r\n  WHERE r.id IN (\n    SELECT a.release_id FROM public.payout_debt_applications a\n    JOIN public.organiser_payout_debts d ON d.id=a.debt_id\n    WHERE d.origin_release_id=v_release.id\n      AND d.kind='post_release_postponement' AND a.released_at IS NULL\n  )\n  ORDER BY r.id FOR KEY SHARE;\n  PERFORM 1 FROM public.organiser_payout_debts\n  WHERE origin_release_id=v_release.id\n    AND kind IN ('post_release_refund','post_release_postponement')\n  ORDER BY id FOR UPDATE;\n  SELECT * INTO v_debt FROM public.organiser_payout_debts\n  WHERE origin_release_id=v_release.id AND kind='post_release_refund'\n  FOR UPDATE;\n",
      },
      {
        name: "pick only applications with an unreturned part",
        old: "        WHERE debt_id=v_temp.id AND released_at IS NULL\n          AND amount_cents>converted_cents\n",
        new: "        WHERE debt_id=v_temp.id AND released_at IS NULL\n          AND amount_cents>converted_cents\n            +public.issue_3645_application_returned_cents(id)  -- #3645 2d\n",
      },
      {
        name: "take at most the unreturned part",
        old: "        v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents);\n",
        new: "        v_take:=least(v_left,v_app.amount_cents-v_app.converted_cents\n          -public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d\n",
      },
    ],
  },
  {
    fn: "record_paystack_dispute_outcome_pre_3645_append_only_fix",
    source: "supabase/migrations/20280204003645_issue_3645_installment_refunds_disputes_payouts.sql",
    target: TARGET,
    hunks: [
      {
        name: "lock this release's dispute and postponement debts in id order (the returner's order)",
        old: "        SELECT * INTO v_debt FROM public.organiser_payout_debts\n        WHERE origin_release_id = v_release.id AND kind = 'post_release_dispute'\n        FOR UPDATE;\n",
        new: "        -- #3645 2d: key-share the releases a conversion may insert onto, then\n        -- lock both debts in id order: settle locks release, then debts.\n        PERFORM 1 FROM public.brand_payout_releases r\n        WHERE r.id IN (\n          SELECT a.release_id FROM public.payout_debt_applications a\n          JOIN public.organiser_payout_debts d ON d.id = a.debt_id\n          WHERE d.origin_release_id = v_release.id\n            AND d.kind = 'post_release_postponement' AND a.released_at IS NULL\n        )\n        ORDER BY r.id FOR KEY SHARE;\n        PERFORM 1 FROM public.organiser_payout_debts\n        WHERE origin_release_id = v_release.id\n          AND kind IN ('post_release_dispute', 'post_release_postponement')\n        ORDER BY id FOR UPDATE;\n        SELECT * INTO v_debt FROM public.organiser_payout_debts\n        WHERE origin_release_id = v_release.id AND kind = 'post_release_dispute'\n        FOR UPDATE;\n",
      },
      {
        name: "pick only applications with an unreturned part",
        old: "              WHERE debt_id = v_temp.id AND released_at IS NULL\n                AND amount_cents > converted_cents\n",
        new: "              WHERE debt_id = v_temp.id AND released_at IS NULL\n                AND amount_cents > converted_cents\n                  + public.issue_3645_application_returned_cents(id)  -- #3645 2d\n",
      },
      {
        name: "take at most the unreturned part",
        old: "              v_take := least(v_left, v_app.amount_cents - v_app.converted_cents);\n",
        new: "              v_take := least(v_left, v_app.amount_cents - v_app.converted_cents\n                - public.issue_3645_application_returned_cents(v_app.id));  -- #3645 2d\n",
      },
    ],
  },
  {
    fn: "protect_payout_debt_application",
    source: "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
    target: TARGET,
    hunks: [
      {
        name: "a conversion never takes a part that was handed back, whoever updates the row",
        old: "     AND NEW.converted_cents>=OLD.converted_cents\n     AND NEW.idempotency_key=OLD.idempotency_key AND NEW.created_at=OLD.created_at THEN\n    RETURN NEW;\n",
        new: "     AND NEW.converted_cents>=OLD.converted_cents\n     AND NEW.idempotency_key=OLD.idempotency_key AND NEW.created_at=OLD.created_at THEN\n    -- #3645 2d: the same bound the returns trigger keeps, from this side.\n    IF NEW.converted_cents>OLD.converted_cents\n       AND NEW.converted_cents::bigint\n         +public.issue_3645_application_returned_cents(NEW.id)>NEW.amount_cents THEN\n      RAISE EXCEPTION 'debt_conversion_exceeds_application' USING ERRCODE='23514';\n    END IF;\n    RETURN NEW;\n",
      },
    ],
  },
  {
    fn: "cancel_event_refund_prepare",
    source: "supabase/migrations/20280204003645_issue_3645_installment_refunds_disputes_payouts.sql",
    target: TARGET,
    hunks: [
      {
        name: "key-share the releases the conversion may insert onto before locking the postponement debt",
        old: "  LOOP\n    SELECT * INTO v_temp FROM public.organiser_payout_debts\n    WHERE origin_release_id = v_release.release_id\n      AND kind = 'post_release_postponement'\n      AND status = 'open'\n    FOR UPDATE;\n",
        new: "  LOOP\n    -- #3645 2d: key-share the releases the conversion may insert onto before\n    -- the debt lock, as settle locks release, then debt (else they deadlock).\n    PERFORM 1 FROM public.brand_payout_releases r\n    WHERE r.id IN (\n      SELECT a.release_id FROM public.payout_debt_applications a\n      JOIN public.organiser_payout_debts d ON d.id = a.debt_id\n      WHERE d.origin_release_id = v_release.release_id\n        AND d.kind = 'post_release_postponement' AND a.released_at IS NULL\n    )\n    ORDER BY r.id FOR KEY SHARE;\n    SELECT * INTO v_temp FROM public.organiser_payout_debts\n    WHERE origin_release_id = v_release.release_id\n      AND kind = 'post_release_postponement'\n      AND status = 'open'\n    FOR UPDATE;\n",
      },
    ],
  },
];
