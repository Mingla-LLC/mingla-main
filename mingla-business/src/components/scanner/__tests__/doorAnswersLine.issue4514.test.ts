/**
 * #4514 wave 6 — the ticket scan card's door line (decisions 8, 14, 15, 16).
 * Guards I-4514-DOOR-LINE-CAPS (src/components/scanner/doorAnswersLine.ts).
 */
import {
  DOOR_LINE_COPY,
  DOOR_LINE_MAX_ITEMS,
  DOOR_LINE_MAX_VALUE,
  doorLineFromScan,
} from "../doorAnswersLine";

const item = (label: string, value: string) => ({ label, value });

describe("#4514 door line on the ticket scan card", () => {
  it("shows the marked answers as 'label: value · label: value'", () => {
    const line = doorLineFromScan({
      state: "answered",
      formName: "Performers",
      fullAnswers: true,
      items: [item("Performing", "Yes"), item("Group", "4")],
    });
    expect(line).toEqual({ tone: "answered", header: null, text: "Performing: Yes · Group: 4", canOpenAll: true });
  });

  it("shows at most 3 door answers (decision 16)", () => {
    const line = doorLineFromScan({
      state: "answered",
      items: [item("A", "1"), item("B", "2"), item("C", "3"), item("D", "4"), item("E", "5")],
    });
    expect(DOOR_LINE_MAX_ITEMS).toBe(3);
    expect(line?.text).toBe("A: 1 · B: 2 · C: 3");
  });

  it("cuts each answer to 60 characters with an ellipsis (decision 16)", () => {
    const line = doorLineFromScan({ state: "answered", items: [item("Notes", "x".repeat(200))] });
    const value = (line?.text ?? "").replace("Notes: ", "");
    expect(DOOR_LINE_MAX_VALUE).toBe(60);
    expect(value).toHaveLength(60);
    expect(value.endsWith("…")).toBe(true);
    expect(doorLineFromScan({ state: "answered", items: [item("Notes", "y".repeat(60))] })?.text).toBe(`Notes: ${"y".repeat(60)}`);
  });

  it("heads another ticket of the order with the buyer's name (decision 15)", () => {
    const line = doorLineFromScan({ state: "answered", fromOrderOf: "Quinn B.", items: [item("Performing", "Yes")] });
    expect(line?.header).toBe("From Quinn B.'s order");
  });

  it("an unanswered form is a line on an admitted guest, never a refusal (decisions 8 and 14)", () => {
    expect(doorLineFromScan({ state: "not_answered", formName: "Performers" })).toEqual({
      tone: "not_answered",
      header: null,
      text: DOOR_LINE_COPY.notAnswered,
      canOpenAll: false,
    });
  });

  it("a failed read is a quiet 'Answers unavailable'", () => {
    expect(doorLineFromScan({ state: "unavailable" })?.text).toBe("Answers unavailable");
  });

  it("the host switch off: no 'See all answers'", () => {
    expect(doorLineFromScan({ state: "answered", fullAnswers: false, items: [item("A", "1")] })?.canOpenAll).toBe(false);
    expect(doorLineFromScan({ state: "answered", items: [item("A", "1")] })?.canOpenAll).toBe(false);
  });

  it("no door answers, or a malformed one, leaves the card as it was", () => {
    for (const v of [undefined, null, "x", [], {}, { state: "answered", items: [] }, { state: "answered", items: [{ label: 1 }] }]) {
      expect(doorLineFromScan(v)).toBeNull();
    }
  });
});
