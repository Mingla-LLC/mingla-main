import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

describe("#2395 Manual contact groups happy-path surface", () => {
  test("creation remains name-first and composes the existing importer", () => {
    const flow = read("src/components/people/ManualGroupFlow.tsx");
    expect(flow).toContain('type Step = "name" | "sources" | "book" | "upload" | "review"');
    expect(flow).toContain("loader={loadContactImportFlow}");
    expect(flow).toContain('context: "manual_group" as const');
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

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

const ReactRuntime = require("react") as typeof import("react");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: {
      findAll: (predicate: (node: RenderedNode) => boolean) => RenderedNode[];
    };
    toJSON: () => unknown;
  };
  act: (callback: () => void) => void;
};

interface RenderedNode {
  props: {
    accessibilityLabel?: string;
    onPress?: () => void;
  };
}

function renderedText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  if (node !== null && typeof node === "object" && "children" in node) {
    return renderedText((node as { children?: unknown }).children);
  }
  return "";
}

describe("#2395 Manual contact groups rendered happy path", () => {
  test("a Manual group renders its real organizational count and opens the selected group", () => {
    const { ManualGroupCard } = require("../../marketing/AudienceCard") as typeof import("../../marketing/AudienceCard");
    const group = {
      groupId: "11111111-1111-4111-8111-111111111111",
      name: "VIP regulars",
      kind: "manual" as const,
      memberCount: 3,
      pendingReviewCount: 2,
      membershipVersion: 4,
      lastUsedAt: null,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    const onPress = jest.fn();
    let tree!: ReturnType<typeof TestRenderer.create>;

    TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactRuntime.createElement(ManualGroupCard, { group, onPress }),
      );
    });

    expect(renderedText(tree.toJSON())).toMatch(/VIP regulars.*Manual.*3 people.*2\s+need review/);
    const card = tree.root.findAll(
      (node) => node.props.accessibilityLabel ===
        "VIP regulars, Manual group, 3 people. Opens group details.",
    )[0];
    expect(card).toBeDefined();
    TestRenderer.act(() => card?.props.onPress?.());
    expect(onPress).toHaveBeenCalledWith(group);
  });
});
