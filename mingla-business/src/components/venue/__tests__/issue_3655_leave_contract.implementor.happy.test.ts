/**
 * #3655 Story 1 — leave-guard copy helpers (implementor happy path).
 */

import {
  formatLeaveChangedBody,
  formatUnsavedCaption,
  sectionLabelForModule,
} from "../venueLeaveContract";

describe("#3655 leave contract helpers", () => {
  test("formats one, two, and N+ changed fields for the leave body", () => {
    expect(formatLeaveChangedBody([])).toContain("without saving");
    expect(formatLeaveChangedBody(["Phone"])).toBe(
      "You changed Phone. If you leave without saving, those changes are gone.",
    );
    expect(formatLeaveChangedBody(["Phone", "Saturday hours"])).toBe(
      "You changed Phone and Saturday hours. If you leave without saving, those changes are gone.",
    );
    expect(
      formatLeaveChangedBody(["Phone", "Saturday hours", "Fee", "Name"]),
    ).toBe(
      "You changed Phone, Saturday hours and 2 more. If you leave without saving, those changes are gone.",
    );
  });

  test("formats unsaved captions with +N more grammar", () => {
    expect(formatUnsavedCaption([])).toBe("No changes yet");
    expect(formatUnsavedCaption(["Phone"])).toBe("1 unsaved change · Phone");
    expect(formatUnsavedCaption(["Phone", "Fee"])).toBe(
      "2 unsaved changes · Phone, Fee",
    );
    expect(formatUnsavedCaption(["a", "b", "c"])).toBe(
      "3 unsaved changes · a, b +1 more",
    );
  });

  test("maps every suite module id to a section label", () => {
    for (const id of [
      "overview",
      "tables",
      "availability",
      "reservations",
      "waitlist",
      "menu",
      "insights",
      "orders",
      "settings",
    ] as const) {
      expect(sectionLabelForModule(id).length).toBeGreaterThan(0);
    }
    expect(sectionLabelForModule("settings")).toBe("Settings");
  });
});
