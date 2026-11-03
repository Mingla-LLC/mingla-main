/**
 * #4238 wave 2 — TESTER adversarial: audience choices that the server will
 * refuse must never look choosable, and every refusal reads in plain words.
 * Found live on the local stack (Business web, 390 px): a Nigeria lookalike
 * stays tickable after the Host adds a second country, then "Check my ad"
 * fails with only "The plan could not be prepared." (create_version 422
 * audience_country_mismatch). A lookalike also read "Getting ready on
 * Google", though Google has no lookalikes.
 */

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
import { hostAdErrorMessage } from "../hostAdCopy";

const BRAND = "4238bbbb-0000-4000-8000-000000000001";
const lookalikeNg: HostAdAudience = {
  audienceKey: `brand:${BRAND}:lookalike:NG`,
  name: "People like your guests (NG)",
  kind: "lookalike",
  approxSize: 120,
  lookalikeCountry: "NG",
  platforms: [{ platform: "meta", state: "ready", neededCount: null }],
};
const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);

function render(props: Partial<React.ComponentProps<typeof HostAdAudiencePicker>>) {
  const onChange = jest.fn();
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(
      <HostAdAudiencePicker
        audiences={[lookalikeNg]}
        selected={[]}
        countries={["NG"]}
        connections={[{ platform: "meta" }]}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { renderer: renderer as unknown as Renderer, onChange };
}

const FALLBACK =
  "That didn't work just now. Try again in a minute, or contact Mingla support if it keeps happening.";

describe("#4238 wave 2 tester: audience choices the server refuses", () => {
  it("a lookalike cannot be added while the ad targets two countries", () => {
    const { renderer, onChange } = render({ countries: ["NG", "GB"] });
    const cards = byTestId(renderer, `host-ad-audience-${lookalikeNg.audienceKey}`);
    // Either hidden, or visible but disabled; never choosable.
    if (cards.length > 0) {
      expect(cards[0].props.disabled).toBe(true);
      act(() => (cards[0].props.onPress as () => void)());
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a lookalike already chosen shows it can't run once a second country is added", () => {
    const { renderer } = render({ countries: ["NG", "GB"], selected: [lookalikeNg.audienceKey] });
    const cards = byTestId(renderer, `host-ad-audience-${lookalikeNg.audienceKey}`);
    expect(cards.length).toBe(1);
    const text = textOf(cards[0]);
    expect(text).toMatch(/one country|only in Nigeria|Nigeria only/i);
  });

  it("never says a lookalike is 'Getting ready on Google' (Google has no lookalikes)", () => {
    const { renderer } = render({ connections: [{ platform: "meta" }, { platform: "google" }] });
    const text = textOf(byTestId(renderer, `host-ad-audience-${lookalikeNg.audienceKey}`)[0]);
    expect(text).not.toContain("Getting ready on Google");
  });

  it("the server's audience refusals read in plain words, not the generic fallback", () => {
    for (const detail of ["audience_country_mismatch", "audience_not_owned", "audience_selection_invalid"]) {
      expect(hostAdErrorMessage({ code: "validation_error", detail })).not.toBe(FALLBACK);
    }
  });
});
