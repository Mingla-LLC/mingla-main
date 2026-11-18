/**
 * #4459 — the Host app's Guest chat (one per brand). Moderation goes through
 * the issue_4459_* RPCs: remove is sticky and restore lifts it; the roster is
 * the server's member list; announcements only and delete are RPCs; a post is
 * sent as the brand through the send RPC (never a direct insert) and only the
 * message id is handed to notify-message.
 *
 * FAILS-ON-REVERT: point removeParticipant back at a direct
 * conversation_participants delete, or drop restoreParticipant from the hook,
 * and the remove / restore case fails; insert into messages directly again and
 * the send case fails.
 */
import { beforeEach, expect, jest, test } from "@jest/globals";
import React from "react";

const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const mockFrom = jest.fn();
const mockInvoke = jest.fn((_name: string, _opts: unknown) => Promise.resolve({ data: null, error: null }));

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "host-1" } } }) },
    functions: { invoke: (name: string, opts: unknown) => mockInvoke(name, opts) },
  },
}));

// eslint-disable-next-line import/first
import { useEventGroupChatModeration } from "../useEventGroupChatModeration";
// eslint-disable-next-line import/first
import { postPlannerMessage, removeParticipant } from "../../services/groupChatService";

type HookValue = ReturnType<typeof useEventGroupChatModeration>;
let latest: HookValue;

const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): { unmount(): void };
  act(callback: () => void | Promise<void>): Promise<void>;
};
const { act } = TestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = (): null => {
  latest = useEventGroupChatModeration("conv-guests");
  return null;
};
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const members = {
  total: 3,
  isTeam: true,
  members: [
    { userId: "host-1", displayName: "Host", avatarUrl: null, isTeam: true, shownAsGoing: false, joinedAt: "2026-11-16T00:00:00Z" },
    { userId: "ana", displayName: "Ana", avatarUrl: null, isTeam: false, shownAsGoing: true, joinedAt: "2026-11-16T01:00:00Z" },
    { userId: "ben", displayName: "Ben", avatarUrl: null, isTeam: false, shownAsGoing: false, joinedAt: "2026-11-16T02:00:00Z" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockImplementation((name: string) => {
    if (name === "issue_4459_list_brand_guest_members") return Promise.resolve({ data: members, error: null });
    if (name === "issue_4459_send_brand_guest_message") return Promise.resolve({ data: { id: "msg-1" }, error: null });
    return Promise.resolve({ data: { status: "ok" }, error: null });
  });
});

test("the roster comes from the member RPC, with the team marked", async () => {
  let renderer!: { unmount(): void };
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_list_brand_guest_members", { p_conversation_id: "conv-guests" });
  expect(latest.participants.map((p) => [p.user_id, p.is_team, p.shown_as_going])).toEqual([
    ["host-1", true, false],
    ["ana", false, true],
    ["ben", false, false],
  ]);
  expect(mockFrom).not.toHaveBeenCalled();
  renderer.unmount();
});

test("remove is the sticky RPC, restore lifts it, and both refresh the roster", async () => {
  let renderer!: { unmount(): void };
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
    await flush();
  });
  await act(async () => {
    expect(await latest.removeParticipant("ben")).toEqual({ error: null });
    await flush();
  });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_remove_brand_guest", { p_conversation_id: "conv-guests", p_user_id: "ben" });
  await act(async () => {
    expect(await latest.restoreParticipant("ben")).toEqual({ error: null });
    await flush();
  });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_restore_brand_guest", { p_conversation_id: "conv-guests", p_user_id: "ben" });
  expect(mockRpc.mock.calls.filter(([name]) => name === "issue_4459_list_brand_guest_members").length).toBe(3);
  await act(async () => {
    await latest.setBroadcastOnly(true);
    await latest.deleteMessage("msg-9");
  });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_set_brand_guest_announcements_only", { p_conversation_id: "conv-guests", p_value: true });
  expect(mockRpc).toHaveBeenCalledWith("unsend_messages", { p_message_ids: ["msg-9"] });
  expect(mockFrom).not.toHaveBeenCalled();
  renderer.unmount();
});

test("a team member cannot be removed: the refusal reads in plain words", async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "invalid_input", details: "user" } });
  expect(await removeParticipant("conv-guests", "host-1")).toEqual({
    error: "That person is on your team, so they stay in the chat.",
  });
});

test("a post goes through the send RPC as the brand, and notify-message gets only the message id", async () => {
  expect(await postPlannerMessage("conv-guests", "  Doors at 8  ")).toEqual({ messageId: "msg-1", error: null });
  expect(mockRpc).toHaveBeenCalledWith("issue_4459_send_brand_guest_message", {
    p_conversation_id: "conv-guests",
    p_content: "Doors at 8",
  });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(mockInvoke).toHaveBeenCalledWith("notify-message", {
    body: { type: "message", senderId: "host-1", conversationId: "conv-guests", messageId: "msg-1" },
  });
  expect(await postPlannerMessage("conv-guests", "   ")).toEqual({ messageId: null, error: "Message is empty." });
});
