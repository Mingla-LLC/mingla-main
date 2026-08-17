/**
 * issue #2101 [named-buyer checkout] — the WEB half of the route access
 * adapter, EXECUTED.
 *
 * WHY THIS FILE EXISTS. The independent tester found that
 * `usePublicTicketCheckoutRouteAccess.ts` was run by no test in the repository:
 * `PublicEventPage.issue2101.test.tsx` injects the adapter's return value
 * through `jest.mock`, the `.native` suite imports the other half, and the CI
 * guard only checks its imports. Deleting `state === "restricted"` from the
 * `blocked` disjunction therefore re-enabled every purchase control on Event,
 * Trip and Experience for an authenticated non-member while the entire lane
 * stayed green — the exact class A7.3 item 22 exists to make impossible.
 *
 * WHAT IS REAL HERE. The hook itself, `usePublicTicketCheckoutEligibility`, the
 * key factory, and a real `QueryClient` with a real `QueryClientProvider`. Only
 * the service call and the auth identity are stubbed — the service is the
 * network boundary and the identity is the variable under test. The projection
 * from server state to route action state is executed, not asserted from source.
 *
 * This is the implementor's happy-path half. The tester owns a separate
 * adversarial suite over the same module; both are required.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RendererInstance {
  unmount(): void;
}
interface TestRendererApi {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void | Promise<void>): Promise<void> | void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererApi;

let mockUser: { id: string } | null = null;
let mockIsAuthReady = true;
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isAuthReady: mockIsAuthReady }),
}));

type Advisory = {
  schemaVersion: 1;
  mode: "unrestricted" | "named_buyers";
  state: "unrestricted" | "sign_in_required" | "allowed" | "restricted";
};
const fetchSpy = jest.fn<() => Promise<Advisory>>();
jest.mock("../../services/eventTicketCheckoutAccessService", () => ({
  fetchPublicTicketCheckoutAccess: (...args: unknown[]) =>
    (fetchSpy as unknown as (...a: unknown[]) => Promise<Advisory>)(...args),
  fetchEventTicketCheckoutAccess: jest.fn(),
  addSelfToEventTicketCheckoutAccess: jest.fn(),
  addUsernameToEventTicketCheckoutAccess: jest.fn(),
  removeEventTicketCheckoutAccessMember: jest.fn(),
  setEventTicketCheckoutAccessMode: jest.fn(),
}));

// The REAL web half. Under Amendment 8's plain + `.native` naming this
// extensionless specifier resolves to the web implementation.
import { usePublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess";
import type { PublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess";
import { eventTicketCheckoutAccessKeys } from "../useEventTicketCheckoutAccess";

const EVENT_ID = "evt-2101-web-adapter";

/** Every value the hook produced, in order, across the mounted lifetime. */
let observed: PublicTicketCheckoutRouteAccess[] = [];
const mounted: RendererInstance[] = [];

const Probe: React.FC<{ eventId: string }> = ({ eventId }) => {
  observed.push(usePublicTicketCheckoutRouteAccess(eventId));
  return null;
};

const advisory = (
  mode: Advisory["mode"],
  state: Advisory["state"],
): Advisory => ({ schemaVersion: 1, mode, state });

/** One macrotask + React commit, inside act(). */
const tick = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/**
 * Drive the real React Query lifecycle until `predicate` holds. Bounded, and it
 * THROWS on exhaustion rather than returning a stale value — a helper that
 * silently gives up would make every assertion below unfalsifiable.
 */
const settleUntil = async (
  predicate: (value: PublicTicketCheckoutRouteAccess) => boolean,
): Promise<PublicTicketCheckoutRouteAccess> => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const latest = observed[observed.length - 1];
    if (latest !== undefined && predicate(latest)) return latest;
    await tick();
  }
  throw new Error(
    `the hook never reached the expected state; last was ${
      JSON.stringify(observed[observed.length - 1])
    }`,
  );
};

const mount = async (client: QueryClient): Promise<void> => {
  let renderer!: RendererInstance;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe eventId={EVENT_ID} />
      </QueryClientProvider>,
    );
  });
  mounted.push(renderer);
};

/**
 * Mount the real hook under a real QueryClient and let the query settle out of
 * `loading`. Returns the LAST value the hook produced.
 */
const mountAndSettle = async (
  client: QueryClient,
): Promise<PublicTicketCheckoutRouteAccess> => {
  await mount(client);
  return settleUntil((value) => value.state !== "loading");
};

const freshClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

beforeEach(() => {
  observed = [];
  fetchSpy.mockReset();
  mockUser = { id: "buyer-1" };
  mockIsAuthReady = true;
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) void TestRenderer.act(() => renderer.unmount());
  }
});

describe("issue #2101 — the real web adapter projects every server state", () => {
  test("unrestricted → purchase proceeds, nothing is blocked", async () => {
    fetchSpy.mockResolvedValue(advisory("unrestricted", "unrestricted"));
    const access = await mountAndSettle(freshClient());
    expect(access.state).toBe("unrestricted");
    expect(access.canPurchase).toBe(true);
    expect(access.requiresSignIn).toBe(false);
    expect(access.blocked).toBe(false);
  });

  test("allowed → purchase proceeds, nothing is blocked", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    const access = await mountAndSettle(freshClient());
    expect(access.state).toBe("allowed");
    expect(access.canPurchase).toBe(true);
    expect(access.blocked).toBe(false);
  });

  test("sign_in_required → ACTIONABLE, routes to sign-in, NOT blocked", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "sign_in_required"));
    const access = await mountAndSettle(freshClient());
    expect(access.state).toBe("sign_in_required");
    expect(access.requiresSignIn).toBe(true);
    // An otherwise-bookable CTA stays actionable here — it must reach sign-in,
    // not be disabled (A4.2 item 2).
    expect(access.blocked).toBe(false);
    expect(access.canPurchase).toBe(false);
  });

  test("restricted → BLOCKED", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "restricted"));
    const access = await mountAndSettle(freshClient());
    expect(access.state).toBe("restricted");
    expect(access.blocked).toBe(true);
    expect(access.canPurchase).toBe(false);
    expect(access.requiresSignIn).toBe(false);
  });

  test("a read error → BLOCKED, never permissive", async () => {
    fetchSpy.mockRejectedValue(new Error("advisory unavailable"));
    const access = await mountAndSettle(freshClient());
    expect(access.state).toBe("error");
    expect(access.blocked).toBe(true);
    expect(access.canPurchase).toBe(false);
  });

  test("before auth settles → BLOCKED, and no eligibility is fetched", async () => {
    mockIsAuthReady = false;
    fetchSpy.mockResolvedValue(advisory("unrestricted", "unrestricted"));
    await mount(freshClient());
    // Deliberately NOT `mountAndSettle` — this state must never settle. Tick
    // several times so "still loading" is a sustained fact, not a first-paint
    // artifact.
    await tick();
    await tick();
    await tick();
    const access = observed[observed.length - 1];
    expect(access.state).toBe("loading");
    expect(access.blocked).toBe(true);
    expect(access.canPurchase).toBe(false);
    // Querying before auth settles would key an anon decision for a signed-in
    // buyer and then serve it from cache.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("before auth settles, a WARM cached decision is still not served", async () => {
    // The case above is satisfied by `enabled: false` alone: with no data
    // fetched, `data === undefined` reports loading whether or not the
    // `!isAuthReady` conjunct exists. So it cannot distinguish that conjunct
    // being dropped — the exact unfalsifiable shape the tester hit in its own
    // first draft.
    //
    // Warming the cache separates them. `enabled: false` stops the FETCH but
    // not the cache READ, so with the conjunct gone the hook would happily
    // serve a resolved `allowed` to a viewer whose identity has not settled —
    // which is how one buyer's decision reaches another.
    mockUser = { id: "buyer-warm" };
    const client = freshClient();
    client.setQueryData(
      eventTicketCheckoutAccessKeys.eligibilityFor(EVENT_ID, "buyer-warm"),
      advisory("named_buyers", "allowed"),
    );
    mockIsAuthReady = false;
    await mount(client);
    await tick();
    const access = observed[observed.length - 1];
    expect(access.state).toBe("loading");
    expect(access.blocked).toBe(true);
    expect(access.canPurchase).toBe(false);
    // Control: the very same warm cache DOES resolve once auth has settled, so
    // this is not passing because the cache was never primed.
    observed = [];
    mockIsAuthReady = true;
    await mount(client);
    const settled = await settleUntil((value) => value.state !== "loading");
    expect(settled.state).toBe("allowed");
  });

  test("the FIRST paint, before data resolves, is BLOCKED — never a fabricated allow", async () => {
    let release!: (value: Advisory) => void;
    fetchSpy.mockReturnValue(
      new Promise<Advisory>((resolve) => {
        release = resolve;
      }),
    );
    const client = freshClient();
    await mount(client);
    // Nothing has resolved yet.
    expect(observed[0].state).toBe("loading");
    expect(observed[0].blocked).toBe(true);
    release(advisory("named_buyers", "allowed"));
    const settled = await settleUntil((value) => value.state !== "loading");
    expect(settled.state).toBe("allowed");
  });
});

describe("issue #2101 — `loading` is the INITIAL resolution only, never a refetch", () => {
  test("a second mount over resolved data does NOT report loading", async () => {
    // Amendment 1 §A7 pins staleTime 0 + refetchOnMount 'always', so the second
    // mount DOES refetch. If `loading` were bound to `isFetching`, this would
    // re-disable the primary CTA on every mount — the bug class registered at
    // docs/INVARIANT_REGISTRY.md:6537.
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    const client = freshClient();

    const first = await mountAndSettle(client);
    expect(first.state).toBe("allowed");

    observed = [];
    await mount(client);
    await tick();

    // The very first value of the REMOUNT, while the refetch is in flight.
    expect(observed[0].state).toBe("allowed");
    expect(observed[0].blocked).toBe(false);
    expect(observed.every((v) => v.state !== "loading")).toBe(true);
    // and the refetch genuinely happened — otherwise this proves nothing.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("issue #2101 — the decision is scoped to the viewer's identity", () => {
  test("a different signed-in user does not read the previous user's decision", async () => {
    const client = freshClient();
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    mockUser = { id: "buyer-allowed" };
    expect((await mountAndSettle(client)).state).toBe("allowed");

    observed = [];
    fetchSpy.mockResolvedValue(advisory("named_buyers", "restricted"));
    mockUser = { id: "buyer-stranger" };
    const stranger = await mountAndSettle(client);
    expect(stranger.state).toBe("restricted");
    expect(stranger.blocked).toBe(true);
  });

  test("an anonymous viewer resolves under its own scope", async () => {
    const client = freshClient();
    fetchSpy.mockResolvedValue(advisory("named_buyers", "sign_in_required"));
    mockUser = null;
    const anon = await mountAndSettle(client);
    expect(anon.state).toBe("sign_in_required");
    expect(anon.requiresSignIn).toBe(true);
  });
});

describe("issue #2101 — retry is wired to the real query", () => {
  test("retry re-runs the eligibility read", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "restricted"));
    const access = await mountAndSettle(freshClient());
    const before = fetchSpy.mock.calls.length;
    access.retry();
    await tick();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(before);
  });
});
