// MINGLA-INVARIANT: I-ADDON-PUBLIC-BLOCK-OPT-IN | issue #3281 | The shared offering bodies render the public add-on block only when their page passes addOns (Host: EXPO_PUBLIC_FF_EXTRAS_ENABLED; Explorer: FEATURE_FLAG_ADD_ONS); without it the rendered tree is identical to before.
/**
 * issue #3281 S2 — "Add at checkout:" under each ticket on the public page,
 * mounted through the real shared EventTicketBox, plus the Host RSVP door line.
 *
 * FAILS-ON-REVERT: render the block without `addOns`, list a hidden add-on,
 * drop the a11y summary, or drop the RSVP scan's `addOns` reading -> red.
 */

import React from "react";
import { describe, expect, test } from "@jest/globals";

import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import type { PublicTicketProps } from "../../../../../packages/offering-rendering/types";
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

const ticket = (overrides: Partial<PublicTicketProps> = {}): PublicTicketProps =>
  ({
    id: "tier-a",
    name: "General",
    description: null,
    priceGbp: 20,
    priceAllInGbp: 20,
    currency: "USD",
    isFree: false,
    isUnlimited: true,
    capacity: null,
    visibility: "public",
    passwordProtected: false,
    password: null,
    saleStartAt: null,
    saleEndAt: null,
    approvalRequired: false,
    waitlistEnabled: false,
    availableAt: "online",
    displayOrder: 0,
    ...overrides,
  }) as PublicTicketProps;

const theme = resolveTheme(null, null);

const mount = async (addOns: { photoUrl?: (p: string) => string | null } | null | undefined): Promise<string> => {
  let tree!: Tree;
  const tickets = [
    ticket({
      buyerExtras: [
        extra({}),
        extra({ id: "x2", name: "Secret tasting", showOnPublicPage: false }),
        extra({ id: "x3", name: "Tote bag", priceCents: 0, priceAllInCents: 0, photoThumbPath: null, remaining: 0 }),
      ],
    }),
    ticket({ id: "tier-b", name: "VIP", displayOrder: 1 }),
  ];
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <EventTicketBox
        event={{ id: "event-3281", name: "Add-ons night", currency: "USD", tickets } as never}
        bookable
        palette={createThemePalette(theme)}
        theme={theme}
        variant={"published" as never}
        ticketQuantities={{}}
        onChangeTicketQuantity={() => undefined}
        onProceedToCart={() => undefined}
        {...(addOns === undefined ? {} : { addOns })}
      />,
    );
  });
  const json = JSON.stringify(tree.toJSON());
  await TestRenderer.act(() => tree.unmount());
  return json;
};

describe("#3281 S2 the public add-on block", () => {
  test("off (no addOns prop, or null): the ticket box is exactly as before", async () => {
    const without = await mount(undefined);
    expect(without).not.toContain("Add at checkout");
    expect(await mount(null)).toBe(without);
  });

  test("on: shown add-ons under their ticket, all-in price, Free, sold out, hidden left out", async () => {
    const urls: string[] = [];
    const json = await mount({
      photoUrl: (path) => {
        urls.push(path);
        return `https://cdn.example/${path}`;
      },
    });
    expect(json).toContain("Add at checkout:");
    expect(json).toContain("issue-3281-offering-add-ons-tier-a");
    expect(json).not.toContain("issue-3281-offering-add-ons-tier-b");
    expect(json).toContain("Add at checkout: Friday dinner, $27.50; Tote bag, sold out");
    expect(json).not.toContain("Secret tasting");
    expect(json).toContain(" · Sold out");
    expect(urls).toEqual(["add-ons/e/x1_thumb.jpg"]);
    expect(json).toContain("https://cdn.example/add-ons/e/x1_thumb.jpg");
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
