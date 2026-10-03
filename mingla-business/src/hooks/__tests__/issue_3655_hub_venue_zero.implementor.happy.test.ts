/**
 * #3655 Story 5 / Decision 9 — no Venues tab at zero; + menu lists Venue.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { deriveHubVisibleTabs } from "../useHubTabs";

describe("#3655 Decision 9 — zero venues", () => {
  test("venueCount === 0 never shows the Venues pill", () => {
    const out = deriveHubVisibleTabs(
      { events: 2, trips: 1, experiences: 1 },
      {
        venueCount: 0,
        hasPhysicalLocation: true,
        hasPlacePool: true,
      },
    );
    expect(out).not.toContain("venue");
  });

  test("venueCount > 0 shows the Venues pill last", () => {
    const out = deriveHubVisibleTabs(
      { events: 1, trips: 0, experiences: 0 },
      { venueCount: 1 },
    );
    expect(out[out.length - 1]).toBe("venue");
  });

  test("+ menu lists Venue with Story 5 helper copy", () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "components",
        "ui",
        "UniversalCreatorSheet.tsx",
      ),
      "utf8",
    );
    expect(src).toContain('key: "venue"');
    expect(src).toContain('title: "Venue"');
    expect(src).toContain(
      'subtitle: "A restaurant, bar or space guests can book"',
    );
    expect(src).toContain('route: "/venue/create"');
  });
});
