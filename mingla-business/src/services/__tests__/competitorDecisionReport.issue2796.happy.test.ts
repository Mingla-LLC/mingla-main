import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCompetitorDecisionView } from "../../components/venue/insights/competitorDecisionReport";

describe("issue 2796 negotiated decision report client", () => {
  const source = readFileSync(resolve(__dirname, "../competitorIntelligenceService.ts"), "utf8");
  it("requests v3 and fails closed on exact provenance relations", () => {
    for (const expected of [
      "max_schema_version: 3",
      "authorizedEvidence",
      "comparisonIds",
      "ownerFactDimension",
      "signalDimension",
      "actionIds",
      "malformed_brief_response",
    ]) expect(source).toContain(expected);
  });
  it("keeps exact v2 downgrade free of decision_report", () => {
    expect(source).toContain('if (Object.prototype.hasOwnProperty.call(body, "decision_report"))');
    expect(source).toContain("schemaVersion: 2");
    expect(source).toContain("schemaVersion: 3");
  });
  it("maps one primary, fixed-horizon secondary and collapses not-comparable rows", () => {
    const view = buildCompetitorDecisionView({
      schemaVersion: 3, watchId: "w1", freshness: "current", updatedAt: null,
      checkedAt: "2026-08-29T00:00:00Z", nextRefreshAt: null,
      noMeaningfulChange: false, manualRefreshState: "available", sources: [],
      brief: {
        status: "current",
        whatChanged: [{ id: "f1", text: "Observed offer", sourceId: "s1", evidenceId: "e1", confidence: "observed" }],
        whyItMatters: [{ text: "A threat to watch", evidenceIds: ["e1"], confidence: "interpretation" }],
        worthDoing: [
          { id: "a1", text: "Publish this week", kind: "event", confidence: "suggested_action", isPrimary: true },
          { id: "a2", text: "Review next month", kind: "review", confidence: "suggested_action", isPrimary: false },
        ],
        evidence: [{ id: "e1", sourceId: "s1", publicUrl: "https://example.com", checkedAt: "2026-08-29T00:00:00Z", observation: "Observed offer" }],
      },
      decisionReport: {
        decision: { class: "act", confidence: "medium", headline: "Offer is active", rationale: "Respond carefully", signalIds: ["sig1"], ownerFactIds: ["o1"] },
        signals: [{ id: "sig1", kind: "website", derivation: "deterministic", dimension: "positioning", label: "Offer", summary: "Observed offer", sourceId: "s1", evidenceIds: ["se1"], metrics: { posts7d: null, posts28d: null, images28d: null, videos28d: null }, changedPaths: [] }],
        signalEvidence: [{ id: "se1", sourceId: "s1", sourceUrl: "https://example.com", observation: "Observed offer", checkedAt: "2026-08-29T00:00:00Z", observedAt: null }],
        interpretationMeta: [{ index: 0, signalType: "threat", confidence: "medium", priority: "high", signalIds: ["sig1"], ownerFactIds: ["o1"] }],
        comparisons: [{ id: "c1", dimension: "positioning", ownerText: "No match", competitorText: "Offer", outcome: "not_comparable", confidence: "low", signalIds: ["sig1"], ownerFactIds: [] }],
        actionPlan: [
          { index: 0, actionId: "a1", timeframe: "this_week", impact: "high", confidence: "medium", order: 1, isPrimary: true, signalIds: ["sig1"], ownerFactIds: ["o1"] },
          { index: 1, actionId: "a2", timeframe: "this_month", impact: "medium", confidence: "low", order: 2, isPrimary: false, signalIds: ["sig1"], ownerFactIds: [] },
        ],
        ownerFacts: [{ id: "o1", kind: "listing_category", entityId: "v1", dimension: "category", text: "restaurant" }],
      },
    });
    expect(view?.comparisons).toEqual([]);
    expect(view?.actions.map((item) => [item.primary, item.timeframe])).toEqual([[true, "this_week"], [false, "this_month"]]);
  });
});
