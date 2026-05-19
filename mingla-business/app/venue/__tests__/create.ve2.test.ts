import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const ROUTE = join(__dirname, "..", "create.tsx");

describe("venue/create Ve2 routing", () => {
  test("skips reset when pool match param or placePoolId present", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toContain('params.pool === "1"');
    expect(src).toContain("placePoolId");
    expect(src).toContain("PoolMatchCard");
    expect(src).not.toContain("isn't available yet");
  });
});
