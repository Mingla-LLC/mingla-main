/**
 * #2321 implementor REWORK — Business-side probes fail closed.
 *
 * The tester proved that errors from both count probes were read as zero, so an
 * Explorer purge could authorize auth deletion for a live Business owner. This
 * append-only suite executes the real predicate and evaluator. Each query error
 * must reject before either function can answer "no Business side" / remove:true.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  shouldDeleteAuthUser,
  userHasActiveBusinessSide,
} from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000002321";

interface Spec {
  counts?: Record<string, number>;
  errors?: Record<string, string>;
}

function makeClient(spec: Spec) {
  const from = (table: string) => {
    let countProbe = false;
    const settle = () => {
      if (countProbe) {
        const message = spec.errors?.[table];
        return message
          ? { count: null, data: null, error: { message } }
          : { count: spec.counts?.[table] ?? 0, data: null, error: null };
      }
      const data = table === "profiles"
        ? { explorer_deleted_at: "2026-08-20T12:00:00Z" }
        : table === "creator_accounts"
        ? null
        : null;
      return { count: null, data, error: null };
    };
    const builder = {
      select: (_columns: string, options?: { count?: string }) => {
        countProbe = options?.count === "exact";
        return builder;
      },
      eq: () => builder,
      is: () => builder,
      not: () => builder,
      maybeSingle: () => Promise.resolve(settle()),
      // deno-lint-ignore no-explicit-any
      then: (resolve: (value: any) => unknown) =>
        Promise.resolve(settle()).then(resolve),
    };
    return builder;
  };

  return { from } as unknown as Parameters<typeof shouldDeleteAuthUser>[0];
}

for (const table of ["brands", "brand_team_members"] as const) {
  Deno.test(`#2321 REWORK · ${table} error makes Business predicate reject`, async () => {
    const client = makeClient({ errors: { [table]: `${table} unavailable` } });
    await assertRejects(
      () => userHasActiveBusinessSide(client, UID),
      Error,
      `side-gate probe on ${table} failed`,
    );
  });

  Deno.test(`#2321 REWORK · ${table} error cannot authorize auth removal`, async () => {
    const client = makeClient({ errors: { [table]: `${table} unavailable` } });
    await assertRejects(
      () => shouldDeleteAuthUser(client, UID),
      Error,
      `side-gate probe on ${table} failed`,
    );
  });
}

Deno.test("#2321 REWORK · Business predicate preserves true and false controls", async () => {
  assertEquals(
    await userHasActiveBusinessSide(makeClient({ counts: { brands: 1 } }), UID),
    true,
  );
  assertEquals(
    await userHasActiveBusinessSide(
      makeClient({ counts: { brand_team_members: 1 } }),
      UID,
    ),
    true,
  );
  assertEquals(await userHasActiveBusinessSide(makeClient({}), UID), false);
});
