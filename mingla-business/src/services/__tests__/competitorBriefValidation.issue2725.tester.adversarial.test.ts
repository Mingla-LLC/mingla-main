const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import { getCompetitorBrief } from "../competitorIntelligenceService";

const responseEnvelope = {
  schema_version: 2,
  watch_id: "watch-1",
  freshness: "current",
  updated_at: "2026-08-27T12:00:00Z",
  checked_at: "2026-08-27T12:00:00Z",
  next_refresh_at: "2026-09-03T12:00:00Z",
  no_meaningful_change: false,
  manual_refresh_state: "available",
  sources: [],
};

describe("issue #2725 malformed competitor brief responses", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("fails closed before malformed brief collections can reach the renderer", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        ...responseEnvelope,
        brief: {
          status: "current",
          what_changed: null,
          why_it_matters: [],
          worth_doing: [],
          evidence: [],
        },
      },
      error: null,
    });

    await expect(getCompetitorBrief("brand-1", "watch-1")).rejects.toMatchObject({
      code: "server",
      reason: "malformed_brief_response",
    });
  });

  it("maps the report edge's snake-case brief into the renderer's typed shape", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        ...responseEnvelope,
        brief: {
          status: "current",
          what_changed: [{
            id: "fact-1",
            text: "A new menu appeared.",
            source_id: "source-1",
            evidence_id: "evidence-1",
            confidence: "observed",
          }],
          why_it_matters: [{
            text: "Guests may compare the offers.",
            evidence_ids: ["evidence-1"],
            confidence: "interpretation",
          }],
          worth_doing: [{
            id: "action-1",
            text: "Review your weekday offer.",
            kind: "review_offer",
            confidence: "suggested_action",
            is_primary: true,
          }],
          evidence: [{
            id: "evidence-1",
            source_id: "source-1",
            public_url: "https://competitor.example/menu",
            checked_at: "2026-08-27T12:00:00Z",
            observation: "The public menu was checked.",
          }],
        },
      },
      error: null,
    });

    const result = await getCompetitorBrief("brand-1", "watch-1");

    expect(result.brief).toMatchObject({
      status: "current",
      whatChanged: [{ sourceId: "source-1", evidenceId: "evidence-1" }],
      whyItMatters: [{ evidenceIds: ["evidence-1"] }],
      worthDoing: [{ isPrimary: true }],
      evidence: [{
        sourceId: "source-1",
        publicUrl: "https://competitor.example/menu",
        checkedAt: "2026-08-27T12:00:00Z",
      }],
    });
  });
});
