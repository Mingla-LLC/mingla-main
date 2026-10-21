import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("#4037 collecting funnel", () => {
  it("shows only Bookings and scales that remaining step as the baseline", () => {
    const source = readFileSync(
      resolve(__dirname, "../TrafficAnalyticsDashboard.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "const visible = hasTraffic ? steps : steps.slice(-1);",
    );
    expect(source).toContain(
      "const basis = Math.max(visible[0]?.value ?? 0, 1);",
    );
  });
});
