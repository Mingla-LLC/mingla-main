/**
 * issue #3281 (bundle 3, W2) — a buyer sees a cancelled date as cancelled.
 *
 * The bundle reader keeps a cancelled date in `occurrences[]` with
 * `cancelled: true` (and forces soldOut / placesLeft 0 for older builds). On
 * buyer web:
 *   - the normalizer carries the flag (a missing key reads as active),
 *   - the day chooser shows the row disabled, labelled "Cancelled" (never
 *     "Sold out"), and tapping it does nothing,
 *   - the day counts, an all-days pass, the extras' all-days date set and the
 *     date summaries never count a cancelled date,
 *   - the "date no longer available" copy is true for a past AND a cancelled
 *     date.
 *
 * Fails on revert: drop `cancelled` from the normalizer and every chooser /
 * summary assertion below reads the date as on offer again.
 */
import React from "react";

import { extrasCartDates } from "@mingla/offering-rendering/ticketExtrasCart";
import {
  chooseEventDateLayout,
  isCancelledOccurrence,
} from "@mingla/offering-rendering/eventDateSchedule";

import DayChooser from "../MultiDateDayChooser";
import type { PublicEventOccurrence } from "../../../services/publicEventOccurrencesService";
import { normalizePublicEventOccurrences } from "../../../utils/publicEventOccurrenceTruth";
import {
  formatOccurrenceSummary,
  resolveChosenDaysLine,
  resolvePublicEventDateDisplay,
  type EventDateLike,
} from "../../../utils/eventDateDisplay";
import { ticketDayView } from "../../../utils/ticketDayOffer";
import { guestListErrorCopy } from "../../../services/guestListService";
import {
  checkoutRefusalRaiseMessage,
  freeCheckoutErrorMessage,
} from "../../../services/checkoutErrorCopy";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { props: Record<string, unknown> };
type Tree = {
  root: { findAllByProps: (props: Record<string, unknown>) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};

// react-test-renderer does not ship declarations in this workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const palette = {
  primaryText: "#ffffff",
  secondaryText: "#dddddd",
  tertiaryText: "#bbbbbb",
  accent: "#eb7825",
  accentText: "#111111",
  accentWash: "#2f2420",
  panelBorder: "#444444",
};

// Far enough ahead to survive the picker's upcoming filter.
const FRI = "day-fri";
const SAT = "day-sat";
const SUN = "day-sun";
const rawRow = (id: string, day: number, extra: Record<string, unknown> = {}) => ({
  id,
  startAt: `2030-08-${day}T10:00:00Z`,
  endAt: `2030-08-${day}T17:00:00Z`,
  timezone: "Europe/London",
  isMaster: day === 29,
  ...extra,
});

// The server's shape for a cancelled date: forced sold out with zero places.
const cancelledRaw = { cancelled: true, soldOut: true, placesLeft: 0 };

const occurrences = normalizePublicEventOccurrences(
  [rawRow(FRI, 29), rawRow(SAT, 30, cancelledRaw), rawRow(SUN, 31)],
  "Europe/London",
);

const mount = async (
  rows: readonly PublicEventOccurrence[],
  opts: {
    pricingMode?: "per_day" | "all_days";
    selected?: string[];
    onToggle?: (id: string) => void;
    tickets?: unknown[];
  } = {},
): Promise<Tree> => {
  let tree!: Tree;
  await act(() => {
    tree = TestRenderer.create(
      <DayChooser
        timezone="Europe/London"
        palette={palette as never}
        occurrences={rows}
        selectedOccurrenceIds={opts.selected ?? []}
        pricingMode={opts.pricingMode ?? "per_day"}
        isPaid
        highlightUnchosen={false}
        onToggle={opts.onToggle ?? (() => undefined)}
        tickets={opts.tickets as never}
      />,
    );
  });
  return tree;
};

const row = (tree: Tree, id: string): Node => {
  const rows = tree.root.findAllByProps({ testID: `issue-2135-day-row-${id}` });
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
};

describe("issue #3281 — normalizer carries the cancelled flag", () => {
  test("cancelled: true maps; a missing or non-boolean key reads as active", () => {
    const rows = normalizePublicEventOccurrences(
      [
        rawRow(FRI, 29),
        rawRow(SAT, 30, { cancelled: true }),
        rawRow(SUN, 31, { cancelled: "yes" }),
      ],
      null,
    );
    expect(rows.map((r) => [r.id, r.cancelled])).toEqual([
      [FRI, false],
      [SAT, true],
      [SUN, false],
    ]);
  });
});

describe("issue #3281 — web day chooser shows a cancelled date as Cancelled", () => {
  test("the row is disabled and reads Cancelled, never Sold out", async () => {
    const tree = await mount(occurrences);
    const sat = row(tree, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(sat.props.accessibilityHint).toBe("Cancelled");
    expect(row(tree, FRI).props.disabled).toBe(false);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("Cancelled");
    expect(text).not.toContain("Sold out");
    tree.unmount();
  });

  test("cancelled alone disables the row (soldOut false, places left)", async () => {
    // The flag itself, not the server's forced sold-out, must disable the row.
    const rows = normalizePublicEventOccurrences(
      [
        rawRow(FRI, 29),
        rawRow(SAT, 30, { cancelled: true, soldOut: false, placesLeft: 12 }),
      ],
      "Europe/London",
    );
    const onToggle = jest.fn();
    const tree = await mount(rows, { onToggle });
    const sat = row(tree, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(sat.props.accessibilityHint).toBe("Cancelled");
    await act(() => {
      (sat.props.onPress as () => void)();
    });
    expect(onToggle).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("tapping the cancelled row is a no-op; an active row still toggles", async () => {
    const onToggle = jest.fn();
    const tree = await mount(occurrences, { onToggle });
    await act(() => {
      (row(tree, SAT).props.onPress as () => void)();
    });
    expect(onToggle).not.toHaveBeenCalled();
    await act(() => {
      (row(tree, FRI).props.onPress as () => void)();
    });
    expect(onToggle).toHaveBeenCalledWith(FRI);
    tree.unmount();
  });

  test("a ticket caption never overrides Cancelled on that date", async () => {
    // A day-limited ticket the server lists as sold out on the cancelled date.
    const tickets = [
      {
        visibility: "public",
        validOccurrenceIds: [FRI, SAT, SUN],
        soldOutOccurrenceIds: [SAT],
      },
    ];
    const tree = await mount(occurrences, { tickets });
    expect(row(tree, SAT).props.accessibilityHint).toBe("Cancelled");
    tree.unmount();
  });

  test("the day count counts only dates on offer", async () => {
    const none = await mount(occurrences);
    expect(JSON.stringify(none.toJSON())).toContain("2 days");
    none.unmount();
    const one = await mount(occurrences, { selected: [FRI] });
    expect(JSON.stringify(one.toJSON())).toContain("Priced per day · 1 of 2 selected");
    one.unmount();
  });

  test("an all-days pass counts only the dates still on", async () => {
    const tree = await mount(occurrences, { pricingMode: "all_days" });
    expect(JSON.stringify(tree.toJSON())).toContain('"Pass — all ","2"," dates"');
    tree.unmount();
  });

  test("an all-days pass whose every date is cancelled offers no dates", async () => {
    const allCancelled = normalizePublicEventOccurrences(
      [rawRow(FRI, 29, cancelledRaw), rawRow(SAT, 30, cancelledRaw)],
      "Europe/London",
    );
    const tree = await mount(allCancelled, { pricingMode: "all_days" });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("No upcoming dates.");
    expect(text).not.toContain("Pass — all");
    tree.unmount();
  });

  test("an older server (soldOut: true, no cancelled key) still disables the row", async () => {
    const legacy = normalizePublicEventOccurrences(
      [rawRow(FRI, 29), rawRow(SAT, 30, { soldOut: true, placesLeft: 0 })],
      "Europe/London",
    );
    expect(legacy[1]!.cancelled).toBe(false);
    const onToggle = jest.fn();
    const tree = await mount(legacy, { onToggle });
    const sat = row(tree, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityHint).toBe("Sold out");
    tree.unmount();
  });
});

describe("issue #3281 — shared schedule helpers skip a cancelled date", () => {
  test("isCancelledOccurrence reads only an explicit true", () => {
    expect(isCancelledOccurrence({ cancelled: true })).toBe(true);
    expect(isCancelledOccurrence({ cancelled: false })).toBe(false);
    expect(isCancelledOccurrence({})).toBe(false);
  });

  test("a pass layout with every upcoming date cancelled is empty", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(
      chooseEventDateLayout(occurrences, { allDaysPass: true, nowMs: now }).kind,
    ).toBe("pass");
    expect(
      chooseEventDateLayout(
        occurrences.map((o) => ({ ...o, cancelled: true })),
        { allDaysPass: true, nowMs: now },
      ).kind,
    ).toBe("empty");
  });

  test("an all-days cart's extras never read a cancelled date", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    expect(extrasCartDates([], occurrences, true, now)).toEqual([FRI, SUN]);
    // A per-day cart reads the guest's own (never-cancelled) choice.
    expect(extrasCartDates([FRI], occurrences, false, now)).toEqual([FRI]);
  });
});

describe("issue #3281 — date summaries skip a cancelled date", () => {
  const event: EventDateLike = {
    whenMode: "multi_date",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
  };

  test("formatOccurrenceSummary counts and starts from dates on offer", () => {
    const firstCancelled = normalizePublicEventOccurrences(
      [rawRow(FRI, 29, cancelledRaw), rawRow(SAT, 30), rawRow(SUN, 31)],
      "Europe/London",
    );
    expect(formatOccurrenceSummary(firstCancelled, "Europe/London")).toMatch(
      /^2 dates · first \S+ 30 Aug$/,
    );
  });

  test("the public page lists only dates on offer", () => {
    const display = resolvePublicEventDateDisplay(event, occurrences);
    expect(display.datesList).toHaveLength(2);
    expect(display.datesList.join(" ")).not.toContain("30 Aug");
    expect(display.dateSubline).toMatch(/^2 dates · first \S+ 29 Aug$/);
  });

  test("a page whose every date is cancelled claims no dates", () => {
    const allCancelled = occurrences.map((o) => ({ ...o, cancelled: true }));
    expect(formatOccurrenceSummary(allCancelled, "Europe/London")).toBeNull();
    const display = resolvePublicEventDateDisplay(event, allCancelled);
    expect(display.datesList).toEqual([]);
    expect(display.dateLine).toBe("Date TBD");
    expect(resolveChosenDaysLine(event, allCancelled, [])).toBe("Date TBD");
  });

  test("a ticket's day scope ignores a cancelled date", () => {
    // On every date still on offer, so it reads like All dates.
    expect(
      ticketDayView([FRI, SUN], occurrences, [], false, "Europe/London").dayScopeLabel,
    ).toBeNull();
  });
});

describe("issue #3281 — date-unavailable copy is true for a cancelled date", () => {
  test("guest list and checkout no longer say the date has passed", () => {
    const guest = guestListErrorCopy("occurrence_not_available", "issue");
    expect(guest).toBe("That date is no longer available. Pick another one.");
    const refusal = Object.assign(new Error("non-2xx"), {
      status: 409,
      code: "checkout_session_failed",
      detail: "occurrence_not_available",
    });
    const free = freeCheckoutErrorMessage(refusal);
    expect(free).toBe(
      "That day is no longer available to book. Pick another day \u2014 nothing was reserved.",
    );
    // The native paid rail reads the same sentence.
    expect(checkoutRefusalRaiseMessage("occurrence_not_available")).toBe(free);
    expect(`${guest} ${free}`).not.toMatch(/passed|already finished/);
  });
});
