const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import { getCompetitorBrief } from "../competitorIntelligenceService";

const valid = {
  schema_version: 2,
  watch_id: "watch-1",
  freshness: "current",
  updated_at: "2026-08-27T12:00:00Z",
  checked_at: "2026-08-27T12:00:00Z",
  next_refresh_at: "2026-09-03T12:00:00Z",
  no_meaningful_change: false,
  manual_refresh_state: "available",
  sources: [{
    id: "source-1",
    kind: "website",
    url: "https://competitor.example/menu",
    capability: "analyzed_weekly",
    availability: "enabled",
    availability_generation: 1,
    health: "current",
    last_checked_at: "2026-08-27T12:00:00Z",
    safe_reason: null,
  }],
  brief: {
    status: "current",
    what_changed: [{ id: "fact-1", text: "A menu changed.", source_id: "source-1", evidence_id: "evidence-1", confidence: "observed" }],
    why_it_matters: [{ text: "Guests may compare it.", evidence_ids: ["evidence-1"], confidence: "interpretation" }],
    worth_doing: [{ id: "action-1", text: "Review the offer.", kind: "review_offer", confidence: "suggested_action", is_primary: true }],
    evidence: [{ id: "evidence-1", source_id: "source-1", public_url: "https://competitor.example/menu", checked_at: "2026-08-27T12:00:00Z", observation: "The public menu was checked." }],
  },
};

describe("issue #2725 complete competitor brief validation", () => {
  beforeEach(() => mockInvoke.mockReset());

  it.each([
    ["unknown freshness", { ...valid, freshness: "fresh-ish" }],
    ["invalid envelope timestamp", { ...valid, checked_at: "not-a-date" }],
    ["invalid source enum", { ...valid, sources: [{ ...valid.sources[0], health: "maybe" }] }],
    ["invalid brief status", { ...valid, brief: { ...valid.brief, status: "ready" } }],
    ["broken evidence link", { ...valid, brief: { ...valid.brief, what_changed: [{ ...valid.brief.what_changed[0], evidence_id: "missing" }] } }],
    ["invalid evidence timestamp", { ...valid, brief: { ...valid.brief, evidence: [{ ...valid.brief.evidence[0], checked_at: "soon" }] } }],
  ])("fails closed for %s", async (_label, data) => {
    mockInvoke.mockResolvedValue({ data, error: null });
    await expect(getCompetitorBrief("brand-1", "watch-1")).rejects.toMatchObject({
      code: "server",
      reason: "malformed_brief_response",
    });
  });
});
