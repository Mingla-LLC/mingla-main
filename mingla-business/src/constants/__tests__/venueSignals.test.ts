/**
 * ORCH-1040 — shared venue signals constant + label helper.
 */
import { describe, expect, test } from "@jest/globals";

import { VENUE_SIGNALS, venueSignalLabel } from "../venueSignals";

describe("venueSignals", () => {
  test("known ids map to friendly labels", () => {
    expect(venueSignalLabel("romantic")).toBe("Romantic");
    expect(venueSignalLabel("casual_food")).toBe("Casual food");
    expect(venueSignalLabel("nature")).toBe("Nature & outdoors");
  });

  test("unknown id falls back to title-cased words", () => {
    expect(venueSignalLabel("late_night_dancing")).toBe("Late Night Dancing");
    expect(venueSignalLabel("solo")).toBe("Solo");
  });

  test("VENUE_SIGNALS ids are unique and non-empty", () => {
    const ids = VENUE_SIGNALS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(VENUE_SIGNALS.every((s) => s.label.length > 0)).toBe(true);
  });
});
