import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyStripePayoutCreateError,
  executeStripeRelease,
  type StripeReleaseCandidate,
} from "../engine.ts";
import { handlePayoutReleaseSweep } from "../index.ts";

const release: StripeReleaseCandidate = {
  release_id: "release-rework-1172",
  brand_id: "brand-rework-1172",
  stripe_account_id: "acct_rework_1172",
  currency: "usd",
  net_release_cents: 9_000,
  maturity_recredit_cents: 500,
  attempt_count: 9,
  claim_id: "claim-rework-1172",
};

Deno.test("live authorization runs after the ceiling read and immediately before payout creation", async () => {
  const order: string[] = [];
  const result = await executeStripeRelease(release, {
    retrieveBalance: () => {
      order.push("balance");
      return Promise.resolve({
        available: [{ currency: "usd", amount: 99_999 }],
      });
    },
    revalidateReleaseImmediatelyBeforePayout: () => {
      order.push("authorize");
      return Promise.resolve(false);
    },
    createPayout: () => {
      order.push("payout");
      return Promise.resolve({
        id: "po_forbidden",
        amount: 9_500,
        currency: "usd",
      });
    },
  });

  assertEquals(result.outcome, "not_authorized");
  assertEquals(order, ["balance", "authorize"]);
});

Deno.test("only a definitive provider 4xx is classified to burn an attempt", () => {
  assertEquals(
    classifyStripePayoutCreateError({
      type: "api_error",
      statusCode: 400,
      message: "malformed payout",
    }).outcome,
    "definitive_error",
  );
  assertEquals(
    classifyStripePayoutCreateError({
      type: "api_error",
      statusCode: 429,
      message: "rate limited",
    }).outcome,
    "retryable_error",
  );
  assertEquals(
    classifyStripePayoutCreateError({
      type: "invalid_request_error",
      statusCode: 400,
      message: "account requirements incomplete",
    }).outcome,
    "blocked_kyc",
  );
});

Deno.test("a cached asynchronously failed payout never becomes a false accepted release", async () => {
  const result = await executeStripeRelease(release, {
    retrieveBalance: () =>
      Promise.resolve({
        available: [{ currency: "usd", amount: 99_999 }],
      }),
    revalidateReleaseImmediatelyBeforePayout: () => Promise.resolve(true),
    createPayout: () =>
      Promise.resolve({
        id: "po_failed_cached",
        amount: 9_500,
        currency: "usd",
        status: "failed",
      }),
  });

  assertEquals(result, {
    outcome: "retryable_error",
    amountCents: 9_500,
    message: "stripe_payout_failed:po_failed_cached",
  });
});

Deno.test("webhook reconciliation preserves release attribution and delegates replay-safe failure state to SQL", async () => {
  const router = await Deno.readTextFile(
    "supabase/functions/_shared/stripeWebhookRouter.ts",
  );
  assertStringIncludes(router, '.from("payouts")');
  assertStringIncludes(router, '.select("release_id")');
  assertStringIncludes(router, '"record_stripe_payout_webhook_failure"');
  assertEquals(
    router.includes("emailTo: \"ops@mingla.app\""),
    false,
  );
});

Deno.test("CI disposable PostgreSQL password is generated and no password-shaped literal remains", async () => {
  const workflow = await Deno.readTextFile(
    ".github/workflows/issue-1172-stripe-payout-execution-tests.yml",
  );
  assertStringIncludes(
    workflow,
    'issue1172_db_password="$(openssl rand -hex 24)"',
  );
  const forbiddenCredential = ["POSTGRES", "_PASSWORD=", "postgres"].join("");
  assertEquals(workflow.includes(forbiddenCredential), false);
});

Deno.test("attempt-cap alert survives transport failure and delivers once without retrying payout", async () => {
  const alerts: Array<{ releaseId: string; message: string }> = [];
  const recordOutcomes: string[] = [];
  let alertPending = false;
  let alertClaimed = false;
  let alertDelivered = false;
  let notificationAttempts = 0;
  let payoutCalls = 0;
  const createAdmin = (() => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "list_missing_payout_source_fees") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "run_payout_release_dark_sweep") {
        return Promise.resolve({ data: { executed: 0 }, error: null });
      }
      if (name === "plan_pending_payout_partner_legs") {
        return Promise.resolve({
          data: { blocked_partner_attributions: 0 },
          error: null,
        });
      }
      if (name === "claim_stripe_payout_releases") {
        return Promise.resolve({
          data: recordOutcomes.length === 0 ? [release] : [],
          error: null,
        });
      }
      if (name === "authorize_stripe_payout_execution") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "record_stripe_payout_execution") {
        recordOutcomes.push(String(args.p_outcome));
        alertPending = true;
        return Promise.resolve({ data: "failed", error: null });
      }
      if (name === "claim_payout_release_alerts") {
        if (!alertPending || alertClaimed || alertDelivered) {
          return Promise.resolve({ data: [], error: null });
        }
        alertClaimed = true;
        return Promise.resolve({
          data: [{
            alert_id: "alert-rework-1172",
            release_id: release.release_id,
            brand_id: release.brand_id,
            error_message: "definitive malformed payout request",
            idempotency_key:
              `ops.stripe_payout_release_attempt_cap:${release.release_id}`,
            claim_id: `alert-claim-${notificationAttempts + 1}`,
          }],
          error: null,
        });
      }
      if (name === "record_payout_release_alert_delivery") {
        if (args.p_outcome === "provider_accepted") {
          alertDelivered = true;
          alertPending = false;
        } else {
          alertPending = true;
        }
        alertClaimed = false;
        return Promise.resolve({
          data: args.p_outcome === "provider_accepted"
            ? "provider_accepted"
            : "pending",
          error: null,
        });
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
  })) as never;
  const deps = {
    env: (key: string) =>
      key === "SUPABASE_URL"
        ? "https://example.test"
        : key === "SUPABASE_SERVICE_ROLE_KEY"
        ? "service-secret"
        : key === "PAYOUT_RELEASE_EXECUTE"
        ? "true"
        : undefined,
    createAdmin,
    resolveProviderFee: () => {
      throw new Error("no provider-fee candidates expected");
    },
    createStripeReleaseClient: () =>
      ({
        balance: {
          retrieve: () =>
            Promise.resolve({
              available: [{ currency: "usd", amount: 99_999 }],
            }),
        },
        payouts: {
          create: () => {
            payoutCalls++;
            return Promise.reject({
              type: "api_error",
              statusCode: 400,
              message: "definitive malformed payout request",
            });
          },
        },
      }) as never,
    notifyKycBlocked: () => Promise.resolve(),
    notifyAttemptCap: (
      alertRelease: Pick<
        StripeReleaseCandidate,
        "release_id" | "brand_id"
      >,
      message: string,
    ) => {
      notificationAttempts++;
      if (notificationAttempts === 1) {
        return Promise.reject(new Error("notification transport unavailable"));
      }
      alerts.push({ releaseId: alertRelease.release_id, message });
      return Promise.resolve();
    },
  };
  const firstResponse = await handlePayoutReleaseSweep(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer service-secret" },
    }),
    deps,
  );

  assertEquals(firstResponse.status, 200);
  assertEquals(recordOutcomes, ["definitive_error"]);
  assertEquals(notificationAttempts, 1);
  assertEquals(alertPending, true);
  assertEquals(alertDelivered, false);
  assertEquals(payoutCalls, 1);
  assertEquals(alerts, []);

  const secondResponse = await handlePayoutReleaseSweep(
    new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer service-secret" },
    }),
    deps,
  );
  assertEquals(secondResponse.status, 200);
  assertEquals(notificationAttempts, 2);
  assertEquals(alertPending, false);
  assertEquals(alertDelivered, true);
  assertEquals(payoutCalls, 1);
  assertEquals(alerts, [{
    releaseId: "release-rework-1172",
    message: "definitive malformed payout request",
  }]);
});
