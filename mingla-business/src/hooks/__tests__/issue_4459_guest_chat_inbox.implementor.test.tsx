/**
 * #4459 — the brand Guest chats come from issue_4459_list_my_brand_guest_chats.
 * #4420 replaced the GUESTS section (BrandGuestChatSection, deleted) with ONE
 * row per brand: the Guest chat is the Guests side of the brand's thread, and
 * its activity (unread, last line) comes from issue_4420_brand_guest_activity.
 *
 * FAILS-ON-REVERT: drop the list RPC from listMyBrandGuestChats, bring back a
 * separate Guests section, or stop joining Guest chats onto the brand rows,
 * and this fails.
 */
import { beforeEach, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import React from "react";

const mockRpc = jest.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => mockRpc(name, args),
    // #4420: the hook listens for new messages to move the guest badges.
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: async () => undefined,
  },
}));

// eslint-disable-next-line import/first
import { useBrandGuestChats } from "../useBrandGuestChats";
// eslint-disable-next-line import/first
import { brandGuestChatHref } from "../../services/brandGuestChatList";

const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { unmount(): void };
  act(callback: () => void | Promise<void>): Promise<void>;
};
const { act } = TestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let latest: ReturnType<typeof useBrandGuestChats>;
const Probe = (): null => {
  latest = useBrandGuestChats();
  return null;
};
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

test("the Guests list comes from the list RPC; a failure reads in plain words", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{ conversation_id: "c1", brand_id: "b1", brand_name: "Lagos Vibes", brand_logo_url: null, is_broadcast_only: true, member_count: 12, last_message_at: null }],
    error: null,
  });
  let renderer!: { unmount(): void };
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_list_my_brand_guest_chats", undefined);
  expect(mockRpc).toHaveBeenCalledWith("issue_4420_brand_guest_activity", undefined);
  expect(latest.chats).toEqual([
    { conversation_id: "c1", brand_id: "b1", brand_name: "Lagos Vibes", brand_logo_url: null, is_broadcast_only: true, member_count: 12, last_message_at: null },
  ]);
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
  await act(async () => {
    await latest.refresh();
  });
  expect(latest.error).toBe("Something went wrong. Try again.");
  renderer.unmount();
  expect(brandGuestChatHref("b1")).toBe("/brand/b1/guest-chat");
});

test("#4420: the inbox is one row per brand; the Guest chat joins its brand's row", () => {
  const screen = read("../../components/messages/BrandGroupInboxScreen.tsx");
  expect(screen).not.toContain("BrandGuestChatSection");
  expect(screen).toContain("guestChats={guestChats.chats}");
  expect(screen).toContain("router.push(brandInboxRowHref(row) as never)");
  expect(screen).toContain("desktopList: { width: 360");
  expect(fs.existsSync(path.resolve(__dirname, "../../components/messages/BrandGuestChatSection.tsx"))).toBe(false);
  const list = read("../../components/messages/BrandGroupInboxList.tsx");
  expect(list).toContain("buildBrandInboxRows(groups, guestChats, guestActivity)");
  const route = read("../../../app/brand/[id]/guest-chat.tsx");
  expect(route).toContain("<LazyGroupChatPanel brandId={id} teamUnavailableReason=");
});
