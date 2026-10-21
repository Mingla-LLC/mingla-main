/** #3988 — the account row owns the real v2 notification_channel_prefs gate. */
import { beforeEach, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

type PreferenceResponse = {
  data: { enabled: boolean } | null;
  error: { message: string } | null;
};

const maybeSingleMock = jest.fn<() => Promise<PreferenceResponse>>();
const upsertMock = jest.fn<
  (
    values: Record<string, unknown>,
    options?: { onConflict: string },
  ) => Promise<{ error: { message: string } | null }>
>();
const eqMock = jest.fn();
const selectMock = jest.fn();

const builder = {
  select: (...args: unknown[]) => selectMock(...args),
  eq: (...args: unknown[]) => eqMock(...args),
  maybeSingle: () => maybeSingleMock(),
  upsert: (
    values: Record<string, unknown>,
    options?: { onConflict: string },
  ) => upsertMock(values, options),
};
selectMock.mockReturnValue(builder);
eqMock.mockReturnValue(builder);

jest.mock("../supabase", () => ({
  supabase: { from: jest.fn(() => builder) },
}));

// eslint-disable-next-line import/first
import {
  getBrandGroupPushPrefEnabled,
  setBrandGroupPushPrefEnabled,
} from "../brandGroupsService";

beforeEach(() => {
  jest.clearAllMocks();
  selectMock.mockReturnValue(builder);
  eqMock.mockReturnValue(builder);
});

test("Brand group push defaults on when absent and persists an explicit v2 row", async () => {
  maybeSingleMock
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { enabled: false }, error: null });
  upsertMock.mockResolvedValue({ error: null });

  await expect(getBrandGroupPushPrefEnabled("user-3988")).resolves.toBe(true);
  await expect(getBrandGroupPushPrefEnabled("user-3988")).resolves.toBe(false);
  await setBrandGroupPushPrefEnabled("user-3988", false);

  expect(eqMock).toHaveBeenCalledWith("user_id", "user-3988");
  expect(eqMock).toHaveBeenCalledWith(
    "category_key",
    "business.brand_group_message",
  );
  expect(eqMock).toHaveBeenCalledWith("channel", "push");
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: "user-3988",
      category_key: "business.brand_group_message",
      channel: "push",
      enabled: false,
    }),
    undefined,
  );
});

test("Notifications renders Brand group messages outside the legacy TEAM_CHILDREN rail", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../app/account/notifications.tsx"),
    "utf8",
  );
  expect(source).toContain('label="Brand group messages"');
  expect(source).toContain(
    'description="When anyone posts in your brand\'s group"',
  );
  const teamChildren = source.slice(
    source.indexOf("const TEAM_CHILDREN"),
    source.indexOf("export default function NotificationsRoute"),
  );
  expect(teamChildren).not.toContain("business.brand_group_message");
  expect(source).toContain("getBrandGroupPushPrefEnabled");
  expect(source).toContain("setBrandGroupPushPrefEnabled");
});
