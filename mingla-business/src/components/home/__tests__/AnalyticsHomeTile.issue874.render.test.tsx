import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { AnalyticsHomeTile } from "../AnalyticsHomeTile";

jest.mock("../../ui/Skeleton", () => {
  const ReactModule = require("react") as typeof React;
  const { View } = require("react-native") as typeof import("react-native");
  return { Skeleton: (props: object) => ReactModule.createElement(View, props) };
});

const data = {
  brandId: "brand-874",
  authorized: true,
  minglaDrove30d: 2,
  minglaDroveLifetime: 8,
  valueCents30d: { GBP: 1200, USD: 2500 },
  valueCentsLifetime: {},
  bySource: [],
};

describe("issue #874 Analytics Home tile real render", () => {
  it("renders a single accessible multi-currency button and fires it", async () => {
    const onPress = jest.fn();
    const screen = await render(
      <AnalyticsHomeTile
        data={data}
        isLoading={false}
        isError={false}
        onPress={onPress}
      />,
    );
    const button = screen.getByRole("button", { name: /Open Analytics/ });
    expect(button.props.accessibilityLabel).toContain("2 customers");
    expect(button.props.accessibilityLabel).toContain("£12.00 booking value");
    expect(button.props.accessibilityLabel).toContain("$25.00 booking value");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps its action and footprint while loading", async () => {
    const loading = await render(
      <AnalyticsHomeTile
        data={undefined}
        isLoading
        isError={false}
        onPress={jest.fn()}
      />,
    );
    expect(loading.getByText("Customers Mingla drove you")).toBeTruthy();
    expect(loading.getByText("Open")).toBeTruthy();
  });

  it("renders an honest zero state", async () => {
    const zero = await render(
      <AnalyticsHomeTile
        data={{ ...data, minglaDrove30d: 0, valueCents30d: {} }}
        isLoading={false}
        isError={false}
        onPress={jest.fn()}
      />,
    );
    expect(zero.getByText("0 customers")).toBeTruthy();
    expect(zero.getByText("No paid booking value yet")).toBeTruthy();
  });

  it("keeps the button available after a preview error", async () => {
    const error = await render(
      <AnalyticsHomeTile
        data={undefined}
        isLoading={false}
        isError
        onPress={jest.fn()}
      />,
    );
    expect(error.getByText("Couldn't load your 30-day snapshot")).toBeTruthy();
    expect(error.getByRole("button")).toBeTruthy();
  });
});
