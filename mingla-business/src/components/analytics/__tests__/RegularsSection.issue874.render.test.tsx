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
    [0, "0 regulars"],
    [1, "1 regular"],
    [2, "2 regulars"],
  ])("renders %d with the correct noun", async (count, expected) => {
    const screen = await render(<RegularsSection data={dataFor(count)} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
