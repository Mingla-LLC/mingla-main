/**
 * issue #4420 — no empty rounded bar under "Tickets" on the public event page.
 *
 * The shared ticket box used to wrap its leading slot in a card. The public
 * page fills that slot with a lazily loaded day chooser (Suspense fallback
 * null) that can also return null, so the card rendered EMPTY under the
 * "Tickets" heading. The slot is now bare and the chooser draws its own card.
 *
 * Fails-on-revert: re-wrap `leadingPurchaseSection` in a styled View in
 * EventTicketBox, or drop `framed` from the public page's chooser.
 */
import React from "react";
import { Text } from "react-native";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { MultiDateDayChooser } from "../MultiDateDayChooser";

jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Circle: () => null,
    Path: () => null,
  }),
  { virtual: true },
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = {
  root: {
    findByProps: (props: Record<string, unknown>) => {
      props: Record<string, unknown>;
    };
  };
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const ticket = {
  id: "tier-2399",
  name: "General Admission",
  description: null,
  priceGbp: 10,
  priceAllInGbp: 10,
  currency: "GBP",
  isFree: false,
  isUnlimited: true,
  capacity: null,
  visibility: "visible" as const,
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: false,
  availableAt: "online" as const,
  displayOrder: 0,
};

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const mountBox = async (extra: Record<string, unknown> = {}) => {
  let tree!: Tree;
  await act(() => {
    tree = TestRenderer.create(
      <EventTicketBox
        event={{
          id: "event-2399",
          name: "Two Day",
          brandId: "brand-2399",
          brandSlug: "brand-2399",
          eventSlug: "two-day",
          description: "A two-day event",
          dateLine: "Two days",
          dateSubline: null,
          datesList: [],
          status: "published",
          endedAt: null,
          format: "in-person",
          venueName: "Test venue",
          address: "1 Test Street",
          hideAddressUntilTicket: false,
          coverHue: 210,
          coverMediaUrl: null,
          coverMediaType: null,
          coverCredit: null,
          currency: "GBP",
          tickets: [ticket],
          partyTypes: [],
        }}
        bookable
        palette={palette}
        theme={theme}
        variant="published"
        ticketQuantities={{ [ticket.id]: 1 }}
        onChangeTicketQuantity={() => undefined}
        onProceedToCart={() => undefined}
        {...extra}
      />,
    );
  });
  return tree;
};


const NothingToChoose: React.FC = () => null;

describe("issue #4420 — the ticket box never draws an empty leading card", () => {
  test("a leading slot that renders nothing leaves the tree as if it were absent", async () => {
    const absent = await mountBox({ leadingPurchaseSection: null });
    const empty = await mountBox({
      leadingPurchaseSection: <NothingToChoose />,
    });
    const suspended = await mountBox({
      leadingPurchaseSection: (
        <React.Suspense fallback={null}>
          <NothingToChoose />
        </React.Suspense>
      ),
    });
    const base = JSON.stringify(absent.toJSON());
    expect(JSON.stringify(empty.toJSON())).toBe(base);
    expect(JSON.stringify(suspended.toJSON())).toBe(base);
    absent.unmount();
    empty.unmount();
    suspended.unmount();
  });

  test("the framed chooser draws its own card in the palette's card colours", async () => {
    let tree!: Tree;
    await act(() => {
      tree = TestRenderer.create(
        <MultiDateDayChooser
          framed
          timezone="Europe/London"
          palette={palette}
          occurrences={[]}
          selectedOccurrenceIds={[]}
          pricingMode="all_days"
          allDaysPass
          isPaid
          highlightUnchosen={false}
          state="error"
          onToggle={() => undefined}
        />,
      );
    });
    const host = tree.root.findByProps({ testID: "issue-2135-day-chooser" });
    const flat = ([] as unknown[])
      .concat(host.props.style as unknown[])
      .flat(3)
      .reduce<Record<string, unknown>>(
        (acc, part) => (part && typeof part === "object" ? { ...acc, ...(part as object) } : acc),
        {},
      );
    expect(flat.backgroundColor).toBe(palette.card);
    expect(flat.borderColor).toBe(palette.panelBorder);
    expect(flat.borderRadius).toBe(18);
    // It says something: the heading and the recovery line, never a blank card.
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Your dates");
    expect(text).toContain("We couldn");
    tree.unmount();
  });

  test("the public page and the draft preview frame the chooser", () => {
    for (const file of ["../PublicEventPage.tsx", "../DraftEventFoundationPreview.tsx"]) {
      const source = readFileSync(path.resolve(__dirname, file), "utf8");
      expect(source).toMatch(/<MultiDateDayChooser\s+framed\b/);
    }
    const box = readFileSync(
      path.resolve(__dirname, "../../../../../packages/offering-rendering/EventOfferingBody.tsx"),
      "utf8",
    );
    expect(box).not.toMatch(/leadingCard/);
  });
});
