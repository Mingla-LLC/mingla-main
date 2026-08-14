import type { TurnoutReport } from "../../../types/growthTools";
import { buildTurnoutDrivers } from "../turnoutDrivers";

describe("#1008 turnout driver identity rework", () => {
  it("gives duplicate real-engine factor keys distinct rendered identities", () => {
    const report = {
      forecast: { total_low: 86, total_high: 150, capacity: 150 },
      weather: {
        kind: "forecast",
        summary: "Clear",
        impact: "Expected to help",
      },
      factors: [
        { key: "weather", label: "Weather", status: "help", detail: "Clear" },
        { key: "weather", label: "Conditions", status: "help", detail: "Dry" },
        { key: "weather", label: "Travel", status: "watch", detail: "Traffic" },
      ],
    } as TurnoutReport;

    const drivers = buildTurnoutDrivers(report);
    expect(new Set(drivers.map((driver) => driver.id)).size).toBe(drivers.length);
    expect(drivers.map((driver) => driver.id)).toEqual([
      "weather:0",
      "weather:1",
      "weather:2",
      "weather:3",
    ]);
  });
});
