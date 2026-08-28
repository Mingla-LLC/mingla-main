const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import { getCompetitorBrief } from "../growthToolsService";

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
});
