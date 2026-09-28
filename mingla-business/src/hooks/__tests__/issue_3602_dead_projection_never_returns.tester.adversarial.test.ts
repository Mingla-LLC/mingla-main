/**
 * #3602 [creator-accounts-dead-projection] — TESTER adversarial proof.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY FROM THE IMPLEMENTOR'S SUITE
 * ---------------------------------------------------------------------------
 * The implementor's happy suite proves the corrected executor works against a
 * COOPERATIVE mock: its `from` router serves two tables and throws a synthetic
 * `new Error("...must never read...")` for anything else, and — critically —
 * its `select` / `eq` / `is` stubs DISCARD their arguments.
 *
 * This suite refuses to cooperate, on three axes the happy suite cannot reach:
 *
 *   1. IT REPRODUCES PRODUCTION, NOT A SYNTHETIC STAND-IN. The trap table
 *      RESOLVES `{ data: null, error: <verbatim 42703 object> }`, which is what
 *      supabase-js actually does (PostgREST rejects at parse time and the
 *      client surfaces it on `error`, it does not throw). The executor's own
 *      `if (err) throw err` then rejects with that exact object. So on revert
 *      this suite fails carrying the REAL production error — verified by the
 *      tester against production PostgREST on 2026-09-28:
 *        GET /rest/v1/creator_accounts?select=user_id&id=eq.<uuid>
 *          -> HTTP 400 {"code":"42703","details":null,"hint":null,
 *              "message":"column creator_accounts.user_id does not exist"}
 *        GET /rest/v1/creator_accounts?select=id&id=eq.<uuid>   -> 200 []
 *        GET /rest/v1/brands?select=account_id&...              -> 200 []
 *      A synthetic Error cannot prove the 146-day production failure; this can.
 *
 *   2. IT PINS THE FILTERS, WHICH ARE SECURITY BOUNDARIES. Because the happy
 *      suite's `eq`/`is` ignore their arguments, the tester MEASURED that it
 *      stays 7/7 GREEN under each of these mutations of the shipped hook:
 *        - deleting `.is("deleted_at", null)` from the brands read
 *          -> a CLOSED (soft-deleted) brand would synthesise brand_owner,
 *             breaking I-PROPOSED-A and SC-5
 *        - deleting `.is("removed_at", null)` from brand_team_members
 *          -> a REMOVED team member keeps their role forever
 *        - deleting `.eq("user_id", userId)` from brand_team_members
 *          -> the read returns SOME member's row for the brand, so a viewer
 *             can inherit a stranger's role
 *      A2/A6/A9 below make all three loud. (Dropping `accepted_at` from the
 *      projection is already caught by the typed client at compile time —
 *      `error TS2339` — so that one is not a gap and is credited as covered.)
 *
 *   3. IT PINS THE MECHANISM THAT MADE IT 3x, so nobody can "fix" #3602 by
 *      classifying 42703 as terminal instead of removing the dead read (A1).
 *
 * FAILS ON REVERT, by a different mechanism than the implementor's suite: the
 * trap resolves an error object rather than throwing, so A2/A4/A5/A8/A9 reject
 * with `code === "42703"` (asserted by code, not by class name), the trap
 * counter reads 1 instead of 0, and A3's "old shape forbidden" side matches.
 *
 * SCOPE: this file only reads. It changes no product code and asserts nothing
 * about the `[TRANSITIONAL]` stub branch beyond its continued presence and its
 * `role === null` precedence guard, which #3602 §2 explicitly leaves alone.
 */
/* eslint-disable import/first */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, test } from "@jest/globals";

// ---------------------------------------------------------------------------
// The verbatim production failure, captured by the tester against
// gqnoajqerqhnvulmnyvv on 2026-09-28. Field-for-field as PostgREST returned it.
// ---------------------------------------------------------------------------
const PG_42703 = Object.freeze({
  code: "42703",
  details: null,
  hint: null,
  message: "column creator_accounts.user_id does not exist",
});

/** The one table name this hook must never reach again. */
const TRAP_TABLE = "creator_accounts";

/** The only two tables the corrected executor is allowed to reach. */
const ALLOWED_TABLES = Object.freeze(["brand_team_members", "brands"]);

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

/** One recorded PostgREST builder call: the method and its arguments. */
interface RecordedCall {
  readonly table: string;
  readonly method: "select" | "eq" | "is";
  readonly args: readonly unknown[];
}

/** Every table asked for, in call order, across the whole executor run. */
let tablesQueried: string[] = [];
/** Every select/eq/is call, in order, with its arguments intact. */
let calls: RecordedCall[] = [];
/** How many times the trap table was reached. Must be 0 on fixed code. */
let trapHits = 0;
/** Union of every table touched by every test in this file. */
const tablesEverTouched = new Set<string>();

let memberResult: { data: unknown; error: unknown } = { data: null, error: null };
let brandResult: { data: unknown; error: unknown } = { data: null, error: null };

/**
 * A RECORDING, HOSTILE PostgREST stub.
 *
 * Unlike the happy suite's chain, this one keeps every argument, so the
 * assertions below can pin which value landed in which filter. Filter order is
 * not constrained (the chain returns itself for any order) — only the
 * (method, column, value) triples are.
 */
const makeChain = (
  table: string,
  result: { data: unknown; error: unknown },
): unknown => {
  const chain: Record<string, unknown> = {};
  const record =
    (method: RecordedCall["method"]) =>
    (...args: unknown[]): unknown => {
      calls.push({ table, method, args });
      return chain;
    };
  chain.select = record("select");
  chain.eq = record("eq");
  chain.is = record("is");
  chain.maybeSingle = async (): Promise<{ data: unknown; error: unknown }> =>
    result;
  return chain;
};

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: (table: string): unknown => {
      tablesQueried.push(table);
      tablesEverTouched.add(table);
      if (table === "brand_team_members") return makeChain(table, memberResult);
      if (table === "brands") return makeChain(table, brandResult);
      // THE BOOBY TRAP. Faithful to production: supabase-js RESOLVES with the
      // error on `error`; PostgREST never makes the client throw. The
      // executor's `if (err) throw err` is what turns this into a rejection —
      // which is exactly the 146-day production path.
      trapHits += 1;
      return makeChain(table, { data: null, error: PG_42703 });
    },
  },
}));

// AuthContext and the brand-list shim pull in untransformed React Native ESM;
// the executor needs neither (brandId and userId are plain arguments).
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: USER } }),
}));
jest.mock("../useBrandListShim", () => ({ useBrandList: () => [] }));

import { queryClient } from "../../config/queryClient";
import { isPermissionDeniedError } from "../../utils/edgeFunctionErrors";
import { fetchCurrentBrandRole } from "../useCurrentBrandRole";

// --- source reads for the two-sided parity check -------------------------
const HOOK_PATH = join(__dirname, "..", "useCurrentBrandRole.ts");
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/**
 * The rename migration is located by PATTERN, never by literal name: its
 * filename spells the retired pre-rename role label, which a live strict-grep
 * gate forbids in active source. The hook itself wildcards it for the same
 * reason.
 */
const RENAME_MIGRATION_PATTERN = /^20260819000000_orch_1047_.*_rename\.sql$/;

const readOnce = (path: string): string => readFileSync(path, "utf8");

/** Restrict a SQL file to one function body so the assertion cannot drift. */
const sliceEffectiveRankFn = (sql: string): string => {
  const start = sql.indexOf("FUNCTION public.biz_brand_effective_rank");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("ALTER FUNCTION public.biz_brand_effective_rank", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
};

beforeEach(() => {
  tablesQueried = [];
  calls = [];
  trapHits = 0;
  memberResult = { data: null, error: null };
  brandResult = { data: null, error: null };
});

/** The owner fixture: no membership row, and the brand names USER as owner. */
const arrangeOwner = (): void => {
  memberResult = { data: null, error: null };
  brandResult = { data: { account_id: USER }, error: null };
};

describe("#3602 A1 — the 3x mechanism is pinned, so 42703 cannot be silenced instead of removed", () => {
  /**
   * The app's REAL retry predicate, read off the live QueryClient's default
   * options. Never redefined here: a local copy would pass while production
   * changed underneath it.
   */
  const defaults = queryClient.getDefaultOptions().queries;
  const retry = defaults?.retry as (failureCount: number, error: unknown) => boolean;
  const retryDelay = defaults?.retryDelay as (attempt: number) => number;

  test("A1-a: the predicate under test is the live one, proven by its POSITIVE cases", () => {
    // Guard against the failure mode where this test 'passes' over a stub that
    // returns a constant. A predicate that answered the same thing for a
    // genuine permission denial would not satisfy both of these.
    expect(typeof retry).toBe("function");
    expect(isPermissionDeniedError({ code: "42501" })).toBe(true);
    expect(isPermissionDeniedError({ status: 403 })).toBe(true);
    expect(retry(0, { code: "42501" })).toBe(false);
    expect(retry(0, { status: 403 })).toBe(false);
  });

  test("A1-b: a 42703 is NOT a permission denial, so nothing short-circuits it", () => {
    expect(isPermissionDeniedError(PG_42703)).toBe(false);
  });

  test("A1-c: the predicate yields exactly THREE attempts for a 42703", () => {
    // @tanstack/query-core calls retry(failureCount, error) with the
    // PRE-INCREMENT 0-based counter, so true/true/false == attempts 1, 2, 3.
    expect(retry(0, PG_42703)).toBe(true);
    expect(retry(1, PG_42703)).toBe(true);
    expect(retry(2, PG_42703)).toBe(false);
  });

  test("A1-d: the backoff between those attempts is the measured ~3s", () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(2000);
  });

  /**
   * THE POINT OF A1. #3602's fix is "stop issuing the doomed read". A tempting
   * wrong fix is "make 42703 terminal so it only fails once" — that would hide
   * the 400 storm while leaving isError permanently true, i.e. it would keep
   * the user-visible defect and lose the evidence. If someone adds 42703 to
   * isPermissionDeniedError, A1-b and A1-c both go red and say why.
   *
   * VERIFIED, not asserted-by-comment: the tester added
   * `if (error.code === "42703") return true;` to isPermissionDeniedError and
   * confirmed A1-b and A1-c fail, then reverted it.
   */
  test("A1-e: 42703 must stay retryable-and-non-terminal — the fix is deletion, not reclassification", () => {
    expect(isPermissionDeniedError(PG_42703)).toBe(false);
    expect(retry(0, PG_42703)).toBe(true);
  });
});

describe("#3602 A2/A4/A5 — the booby trap is never sprung, on any reachable path", () => {
  test("A2: an owner with no membership row resolves brand_owner and never touches the trap table", async () => {
    arrangeOwner();

    await expect(fetchCurrentBrandRole(BRAND, USER)).resolves.toEqual({
      role: "brand_owner",
      permissionsOverride: {},
      accepted: true,
    });
    expect(trapHits).toBe(0);
    expect(tablesQueried).toEqual([...ALLOWED_TABLES]);
    expect(tablesQueried).not.toContain(TRAP_TABLE);
  });

  test("A4: a non-member RESOLVES a denial — a rejection here is the connection-error lie", async () => {
    memberResult = { data: null, error: null };
    brandResult = { data: { account_id: STRANGER }, error: null };

    // This is the assertion that carries the user-visible fix. isError:false
    // is what lets BrandPaymentsPermissionGate pick its permission-denied
    // state instead of "Couldn't check your access — check your connection".
    await expect(fetchCurrentBrandRole(BRAND, USER)).resolves.toEqual({
      role: null,
      permissionsOverride: {},
      accepted: false,
    });
    expect(trapHits).toBe(0);
  });

  test("A5: a soft-deleted or absent brand denies, and still never reaches the trap table", async () => {
    memberResult = { data: null, error: null };
    // `brands` is read with .is("deleted_at", null), so a CLOSED brand comes
    // back null. A closed brand granting brand_owner would be a security
    // regression (I-PROPOSED-A). A6 pins the filter that produces this null.
    brandResult = { data: null, error: null };

    await expect(fetchCurrentBrandRole(BRAND, USER)).resolves.toEqual({
      role: null,
      permissionsOverride: {},
      accepted: false,
    });
    expect(trapHits).toBe(0);
    expect(tablesQueried).toEqual([...ALLOWED_TABLES]);
  });
});

describe("#3602 A6 — the filters are pinned, because they are the security boundaries", () => {
  const triples = (table: string): string[] =>
    calls
      .filter((call) => call.table === table)
      .map((call) => `${call.method}(${JSON.stringify(call.args)})`);

  test("A6-a: brand_team_members is scoped to THIS brand, THIS user, and non-removed rows", async () => {
    arrangeOwner();
    await fetchCurrentBrandRole(BRAND, USER);

    const recorded = triples("brand_team_members");
    // Projection: accepted_at must stay in the select. Without it the row's
    // accepted_at is `undefined`, and `undefined !== null` is TRUE, so every
    // PENDING member would read as accepted.
    expect(recorded).toContain(
      `select(${JSON.stringify(["role, permissions_override, accepted_at"])})`,
    );
    // Scoping: brandId -> brand_id and userId -> user_id, in that assignment.
    // This also pins the extracted executor's argument order, which two
    // same-typed string parameters otherwise leave to the caller.
    expect(recorded).toContain(`eq(${JSON.stringify(["brand_id", BRAND])})`);
    expect(recorded).toContain(`eq(${JSON.stringify(["user_id", USER])})`);
    // Removed members must not keep their role.
    expect(recorded).toContain(`is(${JSON.stringify(["removed_at", null])})`);
    // And nothing else: no extra filter widened or narrowed the read.
    expect(recorded).toHaveLength(4);
  });

  test("A6-b: the brands read is scoped to THIS brand and excludes soft-deleted brands", async () => {
    arrangeOwner();
    await fetchCurrentBrandRole(BRAND, USER);

    const recorded = triples("brands");
    expect(recorded).toContain(`select(${JSON.stringify(["account_id"])})`);
    expect(recorded).toContain(`eq(${JSON.stringify(["id", BRAND])})`);
    // I-PROPOSED-A. The happy suite stays 7/7 green without this line; this
    // assertion is the only thing in the repo that makes its removal loud.
    expect(recorded).toContain(`is(${JSON.stringify(["deleted_at", null])})`);
    expect(recorded).toHaveLength(3);
  });

  test("A6-c: the brands read never projects the dead column, whatever the call order", async () => {
    arrangeOwner();
    await fetchCurrentBrandRole(BRAND, USER);

    const projections = calls
      .filter((call) => call.method === "select")
      .flatMap((call) => call.args)
      .map(String);
    expect(projections).not.toContain("user_id");
    // `user_id` may only ever appear as a FILTER on brand_team_members, never
    // as a projected column anywhere in this executor.
    for (const projection of projections) {
      expect(projection.startsWith("user_id")).toBe(false);
    }
  });
});

describe("#3602 A7 — error paths propagate verbatim and cannot reach the trap table", () => {
  test("A7-a: a Step 1 error rejects with the SAME object and stops before the brands read", async () => {
    const step1Err = { code: "PGRST999", message: "step one blew up" };
    memberResult = { data: null, error: step1Err };

    await expect(fetchCurrentBrandRole(BRAND, USER)).rejects.toBe(step1Err);
    // Identity, not shape: the extraction must not wrap, re-throw or normalise
    // the PostgREST error, because the global retry predicate classifies on its
    // `code`/`status` fields and a wrapper would blind it.
    expect(tablesQueried).toEqual(["brand_team_members"]);
    expect(trapHits).toBe(0);
  });

  test("A7-b: a Step 2 error rejects with the SAME object and reaches no third table", async () => {
    const step2Err = { code: "PGRST998", message: "step two blew up" };
    memberResult = { data: null, error: null };
    brandResult = { data: null, error: step2Err };

    await expect(fetchCurrentBrandRole(BRAND, USER)).rejects.toBe(step2Err);
    expect(tablesQueried).toEqual([...ALLOWED_TABLES]);
    expect(trapHits).toBe(0);
  });

  test("A7-c: an error is never swallowed into a silent denial (Constitution #3)", async () => {
    memberResult = { data: null, error: { code: "PGRST997", message: "x" } };

    // The dangerous shape would be resolving {role:null} on an error: the user
    // would be shown a clean 'you do not have permission' for a transport
    // failure. It must reject so isError surfaces.
    await expect(fetchCurrentBrandRole(BRAND, USER)).rejects.toBeDefined();
  });
});

describe("#3602 A8 — `accepted` means ownership, and no input synthesises a false owner", () => {
  /**
   * Hostile `account_id` values. Every one of these is a DIFFERENT principal
   * from USER (or not a principal at all), so none may produce a role.
   *
   * Deliberately absent: an upper-cased copy of USER. Postgres compares
   * uuid = uuid, which is case-insensitive, so SQL WOULD match it while this
   * client's `===` would not. Requiring a denial there would turn this suite
   * into a gate that forbids closing that divergence. A8-c probes it without
   * pinning the role.
   */
  const hostile: ReadonlyArray<readonly [string, unknown]> = [
    ["a different uuid", STRANGER],
    ["the user id with trailing whitespace", `${USER} `],
    ["the user id with leading whitespace", ` ${USER}`],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 22222222],
    ["a boolean", true],
    ["an object wrapping the id", { id: USER }],
    ["an array containing the id", [USER]],
  ];

  test.each(hostile)(
    "A8-a: account_id = %s must NOT grant a role and must NOT reach the trap table",
    async (_label, accountId) => {
      memberResult = { data: null, error: null };
      brandResult = { data: { account_id: accountId }, error: null };

      await expect(fetchCurrentBrandRole(BRAND, USER)).resolves.toEqual({
        role: null,
        permissionsOverride: {},
        accepted: false,
      });
      expect(trapHits).toBe(0);
    },
  );

  test("A8-b: only an exact owner match yields accepted:true on the synthesis path", async () => {
    arrangeOwner();
    const owner = await fetchCurrentBrandRole(BRAND, USER);
    expect(owner.accepted).toBe(true);
    expect(owner.role).toBe("brand_owner");

    calls = [];
    tablesQueried = [];
    brandResult = { data: { account_id: STRANGER }, error: null };
    const nonOwner = await fetchCurrentBrandRole(BRAND, USER);
    expect(nonOwner.accepted).toBe(false);
    expect(nonOwner.role).toBeNull();
  });

  test("A8-c: a case-variant uuid resolves safely either way — divergence documented, not frozen", async () => {
    memberResult = { data: null, error: null };
    brandResult = { data: { account_id: USER.toUpperCase() }, error: null };

    // The invariant that can never be wrong: it settles (no rejection, so no
    // 'check your connection'), and it never reaches the dead table. The role
    // is deliberately NOT asserted — see the note above. Reported to #3602 as
    // a P3 divergence from the SQL authority's uuid comparison.
    const result = await fetchCurrentBrandRole(BRAND, USER);
    expect(result.permissionsOverride).toEqual({});
    expect(trapHits).toBe(0);
  });

  test("A8-d: a PENDING membership row is accepted:false even though it has a role", async () => {
    memberResult = {
      data: {
        role: "brand_admin",
        permissions_override: null,
        accepted_at: null,
      },
      error: null,
    };

    const result = await fetchCurrentBrandRole(BRAND, USER);
    // A pending brand_admin read as accepted would get the full payments
    // surface and the identical 403 storm #1863 was filed for.
    expect(result.role).toBe("brand_admin");
    expect(result.accepted).toBe(false);
    expect(tablesQueried).toEqual(["brand_team_members"]);
  });
});

describe("#3602 A3 — two-sided parity with the SQL authority", () => {
  test("A3-a: the SQL owner branch compares brands.account_id to the user id, with no account hop", () => {
    const migration = readdirSync(MIGRATIONS_DIR).find((name) =>
      RENAME_MIGRATION_PATTERN.test(name),
    );
    expect(migration).toBeDefined();
    const fn = sliceEffectiveRankFn(
      readOnce(join(MIGRATIONS_DIR, migration as string)),
    );

    expect(fn).toMatch(/b\.account_id\s*=\s*p_user_id/);
    expect(fn).toMatch(/b\.deleted_at\s+IS\s+NULL/i);
    // The server performs no intermediate account lookup. If a future
    // migration adds one, this reds and the client must be revisited too.
    expect(fn).not.toMatch(new RegExp(TRAP_TABLE));
  });

  test("A3-b: the client mirrors it — new marker REQUIRED and old shape FORBIDDEN", () => {
    const hook = readOnce(HOOK_PATH);

    // Required: the corrected predicate.
    expect(hook).toMatch(/brandRow\.account_id\s*===\s*userId/);
    // Forbidden: the dead read, in any whitespace or quote style.
    expect(hook).not.toMatch(
      new RegExp(`\\.from\\(\\s*["']${TRAP_TABLE}["']\\s*\\)`),
    );
    // Forbidden: the dead projection. Written as a select of exactly user_id,
    // so the legitimate `.eq("user_id", userId)` filter on brand_team_members
    // is untouched by this assertion.
    expect(hook).not.toMatch(/\.select\(\s*["']user_id["']\s*\)/);
    // Two-sided by construction: the bug cannot satisfy the first assertion
    // and the fix cannot satisfy the other two. This check is SECONDARY — a
    // source-string assertion can pass over an undefined identifier — so the
    // verdict rests on A2/A4/A5/A6/A8, which execute the real code.
  });

  test("A3-c: the auth-readiness gate and the TRANSITIONAL fallback survived the edit", () => {
    const hook = readOnce(HOOK_PATH);

    // A live strict-grep gate regexes this exact computation; the fix must not
    // have touched it.
    expect(hook).toMatch(
      /const\s+enabled\w*\s*=\s*[^;]*\bisAuthReady\b/,
    );
    // #3602 §2 leaves the [TRANSITIONAL] stub branch in place on purpose (40+
    // consumers). It must still exist AND still be gated on the DB answer
    // being null, so a real DB answer always wins over the stub.
    expect(hook).toMatch(/\[TRANSITIONAL\]/);
    expect(hook).toMatch(/role\s*===\s*null\s*&&\s*stubBrandRole\s*!==\s*null/);
  });

  test("A3-d: the real DB answer outranks the stub, because the owner path returns non-null", async () => {
    // The stub branch can only fire when the executor's role is null. Proving
    // the owner path returns a NON-null role is therefore the behavioural half
    // of 'the DB answer wins': after #3602 the synthesis resolves for real, so
    // the stub stops being what carries brand_owner.
    arrangeOwner();
    const result = await fetchCurrentBrandRole(BRAND, USER);
    expect(result.role).not.toBeNull();
    expect(result.role).toBe("brand_owner");
  });
});

describe("#3602 A9 — the reachable table set is closed across EVERY path in this file", () => {
  test("A9: after member, pending, owner, non-owner, absent-brand and both error paths, only two tables were ever touched", async () => {
    const paths: Array<() => Promise<unknown>> = [
      // accepted member
      async () => {
        memberResult = {
          data: {
            role: "event_manager",
            permissions_override: { EDIT_TICKET_PRICE: true },
            accepted_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        };
        return fetchCurrentBrandRole(BRAND, USER);
      },
      // pending member
      async () => {
        memberResult = {
          data: { role: "event_manager", permissions_override: null, accepted_at: null },
          error: null,
        };
        return fetchCurrentBrandRole(BRAND, USER);
      },
      // owner synthesis
      async () => {
        arrangeOwner();
        return fetchCurrentBrandRole(BRAND, USER);
      },
      // non-member denial
      async () => {
        memberResult = { data: null, error: null };
        brandResult = { data: { account_id: STRANGER }, error: null };
        return fetchCurrentBrandRole(BRAND, USER);
      },
      // absent / soft-deleted brand
      async () => {
        memberResult = { data: null, error: null };
        brandResult = { data: null, error: null };
        return fetchCurrentBrandRole(BRAND, USER);
      },
      // Step 1 error
      async () => {
        memberResult = { data: null, error: { code: "PGRST111" } };
        return fetchCurrentBrandRole(BRAND, USER).catch(() => null);
      },
      // Step 2 error
      async () => {
        memberResult = { data: null, error: null };
        brandResult = { data: null, error: { code: "PGRST222" } };
        return fetchCurrentBrandRole(BRAND, USER).catch(() => null);
      },
    ];

    const touched = new Set<string>();
    for (const path of paths) {
      tablesQueried = [];
      calls = [];
      memberResult = { data: null, error: null };
      brandResult = { data: null, error: null };
      await path();
      for (const table of tablesQueried) touched.add(table);
    }

    expect([...touched].sort()).toEqual([...ALLOWED_TABLES].sort());
    expect(touched.has(TRAP_TABLE)).toBe(false);
    expect(trapHits).toBe(0);

    // And the union across every test this file has run, which is the strongest
    // form of SC-2: no path exercised anywhere in this suite reached it.
    expect(tablesEverTouched.has(TRAP_TABLE)).toBe(false);
  });
});
