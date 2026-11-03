/**
 * #4238 wave 2 — T12: the Host audience picker ("Reach people you know").
 * Every state's copy, the three-pick limit, the lookalike country filter and
 * the visible disabled reason. Also: the Host client never sends audience ids.
 */

import fs from "fs";
import path from "path";
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
  children: (RenderNode | string)[];
};
type Renderer = {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  update: (element: React.ReactElement) => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return { ...base, Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } };
});

// eslint-disable-next-line import/first
import { HostAdAudiencePicker } from "../HostAdAudiencePicker";
// eslint-disable-next-line import/first
import type { HostAdAudience } from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdAudiencesFromSetup } from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain } from "../hostAdCopy";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";
const guests: HostAdAudience = {
  audienceKey: `brand:${BRAND}:guests`,
  name: "Your past guests",
  kind: "list",
  approxSize: 250,
  lookalikeCountry: null,
  platforms: [
    { platform: "meta", state: "ready", neededCount: null },
    { platform: "snapchat", state: "below_minimum", neededCount: 750 },
  ],
};
const contacts: HostAdAudience = {
  audienceKey: `brand:${BRAND}:contacts`,
  name: "Your contacts",
  kind: "list",
  approxSize: 60,
  lookalikeCountry: null,
  platforms: [{ platform: "meta", state: "below_minimum", neededCount: 40 }],
};
const lookalikeNg: HostAdAudience = {
  audienceKey: `brand:${BRAND}:lookalike:NG`,
  name: "People like your guests (NG)",
  kind: "lookalike",
  approxSize: 250,
  lookalikeCountry: "NG",
  platforms: [{ platform: "meta", state: "ready", neededCount: null }],
};
const lookalikeGh: HostAdAudience = {
  ...lookalikeNg,
  audienceKey: `brand:${BRAND}:lookalike:GH`,
  lookalikeCountry: "GH",
};
const building: HostAdAudience = {
  ...guests,
  audienceKey: `brand:${BRAND}:guests2`,
  platforms: [{ platform: "meta", state: "pending", neededCount: null }],
};

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const allText = (renderer: Renderer): string =>
  renderer.root.findAll((node) => node.type === "Text").map(textOf).join("\n");
const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);

function render(props: Partial<React.ComponentProps<typeof HostAdAudiencePicker>> = {}) {
  const onChange = jest.fn();
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(
      <HostAdAudiencePicker
        audiences={[guests, contacts, lookalikeNg, lookalikeGh]}
        selected={[]}
        countries={["NG"]}
        connections={[{ platform: "meta" }, { platform: "snapchat" }]}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { renderer: renderer as unknown as Renderer, onChange };
}

describe("#4238 T12 HostAdAudiencePicker", () => {
  it("shows the section, sizes and a plain status line per selected app", () => {
    const { renderer } = render();
    const text = allText(renderer);
    expect(text).toContain("Reach people you know");
    expect(text).toContain("You'll only see rough sizes, never names.");
    expect(text).toContain("Your past guests");
    expect(text).toContain("About 250 people");
    expect(text).toContain("Facebook & Instagram: Ready");
    expect(text).toContain("Snapchat: Not enough people yet: 750 more needed");
    expect(text).toContain("Facebook & Instagram: Not enough people yet: 40 more needed");
    for (const line of text.split("\n")) expect(hostAdCopyIsPlain(line)).toBe(true);
  });

  it("names a lookalike by country and hides one for a country not picked", () => {
    const { renderer } = render();
    const text = allText(renderer);
    expect(text).toContain("People like your guests in Nigeria");
    expect(text).not.toContain("Ghana");
    expect(byTestId(renderer, `host-ad-audience-${lookalikeGh.audienceKey}`)).toHaveLength(0);
  });

  it("keeps a card that isn't ready visible, disabled, with its reason", () => {
    const { renderer, onChange } = render();
    const card = byTestId(renderer, `host-ad-audience-${contacts.audienceKey}`)[0];
    expect(card.props.disabled).toBe(true);
    expect(textOf(byTestId(renderer, `host-ad-audience-reason-${contacts.audienceKey}`)[0])).toBe(
      "Not ready on any app you picked yet.",
    );
    act(() => (card.props.onPress as () => void)());
    // Disabled Pressables don't fire; the picker never adds it either way.
    expect(onChange).not.toHaveBeenCalledWith([contacts.audienceKey]);
  });

  it("selects and deselects; allows at most three", () => {
    const { renderer, onChange } = render();
    act(() =>
      (byTestId(renderer, `host-ad-audience-${guests.audienceKey}`)[0].props.onPress as () => void)(),
    );
    expect(onChange).toHaveBeenLastCalledWith([guests.audienceKey]);
    const many = [guests, lookalikeNg, { ...guests, audienceKey: `brand:${BRAND}:x` }, { ...guests, audienceKey: `brand:${BRAND}:y` }];
    const full = render({
      audiences: many,
      selected: many.slice(0, 3).map((a) => a.audienceKey),
    });
    const fourth = byTestId(full.renderer, `host-ad-audience-brand:${BRAND}:y`)[0];
    expect(fourth.props.disabled).toBe(true);
    expect(textOf(byTestId(full.renderer, `host-ad-audience-reason-brand:${BRAND}:y`)[0])).toBe(
      "You can pick up to 3.",
    );
    act(() =>
      (byTestId(full.renderer, `host-ad-audience-${guests.audienceKey}`)[0].props.onPress as () => void)(),
    );
    expect(full.onChange).toHaveBeenLastCalledWith(many.slice(1, 3).map((a) => a.audienceKey));
  });

  it("says Building now while every app is still getting ready", () => {
    const { renderer } = render({ audiences: [building], connections: [{ platform: "meta" }] });
    const text = allText(renderer);
    expect(text).toContain("Building now");
    expect(text).toContain("Getting ready on Facebook & Instagram");
  });

  it("empty and error states", () => {
    expect(allText(render({ audiences: [] }).renderer)).toContain(
      "Once you've had guests or added contacts, you can show ads to them here.",
    );
    expect(allText(render({ unavailable: true }).renderer)).toContain(
      "We couldn't load your audiences. You can still run this ad to everyone in the places you picked.",
    );
  });

  it("maps setup rows and drops unknown shapes, never guessing", () => {
    expect(
      hostAdAudiencesFromSetup([
        { audience_key: guests.audienceKey, display_name: "Your past guests", kind: "list", approx_size: 250, lookalike_country: null, platforms: [{ platform: "meta", state: "ready", needed_count: null }] },
        { display_name: "no key" },
        "junk",
      ]),
    ).toEqual([{ ...guests, platforms: [{ platform: "meta", state: "ready", neededCount: null }] }]);
    expect(hostAdAudiencesFromSetup(undefined)).toEqual([]);
  });

  it("the Host client sends audience keys, never provider audience ids", () => {
    const service = fs.readFileSync(path.join(__dirname, "../../../../services/hostAdPlanService.ts"), "utf8");
    expect(service).toContain("audience_selection: {");
    expect(service).toMatch(/includeAudienceIds\?: never;/);
    expect(service).toMatch(/const refs: HostTargetingRefs = hostAdRefsForApp\(/);
    const create = fs.readFileSync(path.join(__dirname, "../../../../../src/screens/hostAds/HostAdCreateScreen.tsx"), "utf8");
    expect(create).toContain("audience_keys: audienceKeys");
    expect(create).toContain("<HostAdAudiencePicker");
    expect(create).toContain('testID="host-ad-review-audiences"');
  });
});
