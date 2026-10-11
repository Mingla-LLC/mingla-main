/**
 * #3660 [Host account deletion completes or changes nothing] — INDEPENDENT
 * TESTER (tester2) suite. Written by the tester, not the implementor.
 *
 * Axis: the WIRE between the three layers. The implementor suites prove each
 * layer alone (the database function in SQL, the edge module against a fake
 * client, the Host parser against hand-written bodies). Nothing proves that
 * what one layer emits is what the next one reads. This suite takes the exact
 * JSON `public.biz_delete_host_account` returned on a real database (captured
 * during the tester's run, ids replaced), pushes it through the real edge
 * module, builds the 409 exactly as `delete-user/index.ts` does, serialises it
 * through a real `Response`, and reads it back with the Host app's real parser
 * and copy function.
 *
 * It also covers two things neither implementor suite does:
 *   - a retry after a lost response (the first call committed, the client never
 *     heard): the second call must end `done`, never `failed`, and must not
 *     call a provider a second time;
 *   - hostile or malformed refusal bodies cannot crash the Host parser and
 *     cannot be mistaken for a success.
 *
 * FAILS-ON-REVERT (verified by the tester):
 *   - rename `code` or `blockers` in the 409 body in delete-user/index.ts,
 *     or return the refusal as a 2xx                       -> W-0 fails
 *   - decide a block from message text in the Host parser   -> W-3 fails
 *   - drop `partner_payment_in_progress` from the Host copy -> W-2 fails
 *   - call Stripe again on an `already_deleted` retry       -> W-4 fails
 *
 * Run: deno test --allow-read --allow-env --allow-net --no-check \
 *   supabase/functions/_shared/__tests__/issue_3660_wire_contract.tester2.adversarial.test.ts
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
  ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
  AccountDeletionBlockedError,
  AccountDeletionFailedError,
  describeDeletionBlocker,
  parseDeletionFailure,
} from "../../../../mingla-business/src/utils/accountDeletionErrors.ts";

const UID = "00000000-0000-4000-8000-000000003661";
const BRAND = "00000000-0000-4000-8000-0000000036b1";
const EVENT = "00000000-0000-4000-8000-0000000036e1";

const EDGE_SOURCE = new URL("../../delete-user/index.ts", import.meta.url);

/**
 * The exact shape the database function returned for a blocked Host on the
 * tester's scratch database (PostgreSQL 17.4, every migration applied), with
 * the ids replaced. Two event codes carry `items`; the count codes do not.
 */
const DB_BLOCKED = {
  status: "blocked",
  blockers: [
    {
      code: "tickets_sold",
      count: 1,
      items: [{ id: EVENT, title: "T2 Multi Date" }],
    },
    { code: "upcoming_reservations", count: 2 },
    { code: "partner_payment_in_progress", count: 1 },
  ],
};

const DB_DELETED = {
  status: "deleted",
  brand_ids: [BRAND],
  already_deleted: false,
  stripe_accounts: [{ brand_id: BRAND, stripe_account_id: "acct_t2_wire" }],
  events_taken_down: 1,
  memberships_removed: 0,
  partner_links_ended: 0,
  paystack_subaccounts: [{ brand_id: BRAND, subaccount_code: "ACCT_t2_wire" }],
};

const DB_ALREADY_DELETED = {
  status: "deleted",
  brand_ids: [],
  already_deleted: true,
  stripe_accounts: [],
  events_taken_down: 0,
  memberships_removed: 0,
  partner_links_ended: 0,
  paystack_subaccounts: [],
};

/** A service-role client whose only job is to answer the one RPC. */
function rpcClient(answers: unknown[]) {
  const calls: string[] = [];
  let i = 0;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`);
      const data = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return Promise.resolve({ data, error: null });
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
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
  return { client: client as any, calls };
}

/** The refusal exactly as delete-user/index.ts builds it, through a real Response. */
function edgeRefusal(blockers: unknown): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: "account_deletion_blocked",
      code: "account_deletion_blocked",
      blockers,
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

Deno.test("#3660 W-0 · the edge function still builds the refusal this suite replays", async () => {
  const source = await Deno.readTextFile(EDGE_SOURCE);
  const at = source.indexOf('outcome.kind === "blocked"');
  assert(
    at > 0,
    'delete-user no longer branches on outcome.kind === "blocked"',
  );
  const block = source.slice(at, at + 700);
  assert(
    /codedResponse\(\s*409\s*,/.test(block),
    "a refusal is no longer answered with HTTP 409",
  );
  assert(
    /code:\s*"account_deletion_blocked"/.test(block),
    "the refusal lost its `code`",
  );
  assert(
    /blockers:\s*outcome\.blockers/.test(block),
    "the refusal lost its `blockers`",
  );
  assert(
    /success:\s*false/.test(block),
    "the refusal no longer says success:false",
  );
});

Deno.test("#3660 W-1 · database refusal -> edge module -> 409 -> Host parser keeps every blocker", async () => {
  const { client, calls } = rpcClient([DB_BLOCKED]);
  const providerCalls: string[] = [];
  const outcome = await runBusinessSideDeletion(client, UID, {
    purge: () => purgeBusinessSideData(client, UID),
    stripeClient: () => ({
      accounts: {
        del: (id: string) => {
          providerCalls.push(`stripe:${id}`);
          return Promise.resolve({});
        },
      },
    }),
    paystackDeactivate: (code: string) => {
      providerCalls.push(`paystack:${code}`);
      return Promise.resolve({});
    },
    recordTrialPhone: () => {
      providerCalls.push("trial_phone");
      return Promise.resolve();
    },
    decide: () => {
      providerCalls.push("decide");
      return Promise.resolve({ remove: true, reason: null });
    },
    deleteUser: () => {
      providerCalls.push("deleteUser");
      return Promise.resolve({ error: null });
    },
  });

  assertEquals(outcome.kind, "blocked");
  assertEquals(
    providerCalls,
    [],
    "a refused deletion reached the outside world",
  );
  assertEquals(
    calls.length,
    1,
    "a refused deletion made more than the one RPC",
  );
  assert(calls[0].startsWith("rpc:biz_delete_host_account:"));

  if (outcome.kind !== "blocked") throw new Error("unreachable");
  const response = edgeRefusal(outcome.blockers);
  const error = parseDeletionFailure(response.status, await response.json());

  assert(
    error instanceof AccountDeletionBlockedError,
    "the Host app did not read the 409 as a block",
  );
  assertEquals(
    (error as AccountDeletionBlockedError).blockers,
    DB_BLOCKED.blockers,
    "a blocker was lost or reshaped between the database and the Host screen",
  );
});

Deno.test("#3660 W-2 · every code the database can return has its own words on the Host screen", () => {
  // The seven codes private.host_account_deletion_blockers can emit.
  const codes = [
    "tickets_sold",
    "checkout_in_progress",
    "upcoming_reservations",
    "upcoming_stays",
    "open_menu_orders",
    "money_in_motion",
    "partner_payment_in_progress",
  ];
  const seen = new Set<string>();
  for (const code of codes) {
    const line = describeDeletionBlocker({
      code,
      count: 2,
      items: [{ id: EVENT, title: "T2 Multi Date" }],
    });
    assert(
      line !== ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
      `${code} falls through to the generic "contact support" line`,
    );
    assert(!seen.has(line), `${code} shares its words with another code`);
    seen.add(line);
    assert(
      !/undefined|NaN|\[object/.test(line),
      `${code} renders a placeholder: ${line}`,
    );
  }
  // The amendment removed this code; if the server ever sends it, it must not crash.
  assertEquals(
    describeDeletionBlocker({ code: "active_partner_link", count: 1 }),
    ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE,
  );
});

Deno.test("#3660 W-3 · hostile or malformed refusal bodies never crash and never look like success", () => {
  const blockedBodies: unknown[] = [
    { code: "account_deletion_blocked" },
    { code: "account_deletion_blocked", blockers: null },
    { code: "account_deletion_blocked", blockers: "tickets_sold" },
    {
      code: "account_deletion_blocked",
      blockers: [null, 7, "x", {}, { code: 5 }],
    },
    {
      code: "account_deletion_blocked",
      blockers: [{
        code: "tickets_sold",
        count: "many",
        items: [null, { id: 1 }, { title: "x" }],
      }],
    },
    {
      code: "account_deletion_blocked",
      blockers: [{ code: "__proto__", count: 1 }],
    },
  ];
  for (const body of blockedBodies) {
    const error = parseDeletionFailure(409, body);
    assert(error instanceof AccountDeletionBlockedError);
    for (const blocker of (error as AccountDeletionBlockedError).blockers) {
      const line = describeDeletionBlocker(blocker);
      assert(typeof line === "string" && line.length > 0);
      assert(
        !/undefined|NaN|\[object/.test(line),
        `placeholder leaked into copy: ${line}`,
      );
    }
  }

  // The decision is made on status AND code, never on message text.
  const notBlocks: Array<[number, unknown]> = [
    [409, { error: "account_deletion_blocked" }],
    [409, { message: "account_deletion_blocked", code: "something_else" }],
    [409, "account_deletion_blocked"],
    [409, null],
    [409, [{ code: "account_deletion_blocked" }]],
    [500, { code: "account_deletion_blocked", blockers: [] }],
    [200, { code: "account_deletion_blocked", blockers: [] }],
    [0, { code: "account_deletion_blocked" }],
  ];
  for (const [status, body] of notBlocks) {
    const error = parseDeletionFailure(status, body);
    assert(
      error instanceof AccountDeletionFailedError,
      `status ${status} with ${JSON.stringify(body)} was read as a block`,
    );
  }
});

Deno.test("#3660 W-4 · a retry after a lost response ends `done` and does not call a provider twice", async () => {
  // First call commits; pretend the response never reached the Host app.
  // The Host taps Delete again: the database answers already_deleted.
  const { client } = rpcClient([DB_DELETED, DB_ALREADY_DELETED]);
  const stripe: string[] = [];
  const paystack: string[] = [];
  const deps = {
    purge: () => purgeBusinessSideData(client, UID),
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
  };

  const first = await runBusinessSideDeletion(client, UID, deps);
  const second = await runBusinessSideDeletion(client, UID, deps);

  assertEquals(first.kind, "done");
  assertEquals(
    second.kind,
    "done",
    "a repeat of a finished deletion was reported as a failure",
  );
  assertEquals(
    stripe,
    ["acct_t2_wire"],
    "Stripe was called a number of times other than once",
  );
  assertEquals(
    paystack,
    ["ACCT_t2_wire"],
    "Paystack was called a number of times other than once",
  );
  if (second.kind !== "done") throw new Error("unreachable");
  assertEquals(second.purge.already_deleted, true);
  assertEquals(second.authRetained, true);
});

Deno.test("#3660 W-5 · the success body the edge returns is never read as an error by the Host hook", async () => {
  // useRequestAccountDeletion throws when `data.error` is truthy. The 200 body
  // must therefore carry no `error` key, retained login or not.
  const source = await Deno.readTextFile(EDGE_SOURCE);
  const at = source.lastIndexOf("codedResponse(200");
  assert(
    at > 0,
    "delete-user no longer answers a finished Host deletion with codedResponse(200",
  );
  const block = source.slice(at, source.indexOf("});", at));
  assert(/success:\s*true/.test(block));
  assert(
    !/\berror\s*:/.test(block),
    "the 200 body carries an `error` key; the Host app would report failure",
  );
});
