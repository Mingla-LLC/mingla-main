/** #3988 — per-thread mute is optimistic, RPC-backed, and rolls back visibly. */
import { beforeEach, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import React from "react";

type Group = {
  conversation_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_photo_url: null;
  last_message_at: null;
  last_message_preview: string;
  unread_count: number;
  member_count: number;
  access_kind: "brand";
  push_enabled: boolean;
  muted: boolean;
};

const group: Group = {
  conversation_id: "group-3988",
  brand_id: "brand-3988",
  brand_name: "Rollback Brand",
  brand_slug: "rollback-brand",
  brand_photo_url: null,
  last_message_at: null,
  last_message_preview: "",
  unread_count: 0,
  member_count: 3,
  access_kind: "brand",
  push_enabled: false,
  muted: false,
};

const mockListBrandGroups = jest.fn<
  () => Promise<{ groups: Group[]; error: string | null }>
>();
const mockSetBrandGroupMuted = jest.fn<
  (conversationId: string, muted: boolean) => Promise<boolean>
>();
const mockRemoveChannel = jest.fn((_channel: unknown) => Promise.resolve("ok"));
const realtime = { on: jest.fn(), subscribe: jest.fn() };
realtime.on.mockReturnValue(realtime);
realtime.subscribe.mockReturnValue(realtime);

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "host-3988" } }),
}));
jest.mock("../../services/brandGroupsService", () => ({
  listBrandGroups: () => mockListBrandGroups(),
  setBrandGroupMuted: (conversationId: string, muted: boolean) =>
    mockSetBrandGroupMuted(conversationId, muted),
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    channel: () => realtime,
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
  },
}));

// eslint-disable-next-line import/first
import { useBrandGroups } from "../useBrandGroups";

type HookValue = ReturnType<typeof useBrandGroups>;
let latest: HookValue;

const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { unmount(): void };
  act(callback: () => void | Promise<void>): Promise<void>;
};
const { act } = TestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const Probe = (): null => {
  latest = useBrandGroups();
  return null;
};
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  realtime.on.mockReturnValue(realtime);
  realtime.subscribe.mockReturnValue(realtime);
  mockListBrandGroups.mockResolvedValue({ groups: [group], error: null });
});

test("Mute calls the new RPC optimistically and restores the prior value on error", async () => {
  let rejectMutation!: (cause: Error) => void;
  mockSetBrandGroupMuted.mockImplementation(() =>
    new Promise<boolean>((_resolve, reject) => {
      rejectMutation = reject;
    })
  );
  let renderer!: { unmount(): void };
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });
  expect(latest.groups[0]?.muted).toBe(false);

  let mutation!: Promise<void>;
  await act(async () => {
    mutation = latest.setMuted("group-3988", true);
    await flush();
  });
  expect(mockSetBrandGroupMuted).toHaveBeenCalledWith("group-3988", true);
  expect(latest.groups[0]?.muted).toBe(true);

  await act(async () => {
    rejectMutation(new Error("network unavailable"));
    await expect(mutation).rejects.toThrow("network unavailable");
    await flush();
  });
  expect(latest.groups[0]?.muted).toBe(false);

  const thread = fs.readFileSync(
    path.resolve(__dirname, "../../../app/messages/[conversationId].tsx"),
    "utf8",
  );
  const peoplePanel = fs.readFileSync(
    path.resolve(__dirname, "../../components/messages/BrandGroupPeoplePanel.tsx"),
    "utf8",
  );
  // [TEST-MOD-APPROVED #4173] Notification controls moved into the authorized
  // people/details surface; the active muted-state notice remains in-thread.
  expect(thread).toContain("BrandGroupPeoplePanel");
  expect(peoplePanel).toContain("Mute notifications");
  expect(peoplePanel).toContain("Direct @mentions still notify you");
  // [TEST-MOD-APPROVED #3988] Direct mentions intentionally bypass a thread
  // mute, so the previous blanket no-push copy was no longer truthful.
  expect(thread).toContain(
    "Muted: routine push alerts are off, but direct @mentions still notify you.",
  );
  expect(thread).toContain("<Toast");
  expect(thread).not.toContain("Watching");
  await act(async () => {
    renderer.unmount();
  });
});
