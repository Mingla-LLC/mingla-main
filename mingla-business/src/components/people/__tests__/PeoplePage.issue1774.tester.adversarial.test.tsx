import fs from "node:fs";
import path from "node:path";

describe("#1774 tester-owned privacy and rollout tripwires", () => {
  const root = path.resolve(__dirname, "../../../..");
  const page = fs.readFileSync(
    path.join(root, "src/components/people/PeoplePage.tsx"),
    "utf8",
  );
  const primitives = fs.readFileSync(
    path.join(root, "src/components/people/PeoplePrimitives.tsx"),
    "utf8",
  );

  test("only a settled literal true feature flag can make Import actionable", () => {
    expect(page).toMatch(
      /const importEnabled=.*flag\.data===true;/,
    );
    expect(page).not.toMatch(/Boolean\(importFlag\.data\)/);
  });

  test("represented unavailable dependencies remain status text rather than dead buttons", () => {
    const start = primitives.indexOf("export function DependencyStatus");
    const end = primitives.indexOf("export function PeopleRow", start);
    const dependency = primitives.slice(start, end);
    expect(dependency).toBeDefined();
    expect(dependency).not.toMatch(/Pressable|Touchable|onPress|role="button"/);
    expect(page).toContain('status="Import unavailable"');
  });

  test("hidden reach dependencies reserve no UI and never invent a numeric recipient count", () => {
    expect(page).not.toMatch(/People you can reach|Reach unavailable|Followers|Extended circle/);
    expect(page).not.toMatch(/Export unavailable|Book export is coming soon/);
    expect(page).not.toMatch(/followers?\s*:\s*\d|extended\s*:\s*\d/i);
  });
});
