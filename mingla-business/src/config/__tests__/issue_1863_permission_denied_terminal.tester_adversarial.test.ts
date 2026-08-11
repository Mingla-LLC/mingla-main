/**
 * #1863 [error-toast-covers-bank-field] — the adversarial suite (§9.4).
 *
 * A DIFFERENT MECHANISM to the render proof on purpose, and it runs under the
 * DEFAULT `jest.config.cjs` (node + ts-jest): no RTL, no bespoke config, so it
 * executes on every PR that touches these paths, independent of the dormant
 * render-suite workflow. The two suites cannot fail to run for the same reason.
 *
 * Angle: the retry POLICY, the error CLASSIFICATION, the dead ViewState, and
 * the role boundary — none of which the render proof touches.
 *
 * Everything below executes SHIPPED code. The only mocks are the transport
 * (`services/supabase`) and the analytics side-effect module that pulls
 * `react-native` at import time. `queryClient`, `edgeFunctionErrors`,
 * `brandPaymentsPermission`, `brandStripeUiState`, `brandStripeService` and
 * `brandStripeBalancesService` are all real — mocking any of them would make
 * this suite assert on its own fixtures (§9.1 rule 5).
 */

const mockInvoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

// appsFlyerService imports `react-native` (Platform) at module scope, which the
// node/ts-jest config neither maps nor transpiles. It is a fire-and-forget
// analytics side effect on a code path this suite never calls.
jest.mock("../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { QueryClient } from "@tanstack/react-query";

import { queryClient } from "../queryClient";
import {
  EdgeFunctionPermissionDeniedError,
  isPermissionDeniedError,
} from "../../utils/edgeFunctionErrors";
import {
  BRAND_PAYMENTS_MANAGER_ROLES,
  canManageBrandPayments,
} from "../../utils/brandPaymentsPermission";
import { BRAND_ROLE_RANK, type BrandRole } from "../../utils/brandRole";
import { mapStripeStatusErrorToViewState } from "../../utils/brandStripeUiState";
import {
  BrandStripeCountryLockedError,
  refreshBrandStripeStatus,
} from "../../services/brandStripeService";
import { fetchBrandStripeBalances } from "../../services/brandStripeBalancesService";

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * The genuine `FunctionsHttpError` shape `supabase.functions.invoke` returns:
 * the status lives on `context`, and the body is only readable through
 * `context.clone()`. Reproducing it — rather than throwing a hand-built Error —
 * is what makes these assertions mean anything.
 */
function functionsHttpError(status: number, payload: unknown): Error {
  const err = new Error("Edge Function returned a non-2xx status code");
  err.name = "FunctionsHttpError";
  (err as Error & { context: unknown }).context = {
    status,
    clone: () => ({
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }),
  };
  return err;
}

const FORBIDDEN_PAYLOAD = {
  error: "forbidden",
  detail: "permission_denied",
} as const;

const ALL_ROLES: readonly BrandRole[] = [
  "scanner",
  "marketing_manager",
  "finance_manager",
  "event_manager",
  "brand_admin",
  "brand_owner",
];

const RANK_LADDER: readonly number[] = [0, 10, 20, 30, 40, 50, 60];

function acceptedCanManage(role: BrandRole): boolean {
  return canManageBrandPayments({ role, accepted: true });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

// ── T-A6 anti-vacuity floor, run FIRST ──────────────────────────────────────

describe("#1863 T-A6 — the predicate is role-set membership, and no rank threshold reproduces it", () => {
  it("the role table is complete and splits 3/3 — an all-true or all-false predicate fails here", () => {
    expect(ALL_ROLES).toHaveLength(6);
    expect(ALL_ROLES.filter(acceptedCanManage)).toHaveLength(3);
    expect(ALL_ROLES.filter((r) => !acceptedCanManage(r))).toHaveLength(3);
    expect(BRAND_PAYMENTS_MANAGER_ROLES).toHaveLength(3);
  });

  it("every role × accepted ∈ {true,false} matches the server's table exactly", () => {
    const table = ALL_ROLES.map((role) => ({
      role,
      accepted: canManageBrandPayments({ role, accepted: true }),
      pending: canManageBrandPayments({ role, accepted: false }),
    }));
    expect(table).toEqual([
      { role: "scanner", accepted: false, pending: false },
      { role: "marketing_manager", accepted: false, pending: false },
      // rank 30 — LOWER than event_manager, and ALLOWED.
      { role: "finance_manager", accepted: true, pending: false },
      // rank 40 — HIGHER than finance_manager, and DENIED. The whole bug.
      { role: "event_manager", accepted: false, pending: false },
      { role: "brand_admin", accepted: true, pending: false },
      { role: "brand_owner", accepted: true, pending: false },
    ]);
    expect(canManageBrandPayments({ role: null, accepted: true })).toBe(false);
    expect(canManageBrandPayments({ role: null, accepted: false })).toBe(false);
  });

  it("event_manager OUTRANKS finance_manager and is still denied", () => {
    expect(BRAND_ROLE_RANK.event_manager).toBeGreaterThan(
      BRAND_ROLE_RANK.finance_manager,
    );
    expect(acceptedCanManage("event_manager")).toBe(false);
    expect(acceptedCanManage("finance_manager")).toBe(true);
  });

  it("NO rank threshold reproduces the table — fails the instant it is 'simplified' into MIN_RANK", () => {
    const reproducible = RANK_LADDER.some((n) =>
      ALL_ROLES.every((r) => acceptedCanManage(r) === (BRAND_ROLE_RANK[r] >= n))
    );
    expect(reproducible).toBe(false);
  });
});

// ── T-A1 / T-A2 — the retry policy, executed ────────────────────────────────

describe("#1863 T-A1/T-A2 — a permission denial is terminal, globally", () => {
  const permErr = new EdgeFunctionPermissionDeniedError(
    "brand-stripe-refresh-status",
    "permission_denied",
  );
  const boom = new Error("boom");

  it("T-A1 the SHIPPED default `retry` is a function, and answers correctly when CALLED", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    const fn = retry as (count: number, error: unknown) => boolean;
    expect(fn(0, permErr)).toBe(false);
    // A raw FunctionsHttpError carrying context.status 403 is equally terminal.
    expect(fn(0, functionsHttpError(403, FORBIDDEN_PAYLOAD))).toBe(false);
    // Everything else keeps the ORCH-0964 budget, unchanged.
    expect(fn(0, boom)).toBe(true);
    expect(fn(1, boom)).toBe(true);
    expect(fn(2, boom)).toBe(false);
  });

  it(
    "T-A2 attempt BUDGET on a real QueryClient: 403 → 1 invocation, non-403 → exactly 3",
    async () => {
      const defaults = queryClient.getDefaultOptions().queries;

      const permFn = jest.fn(async () => {
        throw permErr;
      });
      const permClient = new QueryClient({
        defaultOptions: { queries: { ...defaults, gcTime: 0 } },
      });
      await expect(
        permClient.fetchQuery({ queryKey: ["issue1863", "perm"], queryFn: permFn }),
      ).rejects.toBeTruthy();
      expect(permFn).toHaveBeenCalledTimes(1);
      permClient.clear();

      const boomFn = jest.fn(async () => {
        throw boom;
      });
      const boomClient = new QueryClient({
        defaultOptions: { queries: { ...defaults, gcTime: 0 } },
      });
      await expect(
        boomClient.fetchQuery({ queryKey: ["issue1863", "boom"], queryFn: boomFn }),
      ).rejects.toBeTruthy();
      // 3, never 4. `failureCount <= 2` would produce 4 and fail here.
      expect(boomFn).toHaveBeenCalledTimes(3);
      boomClient.clear();
    },
    20_000,
  );
});

// ── T-A3 / T-A4 / T-A5 / T-A7 — classification through the REAL services ────

describe("#1863 T-A3 — BOTH twins classify a 403 identically", () => {
  it("refreshBrandStripeStatus rejects with a recognised permission denial", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(403, FORBIDDEN_PAYLOAD),
    });
    const thrown = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).not.toBeNull();
    expect(isPermissionDeniedError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(EdgeFunctionPermissionDeniedError);
  });

  it("fetchBrandStripeBalances — THE TWIN — rejects with the same recognised denial", async () => {
    // This is the assertion that would have caught the balances service being
    // left behind: it used to `throw error` raw, bypassing all classification,
    // so a 403 here stayed retryable while its twin was fixed.
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(403, FORBIDDEN_PAYLOAD),
    });
    const thrown = await fetchBrandStripeBalances("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).not.toBeNull();
    expect(isPermissionDeniedError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(EdgeFunctionPermissionDeniedError);
  });

  it("T-A4 the STALE-ROLE RACE: the REAL 403 object maps to the permission-denied ViewState", async () => {
    // Deliberately fed the error object the REAL service produced, not a
    // hand-built fixture — and deliberately the client-ALLOW/server-403 case,
    // which is the only state in which that ViewState is reachable once the
    // route gate exists. Rendering a denied role instead would assert nothing.
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(403, FORBIDDEN_PAYLOAD),
    });
    const thrown = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(mapStripeStatusErrorToViewState(thrown)).toBe("permission-denied");
  });

  it("T-A5 INVERSE: real network and 5xx errors are NOT swallowed (SC-8)", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(500, { error: "internal_error" }),
    });
    const serverErr = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(isPermissionDeniedError(serverErr)).toBe(false);
    expect(mapStripeStatusErrorToViewState(serverErr)).toBe("failed-network");

    const bare = new Error("Network request failed");
    expect(isPermissionDeniedError(bare)).toBe(false);
    expect(mapStripeStatusErrorToViewState(bare)).toBe("failed-network");

    // A timeout-shaped object and a malformed payload are equally retryable.
    expect(isPermissionDeniedError({ status: 504 })).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
    expect(isPermissionDeniedError(undefined)).toBe(false);
  });

  it("T-A5b a PostgREST insufficient_privilege (42501) IS a permission denial", () => {
    expect(isPermissionDeniedError({ code: "42501" })).toBe(true);
  });

  it("T-A7b a 403 naming a DIFFERENT rule is not a role denial (the ToS gate)", async () => {
    // `brand-stripe-onboard` returns 403 {error:"forbidden",
    // detail:"mingla_tos_not_accepted"} from its Mingla-ToS gate — same status
    // and same `error` field as requirePaymentsManager, entirely different
    // rule, and one the caller CAN act on. Classifying it as a role denial
    // would tell someone whose role is fine to "ask the brand owner to change
    // your role" — the exact class of lie this issue exists to remove, pointed
    // the other way. Its own message must survive intact.
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(403, {
        error: "forbidden",
        detail: "mingla_tos_not_accepted",
      }),
    });
    const thrown = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).not.toBeInstanceOf(EdgeFunctionPermissionDeniedError);
    expect(isPermissionDeniedError(thrown)).toBe(false);
    expect((thrown as Error).message).toBe("forbidden: mingla_tos_not_accepted");
    expect(mapStripeStatusErrorToViewState(thrown)).toBe("failed-network");
  });

  it("T-A7c a bare 403 with no readable body IS still a role denial", async () => {
    // A proxy or a transport that drops the body must not downgrade a denial
    // into a retryable error.
    const bare = new Error("Edge Function returned a non-2xx status code");
    (bare as Error & { context: unknown }).context = { status: 403 };
    mockInvoke.mockResolvedValue({ data: null, error: bare });
    const thrown = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(EdgeFunctionPermissionDeniedError);
    expect(isPermissionDeniedError(thrown)).toBe(true);
  });

  it("T-A7 country_locked keeps PRECEDENCE over the new permission branch", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(400, {
        error: "country_locked",
        existing_country: "GB",
      }),
    });
    const thrown = await refreshBrandStripeStatus("brand-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(BrandStripeCountryLockedError);
    expect(isPermissionDeniedError(thrown)).toBe(false);
  });
});

// ── T-A8 — the __DEV__ diagnostic split ─────────────────────────────────────

describe("#1863 T-A8 — a handled 403 no longer raises a LogBox error notification", () => {
  const globalWithDev = globalThis as { __DEV__?: boolean };
  let originalDev: boolean | undefined;

  beforeEach(() => {
    originalDev = globalWithDev.__DEV__;
    globalWithDev.__DEV__ = true;
  });

  afterEach(() => {
    if (originalDev === undefined) delete globalWithDev.__DEV__;
    else globalWithDev.__DEV__ = originalDev;
    jest.restoreAllMocks();
  });

  it("403 → console.log, and NOT console.error (console.warn would raise a yellow box, so it is not a substitute)", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(403, FORBIDDEN_PAYLOAD),
    });
    await refreshBrandStripeStatus("brand-1").catch(() => undefined);
    expect(logSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("500 stays LOUD — a program error must still raise console.error", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionsHttpError(500, { error: "internal_error" }),
    });
    await refreshBrandStripeStatus("brand-1").catch(() => undefined);
    expect(errorSpy).toHaveBeenCalled();
  });
});
