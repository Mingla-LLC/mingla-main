/**
 * #1863 [error-toast-covers-bank-field] — TESTER adversarial suite.
 *
 * ANGLE: which mechanism actually zeroes the storm.
 *
 * The implementor's suites prove the retry BUDGET (T-A1/T-A2: a permission
 * denial is attempted once instead of three times) and the CLASSIFICATION
 * (T-A3..T-A8). Neither suite asks the question that decides whether the storm
 * is really dead:
 *
 *   a terminal retry caps ONE fetch cycle at a single attempt.
 *   It never takes the cost of an enabled query to ZERO.
 *
 * `useBrandStripeStatus` polls on `refetchInterval: 30_000` and
 * `useBrandStripeBalances` on 60_000, and BOTH intervals were deliberately left
 * untouched by the SPEC (§4.2 "do not touch refetchInterval"). So for a query
 * that is ENABLED and permanently 403s, the shipped retry policy shrinks the
 * traffic — it does not remove it. The only thing that reaches zero is the
 * `canManagePayments` conjunct on `shouldEnableBrandStripeStatusQuery`, which
 * stops the query from ever being enabled for a denied role.
 *
 * That distinction is load-bearing and undefended until now. A future reader
 * who sees "a 403 is terminal, globally" in `queryClient.ts` could reasonably
 * conclude the `canManagePayments` conjunct is redundant and delete it — the
 * app would still compile, every classification test would stay green, and the
 * storm would come back at 120 invocations/hour/device instead of 360, forever,
 * with nothing red.
 *
 * These tests execute the SHIPPED modules — the real `queryClient` defaults,
 * the real `canManageBrandPayments`, the real `shouldEnableBrandStripeStatusQuery`,
 * and the real service error objects. Nothing is re-declared and nothing is
 * asserted against a fixture this file also defines.
 *
 * FAILS-ON-REVERT anchor: reverting
 * `src/hooks/brandStripeStatusAuthGate.ts` to the pre-fix version removes the
 * `canManagePayments` conjunct, which turns T-B1, T-B3 and T-B4 red.
 */

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { queryClient } from "../../config/queryClient";
import {
  BRAND_PAYMENTS_MANAGER_ROLES,
  canManageBrandPayments,
} from "../../utils/brandPaymentsPermission";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import type { BrandRole } from "../../utils/brandRole";
import { EdgeFunctionPermissionDeniedError } from "../../utils/edgeFunctionErrors";
import { shouldEnableBrandStripeStatusQuery } from "../brandStripeStatusAuthGate";

/**
 * Every role the server's `brand_team_members_role_check` constraint allows,
 * read off the SHIPPED rank table rather than re-typed here — a truncated or
 * renamed ladder fails the length assertion below instead of silently
 * shrinking the enumeration.
 */
const ALL_ROLES = Object.keys(BRAND_ROLE_RANK) as BrandRole[];

/** The rank ladder, used only to PROVE no threshold reproduces the gate. */
const RANK_LADDER = [0, 10, 20, 30, 40, 50, 60];

/** Everything the auth gate needs other than the permission conjunct. */
const AUTH_READY = {
  brandId: "1ce63bf4-1a33-4309-ab0b-ec23343e3569",
  authLoading: false,
  user: { id: "u1" },
  session: { access_token: "t" },
} as const;

function enabledFor(role: BrandRole | null, accepted: boolean): boolean {
  return shouldEnableBrandStripeStatusQuery({
    ...AUTH_READY,
    canManagePayments: canManageBrandPayments({ role, accepted }),
  });
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives a real `QueryObserver` against the SHIPPED default options for a fixed
 * wall-clock window and counts real `queryFn` invocations.
 *
 * `retryDelay` is overridden to 0 so the window is short; `retry` is NOT
 * overridden — it comes from the shipped `queryClient` defaults, which is the
 * whole subject of the test.
 */
async function countInvocations(opts: {
  error: unknown;
  enabled: boolean;
  refetchIntervalMs: number;
  windowMs: number;
}): Promise<number> {
  const shipped = queryClient.getDefaultOptions().queries;
  const client = new QueryClient({ defaultOptions: { queries: shipped } });
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: ["issue-1863-tester-adversarial", Math.random()],
    enabled: opts.enabled,
    refetchInterval: opts.refetchIntervalMs,
    retryDelay: 0,
    gcTime: 0,
    queryFn: async () => {
      calls += 1;
      throw opts.error;
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await wait(opts.windowMs);
  unsubscribe();
  client.clear();
  return calls;
}

describe("#1863 T-B0 — the calibration this file depends on is real", () => {
  it("the role ladder is the full six and splits 3 allowed / 3 denied", () => {
    expect(ALL_ROLES).toHaveLength(6);
    expect(BRAND_PAYMENTS_MANAGER_ROLES).toHaveLength(3);
    const allowed = ALL_ROLES.filter((r) =>
      canManageBrandPayments({ role: r, accepted: true })
    );
    const denied = ALL_ROLES.filter(
      (r) => !canManageBrandPayments({ role: r, accepted: true }),
    );
    // An all-true or all-false predicate dies here, before any case runs.
    expect(allowed).toHaveLength(3);
    expect(denied).toHaveLength(3);
  });

  it("the SHIPPED retry default is a function that separates the two errors", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    const fn = retry as (n: number, e: unknown) => boolean;
    // The calibration T-B2 relies on: these two errors MUST get different
    // budgets, or the comparison there proves nothing.
    expect(fn(0, new EdgeFunctionPermissionDeniedError("brand-stripe-balances")))
      .toBe(false);
    expect(fn(0, new Error("boom"))).toBe(true);
  });
});

describe("#1863 T-B1 — the enabled gate composes predicate → auth gate for every role", () => {
  it("only the three manager roles, and only when accepted, enable the query", () => {
    expect(ALL_ROLES.length).toBeGreaterThanOrEqual(6);
    const enabledRoles: BrandRole[] = [];
    for (const role of ALL_ROLES) {
      // A PENDING member is denied on every role — the server requires
      // accepted_at IS NOT NULL on both branches of the disjunction.
      expect(enabledFor(role, false)).toBe(false);
      if (enabledFor(role, true)) enabledRoles.push(role);
    }
    expect([...enabledRoles].sort()).toEqual(
      [...BRAND_PAYMENTS_MANAGER_ROLES].sort(),
    );
    // No membership at all never enables it.
    expect(enabledFor(null, true)).toBe(false);
    expect(enabledFor(null, false)).toBe(false);
  });

  it("event_manager OUTRANKS finance_manager and STILL cannot enable the query", () => {
    expect(BRAND_ROLE_RANK.event_manager).toBeGreaterThan(
      BRAND_ROLE_RANK.finance_manager,
    );
    expect(enabledFor("event_manager", true)).toBe(false);
    expect(enabledFor("finance_manager", true)).toBe(true);
  });
});

describe("#1863 T-B4 — no rank threshold reproduces the ENABLED gate either", () => {
  it("every candidate threshold disagrees with the gate on at least one role", () => {
    expect(RANK_LADDER.length).toBeGreaterThanOrEqual(7);
    const reproducible = RANK_LADDER.some((n) =>
      ALL_ROLES.every((r) => enabledFor(r, true) === (BRAND_ROLE_RANK[r] >= n))
    );
    // Fails the instant the gate is "simplified" into a MIN_RANK comparison at
    // the HOOK layer — a different layer from the predicate T-A6 pins.
    expect(reproducible).toBe(false);
  });
});

describe("#1863 T-B2/T-B3 — terminal retry SHRINKS the storm; only `enabled` kills it", () => {
  const REFETCH_MS = 50;
  const WINDOW_MS = 420;

  it(
    "T-B2 an ENABLED query still COSTS invocations — terminal retry only caps the cycle at ONE attempt instead of three",
    async () => {
      const permCalls = await countInvocations({
        error: new EdgeFunctionPermissionDeniedError(
          "brand-stripe-refresh-status",
          "permission_denied",
        ),
        enabled: true,
        refetchIntervalMs: REFETCH_MS,
        windowMs: WINDOW_MS,
      });
      const boomCalls = await countInvocations({
        error: new Error("boom"),
        enabled: true,
        refetchIntervalMs: REFETCH_MS,
        windowMs: WINDOW_MS,
      });

      // (a) TERMINAL RETRY IS NOT ZERO. An enabled query that permanently 403s
      //     still reaches the network. The retry policy shrinks the cost of a
      //     cycle; it never removes it. This is the assertion that stops anyone
      //     concluding `queryClient.ts` alone made the storm impossible.
      expect(permCalls).toBeGreaterThanOrEqual(1);

      // (b) THE BUDGET, MEASURED rather than read off the source: the
      //     non-permission error is attempted three times, the permission error
      //     once, so the same window costs at least twice as many invocations.
      //     Delete the retry predicate and the two converge — this goes red
      //     without referencing a single string from queryClient.ts.
      expect(boomCalls).toBeGreaterThanOrEqual(permCalls * 2);
      expect(permCalls).toBeLessThan(boomCalls);
    },
    20_000,
  );

  it(
    "T-B3 the `canManagePayments` conjunct is the ONLY thing that reaches zero",
    async () => {
      // Exactly the production shape for a denied role: everything else about
      // the session is valid and ready.
      const enabled = enabledFor("event_manager", true);
      expect(enabled).toBe(false);

      const calls = await countInvocations({
        error: new EdgeFunctionPermissionDeniedError(
          "brand-stripe-refresh-status",
          "permission_denied",
        ),
        enabled,
        refetchIntervalMs: REFETCH_MS,
        windowMs: WINDOW_MS,
      });

      // ZERO. Not "fewer" — none. This is SC-2, and it is the assertion that
      // goes red if the conjunct is ever removed as "redundant".
      expect(calls).toBe(0);
    },
    20_000,
  );
});
