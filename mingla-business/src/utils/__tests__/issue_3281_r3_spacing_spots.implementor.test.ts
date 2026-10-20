/**
 * issue #3281 Round 3 — Host booking-settings helpers + wiring pins.
 */

import fs from "node:fs";
import path from "node:path";

import {
  EXPERIENCE_MIN_NOTICE_OPTIONS,
  EXPERIENCE_SPACING_OPTIONS,
  experienceMinNoticeLabel,
  experienceSpacingLabel,
  normalizeExperienceMinNotice,
  normalizeExperienceSpacing,
  normalizeStopStartOffset,
} from "../experienceBookingSettings";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(root, rel), "utf8");

describe("issue #3281 R3 — experience booking settings", () => {
  it("offers spacing 15/30/60/120 and falls back to 30", () => {
    expect([...EXPERIENCE_SPACING_OPTIONS]).toEqual([15, 30, 60, 120]);
    expect(normalizeExperienceSpacing(45)).toBe(30);
    expect(normalizeExperienceSpacing(undefined)).toBe(30);
    expect(normalizeExperienceSpacing(120)).toBe(120);
  });

  it("clamps min notice to 0..10080 with a 120 default", () => {
    expect(normalizeExperienceMinNotice(0)).toBe(0);
    expect(normalizeExperienceMinNotice(-1)).toBe(120);
    expect(normalizeExperienceMinNotice(20000)).toBe(120);
    expect(normalizeExperienceMinNotice("x")).toBe(120);
    expect(EXPERIENCE_MIN_NOTICE_OPTIONS).toContain(120);
  });

  it("labels spacing and notice in plain English", () => {
    expect(experienceSpacingLabel(15)).toBe("15 min");
    expect(experienceSpacingLabel(60)).toBe("1 hour");
    expect(experienceSpacingLabel(120)).toBe("2 hours");
    expect(experienceMinNoticeLabel(0)).toBe("None");
    expect(experienceMinNoticeLabel(1440)).toBe("1 day");
    expect(experienceMinNoticeLabel(240)).toBe("4 hours");
  });

  it("normalizes stop offsets", () => {
    expect(normalizeStopStartOffset(45)).toBe(45);
    expect(normalizeStopStartOffset(-1)).toBeNull();
    expect(normalizeStopStartOffset(null)).toBeNull();
    expect(normalizeStopStartOffset(Number.NaN)).toBeNull();
  });

  it("wires the When step, wizard payload and reserve picker", () => {
    const when = read("src/components/event/CreatorStep2When.tsx");
    expect(when).toContain("experienceBooking");
    expect(when).toContain("creator-when-spacing");
    const wizard = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(wizard).toContain("booking_spacing_minutes");
    expect(wizard).toContain("min_notice_minutes");
    expect(wizard).toContain("start_offset_minutes");
    const picker = read("src/components/experience/ExperienceReservePicker.tsx");
    expect(picker).toContain("spacingMinutes");
    expect(picker).toContain("minNoticeMinutes");
  });
});
