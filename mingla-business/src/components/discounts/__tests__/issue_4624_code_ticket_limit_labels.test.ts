/**
 * #4624 — ticket-capped codes in the Host list and on Ari's proposal card.
 * FAILS ON REVERT: the list row drops "tickets" ("2 of 5 used"), or the card
 * loses its Total tickets row.
 */
import { describe, expect, test } from "@jest/globals";
import { discountUsageLabel } from "../discountScopeLabels";
import { discountProposalFields } from "../../ari/eventProposalDisplay";

describe("#4624 Total tickets labels", () => {
  test("list row counts tickets for a ticket cap and checkouts otherwise", () => {
    expect(discountUsageLabel(2, 5, true)).toBe("2 of 5 tickets used");
    expect(discountUsageLabel(12, 50, false)).toBe("12 of 50 used");
  });

  test("Ari card shows Total tickets after Total uses", () => {
    const rows = discountProposalFields({
      name: "Talent code",
      kind: "code",
      code: "TOPZY",
      value_bps: 10000,
      max_total_uses: 50,
      ends_after_count: 5,
    });
    const labels = rows.map((row) => row.label);
    expect(rows).toContainEqual({ label: "Total tickets", value: "5" });
    expect(labels.indexOf("Total tickets")).toBe(labels.indexOf("Total uses") + 1);
    expect(
      discountProposalFields({ kind: "code", code: "OPEN" }).some(
        (row) => row.label === "Total tickets",
      ),
    ).toBe(false);
  });
});
