/**
 * #4238 wave 2 rework — the Host audience picker, its sizes and status lines,
 * audience refusal copy, and the Ari ad card's audience row. Each case fails
 * when its fix is removed.
 */
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return { ...base, Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } };
});
jest.mock("../../../../services/lazyHostAdPlanService", () => ({
  loadHostAdPlanService: async () => ({ loadHostAdSetup: async () => ({ creatives: [] }) }),
}));
jest.mock("../../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: "CoverPickerSheet" }));
jest.mock("../../../ui/GlassChrome", () => ({
  GlassChrome: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../../ari/AriOrb", () => ({ AriOrb: "AriOrb" }));
jest.mock("../../../ari/ToolEditForm", () => ({ ToolEditForm: "ToolEditForm", isToolProposalEditable: () => false }));
jest.mock("../../../../hooks/useBrands", () => ({ useBrandCascadePreview: () => ({ data: null, isLoading: false }) }));
jest.mock("../../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("lucide-react-native", () => ({
  AlertTriangle: "AlertTriangle", Pencil: "Pencil", Play: "Play", Plus: "Plus", X: "X",
}));

// eslint-disable-next-line import/first
import { HostAdAudiencePicker } from "../HostAdAudiencePicker";
// eslint-disable-next-line import/first
import type { HostAdAudience } from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdAudienceSize, hostAdAudienceStatusLine, hostAdErrorMessage } from "../hostAdCopy";
// eslint-disable-next-line import/first
import { ToolProposalCard } from "../../../ari/ToolProposalCard";

const BRAND = "4238cccc-0000-4000-8000-000000000001";
const lookalikeNg: HostAdAudience = {
  audienceKey: `brand:${BRAND}:lookalike:NG`,
  name: "People like your guests (NG)",
  kind: "lookalike",
  approxSize: null,
  lookalikeCountry: "NG",
  platforms: [{ platform: "meta", state: "ready", neededCount: null }],
};
const guests: HostAdAudience = {
  audienceKey: `brand:${BRAND}:guests`,
  name: "Your past guests",
  kind: "list",
  approxSize: 250,
  lookalikeCountry: null,
  platforms: [
    { platform: "meta", state: "ready", neededCount: null },
    { platform: "google", state: "ineligible", neededCount: null },
    { platform: "reddit", state: "unsupported", neededCount: null },
  ],
};
const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("\n");
const card = (r: Renderer, key: string): RenderNode =>
  r.root.findAll((n) => typeof n.type === "string" && n.props.testID === `host-ad-audience-${key}`)[0];

function picker(props: Partial<React.ComponentProps<typeof HostAdAudiencePicker>>) {
  const onChange = jest.fn();
  let r: Renderer | null = null;
  void act(() => {
    r = create(
      <HostAdAudiencePicker
        audiences={[guests, lookalikeNg]}
        selected={[]}
        countries={["NG"]}
        connections={[{ platform: "meta" }]}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { r: r as unknown as Renderer, onChange };
}

describe("#4238 rework: the lookalike country rule in the picker", () => {
  it("a lookalike is choosable when its country is the only one picked", () => {
    const { r, onChange } = picker({});
    const node = card(r, lookalikeNg.audienceKey);
    expect(node.props.disabled).toBe(false);
    void act(() => (node.props.onPress as () => void)());
    expect(onChange).toHaveBeenCalledWith([lookalikeNg.audienceKey]);
  });

  it("with a second country it is disabled and says why in plain words", () => {
    const { r, onChange } = picker({ countries: ["NG", "GH"] });
    const node = card(r, lookalikeNg.audienceKey);
    expect(node.props.disabled).toBe(true);
    void act(() => (node.props.onPress as () => void)());
    expect(onChange).not.toHaveBeenCalled();
    expect(textOf(node)).toContain("Runs only when Nigeria is the one country you picked.");
  });

  it("an already chosen lookalike shows the reason and can still be taken off", () => {
    const { r, onChange } = picker({ countries: ["NG", "GH"], selected: [lookalikeNg.audienceKey] });
    const node = card(r, lookalikeNg.audienceKey);
    expect(textOf(node)).toContain("one country you picked");
    void act(() => (node.props.onPress as () => void)());
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("a lookalike never gets a Google line; a list says Google is not eligible", () => {
    const { r } = picker({ connections: [{ platform: "meta" }, { platform: "google" }, { platform: "reddit" }] });
    const lookalike = textOf(card(r, lookalikeNg.audienceKey));
    expect(lookalike).not.toMatch(/Google/);
    const list = textOf(card(r, guests.audienceKey));
    expect(list).toContain("Not eligible on Google yet");
    expect(list).toContain("Not available on Reddit");
    expect(list).not.toMatch(/more needed/);
  });
});

describe("#4238 rework: audience sizes", () => {
  const list = (approxSize: number | null) => ({ kind: "list" as const, approxSize, platforms: [] });
  it("0 reads 'No people yet', 1-9 read 'Fewer than 10 people', 10 reads 'About 10 people'", () => {
    expect(hostAdAudienceSize(list(0))).toBe("No people yet");
    for (let n = 1; n <= 9; n += 1) expect(hostAdAudienceSize(list(n))).toBe("Fewer than 10 people");
    expect(hostAdAudienceSize(list(10))).toBe("About 10 people");
  });
  it("a lookalike never shows a people count", () => {
    expect(hostAdAudienceSize({ kind: "lookalike", approxSize: 120, platforms: [] })).toBeNull();
    expect(
      hostAdAudienceSize({
        kind: "lookalike",
        approxSize: 120,
        platforms: [{ platform: "meta", state: "ready" }, { platform: "tiktok", state: "pending" }],
      }),
    ).toBe("Built by Facebook & Instagram");
  });
  it("the picker card shows no size line for a lookalike that isn't built yet", () => {
    const { r } = picker({ audiences: [{ ...lookalikeNg, platforms: [{ platform: "meta", state: "pending", neededCount: null }] }] });
    expect(textOf(card(r, lookalikeNg.audienceKey))).not.toMatch(/About \d|Fewer than|No people yet|Building now|Built by/);
  });
  it("Google ineligible has its own plain line", () => {
    expect(hostAdAudienceStatusLine("google", "ineligible", null)).toBe("Not eligible on Google yet");
  });
});

describe("#4238 rework: every audience refusal reads in plain words", () => {
  const FALLBACK = hostAdErrorMessage({});
  it.each([
    ["validation_error", "audience_country_mismatch", /only run in its own country/],
    ["plan_conflict", "audience_binding_mismatch", /changed after you checked/],
    ["plan_conflict", "audience_binding_unverified", /changed after you checked/],
    ["validation_error", "audience_not_owned", /isn't available for this brand/],
    ["validation_error", "audience_not_found", /isn't available for this brand/],
    ["validation_error", "audience_selection_invalid", /people you picked/],
    ["validation_error", "audience_intent_invalid", /people you picked/],
    ["validation_error", "audience_something_new", /can't be used right now/],
  ])("%s / %s", (code, detail, expected) => {
    const text = hostAdErrorMessage({ code, detail });
    expect(text).not.toBe(FALLBACK);
    expect(text).toMatch(expected);
  });
});

describe("#4238 rework: Ari's ad card names the chosen audiences", () => {
  it.each(["propose_ad_plan", "approve_ad_plan"])("%s shows 'People you know'", async (toolName) => {
    let r: Renderer | null = null;
    await act(async () => {
      r = create(
        <ToolProposalCard
          toolName={toolName}
          args={{
            brand_id: BRAND,
            __proposal_context: {
              ad_audience: "Nigeria · ages 21–35",
              ad_audiences: "Your past guests · People like your guests in Nigeria",
            },
          }}
          isExecuting={false}
          onConfirm={async () => ({ ok: true })}
          onCancel={() => undefined}
          proposalId="33333333-3333-4333-8333-333333333333"
        />,
      );
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    const all = (r as unknown as Renderer).root.findAll((n) => typeof n.type === "string").map(textOf).join("\n");
    expect(all).toContain("People you know");
    expect(all).toContain("Your past guests · People like your guests in Nigeria");
  });
});
