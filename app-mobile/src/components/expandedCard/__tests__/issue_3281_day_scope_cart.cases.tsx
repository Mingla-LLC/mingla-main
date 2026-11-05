// Loaded by issue_3859_expired_session_guard.implementor.happy.render.test.tsx,
// the registered ticket-cart render suite, the same way as the #4174 cases.
import {
  makeTicketCartProps,
  mockTicketQuote,
  mountTicketCart,
  renderedText,
  TestRenderer,
  updateTicketCart,
} from "./issue_3859_ticket_cart_session_harness";
import {
  dayChooserCaptions,
  removedTicketsNotice,
  ticketDayScopeLabel,
  ticketOffChosenDays,
} from "../ticketDayScope";

// #3281 day-limited tickets on Explorer: day captions, and the notice with
// Undo when a day change takes tickets out of the cart.
const FRI = "day-fri";
const SAT = "day-sat";
const occurrence = (id: string, index: number) => ({
  id,
  startAt: `2027-03-0${index + 5}T18:00:00Z`,
  endAt: `2027-03-0${index + 5}T22:00:00Z`,
  timezone: "UTC",
  isMaster: index === 0,
});
const OCCURRENCES = [FRI, SAT].map(occurrence);
const signedIn = {
  buyerUserId: "account-3281",
  buyerName: "Seth Explorer",
  buyerEmail: "seth@example.test",
  buyerPhone: "+15555550123",
};
const baseTicket = (makeTicketCartProps().tickets ?? [])[0];
const selection = (selected: string[], onToggle = jest.fn()) => ({
  status: "ready" as const,
  occurrences: OCCURRENCES as never,
  selectedEventDateIds: selected,
  pricingMode: "per_day" as const,
  timezone: "UTC",
  onToggle,
  onRetry: jest.fn(),
});
const fridayOnly = (extra: Record<string, unknown> = {}) =>
  [{ ...baseTicket, validOccurrenceIds: [FRI], ...extra }] as never;

type Line = { quantity: number };
const lineQuantity = (): number =>
  ((mockTicketQuote.input as { lines: Line[] } | null)?.lines ?? [])[0]?.quantity ?? 0;

describe("issue #3281 — Explorer day-limited tickets", () => {
  test("a date no ticket covers says No tickets; a date whose tickets are full says Sold out", () => {
    const renderer = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        tickets: fridayOnly(),
        multiDaySelection: selection([FRI]),
      }),
    );
    const chooser = renderer.root.findAllByType("EventDayChooser" as never)[0];
    expect(chooser.props.captions).toEqual({ [SAT]: "No tickets" });

    const soldOut = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        tickets: fridayOnly({ soldOutOccurrenceIds: [FRI] }),
        multiDaySelection: selection([SAT]),
      }),
    );
    expect(
      soldOut.root.findAllByType("EventDayChooser" as never)[0].props.captions,
    ).toEqual({ [FRI]: "Sold out", [SAT]: "No tickets" });
  });

  test("a day change that takes tickets out says so, and Undo brings the day and the tickets back", () => {
    const onToggle = jest.fn();
    const props = makeTicketCartProps({
      ...signedIn,
      tickets: fridayOnly(),
      multiDaySelection: selection([FRI, SAT], onToggle),
    });
    const renderer = mountTicketCart(props);
    expect(lineQuantity()).toBe(2);

    // The guest unticks Friday: the Friday-only ticket leaves the cart.
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([SAT], onToggle) });
    expect(lineQuantity()).toBe(0);
    const notice = renderer.root.findAllByProps({ testID: "issue-3281-scope-notice" });
    expect(notice.length).toBeGreaterThan(0);
    expect(renderedText(renderer).join(" ")).toContain("Removed 2 × Weekend pass — it's only for");

    // Undo asks for Friday back; once it is back, so are the tickets.
    TestRenderer.act(() => {
      renderer.root.findByProps({ accessibilityLabel: "Undo" }).props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(FRI);
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([FRI, SAT], onToggle) });
    expect(lineQuantity()).toBe(2);
    expect(renderer.root.findAllByProps({ testID: "issue-3281-scope-notice" })).toHaveLength(0);
  });

  test("Undo brings back the whole cart: split counts on other tickets too", () => {
    const onToggle = jest.fn();
    const ALL = "ticket-all-dates";
    const tickets = [
      { ...baseTicket, validOccurrenceIds: [FRI] },
      { ...baseTicket, id: ALL, name: "Day pass", validOccurrenceIds: null },
    ] as never;
    const props = makeTicketCartProps({
      ...signedIn,
      tickets,
      initialTicketTypeId: null as never,
      initialQuantities: { [baseTicket.id]: 2, [ALL]: 2 } as never,
      multiDaySelection: selection([FRI, SAT], onToggle),
    });
    const renderer = mountTicketCart(props);
    // Split per date: the day pass is Friday 1, Saturday 3.
    TestRenderer.act(() => {
      renderer.root.findAllByType("Switch" as never)[0].props.onValueChange(false);
    });
    const rowFor = (dateId: string, ticketId: string) =>
      renderer.root
        .findByProps({ testID: `issue-3281-date-${dateId}` })
        .findAllByType("QuantityRow" as never)
        .find((row) => row.props.ticket.id === ticketId)!;
    TestRenderer.act(() => { rowFor(FRI, ALL).props.onQuantityChange(1); });
    TestRenderer.act(() => { rowFor(SAT, ALL).props.onQuantityChange(3); });
    const lines = () =>
      (mockTicketQuote.input as { lines: Array<{ ticketTypeId: string; quantity: number; byDate?: Record<string, number> }> }).lines;
    // Line order is not part of the cart; compare by ticket.
    const sorted = () =>
      JSON.stringify([...lines()].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId)));
    const before = sorted();

    // Friday goes: the Friday-only ticket leaves, and the day pass folds back.
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([SAT], onToggle) });
    expect(lines().some((line) => line.ticketTypeId === baseTicket.id)).toBe(false);

    TestRenderer.act(() => {
      renderer.root.findByProps({ accessibilityLabel: "Undo" }).props.onPress();
    });
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([FRI, SAT], onToggle) });
    expect(sorted()).toBe(before);
    expect(lines().find((line) => line.ticketTypeId === ALL)).toMatchObject({
      quantity: 4,
      byDate: { [FRI]: 1, [SAT]: 3 },
    });
  });

  test("Undo brings back the extras the guest picked", () => {
    const onToggle = jest.fn();
    const DINNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const props = makeTicketCartProps({
      ...signedIn,
      tickets: fridayOnly({
        buyerExtras: [{
          id: DINNER, name: "Dinner", description: null, priceCents: 1500,
          priceAllInCents: 1500, maxPerTicket: 1, isUnlimited: true,
          validOccurrenceIds: [FRI], remaining: null,
        }],
      }),
      multiDaySelection: selection([FRI, SAT], onToggle),
    });
    const renderer = mountTicketCart(props);
    TestRenderer.act(() => {
      renderer.root.findByProps({ accessibilityLabel: "Add one Dinner to Weekend pass" }).props.onPress();
    });
    const addOns = () =>
      ((mockTicketQuote.input as { lines: Array<{ addOns?: unknown }> }).lines[0] ?? {}).addOns;
    expect(addOns()).toEqual([{ addOnId: DINNER, quantity: 1 }]);

    updateTicketCart(renderer, { ...props, multiDaySelection: selection([SAT], onToggle) });
    TestRenderer.act(() => {
      renderer.root.findByProps({ accessibilityLabel: "Undo" }).props.onPress();
    });
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([FRI, SAT], onToggle) });
    expect(addOns()).toEqual([{ addOnId: DINNER, quantity: 1 }]);
  });

  test("a day change while the cart is open keeps an edited surviving line", () => {
    const onToggle = jest.fn();
    const ALL = "ticket-all-dates";
    const seed = { [baseTicket.id]: 2, [ALL]: 2 };
    const props = makeTicketCartProps({
      ...signedIn,
      tickets: [
        { ...baseTicket, validOccurrenceIds: [FRI] },
        { ...baseTicket, id: ALL, name: "Day pass", validOccurrenceIds: null },
      ] as never,
      initialTicketTypeId: null as never,
      initialQuantities: seed as never,
      multiDaySelection: selection([FRI, SAT], onToggle),
    });
    const renderer = mountTicketCart(props);
    // The guest raises the day pass to 5 in the cart.
    TestRenderer.act(() => {
      renderer.root
        .findAllByType("QuantityRow" as never)
        .find((row) => row.props.ticket.id === ALL)!
        .props.onQuantityChange(5);
    });
    // Friday goes; the screen keeps the seed it opened with.
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([SAT], onToggle) });
    const pass = (mockTicketQuote.input as { lines: Array<{ ticketTypeId: string; quantity: number }> })
      .lines.find((line) => line.ticketTypeId === ALL);
    expect(pass?.quantity).toBe(5);
  });

  test("Undo is off while checkout is submitting", () => {
    const onToggle = jest.fn();
    const props = makeTicketCartProps({
      ...signedIn,
      tickets: fridayOnly(),
      multiDaySelection: selection([FRI, SAT], onToggle),
    });
    const renderer = mountTicketCart(props);
    updateTicketCart(renderer, { ...props, multiDaySelection: selection([SAT], onToggle) });
    updateTicketCart(renderer, {
      ...props,
      isSubmitting: true,
      multiDaySelection: selection([SAT], onToggle),
    });
    const undo = renderer.root.findAllByProps({ accessibilityLabel: "Undo" })[0];
    expect(undo.props.disabled).toBe(true);
    TestRenderer.act(() => { undo.props.onPress(); });
    expect(onToggle).not.toHaveBeenCalled();
  });

  test("the event page decorates tickets from either source, deck and chat arrivals included", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const screen = readFileSync(
      join(__dirname, "../../../screens/Event/ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    // The scope fields are added after the canonical-or-seeded choice.
    expect(screen).toMatch(
      /const publicEventForBody: PublicEventProps = \{\s*\.\.\.sourcedPublicEvent,\s*tickets: sourcedPublicEvent\.tickets\.map/,
    );
  });

  test("the event page counts and carries only tickets on the guest's days", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const screen = readFileSync(
      join(__dirname, "../../../screens/Event/ConsumerEventDetailScreen.tsx"),
      "utf8",
    );
    // The ticket box, the floating bar and the cart all read the same filtered set.
    expect(screen.match(/ticketQuantities=\{onDayTicketQuantities\}/g)).toHaveLength(2);
    // The cart is seeded from that set frozen at the opening render, so a day
    // change while it is open can't re-seed over the guest's edits.
    expect(screen).toContain("initialQuantities={cartSeedQuantitiesRef.current}");
    expect(screen).toMatch(
      /if \(!cartVisible \|\| !cartWasVisibleRef\.current\) \{\s*cartSeedQuantitiesRef\.current = onDayTicketQuantities;/,
    );
    // Both refs are hooks: declared above the screen's first early return, so
    // a loading render and a loaded one call the same hooks in the same order.
    const firstEarlyReturn = screen.indexOf("\n    return (");
    expect(firstEarlyReturn).toBeGreaterThan(0);
    for (const ref of ["const cartSeedQuantitiesRef = useRef", "const cartWasVisibleRef = useRef"]) {
      const at = screen.indexOf(ref);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(firstEarlyReturn);
    }
    expect(screen).not.toMatch(/ticketQuantities=\{ticketQuantities\}/);
  });

  test("the helpers say nothing for an All dates ticket", () => {
    expect(ticketDayScopeLabel(null, OCCURRENCES as never, "UTC")).toBeNull();
    expect(ticketDayScopeLabel([FRI, SAT], OCCURRENCES as never, "UTC")).toBeNull();
    expect(ticketDayScopeLabel([FRI], OCCURRENCES as never, "UTC")).not.toBeNull();
    expect(ticketOffChosenDays(null, [SAT])).toBe(false);
    expect(ticketOffChosenDays([FRI], [SAT])).toBe(true);
    expect(ticketOffChosenDays([FRI], [])).toBe(false);
    expect(dayChooserCaptions([baseTicket] as never, OCCURRENCES)).toEqual({});
    expect(
      removedTicketsNotice([
        { name: "A", quantity: 1, dayLabel: null },
        { name: "B", quantity: 1, dayLabel: null },
        { name: "C", quantity: 1, dayLabel: null },
      ]),
    ).toBe("Removed 3 tickets — they're not on your days.");
  });
});
