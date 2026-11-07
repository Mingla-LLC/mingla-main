/**
 * #4273 polish — T-23 and extra (b).
 *
 * Follow-up 1: deleteDraft / updateDraft with expectedUpdatedAt put the version
 * check inside the server's own WHERE (atomic), and a zero-row answer is a
 * DraftChangedElsewhereError, never the generic "not found".
 * Extra (b): Delete on a failed or cancelled campaign deletes it (deleteDraft
 * only ever deleted drafts, so the button always failed); a confirmed send
 * the database keeps on record reads in plain words.
 */
const calls: Array<{ method: string; args: unknown[] }> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock("../../supabase", () => {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
    for (const method of ["select", "eq", "in", "update", "delete"]) chain[method] = record(method);
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  };
  return { supabase: { from: () => builder() } };
});

import {
  DraftChangedElsewhereError,
  deleteDraft,
  updateDraft,
} from "../marketingCampaignService";
import { CampaignKeptForRecordsError, deleteCampaign } from "../campaignDeleteService";

const ID = "42730000-0000-4000-8000-0000000000c9";
const T0 = "2026-11-07T10:00:00.123456+00:00";

describe("#4273 T-23 a draft is changed or dropped only as this composer saw it", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("deleteDraft with expectedUpdatedAt filters on it in the DELETE itself", async () => {
    result = { data: [{ id: ID }], error: null };
    await deleteDraft(ID, { expectedUpdatedAt: T0 });
    expect(calls).toContainEqual({ method: "delete", args: [] });
    expect(calls).toContainEqual({ method: "eq", args: ["status", "draft"] });
    expect(calls).toContainEqual({ method: "eq", args: ["updated_at", T0] });
  });

  it("zero rows with expectedUpdatedAt is DraftChangedElsewhereError", async () => {
    result = { data: [], error: null };
    await expect(deleteDraft(ID, { expectedUpdatedAt: T0 })).rejects.toBeInstanceOf(DraftChangedElsewhereError);
  });

  it("without it, deleteDraft keeps today's behaviour and message", async () => {
    result = { data: [], error: null };
    await expect(deleteDraft(ID)).rejects.toThrow("Draft not found, already sent, or not eligible for deletion");
    expect(calls.some((call) => call.args[0] === "updated_at")).toBe(false);
  });

  it("updateDraft with expectedUpdatedAt filters on it, and a miss is DraftChangedElsewhereError", async () => {
    result = { data: null, error: null };
    await expect(
      updateDraft({ campaign_id: ID, name: "x", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(DraftChangedElsewhereError);
    expect(calls).toContainEqual({ method: "eq", args: ["updated_at", T0] });
  });
});

describe("#4273 extra (b) Delete on a failed campaign works", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("deletes only a failed or cancelled campaign", async () => {
    result = { data: [{ id: ID }], error: null };
    await deleteCampaign(ID);
    expect(calls).toContainEqual({ method: "delete", args: [] });
    expect(calls).toContainEqual({ method: "in", args: ["status", ["failed", "cancelled"]] });
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "status")).toBe(false);
  });

  it("the server's kept-on-record refusal reads in plain words", async () => {
    result = { data: null, error: { code: "42501", message: "campaign_kept_for_records" } };
    await expect(deleteCampaign(ID)).rejects.toBeInstanceOf(CampaignKeptForRecordsError);
  });

  it("a confirmed send the database keeps on record reads in plain words", async () => {
    result = { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
    await expect(deleteCampaign(ID)).rejects.toBeInstanceOf(CampaignKeptForRecordsError);
    await expect(deleteCampaign(ID)).rejects.toThrow(
      "Mingla keeps this send on record because it reached people. You can still send by this method again.",
    );
  });

  it("anything else that is not failed or cancelled is refused", async () => {
    result = { data: [], error: null };
    await expect(deleteCampaign(ID)).rejects.toThrow("Only a failed or cancelled send can.");
  });

  it("the campaign list deletes through deleteCampaign, not deleteDraft", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const list: string = readFileSync(
      path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/index.tsx"),
      "utf8",
    );
    expect(list).toContain("await deleteCampaign(id)");
    expect(list).toContain("<ConfirmDialog");
    expect(list).not.toContain("deleteDraft");
  });
});
