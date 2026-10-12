/**
 * #3660 [Host account deletion completes or changes nothing] — INDEPENDENT
 * TESTER (tester2), rework 4. Written by the tester.
 *
 * Rework 4 makes the database drop an earlier provider target that is no
 * longer safe for this account (brand reassigned, restored, reconnected,
 * re-pointed). This suite takes the answers the database really gave on the
 * tester's scratch database for one Host whose seven brands had all been
 * deleted and five of which had since moved on (ids replaced), and drives the
 * real edge module with them:
 *
 *   DT-1  retry answer: only the one Stripe account and the two Paystack
 *         subaccounts the database kept are deactivated. None of the five
 *         dropped Stripe accounts and not the dropped Paystack subaccount is
 *         ever passed to a provider.
 *   DT-2  the module adds nothing of its own: an answer with empty lists
 *         makes no provider call at all, however many brands the Host had.
 *
 * FAILS-ON-REVERT (verified by the tester): have the module call Stripe for a
 * list other than the one it was given -> DT-1 fails.
 *
 * Run: deno test --allow-read --allow-env --allow-net --no-check \
 *   supabase/functions/_shared/__tests__/issue_3660_dropped_targets.tester2.retest4.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  purgeBusinessSideData,
  runBusinessSideDeletion,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000003665";
const brand = (n: number) =>
  `00000000-0000-4000-8000-0000000036${n.toString().padStart(2, "0")}`;

// What the first deletion detached (seven brands).
const FIRST_STRIPE = ["acct_K", "acct_T1", "acct_T2", "acct_R1", "acct_A1"];
const FIRST_PAYSTACK = ["ACCT_K", "ACCT_P1", "ACCT_P3"];

/** The retry answer after the brands moved on: the database kept K (and P3). */
const DB_RETRY_AFTER_CHANGES = {
  status: "deleted",
  brand_ids: [],
  already_deleted: true,
  stripe_accounts: [{ brand_id: brand(1), stripe_account_id: "acct_K" }],
  events_taken_down: 0,
  memberships_removed: 0,
  partner_links_ended: 0,
  paystack_subaccounts: [
    { brand_id: brand(1), subaccount_code: "ACCT_K" },
    { brand_id: brand(7), subaccount_code: "ACCT_P3" },
  ],
};

function harness(answer: unknown) {
  const stripe: string[] = [];
  const paystack: string[] = [];
  const client = {
    rpc: (_n: string, _a: Record<string, unknown>) =>
      Promise.resolve({ data: answer, error: null }),
    from: (_t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "or", "update", "delete"]) {
        b[m] = () => b;
      }
      b.insert = () => Promise.resolve({ error: null });
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ count: 0, data: null, error: null });
      return b;
    },
  };
  // deno-lint-ignore no-explicit-any
  const c = client as any;
  const run = () =>
    runBusinessSideDeletion(c, UID, {
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
      decide: () =>
        Promise.resolve({
          remove: false,
          reason: "business_records_retained" as const,
        }),
      deleteUser: () => Promise.resolve({ error: null }),
    });
  return { run, stripe, paystack };
}

Deno.test("#3660 DT-1 · only the targets the database kept reach a provider", async () => {
  const h = harness(DB_RETRY_AFTER_CHANGES);
  const outcome = await h.run();
  assertEquals(outcome.kind, "done");
  assertEquals(h.stripe, ["acct_K"]);
  assertEquals(h.paystack, ["ACCT_K", "ACCT_P3"]);
  for (const dropped of FIRST_STRIPE.filter((id) => id !== "acct_K")) {
    assertEquals(
      h.stripe.includes(dropped),
      false,
      `${dropped} was dropped by the database and still reached Stripe`,
    );
  }
  for (
    const dropped of FIRST_PAYSTACK.filter((c) =>
      c !== "ACCT_K" && c !== "ACCT_P3"
    )
  ) {
    assertEquals(
      h.paystack.includes(dropped),
      false,
      `${dropped} was dropped by the database and still reached Paystack`,
    );
  }
});

Deno.test("#3660 DT-2 · an answer with nothing left makes no provider call", async () => {
  const h = harness({
    ...DB_RETRY_AFTER_CHANGES,
    stripe_accounts: [],
    paystack_subaccounts: [],
  });
  const outcome = await h.run();
  assertEquals(outcome.kind, "done");
  assertEquals(h.stripe, []);
  assertEquals(h.paystack, []);
});
