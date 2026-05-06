import { describe, expect, it } from "vitest";
import { formatMoneyMajor } from "./currency";

describe("formatMoneyMajor", () => {
  it("formats GBP", () => {
    expect(formatMoneyMajor(156.2, "GBP")).toMatch(/156/);
  });

  it("formats USD", () => {
    expect(formatMoneyMajor(10.5, "USD")).toMatch(/10/);
  });
});
