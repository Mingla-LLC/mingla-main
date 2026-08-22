/**
 * issue #2399 implementor happy path.
 *
 * Fails-on-revert seams: remove the leading purchase slot, restore the unscaled
 * running total, allow a zero-day total/CTA, or remove occurrence normalization.
 */
import React from "react";
import { Text } from "react-native";
import { readFileSync } from "node:fs";
import path from "node:path";

import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { normalizePublicEventOccurrences } from "../../../utils/publicEventOccurrenceTruth";

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
          currency: "GBP",
          tickets: [ticket],
        }}
        bookable
        palette={palette}
        theme={theme}
        variant="event"
        ticketQuantities={{ [ticket.id]: 1 }}
        onChangeTicketQuantity={() => undefined}
        onProceedToCart={() => undefined}
        {...extra}
      />,
    );
  });
  return tree;
};

describe("issue #2399 — multi-day decision lives inside the ticket box", () => {
  test("the app-owned chooser slot is first, then tiers, then the multiplied total", async () => {
    const tree = await mountBox({
      leadingPurchaseSection: (
        <Text testID="issue-2399-leading">Pick your days</Text>
      ),
      priceMultiplier: 2,
      purchaseReady: true,
    });
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered.indexOf("Pick your days")).toBeLessThan(
      rendered.indexOf("General Admission"),
    );
    expect(rendered).toContain("£20");
    tree.unmount();
  });

  test("zero selected days keeps Total unknown and the CTA in recovery", async () => {
    const tree = await mountBox({
      priceMultiplier: 0,
      purchaseReady: false,
      purchaseBlockedLabel: "Pick at least one day above",
    });
    expect(
      tree.root.findByProps({ testID: "orch-1167-running-total" }).props
        .children,
    ).toBe("—");
    expect(
      tree.root.findByProps({ testID: "orch-1167-box-proceed" }).props
        .accessibilityLabel,
    ).toBe("Pick at least one day above");
    tree.unmount();
  });

  test("omitting #2399 context preserves the true single-day rendered tree", async () => {
    const omitted = await mountBox();
    const explicitDefaults = await mountBox({
      leadingPurchaseSection: null,
      priceMultiplier: 1,
      purchaseReady: true,
      purchaseBlockedLabel: null,
    });
    expect(JSON.stringify(omitted.toJSON())).toBe(
      JSON.stringify(explicitDefaults.toJSON()),
    );
    omitted.unmount();
    explicitDefaults.unmount();
  });

  test("occurrence truth is valid, deduplicated, and chronological", () => {
    const rows = normalizePublicEventOccurrences(
      [
        {
          id: "day-2",
          startAt: "2026-08-30T10:00:00Z",
          endAt: "2026-08-30T17:00:00Z",
        },
        { id: "bad", startAt: "not-a-date", endAt: "2026-08-31T17:00:00Z" },
        {
          id: "day-1",
          startAt: "2026-08-29T10:00:00Z",
          endAt: "2026-08-29T17:00:00Z",
        },
        {
          id: "day-2",
          startAt: "2026-08-30T10:00:00Z",
          endAt: "2026-08-30T17:00:00Z",
        },
      ],
      "Europe/London",
    );
    expect(rows.map((row) => row.id)).toEqual(["day-1", "day-2"]);
    expect(rows.every((row) => row.ticketsRemaining === null)).toBe(true);
  });

  test("the production day-truth seam has no test-only compatibility branch", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../PublicEventPage.tsx"),
      "utf8",
    );
    const dayTruthStart = source.indexOf("  const requiresMultiDatePurchase =");
    const dayTruthEnd = source.indexOf("  const signInResumeHref", dayTruthStart);
    const chooserStart = source.indexOf("  // issue #2399 — app-local");
    const chooserEnd = source.indexOf("  // ORCH-1167-R2", chooserStart);
    expect(dayTruthStart).toBeGreaterThan(-1);
    expect(dayTruthEnd).toBeGreaterThan(dayTruthStart);
    expect(chooserStart).toBeGreaterThan(-1);
    expect(chooserEnd).toBeGreaterThan(chooserStart);
    const productionDayTruth =
      source.slice(dayTruthStart, dayTruthEnd) +
      source.slice(chooserStart, chooserEnd);
    expect(productionDayTruth).not.toMatch(/NODE_ENV|process\.env|legacyHarness/);
  });
});
