import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("#2893 media processing duration boundary", () => {
  it("keeps the Payload route explicitly bounded with room for six image outputs", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(payload)/api/[...slug]/route.ts"),
      "utf8",
    );
    const match = source.match(/export const maxDuration = (\d+);/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(180);
    expect(Number(match?.[1])).toBeLessThanOrEqual(300);
  });
});
