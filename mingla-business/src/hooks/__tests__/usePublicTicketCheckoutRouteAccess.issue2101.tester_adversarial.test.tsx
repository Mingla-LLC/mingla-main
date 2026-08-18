/**
 * issue #2101 [named-buyer checkout] — TESTER-OWNED ADVERSARIAL suite for the
 * WEB half of the route-access adapter. Closes the independent test's P1-1.
 *
 * WHY THIS FILE EXISTS. `usePublicTicketCheckoutRouteAccess.ts` — the single
 * lever every public checkout entry on Event, Trip and Experience reads — was
 * executed by NO suite in the repository:
 *
 *   - `PublicEventPage.issue2101.test.tsx` INJECTS the adapter's return value
 *     through `jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess")`,
 *     so the mandated A7.3 items 17-22 render-proof never runs the real
 *     projection;
 *   - `usePublicTicketCheckoutRouteAccess.issue2101.native.test.tsx` imports the
 *     `.native` half only;
 *   - `scripts/ci/issue-2101-named-buyer-checkout.mjs` asserts only that the web
 *     half consumes the eligibility owner and opens no second client.
 *
 * Deleting `state === "restricted"` from the `blocked` disjunction therefore
 * left EVERY purchase entry live for an authenticated non-member on all three
 * surfaces while the entire #2101 lane stayed green — 46/46 render proof, guard
 * PASS, ORCH-1004 PASS, 8/8 native suites, 145/145 nextRoute. That is the
 * "criterion that cannot fail" class. This file is the criterion that can.
 *
 * TWO KINDS OF EVIDENCE, kept distinct on purpose:
 *
 *   (A) EXECUTED — the real hook, the real `@tanstack/react-query` lifecycle,
 *       the real projection, with only the service stubbed. This is where the
 *       `restricted -> blocked` contract, the fail-closed `error`/pre-auth
 *       states, the initial-resolution `loading` binding and the auth-scope
 *       eviction are PROVEN.
 *   (B) PINNED — per-control and per-handler consumption of `.blocked` in the
 *       three route owners, asserted against source with comments and string
 *       literals STRIPPED FIRST (so no comment, doc block or copy string can
 *       satisfy an assertion) and anchored on each control's own neighbouring
 *       identifier rather than on a count. This is wiring evidence, not
 *       behavioural evidence, and it is labelled as such.
 *
 * DIFFERENT ANGLE from the implementor's render proof by construction: that
 * suite varies injected state against rendered controls; this one varies real
 * server payloads against the real projection, and then pins the wiring the
 * projection feeds.
 *
 * RUNNER. This file uses ONLY `react-test-renderer`, which is a declared
 * devDependency and IS in `package-lock.json`, so `npm ci` installs it and this
 * suite runs under the DEFAULT node/ts-jest config with no dedicated render
 * config, no `jest.config.cjs` entry and no workflow install step. It
 * deliberately does NOT import `@testing-library/react-native`: that package is
 * imported by ~20 suites in this repo and declared by none, so a suite that
 * needs it is green for whoever last ran a render lane and red under `npm ci`.
 * Registering it as an RTL suite would also require editing
 * `mingla-business/jest.config.cjs`, which Amendment 8 §A8.5 names explicitly as
 * NOT allowlisted for this issue. Nothing here renders a host component — the
 * probe returns `null` — so no renderer beyond `react-test-renderer` is needed.
 *
 * TESTER-OWNED. The implementor must not edit or duplicate this file; its own
 * happy-path coverage of the same module is separate by design.
 */
/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

const fetchPublic = jest.fn<() => Promise<PublicTicketCheckoutAccess>>();
let authReady = true;
let authUserId: string | null = "user-a";

jest.mock("../../services/eventTicketCheckoutAccessService", () => ({
  fetchPublicTicketCheckoutAccess: () => fetchPublic(),
  fetchEventTicketCheckoutAccess: jest.fn(),
  addSelfToEventTicketCheckoutAccess: jest.fn(),
  addUsernameToEventTicketCheckoutAccess: jest.fn(),
  removeEventTicketCheckoutAccessMember: jest.fn(),
  setEventTicketCheckoutAccessMode: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthReady: authReady,
    user: authUserId === null ? null : { id: authUserId },
  }),
}));

import { usePublicTicketCheckoutRouteAccess } from "../usePublicTicketCheckoutRouteAccess";

const named = (
  state: PublicTicketCheckoutAccess["state"],
): PublicTicketCheckoutAccess => ({
  schemaVersion: 1,
  mode: "named_buyers",
  state,
});

let seen: ReturnType<typeof usePublicTicketCheckoutRouteAccess> | null = null;

const Probe: React.FC<{ eventId: string }> = ({ eventId }) => {
  seen = usePublicTicketCheckoutRouteAccess(eventId);
  return null;
};

const makeClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

/** Synchronous mount under `act`, so the first render is flushed. */
const mountElement = (element: React.ReactElement): RendererInstance => {
  let instance: RendererInstance | null = null;
  const result = TestRenderer.act(() => {
    instance = TestRenderer.create(element);
  });
  // `act` returns a thenable only for the async form; this one is sync.
  void result;
  if (instance === null) throw new Error("mount produced no renderer");
  return instance;
};

const mount = (client: QueryClient): RendererInstance =>
  mountElement(
    <QueryClientProvider client={client}>
      <Probe eventId="evt-2101" />
    </QueryClientProvider>,
  );

/**
 * Flush pending microtasks/state inside `act` until `predicate` holds. Replaces
 * RTL's `waitFor` with no new dependency. It THROWS on timeout rather than
 * returning, so a never-settling query is a red, never a silent pass.
 */
const settleUntil = async (
  predicate: () => boolean,
  label: string,
  ticks = 50,
): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) {
    if (predicate()) return;
    await TestRenderer.act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!predicate()) {
    throw new Error(`settleUntil timed out waiting for: ${label}`);
  }
};

beforeEach(() => {
  fetchPublic.mockReset();
  authReady = true;
  authUserId = "user-a";
  seen = null;
});

// ── (A) EXECUTED — the real projection ──────────────────────────────────────

describe("issue #2101 — the REAL web route-access adapter projection", () => {
  const CASES: Array<
    [PublicTicketCheckoutAccess["state"], boolean, boolean, boolean]
  > = [
    ["restricted", true, false, false],
    ["sign_in_required", false, true, false],
    ["allowed", false, false, true],
  ];
  test.each(CASES)(
    "named_buyers/%s projects blocked=%s requiresSignIn=%s canPurchase=%s",
    async (serverState, blocked, requiresSignIn, canPurchase) => {
      fetchPublic.mockResolvedValue(named(serverState));
      const client = makeClient();
      const view = mount(client);
      await settleUntil(() => seen?.state === serverState, serverState);
      expect(seen?.state).toBe(serverState);
      expect(seen?.blocked).toBe(blocked);
      expect(seen?.requiresSignIn).toBe(requiresSignIn);
      expect(seen?.canPurchase).toBe(canPurchase);
      view.unmount();
      client.clear();
    },
  );

  test("an unrestricted event is byte-compatible with today", async () => {
    fetchPublic.mockResolvedValue({
      schemaVersion: 1,
      mode: "unrestricted",
      state: "unrestricted",
    });
    const client = makeClient();
    const view = mount(client);
    await settleUntil(() => seen?.state === "unrestricted", "unrestricted");
    expect(seen?.state).toBe("unrestricted");
    expect(seen?.blocked).toBe(false);
    expect(seen?.canPurchase).toBe(true);
    view.unmount();
    client.clear();
  });

  test("a read error is fail-CLOSED, never permissive", async () => {
    fetchPublic.mockRejectedValue(new Error("network"));
    const client = makeClient();
    const view = mount(client);
    await settleUntil(() => seen?.state === "error", "error");
    expect(seen?.state).toBe("error");
    expect(seen?.blocked).toBe(true);
    expect(seen?.canPurchase).toBe(false);
    view.unmount();
    client.clear();
  });

  test("before auth settles the adapter is loading and BLOCKED, not allowed", () => {
    authReady = false;
    fetchPublic.mockResolvedValue(named("allowed"));
    const client = makeClient();
    const view = mount(client);
    expect(seen?.state).toBe("loading");
    expect(seen?.blocked).toBe(true);
    expect(fetchPublic).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });

  /**
   * The `!isAuthReady` conjunct is load-bearing on its own. With a decision
   * already cached for the scope the hook would key BEFORE auth settles,
   * dropping that conjunct serves the previous scope's answer to whoever is
   * signing in. `data !== undefined` alone is NOT sufficient.
   */
  test("a cached decision is NOT served while auth is still settling", async () => {
    fetchPublic.mockResolvedValue(named("allowed"));
    const client = makeClient();
    const warm = mount(client);
    await settleUntil(() => seen?.state === "allowed", "allowed");
    expect(seen?.state).toBe("allowed");
    warm.unmount();

    // Same cache, auth now unsettled: the resolved decision must NOT leak.
    authReady = false;
    const cold = mount(client);
    expect(seen?.state).toBe("loading");
    expect(seen?.blocked).toBe(true);
    expect(seen?.canPurchase).toBe(false);
    cold.unmount();
    client.clear();
  });

  /**
   * `staleTime: 0` + `refetchOnMount: "always"` mean a refetch is in flight on
   * EVERY mount. Binding `loading` to `isFetching` would re-disable the primary
   * CTA each time — the bug class registered at
   * `docs/INVARIANT_REGISTRY.md:6537`. Mount twice against ONE client, holding
   * the second mount's refetch open for its whole lifetime, and prove the
   * second mount never re-enters `loading` over already-resolved data.
   */
  test("a SECOND mount never re-downgrades resolved data to loading", async () => {
    fetchPublic.mockResolvedValue(named("allowed"));
    const client = makeClient();

    const first = mount(client);
    await settleUntil(() => seen?.state === "allowed", "allowed");
    expect(seen?.state).toBe("allowed");
    first.unmount();

    let release: (v: PublicTicketCheckoutAccess) => void = () => {};
    fetchPublic.mockImplementation(
      () =>
        new Promise<PublicTicketCheckoutAccess>((resolve) => {
          release = resolve;
        }),
    );

    const states: string[] = [];
    const Recorder: React.FC = () => {
      const a = usePublicTicketCheckoutRouteAccess("evt-2101");
      states.push(a.state);
      seen = a;
      return null;
    };
    const second = mountElement(
      <QueryClientProvider client={client}>
        <Recorder />
      </QueryClientProvider>,
    );

    expect(states).not.toContain("loading");
    expect(seen?.blocked).toBe(false);
    expect(seen?.canPurchase).toBe(true);

    await TestRenderer.act(async () => {
      release(named("allowed"));
      await Promise.resolve();
    });
    expect(states).not.toContain("loading");
    second.unmount();
    client.clear();
  });

  test("an identity change drops the previous scope's decision", async () => {
    fetchPublic.mockResolvedValue(named("allowed"));
    const client = makeClient();
    const first = mount(client);
    await settleUntil(() => seen?.state === "allowed", "allowed");
    expect(seen?.state).toBe("allowed");
    first.unmount();

    authUserId = "user-b";
    fetchPublic.mockResolvedValue(named("restricted"));
    const second = mount(client);
    await settleUntil(() => seen?.state === "restricted", "restricted");
    expect(seen?.state).toBe("restricted");
    expect(seen?.blocked).toBe(true);
    second.unmount();
    client.clear();
  });
});

// ── (B) PINNED — per-control / per-handler consumption on all three surfaces ─

const BUSINESS_ROOT = path.resolve(__dirname, "../..", "..");

/**
 * Strip block comments, line comments and every string/template literal BEFORE
 * asserting, so no comment, doc block or user-facing copy can satisfy a check.
 * (`docs/INVARIANT_REGISTRY.md` registers the comment-satisfied-assertion class;
 * a tester file closing an unfalsifiable check must not add one.)
 */
const codeOnly = (rel: string): string =>
  readFileSync(path.join(BUSINESS_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, "''");

/**
 * The code from `anchor` up to `terminator` — a BOUNDED window, never a
 * symmetric span. A symmetric window is the over-wide-window anti-pattern: with
 * +/-900 chars the `onBuyTicket` window swallowed `onClaimFreeTicket`'s guard,
 * and deleting `onBuyTicket`'s own guard stayed green. Caught by this file's own
 * falsification matrix (E-5) before it landed.
 */
const bodyBetween = (
  source: string,
  anchor: string,
  terminator: string,
): string => {
  const i = source.indexOf(anchor);
  expect([anchor, i >= 0]).toEqual([anchor, true]);
  const j = source.indexOf(terminator, i + anchor.length);
  expect([terminator, j > i]).toEqual([terminator, true]);
  return source.slice(i, j);
};

describe("issue #2101 — every public checkout entry consumes `.blocked`", () => {
  test("EVENT: the lever is derived from the adapter and from nothing else", () => {
    const src = codeOnly("src/components/event/PublicEventPage.tsx");
    expect(src).toMatch(
      /purchaseBlockedByAccess\s*=\s*isPurchaseEntryKind\s*&&\s*routeAccess\.blocked/,
    );
    // The forbidden levers of A7.2 are not used to achieve the disabled state.
    expect(src).not.toMatch(/bookable\s*=\s*(?:!|false)/);
    expect(src).not.toMatch(/hideTicketBox=\{[^}]*purchaseBlockedByAccess/);
  });

  test.each([
    ["DESKTOP sticky ticket box", "orch-1167-event-desktop-ticket-box"],
    ["PHONE floating bar", "orch-1167-event-floating-bar"],
    ["PHONE inline box via FoundationEventPreview", "onDockLayout={handleDockLayout}"],
  ])("EVENT %s carries the lever (both layouts)", (_label, anchor) => {
    const src = codeOnly("src/components/event/PublicEventPage.tsx");
    // testIDs are string literals, which `codeOnly` blanks — anchor on the raw
    // source for position, then assert against the stripped source.
    const raw = readFileSync(
      path.join(BUSINESS_ROOT, "src/components/event/PublicEventPage.tsx"),
      "utf8",
    );
    const i = raw.indexOf(anchor);
    expect([anchor, i >= 0]).toEqual([anchor, true]);
    const rawWindow = raw.slice(Math.max(0, i - 900), i + 900);
    const strippedWindow = rawWindow
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(strippedWindow).toContain("submitting={purchaseBlockedByAccess}");
    void src;
  });

  test.each([
    ["handleProceedToCart", "const handleProceedToCart", "const handleClose"],
    ["onBuyTicket", "onBuyTicket:", "onClaimFreeTicket:"],
    ["onClaimFreeTicket", "onClaimFreeTicket:", "onJoinWaitlist:"],
  ])(
    "EVENT handler %s fails closed independently of its control AND of the other handlers",
    (_label, anchor, terminator) => {
      const src = codeOnly("src/components/event/PublicEventPage.tsx");
      const body = bodyBetween(src, anchor, terminator);
      const guards =
        body.match(/if\s*\(\s*purchaseBlockedByAccess\s*\)\s*return\s*;/g) ?? [];
      // Exactly one, inside THIS handler's own body — never borrowed from a
      // neighbour by an over-wide window.
      expect([anchor, guards.length]).toEqual([anchor, 1]);
      expect(body).toMatch(/purchaseNeedsSignIn/);
    },
  );

  test("TRIP: the reserve handler and BOTH bar layouts gate on `.blocked`", () => {
    const src = codeOnly("app/t/[brandSlug]/[tripSlug].tsx");
    expect(src).toMatch(/if\s*\(\s*tripAccess\.blocked\s*\)\s*return\s*;/);
    expect(src).toMatch(
      /if\s*\(\s*!\s*tripAccess\.blocked\s*\)\s*return\s+offeringState\.cta\s*;/,
    );
    // docked + floating: two independent render gates, not one.
    const gates = src.match(/tripAccess\.blocked\s*\?/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(2);
    expect(bodyBetween(src, "const dockedReserve", "variant=")).toMatch(
      /tripAccess\.blocked\s*\?/,
    );
  });

  test("EXPERIENCE: both entry handlers and the CTA gate on `.blocked`", () => {
    const src = codeOnly("app/exp/[brandSlug]/[experienceSlug].tsx");
    const guards =
      src.match(/if\s*\(\s*experienceAccess\.blocked\s*\)\s*return\s*;/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(
      /if\s*\(\s*!\s*experienceAccess\.blocked\s*\)\s*return\s+expCta\s*;/,
    );
  });

  test("no route owner re-implements the decision — all three read the ONE adapter", () => {
    for (const rel of [
      "src/components/event/PublicEventPage.tsx",
      "app/t/[brandSlug]/[tripSlug].tsx",
      "app/exp/[brandSlug]/[experienceSlug].tsx",
    ]) {
      const src = codeOnly(rel);
      expect(src).toContain("usePublicTicketCheckoutRouteAccess");
      // No second policy interpretation and no direct service/RPC read.
      expect(src).not.toContain("eventTicketCheckoutAccessService");
      expect(src).not.toContain("pg_public_ticket_checkout_access_state");
      expect(src).not.toMatch(/mode\s*===\s*''\s*&&\s*state/);
    }
  });
});
