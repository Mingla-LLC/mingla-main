// Issue #4114 Wave 5 — the 1:1 collab start goes through ONE server call.
//
// FAILS-ON-REVERT: startDmCollab inserting the session itself (or skipping the
// RPC), not passing the chat id, not sending the friend's push through
// send-collaboration-invite, or not turning the server's limit refusal into
// the typed `limit` failure the chat uses to open the paywall.

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { DmCollabStartFailure, startDmCollab } from "../dmCollabService";

describe("issue #4114 wave 5 startDmCollab", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockInvoke.mockReset();
    mockFrom.mockReset();
  });

  it("calls start_dm_collab with the chat id, then pushes the invite to the friend", async () => {
    mockRpc.mockResolvedValue({
      data: { session_id: "s1", invite_id: "i1", session_name: "Ife & Tomi", friend_id: "tomi" },
      error: null,
    });
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const result = await startDmCollab({ conversationId: "dm-1", inviterId: "ife" });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("start_dm_collab", { p_conversation_id: "dm-1", p_name: null });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("send-collaboration-invite", {
      body: {
        inviterId: "ife",
        invitedUserId: "tomi",
        sessionId: "s1",
        sessionName: "Ife & Tomi",
        inviteId: "i1",
      },
    });
    expect(result).toEqual({ sessionId: "s1", inviteId: "i1", sessionName: "Ife & Tomi", friendId: "tomi" });
  });

  it("turns the free-plan refusal into a typed limit failure and sends no push", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "session_limit_reached: You have reached your free limit of 1 active session(s)." },
    });

    await expect(startDmCollab({ conversationId: "dm-1", inviterId: "ife" })).rejects.toMatchObject({
      name: "DmCollabStartFailure",
      reason: "limit",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("keeps the collab when only the push fails", async () => {
    mockRpc.mockResolvedValue({
      data: { session_id: "s1", invite_id: "i1", session_name: "x", friend_id: "tomi" },
      error: null,
    });
    mockInvoke.mockResolvedValue({ data: null, error: { message: "push down" } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(startDmCollab({ conversationId: "dm-1", inviterId: "ife" })).resolves.toMatchObject({ sessionId: "s1" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a DmCollabStartFailure for an unknown server answer", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    await expect(startDmCollab({ conversationId: "dm-1", inviterId: "ife" })).rejects.toBeInstanceOf(DmCollabStartFailure);
  });
});
