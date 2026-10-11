/**
 * #3660 [Host account deletion completes or changes nothing] — INDEPENDENT
 * TESTER (tester2) RETEST suite. Written by the tester after the rework.
 *
 * The rework changed what a retry returns: an already-deleted account now
 * answers with the provider targets of the deletion that did happen, so a
 * lost first response cannot leave the Stripe account and the Paystack
 * subaccount live. The tester's earlier wire suite (W-4) replays a retry
 * answer with EMPTY lists, which is no longer what the database sends for a
 * current deletion. This suite replays the answers the database really gave
 * on the tester's scratch database after the rework (ids replaced):
 *
 *   RT-1  retry answer WITH targets  -> Stripe and Paystack are called again
 *         with exactly those targets, and the outcome is `done`.
 *   RT-2  the provider says the account is already gone on that second call
 *         -> still `done`, never a failure, one audit row for the rejection.
 *   RT-3  retry answer for an account deleted by an EARLIER build (no audit
 *         row, so empty lists) -> `done`, no provider call, no crash.
 *   RT-4  what the Host is told when a deletion did not come back: no answer
 *         at all, and a 5xx that is not the server's own coded answer (a
 *         gateway timeout, a worker limit), must NOT claim nothing changed;
 *         the server's coded refusal-to-run and any 4xx still may.
 *
 * FAILS-ON-REVERT (verified by the tester): skip the provider step when
 * `already_deleted` is true -> RT-1 fails; let a provider rejection throw ->
 * RT-2 fails; drop the 5xx arm of the Host parser -> RT-4 fails.
 *
 * Run: deno test --allow-read --allow-env --allow-net --no-check \
 *   supabase/functions/_shared/__tests__/issue_3660_retry_contract.tester2.retest.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  purgeBusinessSideData,
  runBusinessSideDeletion,
} from "../accountDeletionSides.ts";
import {
  ACCOUNT_DELETION_FAILED_MESSAGE,
  ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
  AccountDeletionBlockedError,
  describeDeletionFailure,
  parseDeletionFailure,
} from "../../../../mingla-business/src/utils/accountDeletionErrors.ts";

const UID = "00000000-0000-4000-8000-000000003664";
const BRAND = "00000000-0000-4000-8000-0000000036b4";

/** The retry answer the database gave after the rework (ids replaced). */
const DB_RETRY_WITH_TARGETS = {
  status: "deleted",
  brand_ids: [],
  already_deleted: true,
  stripe_accounts: [{ brand_id: BRAND, stripe_account_id: "acct_t2r_retry" }],
  events_taken_down: 0,
  memberships_removed: 0,
  partner_links_ended: 0,
  paystack_subaccounts: [{
    brand_id: BRAND,
    subaccount_code: "ACCT_t2r_retry",
  }],
};

/** The same call for an account with no `host_account.deleted` audit row. */
const DB_RETRY_NO_AUDIT_ROW = {
  status: "deleted",
  brand_ids: [],
  already_deleted: true,
  stripe_accounts: [],
  events_taken_down: 0,
  memberships_removed: 0,
  partner_links_ended: 0,
  paystack_subaccounts: [],
};

function client(answer: unknown) {
  const audit: Array<Record<string, unknown>> = [];
  const c = {
    rpc: (_name: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data: answer, error: null }),
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "or", "update", "delete"]) {
        b[m] = () => b;
      }
      b.insert = (row: Record<string, unknown>) => {
        if (table === "audit_log") audit.push(row);
        return Promise.resolve({ error: null });
      };
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ count: 0, data: null, error: null });
      return b;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { c: c as any, audit };
}

const keptLogin = {
  decide: () =>
    Promise.resolve({
      remove: false,
      reason: "business_records_retained" as const,
    }),
  deleteUser: () => Promise.resolve({ error: null }),
};

Deno.test("#3660 RT-1 · a retry answer with targets re-runs Stripe and Paystack with exactly those targets", async () => {
  const { c } = client(DB_RETRY_WITH_TARGETS);
  const stripe: string[] = [];
  const paystack: string[] = [];
  const outcome = await runBusinessSideDeletion(c, UID, {
    purge: () => purgeBusinessSideData(c, UID),
    stripeClient: () => ({
      accounts: {
        del: (id: string) => {
          stripe.push(id);
          return Promise.resolve({});
        },
      },
    }),
    paystackDeactivate: (code: string) => {
      paystack.push(code);
      return Promise.resolve({});
    },
    ...keptLogin,
  });
  assertEquals(outcome.kind, "done");
  assertEquals(stripe, ["acct_t2r_retry"]);
  assertEquals(paystack, ["ACCT_t2r_retry"]);
  if (outcome.kind !== "done") throw new Error("unreachable");
  assertEquals(outcome.purge.already_deleted, true);
});

Deno.test("#3660 RT-2 · the provider saying 'already gone' on the retry is still `done`, audited once each", async () => {
  const { c, audit } = client(DB_RETRY_WITH_TARGETS);
  const outcome = await runBusinessSideDeletion(c, UID, {
    purge: () => purgeBusinessSideData(c, UID),
    stripeClient: () => ({
      accounts: {
        del: (_id: string) =>
          Promise.reject(new Error("No such account: 'acct_t2r_retry'")),
      },
    }),
    paystackDeactivate: (_code: string) =>
      Promise.reject(new Error("Subaccount not found")),
    ...keptLogin,
  });
  assertEquals(
    outcome.kind,
    "done",
    "a provider rejection on a retry was reported as a failed deletion",
  );
  assertEquals(
    audit.length,
    2,
    "expected one audit row per rejected provider call",
  );
  assertEquals(
    audit.map((row) => row.action).sort(),
    [
      "paystack.subaccount_deactivate_failed",
      "stripe_connect.detach_local_success_stripe_rejected",
    ],
  );
});

Deno.test("#3660 RT-3 · an account deleted by an earlier build (no audit row) retries to `done` with no provider call", async () => {
  const { c, audit } = client(DB_RETRY_NO_AUDIT_ROW);
  let providerCalls = 0;
  const outcome = await runBusinessSideDeletion(c, UID, {
    purge: () => purgeBusinessSideData(c, UID),
    stripeClient: () => ({
      accounts: {
        del: (_id: string) => {
          providerCalls += 1;
          return Promise.resolve({});
        },
      },
    }),
    paystackDeactivate: (_code: string) => {
      providerCalls += 1;
      return Promise.resolve({});
    },
    ...keptLogin,
  });
  assertEquals(outcome.kind, "done");
  assertEquals(providerCalls, 0);
  assertEquals(audit.length, 0);
});

Deno.test("#3660 RT-4 · the Host is told 'nothing was changed' only when that is known", () => {
  // Unknown outcome: no answer, or a 5xx that is not the server's coded answer.
  const unknown: Array<[number, unknown]> = [
    [0, null],
    [NaN, null],
    [504, null],
    [504, "<html>Gateway Timeout</html>"],
    [502, { message: "Bad Gateway" }],
    [546, { code: "WORKER_LIMIT" }],
    [500, { error: "Supabase configuration missing" }],
    [500, null],
  ];
  for (const [status, body] of unknown) {
    const line = describeDeletionFailure(parseDeletionFailure(status, body));
    assertEquals(
      line,
      ACCOUNT_DELETION_UNCONFIRMED_MESSAGE,
      `status ${status} with ${
        JSON.stringify(body)
      } claimed more than is known`,
    );
    assert(!/nothing was changed/i.test(line));
  }
  // Known: the server's own coded "it did not run", and any 4xx.
  const known: Array<[number, unknown]> = [
    [500, { code: "account_deletion_failed" }],
    [401, { error: "Unauthorized or invalid token" }],
    [405, { error: "Method not allowed" }],
    [429, null],
    [409, { code: "something_else" }],
  ];
  for (const [status, body] of known) {
    assertEquals(
      describeDeletionFailure(parseDeletionFailure(status, body)),
      ACCOUNT_DELETION_FAILED_MESSAGE,
      `status ${status} with ${JSON.stringify(body)}`,
    );
  }
  // A refusal is still a refusal, whatever else changed.
  assert(
    parseDeletionFailure(409, {
      code: "account_deletion_blocked",
      blockers: [],
    }) instanceof
      AccountDeletionBlockedError,
  );
});
