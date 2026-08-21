import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(
  path.join(root, "src/components/marketing/AudiencePickerSheet.tsx"),
  "utf8",
);

describe("#2395 tester — feature OFF is exact legacy audience-picker behavior", () => {
  test("keeps the pre-feature explanatory copy", () => {
    expect(source).toMatch(
      /Your Book shows active saved people; buyer lists come from paid\s+orders\./,
    );
  });

  test("keeps the pre-feature row accessibility and buyer metadata when OFF", () => {
    expect(source).toContain("renderLegacyOption");
    expect(source).toMatch(
      /manualGroupsEnabled === true[\s\S]*?: options\.map\(renderLegacyOption\)/,
    );
    expect(source).toContain(
      "`Pick audience ${option.name} with ${option.buyer_count} buyers`",
    );
    expect(source).toContain(
      'option.buyer_count === 1 ? "buyer" : "buyers"',
    );
    expect(source).toMatch(
      /option\.kind === "brand_buyers"[\s\S]*?"Brand rollup"[\s\S]*?: "Event buyers"/,
    );
  });
});

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? children : null,
}));

const ordersEq = jest.fn(async () => ({
  data: [
    {
      event_id: "event-1",
      events: { id: "event-1", title: "Launch", brand_id: "brand-1" },
    },
  ],
  error: null,
}));
const audiencesEq = jest.fn(async () => ({
  data: [
    {
      id: "audience-1",
      query_definition: { kind: "brand_buyers", brand_id: "brand-1" },
    },
  ],
  error: null,
}));
const from = jest.fn((table: string) => ({
  select: () =>
    table === "orders"
      ? { in: () => ({ eq: ordersEq }) }
      : { eq: audiencesEq },
}));
jest.mock("../../../services/supabase", () => ({ supabase: { from } }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  getOrCreateMarketingBookAudience: jest.fn(),
}));
const listManualGroups = jest.fn();
jest.mock("../../../services/marketing/manualGroupService", () => ({
  listManualGroups,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactRuntime = require("react") as typeof import("react");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const renderedText = (node: any): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  return node && typeof node === "object" ? renderedText(node.children ?? []) : "";
};

describe("#2395 tester — feature OFF rendered behavior", () => {
  test("renders and operates the exact legacy buyer row without loading Manual groups", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AudiencePickerSheet } = require("../AudiencePickerSheet") as typeof import("../AudiencePickerSheet");
    const onSelect = jest.fn();
    const onClose = jest.fn();
    let tree: any;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        ReactRuntime.createElement(AudiencePickerSheet, {
          visible: true,
          brandId: "brand-1",
          brandName: "Mingla Test",
          selectedAudienceId: null,
          onClose,
          onSelect,
          manualGroupsEnabled: false,
          bookBlastEnabled: false,
        }),
      );
      await Promise.resolve();
    });

    const output = renderedText(tree.toJSON());
    expect(output).toContain(
      "Your Book shows active saved people; buyer lists come from paid orders.",
    );
    expect(output.replace(/\s+/g, " ")).toMatch(
      /All buyers of Mingla Test.*1 buyer.*Brand rollup/,
    );
    expect(output).not.toContain("Manual groups");
    expect(listManualGroups).not.toHaveBeenCalled();

    const row = tree.root.findAll(
      (node: any) =>
        node.props.accessibilityLabel ===
        "Pick audience All buyers of Mingla Test with 1 buyers",
    )[0];
    expect(row).toBeDefined();
    TestRenderer.act(() => row.props.onPress());
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "brand_buyers", buyer_count: 1 }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
