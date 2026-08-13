import { TurnoutRunBudget } from "../../utils/turnoutInput";

describe("#1008 turnout metering budget", () => {
  it("spends exactly one automatic run across repeated effects, step hops, and input edits", () => {
    const budget = new TurnoutRunBudget();
    expect(Array.from({ length: 10 }, () => budget.spendAuto())).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("spends one Preview refresh per distinct full input key", () => {
    const budget = new TurnoutRunBudget();
    expect(budget.spendPreview("key-a")).toBe(true);
    expect(budget.spendPreview("key-a")).toBe(false);
    expect(budget.spendPreview("key-b")).toBe(true);
    expect(budget.spendPreview("key-a")).toBe(false);
  });
});
