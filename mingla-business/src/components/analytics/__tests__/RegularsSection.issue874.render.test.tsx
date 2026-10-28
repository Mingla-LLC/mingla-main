import React from "react";
import { render } from "@testing-library/react-native";
import type { BrandRegularsRollup } from "../../../services/brandAnalyticsService";
import { RegularsSection } from "../RegularsSection";

const dataFor = (regularsCount: number): BrandRegularsRollup => ({
  brandId: "brand-874",
  authorized: true,
  regularsCount,
  topRegulars: [],
});

describe("issue #874 Regulars count copy", () => {
  it.each([
    [1, "1 regular"],
    [2, "2 regulars"],
  ])("renders %d with the correct noun", async (count, expected) => {
    const screen = await render(<RegularsSection data={dataFor(count)} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("hides the section when there are no regulars", async () => {
    const screen = await render(<RegularsSection data={dataFor(0)} />);
    expect(screen.queryByText("Regulars")).toBeNull();
    expect(screen.queryByText("0 regulars")).toBeNull();
  });
});
