import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import "./TicketTierEditSheet.issue3872.salePrice.behavior.test";

const source = readFileSync(
  join(__dirname, "..", "TicketTierEditSheet.tsx"),
  "utf8",
);

describe("TicketTierEditSheet sale controls", () => {
  test("only renders server-backed controls for a persisted editable paid tier", () => {
    expect(source).toContain("canShowTicketTierDiscountControls({");
    expect(source).toContain("hasPersistedTier: initial !== null");
    expect(source).toContain("privateLinksEnabled");
    expect(source).toContain("hasEventId: eventId !== null");
    expect(source).toContain("hasBrandId: brandId !== undefined");
    expect(source).toContain("canEditPrice");
    expect(source).toContain("isFree");
    expect(source).toContain(
      "<Text style={styles.sectionHeader}>Sale price</Text>",
    );
    expect(source).toContain('itemKind="ticket_type"');
    expect(source).toContain('allowLabel="Allow discounts"');
    expect(source).toContain('saleLabel="Offer a sale price"');
    expect(source).toContain('testID="ticket-tier-discount-controls"');
  });
});
