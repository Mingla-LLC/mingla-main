import { describe, expect, test } from "@jest/globals";

import { filterPlayIntentTags } from "../playIntentTags";

describe("filterPlayIntentTags", () => {
  test("keeps only Play allowlist tags", () => {
    expect(
      filterPlayIntentTags(["brunch", "friends_chill", "group_activity"]),
    ).toEqual(["friends_chill", "group_activity"]);
  });

  test("normalizes spacing to underscores", () => {
    expect(filterPlayIntentTags(["Group Activity"])).toEqual(["group_activity"]);
  });
});
