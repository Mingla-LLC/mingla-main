import fs from "node:fs";
import path from "node:path";

import { TurnoutForecastCard } from "../TurnoutForecastCard";

describe("#1008 turnout card eager dependency boundary", () => {
  it("loads the shared wizard mount without evaluating native glass or animation modules", () => {
    expect(TurnoutForecastCard).toEqual(expect.any(Function));

    const providerSource = fs.readFileSync(
      path.resolve(__dirname, "../TurnoutIntelProvider.tsx"),
      "utf8",
    );
    expect(providerSource).toContain('await import("./IntelReportSheet")');
    expect(providerSource).not.toMatch(
      /import\s+\{\s*IntelReportSheet\s*\}\s+from\s+["']\.\/IntelReportSheet["']/,
    );
  });
});
