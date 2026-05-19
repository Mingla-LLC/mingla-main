import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("Ve2 pool match flow contracts", () => {
  test("no-match path does not auto-claim (requires explicit Yes)", () => {
    const card = readFileSync(
      join(__dirname, "..", "..", "components", "brand", "PoolMatchCard.tsx"),
      "utf8",
    );
    expect(card).toContain("Yes, this is me");
    expect(card).not.toContain("auto");
  });

  test("declining match clears placePoolId on gate continue", () => {
    const create = readFileSync(
      join(__dirname, "..", "..", "..", "app", "venue", "create.tsx"),
      "utf8",
    );
    expect(create).toContain("placePoolId: null");
  });

  test("venue create route uses claim-search flow not legacy boolean gate", () => {
    const create = readFileSync(
      join(__dirname, "..", "..", "..", "app", "venue", "create.tsx"),
      "utf8",
    );
    expect(create).toContain("usePoolMatchSearch");
    expect(create).not.toContain("placePoolHasNameMatch");
  });
});
