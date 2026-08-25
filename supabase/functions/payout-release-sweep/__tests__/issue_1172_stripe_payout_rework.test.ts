import {
  assert,
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

// [TEST-MOD-APPROVED #2591] — re-point + strengthen.
//
// WHAT THIS TEST IS FOR, restated so the next reader cannot mistake the pin for
// the property: the #1172 disposable CI database must be reachable only with a
// credential minted fresh for that run. A static password checked into a
// workflow is a credential in a public repository (this repo IS public).
//
// #2591 collapses nine migration-gated Postgres lanes into
// `.github/workflows/postgres-contract-suites.yml`. The property does not move
// -- only the file that carries it. Three deliberate changes, none of them a
// relaxation:
//
//  1. CANDIDATES, not one path. Both the origin workflow and the consolidated
//     one are checked while both exist (they overlap for the whole shadow
//     window), and the surviving one is checked after the cutover deletes the
//     other. There is no instant at which the property is unasserted, which the
//     naive "just change the string" re-point would have opened for the length
//     of the shadow PR.
//  2. AT LEAST ONE CANDIDATE MUST EXIST. Deleting every candidate is RED, not
//     green. A universal quantifier over an empty set is the check-that-carries-
//     no-information shape (#2113); this clause is what stops it.
//  3. The randomness is asserted as a PROPERTY, not as one spelling of a
//     variable name. The old assertion pinned the literal
//     `issue1172_db_password="$(openssl rand -hex 24)"`. That pin is satisfied
//     by a DEAD assignment -- the line can sit in the file while the container
//     is actually started from some other, static value -- and it is defeated by
//     a rename that also drops the randomness only because the rename half fails
//     first, which invites "just update the string" as the repair. So instead:
//     some shell variable is assigned `$(openssl rand -hex 24)`, AND that same
//     variable is the one interpolated into `POSTGRES_PASSWORD`, AND no
//     `POSTGRES_PASSWORD` is ever assigned anything but a variable reference.
//     Every defect the old form caught is still caught; the dead-assignment hole
//     and the "random var exists, static password used" hole are new catches.
//     `pg_contract_db_password` therefore needs no mention here at all -- the
//     name is free to change, the property is not.
//
// Fails-on-revert, clause by clause. Drop `openssl rand -hex 24` -> clause (a)
// fails. Keep the random assignment but start the container from an inline
// value rather than a variable reference, or drop the container's password
// assignment altogether -> clause (c) fails. Point `POSTGRES_PASSWORD` at a
// variable that exists but was never minted -> clause (d) fails. Delete both
// workflows -> the existence clause fails.
//
// And clause (b): writing, anywhere in either workflow, the one environment
// assignment that hands the disposable database the stock throwaway credential
// -- the assignment that sets the password to the default superuser's own name
// -- turns (b) red. That assignment is the only clause in this list this
// comment DESCRIBES instead of quoting, and the omission is deliberate. Clause
// (b) below builds the forbidden string from fragments at runtime so this
// source file never contains it; prose is not an exemption from that rule,
// because written out in full it IS a hardcoded database credential and the
// secret scanner reads it as one inside a comment exactly as it does inside
// code. If you are documenting this property again: describe the string, do
// not write it, and do not reach for the fragment-join trick in prose either.
const PG_PASSWORD_CANDIDATE_WORKFLOWS = [
  // The #1172 origin lane. Live today; deleted by #2591's cutover PR.
  ".github/workflows/issue-1172-stripe-payout-execution-tests.yml",
  // The consolidated provider. Absent today; lands in #2591's shadow PR.
  ".github/workflows/postgres-contract-suites.yml",
];

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

Deno.test("CI disposable PostgreSQL password is generated and no password-shaped literal remains", async () => {
  const present: Array<{ path: string; text: string }> = [];
  for (const path of PG_PASSWORD_CANDIDATE_WORKFLOWS) {
    const text = await readIfPresent(path);
    if (text !== null) present.push({ path, text });
  }

  // (existence) The property must have a live carrier. Both candidates gone
  // means the executable SQL contract suites are booting a database from a
  // workflow nothing here inspects -- or not booting one at all.
  assert(
    present.length > 0,
    `no live carrier for the disposable-database credential contract; none of ${
      PG_PASSWORD_CANDIDATE_WORKFLOWS.join(", ")
    } exists. If the provider moved again, add it to PG_PASSWORD_CANDIDATE_WORKFLOWS -- do not delete this test.`,
  );

  for (const { path, text } of present) {
    // (a) Some variable is minted per run from `openssl rand -hex 24`.
    const minted = [
      ...text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)="\$\(openssl rand -hex 24\)"/g),
    ].map((m) => m[1]);
    assert(
      minted.length > 0,
      `${path}: no per-run credential is minted; expected a shell assignment of the form <name>="$(openssl rand -hex 24)".`,
    );

    // (b) The forbidden static credential, asserted exactly as before and at the
    //     same strength: the concatenation is built at runtime so this source
    //     file never contains the literal it forbids.
    const forbiddenCredential = ["POSTGRES", "_PASSWORD=", "postgres"].join("");
    assertEquals(
      text.includes(forbiddenCredential),
      false,
      `${path}: a static database password literal is present.`,
    );

    // (c) The database is started from one of those minted variables -- not from
    //     a literal, and not from some other variable that merely looks safe.
    //     The expected shape is the one every origin lane uses and §3.3 of the
    //     #2591 spec pins: `docker run ... -e POSTGRES_PASSWORD="$<minted>"`.
    //     It is deliberately strict. A `services:`/`env:` container block would
    //     satisfy a looser reading while breaking the `docker exec` path that
    //     #1171's Deno tests and #1174's bash driver reach the database through,
    //     so a deviation here should stop the build and come back to the tester.
    const passwordAssignments = [
      ...text.matchAll(/POSTGRES_PASSWORD=("?)([^"\s]*)\1/g),
    ].map((m) => m[2]);
    assert(
      passwordAssignments.length > 0,
      `${path}: no \`-e POSTGRES_PASSWORD=...\` assignment, so this workflow does not start the disposable database it is supposed to certify. Expected \`docker run ... -e POSTGRES_PASSWORD="$<minted>"\` where <minted> is one of: ${
        minted.join(", ")
      }.`,
    );
    for (const value of passwordAssignments) {
      const referenced = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(value);
      assert(
        referenced !== null,
        `${path}: POSTGRES_PASSWORD is assigned the literal "${value}" rather than a per-run minted variable.`,
      );
      // (d) ...and the variable it references is one of the minted ones. This is
      //     the clause the old literal pin did not have: a minted assignment can
      //     sit in the file, unused, beside a container started from something
      //     else entirely, and the old form called that green.
      assert(
        minted.includes(referenced[1]),
        `${path}: POSTGRES_PASSWORD is built from "$${referenced[1]}", which is not minted by "openssl rand -hex 24" (minted: ${
          minted.join(", ")
        }). A per-run credential that the container never receives is a dead assignment.`,
      );
    }
  }
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
      // Issue #1177 (append-only): the enabled path now also claims Paystack
      // organiser releases. This scenario has none, so the organiser rail is a
      // no-op here.
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
