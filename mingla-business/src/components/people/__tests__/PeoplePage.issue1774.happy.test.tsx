import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string): string => readFileSync(path.resolve(__dirname, relative), "utf8");

describe("issue #1774 People page happy path", () => {
  test("the primary route mounts the real People page and legacy Audiences only redirects", () => {
    expect(read("../../../../app/(tabs)/marketing/people/index.tsx")).toContain("<PeoplePage");
    const legacy = read("../../../../app/(tabs)/marketing/audiences/index.tsx");
    expect(legacy).toContain('<Redirect href="/(tabs)/marketing/people"');
    expect(legacy).not.toContain("AudienceListScreen");
  });

  test("the page hides future reach/export dependencies and never fabricates reach", () => {
    const page = read("../PeoplePage.tsx");
    expect(page).toContain('status="Import unavailable"');
    expect(page).not.toMatch(/People you can reach|Reach unavailable|Followers|Extended circle/);
    expect(page).not.toMatch(/Export unavailable|Book export is coming soon/);
    expect(page).not.toMatch(/followersCount|extendedCircleCount|estimatedReach/);
  });

  test("import is fail-closed and every import exit replaces back to People", () => {
    const page = read("../PeoplePage.tsx");
    expect(page).toMatch(
      /!flag\.isPending\s*&&\s*!flag\.isFetching\s*&&\s*!flag\.isError\s*&&\s*flag\.data\s*===\s*true/,
    );
    const route = read("../../../../app/(tabs)/people/import.tsx");
    expect(route).toContain('returnTo === "marketingPeople"');
    expect(route).toContain('navigation.addListener(\n      "beforeRemove"');
    expect(route).toContain('router.replace("/(tabs)/marketing/people"');
  });

  test("person detail is read-only and Add requires identity plus name", () => {
    const detail = read("../PersonDetailView.tsx");
    expect(detail).not.toMatch(/Save|Delete|Edit person/);
    const add = read("../AddPersonSheet.tsx");
    expect(add).toContain("name.trim().length>0");
    expect(add).toContain("email.trim()!==\"\"||phone!==null");
  });
});
