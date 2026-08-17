/**
 * issue #2181 [anon checkout gate] — a SIGNED-OUT guest must be able to buy.
 *
 * WHY THIS FILE EXISTS — AND WHY EVERY EXISTING SUITE MISSED THE BUG.
 *
 * `usePublicTicketCheckoutEligibility` gated its read on `isAuthReady`. That
 * flag does NOT mean "auth has settled"; `isBusinessAuthReady` is literally
 * `authStatus === "signed_in_ready" && hasUsableBusinessSession(session)` —
 * "a usable bearer token is attached". For a signed-out visitor it is false in
 * every reachable phase and stays false forever, because
 * `deriveBusinessAuthStatus` terminates such a visitor at `signed_out` and no
 * path carries `signed_out` to `signed_in_ready` without a sign-in. So the
 * query never fired, `loading` never cleared, and the fail-closed consumers
 * disabled every purchase entry PERMANENTLY on the public Event, Trip and
 * Experience pages. Not slow — never.
 *
 * Every prior suite hard-codes `isAuthReady: true` in its `useAuth` mock
 * (`let mockIsAuthReady = true`), so the flag was true BY CONSTRUCTION and the
 * defect was unreachable by test. Even the existing
 * "an anonymous viewer resolves under its own scope" case sets `user = null`
 * while leaving `isAuthReady = true` — a combination production can never
 * produce. A test that asserts auth-ready cannot catch an auth-ready bug.
 *
 * WHAT IS DIFFERENT HERE. This suite NEVER sets `isAuthReady`. It sets only the
 * PRIMITIVE facts a visitor actually has — `session`, `user`, `loading`,
 * `authError` — and derives `authStatus` and `isAuthReady` through the REAL,
 * UNMOCKED production functions (`deriveBusinessAuthStatus`,
 * `isBusinessAuthReady`), exactly as `AuthProvider` derives them. The visitor
 * is therefore genuinely signed out rather than declared ready. Only the React
 * provider plumbing (which needs a live Supabase client) and the service call
 * (the network boundary) are replaced; the hook, the adapter, the key factory,
 * the auth derivations and a real `QueryClient` all execute for real.
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

import {
  deriveBusinessAuthStatus,
  isBusinessAuthReady,
} from "../../utils/authReadiness";
import type { PublicTicketCheckoutAccess } from "../../services/eventTicketCheckoutAccessService";

interface RendererInstance {
  unmount(): void;
}
interface TestRendererApi {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void | Promise<void>): Promise<void> | void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererApi;

/**
 * The visitor's PRIMITIVE auth facts — the only thing any test here sets.
 * `isAuthReady` and `authStatus` are never assigned; they are COMPUTED below
 * by the real production derivations.
 */
interface VisitorFacts {
  loading: boolean;
  session: { access_token: string } | null;
  user: { id: string } | null;
  authError: Error | null;
}

/** A genuinely signed-out visitor: bootstrap finished, no session, no user. */
const SIGNED_OUT: VisitorFacts = {
  loading: false,
  session: null,
  user: null,
  authError: null,
};

/** The same visitor mid-bootstrap, before anything is known. */
const BOOTSTRAPPING: VisitorFacts = {
  loading: true,
  session: null,
  user: null,
  authError: null,
};

const signedIn = (id: string): VisitorFacts => ({
  loading: false,
  session: { access_token: `jwt-for-${id}` },
  user: { id },
  authError: null,
});

let visitor: VisitorFacts = SIGNED_OUT;

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => {
    // The REAL derivations, unmocked. Nothing here asserts readiness.
    const authStatus = deriveBusinessAuthStatus(visitor);
    return {
      user: visitor.user,
      session: visitor.session,
      loading: visitor.loading,
      authStatus,
      isAuthReady: isBusinessAuthReady(authStatus, visitor.session),
    };
  },
}));

const fetchSpy = jest.fn<() => Promise<PublicTicketCheckoutAccess>>();
jest.mock("../../services/eventTicketCheckoutAccessService", () => ({
  fetchPublicTicketCheckoutAccess: (...args: unknown[]) =>
    (fetchSpy as unknown as (
      ...a: unknown[]
    ) => Promise<PublicTicketCheckoutAccess>)(...args),
  fetchEventTicketCheckoutAccess: jest.fn(),
  addSelfToEventTicketCheckoutAccess: jest.fn(),
  addUsernameToEventTicketCheckoutAccess: jest.fn(),
  removeEventTicketCheckoutAccessMember: jest.fn(),
  setEventTicketCheckoutAccessMode: jest.fn(),
}));

// The REAL web adapter over the REAL eligibility hook.
import { usePublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess";
import type { PublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess";

const EVENT_ID = "841355e0-4a19-468c-8c4d-b09a704528da";

const advisory = (
  mode: PublicTicketCheckoutAccess["mode"],
  state: PublicTicketCheckoutAccess["state"],
): PublicTicketCheckoutAccess => ({ schemaVersion: 1, mode, state });

let observed: PublicTicketCheckoutRouteAccess[] = [];
const mounted: RendererInstance[] = [];

const Probe: React.FC = () => {
  observed.push(usePublicTicketCheckoutRouteAccess(EVENT_ID));
  return null;
};

const freshClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mount = async (client: QueryClient): Promise<void> => {
  await TestRenderer.act(async () => {
    mounted.push(
      TestRenderer.create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
  });
};

const tick = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const latest = (): PublicTicketCheckoutRouteAccess => {
  const value = observed[observed.length - 1];
  if (value === undefined) throw new Error("the probe never rendered");
  return value;
};

/**
 * Drive the real React Query lifecycle until `predicate` holds. THROWS on
 * exhaustion rather than returning a stale value — a helper that silently gave
 * up would make every assertion below unfalsifiable.
 */
const settleUntil = async (
  predicate: (value: PublicTicketCheckoutRouteAccess) => boolean,
): Promise<PublicTicketCheckoutRouteAccess> => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (predicate(latest())) return latest();
    await tick();
  }
  throw new Error(
    `the hook never reached the expected state; last was ${JSON.stringify(
      latest(),
    )}`,
  );
};

beforeEach(() => {
  observed = [];
  fetchSpy.mockReset();
  visitor = SIGNED_OUT;
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) void TestRenderer.act(() => renderer.unmount());
  }
});

describe("issue #2181 — a genuinely signed-out guest can buy a ticket", () => {
  test("PREMISE: for a signed-out visitor `isAuthReady` is false in EVERY phase — never, not late", () => {
    // Locks the diagnosis itself. If this ever changes, the fix below is
    // addressing a problem that no longer exists and must be re-derived.
    for (const phase of [BOOTSTRAPPING, SIGNED_OUT]) {
      const authStatus = deriveBusinessAuthStatus(phase);
      expect(isBusinessAuthReady(authStatus, phase.session)).toBe(false);
    }
    expect(deriveBusinessAuthStatus(SIGNED_OUT)).toBe("signed_out");
    // …while a signed-in visitor DOES reach ready, so the predicate is not
    // trivially false for everyone.
    const inFacts = signedIn("buyer-1");
    expect(
      isBusinessAuthReady(deriveBusinessAuthStatus(inFacts), inFacts.session),
    ).toBe(true);
  });

  test("THE BUG: signed-out visitor, public unrestricted event → purchase ENABLED", async () => {
    fetchSpy.mockResolvedValue(advisory("unrestricted", "unrestricted"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state !== "loading");

    expect(settled.state).toBe("unrestricted");
    expect(settled.canPurchase).toBe(true);
    expect(settled.blocked).toBe(false);
    expect(settled.requiresSignIn).toBe(false);
    // The read must actually have happened — an "enabled" derived from no
    // server decision at all would be a fabricated allow.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(EVENT_ID);
  });

  test("the signed-out gate does NOT stay stuck on 'loading' across many ticks", async () => {
    fetchSpy.mockResolvedValue(advisory("unrestricted", "unrestricted"));
    await mount(freshClient());
    for (let i = 0; i < 10; i += 1) await tick();
    // The permanent-wedge symptom, asserted directly: after ten macrotasks a
    // signed-out visitor must not still be "Checking this sale".
    expect(latest().state).not.toBe("loading");
    expect(latest().blocked).toBe(false);
  });

  test("FAIL-CLOSED PRESERVED: signed-out + genuine restriction → BLOCKED", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "restricted"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state !== "loading");

    expect(settled.state).toBe("restricted");
    expect(settled.blocked).toBe(true);
    expect(settled.canPurchase).toBe(false);
  });

  test("FAIL-CLOSED PRESERVED: signed-out + genuine read error → BLOCKED", async () => {
    fetchSpy.mockRejectedValue(new Error("advisory unavailable"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state === "error");

    expect(settled.blocked).toBe(true);
    expect(settled.canPurchase).toBe(false);
    expect(settled.requiresSignIn).toBe(false);
  });

  test("PRESERVED: signed-out + `sign_in_required` routes to sign-in, not checkout", async () => {
    fetchSpy.mockResolvedValue(advisory("named_buyers", "sign_in_required"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state !== "loading");

    expect(settled.state).toBe("sign_in_required");
    expect(settled.requiresSignIn).toBe(true);
    expect(settled.canPurchase).toBe(false);
    // Actionable, NOT disabled — it must reach sign-in.
    expect(settled.blocked).toBe(false);
  });

  test("STILL UNRESOLVED while genuinely bootstrapping → BLOCKED and NO read", async () => {
    // The conjunct that must survive the fix: an identity that is genuinely
    // undetermined is not 'anon'. Reading here would key a decision under
    // 'anon' for a visitor who turns out to be signed in.
    visitor = BOOTSTRAPPING;
    fetchSpy.mockResolvedValue(advisory("unrestricted", "unrestricted"));
    await mount(freshClient());
    await tick();
    await tick();
    await tick();

    expect(latest().state).toBe("loading");
    expect(latest().blocked).toBe(true);
    expect(latest().canPurchase).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("PRESERVED: a signed-in buyer's eligibility is unaffected", async () => {
    visitor = signedIn("buyer-allowed");
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state !== "loading");

    expect(settled.state).toBe("allowed");
    expect(settled.canPurchase).toBe(true);
    expect(settled.blocked).toBe(false);
  });

  test("PRESERVED: a signed-in NON-member is still blocked", async () => {
    visitor = signedIn("buyer-stranger");
    fetchSpy.mockResolvedValue(advisory("named_buyers", "restricted"));
    await mount(freshClient());

    const settled = await settleUntil((value) => value.state !== "loading");

    expect(settled.state).toBe("restricted");
    expect(settled.blocked).toBe(true);
    expect(settled.canPurchase).toBe(false);
  });

  test("NO SCOPE LEAK: an anonymous decision is not served to a signed-in user", async () => {
    const client = freshClient();
    // Anonymous first: the sale is closed to anonymous buyers.
    fetchSpy.mockResolvedValue(advisory("named_buyers", "sign_in_required"));
    await mount(client);
    const anon = await settleUntil((value) => value.state !== "loading");
    expect(anon.state).toBe("sign_in_required");

    // The SAME cache, now a signed-in allowed member. The decision must be
    // re-read under the new scope, not inherited from 'anon'.
    observed = [];
    visitor = signedIn("buyer-allowed");
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    await mount(client);
    const authed = await settleUntil((value) => value.state === "allowed");
    expect(authed.canPurchase).toBe(true);
  });

  test("NO SCOPE LEAK: a signed-in decision is not served to an anonymous viewer", async () => {
    const client = freshClient();
    visitor = signedIn("buyer-allowed");
    fetchSpy.mockResolvedValue(advisory("named_buyers", "allowed"));
    await mount(client);
    const authed = await settleUntil((value) => value.state !== "loading");
    expect(authed.state).toBe("allowed");

    // Same cache, now signed out. The allow must NOT survive the identity
    // change — the anonymous viewer re-decides under its own scope.
    observed = [];
    visitor = SIGNED_OUT;
    fetchSpy.mockResolvedValue(advisory("named_buyers", "sign_in_required"));
    await mount(client);
    const anon = await settleUntil((value) => value.state === "sign_in_required");
    expect(anon.canPurchase).toBe(false);
  });
});
