import fs from "node:fs";
import path from "node:path";

const cache = new Map<string, unknown>();
const invalidateQueries = jest.fn();
let queryResult: Record<string, unknown> = { data: [], isPending: false, isError: false };
let upsertError: Error | null = null;
const upsert = jest.fn(async () => ({ error: upsertError }));
const eq = jest.fn(() => ({ returns: jest.fn(async () => ({ data: [], error: null })) }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select, upsert }));

jest.mock("react", () => ({
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(() => queryResult),
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => cache.get(JSON.stringify(key)),
    setQueryData: (key: readonly unknown[], value: unknown) => {
      const serialized = JSON.stringify(key);
      const previous = cache.get(serialized);
      cache.set(serialized, typeof value === "function" ? value(previous) : value);
    },
    invalidateQueries,
  }),
  useMutation: (options: { mutationFn: (rows: unknown) => Promise<void>; onSuccess?: () => void }) => ({
    mutateAsync: async (rows: unknown) => {
      await options.mutationFn(rows);
      options.onSuccess?.();
    },
  }),
}));

jest.mock("../../services/supabase", () => ({ supabase: { from } }));
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));

import {
  defaultOptIn,
  notificationPrefKeys,
  useNotificationTypePrefs,
} from "../useNotificationTypePrefs";

const USER = "00000000-1614-4000-8000-000000000001";
const key = notificationPrefKeys.all(USER);

beforeEach(() => {
  cache.clear();
  jest.clearAllMocks();
  queryResult = { data: [], isPending: false, isError: false };
  upsertError = null;
});

test("empty rows use template defaults including team-member push default OFF", () => {
  const hook = useNotificationTypePrefs(USER);
  expect(hook.isOn("business.order_paid", "push")).toBe(defaultOptIn("business.order_paid", "push"));
  expect(hook.isOn("business.team_member_joined", "push")).toBe(false);
  expect(hook.isOn("business.team_member_joined", "in_app")).toBe(true);
});

test("single and bulk writes use the distinct table and survive a cache-backed remount", async () => {
  cache.set(JSON.stringify(key), []);
  const hook = useNotificationTypePrefs(USER);
  await hook.setPref("business.order_paid", "push", false);
  expect(from).toHaveBeenCalledWith("business_notification_type_preferences");
  expect(upsert).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        user_id: USER,
        type: "business.order_paid",
        channel: "push",
        opt_in: false,
      }),
    ]),
    { onConflict: "user_id,channel,type" },
  );

  queryResult = { data: cache.get(JSON.stringify(key)), isPending: false, isError: false };
  const remounted = useNotificationTypePrefs(USER);
  expect(remounted.isOn("business.order_paid", "push")).toBe(false);

  await remounted.setMany(["business.new_review"], false);
  expect(upsert).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ type: "business.new_review", channel: "push", opt_in: false }),
      expect.objectContaining({ type: "business.new_review", channel: "in_app", opt_in: false }),
    ]),
    { onConflict: "user_id,channel,type" },
  );
});

test("failed mutation restores the exact prior cache and rejects to the route", async () => {
  const prior = [{ channel: "push", type: "business.order_paid", opt_in: true }];
  cache.set(JSON.stringify(key), prior);
  upsertError = new Error("offline");
  const hook = useNotificationTypePrefs(USER);
  await expect(hook.setPref("business.order_paid", "push", false)).rejects.toThrow("offline");
  expect(cache.get(JSON.stringify(key))).toBe(prior);
});

test("route exposes exact loading/error controls and inbox excludes suppressed rows", () => {
  const route = fs.readFileSync(path.resolve(process.cwd(), "app/account/notifications.tsx"), "utf8");
  const inbox = fs.readFileSync(path.resolve(process.cwd(), "src/hooks/useBusinessNotifications.ts"), "utf8");
  expect(route).toContain("typePrefs.query.isPending || typePrefs.query.isError");
  expect(route).toContain("Couldn't load notification settings. Reopen this screen to try again.");
  expect(route).toContain("accessibilityState={{ checked: value, disabled }}");
  expect(inbox).toContain('.is("in_app_suppressed_at", null)');
  expect(inbox).toContain("updated.in_app_suppressed_at !== null");
});
