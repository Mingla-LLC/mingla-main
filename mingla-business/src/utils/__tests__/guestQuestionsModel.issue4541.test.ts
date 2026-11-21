/**
 * #4541 T-37 (R1.2, SC-3 copy) — hosts see what "required" really means, the
 * RSVP and trip wording for "after", and how many guests were never asked.
 *
 * FAILS-ON-REVERT: restoring "Guests must answer before they finish." or the
 * old "right after." line, dropping the RSVP line, dropping the "not asked
 * yet" half of the tile line, or bringing back a second copy of the mode lines
 * in brandFormsCopy.ts turns a named case RED.
 */

import fs from "node:fs";
import path from "node:path";

import {
  GUEST_QUESTION_MODES as FROM_COPY_FILE,
  modeLabel as modeLabelFromCopy,
} from "../../components/forms/brandFormsCopy";
import {
  GUEST_QUESTION_MODES,
  modeLabel,
  modeLine,
  modeRows,
  tileLine,
  tileState,
} from "../guestQuestionsModel";

const lineOf = (kind: "event" | "experience" | "trip" | "rsvp", value: string): string | undefined =>
  modeRows(kind).find((r) => r.value === value)?.line;

describe("#4541 R1.2 the attach sheet's four exact lines", () => {
  it("optional, required, after purchase (events, experiences, trips) and after RSVP", () => {
    expect(lineOf("event", "optional_on_page")).toBe("Guests can answer if they want.");
    expect(lineOf("event", "required_step")).toBe(
      "Guests answer before they finish. Anyone booking from an older app version is asked afterwards.",
    );
    for (const kind of ["event", "experience", "trip"] as const) {
      expect(lineOf(kind, "after_purchase")).toBe("Guests are taken to the form right after they buy.");
    }
    expect(lineOf("rsvp", "after_purchase")).toBe("Guests are taken to the form right after they RSVP.");
    expect(modeLabel("after_purchase", true)).toBe("After they RSVP");
    expect(modeLine("after_purchase", true)).toBe("Guests are taken to the form right after they RSVP.");
  });

  it("never promises every guest must answer", () => {
    for (const kind of ["event", "experience", "trip", "rsvp"] as const) {
      for (const row of modeRows(kind)) expect(row.line).not.toMatch(/must answer/i);
    }
  });

  it("one copy file: brandFormsCopy re-exports the model's lines and repeats none", () => {
    expect(FROM_COPY_FILE).toBe(GUEST_QUESTION_MODES);
    expect(modeLabelFromCopy).toBe(modeLabel);
    const copySrc = fs.readFileSync(path.resolve(__dirname, "../../components/forms/brandFormsCopy.ts"), "utf8");
    expect(copySrc).not.toMatch(/Guests are taken to the form right after/);
    expect(copySrc).not.toMatch(/Guests can answer if they want/);
  });
});

describe("#4541 R1.2 the tile's not-asked count", () => {
  const base = { formName: "Guest details", formStatus: "live" as const, mode: "required_step" as const, published: true, answered: 1 };

  it("3 current holders, 1 answered, 1 of the other 2 asked: '2 to answer · 1 not asked yet'", () => {
    const state = tileState({ isError: false, data: { ...base, notAnswered: 2, notAsked: 1 } });
    expect(tileLine(state)).toBe("2 to answer · 1 not asked yet");
  });

  it("no not-asked part when everyone was asked, or when an older server sends no count", () => {
    expect(tileLine(tileState({ isError: false, data: { ...base, notAnswered: 2, notAsked: 0 } }))).toBe("2 to answer");
    expect(tileLine(tileState({ isError: false, data: { ...base, notAnswered: 2 } }))).toBe("2 to answer");
  });
});
