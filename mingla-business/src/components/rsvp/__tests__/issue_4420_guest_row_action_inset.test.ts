/**
 * #4420 journey (iOS) — on the RSVP Guests list the "Remove" pill sat flush
 * against the card's right edge; the card clips (overflow hidden), so the
 * pill read as cut off. The trailing action cluster now keeps a space-scale
 * inset from the card edge.
 *
 * FAILS ON REVERT: the trailing cluster loses its right / vertical inset.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const src = readFileSync(join(__dirname, "../RsvpGuestConsole.tsx"), "utf8");

describe("#4420 journey — guest row actions keep breathing room", () => {
  test("the trailing action cluster is inset from the card edge with space tokens", () => {
    const start = src.indexOf("  refundTrailing: {");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("}", start) + 1);
    expect(block).toMatch(/paddingRight: space\[3\]/);
    expect(block).toMatch(/paddingVertical: space\[2\]/);
  });

  test("the card still clips its contents, which is why the inset matters", () => {
    const start = src.indexOf("  guestRow: {");
    const block = src.slice(start, src.indexOf("}", start) + 1);
    expect(block).toMatch(/overflow: "hidden"/);
  });
});
