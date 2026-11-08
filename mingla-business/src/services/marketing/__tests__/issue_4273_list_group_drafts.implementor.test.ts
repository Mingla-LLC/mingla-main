/**
 * #4273 P2-1 — listGroupDrafts resolves the real group, COALESCE(campaign_group_id, id),
 * the same rule the server uses, and flags the head so it is never discarded.
 * #4273 polish — it now reads every status (follow-up 2: `members`) with each
 * row's updated_at (follow-up 1); `drafts` is the draft subset.
 */
const calls: Array<{ method: string; args: unknown[] }> = [];
let leadRow: { id: string; campaign_group_id: string | null } | null = null;
let groupRows: Array<{ id: string; channel: string; status: string; updated_at: string }> = [];

jest.mock("../../supabase", () => {
  const builder = () => {
    let terminal: "lead" | "group" = "lead";
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      if (method === "or") terminal = "group";
      return chain;
    };
    for (const method of ["select", "eq", "or", "neq"]) chain[method] = record(method);
    chain.maybeSingle = () => Promise.resolve({ data: leadRow, error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve(terminal === "group" ? { data: groupRows, error: null } : { data: null, error: null });
    return chain;
  };
  return { supabase: { from: () => builder() } };
});

import { listGroupDrafts } from "../marketingBookSendService";

const HEAD = "42730000-0000-4000-8000-0000000000a1";
const SIB = "42730000-0000-4000-8000-0000000000a2";
const T0 = "2026-11-07T10:00:00.000+00:00";

describe("#4273 listGroupDrafts", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("a sibling lead reads its head's group and the head comes back flagged", async () => {
    leadRow = { id: SIB, campaign_group_id: HEAD };
    groupRows = [{ id: HEAD, channel: "email", status: "draft", updated_at: T0 }];
    const drafts = await listGroupDrafts(SIB);
    const or = calls.find((call) => call.method === "or");
    expect(or?.args[0]).toBe(`campaign_group_id.eq.${HEAD},id.eq.${HEAD}`);
    expect(calls).toContainEqual({ method: "neq", args: ["id", SIB] });
    const head = { id: HEAD, channel: "email", status: "draft", isHead: true, updatedAt: T0 };
    expect(drafts).toEqual({ groupId: HEAD, drafts: [head], members: [head] });
  });

  it("a head lead reads its own group; its siblings are not heads", async () => {
    leadRow = { id: HEAD, campaign_group_id: HEAD };
    groupRows = [{ id: SIB, channel: "sms", status: "draft", updated_at: T0 }];
    const drafts = await listGroupDrafts(HEAD);
    expect(calls.find((call) => call.method === "or")?.args[0]).toBe(`campaign_group_id.eq.${HEAD},id.eq.${HEAD}`);
    const sib = { id: SIB, channel: "sms", status: "draft", isHead: false, updatedAt: T0 };
    expect(drafts).toEqual({ groupId: HEAD, drafts: [sib], members: [sib] });
  });

  it("#4273 polish: every status is read; a sent head is a member, not a draft", async () => {
    leadRow = { id: SIB, campaign_group_id: HEAD };
    groupRows = [
      { id: HEAD, channel: "email", status: "sent", updated_at: T0 },
      { id: "42730000-0000-4000-8000-0000000000a3", channel: "push", status: "draft", updated_at: T0 },
    ];
    const out = await listGroupDrafts(SIB);
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "status")).toBe(false);
    expect(calls).toContainEqual({ method: "select", args: ["id, channel, status, updated_at"] });
    expect(out.members.map((row) => [row.id, row.status, row.isHead])).toEqual([
      [HEAD, "sent", true],
      ["42730000-0000-4000-8000-0000000000a3", "draft", false],
    ]);
    expect(out.drafts.map((row) => row.id)).toEqual(["42730000-0000-4000-8000-0000000000a3"]);
  });
});
