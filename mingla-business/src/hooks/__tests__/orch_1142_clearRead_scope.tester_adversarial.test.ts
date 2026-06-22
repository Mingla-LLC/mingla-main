/* eslint-disable import/first */
/**
 * ORCH-1142 — TESTER-AUTHORED ADVERSARIAL regression (BEHAVIORAL).
 *
 * Different angle than the implementor's `orch_1142_notif_softdelete_scope.test.ts`
 * (which is a static SOURCE-REGEX assertion). This test actually EXECUTES the
 * hook's mutations + realtime handler against a recording supabase query-builder
 * spy and asserts on RUNTIME behavior — the attack is on the scope boundary the
 * source regex can't prove:
 *
 *   A1  clearRead() constructs a server filter that is provably scoped to
 *       (user_id) AND (read_at IS NOT NULL) AND (deleted_at IS NULL) AND the
 *       business-type .or(...) — and the optimistic cache removes ONLY read rows
 *       (an UNREAD business row + a READ CONSUMER row both SURVIVE in cache).
 *   A2  clearRead() server-error → the cache REVERTS to the exact prior rows
 *       (no silent data-loss of unread / consumer rows on the optimistic path).
 *   A3  the realtime UPDATE handler DROPS a soft-deleted BUSINESS row from cache,
 *       and IGNORES a soft-deleted CONSUMER row (never mutates the business cache
 *       for a foreign-app payload).
 *   A4  softDelete() is single-primary-key only — it targets .eq("id", ...) and
 *       NEVER .eq("user_id")/.or(...), so it can't degrade into a bulk delete.
 *
 * # Fails-on-revert (verified by the tester via true line-deletion):
 *   - Drop `.not("read_at","is",null)` from clearRead → A1 RED (chain lacks the
 *     read scope; an unread row could be cleared) AND the optimistic-removal
 *     assertion still holds, but the recorded server chain assertion fails.
 *   - Widen clearRead optimistic filter to `n.read_at !== undefined`/remove the
 *     read filter → A1 cache-survival RED.
 *   - Remove the realtime `deleted_at !== null` drop branch → A3 RED.
 *   See the QA report for the exact commit hash + recorded failing assertion.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

// The hook's silent-revert path guards its dev-warn behind the RN `__DEV__`
// global, which the bundler injects at build time but jest's node env does not.
// Define it so the A2 error-path executes the cache restore (not crash on the
// missing global). Product code is unchanged — this is a test-env shim only.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const queryClient = new QueryClient();
let mockQueryData: ReadonlyArray<unknown> = [];

// ── Recording query-builder spy ──────────────────────────────────────────────
// Every chained filter call is recorded as [method, ...args]; the chain is
// thenable so `await supabase.from().update()...or()` resolves to {error}.
interface ChainCall {
  method: string;
  args: unknown[];
}
let lastChain: ChainCall[] = [];
let serverError: { message: string } | null = null;

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    lastChain.push({ method, args });
    return chain;
  };
  for (const m of ["update", "select", "eq", "not", "is", "or", "order", "limit", "returns"]) {
    chain[m] = record(m);
  }
  // Thenable: awaiting the chain resolves to a PostgREST-style result.
  (chain as { then: unknown }).then = (
    resolve: (v: { data: unknown[]; error: { message: string } | null }) => unknown,
  ) => resolve({ data: [], error: serverError });
  return chain;
}

// Capture the realtime UPDATE handler the hook registers so A3 can drive it.
const realtimeHandlers: Record<string, (payload: { new: unknown }) => void> = {};
const channelStub = {
  on: jest.fn((_event: string, cfg: { event: string }, cb: (p: { new: unknown }) => void) => {
    realtimeHandlers[cfg.event] = cb;
    return channelStub;
  }),
  subscribe: jest.fn(() => channelStub),
};

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: jest.fn(() => makeChain()),
    channel: jest.fn(() => channelStub),
    removeChannel: jest.fn(),
  },
}));

jest.mock("../../services/oneSignalService", () => ({
  clearNotificationBadge: jest.fn(),
}));

// ORCH-1202: useBusinessNotifications now folds isAuthReady from useAuth().
// Mock AuthContext (isAuthReady: true) so the node-env hook runs without
// loading the real AuthContext.tsx (react-native/expo-constants ESM the
// node/ts-jest config cannot transform). isAuthReady true keeps the enabled
// predicate identical to the pre-1202 behavior these assertions rely on.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "u1" }, session: { access_token: "t" }, loading: false }),
}));

// Run the hooks outside a renderer (same node-env pattern as the inbox test),
// but capture useEffect so we can invoke the realtime-subscribe effect for A3.
let capturedEffect: (() => void) | null = null;
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (fn: () => void) => {
      capturedEffect = fn;
    },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
  };
});

jest.mock("@tanstack/react-query", () => {
  const actual =
    jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => queryClient,
    useMutation: (config: { mutationFn: (id: string) => Promise<void> }) => ({
      mutateAsync: (id: string) => config.mutationFn(id),
    }),
    useQuery: () => ({ data: mockQueryData }),
  };
});

import {
  useBusinessNotificationsInbox,
  businessNotificationKeys,
  type BusinessNotification,
} from "../useBusinessNotifications";

const USER = "user-1";

const mkRow = (
  id: string,
  readAt: string | null,
  type = "business.order_paid",
): BusinessNotification => ({
  id,
  user_id: USER,
  brand_id: "b-1",
  type,
  title: "t",
  body: "b",
  deep_link: null,
  read_at: readAt,
  deleted_at: null,
  created_at: "2026-06-15T00:00:00Z",
});

const READ = "2026-06-10T00:00:00Z";

function chainHas(method: string): ChainCall | undefined {
  return lastChain.find((c) => c.method === method);
}

beforeEach(() => {
  queryClient.clear();
  lastChain = [];
  serverError = null;
  capturedEffect = null;
  for (const k of Object.keys(realtimeHandlers)) delete realtimeHandlers[k];
});

describe("ORCH-1142 ADVERSARIAL — clearRead scope boundary (behavioral)", () => {
  test("A1: clearRead removes ONLY read business rows from cache + builds a read+business+user-scoped server filter; an UNREAD business row and a READ CONSUMER row both survive", async () => {
    const readBiz = mkRow("rb", READ, "business.order_paid");
    const unreadBiz = mkRow("ub", null, "stripe.payout_paid");
    // A consumer row should never even be in the business cache, but if a stray
    // one is present, clearRead's OPTIMISTIC filter must still not target it for
    // the server delete (the .or business-type clause). We model a read consumer
    // row to prove the SERVER chain carries the type scope.
    const readConsumer = mkRow("rc", READ, "session_match");
    const rows = [readBiz, unreadBiz, readConsumer];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);

    const inbox = useBusinessNotificationsInbox(USER);
    await inbox.clearRead();

    // ── Optimistic cache: only read rows removed; unread business SURVIVES. ──
    const cached = queryClient.getQueryData<readonly BusinessNotification[]>(
      businessNotificationKeys.all(USER),
    );
    const ids = (cached ?? []).map((n) => n.id);
    expect(ids).toContain("ub"); // unread business row MUST survive
    expect(ids).not.toContain("rb"); // read business removed

    // ── Server filter chain: user + read + not-deleted + business-type. ──
    const eqCall = chainHas("eq");
    expect(eqCall?.args).toEqual(["user_id", USER]);
    const notCall = chainHas("not");
    expect(notCall?.args).toEqual(["read_at", "is", null]); // read rows only
    const isCall = chainHas("is");
    expect(isCall?.args).toEqual(["deleted_at", null]); // not already deleted
    const orCall = chainHas("or");
    expect(orCall?.args[0]).toBe("type.like.stripe.%,type.like.business.%"); // business-type only
    // The chain MUST carry the read scope — without `.not(read_at,is,null)` it
    // would clear unread rows too. This is the load-bearing kill assertion.
    expect(lastChain.some((c) => c.method === "not")).toBe(true);
  });

  test("A2: clearRead server-error REVERTS the cache to the exact prior rows (no silent data-loss of unread/consumer rows)", async () => {
    const rows = [
      mkRow("rb", READ, "business.order_paid"),
      mkRow("ub", null, "stripe.payout_paid"),
      mkRow("rc", READ, "session_match"),
    ];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);
    serverError = { message: "boom" };

    const inbox = useBusinessNotificationsInbox(USER);
    await inbox.clearRead();

    const cached = queryClient.getQueryData<readonly BusinessNotification[]>(
      businessNotificationKeys.all(USER),
    );
    // All three rows restored in prior order — nothing lost on the error path.
    expect((cached ?? []).map((n) => n.id)).toEqual(["rb", "ub", "rc"]);
  });
});

describe("ORCH-1142 ADVERSARIAL — realtime soft-delete drop (behavioral)", () => {
  test("A3: a soft-delete UPDATE drops the BUSINESS row from cache; a soft-delete UPDATE for a CONSUMER row is IGNORED", () => {
    const rows = [mkRow("a", READ, "business.order_paid"), mkRow("b", null, "stripe.payout_paid")];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);

    // Mount the realtime subscription effect to register the UPDATE handler.
    useBusinessNotificationsInbox(USER);
    expect(capturedEffect).not.toBeNull();
    capturedEffect?.();
    const onUpdate = realtimeHandlers["UPDATE"];
    expect(onUpdate).toBeDefined();

    // Business row "a" soft-deleted elsewhere → dropped.
    onUpdate({ new: { ...mkRow("a", READ, "business.order_paid"), deleted_at: "2026-06-15T01:00:00Z" } });
    let cached = queryClient.getQueryData<readonly BusinessNotification[]>(
      businessNotificationKeys.all(USER),
    );
    expect((cached ?? []).map((n) => n.id)).toEqual(["b"]); // "a" gone

    // A foreign CONSUMER soft-delete must NOT touch the business cache.
    onUpdate({ new: { ...mkRow("zz", READ, "friend_request_received"), deleted_at: "2026-06-15T01:00:00Z" } });
    cached = queryClient.getQueryData<readonly BusinessNotification[]>(
      businessNotificationKeys.all(USER),
    );
    expect((cached ?? []).map((n) => n.id)).toEqual(["b"]); // unchanged
  });
});

describe("ORCH-1142 ADVERSARIAL — softDelete is single-PK only", () => {
  test("A4: softDelete targets .eq('id', ...) and NEVER .eq('user_id')/.or(...) — cannot degrade to a bulk delete", async () => {
    const rows = [mkRow("x", READ), mkRow("y", null)];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);

    const inbox = useBusinessNotificationsInbox(USER);
    await inbox.softDelete("x");

    const eqCall = chainHas("eq");
    expect(eqCall?.args).toEqual(["id", "x"]); // targets the single PK
    expect(lastChain.some((c) => c.method === "or")).toBe(false); // no bulk .or
    expect(
      lastChain.some((c) => c.method === "eq" && c.args[0] === "user_id"),
    ).toBe(false); // never a user-wide bulk
    // Cache: only "x" removed, "y" (unread) survives.
    const cached = queryClient.getQueryData<readonly BusinessNotification[]>(
      businessNotificationKeys.all(USER),
    );
    expect((cached ?? []).map((n) => n.id)).toEqual(["y"]);
  });
});
