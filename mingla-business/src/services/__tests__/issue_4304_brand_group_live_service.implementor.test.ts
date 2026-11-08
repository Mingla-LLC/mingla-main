/* eslint-disable import/first */
/** #4304 part 2 — Brand-group reactions and seen-by service contract. */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Result = { data: unknown; error: { message?: string } | null };
const calls: { table: string; op: string; args: unknown[] }[] = [];
let nextResult: Result = { data: null, error: null };
const rpcMock = jest.fn<(...args: unknown[]) => Promise<Result>>();

function builder(table: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "insert", "delete", "in", "eq", "single"]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ table, op, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(nextResult).then(resolve, reject);
  return chain;
}

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  addBrandGroupReaction,
  listBrandGroupReactions,
  listBrandGroupReadState,
  removeBrandGroupReaction,
} from "../brandGroupLiveService";

describe("#4304 brandGroupLiveService", () => {
  beforeEach(() => {
    calls.length = 0;
    nextResult = { data: null, error: null };
    rpcMock.mockReset();
  });

  test("lists reactions for the loaded messages only, and skips the call with none", async () => {
    await expect(listBrandGroupReactions([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
    nextResult = { data: [{ id: "r1", message_id: "m1", user_id: "u1", emoji: "❤️" }], error: null };
    await expect(listBrandGroupReactions(["m1", "m2"])).resolves.toEqual([{ id: "r1", message_id: "m1", user_id: "u1", emoji: "❤️" }]);
    expect(calls).toEqual([
      { table: "direct_message_reactions", op: "select", args: ["id, message_id, user_id, emoji"] },
      { table: "direct_message_reactions", op: "in", args: ["message_id", ["m1", "m2"]] },
    ]);
  });

  test("adds and removes a reaction row", async () => {
    nextResult = { data: { id: "r9", message_id: "m1", user_id: "me", emoji: "🔥" }, error: null };
    await expect(addBrandGroupReaction({ messageId: "m1", userId: "me", emoji: "🔥" })).resolves.toMatchObject({ id: "r9" });
    expect(calls[0]).toEqual({ table: "direct_message_reactions", op: "insert", args: [{ message_id: "m1", user_id: "me", emoji: "🔥" }] });
    calls.length = 0;
    nextResult = { data: [{ id: "r9" }], error: null };
    await removeBrandGroupReaction("r9");
    expect(calls).toEqual([
      { table: "direct_message_reactions", op: "delete", args: [] },
      { table: "direct_message_reactions", op: "eq", args: ["id", "r9"] },
      { table: "direct_message_reactions", op: "select", args: ["id"] },
    ]);
    // Zero rows deleted is an error, not a silent success.
    nextResult = { data: [], error: null };
    await expect(removeBrandGroupReaction("r9")).rejects.toThrow("already removed");
  });

  test("errors surface instead of returning empty state", async () => {
    nextResult = { data: null, error: { message: "new row violates row-level security policy" } };
    await expect(listBrandGroupReactions(["m1"])).rejects.toThrow("row-level security");
    await expect(addBrandGroupReaction({ messageId: "m1", userId: "me", emoji: "🍕" })).rejects.toThrow("row-level security");
    await expect(removeBrandGroupReaction("r1")).rejects.toThrow("row-level security");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "conversation_unavailable" } });
    await expect(listBrandGroupReadState("g1")).rejects.toThrow("conversation_unavailable");
  });

  test("reads seen-by pointers through the access-checked RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: "ada", display_name: "Ada", last_read_at: "2026-11-07T10:00:00Z" }], error: null });
    await expect(listBrandGroupReadState("g1")).resolves.toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("issue_4304_list_brand_group_read_state", { p_conversation_id: "g1" });
  });
});
