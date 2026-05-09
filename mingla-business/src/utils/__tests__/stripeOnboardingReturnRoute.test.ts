import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

interface VercelRewrite {
  source: string;
  destination: string;
}

interface VercelConfig {
  rewrites?: VercelRewrite[];
}

describe("stripe onboarding return route", () => {
  test("vercel serves the clean Stripe onboarding return URL", () => {
    const configPath = path.resolve(__dirname, "../../../vercel.json");
    const config = JSON.parse(
      readFileSync(configPath, "utf8"),
    ) as VercelConfig;

    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/stripe-onboarding-return",
          destination: "/stripe-onboarding-return.html",
        }),
      ]),
    );
  });
});
