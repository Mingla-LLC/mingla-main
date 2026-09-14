/**
 * issue #3344 — the guest preview showed "$35" with no "per day" on a
 * multi-date event priced Per day, while the live page shows "$35 per day".
 *
 * Found filming Scene 04 (2026-09-14). The live page (PublicEventPage) passes
 * the #2160 price note to the shared ticket box; the organiser's preview
 * (DraftEventFoundationPreview) mounts the same box and never passed it.
 *
 * Mounts the REAL preview component with the shared ticket box, the Foundation
 * wrapper and the day chooser replaced by probes, and reads the note each one
 * receives.
 *
 * Fails on revert: drop `pricingNote` from either mount and that probe gets
 * undefined.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { PublicEventProps } from "@mingla/offering-rendering";
import type { PublicEventOccurrence } from "../../../services/publicEventOccurrencesService";
import { multiDatePricingNote } from "../../../utils/multiDatePricingMode";

const mockLayout = { isDesktop: false };

jest.mock("@mingla/offering-rendering", () => {
  // The barrel is mapped to the real-helpers manual mock; keep those helpers
  // and swap only the two things this suite reads.
  const actual = jest.requireActual("@mingla/offering-rendering") as Record<string, unknown>;
  const ReactLocal = jest.requireActual("react") as typeof React;
  return {
    ...actual,
    EventTicketBox: (props: Record<string, unknown>) =>
      ReactLocal.createElement("TicketBoxProbe", props),
    useResponsiveLayout: () => mockLayout,
  };
});
jest.mock("../FoundationEventPreview", () => ({
  // Mount the desktop sticky panel as a child so its ticket box is in the tree.
  FoundationEventPreview: (props: Record<string, unknown>) =>
    React.createElement("FoundationProbe", props, props.stickyPanel as React.ReactNode),
}));
jest.mock("../MultiDateDayChooser", () => ({
  MultiDateDayChooser: (): null => null,
}));
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: (): void => undefined }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// eslint-disable-next-line import/first
import { DraftEventFoundationPreview } from "../DraftEventFoundationPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Probe = { props: Record<string, unknown> };
type Tree = {
  root: { findAllByType: (type: string) => Probe[] };
  unmount: () => void;
};
// The repo intentionally carries no react-test-renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const ticket = (priceGbp: number | null, isFree = false) => ({
  id: `tier-${priceGbp ?? "free"}`,
  name: "Day pass",
  description: null,
  priceGbp,
  priceAllInGbp: priceGbp,
  currency: "USD",
  isFree,
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
});

const event = (tickets: ReturnType<typeof ticket>[]): PublicEventProps =>
  ({
    id: "event-3344",
    name: "Two Day Demo",
    status: "published",
    currency: "USD",
    tickets,
    coverMediaUrl: null,
    coverMediaType: null,
    themeOverrides: null,
  }) as unknown as PublicEventProps;

const days: PublicEventOccurrence[] = [
  { id: "day-1", startAt: "2026-10-13T18:00:00Z", endAt: "2026-10-13T23:00:00Z" },
  { id: "day-2", startAt: "2026-10-14T18:00:00Z", endAt: "2026-10-14T23:00:00Z" },
] as unknown as PublicEventOccurrence[];

const mount = async (input: {
  tickets: ReturnType<typeof ticket>[];
  isMultiDate: boolean;
  mode: "per_day" | "all_days";
  occurrences?: PublicEventOccurrence[];
}): Promise<Tree> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <DraftEventFoundationPreview
        event={event(input.tickets)}
        brand={null}
        occurrences={input.occurrences ?? days}
        isMultiDate={input.isMultiDate}
        multiDatePricingMode={input.mode}
        onClose={() => undefined}
        onShare={() => undefined}
        onCheckout={() => undefined}
        onBlocked={() => undefined}
      />,
    );
  });
  return tree;
};

const noteOn = (tree: Tree, probe: "FoundationProbe" | "TicketBoxProbe"): unknown => {
  const found = tree.root.findAllByType(probe);
  expect(found).toHaveLength(1);
  return found[0].props.pricingNote;
};

describe("#3344 preview price note matches the live page", () => {
  beforeEach(() => {
    mockLayout.isDesktop = false;
  });

  test("phone: a paid multi-date event priced Per day says 'per day'", async () => {
    const tree = await mount({ tickets: [ticket(35)], isMultiDate: true, mode: "per_day" });
    expect(noteOn(tree, "FoundationProbe")).toBe("per day");
    await TestRenderer.act(() => tree.unmount());
  });

  test("phone: one price for all days says 'for all days'", async () => {
    const tree = await mount({ tickets: [ticket(35)], isMultiDate: true, mode: "all_days" });
    expect(noteOn(tree, "FoundationProbe")).toBe("for all days");
    await TestRenderer.act(() => tree.unmount());
  });

  test("desktop: the sticky ticket box gets the same note", async () => {
    mockLayout.isDesktop = true;
    const tree = await mount({ tickets: [ticket(35)], isMultiDate: true, mode: "per_day" });
    expect(noteOn(tree, "TicketBoxProbe")).toBe("per day");
    expect(noteOn(tree, "FoundationProbe")).toBe("per day");
    await TestRenderer.act(() => tree.unmount());
  });

  test("nothing to qualify: single-date, free, and one-day events get no note", async () => {
    for (const input of [
      { tickets: [ticket(35)], isMultiDate: false, mode: "per_day" as const },
      { tickets: [ticket(null, true)], isMultiDate: true, mode: "per_day" as const },
      { tickets: [ticket(35)], isMultiDate: true, mode: "per_day" as const, occurrences: days.slice(0, 1) },
    ]) {
      const tree = await mount(input);
      expect(noteOn(tree, "FoundationProbe")).toBeNull();
      await TestRenderer.act(() => tree.unmount());
    }
  });

  test("the rule is the live page's #2160 rule, case for case", () => {
    const paid = [{ priceGbp: 35 }];
    const free = [{ priceGbp: null }, { priceGbp: 0 }];
    expect(multiDatePricingNote({ hasDayChoice: true, tickets: paid, pricingMode: "per_day" })).toBe("per day");
    expect(multiDatePricingNote({ hasDayChoice: true, tickets: paid, pricingMode: "all_days" })).toBe("for all days");
    expect(multiDatePricingNote({ hasDayChoice: false, tickets: paid, pricingMode: "per_day" })).toBeNull();
    expect(multiDatePricingNote({ hasDayChoice: true, tickets: free, pricingMode: "per_day" })).toBeNull();
    expect(multiDatePricingNote({ hasDayChoice: true, tickets: [], pricingMode: "all_days" })).toBeNull();
  });
});
