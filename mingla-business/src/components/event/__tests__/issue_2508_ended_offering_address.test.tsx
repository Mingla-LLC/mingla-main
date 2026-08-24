// issue #2508 [maps-app-chooser] — SETH'S RULING on ended offerings, pinned.
//
// The ruling, verbatim: "Address can show no issues there as long as the fact
// that the event has ended shows clearly and tickets aren't purchasable anymore
// and no way to proceed to cart."
//
// So an ended offering KEEPS the address affordances — an address is not an
// acquisition action, and someone may still need to find the venue — and the
// three conditions attached to that ruling are binding acceptance criteria.
// Nothing pinned them before this file: #1902 pins the ABSENCE of acquisition
// subtrees on an ended page, and deliberately says nothing about the address,
// so the combination Seth described was unguarded in both directions.
//
// WHAT THIS FILE PINS, as ONE contract on ONE ended offering:
//   S-1  the ended fact shows CLEARLY — the notice renders, carries its exact
//        copy, is announced as a live status, and comes BEFORE the address in
//        reading order, so it cannot be demoted below the thing it qualifies
//   S-2  tickets are NOT purchasable — no tier name, no price, no total, no
//        quantity stepper, no ticket box
//   S-3  there is NO route to the cart — no proceed CTA, and the cart callback
//        is never invoked by anything the ended page renders
//   S-4  ...and the address affordances ARE present: the venue card, the maps
//        control, and the copy-address button
//
// NOTE ON WHY #1902 IS UNTOUCHED. Three #1902 tests did fail on this branch,
// but NONE of them was an address assertion: the shared venue card was crashing
// at runtime (`OfferingRenderingReact.useState is not a function`) because
// #2508 had first published the package React bridge from `LucideIcons.tsx`,
// which this very suite's sibling legitimately stubs as
// `new Proxy({}, { get: () => icon })`. Moving the bridge to its own module
// fixed all three with zero assertions changed. #1902's ended contract is
// intact, and this file is additive beside it.
//
// FAILS-ON-REVERT: delete the `<VenueCopyAddressButton` line from
// EventOfferingBody.tsx and S-4 fails; delete the `variant === "past"` ticket
// suppression and S-2/S-3 fail.

import React from "react";
import { Platform } from "react-native";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = {
  root: { findAllByProps: (props: Record<string, unknown>) => unknown[] };
  toJSON: () => unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// The icon module is stubbed exactly as the #1902 sibling stubs it. That is
// deliberate: it is the stub that broke the first bridge placement, so keeping
// it here means this suite also guards the bridge from moving back.
jest.mock("../../../../../packages/offering-rendering/LucideIcons", () => {
  const icon = (): null => null;
  return new Proxy({}, { get: () => icon });
});
jest.mock(
  "react-native-svg",
  () => {
    const node = (): null => null;
    return { __esModule: true, default: node, Svg: node, Path: node, Circle: node, Rect: node, G: node };
  },
  { virtual: true },
);

// eslint-disable-next-line import/first
import {
  EventAcquisitionNotice,
  EventOfferingBody,
} from "../../../../../packages/offering-rendering/EventOfferingBody";

const palette = {
  page: "#fff",
  card: "#fff",
  panelBorder: "#ddd",
  accent: "#f60",
  accentWash: "#fee",
  accentText: "#fff",
  primaryText: "#111",
  secondaryText: "#333",
  tertiaryText: "#666",
  cutoutBorder: "#eee",
  mutedText: "#777",
  danger: "#900",
  success: "#090",
} as never;
const theme = {
  color: "#f60",
  foregroundColor: "#fff",
  font: "inter",
  fontFamilyValue: "Inter",
  animation: "none",
} as never;
const brand = { id: "b", slug: "brand", displayName: "Brand", theme: null };

const endedEvent = {
  id: "e",
  name: "Night",
  brandId: "b",
  brandSlug: "brand",
  eventSlug: "night",
  description: "Read-only history",
  dateLine: "11 Aug",
  dateSubline: "7-9pm",
  datesList: [],
  status: "published",
  endedAt: null,
  format: "in-person",
  // The address is REAL and shown — this offering has nothing withheld, which
  // is the case Seth ruled on.
  venueName: "Venue",
  address: "Street",
  hideAddressUntilTicket: false,
  locationGeo: null,
  cityGeo: null,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  tickets: [
    {
      id: "t",
      name: "General",
      description: null,
      priceGbp: 10,
      priceAllInGbp: 11,
      currency: "USD",
      isFree: false,
      isUnlimited: true,
      capacity: null,
      visibility: "visible",
      passwordProtected: false,
      password: null,
      saleStartAt: null,
      saleEndAt: null,
      approvalRequired: false,
      waitlistEnabled: false,
      availableAt: "online",
      displayOrder: 0,
    },
  ],
  currency: "USD",
  acquisitionState: { kind: "ended", reason: "master_end" },
} as never;

const textOf = (node: unknown): string => JSON.stringify(node ?? "");

/**
 * The ended page as a guest actually meets it: the acquisition notice above,
 * the offering body below — the same order
 * `mingla-business/src/components/event/PublicEventPage.tsx` composes them in.
 */
const mountEndedPage = async (
  onProceedToCart: () => void,
): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <>
        <EventAcquisitionNotice
          state={{ kind: "ended", reason: "master_end" }}
          eventType="event"
          brandName="Brand"
          palette={palette}
          theme={theme}
        />
        <EventOfferingBody
          event={endedEvent}
          brand={brand as never}
          variant="past"
          bookable
          palette={palette}
          theme={theme}
          ticketQuantities={{}}
          onChangeTicketQuantity={() => undefined}
          onProceedToCart={onProceedToCart}
          onOpenMaps={() => undefined}
          onCopyAddress={() => undefined}
        />
      </>,
    );
  });
  return tree;
};

describe("#2508 an ended offering keeps its address and offers no way to buy", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
  });

  test("S-1 the ended fact shows CLEARLY, above the address", async () => {
    const tree = await mountEndedPage(() => undefined);
    const rendered = textOf(tree.toJSON());

    // It is present, and it is the exact guest-facing copy #1902 pins.
    expect(rendered).toContain("PAST EVENT");
    expect(rendered).toContain("This event has ended");

    // It is ANNOUNCED, not merely drawn — a notice a screen reader skips is not
    // a fact that "shows clearly".
    expect(
      tree.root.findAllByProps({ role: "status" }).length +
        tree.root.findAllByProps({ accessibilityLiveRegion: "polite" }).length,
    ).toBeGreaterThan(0);

    // And it is NOT demoted below the thing it qualifies: the ended notice
    // reaches the guest before the venue address does, in reading order and in
    // screen-reader order alike.
    expect(rendered.indexOf("PAST EVENT")).toBeLessThan(
      rendered.indexOf("Street"),
    );
  });

  test("S-2 tickets are NOT purchasable", async () => {
    const tree = await mountEndedPage(() => undefined);
    const rendered = textOf(tree.toJSON());

    // No tier, no price, no live total.
    for (const forbidden of ["General", "$10", "$11", "tickets left"]) {
      expect(rendered).not.toContain(forbidden);
    }
    // No ticket box and no quantity stepper: nothing to select a quantity with.
    expect(
      tree.root.findAllByProps({ testID: "orch-1167-ticket-box" }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: "orch-1167-running-total" }),
    ).toHaveLength(0);
  });

  test("S-3 there is NO route to the cart", async () => {
    const onProceedToCart = jest.fn();
    const tree = await mountEndedPage(onProceedToCart);
    const rendered = textOf(tree.toJSON());

    // No proceed CTA anywhere in the tree...
    expect(
      tree.root.findAllByProps({ testID: "orch-1167-box-proceed" }),
    ).toHaveLength(0);
    expect(rendered).not.toContain("Proceed");
    expect(rendered).not.toContain("Get tickets");
    // ...and nothing the ended page renders can reach checkout.
    expect(onProceedToCart).not.toHaveBeenCalled();
  });

  test("S-4 the address affordances ARE present — Seth's ruling", async () => {
    const tree = await mountEndedPage(() => undefined);
    const rendered = textOf(tree.toJSON());

    // The venue card still carries the real address.
    expect(rendered).toContain("Where you");
    expect(rendered).toContain("Venue");
    expect(rendered).toContain("Street");

    // The maps control and the copy button both render, on an ENDED offering.
    expect(rendered).toContain("Open maps");
    expect(
      tree.root.findAllByProps({ testID: "issue-2508-copy-address" }).length,
    ).toBeGreaterThan(0);
    expect(rendered).toContain("Copy address");
  });

  test("S-5 the whole contract holds at once, on one ended offering", async () => {
    const onProceedToCart = jest.fn();
    const tree = await mountEndedPage(onProceedToCart);
    const rendered = textOf(tree.toJSON());

    // Ended AND addressable AND unbuyable — the exact combination Seth ruled
    // on, asserted together so a future change cannot satisfy one half of it
    // while quietly dropping the other.
    expect(rendered).toContain("PAST EVENT");
    expect(rendered).toContain("Copy address");
    expect(rendered).toContain("Open maps");
    expect(rendered).not.toContain("General");
    expect(
      tree.root.findAllByProps({ testID: "orch-1167-ticket-box" }),
    ).toHaveLength(0);
    expect(onProceedToCart).not.toHaveBeenCalled();
  });
});
