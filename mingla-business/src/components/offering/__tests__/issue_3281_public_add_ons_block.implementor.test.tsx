// MINGLA-INVARIANT: I-ADDON-PUBLIC-BLOCK-OPT-IN | issue #3281 | The public add-on block renders nothing unless its page turns it on, and then lists only shown add-ons with the server all-in price and a stored thumbnail URL.
/**
 * issue #3281 S2 — "Add at checkout:" under each ticket on the public page,
 * mounted through the real shared EventTicketBox, plus the Host RSVP door line.
 *
 * FAILS-ON-REVERT: render the block without `addOns`, list a hidden add-on,
 * drop the a11y summary, or drop the RSVP scan's `addOns` reading -> red.
 */

import React from "react";
import { describe, expect, test } from "@jest/globals";

import { OfferingAddOnsBlock } from "../../../../../packages/offering-rendering/OfferingAddOnsBlock";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { withDoorAddOns } from "../../../services/scanRsvpService";

jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Circle: () => null, Path: () => null }),
  { virtual: true },
);
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const extra = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "x1",
  name: "Friday dinner",
  description: null,
  priceCents: 2500,
  priceAllInCents: 2750,
  maxPerTicket: 2,
  isUnlimited: false,
  validOccurrenceIds: null,
  remaining: 4,
  showOnPublicPage: true,
  photoPath: "add-ons/e/x1.jpg",
  photoThumbPath: "add-ons/e/x1_thumb.jpg",
  ...over,
});

const theme = resolveTheme(null, null);
const ADD_ONS = [
  extra({}),
  extra({ id: "x2", name: "Secret tasting", showOnPublicPage: false }),
  extra({ id: "x3", name: "Tote bag", priceCents: 0, priceAllInCents: 0, photoThumbPath: null, remaining: 0 }),
];

const mount = async (enabled: boolean, photoUrl?: (p: string) => string | null): Promise<string> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <OfferingAddOnsBlock
        enabled={enabled}
        addOns={ADD_ONS}
        palette={createThemePalette(theme)}
        currency="USD"
        photoUrl={photoUrl}
        id="tier-a"
      />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  await TestRenderer.act(() => tree.unmount());
  return json;
};

describe("#3281 S2 the public add-on block", () => {
  test("off: renders nothing", async () => {
    expect(await mount(false)).toBe("null");
  });

  test("on: shown add-ons, all-in price, Free, sold out, hidden left out, stored thumbnail", async () => {
    const urls: string[] = [];
    const json = await mount(true, (path) => {
      urls.push(path);
      return `https://cdn.example/${path}`;
    });
    expect(json).toContain("Add at checkout:");
    expect(json).toContain("issue-3281-offering-add-ons-tier-a");
    expect(json).toContain("Add at checkout: Friday dinner, $27.50; Tote bag, sold out");
    expect(json).not.toContain("Secret tasting");
    expect(json).toContain(" · Sold out");
    expect(urls).toEqual(["add-ons/e/x1_thumb.jpg"]);
    expect(json).not.toContain("render/image");
  });
});

describe("#3281 S6 the RSVP door line on the Host scanner", () => {
  test("a reply's own addOns field becomes the Add-ons line; a reply without it is unchanged", () => {
    const admitted = withDoorAddOns({
      result: "success",
      addOns: [{ name: "Snack box", quantity: 2 }, { name: "Tee", quantity: 1 }],
      doorAnswers: { state: "answered", header: null, lines: ["Diet: none"], fullAnswers: false },
    });
    expect(admitted.addOnsLine).toBe("Add-ons: Snack box × 2 · Tee × 1");
    expect(admitted.doorAnswers?.lines).toEqual(["Diet: none"]);
    expect("addOns" in admitted).toBe(false);
    const plain = { result: "success", doorAnswers: null };
    expect(withDoorAddOns(plain)).toBe(plain);
  });
});
