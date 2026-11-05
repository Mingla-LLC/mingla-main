/**
 * #4273 P2-1 — listGroupDrafts resolves the real group, COALESCE(campaign_group_id, id),
 * the same rule the server uses, and flags the head so it is never discarded.
 */
const calls: Array<{ method: string; args: unknown[] }> = [];
let leadRow: { id: string; campaign_group_id: string | null } | null = null;
let groupRows: Array<{ id: string; channel: string }> = [];

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

import { listGroupDrafts } from "../marketingCampaignService";

const HEAD = "42730000-0000-4000-8000-0000000000a1";
const SIB = "42730000-0000-4000-8000-0000000000a2";

describe("#4273 listGroupDrafts", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("a sibling lead reads its head's group and the head comes back flagged", async () => {
    leadRow = { id: SIB, campaign_group_id: HEAD };
    groupRows = [{ id: HEAD, channel: "email" }];
    const drafts = await listGroupDrafts(SIB);
    const or = calls.find((call) => call.method === "or");
    expect(or?.args[0]).toBe(`campaign_group_id.eq.${HEAD},id.eq.${HEAD}`);
    expect(calls).toContainEqual({ method: "neq", args: ["id", SIB] });
    expect(drafts).toEqual([{ id: HEAD, channel: "email", isHead: true }]);
  });

  it("a head lead reads its own group; its siblings are not heads", async () => {
    leadRow = { id: HEAD, campaign_group_id: HEAD };
    groupRows = [{ id: SIB, channel: "sms" }];
    const drafts = await listGroupDrafts(HEAD);
    expect(calls.find((call) => call.method === "or")?.args[0]).toBe(`campaign_group_id.eq.${HEAD},id.eq.${HEAD}`);
    expect(drafts).toEqual([{ id: SIB, channel: "sms", isHead: false }]);
  });
});
