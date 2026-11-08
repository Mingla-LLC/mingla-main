/**
 * issue #3645 bundle 2c — the ONLY authorised hunks for every function
 * 20280503003645 re-emits. issue_3645_float_forecast_reemit_hunks.structural.test.ts
 * proves each body equals the latest earlier definition with exactly these
 * replacements applied. Generated; edit the hunks here and the migration together.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET = "supabase/migrations/20280503003645_issue_3645_float_forecast_alerts.sql";

/** Functions this migration defines for the first time (not re-emits). */
export const FLOAT_FORECAST_NEW_FUNCTIONS = [
  "issue_3645_unattached_payout_sources",
  "issue_3645_mark_mingla_float_covered",
  "issue_3645_raise_stale_stay_dispute_alerts",
];

export const FLOAT_FORECAST_REEMITS: Reemit[] = [
  {
    fn: "paystack_payout_float_obligation",
    source: "supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the unattached totals",
        old: "  v_earliest timestamptz;\nBEGIN\n",
        new: "  v_earliest timestamptz;\n  -- issue #3645: paid Paystack sales the sweep has not attached yet.\n  v_unattached_kobo bigint := 0;\n  v_unattached_count integer := 0;\n  v_unattached_earliest timestamptz;\nBEGIN\n",
      },
      {
        name: "add paid Paystack sales maturing inside the horizon that are not attached yet",
        old: "  INTO v_obligation,v_count,v_earliest,v_anchor_release,v_anchor_brand\n  FROM owed o;\n",
        new: "  INTO v_obligation,v_count,v_earliest,v_anchor_release,v_anchor_brand\n  FROM owed o;\n\n  -- issue #3645: a sale only becomes a release when it matures, so counting\n  -- releases alone read 0 until the moment the money was due. Add every paid\n  -- Paystack sale that matures inside the horizon and is not attached yet, at\n  -- the net its release will store. Debts are not subtracted (over-inclusion\n  -- is the safe direction for a top-up warning). The anchor stays release-only.\n  SELECT coalesce(sum(u.net_cents),0), count(*)::integer,\n         min(u.finalized_at + interval '1 day')\n  INTO v_unattached_kobo, v_unattached_count, v_unattached_earliest\n  FROM public.issue_3645_unattached_payout_sources(v_horizon_end) u\n  WHERE u.provider='paystack' AND u.currency='ngn' AND u.net_cents>0;\n\n  v_obligation := coalesce(v_obligation,0) + v_unattached_kobo;\n  v_earliest := least(v_earliest, v_unattached_earliest);\n",
      },
      {
        name: "report the unattached totals",
        old: "    'anchor_brand_id',v_anchor_brand\n  );\n",
        new: "    'anchor_brand_id',v_anchor_brand,\n    'unattached_count',v_unattached_count,\n    'unattached_kobo',v_unattached_kobo\n  );\n",
      },
    ],
  },
  {
    fn: "raise_paystack_float_shortfall_alert",
    source: "supabase/migrations/20270320001840_issue_1840_ng_payout_float_alerts.sql",
    target: TARGET,
    hunks: [
      {
        name: "declare the row key base",
        old: "  v_verdict text;\nBEGIN\n",
        new: "  v_verdict text;\n  -- issue #3645: the release id, or 'mingla' for the one Mingla-wide row used\n  -- when the shortfall is made only of sales that are not releases yet.\n  v_key_base text;\nBEGIN\n",
      },
      {
        name: "a shortfall with no release uses the Mingla-wide row; the global row re-arms when it is not the one raising",
        old: "  IF v_obligation<=0 OR v_anchor_release IS NULL OR v_shortfall<=0 THEN\n",
        new: "  -- issue #3645: whenever the Mingla-wide row is not the one raising (no\n  -- shortfall, or a release anchors it), mark it covered so the next\n  -- release-less shortfall is raised at once instead of waiting out the bounds.\n  -- (The sweep calls the same function when the obligation is 0, because it\n  -- does not call this raise then.)\n  IF v_obligation<=0 OR v_shortfall<=0 OR v_anchor_release IS NOT NULL THEN\n    PERFORM public.issue_3645_mark_mingla_float_covered(p_now);\n  END IF;\n  v_key_base := coalesce(v_anchor_release::text,'mingla');\n\n  IF v_obligation<=0 OR v_shortfall<=0 THEN\n",
      },
      {
        name: "look up the anchored row, or the Mingla-wide row when there is no release",
        old: "  WHERE release_id=v_anchor_release AND alert_kind='paystack_float_shortfall'\n  FOR UPDATE;\n",
        new: "  WHERE alert_kind='paystack_float_shortfall'\n    AND (release_id=v_anchor_release\n         OR (v_anchor_release IS NULL AND release_id IS NULL))\n  FOR UPDATE;\n",
      },
      {
        name: "first key uses the key base",
        old: "      'paystack_float_shortfall:'||v_anchor_release::text||':r1',\n",
        new: "      'paystack_float_shortfall:'||v_key_base||':r1',\n",
      },
      {
        name: "a concurrent first insert of either row shape is suppressed, never an error",
        old: "    ) ON CONFLICT (release_id, alert_kind) DO NOTHING;\n    GET DIAGNOSTICS v_written = ROW_COUNT;\n",
        new: "    ) ON CONFLICT DO NOTHING;  -- issue #3645: (release_id, alert_kind) or the Mingla-wide index\n    GET DIAGNOSTICS v_written = ROW_COUNT;\n",
      },
      {
        name: "a row marked covered re-alerts at once",
        old: "      AND left(v_message,1000) IS DISTINCT FROM v_existing.error_message\n    )\n  ) THEN\n",
        new: "      AND left(v_message,1000) IS DISTINCT FROM v_existing.error_message\n    )\n    -- 4. issue #3645: marked covered since it was last alerted (the\n    -- Mingla-wide row), so a new shortfall is a new alert\n    OR (v_existing.release_id IS NULL\n        AND coalesce(v_existing.alert_magnitude_kobo,1)=0)\n  ) THEN\n",
      },
      {
        name: "revision key uses the key base",
        old: "      idempotency_key='paystack_float_shortfall:'||v_anchor_release::text\n",
        new: "      idempotency_key='paystack_float_shortfall:'||v_key_base\n",
      },
    ],
  },
  {
    fn: "claim_payout_release_alerts",
    source: "supabase/migrations/20270727003645_issue_3645_no_silent_skip_waiting_for_bank.sql",
    target: TARGET,
    hunks: [
      {
        name: "the drain delivers the stale stay dispute kind (the #1217 trap)",
        old: "        'waiting_for_bank'\n      )\n",
        new: "        'waiting_for_bank',\n        'stay_dispute_hold_open'  -- issue #3645\n      )\n",
      },
    ],
  },
];
