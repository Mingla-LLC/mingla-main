import {
  discountProposalFields,
  formatEventProposalWhen,
} from "../eventProposalDisplay";

describe("#3355 event proposal date display", () => {
  test("shows full year, event timezone, and the supplied end time", () => {
    expect(
      formatEventProposalWhen(
        "2026-11-15T17:00:00.000Z",
        "2026-11-15T22:00:00.000Z",
        "Africa/Lagos",
      ),
    ).toBe("Sun, Nov 15, 2026, 6:00 PM WAT – 11:00 PM WAT");
  });

  test("includes the year when no end time was provided", () => {
    expect(
      formatEventProposalWhen(
        "2026-11-15T17:00:00.000Z",
        null,
        "Africa/Lagos",
      ),
    ).toBe("Sun, Nov 15, 2026, 6:00 PM WAT");
  });

  test("fails closed on invalid start dates", () => {
    expect(formatEventProposalWhen("not-a-date", null, "Africa/Lagos"))
      .toBeNull();
  });
});

// #3355 final fix (P3): the discount card's Type row is sentence case
// ("Type: Code"), like every other value on the card.
describe("#3355 discount card Type row", () => {
  test("shows the kind in sentence case", () => {
    const type = (kind: string) =>
      discountProposalFields({ kind, code: "FAVY10" }).find((row) =>
        row.label === "Type"
      )?.value;
    expect(type("code")).toBe("Code");
    expect(type("automatic_discount")).toBe("Automatic discount");
  });
});
