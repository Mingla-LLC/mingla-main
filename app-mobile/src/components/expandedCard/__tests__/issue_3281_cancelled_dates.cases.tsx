// Loaded by issue_3859_expired_session_guard.implementor.happy.render.test.tsx,
// the registered ticket-cart render suite, the same way as the #4174 cases.
//
// issue #3281 (bundle 3, W2) — Explorer parity with Host web for a date the
// host cancelled: the day chooser shows it disabled and labelled "Cancelled"
// (never "Sold out"), a tap does nothing, the counts skip it, it never rides to
// checkout, and the date summaries skip it.
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";

import {
  makeTicketCartProps,
  mockTicketQuote,
  mountTicketCart,
  TestRenderer,
} from "./issue_3859_ticket_cart_session_harness";
import { keepOfferedDays, ticketDayScopeLabel } from "../ticketDayScope";
import {
  noDateOnSale,
  ticketsWithNoDateOnSale,
} from "@mingla/offering-rendering/noDateOnSale";
import {
  computeOfferingVariant,
  resolveOfferingCta,
} from "@mingla/offering-rendering/offeringCta";
import {
  formatEventDateLine,
  formatOccurrenceSummary,
  formatPrimaryDateLine,
} from "../../../utils/eventDateDisplay";
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

  test("cancelled alone disables the row (soldOut false, places left)", () => {
    // The flag itself, not the server's forced sold-out, must disable the row.
    const onToggle = jest.fn();
    const renderer = mountChooser(
      [day(FRI, 29), day(SAT, 30, { cancelled: true, soldOut: false, placesLeft: 12 })],
      { onToggle },
    );
    const sat = rowOf(renderer, SAT);
    expect(sat.props.disabled).toBe(true);
    expect(sat.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(sat.props.accessibilityHint).toBe("Cancelled");
    TestRenderer.act(() => {
      sat.props.onPress();
    });
    expect(onToggle).not.toHaveBeenCalled();
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

describe("issue #3281 — a cancelled master date never leads the Explorer page", () => {
  const master = {
    masterDateUtc: "2030-08-29T10:00:00Z",
    masterEndAtUtc: "2030-08-29T17:00:00Z",
    timezone: "UTC",
  };

  test("two dates, the master cancelled: the line names the date still on", () => {
    const occurrences = [day(FRI, 29, CANCELLED), day(SAT, 30)];
    const line = formatPrimaryDateLine(master, occurrences);
    expect(line).toBe(
      formatEventDateLine({
        masterDateUtc: "2030-08-30T10:00:00Z",
        masterEndAtUtc: "2030-08-30T17:00:00Z",
        timezone: "UTC",
      }),
    );
    expect(line).not.toBe(formatEventDateLine(master));
    // One date left, so no summary: the line alone names it.
    expect(formatOccurrenceSummary(occurrences, "UTC")).toBeNull();
  });

  test("the earliest date still on leads, whatever order the dates arrive in", () => {
    const line = formatPrimaryDateLine(master, [
      day(SUN, 31),
      day(FRI, 29, CANCELLED),
      day(SAT, 30),
    ]);
    expect(line).toMatch(/30 Aug/);
  });

  test("the master still on, or another date cancelled: the master line is unchanged", () => {
    expect(formatPrimaryDateLine(master, DAYS)).toBe(formatEventDateLine(master));
    expect(formatPrimaryDateLine(master, [day(FRI, 29), day(SAT, 30)])).toBe(
      formatEventDateLine(master),
    );
  });

  test("every date cancelled: the master line stays (the page reads Sold out)", () => {
    expect(
      formatPrimaryDateLine(master, [day(FRI, 29, CANCELLED), day(SAT, 30, CANCELLED)]),
    ).toBe(formatEventDateLine(master));
  });

  test("the Explorer event page uses it for its date line on both the seed and canonical paths", () => {
    const screen = readFileSync(
      join(__dirname, "..", "..", "..", "screens", "Event", "ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    expect(screen).toMatch(/formatPrimaryDateLine\(\s*\{[\s\S]*?\},\s*validOccurrences,\s*\)/);
    expect(screen.match(/dateLine: primaryDateLine,/g)?.length).toBe(2);
    expect(screen).not.toMatch(/dateLine: seededPublicEvent\.dateLine/);
  });
});

// The quote the cart needs before its button does anything (shape from the
// #3281 extras cases).
const READY_QUOTE = {
  kind: "quote",
  currency: "USD",
  lines: [],
  listSubtotalCents: 24000,
  discountCents: 0,
  netSubtotalCents: 24000,
  dueTodayNetCents: 24000,
  dueTodayListCents: 24000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: { status: "none", reason: null, required: null },
  notices: [],
  quoteDigest: "digest-3281-cancelled",
  quoteListDigest: "list-digest-3281-cancelled",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 24000,
  calculationId: null,
  subtotalCents: 24000,
  totalCents: 24000,
};

const selection = (
  selectedEventDateIds: string[],
  pricingMode: "per_day" | "all_days" = "per_day",
) => ({
  status: "ready" as const,
  occurrences: DAYS as never,
  selectedEventDateIds,
  pricingMode,
  timezone: "UTC",
  onToggle: jest.fn(),
  onRetry: jest.fn(),
});

describe("issue #3281 — Explorer drops a date that was chosen and then cancelled", () => {
  afterEach(() => {
    mockTicketQuote.data = null;
  });

  test("the event page's day set keeps only dates still on offer (the screen's day-truth effect)", () => {
    // The guest chose Fri and Sat; the host then cancelled Sat.
    expect(keepOfferedDays([SAT, FRI], DAYS)).toEqual([FRI]);
    expect(keepOfferedDays([SAT], DAYS)).toEqual([]);
    // A date that is no longer listed at all also leaves.
    expect(keepOfferedDays([FRI, "gone"], DAYS)).toEqual([FRI]);
    // The screen applies exactly this to the guest's selection.
    const screen = readFileSync(
      join(__dirname, "..", "..", "..", "screens", "Event", "ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    expect(screen).toMatch(
      /setSelectedEventDateIds\(\(selected\) =>\s*keepOfferedDays\(selected, validOccurrences\),?\s*\)/,
    );
  });

  test("an all-days cart never sends a cancelled date it still holds", () => {
    mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        multiDaySelection: selection([SAT, SUN], "all_days"),
      }),
    );
    expect(
      (mockTicketQuote.input as { eventDateIds: string[] }).eventDateIds,
    ).toEqual([SUN]);
  });

  test("a per-day cart holding only a cancelled date asks for a day and never checks out", () => {
    mockTicketQuote.data = READY_QUOTE;
    const onCheckout = jest.fn();
    const renderer = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        onCheckout,
        multiDaySelection: selection([SAT]),
      }),
    );
    const terms = renderer.root
      .findAllByProps({ accessibilityRole: "checkbox" })
      .filter((node) => typeof node.type === "string")
      .find((node) => String(node.props.accessibilityLabel ?? "").length > 40);
    if (terms === undefined) throw new Error("no terms checkbox");
    TestRenderer.act(() => {
      terms.props.onPress();
    });
    const cta = () =>
      renderer.root
        .findAll(
          (node) =>
            typeof node.type === "string" &&
            (node.props.accessibilityState as { busy?: unknown } | undefined)
              ?.busy !== undefined,
        )[0]!;
    expect(cta().props.accessibilityLabel).toBe("Pick at least one day above");
    TestRenderer.act(() => {
      cta().props.onPress();
    });
    expect(onCheckout).not.toHaveBeenCalled();
    // Control: the same cart on a date still on offer does check out.
    const onCheckoutLive = jest.fn();
    const live = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        onCheckout: onCheckoutLive,
        multiDaySelection: selection([FRI]),
      }),
    );
    const liveTerms = live.root
      .findAllByProps({ accessibilityRole: "checkbox" })
      .filter((node) => typeof node.type === "string")
      .find((node) => String(node.props.accessibilityLabel ?? "").length > 40)!;
    TestRenderer.act(() => {
      liveTerms.props.onPress();
    });
    const liveCta = live.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        (node.props.accessibilityState as { busy?: unknown } | undefined)
          ?.busy !== undefined,
    )[0]!;
    TestRenderer.act(() => {
      liveCta.props.onPress();
    });
    expect(onCheckoutLive).toHaveBeenCalledTimes(1);
    expect(onCheckoutLive.mock.calls[0][0].eventDateIds).toEqual([FRI]);
  });
});

describe("issue #3281 — every date still to come cancelled: nothing is on sale", () => {
  const NOW = Date.parse("2030-01-01T00:00:00Z");
  const ALL_CANCELLED = DAYS.map((d) => ({ ...d, cancelled: true }));
  const ticket = {
    id: "t",
    name: "Weekend pass",
    isUnlimited: true,
    capacity: null,
    waitlistEnabled: true,
    visibility: "visible",
    isFree: false,
    priceGbp: 120,
    currency: "USD",
    saleStartAt: null,
    saleEndAt: null,
    availableAt: "online",
    passwordProtected: false,
  };

  test("noDateOnSale: only when dates remain and every one is cancelled", () => {
    expect(noDateOnSale(ALL_CANCELLED, NOW)).toBe(true);
    expect(noDateOnSale(DAYS, NOW)).toBe(false);
    expect(noDateOnSale([], NOW)).toBe(false);
    // Every date already ended: the ended state owns that page.
    expect(noDateOnSale(ALL_CANCELLED, Date.parse("2031-01-01T00:00:00Z"))).toBe(false);
  });

  test("the tickets read Sold out with no waitlist (the same CTA as Host web)", () => {
    const cta = (occurrences: readonly PublicEventOccurrenceLike[]) => {
      const tickets = ticketsWithNoDateOnSale([ticket], occurrences, NOW);
      return resolveOfferingCta({
        variant: computeOfferingVariant(
          { status: "published", tickets } as never,
          false,
        ),
        bookable: true,
        tickets: tickets as never,
        currency: "USD",
      });
    };
    expect(cta(ALL_CANCELLED)).toMatchObject({
      kind: "unavailable",
      title: "Sold out",
      tappable: false,
    });
    expect(cta(DAYS).kind).toBe("buy");
  });

  test("the Explorer event page sells through that rule on a multi-date event", () => {
    const screen = readFileSync(
      join(__dirname, "..", "..", "..", "screens", "Event", "ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    expect(screen).toMatch(
      /validatedDayCanonical\?\.isMultiDate === true\s*\?\s*ticketsWithNoDateOnSale\(decoratedTickets, validOccurrences\)/,
    );
    // The body (and its buy bar) reads the decorated list, not the raw one.
    expect(screen).toMatch(/event=\{publicEventForBody\}/);
  });
});
