import { visibleFunnelSteps } from "../../../utils/trafficAnalyticsMath";

const totals = {
  pageViews: 12,
  buttonTaps: 5,
  checkoutStarts: 3,
  bookings: 2,
};

describe("#4037 collecting funnel", () => {
  it("shows only Bookings and scales that remaining step as the baseline", () => {
    const steps = visibleFunnelSteps(totals, false);

    expect(steps.map((step) => step.label)).toEqual(["Bookings"]);
    expect(steps[0]).toEqual({
      label: "Bookings",
      value: 2,
      widthPercent: 100,
    });
  });

  it("keeps a visible floor when the collecting baseline is zero", () => {
    expect(visibleFunnelSteps({ ...totals, bookings: 0 }, false)).toEqual([
      { label: "Bookings", value: 0, widthPercent: 4 },
    ]);
  });

  it("shows all four steps against page visits once there is traffic", () => {
    const steps = visibleFunnelSteps(
      { pageViews: 200, buttonTaps: 50, checkoutStarts: 20, bookings: 1 },
      true,
    );

    expect(steps.map((step) => [step.label, step.widthPercent])).toEqual([
      ["Page visits", 100],
      ["Button taps", 25],
      ["Checkouts started", 10],
      ["Bookings", 4],
    ]);
  });
});
