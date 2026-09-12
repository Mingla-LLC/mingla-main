import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const page = readFileSync(path.resolve(__dirname, "../PeoplePage.tsx"), "utf8");

describe("#1777 tester adversarial People ownership", () => {
  test("Circle is never sourced from Book contacts or fabricated counts", () => {
    expect(page.match(/useBrandCircleReach\(/g)).toHaveLength(2);
    const circleSource = page.slice(page.indexOf('<CircleReachBlock'), page.indexOf('<PeopleBlock\n                    title="Groups"'));
    expect(circleSource).not.toMatch(/contacts|email|phone|estimatedReach|followersCount|extendedCircleCount/);
    expect(page).toContain('query={circleOpen==="extended"?circleExtended:circleFollowers}');
  });

  test("closing the authority gate closes an open sheet and removes previous-brand reach", () => {
    expect(page).toContain('kind==="featureLoading"||kind==="featureOff"');
    expect(page).toContain('useBrandCircleReach(brand?.id??null,"follower"');
    expect(page).toContain("onClose={closeCircle}");
  });
});
