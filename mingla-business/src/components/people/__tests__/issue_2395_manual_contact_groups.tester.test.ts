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

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? children : null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: unknown }) => children,
}));
jest.mock("../../ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
const automaticRowPress = jest.fn();
jest.mock("../../marketing/AudienceCard", () => ({
  AudienceCard: ({ entry, onPress }: { entry: { display_name: string }; onPress: (entry: unknown) => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const LocalReact = require("react") as typeof import("react");
    return LocalReact.createElement(
      "MockAutomaticGroup",
      {
        accessibilityLabel: `Open ${entry.display_name}`,
        onPress: () => {
          automaticRowPress();
          onPress(entry);
        },
      },
      entry.display_name,
    );
  },
  ManualGroupCard: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactRuntime = require("react") as typeof import("react");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void) => void;
};

describe("#2395 tester adversarial rendered behavior", () => {
  test("the feature-off Groups sheet renders and opens the legacy Automatic group", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GroupsSheet } = require("../PeoplePrimitives") as typeof import("../PeoplePrimitives");
    const entry = {
      client_key: "brand:brand-1",
      display_name: "All buyers of Mingla Test",
      kind: "brand_buyers" as const,
      brand_id: "brand-1",
      brand_name: "Mingla Test",
      event_id: null,
      audience_id: "audience-1",
      last_used_at: null,
    };
    const onPress = jest.fn();
    let tree: any;

    TestRenderer.act(() => {
      tree = TestRenderer.create(
        ReactRuntime.createElement(GroupsSheet, {
          visible: true,
          onClose: jest.fn(),
          entries: [entry],
          manualGroups: [],
          canCreate: false,
          reach: new Map(),
          creatingKey: null,
          onPress,
          onPressManual: jest.fn(),
          onCreate: jest.fn(),
        }),
      );
    });

    expect(
      tree.root.findAll((node: any) => node.props.children === "Groups")[0],
    ).toBeDefined();
    expect(
      tree.root.findAll((node: any) => node.props.accessibilityLabel === "Create group"),
    ).toHaveLength(0);
    const list = tree.root.findAll(
      (node: any) => typeof node.props.renderItem === "function",
    )[0];
    expect(list).toBeDefined();
    let rowTree: any;
    TestRenderer.act(() => {
      rowTree = TestRenderer.create(
        list.props.renderItem({ item: list.props.data[0] }),
      );
    });
    const row = rowTree.root.findAll(
      (node: any) => node.props.accessibilityLabel === "Open All buyers of Mingla Test",
    )[0];
    expect(row).toBeDefined();
    TestRenderer.act(() => row.props.onPress());
    expect(automaticRowPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(entry);
  });
});
