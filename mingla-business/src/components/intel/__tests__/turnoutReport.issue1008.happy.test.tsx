import React from "react";

import type { TurnoutReport } from "../../../types/growthTools";
import { EventsReportSections } from "../EventsReportSections";

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => unknown };
};

describe("#1008 Business turnout report", () => {
  it("renders the full useful report while excluding funnel offers and ad wording", () => {
    const report: TurnoutReport = {
      forecast: {
        total_low: 24,
        total_high: 36,
        capacity: 40,
        confidence: "medium",
      },
      factors: [
        {
          key: "date",
          label: "Friday evening",
          status: "help",
          detail: "Good timing",
        },
      ],
      competitors: [
        { name: "Nearby opening", platform: "Venue", date_note: "Same night" },
      ],
      comparables: [
        {
          name: "Prior preview",
          city: "Lagos",
          turnout_note: "Reached capacity",
        },
      ],
      weather: {
        kind: "forecast",
        summary: "Clear",
        impact: "Low disruption risk",
      },
      fixes: [
        {
          title: "Share with collectors",
          why: "Strong fit",
          change: "Send the invite",
        },
      ],
      plan: {
        kind: "paid_optimized",
        recommended_budget: 100,
        read: "Promoted discovery can extend reach.",
        scenarios: [
          {
            label: "Focused",
            budget: 100,
            total_attendees: 34,
            pct_capacity: 85,
          },
        ],
      },
      listing_preview: {
        title: "Collector preview",
        tagline: "See new forms first",
      },
      narrative: "A grounded turnout range based on the supplied details.",
      offer: { per_person_from: 3.99 },
      meta: { research_source: "grounded", schema_version: 1 },
    };

    const holder: { instance: { toJSON: () => unknown } | null } = {
      instance: null,
    };
    act(() => {
      holder.instance = create(<EventsReportSections report={report} />);
    });
    const tree = holder.instance?.toJSON() ?? null;
    const rendered = JSON.stringify(tree);
    expect(rendered).toContain('"children":["24","–","36"');
    expect(rendered).toContain('"children":["of ","40"]');
    expect(rendered).toContain("Promo budget plan");
    expect(rendered).not.toContain("3.99");
    expect(rendered).not.toMatch(/\bads?\b/i);
  });
});
