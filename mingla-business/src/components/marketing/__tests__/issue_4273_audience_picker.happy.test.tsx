// #4273 wave B — the audience picker: same sheet, tick boxes, a de-duplicated Done.
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null),
}));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("lucide-react-native", () => {
  const icon = () => null;
  return { BookOpen: icon, Check: icon, Network: icon, Radio: icon, ShoppingBag: icon, UsersRound: icon };
});

const mockFrom = jest.fn((table: string) => ({
  select: () =>
    table === "orders"
      ? {
          in: () => ({
            eq: async () => ({
              data: [{ event_id: "e1", events: { id: "e1", title: "Highlife", brand_id: "brand-1" } }],
              error: null,
            }),
          }),
        }
      : { eq: async () => ({ data: [], error: null }) },
}));
jest.mock("../../../services/supabase", () => ({ supabase: { from: (table: string) => mockFrom(table) } }));
jest.mock("../../../services/marketing/marketingCampaignService", () => ({
  getOrCreateMarketingBookAudience: jest.fn(async () => ({ audienceId: "book-audience", activeBookTotal: 3 })),
}));
jest.mock("../../../services/marketing/manualGroupService", () => ({
  listManualGroups: jest.fn(async () => [
    { groupId: "g1", name: "VIP", memberCount: 2 },
    { groupId: "g2", name: "Empty group", memberCount: 0 },
  ]),
}));
const mockSummary = jest.fn(async (input: { sources: readonly string[] }) => ({
  // A real overlap: the sum of the rows would be 3 + 1 = 4.
  peopleCount: input.sources.length === 0 ? 0 : 3,
  sources: [],
  followersTotal: 1,
  followersAlsoInBook: 1,
}));
jest.mock("../../../services/marketing/marketingCombinedAudienceService", () => ({
  getCombinedAudienceSummary: (input: { sources: readonly string[] }) => mockSummary(input),
}));

import { AudiencePickerSheet, type AudienceOption } from "../AudiencePickerSheet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const text = (node: any): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join(" ");
  return node && typeof node === "object" ? text(node.children ?? []) : "";
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 230));

const REACH = {
  // The reach snapshot leaves Book people out, so it reads 0 for this follower.
  followers: { count: 0, state: "ready" as const, enabled: true },
  extended: { count: 0, state: "ready" as const, enabled: true },
};

const mounted: any[] = [];
afterEach(async () => {
  await TestRenderer.act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

async function mount(onDone: (options: AudienceOption[]) => void, onClose = jest.fn(), selectedKeys: string[] = [], reach: unknown = REACH) {
  let tree: any;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <AudiencePickerSheet
        visible
        actorId="actor-1"
        brandId="brand-1"
        brandName="Harmattan"
        selectedAudienceId={null}
        onClose={onClose}
        onSelect={jest.fn()}
        bookBlastEnabled
        manualGroupsEnabled
        circleAudienceEnabled
        circleReach={reach as typeof REACH}
        multiSelect={{ selectedKeys, onDone }}
      />,
    );
  });
  await TestRenderer.act(async () => { await settle(); });
  await TestRenderer.act(async () => { await settle(); });
  mounted.push(tree);
  return tree;
}
const row = (tree: any, name: string) =>
  tree.root.findAll(
    (node: any) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith(`Pick audience ${name}`) &&
      node.props.onPress,
  )[0];
const done = (tree: any) => tree.root.findByProps({ testID: "audience-picker-done", accessibilityRole: "button" });

describe("#4273 audience picker", () => {
  beforeEach(() => mockSummary.mockClear());

  it("keeps the sheet, sections, badges and privacy line, with tick boxes", async () => {
    const tree = await mount(jest.fn());
    const out = text(tree.toJSON()).replace(/\s+/g, " ");
    expect(out).toContain("Choose who gets this");
    expect(out).toMatch(/Your brand.*Your Book.*Mingla reach.*Followers.*Groups.*VIP.*Automatic.*All buyers of Harmattan/);
    expect(out).toContain("Names only");
    expect(out).toContain("Consent controlled");
    expect(out).toContain("Mingla keeps follower contact details hidden. You see names and reach totals only.");
    expect(row(tree, "Your Book").props.accessibilityRole).toBe("checkbox");
  });

  it('"No followers yet" becomes the true line when the follower is in the Book', async () => {
    const out = text((await mount(jest.fn())).toJSON());
    expect(out).toContain("1 follower · also in Your Book");
    expect(out).not.toContain("No followers yet");
  });

  it("empty groups say why they are empty and cannot be ticked", async () => {
    const tree = await mount(jest.fn());
    const out = text(tree.toJSON());
    expect(out).toContain("0 so far · grows as guests opt in");
    expect(out).toContain("No one in this group yet");
    expect(row(tree, "Friends of followers").props.accessibilityState.disabled).toBe(true);
    expect(row(tree, "Empty group").props.accessibilityState.disabled).toBe(true);
  });

  it("a tap ticks and the sheet stays open; Done shows the server's total, not a sum", async () => {
    const onClose = jest.fn();
    const onDone = jest.fn();
    const tree = await mount(onDone, onClose);
    expect(text(tree.toJSON())).toContain("Pick at least one group");
    await TestRenderer.act(async () => {
      row(tree, "Your Book").props.onPress();
      row(tree, "Followers").props.onPress();
    });
    await TestRenderer.act(async () => { await settle(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(row(tree, "Your Book").props.accessibilityState.checked).toBe(true);
    expect(text(tree.toJSON())).toContain("Done · 3 people");
    expect(text(tree.toJSON())).not.toContain("Done · 4 people");
    expect(mockSummary).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.arrayContaining(["book", "followers"]),
    }));
    await TestRenderer.act(async () => done(tree).props.onPress());
    expect(onDone.mock.calls[0][0].map((option: AudienceOption) => option.name)).toEqual(["Your Book", "Followers"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Select all takes every group that has people, and only those", async () => {
    const onDone = jest.fn();
    const tree = await mount(onDone);
    await TestRenderer.act(async () => {
      tree.root.findByProps({ testID: "audience-picker-select-all", accessibilityRole: "checkbox" }).props.onPress();
    });
    await TestRenderer.act(async () => { await settle(); });
    await TestRenderer.act(async () => done(tree).props.onPress());
    expect(onDone.mock.calls[0][0].map((option: AudienceOption) => option.name)).toEqual([
      "Your Book", "Followers", "VIP", "All buyers of Harmattan", "Buyers of Highlife",
    ]);
  });

  it("a failed count never falls back to a sum; the host can still go on", async () => {
    mockSummary.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    const tree = await mount(jest.fn(), jest.fn(), ["book"]);
    const out = text(tree.toJSON());
    expect(out).toMatch(/\bDone\b/);
    expect(out).not.toMatch(/Done · \d/);
    expect(done(tree).props.accessibilityState.disabled).toBe(false);
  });

  it("a tick on a row that went unavailable is not counted and not handed back", async () => {
    const onDone = jest.fn();
    const tree = await mount(onDone, jest.fn(), ["followers", "group:g1"], {
      ...REACH,
      followers: { count: 2, state: "unavailable", enabled: true, reason: "Refreshing" },
    });
    expect(row(tree, "Followers").props.accessibilityState.checked).toBe(false);
    const counted = mockSummary.mock.calls.map(([input]) => input.sources).filter((keys) => keys.length > 0);
    expect(counted.at(-1)).toEqual(["group:g1"]);
    await TestRenderer.act(async () => done(tree).props.onPress());
    expect(onDone.mock.calls[0][0].map((option: AudienceOption) => option.name)).toEqual(["VIP"]);
  });

  it("a picked row still checking its reach holds Done rather than dropping it", async () => {
    const tree = await mount(jest.fn(), jest.fn(), ["followers", "group:g1"], {
      ...REACH,
      followers: { count: null, state: "loading", enabled: true },
    });
    expect(done(tree).props.accessibilityState.disabled).toBe(true);
    expect(text(tree.toJSON())).toContain("Counting…");
  });

  it("the tick-box sheet takes the tall snap so the rows have room", async () => {
    const tree = await mount(jest.fn());
    expect(tree.root.findAll((node: any) => node.props.snapPoint === "full").length).toBeGreaterThan(0);
  });

  it("reopens with what the composer already holds", async () => {
    const tree = await mount(jest.fn(), jest.fn(), ["group:g1"]);
    expect(row(tree, "VIP").props.accessibilityState.checked).toBe(true);
    expect(row(tree, "Your Book").props.accessibilityState.checked).toBe(false);
  });
});
