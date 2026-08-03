import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyStripePayoutCreateError,
  executeStripeRelease,
  stripePayoutIdempotencyKey,
  type StripeReleaseCandidate,
} from "../engine.ts";
import { handlePayoutReleaseSweep } from "../index.ts";

const release = (
  overrides: Partial<StripeReleaseCandidate> = {},
): StripeReleaseCandidate => ({
  release_id: "release-1172",
  brand_id: "brand-1172",
  stripe_account_id: "acct_1172",
  currency: "usd",
  net_release_cents: 7_000,
  maturity_recredit_cents: 500,
  attempt_count: 1,
  claim_id: "claim-1172",
  ...overrides,
});

Deno.test("Stripe payout uses exact debt-adjusted ledger plus matured recredit and deterministic key", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await executeStripeRelease(release(), {
    retrieveBalance: () =>
      Promise.resolve({
        // Aggregate provider balance is deliberately larger: it is ceiling
        // only and must never become the release amount.
        available: [{ currency: "usd", amount: 99_999 }],
      }),
    revalidateReleaseImmediatelyBeforePayout: () => Promise.resolve(true),
    createPayout: (input) => {
      calls.push(input);
      return Promise.resolve({
        id: "po_1172",
        amount: input.amountCents,
        currency: input.currency,
        status: "pending",
      });
    },
  });
  assertEquals(result, {
    outcome: "accepted",
    payoutId: "po_1172",
    amountCents: 7_500,
  });
  assertEquals(calls, [{
    stripeAccountId: "acct_1172",
    amountCents: 7_500,
    currency: "usd",
    releaseId: "release-1172",
    idempotencyKey: "brand_payout_release-1172",
  }]);
});

Deno.test("provider balance is a ceiling and cannot truncate a ledger release", async () => {
  let payoutCalls = 0;
  const result = await executeStripeRelease(release(), {
    retrieveBalance: () =>
      Promise.resolve({
        available: [
          { currency: "eur", amount: 100_000 },
          { currency: "usd", amount: 7_499 },
        ],
      }),
    revalidateReleaseImmediatelyBeforePayout: () => Promise.resolve(true),
    createPayout: () => {
      payoutCalls++;
      throw new Error("must not execute");
    },
  });
  assertEquals(result.outcome, "blocked_balance");
  assertEquals(payoutCalls, 0);
  if (result.outcome === "blocked_balance") {
    assertEquals(result.amountCents, 7_500);
    assertEquals(result.availableCents, 7_499);
  }
});

Deno.test("Stripe KYC rejection is classified from invalid_request_error without a code", async () => {
  const classified = classifyStripePayoutCreateError({
    type: "invalid_request_error",
    message: "Account requirements are incomplete",
  });
  assertEquals(classified, {
    outcome: "blocked_kyc",
    message: "Account requirements are incomplete",
  });
  assertEquals(
    classifyStripePayoutCreateError({
      type: "invalid_request_error",
      code: "balance_insufficient",
      message: "Insufficient funds",
    }).outcome,
    "blocked_balance",
  );
});

Deno.test("invalid release amount fails closed before balance or payout access", async () => {
  let providerCalls = 0;
  await assertRejects(
    () =>
      executeStripeRelease(
        release({ net_release_cents: 0, maturity_recredit_cents: 0 }),
        {
          retrieveBalance: () => {
            providerCalls++;
            return Promise.resolve({ available: [] });
          },
          revalidateReleaseImmediatelyBeforePayout: () => {
            providerCalls++;
            return Promise.resolve(true);
          },
          createPayout: () => {
            providerCalls++;
            return Promise.resolve({
              id: "po_never",
              amount: 0,
              currency: "usd",
            });
          },
        },
      ),
    Error,
    "invalid_stripe_release_amount",
  );
  assertEquals(providerCalls, 0);
  assertEquals(
    stripePayoutIdempotencyKey("release-1172"),
    "brand_payout_release-1172",
  );
});

Deno.test("handler remains dark while the execution flag is unset", async () => {
  const rpcNames: string[] = [];
  let stripeClients = 0;
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
        rpc: (name: string) => {
          rpcNames.push(name);
          return Promise.resolve({
            data: name === "list_missing_payout_source_fees" ||
                name === "claim_payout_release_alerts"
              ? []
              : { dark: true, executed: 0 },
            error: null,
          });
        },
        from: () => {
          throw new Error("no provider-fee writes expected");
        },
      })) as never,
      resolveProviderFee: () => {
        throw new Error("no provider-fee candidates expected");
      },
      createStripeReleaseClient: () => {
        stripeClients++;
        return {} as never;
      },
    },
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).dark, true);
  assertEquals(rpcNames, [
    "list_missing_payout_source_fees",
    "run_payout_release_dark_sweep",
    "claim_payout_release_alerts",
  ]);
  assertEquals(stripeClients, 0);
});

Deno.test("enabled test path records one accepted payout with exact amount and key", async () => {
  const rpcNames: string[] = [];
  const recordArgs: Array<Record<string, unknown>> = [];
  const payoutCalls: Array<Record<string, unknown>> = [];
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
          : key === "PAYOUT_RELEASE_EXECUTE"
          ? "true"
          : undefined,
      createAdmin: (() => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcNames.push(name);
          if (name === "list_missing_payout_source_fees") {
            return Promise.resolve({ data: [], error: null });
          }
          if (name === "run_payout_release_dark_sweep") {
            return Promise.resolve({
              data: { dark: true, executed: 0 },
              error: null,
            });
          }
          if (name === "plan_pending_payout_partner_legs") {
            return Promise.resolve({
              data: { blocked_partner_attributions: 0 },
              error: null,
            });
          }
          if (name === "claim_stripe_payout_releases") {
            return Promise.resolve({ data: [release()], error: null });
          }
          if (name === "claim_payout_release_alerts") {
            return Promise.resolve({ data: [], error: null });
          }
          if (name === "authorize_stripe_payout_execution") {
            return Promise.resolve({ data: true, error: null });
          }
          if (name === "record_stripe_payout_execution") {
            recordArgs.push(args);
            return Promise.resolve({ data: "released", error: null });
          }
          // Issue #1177 (append-only): the enabled path now also claims Paystack
          // organiser releases. This scenario has none, so it returns empty and
          // the organiser rail is a no-op here.
          if (name === "claim_paystack_payout_releases") {
            return Promise.resolve({ data: [], error: null });
          }
          throw new Error(`unexpected RPC ${name}`);
        },
        from: (table: string) => {
          if (table === "brand_payout_releases") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          }
          throw new Error("no provider-fee writes expected");
        },
      })) as never,
      resolveProviderFee: () => {
        throw new Error("no provider-fee candidates expected");
      },
      createStripeReleaseClient: () =>
        ({
          balance: {
            retrieve: () =>
              Promise.resolve({
                available: [{ currency: "usd", amount: 8_000 }],
              }),
          },
          payouts: {
            create: (
              params: Record<string, unknown>,
              options: Record<string, unknown>,
            ) => {
              payoutCalls.push({ params, options });
              return Promise.resolve({
                id: "po_1172",
                amount: params.amount as number,
                currency: params.currency as string,
              });
            },
          },
        }) as never,
      notifyKycBlocked: () => Promise.resolve(),
    },
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.dark, false);
  assertEquals(body.stripeExecution.accepted, 1);
  assertEquals(payoutCalls[0], {
    params: {
      amount: 7_500,
      currency: "usd",
      metadata: { mingla_release_id: "release-1172" },
    },
    options: {
      stripeAccount: "acct_1172",
      idempotencyKey: "brand_payout_release-1172",
    },
  });
  assertEquals(recordArgs[0].p_amount_cents, 7_500);
  assertEquals(recordArgs[0].p_payout_id, "po_1172");
  assert(
    rpcNames.includes("claim_stripe_payout_releases") &&
      rpcNames.includes("record_stripe_payout_execution"),
  );
});
