import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = readFileSync(
  join(__dirname, "..", "TicketTierEditSheet.tsx"),
  "utf8",
);

describe("TicketTierEditSheet sale controls", () => {
  test("only renders server-backed controls for a persisted editable paid tier", () => {
    expect(source).toMatch(
      /initial !== null\s*&&\s*privateLinksEnabled\s*&&\s*eventId !== null\s*&&\s*brandId !== undefined\s*&&\s*canEditPrice\s*&&\s*!isFree/,
    );
    expect(source).toContain(
      "<Text style={styles.sectionHeader}>Sale price</Text>",
    );
    expect(source).toContain('itemKind="ticket_type"');
    expect(source).toContain('allowLabel="Allow discounts"');
    expect(source).toContain('saleLabel="Offer a sale price"');
    expect(source).toContain('testID="ticket-tier-discount-controls"');
  });
});
