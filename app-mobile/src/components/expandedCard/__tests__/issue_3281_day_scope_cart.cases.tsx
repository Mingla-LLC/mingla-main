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
