/**
 * #3660 [Host account deletion completes or changes nothing] — adversarial suite
 * for the LOGIN step that runs after the Host side has been deleted
 * (SPEC §9 T-4; SC-7, SC-8, SC-10).
 *
 * Hermetic: a recording client stands in for the service-role Supabase client,
 * so the real `shouldDeleteAuthUser`, `deleteAuthUserIfReady` and
 * `runBusinessSideDeletion` are EXECUTED.
 *
 * Attack surface:
 *   - the 2026-10-11 failure itself: `auth.admin.deleteUser` refused by a foreign
 *     key AFTER the Host side was already changed, answered as an HTTP 500;
 *   - a login removal for a user who owns a brand row would cascade
 *     creator_accounts -> brands -> events -> orders / tickets;
 *   - the explorer side must not have been loosened by the business-side change.
 *
 * FAILS-ON-REVERT:
 *   - throw on a business-side deleteUser error again         → SC-7 fails
 *   - drop the brand-row probe from shouldDeleteAuthUser      → SC-8 fails
 *   - swallow the explorer-side deleteUser error              → "explorer still throws" fails
 *
 * Run: deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_3660_auth_step_after_purge.tester.adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  deleteAuthUserIfReady,
  isRetainReasonJustifiedForSide,
  runBusinessSideDeletion,
  shouldDeleteAuthUser,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000003661";

interface FakeSpec {
  rpc?: { data?: unknown; error?: { message: string } | null };
  counts?: Record<string, number>;
  countErrors?: Record<string, string>;
  rows?: Record<string, Record<string, unknown> | null>;
  /** what auth.admin.deleteUser answers */
  deleteUserError?: { message: string } | null;
  deleteUserThrows?: string;
}

function makeClient(spec: FakeSpec) {
  const log: string[] = [];
  const brandProbeFilters: string[][] = [];

  const from = (table: string) => {
    let op = "select";
    let isCount = false;
    const filters: string[] = [];
    const settle = () => {
      log.push(`from:${table}:${op}${isCount ? ":count" : ""}`);
      if (table === "brands" && isCount) brandProbeFilters.push([...filters]);
      if (isCount) {
        const err = spec.countErrors?.[table];
        if (err !== undefined) return { count: null, data: null, error: { message: err } };
        return { count: spec.counts?.[table] ?? 0, data: null, error: null };
      }
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
      insert: () => Promise.resolve({ error: null }),
      eq: (column: string) => {
        filters.push(`eq:${column}`);
        return builder;
      },
      or: () => builder,
      is: (column: string) => {
        filters.push(`is:${column}`);
        return builder;
      },
      not: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (resolve: (value: any) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };

  const rpc = (name: string) => {
    log.push(`rpc:${name}`);
    return Promise.resolve({ data: spec.rpc?.data ?? null, error: spec.rpc?.error ?? null });
  };

  const auth = {
    admin: {
      deleteUser: (_id: string) => {
        log.push("auth.admin.deleteUser");
        if (spec.deleteUserThrows) return Promise.reject(new Error(spec.deleteUserThrows));
        return Promise.resolve({ error: spec.deleteUserError ?? null });
      },
    },
  };

  const client = { from, rpc, auth } as unknown as Parameters<typeof shouldDeleteAuthUser>[0];
  return { client, log, brandProbeFilters };
}

const deleteUserCalls = (log: string[]) => log.filter((l) => l === "auth.admin.deleteUser").length;

const noProviders = {
  stripeClient: () => ({ accounts: { del: () => Promise.resolve({}) } }),
  paystackDeactivate: () => Promise.resolve({}),
};

/** A team member who owned no brand: both sides gone, no brand row → removable. */
const REMOVABLE = {
  rows: {
    profiles: { explorer_deleted_at: "2026-10-01T00:00:00Z" },
    creator_accounts: { deleted_at: "2026-10-11T00:00:00Z" },
  },
  counts: { brands: 0 },
};

const DELETED = {
  status: "deleted",
  already_deleted: false,
  brand_ids: [],
  events_taken_down: 0,
  memberships_removed: 1,
  partner_links_ended: 0,
  stripe_accounts: [],
  paystack_subaccounts: [],
};

// ── SC-7 — the 2026-10-11 failure can no longer produce a failure response ──

Deno.test("#3660 SC-7 · business side: auth.admin.deleteUser returning an error is a retained login, not a throw", async () => {
  const { client, log } = makeClient({
    ...REMOVABLE,
    deleteUserError: { message: "Database error deleting user" },
  });

  const result = await deleteAuthUserIfReady(client, UID, "business");

  assertEquals(deleteUserCalls(log), 1, "the fixture must actually reach deleteUser");
  assertEquals(result, {
    authDeleted: false,
    authRetained: true,
    retainedReason: "business_records_retained",
  });
});

Deno.test("#3660 SC-7 · business side: auth.admin.deleteUser THROWING is also a retained login", async () => {
  const { client } = makeClient({ ...REMOVABLE, deleteUserThrows: "network down" });
  const result = await deleteAuthUserIfReady(client, UID, "business");
  assertEquals(result.authRetained, true);
  assertEquals(result.retainedReason, "business_records_retained");
});

Deno.test("#3660 SC-7 · the whole business deletion ends `done` when the login step fails after the commit", async () => {
  const { client, log } = makeClient({
    ...REMOVABLE,
    rpc: { data: DELETED },
    deleteUserError: { message: "update or delete on table users violates foreign key constraint" },
  });

  const outcome = await runBusinessSideDeletion(client, UID, noProviders);

  assertEquals(deleteUserCalls(log), 1);
  assert(outcome.kind === "done", `expected done, got ${outcome.kind}`);
  assertEquals(outcome.authDeleted, false);
  assertEquals(outcome.authRetained, true);
  assertEquals(outcome.retainedReason, "business_records_retained");
  assert(isRetainReasonJustifiedForSide("business", outcome.retainedReason));
});

Deno.test("#3660 SC-7 · business side: a FAILING gate probe after the commit is a retained login, not a throw", async () => {
  const { client, log } = makeClient({
    ...REMOVABLE,
    rpc: { data: DELETED },
    countErrors: { brands: "permission denied" },
  });

  const outcome = await runBusinessSideDeletion(client, UID, noProviders);

  assert(outcome.kind === "done");
  assertEquals(outcome.authRetained, true);
  assertEquals(deleteUserCalls(log), 0, "an unanswered gate must never remove a login");
});

// ── SC-8 — a brand owner's login is never removed, on either side ───────────

Deno.test("#3660 SC-8 · a user who owns a brand row keeps the login (both sides gone)", async () => {
  const { client, brandProbeFilters } = makeClient({
    rows: REMOVABLE.rows,
    counts: { brands: 1 },
  });

  assertEquals(await shouldDeleteAuthUser(client, UID), {
    remove: false,
    reason: "business_records_retained",
  });
  // The probe must count SOFT-DELETED brands too: no deleted_at filter.
  assertEquals(brandProbeFilters.length, 1);
  assertEquals(brandProbeFilters[0], ["eq:account_id"]);
});

Deno.test("#3660 SC-8 · the same holds on the slow path (neither side stamped, no active rows)", async () => {
  const { client } = makeClient({
    rows: { profiles: { explorer_deleted_at: null }, creator_accounts: { deleted_at: null } },
    counts: { brands: 1 },
  });
  // brands:1 also answers userHasActiveBusinessSide's live-brand probe, so this
  // user still has an active Host side: that existing reason keeps precedence.
  assertEquals(await shouldDeleteAuthUser(client, UID), {
    remove: false,
    reason: "business_side_active",
  });
});

for (const side of ["business", "explorer"] as const) {
  Deno.test(`#3660 SC-8 · side=${side}: auth.admin.deleteUser is never called for a brand owner`, async () => {
    const { client, log } = makeClient({ rows: REMOVABLE.rows, counts: { brands: 2 } });

    const result = await deleteAuthUserIfReady(client, UID, side);

    assertEquals(deleteUserCalls(log), 0);
    assertEquals(result, {
      authDeleted: false,
      authRetained: true,
      retainedReason: "business_records_retained",
    });
    assert(
      isRetainReasonJustifiedForSide(side, result.retainedReason),
      "the caller's fail-closed check must accept this reason on both sides",
    );
  });
}

Deno.test("#3660 SC-8 · a brand probe that ERRORS is not read as zero brands", async () => {
  const { client } = makeClient({
    rows: REMOVABLE.rows,
    countErrors: { brands: "permission denied" },
  });
  await assertRejects(() => shouldDeleteAuthUser(client, UID), Error, "brands");
});

Deno.test("#3660 · the existing reason pairings are unchanged", () => {
  assertEquals(isRetainReasonJustifiedForSide("explorer", "business_side_active"), true);
  assertEquals(isRetainReasonJustifiedForSide("explorer", "explorer_side_active"), false);
  assertEquals(isRetainReasonJustifiedForSide("business", "explorer_side_active"), true);
  assertEquals(isRetainReasonJustifiedForSide("business", "business_side_active"), false);
  assertEquals(isRetainReasonJustifiedForSide("explorer", null), false);
  assertEquals(isRetainReasonJustifiedForSide("business", null), false);
});

// ── SC-10 — the explorer side is unchanged for a user who owns no brand ─────

Deno.test("#3660 SC-10 · explorer side, no brand row: the login IS removed, same response as before", async () => {
  const { client, log } = makeClient({ ...REMOVABLE, rows: { ...REMOVABLE.rows, profiles: null } });
  // profiles: null → explorer_deleted_at reads as unset, so the gate takes its
  // slow path (no active rows on either side, no brand row) and the
  // surviving-profile probe afterwards finds nothing to clean up.
  const result = await deleteAuthUserIfReady(client, UID, "explorer");

  assertEquals(deleteUserCalls(log), 1);
  assertEquals(result, { authDeleted: true, authRetained: false, retainedReason: null });
});

Deno.test("#3660 SC-10 · explorer side: a deleteUser error STILL throws (not loosened)", async () => {
  const { client, log } = makeClient({
    ...REMOVABLE,
    deleteUserError: { message: "Database error deleting user" },
  });

  await assertRejects(
    () => deleteAuthUserIfReady(client, UID, "explorer"),
    Error,
    "Failed to delete account. Please try again.",
  );
  assertEquals(deleteUserCalls(log), 1);
});

Deno.test("#3660 SC-10 · explorer side: a failing gate probe STILL throws", async () => {
  const { client, log } = makeClient({
    rows: REMOVABLE.rows,
    countErrors: { brands: "permission denied" },
  });
  await assertRejects(() => deleteAuthUserIfReady(client, UID, "explorer"), Error);
  assertEquals(deleteUserCalls(log), 0);
});

Deno.test("#3660 SC-10 · explorer side with an active Host side keeps the #2321 reason", async () => {
  const { client, log } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-10-01T00:00:00Z" },
      creator_accounts: { deleted_at: null },
    },
    counts: { brands: 1 },
  });

  const result = await deleteAuthUserIfReady(client, UID, "explorer");

  assertEquals(result.retainedReason, "business_side_active");
  assertEquals(deleteUserCalls(log), 0);
});

Deno.test("#4202 · explorer deletion never calls auth delete for an active Creator identity without a brand", async () => {
  const { client, log } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-10-31T21:37:28Z" },
      creator_accounts: { deleted_at: null },
    },
    counts: { brands: 0, brand_team_members: 0 },
  });

  const result = await deleteAuthUserIfReady(client, UID, "explorer");

  assertEquals(deleteUserCalls(log), 0);
  assertEquals(result, {
    authDeleted: false,
    authRetained: true,
    retainedReason: "business_side_active",
  });
});
