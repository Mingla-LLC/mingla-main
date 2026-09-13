import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const sheet = readFileSync(path.resolve(__dirname, "../CircleReachSheet.tsx"), "utf8");

describe("#1777 tester adversarial Circle sheet", () => {
  test("pagination retry cannot cancel an existing request or duplicate same-tick activation", () => {
    expect(sheet).toContain("loadMoreInFlight.current");
    expect(sheet).toContain("fetchNextPage({cancelRefetch:false})");
    expect(sheet).toContain("Couldn’t load more people.");
  });

  test("unavailable and offline states never render a stale list or a contact action", () => {
    expect(sheet).toContain('query.kind==="offlineUnavailable"');
    expect(sheet).toContain("Reach is temporarily unavailable.");
    expect(sheet).not.toMatch(/label="(?:Search|Select|Export|Copy)"|email|phone|contactValue|profileId/);
    expect(sheet).toContain("accessibilityViewIsModal");
  });
});
