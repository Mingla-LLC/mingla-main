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
 *  (c) Stripe instalment fee candidates land as order_installment snapshots;
 *      a Paystack instalment with an unknown fee is completed through
 *      issue_3645_record_installment_paystack_fee (never a guessed 0).
 *  (d) Fee capture can never hold up payouts: families are taken in turn,
 *      a failed read is recorded so it rotates behind the others, and capture
 *      stops when its time budget is spent.
 *
 * Fails on revert: drop the stay read and (a) records nothing; drop the cs_
 * route and (b) throws unsupported_stripe_provider_reference.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  captureProviderFees,
  checkoutSessionPaymentIntentId,
  FEE_CANDIDATES_PER_FAMILY,
  FEE_CAPTURE_BUDGET_MS,
  type FeeCandidate,
  handlePayoutReleaseSweep,
  interleaveFeeFamilies,
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
          if (name === "issue_3645_record_installment_paystack_fee") {
            return Promise.resolve({ data: { ok: true, payout_accounting_state: "ready" }, error: null });
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
  assertEquals(stayRead?.args, { p_limit: FEE_CANDIDATES_PER_FAMILY });
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

Deno.test("#3645 a Paystack instalment's verified fee completes it through its own RPC", async () => {
  const { rpcs, upserts } = await runSweep({
    main: [{
      source_type: "order_installment",
      source_id: "inst-ps",
      provider: "paystack",
      provider_reference: "mingla-inst-x-a1",
      stripe_account_id: null,
    }],
    stays: [],
  });
  assertEquals(
    rpcs.filter((r) => r.name === "issue_3645_record_installment_paystack_fee").map((r) => r.args),
    [{ p_installment_id: "inst-ps", p_provider_fee_cents: 77 }],
  );
  assertEquals(upserts, []);
});

Deno.test("#3645 a failed fee read is recorded so it rotates behind the others", async () => {
  const realError = console.error;
  console.error = () => {};
  try {
    const { rpcs } = await runSweep({
      main: [{
        source_type: "order",
        source_id: "order-bad",
        provider: "stripe",
        provider_reference: "ch_bad",
        stripe_account_id: ACCOUNT,
      }],
      stays: [],
      failFor: new Set(["order-bad"]),
    });
    const recorded = rpcs.filter((r) => r.name === "record_payout_fee_capture_failure");
    assertEquals(recorded.map((r) => [r.args.p_source_type, r.args.p_source_id, r.args.p_error]), [
      ["order", "order-bad", "provider_down"],
    ]);
  } finally {
    console.error = realError;
  }
});

function fakeAdmin(log: string[]) {
  return {
    rpc: (name: string) => {
      log.push(name);
      return Promise.resolve({ data: 1, error: null });
    },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  };
}

const many = (type: FeeCandidate["source_type"], n: number): FeeCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    source_type: type,
    source_id: `${type}-${i}`,
    provider: "stripe" as const,
    provider_reference: `ch_${type}_${i}`,
    stripe_account_id: ACCOUNT,
  }));

Deno.test("#3645 fee capture stops when its time budget is spent and leaves the rest for the next tick", async () => {
  let clock = 0;
  const seen: string[] = [];
  const realError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const result = await captureProviderFees(fakeAdmin([]), many("order", 50), {
      now: () => clock,
      feeCaptureBudgetMs: 10_000,
      resolveProviderFee: (c) => {
        seen.push(c.source_id);
        clock += 1_000; // each provider read takes a second
        return Promise.resolve({ provider_fee_cents: 1, provider_balance_transaction_id: "t" });
      },
    });
    assertEquals(result.captured, 10);
    assertEquals(result.leftForNextTick, 40);
    assertEquals(seen.length, 10);
    assertEquals(logged.some((l) => l.includes("payout_fee_capture_budget_spent")), true);
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 a provider read that hangs is abandoned at the budget, and the sweep still reaches the ledger", async () => {
  const realError = console.error;
  console.error = () => {};
  const rpcs: string[] = [];
  try {
    const started = Date.now();
    const response = await handlePayoutReleaseSweep(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer service-secret" },
      }),
      {
        env: (key: string) =>
          key === "SUPABASE_URL" ? "https://example.test"
          : key === "SUPABASE_SERVICE_ROLE_KEY" ? "service-secret"
          : undefined,
        createAdmin: (() => ({
          rpc: (name: string) => {
            rpcs.push(name);
            if (name === "list_missing_payout_source_fees") {
              return Promise.resolve({ data: many("order", 3), error: null });
            }
            if (name === "run_payout_release_dark_sweep") {
              return Promise.resolve({ data: { dark: true, executed: 0 }, error: null });
            }
            if (name === "issue_3645_raise_stale_stay_dispute_alerts") {
              return Promise.resolve({ data: { raised: 0 }, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
        })) as never,
        feeCaptureBudgetMs: 50,
        // Never settles: a provider call that hangs.
        resolveProviderFee: () => new Promise(() => {}),
      },
    );
    assertEquals(response.status, 200);
    assertEquals(rpcs.includes("run_payout_release_dark_sweep"), true);
    assertEquals(Date.now() - started < 5_000, true);
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 families are taken in turn, so one family's backlog cannot use the whole budget", () => {
  const order = interleaveFeeFamilies([...many("order", 3), ...many("rsvp_contribution", 1), ...many("stay_reservation", 2)]);
  assertEquals(order.map((c) => c.source_id), [
    "order-0", "rsvp_contribution-0", "stay_reservation-0", "order-1", "stay_reservation-1", "order-2",
  ]);
});

function recordingAdmin() {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const upserts: Array<Record<string, unknown>> = [];
  return {
    rpcs,
    upserts,
    admin: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
}

Deno.test("#3645 a Paystack verify without a fee records nothing and is retried as a failure", async () => {
  const noFee: ProviderFeeClients = {
    ...stripeClients([]),
    verifyPaystack: () => Promise.resolve({ id: 99, status: "success" }),
  };
  await assertRejects(
    () => resolveProviderFeeWith({
      source_type: "order", source_id: "o-1", provider: "paystack",
      provider_reference: "mingla_ref", stripe_account_id: null,
    }, noFee),
    Error,
    "paystack_fee_missing",
  );
  const realError = console.error;
  console.error = () => {};
  try {
    for (const type of ["order", "rsvp_contribution", "venue_reservation", "venue_menu_order", "order_installment", "stay_reservation"] as const) {
      const { admin, rpcs, upserts } = recordingAdmin();
      const result = await captureProviderFees(admin, [{
        source_type: type, source_id: `${type}-1`, provider: "paystack",
        provider_reference: "mingla_ref", stripe_account_id: null,
      }], { resolveProviderFee: (c) => resolveProviderFeeWith(c, noFee) });
      assertEquals(result.captured, 0, type);
      assertEquals(upserts, [], type);
      assertEquals(rpcs.map((r) => r.name), ["record_payout_fee_capture_failure"], type);
      assertEquals(rpcs[0].args.p_error, "paystack_fee_missing", type);
    }
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 a candidate cut off by the time budget is not recorded as a failure", async () => {
  const { admin, rpcs } = recordingAdmin();
  const realError = console.error;
  console.error = () => {};
  try {
    const result = await captureProviderFees(admin, many("order", 3), {
      feeCaptureBudgetMs: 30,
      resolveProviderFee: () => new Promise(() => {}),
    });
    assertEquals(result.failed, 0);
    assertEquals(result.leftForNextTick, 3);
    assertEquals(rpcs.filter((r) => r.name === "record_payout_fee_capture_failure"), []);
  } finally {
    console.error = realError;
  }
});

Deno.test("#3645 the fee-capture budget stays under the cron's 30 s HTTP timeout", () => {
  assertEquals(FEE_CAPTURE_BUDGET_MS, 15_000);
});
