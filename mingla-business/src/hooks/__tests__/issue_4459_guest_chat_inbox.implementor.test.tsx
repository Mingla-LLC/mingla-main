/**
 * #4459 design v2 — Messages → Guests in the Host app: one row per brand Guest
 * chat (issue_4459_list_my_brand_guest_chats), above "Your Brand groups", told
 * apart from the team Brand group by name, the orange guests badge and the
 * Guests tag; on wide desktop it opens beside the 340pt inbox.
 *
 * FAILS-ON-REVERT: drop the BrandGuestChatSection from the inbox header, the
 * list RPC from listMyBrandGuestChats, or the guests badge, and this fails.
 */
import { beforeEach, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import React from "react";

const mockRpc = jest.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("../../services/supabase", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => mockRpc(name, args) },
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

test("the inbox shows Guests above the Brand groups, with the guests badge, and the desktop thread", () => {
  const screen = read("../../components/messages/BrandGroupInboxScreen.tsx");
  expect(screen).toContain("<BrandGuestChatSection");
  expect(screen.indexOf("<BrandGuestChatSection")).toBeGreaterThan(screen.indexOf("<LazyBrandEnquiryListSection"));
  expect(screen).toContain("router.push(brandGuestChatHref(chat.brand_id) as never)");
  expect(screen).toContain("<LazyGroupChatPanel key={openGuestChat.brand_id} brandId={openGuestChat.brand_id} embedded />");
  expect(screen).toContain("desktopList: { width: 340");
  const section = read("../../components/messages/BrandGuestChatSection.tsx");
  expect(section).toContain('testID="brand-guest-chat-badge"');
  expect(section).toContain("`${chat.brand_name} Guests`");
  expect(section).toContain(">Guests</Text>");
  const route = read("../../../app/brand/[id]/guest-chat.tsx");
  expect(route).toContain("<LazyGroupChatPanel brandId={id} />");
});
