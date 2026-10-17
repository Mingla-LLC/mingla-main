/* eslint-disable import/first */
/** #3720 Completion Wave 2 — Host Messages contract. */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;
const rpcMock = jest.fn<(...args: unknown[]) => RpcResult>();

jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  listBrandGroups,
  listBrandGroupMessages,
  markBrandGroupRead,
  sendBrandGroupMessage,
  setBrandGroupWatch,
} from "../brandGroupsService";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("#3720 official Brand groups Host contract", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test("list RPCs normalize Postgres counts and present messages oldest first", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ conversation_id: "g1", unread_count: "2", member_count: "4" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "new" }, { id: "old" }], error: null });
    const groups = await listBrandGroups();
    const messages = await listBrandGroupMessages("g1");
    expect(groups.groups[0]).toMatchObject({ unread_count: 2, member_count: 4 });
    expect(messages.messages.map((message) => message.id)).toEqual(["old", "new"]);
  });

  test("read, watch and send use the guarded Wave 2 RPCs", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "m1", error: null });
    await markBrandGroupRead("g1");
    await expect(setBrandGroupWatch("g1", true)).resolves.toBe(true);
    await expect(sendBrandGroupMessage({
      conversationId: "g1",
      content: "Reply",
      replyToId: "m0",
      relatedMessageIds: ["m0", "m2"],
      actorMode: "support",
    })).resolves.toBe("m1");
    expect(rpcMock).toHaveBeenNthCalledWith(1, "issue_3720_mark_brand_group_read", { p_conversation_id: "g1" });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "issue_3720_set_brand_group_watch", { p_conversation_id: "g1", p_enabled: true });
    expect(rpcMock).toHaveBeenNthCalledWith(3, "issue_3720_send_brand_group_message", expect.objectContaining({
      p_conversation_id: "g1",
      p_reply_to_id: "m0",
      p_related_message_ids: ["m0", "m2"],
      p_actor_mode: "support",
    }));
  });

  test("top bar opens Messages and the index separates own and Support groups", () => {
    const topBar = read("src/components/ui/TopBar.tsx");
    const index = read("app/messages/index.tsx");
    expect(topBar).toContain('icon="chat"');
    expect(topBar).toContain('router.push("/messages"');
    expect(topBar).not.toContain('icon="search"');
    expect(index).toContain("Your Brand groups");
    expect(index).toContain("Brand groups you support");
    expect(index).toContain("Support inbox");
  });

  test("thread exposes quote, related-message, dual-role and private signal actions", () => {
    const thread = read("app/messages/[conversationId].tsx");
    expect(thread).toContain("Replying as");
    expect(thread).toContain("Brand team");
    expect(thread).toContain("Mingla Support");
    expect(thread).toContain("Create product signal");
    expect(thread).toContain("related message");
    expect(thread).toContain("message.reply_content");
  });
});
