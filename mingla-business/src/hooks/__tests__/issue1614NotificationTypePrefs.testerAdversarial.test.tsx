const cache = new Map<string, unknown>();
let activeQueryResult: Record<string, unknown> = {
  data: [],
  isPending: false,
  isError: false,
};
let upsertError: Error | null = null;
const upsert = jest.fn(async () => ({ error: upsertError }));
const returns = jest.fn(async () => ({ data: [], error: null }));
const eq = jest.fn(() => ({ returns }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select, upsert }));

jest.mock("react", () => ({
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(() => activeQueryResult),
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => cache.get(JSON.stringify(key)),
    setQueryData: (key: readonly unknown[], value: unknown) => {
      const serialized = JSON.stringify(key);
      const previous = cache.get(serialized);
      cache.set(serialized, typeof value === "function" ? value(previous) : value);
    },
    invalidateQueries: jest.fn(),
  }),
  useMutation: (options: { mutationFn: (rows: unknown) => Promise<void> }) => ({
    mutateAsync: options.mutationFn,
  }),
}));

jest.mock("../../services/supabase", () => ({ supabase: { from } }));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

import {
  notificationPrefKeys,
  useNotificationTypePrefs,
} from "../useNotificationTypePrefs";

const USER_A = "00000000-1614-4000-8000-0000000000aa";
const USER_B = "00000000-1614-4000-8000-0000000000bb";
const keyFor = (userId: string): string =>
  JSON.stringify(notificationPrefKeys.all(userId));

beforeEach(() => {
  cache.clear();
  jest.clearAllMocks();
  upsertError = null;
  activeQueryResult = { data: [], isPending: false, isError: false };
});

test("a user switch cannot inherit another operator's explicit preferences", () => {
  const userARows = [{
    channel: "push",
    type: "business.order_paid",
    opt_in: false,
  }];
  cache.set(keyFor(USER_A), userARows);
  activeQueryResult = { data: userARows, isPending: false, isError: false };
  expect(useNotificationTypePrefs(USER_A).isOn("business.order_paid", "push")).toBe(false);

  activeQueryResult = { data: [], isPending: false, isError: false };
  expect(useNotificationTypePrefs(USER_B).isOn("business.order_paid", "push")).toBe(true);
  expect(cache.get(keyFor(USER_B))).toBeUndefined();
});

test("a stale-cache background error keeps the last confirmed values", () => {
  const confirmed = [{
    channel: "in_app",
    type: "business.new_review",
    opt_in: false,
  }];
  activeQueryResult = {
    data: confirmed,
    isPending: false,
    isError: true,
    error: new Error("background offline"),
  };
  const hook = useNotificationTypePrefs(USER_A);
  expect(hook.isOn("business.new_review", "in_app")).toBe(false);
  expect(hook.query.isError).toBe(true);
});

test("a failed bulk write restores every row exactly and rejects", async () => {
  const prior = [{
    channel: "push",
    type: "business.dispute_opened",
    opt_in: true,
  }];
  cache.set(keyFor(USER_A), prior);
  activeQueryResult = { data: prior, isPending: false, isError: false };
  upsertError = new Error("bulk offline");

  const hook = useNotificationTypePrefs(USER_A);
  await expect(
    hook.setMany(
      ["business.dispute_opened", "business.dispute_action_needed"],
      false,
    ),
  ).rejects.toThrow("bulk offline");
  expect(cache.get(keyFor(USER_A))).toBe(prior);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect((upsert.mock.calls as unknown[][])[0][0]).toHaveLength(4);
});

test("null auth state performs no write and creates no shared cache entry", async () => {
  const hook = useNotificationTypePrefs(null);
  await hook.setPref("business.order_paid", "push", false);
  await hook.setMany(["business.order_paid"], false);
  expect(from).not.toHaveBeenCalled();
  expect(cache.size).toBe(0);
});
