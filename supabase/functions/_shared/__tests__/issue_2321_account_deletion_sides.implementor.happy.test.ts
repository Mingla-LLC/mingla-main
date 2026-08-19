/**
 * #2321 [explorer account deletion never deleted] — implementor happy-path suite.
 * SPEC §7 T-4, T-5, T-6, T-7, T-9 and SC-4, SC-5, SC-10.
 *
 * Hermetic: no network, no database. A fake PostgREST client records every probe
 * and every mutation, so these assertions EXECUTE the real module rather than
 * reading its source.
 *
 * What went wrong, and what each test pins:
 *   `userHasActiveExplorerSide()` shipped with a bare `return true` after all six
 *   of its probes, so `explorerOk = explorerGone || !hasExplorer` was false for
 *   every user and the auth-deletion gate could never pass. Three of those probes
 *   additionally named columns that do not exist in production
 *   (`boards.user_id`, `pairings.user_id`, `preferences.id`), each 400ing and being
 *   read as "zero rows" — a check that cannot tell absence from failure (#2113).
 *   Separately, the identity-scrub UPDATE discarded its result, so PostgREST's
 *   rejection of the whole statement left the user's name, username, avatar, bio
 *   and onboarding flag intact behind an "Account Deleted" screen.
 *
 * FAILS-ON-REVERT (proven by true line deletion in the implementation report):
 *   - restore the trailing `return true`            → T-6 fails
 *   - drop the error check in countOrThrow          → T-7 fails
 *   - restore the discarded identity scrub          → T-4 fails
 *   - re-point the pairings purge at `user_id`      → T-9 fails
 *   - loosen isRetainReasonJustifiedForSide         → T-5 fails
 *
 * Run: deno test --allow-read supabase/functions/_shared/__tests__/issue_2321_account_deletion_sides.implementor.happy.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  type AuthRetainReason,
  isRetainReasonJustifiedForSide,
  purgeExplorerSideData,
  shouldDeleteAuthUser,
  userHasActiveExplorerSide,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000002321";

interface Probe {
  table: string;
  op: "count" | "delete" | "update" | "select";
  filters: Array<[string, string]>;
  payload?: Record<string, unknown>;
}

interface FakeSpec {
  /** exact-count answers per table; absent means 0 */
  counts?: Record<string, number>;
  /** tables whose probe returns a PostgREST error instead of a count */
  countErrors?: Record<string, string>;
  /** maybeSingle() answers per table */
  rows?: Record<string, Record<string, unknown> | null>;
  /** tables whose write returns an error */
  writeErrors?: Record<string, string>;
}

function makeClient(spec: FakeSpec) {
  const probes: Probe[] = [];

  const from = (table: string) => {
    const filters: Array<[string, string]> = [];
    let op: Probe["op"] = "select";
    let payload: Record<string, unknown> | undefined;
    let isCount = false;

    const settle = () => {
      probes.push({ table, op, filters: [...filters], payload });
      if (isCount) {
        const err = spec.countErrors?.[table];
        if (err !== undefined) {
          return { count: null, data: null, error: { message: err } };
        }
        return { count: spec.counts?.[table] ?? 0, data: null, error: null };
      }
      const werr = spec.writeErrors?.[table];
      if (werr !== undefined && (op === "update" || op === "delete")) {
        return { count: null, data: null, error: { message: werr } };
      }
      return {
        count: null,
        data: op === "select" ? (spec.rows?.[table] ?? null) : null,
        error: null,
      };
    };

    const builder = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === "exact") isCount = true;
        return builder;
      },
      update: (row: Record<string, unknown>) => {
        op = "update";
        payload = row;
        return builder;
      },
      delete: () => {
        op = "delete";
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
      in: () => builder,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (resolve: (value: any) => unknown) => Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };

  return { client: { from } as unknown as Parameters<typeof shouldDeleteAuthUser>[0], probes };
}

// ── T-6 / SC-4 — the gate can return false ──────────────────────────────────

Deno.test("#2321 T-6 · userHasActiveExplorerSide returns FALSE for a user with no explorer rows", async () => {
  const { client } = makeClient({ rows: { profiles: { explorer_deleted_at: null } } });
  assertEquals(await userHasActiveExplorerSide(client, UID), false);
});

Deno.test("#2321 T-6b · it still returns TRUE when a real explorer row exists", async () => {
  for (const table of ["friends", "calendar_entries", "preferences", "pairings", "boards"]) {
    const { client } = makeClient({
      rows: { profiles: { explorer_deleted_at: null } },
      counts: { [table]: 1 },
    });
    assertEquals(
      await userHasActiveExplorerSide(client, UID),
      true,
      `a row in ${table} must keep the explorer side active`,
    );
  }
});

Deno.test("#2321 T-6c · every probe names a column that exists in production", async () => {
  const { client, probes } = makeClient({ rows: { profiles: { explorer_deleted_at: null } } });
  await userHasActiveExplorerSide(client, UID);

  const filtersFor = (table: string) =>
    probes.filter((p) => p.table === table).flatMap((p) => p.filters.map(([c]) => c));

  assertEquals(filtersFor("friends"), ["user_id"]);
  assertEquals(filtersFor("calendar_entries"), ["user_id"]);
  assertEquals(filtersFor("preferences"), ["profile_id"]);
  assertEquals(filtersFor("boards"), ["created_by"]);

  const pairings = probes.find((p) => p.table === "pairings");
  assert(pairings !== undefined, "pairings must be probed");
  assertEquals(pairings.filters[0][0], "__or");
  assertEquals(pairings.filters[0][1], `user_a_id.eq.${UID},user_b_id.eq.${UID}`);
});

// ── T-7 — a failed probe is not an absence of rows ──────────────────────────

Deno.test("#2321 T-7 · a count probe that ERRORS throws; it is never read as zero", async () => {
  for (const table of ["friends", "calendar_entries", "preferences", "pairings", "boards"]) {
    const { client } = makeClient({
      rows: { profiles: { explorer_deleted_at: null } },
      countErrors: { [table]: `column ${table}.nope does not exist` },
    });
    await assertRejects(
      () => userHasActiveExplorerSide(client, UID),
      Error,
      `side-gate probe on ${table} failed`,
      `${table}: a 400 must not be read as "no rows"`,
    );
  }
});

// ── shouldDeleteAuthUser — the reason-carrying decision ─────────────────────

Deno.test("#2321 · a pure explorer user with nothing left is REMOVED, with no reason", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-08-19T06:06:27Z" },
      creator_accounts: null,
    },
  });
  assertEquals(await shouldDeleteAuthUser(client, UID), { remove: true, reason: null });
});

Deno.test("#2321 · an owner of a live brand is RETAINED for business_side_active", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-08-19T06:06:27Z" },
      creator_accounts: { deleted_at: null },
    },
    counts: { brands: 1 },
  });
  assertEquals(await shouldDeleteAuthUser(client, UID), {
    remove: false,
    reason: "business_side_active",
  });
});

Deno.test("#2321 · a live explorer side retains for explorer_side_active", async () => {
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: null },
      creator_accounts: { deleted_at: "2026-08-19T06:07:59Z" },
    },
    counts: { friends: 3 },
  });
  assertEquals(await shouldDeleteAuthUser(client, UID), {
    remove: false,
    reason: "explorer_side_active",
  });
});

Deno.test("#2321 F-6 · the brand-new account that reproduced the bug is now REMOVED", async () => {
  // Investigation F-6: an account created seconds earlier, with no brand, no team
  // row and no creator_accounts row, still got authRetained:true and was told
  // "your business login is unchanged". It must now delete outright.
  const { client } = makeClient({
    rows: {
      profiles: { explorer_deleted_at: "2026-08-19T06:06:27Z" },
      creator_accounts: null,
    },
  });
  const decision = await shouldDeleteAuthUser(client, UID);
  assertEquals(decision.remove, true);
  assertEquals(decision.reason, null);
});

// ── T-5 / SC-5 — the fail-closed rule ───────────────────────────────────────

Deno.test("#2321 T-5 · a retain reason is only justified by the OTHER side", () => {
  assertEquals(isRetainReasonJustifiedForSide("explorer", "business_side_active"), true);
  assertEquals(isRetainReasonJustifiedForSide("business", "explorer_side_active"), true);

  // Everything else is a server bug the caller must refuse to dress as success.
  assertEquals(isRetainReasonJustifiedForSide("explorer", "explorer_side_active"), false);
  assertEquals(isRetainReasonJustifiedForSide("business", "business_side_active"), false);
  assertEquals(isRetainReasonJustifiedForSide("explorer", null), false);
  assertEquals(isRetainReasonJustifiedForSide("business", null), false);
  assertEquals(
    isRetainReasonJustifiedForSide("explorer", "not_a_reason" as unknown as AuthRetainReason),
    false,
  );
});

// ── T-4 / SC-10 — the identity scrub cannot fail silently ───────────────────

Deno.test("#2321 T-4 · a failed identity scrub THROWS — the request cannot report success", async () => {
  const { client } = makeClient({ writeErrors: { profiles: "PGRST204 schema cache" } });
  await assertRejects(
    () => purgeExplorerSideData(client, UID),
    Error,
    "Account deletion could not be completed",
  );
});

Deno.test("#2321 · a successful scrub nulls every identity field and stamps the marker", async () => {
  const { client, probes } = makeClient({});
  await purgeExplorerSideData(client, UID);

  const scrub = probes.find((p) => p.table === "profiles" && p.op === "update");
  assert(scrub !== undefined, "the identity scrub must run");
  const payload = scrub.payload ?? {};
  for (const field of ["display_name", "first_name", "last_name", "username", "avatar_url", "bio"]) {
    assertEquals(payload[field], null, `${field} must be nulled`);
  }
  assertEquals(payload.has_completed_onboarding, false);
  assert(typeof payload.explorer_deleted_at === "string", "explorer_deleted_at must be stamped");
});

// ── T-9 — the pairings purge reaches both sides of the pair ─────────────────

Deno.test("#2321 T-9 · pairings are purged by user_a_id AND user_b_id, never user_id", async () => {
  const { client, probes } = makeClient({});
  await purgeExplorerSideData(client, UID);

  const pairingDeletes = probes.filter((p) => p.table === "pairings" && p.op === "delete");
  const columns = pairingDeletes.flatMap((p) => p.filters.map(([c]) => c)).sort();
  assertEquals(columns, ["user_a_id", "user_b_id"]);
  assert(
    !columns.includes("user_id"),
    "`pairings.user_id` does not exist — production logs show this purge failing on every run",
  );
});
