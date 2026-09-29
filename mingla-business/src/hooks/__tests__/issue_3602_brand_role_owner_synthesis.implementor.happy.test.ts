/**
 * #3602 [creator-accounts-dead-projection] — implementor happy-path proof.
 *
 * The bug: useCurrentBrandRole's brand_owner synthesis (Step 2) asked
 * `creator_accounts` for a `user_id` column that has never existed in any
 * migration in this repo, so PostgREST rejected it at parse time with
 * HTTP 400 / 42703 on every call. React Query's global policy retried twice
 * more, so one brand page load emitted three failing requests and ~3s of
 * backoff. The throw forced `isError: true`, and two consumers hard-gate on
 * it (useCanManageBrandPayments, BrandPricingDefaultsView), so the brand
 * Payments surface showed "Couldn't check your access — check your
 * connection" permanently to anyone without a brand_team_members row.
 *
 * The fix: `brands.account_id` IS the owner's auth user id
 * (brands_account_id_fkey → the account table's PRIMARY KEY → auth.users.id),
 * and the server authority `biz_brand_effective_rank` compares exactly that
 * (`b.account_id = p_user_id`) with no intermediate lookup. So the client
 * compares `brandRow.account_id === userId` and the second read is gone.
 *
 * WHAT THIS PROVES — behaviour, not the presence of an identifier. Every test
 * below awaits the real `fetchCurrentBrandRole` and asserts on its settled
 * value and on the exact set of tables it asked for. The `from` router below
 * deliberately serves ONLY "brand_team_members" and "brands": any other table
 * throws, so a re-introduced account read cannot pass silently.
 *
 * FAILS ON REVERT: with the §4.2(b) hunk deleted, the executor calls
 * `from("creator_accounts")`, which this router refuses — T1-a and T1-c
 * reject instead of resolving, and T1-b / T1-f see the extra table name in
 * the recorded list.
 */
/* eslint-disable import/first */
import { beforeEach, describe, expect, test } from "@jest/globals";

/** Every table `fetchCurrentBrandRole` asked for, in call order. */
const tablesQueried: string[] = [];

/** What `brand_team_members.maybeSingle()` resolves to for the next call. */
let memberResult: { data: unknown; error: unknown } = { data: null, error: null };
/** What `brands.maybeSingle()` resolves to for the next call. */
let brandResult: { data: unknown; error: unknown } = { data: null, error: null };

/**
 * A chainable PostgREST stub. `select`/`eq`/`is` return `this` so any filter
 * order works; `maybeSingle` terminates with the per-table result. The router
 * serves exactly the two tables the corrected executor is allowed to read —
 * anything else throws, which is what makes the revert loud.
 */
const makeChain = (result: { data: unknown; error: unknown }): unknown => {
  const chain: Record<string, unknown> = {};
  chain.select = (): unknown => chain;
  chain.eq = (): unknown => chain;
  chain.is = (): unknown => chain;
  chain.maybeSingle = async (): Promise<{ data: unknown; error: unknown }> =>
    result;
  return chain;
};

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: (table: string): unknown => {
      tablesQueried.push(table);
      if (table === "brand_team_members") return makeChain(memberResult);
      if (table === "brands") return makeChain(brandResult);
      throw new Error(
        `#3602: fetchCurrentBrandRole must never read "${table}". ` +
          `Reachable tables are brand_team_members and brands only.`,
      );
    },
  },
}));

// AuthContext and the brand-list shim pull in untransformed React Native ESM.
// fetchCurrentBrandRole needs neither — it takes brandId and userId as plain
// arguments. Stub them so the module loads under the node/ts-jest lane, the
// same reason useCreatorAccount.orch1248.test.ts stubs AuthContext.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "u1" } }),
}));
jest.mock("../useBrandListShim", () => ({
  useBrandList: () => [],
}));

import { fetchCurrentBrandRole } from "../useCurrentBrandRole";

beforeEach(() => {
  tablesQueried.length = 0;
  memberResult = { data: null, error: null };
  brandResult = { data: null, error: null };
});

describe("#3602 fetchCurrentBrandRole — brand_owner synthesis from brands.account_id", () => {
  test("T1-a (SC-1): owner with no membership row resolves to brand_owner, accepted", async () => {
    memberResult = { data: null, error: null };
    brandResult = { data: { account_id: "u1" }, error: null };

    await expect(fetchCurrentBrandRole("b1", "u1")).resolves.toEqual({
      role: "brand_owner",
      permissionsOverride: {},
      accepted: true,
    });
  });

  test("T1-b (SC-2): the reachable table set is exactly brand_team_members then brands", async () => {
    memberResult = { data: null, error: null };
    brandResult = { data: { account_id: "u1" }, error: null };

    await fetchCurrentBrandRole("b1", "u1");

    expect(tablesQueried).toEqual(["brand_team_members", "brands"]);
    expect(tablesQueried).not.toContain("creator_accounts");
  });

  test("T1-c (SC-3): a non-member RESOLVES to a clean denial — it does not reject", async () => {
    memberResult = { data: null, error: null };
    brandResult = { data: { account_id: "someone-else" }, error: null };

    // .resolves, never .rejects: this is the assertion that carries the
    // user-visible fix. A rejection here is isError:true downstream, which is
    // what put "check your connection" in front of a permission problem.
    await expect(fetchCurrentBrandRole("b1", "u1")).resolves.toEqual({
      role: null,
      permissionsOverride: {},
      accepted: false,
    });
    expect(tablesQueried).toEqual(["brand_team_members", "brands"]);
  });

  test("T1-d (SC-4): an accepted membership row short-circuits before the brands read", async () => {
    memberResult = {
      data: {
        role: "event_manager",
        permissions_override: null,
        accepted_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    };

    await expect(fetchCurrentBrandRole("b1", "u1")).resolves.toEqual({
      role: "event_manager",
      permissionsOverride: {},
      accepted: true,
    });
    expect(tablesQueried).toEqual(["brand_team_members"]);
  });

  test("T1-e (SC-4): a pending membership row keeps its role but is not accepted", async () => {
    memberResult = {
      data: {
        role: "event_manager",
        permissions_override: null,
        accepted_at: null,
      },
      error: null,
    };

    const result = await fetchCurrentBrandRole("b1", "u1");

    expect(result.role).toBe("event_manager");
    expect(result.accepted).toBe(false);
  });

  test("T1-f (SC-5): an absent or soft-deleted brand row denies without any further read", async () => {
    memberResult = { data: null, error: null };
    // `brands` is read with .is("deleted_at", null), so a soft-deleted brand
    // comes back as null here — it must NOT synthesise a role (I-PROPOSED-A).
    brandResult = { data: null, error: null };

    await expect(fetchCurrentBrandRole("b1", "u1")).resolves.toEqual({
      role: null,
      permissionsOverride: {},
      accepted: false,
    });
    expect(tablesQueried).toEqual(["brand_team_members", "brands"]);
    expect(tablesQueried).not.toContain("creator_accounts");
  });

  test("T1-g: a membership row's permissions_override is passed through verbatim", async () => {
    memberResult = {
      data: {
        role: "brand_admin",
        permissions_override: { EDIT_TICKET_PRICE: true },
        accepted_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    };

    await expect(fetchCurrentBrandRole("b1", "u1")).resolves.toEqual({
      role: "brand_admin",
      permissionsOverride: { EDIT_TICKET_PRICE: true },
      accepted: true,
    });
  });
});
