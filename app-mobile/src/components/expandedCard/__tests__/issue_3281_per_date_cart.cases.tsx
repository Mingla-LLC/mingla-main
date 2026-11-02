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

// #3281 decision 7 — an Explorer buyer can choose a different quantity per date.
const DAYS = ["day-1", "day-2", "day-3"];
const occurrence = (id: string, index: number) => ({
  id,
  startAt: `2027-03-0${index + 1}T18:00:00Z`,
  endAt: `2027-03-0${index + 1}T22:00:00Z`,
  isMaster: index === 0,
});
const selection = (
  selected: string[],
  pricingMode: "per_day" | "all_days" = "per_day",
) => ({
  status: "ready" as const,
  occurrences: DAYS.map(occurrence) as never,
  selectedEventDateIds: selected,
  pricingMode,
  timezone: "UTC",
  onToggle: jest.fn(),
  onRetry: jest.fn(),
});
const signedIn = {
  buyerUserId: "account-3281",
  buyerName: "Seth Explorer",
  buyerEmail: "seth@example.test",
  buyerPhone: "+15555550123",
};
const props = (selected: string[]) =>
  makeTicketCartProps({
    ...signedIn,
    multiDaySelection: selection(selected),
  });
type Renderer = ReturnType<typeof mountTicketCart>;
type Line = { quantity: number; byDate?: Record<string, number> };

const quoteLine = (): Line =>
  (mockTicketQuote.input as { lines: Line[] }).lines[0];
const switches = (renderer: Renderer) =>
  renderer.root.findAllByType("Switch" as never);
const setSwitch = (renderer: Renderer, value: boolean): void => {
  TestRenderer.act(() => {
    switches(renderer)[0].props.onValueChange(value);
  });
};
const dateRow = (renderer: Renderer, dateId: string) =>
  renderer.root
    .findByProps({ testID: `issue-3281-date-${dateId}` })
    .findAllByType("QuantityRow" as never)[0];
const setDate = (renderer: Renderer, dateId: string, next: number): void => {
  TestRenderer.act(() => {
    dateRow(renderer, dateId).props.onQuantityChange(next);
  });
};

describe("issue #3281 — Explorer per-date quantities", () => {
  test("the switch needs two dates on a per-day event", () => {
    expect(switches(mountTicketCart(props(["day-1"])))).toHaveLength(0);
    expect(
      switches(
        mountTicketCart(
          makeTicketCartProps({
            ...signedIn,
            multiDaySelection: selection(DAYS, "all_days"),
          }),
        ),
      ),
    ).toHaveLength(0);
    expect(switches(mountTicketCart(props(DAYS)))).toHaveLength(1);
  });

  test("a cart starts uniform and sends no map", () => {
    mountTicketCart(props(DAYS));
    expect(quoteLine()).toMatchObject({ quantity: 2 });
    expect(quoteLine().byDate).toBeUndefined();
  });

  // #3281 day-limited tickets — a line pays only for the chosen dates it covers.
  const listed = (ids: string[], days = DAYS) => {
    const base = props(days);
    return {
      ...base,
      tickets: (base.tickets ?? []).map((ticket) => ({
        ...ticket,
        validOccurrenceIds: ids,
      })),
    };
  };

  test("a listed ticket names only the chosen dates it covers", () => {
    mountTicketCart(listed(["day-1", "day-2"]));
    expect(quoteLine()).toMatchObject({
      quantity: 4,
      byDate: { "day-1": 2, "day-2": 2 },
    });
  });

  test("a listed ticket covering every chosen date stays uniform", () => {
    mountTicketCart(listed(DAYS));
    expect(quoteLine()).toMatchObject({ quantity: 2 });
    expect(quoteLine().byDate).toBeUndefined();
  });

  test("switching off starts a listed ticket only on its dates", () => {
    const renderer = mountTicketCart(listed(["day-1", "day-2"]));
    setSwitch(renderer, false);
    expect(quoteLine()).toMatchObject({
      quantity: 4,
      byDate: { "day-1": 2, "day-2": 2 },
    });
  });

  test("a line for a ticket off every chosen date leaves the cart", () => {
    mountTicketCart(listed(["day-9"], ["day-1"]));
    expect(mockTicketQuote.input?.lines ?? []).toHaveLength(0);
  });

  test("switching off starts each date on the chosen quantity", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    expect(dateRow(renderer, "day-2").props.quantity).toBe(2);
    expect(quoteLine()).toMatchObject({
      quantity: 6,
      byDate: { "day-1": 2, "day-2": 2, "day-3": 2 },
    });
    expect(renderedText(renderer)).toContain("Up to 10 per date");
  });

  test("each date keeps its own count and an empty date drops out", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-1", 3);
    setDate(renderer, "day-3", 0);
    expect(quoteLine()).toEqual(
      expect.objectContaining({
        quantity: 5,
        byDate: { "day-1": 3, "day-2": 2 },
      }),
    );
  });

  test("switching back on keeps the busiest date, not the total", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-1", 3);
    setDate(renderer, "day-2", 1);
    setDate(renderer, "day-3", 0);
    setSwitch(renderer, true);
    expect(quoteLine()).toMatchObject({ quantity: 3 });
    expect(quoteLine().byDate).toBeUndefined();
  });

  test("a deselected date leaves the map and the total", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-1", 3);
    updateTicketCart(renderer, props(["day-1", "day-2"]));
    expect(quoteLine()).toMatchObject({
      quantity: 5,
      byDate: { "day-1": 3, "day-2": 2 },
    });
  });

  test("dropping to one date returns to a uniform cart on that date's count", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-1", 3);
    updateTicketCart(renderer, props(["day-1"]));
    expect(switches(renderer)).toHaveLength(0);
    expect(quoteLine()).toMatchObject({ quantity: 3 });
    expect(quoteLine().byDate).toBeUndefined();
  });

  test("a ticket removed while uniform keeps no saved counts", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-1", 3);
    setSwitch(renderer, true);
    TestRenderer.act(() => {
      renderer.root
        .findAllByType("QuantityRow" as never)[0]
        .props.onQuantityChange(0);
    });
    setSwitch(renderer, false);
    expect(dateRow(renderer, "day-1").props.quantity).toBe(0);
    expect((mockTicketQuote.input as { lines: Line[] }).lines).toEqual([]);
  });

  test("reselecting a date brings its tickets back into the cart", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    setDate(renderer, "day-2", 0);
    setDate(renderer, "day-3", 0);
    updateTicketCart(renderer, props(["day-2", "day-3"]));
    expect((mockTicketQuote.input as { lines: Line[] }).lines).toEqual([]);
    updateTicketCart(renderer, props(DAYS));
    expect(dateRow(renderer, "day-1").props.quantity).toBe(2);
    expect(quoteLine()).toMatchObject({
      quantity: 2,
      byDate: { "day-1": 2 },
    });
  });

  test("closing the sheet forgets the split", () => {
    const renderer = mountTicketCart(props(DAYS));
    setSwitch(renderer, false);
    updateTicketCart(renderer, { ...props(DAYS), visible: false });
    updateTicketCart(renderer, props(DAYS));
    expect(switches(renderer)[0].props.value).toBe(true);
    expect(quoteLine().byDate).toBeUndefined();
  });
});
