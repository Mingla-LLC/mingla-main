/**
 * issue #1027 — Thread B (business web date/time) · adversarial STRUCTURAL guard
 * (the fails-on-revert lock for the whole umbrella) + native-parity check (T3).
 *
 * The web date/time bug class spread because each surface hand-rolled its own
 * web branch. This suite enforces I-PROPOSED-1027-WEB-NATIVE-DATE-INPUT across
 * EVERY fixed surface, so a divergent branch cannot reappear:
 *
 *   - The ONE shared control (`ui/WebDateTimeInput`) renders a REAL, visible
 *     <input> — never a hidden (opacity:0 / pointer-events:none) one.
 *   - Class 1 (event/RSVP When + per-date override): NO `showPicker`, NO
 *     `HIDDEN_WEB_INPUT_STYLE`, NO `pointerEvents:"none"`; each uses the shared
 *     WebDateTimeInput; the native DateTimePicker Sheet/dialog stays gated to
 *     iOS/Android (T3 parity — native path untouched).
 *   - Class 2 (buyer checkout date, trip installment date, trip booking
 *     deadline, marketing scheduler): each renders WebDateTimeInput on
 *     `Platform.OS === "web"` and NEVER renders @react-native-community/
 *     datetimepicker on web (it has no web build).
 *
 * FAILS-ON-REVERT: restoring the hidden-input + showPicker bridge, or dropping a
 * surface back to a web-unguarded native DateTimePicker, makes a named assertion
 * RED. Comment lines are stripped first so the historical "opacity:0/showPicker"
 * descriptions in the fix's own docblocks cannot mask a real regression.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

/** Strip block + line comments (keeps `://` in URLs). */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sharedRaw = read("../../ui/WebDateTimeInput.tsx");
const shared = strip(sharedRaw);
const when = strip(read("../CreatorStep2When.tsx"));
const override = strip(read("../MultiDateOverrideSheet.tsx"));
const intake = strip(read("../../checkout/intake/IntakeQuestionRenderers.tsx"));
const payplan = strip(read("../../trip/PaymentPlanEditor.tsx"));
const deadline = strip(read("../../trip/BookingDeadlinePicker.tsx"));
const composer = strip(read("../../marketing/ComposerStepWhen.tsx"));

const HIDDEN_INPUT_STYLE = /pointerEvents\s*:\s*["']none["']/;
const OPACITY_ZERO = /opacity\s*:\s*0\b/;

describe("issue #1027 Thread B — the shared visible web date/time control", () => {
  test("WebDateTimeInput renders a real, visible native <input> (no hidden bridge)", () => {
    expect(shared).toContain("<input");
    expect(shared).toContain("onChangeValue");
    // Dark native popup + indicator; the marker distinguishes the new mechanism.
    expect(shared).toContain("colorScheme");
    expect(shared).toContain("WEB_DATETIME_INPUT_TESTID");
    // It is NOT hidden and does NOT drive an imperative browser picker.
    expect(shared).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(shared).not.toMatch(OPACITY_ZERO);
    expect(shared).not.toContain("showPicker");
  });
});

describe("issue #1027 Thread B — Class 1: event/RSVP When + per-date override", () => {
  test("CreatorStep2When: hidden-input + showPicker bridge is GONE; visible WebDateTimeInput is used", () => {
    expect(when).not.toContain("showPicker");
    expect(when).not.toContain("HIDDEN_WEB_INPUT_STYLE");
    expect(when).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(when).toContain("WebDateTimeInput");
    expect(when).toContain('type="date"');
    expect(when).toContain('type="time"');
  });

  test("CreatorStep2When: native DateTimePicker Sheet/dialog stays gated to iOS/Android (T3 parity)", () => {
    expect(when).toContain("DateTimePicker");
    expect(when).toContain('Platform.OS === "ios"');
    expect(when).toContain('Platform.OS === "android"');
  });

  test("MultiDateOverrideSheet: hidden-input + showPicker bridge is GONE; visible WebDateTimeInput is used; native intact", () => {
    expect(override).not.toContain("showPicker");
    expect(override).not.toContain("HIDDEN_WEB_INPUT_STYLE");
    expect(override).not.toMatch(HIDDEN_INPUT_STYLE);
    expect(override).toContain("WebDateTimeInput");
    expect(override).toContain('type="time"');
    expect(override).toContain("DateTimePicker");
    expect(override).toContain('Platform.OS === "ios"');
    expect(override).toContain('Platform.OS === "android"');
  });
});

describe("issue #1027 Thread B — Class 2: web-broken native pickers now render a web input", () => {
  test("Checkout intake date question (buyer web): WebDateTimeInput on web; DateTimePicker gated to iOS/Android", () => {
    expect(intake).toContain("WebDateTimeInput");
    expect(intake).toContain('Platform.OS === "web"');
    expect(intake).toContain('type="date"');
    expect(intake).toContain('Platform.OS === "ios"');
    expect(intake).toContain('Platform.OS === "android"');
  });

  test("Trip installment fixed due date: WebDateTimeInput on web; DateTimePicker gated off web", () => {
    expect(payplan).toContain("WebDateTimeInput");
    expect(payplan).toContain('Platform.OS === "web"');
    expect(payplan).toContain('type="date"');
    expect(payplan).toContain('Platform.OS !== "web"');
  });

  test("Trip booking deadline: WebDateTimeInput datetime-local on web; DateTimePicker gated off web", () => {
    expect(deadline).toContain("WebDateTimeInput");
    expect(deadline).toContain('Platform.OS === "web"');
    expect(deadline).toContain('type="datetime-local"');
    expect(deadline).toContain('Platform.OS !== "web"');
  });

  test("Marketing scheduler (ComposerStepWhen): WebDateTimeInput date + time on web", () => {
    expect(composer).toContain("WebDateTimeInput");
    expect(composer).toContain('Platform.OS === "web"');
    expect(composer).toContain('type="date"');
    expect(composer).toContain('type="time"');
  });
});
