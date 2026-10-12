/**
 * #3660 [Host account deletion completes or changes nothing] — implementor
 * happy-path suite (SPEC §9 T-3; SC-6; I-PROPOSED-3660-HOST-DELETION-IS-ONE-TRANSACTION).
 *
 * Hermetic: no network, no database. A recording client stands in for the
 * service-role Supabase client, so these assertions EXECUTE the real module
 * (`purgeBusinessSideData`, `runBusinessSideDeletion`, the Stripe and Paystack
 * detach steps) instead of reading its source.
 *
 * What went wrong: a Host deletion was an unchecked Stripe call followed by three
 * unchecked table writes (brands, brand_team_members, creator_accounts). The
 * brand write was refused by a database guard while the account stamp landed,
 * leaving an account marked deleted that still owned a live brand, and the
 * Stripe account had already been deleted before anything was checked.
 *
 * FAILS-ON-REVERT:
 *   - put any of the three table writes back into purgeBusinessSideData → T-3a fails
 *   - call Stripe before the RPC, or on a blocked result             → T-3b / T-3d fail
 *   - swallow an RPC error and carry on                               → T-3c fails
 *   - let a provider rejection throw                                  → T-3e fails
 *
 * Run: deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_3660_host_account_deletion.implementor.happy.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  AccountDeletionBlockedError,
  AccountDeletionFailedError,
  purgeBusinessSideData,
  runBusinessSideDeletion,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000003660";
const BRAND = "00000000-0000-4000-8000-0000000036b0";

interface FakeSpec {
  rpc?: { data?: unknown; error?: { message: string } | null };
  counts?: Record<string, number>;
  rows?: Record<string, Record<string, unknown> | null>;
  insertErrors?: Record<string, string>;
}

/** Records every call, in order, as a flat event log. */
function makeClient(spec: FakeSpec) {
  const log: string[] = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const writes: string[] = [];

  const from = (table: string) => {
    let op = "select";
    let isCount = false;
    const settle = () => {
      log.push(`from:${table}:${op}`);
      if (op !== "select") writes.push(`${table}:${op}`);
      if (isCount) return { count: spec.counts?.[table] ?? 0, data: null, error: null };
      return {
        count: null,
        data: op === "select" ? (spec.rows?.[table] ?? null) : null,
        error: null,
      };
    };
    const builder = {
      select: (_cols: string, opts?: { count?: string }) => {
        if (opts?.count === "exact") isCount = true;
        return builder;
      },
      update: () => {
        op = "update";
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        log.push(`from:${table}:insert`);
        inserts.push({ table, row });
        const err = spec.insertErrors?.[table];
        return Promise.resolve({ error: err ? { message: err } : null });
      },
      eq: () => builder,
      or: () => builder,
      is: () => builder,
      not: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (resolve: (value: any) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };

  const rpc = (name: string, args: Record<string, unknown>) => {
    log.push(`rpc:${name}:${JSON.stringify(args)}`);
    return Promise.resolve({
      data: spec.rpc?.data ?? null,
      error: spec.rpc?.error ?? null,
    });
  };

  const auth = {
    admin: {
      deleteUser: (_id: string) => {
        log.push("auth.admin.deleteUser");
        return Promise.resolve({ error: null });
      },
    },
  };

  const client = { from, rpc, auth } as unknown as Parameters<typeof purgeBusinessSideData>[0];
  return { client, log, inserts, writes };
}

/** Provider fakes that write into the same ordered log as the client. */
function makeProviders(log: string[], opts: { stripeThrows?: string; paystackThrows?: string } = {}) {
  return {
    stripeClient: () => ({
      accounts: {
        del: (id: string, o: { apiVersion: string; idempotencyKey: string }) => {
          log.push(`stripe.accounts.del:${id}`);
          assert(o.idempotencyKey.length > 0, "Stripe delete must carry an idempotency key");
          if (opts.stripeThrows) return Promise.reject(new Error(opts.stripeThrows));
          return Promise.resolve({ deleted: true });
        },
      },
    }),
    paystackDeactivate: (code: string) => {
      log.push(`paystack.deactivate:${code}`);
      if (opts.paystackThrows) return Promise.reject(new Error(opts.paystackThrows));
      return Promise.resolve({});
    },
  };
}

const DELETED_PAYLOAD = {
  status: "deleted",
  already_deleted: false,
  brand_ids: [BRAND],
  events_taken_down: 1,
  memberships_removed: 0,
  partner_links_ended: 0,
  stripe_accounts: [{ brand_id: BRAND, stripe_account_id: "acct_i3660_test" }],
  paystack_subaccounts: [{ brand_id: BRAND, subaccount_code: "ACCT_i3660_test" }],
};

// ── T-3a — one RPC, no table writes ─────────────────────────────────────────

Deno.test("#3660 T-3a · purgeBusinessSideData makes exactly one RPC and touches no table", async () => {
  const { client, log } = makeClient({ rpc: { data: DELETED_PAYLOAD } });

  const result = await purgeBusinessSideData(client, UID);

  assertEquals(log, [`rpc:biz_delete_host_account:${JSON.stringify({ p_user_id: UID })}`]);
  assertEquals(result.status, "deleted");
  assertEquals(result.brand_ids, [BRAND]);
  assertEquals(result.stripe_accounts.length, 1);
  assertEquals(result.paystack_subaccounts.length, 1);
});

// ── T-3b — blocked: the blocked error, and nothing outside is called ────────

Deno.test("#3660 T-3b · a blocked result throws AccountDeletionBlockedError carrying the blockers", async () => {
  const blockers = [{ code: "tickets_sold", count: 1, items: [{ id: "e1", title: "An event" }] }];
  const { client } = makeClient({ rpc: { data: { status: "blocked", blockers } } });

  const err = await assertRejects(
    () => purgeBusinessSideData(client, UID),
    AccountDeletionBlockedError,
  );
  assertEquals(err.blockers, blockers);
  assertEquals(err.code, "account_deletion_blocked");
});

Deno.test("#3660 T-3b · SC-6 a blocked deletion calls no provider, no trial-phone record and no login step", async () => {
  const blockers = [{ code: "tickets_sold", count: 2 }, { code: "money_in_motion", count: 1 }];
  const { client, log, writes } = makeClient({ rpc: { data: { status: "blocked", blockers } } });
  let trialPhoneCalls = 0;

  const outcome = await runBusinessSideDeletion(client, UID, {
    ...makeProviders(log),
    recordTrialPhone: () => {
      trialPhoneCalls += 1;
      return Promise.resolve();
    },
  });

  assertEquals(outcome.kind, "blocked");
  assert(outcome.kind === "blocked");
  assertEquals(outcome.blockers, blockers);
  assertEquals(trialPhoneCalls, 0);
  assertEquals(writes, []);
  // The ONLY thing that happened is the one RPC.
  assertEquals(log.length, 1, `unexpected calls after a block: ${log.join(" | ")}`);
  assert(log[0].startsWith("rpc:biz_delete_host_account:"));
});

// ── T-3c — the RPC failing is a failure, not a success ──────────────────────

Deno.test("#3660 T-3c · an RPC error throws AccountDeletionFailedError", async () => {
  const { client } = makeClient({ rpc: { error: { message: "function does not exist" } } });
  await assertRejects(() => purgeBusinessSideData(client, UID), AccountDeletionFailedError);
});

Deno.test("#3660 T-3c · an answer with no readable status is a failure (fail closed)", async () => {
  for (const data of [null, {}, { status: "ok" }, "deleted"]) {
    const { client } = makeClient({ rpc: { data } });
    await assertRejects(
      () => purgeBusinessSideData(client, UID),
      AccountDeletionFailedError,
      undefined,
      `payload ${JSON.stringify(data)} must not be read as a deletion`,
    );
  }
});

Deno.test("#3660 T-3c · a failed deletion calls no provider, no trial-phone record and no login step", async () => {
  const { client, log, writes } = makeClient({ rpc: { error: { message: "boom" } } });
  let trialPhoneCalls = 0;

  const outcome = await runBusinessSideDeletion(client, UID, {
    ...makeProviders(log),
    recordTrialPhone: () => {
      trialPhoneCalls += 1;
      return Promise.resolve();
    },
  });

  assertEquals(outcome.kind, "failed");
  assertEquals(trialPhoneCalls, 0);
  assertEquals(writes, []);
  assertEquals(log.length, 1, `unexpected calls after a failure: ${log.join(" | ")}`);
});

// ── T-3d — deleted: providers once each, and only AFTER the RPC ─────────────

Deno.test("#3660 T-3d · after a committed deletion Stripe and Paystack are each called once, after the RPC", async () => {
  const { client, log, writes } = makeClient({
    rpc: { data: DELETED_PAYLOAD },
    rows: {
      profiles: { explorer_deleted_at: null },
      creator_accounts: { deleted_at: "2026-10-11T00:00:00Z" },
    },
    // The user owned a brand: the login must be kept.
    counts: { brands: 1 },
  });
  const order: string[] = [];

  const outcome = await runBusinessSideDeletion(client, UID, {
    ...makeProviders(log),
    recordTrialPhone: () => {
      order.push("trial");
      log.push("trial_phone");
      return Promise.resolve();
    },
  });

  assertEquals(outcome.kind, "done");
  const rpcAt = log.findIndex((l) => l.startsWith("rpc:biz_delete_host_account:"));
  const trialAt = log.indexOf("trial_phone");
  const stripeAt = log.indexOf("stripe.accounts.del:acct_i3660_test");
  const paystackAt = log.indexOf("paystack.deactivate:ACCT_i3660_test");

  assertEquals(rpcAt, 0, "the RPC must be the very first call");
  assert(trialAt > rpcAt, "trial-phone record must come after the RPC");
  assert(stripeAt > rpcAt, "Stripe must come after the RPC");
  assert(paystackAt > rpcAt, "Paystack must come after the RPC");
  assertEquals(log.filter((l) => l.startsWith("stripe.accounts.del:")).length, 1);
  assertEquals(log.filter((l) => l.startsWith("paystack.deactivate:")).length, 1);
  assertEquals(log.filter((l) => l.startsWith("rpc:")).length, 1);
  // No table write anywhere in a clean run: the function owns every write.
  assertEquals(writes, []);
  assert(!log.includes("auth.admin.deleteUser"), "a brand owner's login must never be removed");
  assert(outcome.kind === "done");
  assertEquals(outcome.authRetained, true);
  assertEquals(outcome.retainedReason, "business_records_retained");
});

Deno.test("#3660 T-3d · nothing_to_delete is not a failure and calls no provider", async () => {
  const { client, log } = makeClient({
    rpc: { data: { status: "nothing_to_delete" } },
    rows: { profiles: { explorer_deleted_at: null }, creator_accounts: null },
  });

  const outcome = await runBusinessSideDeletion(client, UID, makeProviders(log));

  assertEquals(outcome.kind, "done");
  assertEquals(log.filter((l) => l.startsWith("stripe.") || l.startsWith("paystack.")).length, 0);
});

// ── T-3e — a provider rejection never undoes a finished deletion ────────────

Deno.test("#3660 T-3e · a Stripe AND a Paystack rejection still end in `done`, each with one audit row", async () => {
  const { client, log, inserts } = makeClient({
    rpc: { data: DELETED_PAYLOAD },
    rows: {
      profiles: { explorer_deleted_at: null },
      creator_accounts: { deleted_at: "2026-10-11T00:00:00Z" },
    },
    counts: { brands: 1 },
  });

  const outcome = await runBusinessSideDeletion(
    client,
    UID,
    makeProviders(log, { stripeThrows: "stripe says no", paystackThrows: "paystack says no" }),
  );

  assertEquals(outcome.kind, "done");
  const actions = inserts.filter((i) => i.table === "audit_log").map((i) => i.row.action);
  assertEquals(actions, [
    "stripe_connect.detach_local_success_stripe_rejected",
    "paystack.subaccount_deactivate_failed",
  ]);
  for (const i of inserts) {
    assertEquals(i.row.user_id, UID);
    assertEquals(i.row.brand_id, BRAND);
  }
});

Deno.test("#3660 T-3e · Stripe not being configured is audited, not thrown", async () => {
  const { client, log, inserts } = makeClient({
    rpc: { data: DELETED_PAYLOAD },
    rows: {
      profiles: { explorer_deleted_at: null },
      creator_accounts: { deleted_at: "2026-10-11T00:00:00Z" },
    },
    counts: { brands: 1 },
  });

  const outcome = await runBusinessSideDeletion(client, UID, {
    ...makeProviders(log),
    stripeClient: () => {
      throw new Error("STRIPE key missing");
    },
  });

  assertEquals(outcome.kind, "done");
  assertEquals(
    inserts.map((i) => i.row.action),
    ["stripe_connect.detach_local_success_stripe_rejected"],
  );
});

Deno.test("#3660 T-3e · a failing audit write and a failing trial-phone record do not change the outcome", async () => {
  const { client, log } = makeClient({
    rpc: { data: DELETED_PAYLOAD },
    rows: {
      profiles: { explorer_deleted_at: null },
      creator_accounts: { deleted_at: "2026-10-11T00:00:00Z" },
    },
    counts: { brands: 1 },
    insertErrors: { audit_log: "audit is down" },
  });

  const outcome = await runBusinessSideDeletion(client, UID, {
    ...makeProviders(log, { stripeThrows: "no" }),
    recordTrialPhone: () => Promise.reject(new Error("trial phone is down")),
  });

  assertEquals(outcome.kind, "done");
});
