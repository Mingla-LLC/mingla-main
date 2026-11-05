/**
 * issue #3281 — the door is told each extra still owed, and an extra for
 * other days says so when the scan knows the day it admitted.
 */
import { describe, expect, test } from "@jest/globals";

import { doorExtrasLine, readDoorExtras } from "../doorExtras";

const FRI = "11111111-1111-4111-8111-111111111111";
const SAT = "22222222-2222-4222-8222-222222222222";

describe("#3281 door extras", () => {
  test("names each extra and its count", () => {
    const extras = readDoorExtras([
      { name: "Friday dinner", quantity: 2, eventDateIds: [FRI] },
      { name: "Tote bag", quantity: 1, eventDateIds: null },
    ]);
    expect(doorExtrasLine(extras)).toBe("Extras: Friday dinner × 2 · Tote bag × 1");
  });

  test("an extra for other days says so on the day admitted", () => {
    const extras = readDoorExtras([
      { name: "Friday dinner", quantity: 2, eventDateIds: [FRI] },
      { name: "Tote bag", quantity: 1, eventDateIds: null },
    ]);
    expect(doorExtrasLine(extras, SAT)).toBe(
      "Extras: Friday dinner × 2 (another day) · Tote bag × 1",
    );
    expect(doorExtrasLine(extras, FRI)).toBe("Extras: Friday dinner × 2 · Tote bag × 1");
  });

  test("no extras, or a malformed answer, adds no line", () => {
    expect(doorExtrasLine(readDoorExtras(undefined))).toBeNull();
    expect(
      doorExtrasLine(readDoorExtras([{ name: "x", quantity: 0 }, "bad", { quantity: 2 }])),
    ).toBeNull();
  });
});
