/**
 * Issue #3645 — payout fee capture gaps.
 *
 *  (a) Paid stays get their provider fee: the sweep reads the stay family
 *      (list_missing_stay_provider_fees) in its own 100-row batch and records
 *      it with record_stay_provider_fee, which run_stay_payout_release_dark_sweep
 *      needs before it attaches a stay. Before, nothing read that family.
 *  (b) A hosted chip-in stored with only its Checkout Session id (cs_) gets its
 *      fee through the session's PaymentIntent. Before, cs_ threw
 *      unsupported_stripe_provider_reference on every sweep, forever.
 *  (c) Stripe instalment fee candidates land as order_installment snapshots.
 *
 * Fails on revert: drop the stay read and (a) records nothing; drop the cs_
 * route and (b) throws unsupported_stripe_provider_reference.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkoutSessionPaymentIntentId,
  type FeeCandidate,
  handlePayoutReleaseSweep,
  type ProviderFeeClients,
  providerReferenceRoute,
  resolveProviderFeeWith,
} from "../index.ts";

const ACCOUNT = "acct_brand";

function stripeClients(log: string[], session: { payment_intent?: string | null } = { payment_intent: "pi_cs" }): ProviderFeeClients {
  const balance = {
    id: "txn_1",
    fee: 60,
    fee_details: [
      { type: "stripe_fee", amount: 45 },
      { type: "application_fee", amount: 15 },
    ],
  };
  return {
    verifyPaystack: (reference) => {
      log.push(`paystack:${reference}`);
      return Promise.resolve({ id: 987, fees: 150 });
    },
    stripeRead: () => ({
      charges: {
        retrieve: (id, _params, options) => {
          log.push(`charge:${id}:${options.stripeAccount}`);
          return Promise.resolve({ balance_transaction: balance });
        },
      },
      paymentIntents: {
        retrieve: (id, _params, options) => {
          log.push(`pi:${id}:${options.stripeAccount}`);
          return Promise.resolve({ latest_charge: { balance_transaction: balance } });
        },
      },
    }),
    stripeCheckoutSessionRead: () => ({
      checkout: {
        sessions: {
          retrieve: (id, _params, options) => {
            log.push(`cs:${id}:${options.stripeAccount}`);
            return Promise.resolve(session);
          },
        },
      },
    }),
  };
}

const chipIn = (reference: string): FeeCandidate => ({
  source_type: "rsvp_contribution",
  source_id: "64e293d6-3d67-4f32-a950-803c567f3564",
  provider: "stripe",
  provider_reference: reference,
  stripe_account_id: ACCOUNT,
});

Deno.test("#3645 a cs_ reference routes through its Checkout Session", () => {
  assertEquals(providerReferenceRoute("stripe", "cs_live_abc"), "stripe_checkout_session");
  assertEquals(providerReferenceRoute("stripe", "pi_1"), "stripe_payment_intent");
  assertEquals(providerReferenceRoute("stripe", "ch_1"), "stripe_charge");
});

Deno.test("#3645 a cs_ chip-in fee is the session PaymentIntent's charge fee, on the connected account", async () => {
  const log: string[] = [];
  const fee = await resolveProviderFeeWith(chipIn("cs_live_abc"), stripeClients(log));
  assertEquals(fee, {
    provider_fee_cents: 45,
    provider_balance_transaction_id: "txn_1",
    application_fee_excluded_cents: 15,
  });
  assertEquals(log, [`cs:cs_live_abc:${ACCOUNT}`, `pi:pi_cs:${ACCOUNT}`]);
});

Deno.test("#3645 an unpaid Checkout Session never yields a fee", async () => {
  await assertRejects(
    () => resolveProviderFeeWith(chipIn("cs_live_unpaid"), stripeClients([], { payment_intent: null })),
    Error,
    "stripe_checkout_session_has_no_payment_intent",
  );
  assertEquals(checkoutSessionPaymentIntentId({ payment_intent: { id: "pi_x" } }), "pi_x");
});

Deno.test("#3645 a Paystack stay fee is read by its transaction reference", async () => {
  const log: string[] = [];
  const fee = await resolveProviderFeeWith({
    source_type: "stay_reservation",
    source_id: "attempt-1",
    provider: "paystack",
    provider_reference: "mingla_stay_ref_1",
    stripe_account_id: null,
  }, stripeClients(log));
  assertEquals(fee.provider_fee_cents, 150);
  assertEquals(log, ["paystack:mingla_stay_ref_1"]);
});

type Scenario = {
  main: FeeCandidate[];
  stays: FeeCandidate[] | "error";
  failFor?: Set<string>;
};

async function runSweep(scenario: Scenario) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const upserts: Array<Record<string, unknown>> = [];
  const resolved: string[] = [];
  const response = await handlePayoutReleaseSweep(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer service-secret" },
    }),
    {
      env: (key: string) =>
        key === "SUPABASE_URL"
          ? "https://example.test"
          : key === "SUPABASE_SERVICE_ROLE_KEY"
          ? "service-secret"
          : undefined,
      createAdmin: (() => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcs.push({ name, args });
          if (name === "list_missing_payout_source_fees") {
            return Promise.resolve({ data: scenario.main, error: null });
          }
          if (name === "list_missing_stay_provider_fees") {
            return Promise.resolve(
              scenario.stays === "error"
                ? { data: null, error: { code: "XX000", message: "stay_read_down" } }
                : { data: scenario.stays, error: null },
            );
          }
          if (name === "record_stay_provider_fee") {
            return Promise.resolve({ data: 1, error: null });
          }
          if (name === "run_payout_release_dark_sweep") {
            return Promise.resolve({ data: { dark: true, executed: 0 }, error: null });
          }
          if (name === "issue_3645_raise_stale_stay_dispute_alerts") {
            return Promise.resolve({ data: { raised: 0 }, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        from: (table: string) => ({
          upsert: (row: Record<string, unknown>) => {
            upserts.push({ table, ...row });
            return Promise.resolve({ error: null });
          },
        }),
      })) as never,
      resolveProviderFee: (candidate: FeeCandidate) => {
        resolved.push(`${candidate.source_type}:${candidate.source_id}`);
        if (scenario.failFor?.has(candidate.source_id)) {
          return Promise.reject(new Error("provider_down"));
        }
        return Promise.resolve({
          provider_fee_cents: 77,
          provider_balance_transaction_id: `txn_${candidate.source_id}`,
        });
      },
    },
  );
  return { response, rpcs, upserts, resolved };
}

const stay: FeeCandidate = {
  source_type: "stay_reservation",
  source_id: "stay-attempt-1",
  provider: "paystack",
  provider_reference: "mingla_stay_ref_1",
  stripe_account_id: null,
};

Deno.test("#3645 the sweep records a paid stay's fee through record_stay_provider_fee", async () => {
  const { response, rpcs, upserts } = await runSweep({ main: [], stays: [stay] });
  assertEquals(response.status, 200);
  const stayRead = rpcs.find((r) => r.name === "list_missing_stay_provider_fees");
  assertEquals(stayRead?.args, { p_limit: 100 });
  const recorded = rpcs.filter((r) => r.name === "record_stay_provider_fee");
  assertEquals(recorded.map((r) => r.args), [{
    p_payment_attempt_id: "stay-attempt-1",
    p_provider_fee_minor: 77,
    p_provider_balance_transaction_id: "txn_stay-attempt-1",
  }]);
  assertEquals(upserts, [], "a stay fee never becomes a payout_source_fee_snapshots row");
  // Fees are captured before the ledger sweep runs.
  const names = rpcs.map((r) => r.name);
  assertEquals(names.indexOf("record_stay_provider_fee") < names.indexOf("run_payout_release_dark_sweep"), true);
});

Deno.test("#3645 a backlog of failing sales never starves the stay family", async () => {
  const backlog: FeeCandidate[] = Array.from({ length: 100 }, (_, i) => ({
    source_type: "order" as const,
    source_id: `order-${i}`,
    provider: "stripe" as const,
    provider_reference: `ch_${i}`,
    stripe_account_id: ACCOUNT,
  }));
  const realError = console.error;
  console.error = () => {};
  try {
    const { rpcs, resolved } = await runSweep({
      main: backlog,
      stays: [stay],
      failFor: new Set(backlog.map((c) => c.source_id)),
    });
    assertEquals(resolved.includes("stay_reservation:stay-attempt-1"), true);
    assertEquals(rpcs.filter((r) => r.name === "record_stay_provider_fee").length, 1);
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 a failed stay read is audible but the other payouts still run", async () => {
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const { response, rpcs } = await runSweep({ main: [], stays: "error" });
    assertEquals(response.status, 200);
    assertEquals(rpcs.some((r) => r.name === "run_payout_release_dark_sweep"), true);
    assertEquals(logged.some((l) => l.includes("stay fee candidate read failed")), true);
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 a Stripe instalment fee becomes an order_installment snapshot", async () => {
  const { upserts } = await runSweep({
    main: [{
      source_type: "order_installment",
      source_id: "inst-1",
      provider: "stripe",
      provider_reference: "ch_inst",
      stripe_account_id: ACCOUNT,
    }],
    stays: [],
  });
  assertEquals(upserts, [{
    table: "payout_source_fee_snapshots",
    source_type: "order_installment",
    source_id: "inst-1",
    provider_fee_cents: 77,
    provider_balance_transaction_id: "txn_inst-1",
  }]);
});
