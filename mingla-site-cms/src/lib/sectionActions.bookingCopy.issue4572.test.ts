/*
 * #4572 item 10 — a change that really adds a booking feature is refused
 * with the true sentence, never the SECTION_TYPE_NOT_AVAILABLE copy.
 * FAILS-ON-REVERT: the old mapping refused with SECTION_TYPE_NOT_AVAILABLE.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOOKING_OFF_PROBLEM } from "./sectionActions";

describe("#4572 item 10 — booking refusal copy", () => {
  it("BOOKING_BLOCKS_OFF becomes VALIDATION_FAILED with the plain sentence", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/sectionActions.ts"), "utf8");
    const save = source.slice(source.indexOf('error.message === "BOOKING_BLOCKS_OFF"') - 80, source.indexOf('error.message === "BOOKING_BLOCKS_OFF"') + 220);
    expect(save).toContain('refuse("VALIDATION_FAILED", { problems: [BOOKING_OFF_PROBLEM] });');
    expect(save).not.toContain('refuse("SECTION_TYPE_NOT_AVAILABLE")');
    expect(BOOKING_OFF_PROBLEM).toBe("Booking features aren't switched on for this website yet, so that change wasn't saved.");
    expect(BOOKING_OFF_PROBLEM).not.toContain("doesn't have that kind of section");
  });
});
