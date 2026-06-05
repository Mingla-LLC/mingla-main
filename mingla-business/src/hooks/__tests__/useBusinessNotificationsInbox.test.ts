/* eslint-disable import/first */
/**
 * META-ORCH-1074 Sub-C — happy-path regression for the inbox hook
 * `useBusinessNotificationsInbox`: `unreadCount` derivation +
 * `markAsRead` optimistic cache update.
 *
 * Asserts:
 *   1. unreadCount = count of rows with read_at === null.
 *   2. markAsRead(id) optimistically patches read_at on that row in the
 *      query cache (so the badge decrements before the server round-trip),
 *      and issues the `.update({read_at}).eq("id", id)` mutation.
 *   3. markAllAsRead optimistically clears every unread row + issues the
 *      business-type-scoped bulk update.
 *
 * React's useMemo/useCallback/useEffect are stubbed to pass-through so the
 * hook can run outside a renderer (it has no useState of its own); RQ's
 * useQueryClient is bound to a real QueryClient and useQuery returns
 * controlled data. Same node-env hook-test pattern as useSoftDeleteBrand.
 *
 * # Fails-on-revert
 * Revert `useBusinessNotifications.ts` to the read-only version (no
 * `useBusinessNotificationsInbox` export / no unreadCount / no markAsRead) →
 * module-shape error → every case RED. Break unreadCount (count all rows) →
 * assertion RED. Break markAsRead (drop the optimistic setQueryData) →
 * the post-mark cache assertion RED.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

const queryClient = new QueryClient();

// Controlled query data the hook's useQuery returns.
let mockQueryData: ReadonlyArray<Record<string, unknown>> = [];

// Capture the supabase update chain.
const updateIs = jest.fn(() => ({
  or: jest.fn(() => Promise.resolve({ error: null })),
}));
const updateEqId = jest.fn(() => Promise.resolve({ error: null }));
const updateEqUser = jest.fn(() => ({ is: updateIs }));
const updateFn = jest.fn((_patch: unknown) => ({
  eq: (col: string) => (col === "id" ? updateEqId() : updateEqUser()),
}));

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({ update: updateFn })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
  },
}));

jest.mock("../../services/oneSignalService", () => ({
  clearNotificationBadge: jest.fn(),
}));

// Stub only the three React hooks the inbox uses so it runs outside a
// renderer; keep the rest of React real (react-query needs createContext).
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: jest.fn(),
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
  };
});

jest.mock("@tanstack/react-query", () => {
  const actual =
    jest.requireActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
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
} from "../useBusinessNotifications";

const USER = "user-1";

const mkRow = (id: string, readAt: string | null, type = "business.order_paid") => ({
  id,
  user_id: USER,
  brand_id: "b-1",
  type,
  title: "t",
  body: "b",
  deep_link: null,
  read_at: readAt,
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  queryClient.clear();
  updateFn.mockClear();
  updateEqId.mockClear();
  updateEqUser.mockClear();
  updateIs.mockClear();
});

describe("unreadCount derivation", () => {
  test("counts only rows with read_at === null", () => {
    mockQueryData = [
      mkRow("a", null),
      mkRow("b", "2026-06-04T00:00:00Z"),
      mkRow("c", null),
    ];
    const inbox = useBusinessNotificationsInbox(USER);
    expect(inbox.unreadCount).toBe(2);
  });

  test("zero unread when all read", () => {
    mockQueryData = [mkRow("a", "2026-06-04T00:00:00Z")];
    const inbox = useBusinessNotificationsInbox(USER);
    expect(inbox.unreadCount).toBe(0);
  });
});

describe("markAsRead optimistic", () => {
  test("patches read_at on the cached row + issues update by id", async () => {
    const rows = [mkRow("a", null), mkRow("c", null)];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);

    const inbox = useBusinessNotificationsInbox(USER);
    await inbox.markAsRead("a");

    const cached = queryClient.getQueryData<ReadonlyArray<{ id: string; read_at: string | null }>>(
      businessNotificationKeys.all(USER),
    );
    const rowA = cached?.find((r) => r.id === "a");
    const rowC = cached?.find((r) => r.id === "c");
    expect(rowA?.read_at).not.toBeNull(); // optimistically marked
    expect(rowC?.read_at).toBeNull(); // untouched
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(updateEqId).toHaveBeenCalledTimes(1); // .eq("id", ...)
  });
});

describe("markAllAsRead optimistic", () => {
  test("clears every unread row + issues business-scoped bulk update", async () => {
    const rows = [mkRow("a", null), mkRow("b", null), mkRow("c", "2026-06-04T00:00:00Z")];
    mockQueryData = rows;
    queryClient.setQueryData(businessNotificationKeys.all(USER), rows);

    const inbox = useBusinessNotificationsInbox(USER);
    await inbox.markAllAsRead();

    const cached = queryClient.getQueryData<ReadonlyArray<{ read_at: string | null }>>(
      businessNotificationKeys.all(USER),
    );
    expect(cached?.every((r) => r.read_at !== null)).toBe(true);
    expect(updateEqUser).toHaveBeenCalledTimes(1); // .eq("user_id", ...)
    expect(updateIs).toHaveBeenCalledTimes(1); // .is("read_at", null)
  });
});
