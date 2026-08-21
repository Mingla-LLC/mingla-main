import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("#2395 tester adversarial UI contracts", () => {
  test("both create and detail Book-empty recovery expose Add person", () => {
    const page = read("src/components/people/PeoplePage.tsx");
    const detail = read("src/components/people/ManualGroupDetail.tsx");
    expect(page).toContain("onAddPerson={() => setAddOpen(true)}");
    expect(detail).toMatch(/<ManualGroupFlow[\s\S]*onAddPerson=/);
  });

  test("the direct detail route distinguishes loading from lost permission", () => {
    const route = read("app/(tabs)/people/groups/[groupId].tsx");
    expect(route).toContain("role.isLoading");
    expect(route).toMatch(/flag\.(?:isPending|isFetching)/);
    expect(route).toContain("Skeleton");
  });

  test("feature-off keeps the legacy Groups copy and card presentation", () => {
    const page = read("src/components/people/PeoplePage.tsx");
    const primitives = read("src/components/people/PeoplePrimitives.tsx");
    const picker = read("src/components/marketing/AudiencePickerSheet.tsx");
    expect(page).toContain('"Buyer groups that update automatically."');
    expect(page).toContain('title="No buyer groups yet."');
    expect(primitives).toContain("canCreate?<>");
    expect(primitives).toContain("<AudienceCard entry={item}");
    expect(picker).toContain("Choose Your Book or an Automatic buyer group.");
    expect(picker).toMatch(/manualGroupsEnabled[\s\S]*?title: "Manual groups"/);
  });
});
