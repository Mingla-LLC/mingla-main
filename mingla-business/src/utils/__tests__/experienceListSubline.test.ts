/**
 * META-ORCH-1059 — experienceListSubline regression.
 *
 * The Hub experiences LIST must render a proper date/venue subline (matching the
 * dashboard) computed from the lightweight `when_draft` blob — including for
 * DRAFTS, which have no materialised event_dates. Fails-on-revert: deleting the
 * when_draft → ISO derivation collapses every populated case back to "Draft"/venue.
 */

import { describe, expect, test } from "@jest/globals";

import { experienceListSubline } from "../experienceListSubline";

// 2026-06-03T00:00:00Z reference "now" so future/past assertions are stable.
const NOW = Date.parse("2026-06-03T00:00:00.000Z");

describe("experienceListSubline", () => {
  test("single-date draft → venue · day · time", () => {
    const out = experienceListSubline(
      {
        venueText: "The Roof",
        whenMode: "single",
        whenDraft: {
          whenMode: "single",
          when: { date: "2026-06-14", doorsOpen: "19:00", endsAt: null },
        },
      },
      NOW,
    );
    expect(out).toContain("The Roof");
    expect(out).toMatch(/Jun/);
  });

  test("multi-date → venue · N dates · Next: <day>", () => {
    const out = experienceListSubline(
      {
        venueText: "Studio 9",
        whenMode: "multi_date",
        whenDraft: {
          whenMode: "multi_date",
          multiDates: [
            { date: "2026-06-14", startTime: "18:00", endTime: "20:00" },
            { date: "2026-06-21", startTime: "18:00", endTime: "20:00" },
          ],
        },
      },
      NOW,
    );
    expect(out).toContain("Studio 9");
    expect(out).toContain("2 dates");
    expect(out).toContain("Next:");
  });

  test("recurring → venue · <recurrence label> · Next: <day>", () => {
    const out = experienceListSubline(
      {
        venueText: "The Cellar",
        whenMode: "recurring",
        whenDraft: {
          whenMode: "recurring",
          when: { date: "2026-06-05", doorsOpen: "20:00", endsAt: null },
          recurrence_rules: [{ preset: "weekly" }],
        },
      },
      NOW,
    );
    expect(out).toContain("The Cellar");
    expect(out).toContain("Next:");
  });

  test("no when_draft → bare venue (or 'Draft' when no venue)", () => {
    expect(
      experienceListSubline(
        { venueText: "Pop-up Bar", whenMode: "single", whenDraft: null },
        NOW,
      ),
    ).toBe("Pop-up Bar");
    expect(
      experienceListSubline(
        { venueText: null, whenMode: "single", whenDraft: null },
        NOW,
      ),
    ).toBe("Draft");
  });

  test("all dates in the past → venue · Ended", () => {
    const out = experienceListSubline(
      {
        venueText: "Old Hall",
        whenMode: "single",
        whenDraft: {
          whenMode: "single",
          when: { date: "2025-01-01", doorsOpen: "19:00", endsAt: null },
        },
      },
      NOW,
    );
    expect(out).toContain("Old Hall");
    expect(out).toContain("Ended");
  });
});
