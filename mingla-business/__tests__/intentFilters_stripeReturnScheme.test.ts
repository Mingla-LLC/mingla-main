import fs from "node:fs";
import path from "node:path";

describe("ORCH-0953 §3.5 — business Android Stripe return URL scheme", () => {
  it("declares com.sethogieva.minglabusiness as an explicit Android intent filter", () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../app.json"), "utf8"),
    );
    const filters = appJson.expo.android.intentFilters as Array<{
      data?: Array<{ scheme?: string }>;
    }>;
    expect(
      filters.some((filter) =>
        filter.data?.some((entry) =>
          entry.scheme === "com.sethogieva.minglabusiness"
        )
      ),
    ).toBe(true);
  });
});
