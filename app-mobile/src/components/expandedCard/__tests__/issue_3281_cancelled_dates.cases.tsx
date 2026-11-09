// Loaded by issue_3859_expired_session_guard.implementor.happy.render.test.tsx,
// the registered ticket-cart render suite, the same way as the #4174 cases.
//
// issue #3281 (bundle 3, W2) — Explorer parity with Host web for a date the
// host cancelled: the day chooser shows it disabled and labelled "Cancelled"
// (never "Sold out"), a tap does nothing, the counts skip it, it never rides to
// checkout, and the date summaries skip it.
import React from "react";

import {
  makeTicketCartProps,
  mockTicketQuote,
  mountTicketCart,
  TestRenderer,
} from "./issue_3859_ticket_cart_session_harness";
import { ticketDayScopeLabel } from "../ticketDayScope";
import { formatOccurrenceSummary } from "../../../utils/eventDateDisplay";
import type { PublicEventOccurrenceLike } from "../../../hooks/usePublicEventBySlug";
import type { EventDayChooserProps } from "../EventDayChooser";

// The harness stands the chooser in for the cart; these cases need the real one.
const { EventDayChooser } = jest.requireActual("../EventDayChooser") as {
  EventDayChooser: React.FC<EventDayChooserProps>;
};

const FRI = "day-fri";
const SAT = "day-sat";
const SUN = "day-sun";
// Far enough ahead to survive the picker's upcoming filter.
const day = (
  id: string,
  date: number,
  extra: Partial<PublicEventOccurrenceLike> = {},
): PublicEventOccurrenceLike => ({
  id,
  startAt: `2030-08-${date}T10:00:00Z`,
  endAt: `2030-08-${date}T17:00:00Z`,
  timezone: "UTC",
  isMaster: date === 29,
  ...extra,
});
// The server's shape for a cancelled date: forced sold out with zero places.
const CANCELLED = { cancelled: true, soldOut: true, placesLeft: 0 };
const DAYS = [day(FRI, 29), day(SAT, 30, CANCELLED), day(SUN, 31)];

const signedIn = {
  buyerUserId: "account-3281",
  buyerName: "Seth Explorer",
  buyerEmail: "seth@example.test",
  buyerPhone: "+15555550123",
};

type Renderer = ReturnType<typeof TestRenderer.create>;

const mountChooser = (
  occurrences: readonly PublicEventOccurrenceLike[],
  opts: {
    pricingMode?: "per_day" | "all_days";
    selected?: string[];
    onToggle?: (id: string) => void;
    captions?: Record<string, string>;
  } = {},
): Renderer => {
  let renderer: Renderer | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <EventDayChooser
        occurrences={occurrences}
        selectedEventDateIds={opts.selected ?? []}
        pricingMode={opts.pricingMode ?? "per_day"}
        isPaid
        timezone="UTC"
        status="ready"
        highlightUnchosen={false}
        onToggle={opts.onToggle ?? jest.fn()}
        onRetry={jest.fn()}
        captions={opts.captions}
      />,
    );
  });
  if (renderer === null) throw new Error("EventDayChooser did not mount");
  return renderer;
};

const rowOf = (renderer: Renderer, id: string) =>
  renderer.root.findByProps({ testID: `issue-2230-day-row-${id}` });
const textOf = (renderer: Renderer): string =>
  JSON.stringify(renderer.toJSON());

describe("issue #3281 — Explorer day chooser shows a cancelled date as Cancelled", () => {
  test("the row is disabled and reads Cancelled, never Sold out", () => {
    const renderer = mountChooser(DAYS);
    const sat = rowOf(renderer, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(sat.props.accessibilityHint).toBe("Cancelled");
    expect(rowOf(renderer, FRI).props.disabled).toBe(false);
    expect(textOf(renderer)).toContain("Cancelled");
    expect(textOf(renderer)).not.toContain("Sold out");
  });

  test("tapping the cancelled row is a no-op; an active row still toggles", () => {
    const onToggle = jest.fn();
    const renderer = mountChooser(DAYS, { onToggle });
    TestRenderer.act(() => {
      rowOf(renderer, SAT).props.onPress();
    });
    expect(onToggle).not.toHaveBeenCalled();
    TestRenderer.act(() => {
      rowOf(renderer, FRI).props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(FRI);
  });

  test("a ticket caption never overrides Cancelled on that date", () => {
    const renderer = mountChooser(DAYS, { captions: { [SAT]: "Sold out" } });
    expect(rowOf(renderer, SAT).props.accessibilityHint).toBe("Cancelled");
  });

  test("the day count counts only dates on offer (same copy as web)", () => {
    expect(textOf(mountChooser(DAYS))).toContain("2 days");
    expect(textOf(mountChooser(DAYS, { selected: [FRI] }))).toContain(
      "Priced per day · 1 of 2 selected",
    );
  });

  test("an all-days pass counts only the dates still on, and none when all are cancelled", () => {
    expect(textOf(mountChooser(DAYS, { pricingMode: "all_days" }))).toContain(
      '"Pass — all ","2"," dates"',
    );
    const allCancelled = DAYS.map((d) => ({ ...d, ...CANCELLED }));
    const text = textOf(mountChooser(allCancelled, { pricingMode: "all_days" }));
    expect(text).toContain("No upcoming dates.");
    expect(text).not.toContain("Pass — all");
  });

  test("an older server (soldOut: true, no cancelled key) still disables the row as Sold out", () => {
    const legacy = [day(FRI, 29), day(SAT, 30, { soldOut: true, placesLeft: 0 })];
    const onToggle = jest.fn();
    const renderer = mountChooser(legacy, { onToggle });
    const sat = rowOf(renderer, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityHint).toBe("Sold out");
  });
});

describe("issue #3281 — Explorer never sends or counts a cancelled date", () => {
  test("a cancelled date in the selection never rides to the quote", () => {
    mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        multiDaySelection: {
          status: "ready" as const,
          occurrences: DAYS as never,
          // A stale selection that still holds the now-cancelled Saturday.
          selectedEventDateIds: [FRI, SAT],
          pricingMode: "per_day" as const,
          timezone: "UTC",
          onToggle: jest.fn(),
          onRetry: jest.fn(),
        },
      }),
    );
    expect(
      (mockTicketQuote.input as { eventDateIds: string[] }).eventDateIds,
    ).toEqual([FRI]);
  });

  test("a ticket's day scope ignores a cancelled date", () => {
    // On every date still on offer, so it reads like All dates.
    expect(ticketDayScopeLabel([FRI, SUN], DAYS, "UTC")).toBeNull();
    expect(ticketDayScopeLabel([FRI], DAYS, "UTC")).not.toBeNull();
  });

  test("the occurrence summary counts and starts from dates on offer", () => {
    const firstCancelled = [day(FRI, 29, CANCELLED), day(SAT, 30), day(SUN, 31)];
    expect(formatOccurrenceSummary(firstCancelled, "UTC")).toMatch(
      /^2 dates · first \S+ 30 Aug$/,
    );
    // A page whose remaining dates are all cancelled claims none.
    expect(
      formatOccurrenceSummary(DAYS.map((d) => ({ ...d, cancelled: true })), "UTC"),
    ).toBeNull();
  });
});
