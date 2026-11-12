/**
 * #4402 — a creator profile keeps the login, Host account or not.
 *
 * Before #4402 a creator profile always implied a live creator_accounts row,
 * and #4202 retention relied on that. The creator identity is now the login,
 * so an Explorer-only creator has a creator profile and no Host account.
 * Removing their login would cascade through the profile into gig contracts
 * and the signed agreement (RESTRICT foreign keys). shouldDeleteAuthUser must
 * retain it with the existing `business_records_retained` reason, and a failed
 * creator_profiles probe must never be read as "no profile".
 *
 * Hermetic: a fake PostgREST client; no network, no database.
 * Run: deno test --allow-read supabase/functions/_shared/__tests__/issue_4402_creator_profile_retains_login.implementor.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  deleteAuthUserIfReady,
  isRetainReasonJustifiedForSide,
  shouldDeleteAuthUser,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000004402";

interface FakeSpec {
  counts?: Record<string, number>;
  countErrors?: Record<string, string>;
  rows?: Record<string, Record<string, unknown> | null>;
}

function makeClient(spec: FakeSpec) {
  const probes: Array<{ table: string; filters: Array<[string, string]> }> = [];
  const from = (table: string) => {
    const filters: Array<[string, string]> = [];
    let isCount = false;
    const settle = () => {
      probes.push({ table, filters: [...filters] });
      if (isCount) {
        const err = spec.countErrors?.[table];
        if (err !== undefined) return { count: null, data: null, error: { message: err } };
        return { count: spec.counts?.[table] ?? 0, data: null, error: null };
      }
      return { count: null, data: spec.rows?.[table] ?? null, error: null };
    };
    const builder = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === "exact") isCount = true;
        return builder;
      },
      eq: (column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      },
      or: (filter: string) => {
        filters.push(["__or", filter]);
        return builder;
      },
      is: () => builder,
      not: () => builder,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (resolve: (value: any) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };
  return { client: { from } as unknown as Parameters<typeof shouldDeleteAuthUser>[0], probes };
}

Deno.test("#4402 · an Explorer-only creator deleting Explorer keeps the login (business_records_retained)", async () => {
  const { client, probes } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-11-12T10:00:00Z" },
      creator_accounts: null,
    },
    counts: { creator_profiles: 1 },
  });
  const decision = await shouldDeleteAuthUser(client, UID);
  assertEquals(decision, { remove: false, reason: "business_records_retained" });
  assert(isRetainReasonJustifiedForSide("explorer", decision.reason));
  const probe = probes.find((p) => p.table === "creator_profiles");
  assert(probe, "creator_profiles must be probed before the login is removed");
  assertEquals(probe.filters, [["creator_account_id", UID]]);
});

Deno.test("#4402 · a failed creator_profiles probe retains (never read as zero)", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-11-12T10:00:00Z" },
      creator_accounts: null,
    },
    countErrors: { creator_profiles: "permission denied for table creator_profiles" },
  });
  await assertRejects(
    () => shouldDeleteAuthUser(client, UID),
    Error,
    "creator_profiles",
  );

  // The Explorer-side login step rethrows the gate failure: nothing is deleted.
  let deleted = false;
  await assertRejects(() =>
    deleteAuthUserIfReady(client, UID, "explorer", {
      deleteUser: () => {
        deleted = true;
        return Promise.resolve({ error: null });
      },
    })
  );
  assertEquals(deleted, false);
});

Deno.test("#4402 · a Host who deleted both sides but has a creator profile keeps the login", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-11-12T10:00:00Z" },
      creator_accounts: { deleted_at: "2026-11-12T09:00:00Z" },
    },
    counts: { creator_profiles: 1 },
  });
  assertEquals(await shouldDeleteAuthUser(client, UID), {
    remove: false,
    reason: "business_records_retained",
  });
});

Deno.test("#4402 · no brand and no creator profile still removes the login", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-11-12T10:00:00Z" },
      creator_accounts: null,
    },
  });
  assertEquals(await shouldDeleteAuthUser(client, UID), { remove: true, reason: null });
});
