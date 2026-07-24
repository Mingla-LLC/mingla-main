import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  executeStripeRelease,
  type StripeReleaseCandidate,
  type StripeReleaseDeps,
} from "../engine.ts";

const candidate = (
  overrides: Partial<StripeReleaseCandidate> = {},
): StripeReleaseCandidate => ({
  release_id: "release-adversarial-1172",
  brand_id: "brand-adversarial-1172",
  stripe_account_id: "acct_adversarial_1172",
  currency: "usd",
  net_release_cents: 8_000,
  maturity_recredit_cents: 250,
  attempt_count: 1,
  claim_id: "claim-adversarial-1172",
  ...overrides,
});

Deno.test("ambiguous Stripe retries keep one deterministic release key and never use provider balance as the amount", async () => {
  const keys: string[] = [];
  const amounts: number[] = [];
  const deps: StripeReleaseDeps = {
    retrieveBalance: () =>
      Promise.resolve({
        available: [
          { currency: "eur", amount: 999_999 },
          { currency: "usd", amount: 999_999 },
        ],
      }),
    revalidateReleaseImmediatelyBeforePayout: () => Promise.resolve(true),
    createPayout: (input) => {
      keys.push(input.idempotencyKey);
      amounts.push(input.amountCents);
      return Promise.reject({
        type: "api_error",
        statusCode: 500,
        message: "lost response after provider processing",
      });
    },
  };

  const first = await executeStripeRelease(candidate(), deps);
  const retry = await executeStripeRelease(
    candidate({ attempt_count: 9, claim_id: "claim-retry-1172" }),
    deps,
  );

  assertEquals(first.outcome, "retryable_error");
  assertEquals(retry.outcome, "retryable_error");
  assertEquals(keys, [
    "brand_payout_release-adversarial-1172",
    "brand_payout_release-adversarial-1172",
  ]);
  assertEquals(amounts, [8_250, 8_250]);
});

Deno.test("a cancellation observed after claim but before provider mutation prevents payouts.create", async () => {
  let payoutCalls = 0;
  let cancelledAfterClaim = false;
  const deps = {
    retrieveBalance: () => {
      cancelledAfterClaim = true;
      return Promise.resolve({
        available: [{ currency: "usd", amount: 999_999 }],
      });
    },
    revalidateReleaseImmediatelyBeforePayout: () =>
      Promise.resolve(!cancelledAfterClaim),
    createPayout: () => {
      payoutCalls++;
      return Promise.resolve({
        id: "po_must_not_exist",
        amount: 8_250,
        currency: "usd",
      });
    },
  } as unknown as StripeReleaseDeps;

  await executeStripeRelease(candidate(), deps);
  assertEquals(
    payoutCalls,
    0,
    "a cancelled occurrence must be rechecked immediately before payouts.create",
  );
});

Deno.test("claiming or ceiling-blocking a row cannot consume a provider attempt", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20270110000002_issue_1172_stripe_payout_execution.sql",
  );
  const claimBody = migration.split(
    "CREATE OR REPLACE FUNCTION public.record_stripe_payout_execution",
  )[0];
  assertStringIncludes(
    claimBody,
    "CREATE OR REPLACE FUNCTION public.claim_stripe_payout_releases",
  );
  assertEquals(
    claimBody.includes("attempt_count=r.attempt_count+1"),
    false,
    "claim and balance-only rejection happen before a provider attempt and must not burn the retry budget",
  );
});
