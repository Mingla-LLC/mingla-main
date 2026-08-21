import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

describe("#2395 Manual contact groups happy-path surface", () => {
  test("creation remains name-first and composes the existing importer", () => {
    const flow = read("src/components/people/ManualGroupFlow.tsx");
    expect(flow).toContain('type Step = "name" | "sources" | "book" | "upload" | "review"');
    expect(flow).toContain('<ContactImportFlow brandId={brandId} context="manual_group"');
    expect(flow).toContain("Everyone uploaded is saved to Your Book first.");
    expect(flow).toContain("Create empty group");
    expect(flow).toContain("They are not members yet and do not increase campaign reach.");
    expect(flow).toContain("Discard this group setup?");
    expect(flow).toContain("Add person");
    expect(flow).toContain("stableManualMutationRequest");
    expect(flow).toContain("resultingManualMemberCount");
    expect(flow).toContain("getContactImportStatus");
    expect(flow).toContain("Preparing exact group counts…");
  });

  test("People distinguishes Manual from Automatic and routes details", () => {
    const page = read("src/components/people/PeoplePage.tsx");
    const card = read("src/components/marketing/AudienceCard.tsx");
    expect(page).toContain('useFeatureFlag("manual_contact_groups_v1")');
    expect(page).toContain("ManualGroupCard");
    expect(page).toContain("No buyer groups yet.");
    expect(page).toContain("Create group");
    expect(card).toContain("Manual group");
    expect(card).toContain("Opens group details.");
    expect(card).toContain("Automatic group");
    expect(card).toContain(">Automatic<");
  });

  test("detail preserves Book people and starts the guarded composer", () => {
    const detail = read("src/components/people/ManualGroupDetail.tsx");
    expect(detail).toContain("they’ll stay in Your Book");
    expect(detail).toContain("sent campaign history stays intact");
    expect(detail).toContain("audience=manual:${groupId}");
    expect(detail).toContain("Offline — showing saved data. Connect to make changes.");
    expect(detail).toContain('accessibilityLabel="Group actions"');
    expect(detail).toContain("blockingCampaignCount");
    expect(detail).toContain("Open campaigns");
  });

  test("composer parses and selects exactly one Manual source", () => {
    const parser = read("src/hooks/marketing/parseAudienceParam.ts");
    const picker = read("src/components/marketing/AudiencePickerSheet.tsx");
    const compose = read("app/(tabs)/marketing/campaigns/compose.tsx");
    expect(parser).toContain("brand|event|manual");
    expect(picker).toContain('kind: "manual_group" as const');
    expect(picker).toContain('title: "Your Book"');
    expect(picker).toContain('title: "Manual groups"');
    expect(picker).toContain('title: "Automatic groups"');
    expect(compose).toContain('setIsBookAudience(option.kind === "all_brand_people" || option.kind === "manual_group")');
    expect(compose).toContain("This group changed after preview. Refresh to get the current recipients and cost.");
    expect(compose).toContain("audience_kind: isManualAudience ? \"manual_group\" : \"all_brand_people\"");
  });

  test("new warm controls explicitly receive the dark-readable warm treatment", () => {
    for (const file of ["src/components/people/PeoplePage.tsx", "src/components/people/PeoplePrimitives.tsx", "src/components/people/ManualGroupFlow.tsx", "src/components/people/ManualGroupDetail.tsx"]) {
      expect(read(file)).toContain("accentColor={accent.warm}");
    }
  });
});
