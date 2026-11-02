// Loaded by issue_3859_expired_session_guard.implementor.happy.render.test.tsx,
// the registered ticket-cart render suite, the same way as the #4174 cases.
import {
  makeTicketCartProps,
  mockTicketQuote,
  mountTicketCart,
  renderedText,
  TestRenderer,
  TEST_TICKET_ID,
  updateTicketCart,
} from "./issue_3859_ticket_cart_session_harness";

// #3281 — Explorer extras: the picker, its limits, its state, and the breakdown.
const DINNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FRI = "day-fri";
const SAT = "day-sat";
const dinner = (validOccurrenceIds: string[] | null = null) => ({
  id: DINNER,
  name: "Dinner",
  description: null,
  priceCents: 1500,
  priceAllInCents: 1620,
  maxPerTicket: 1,
  isUnlimited: true,
  validOccurrenceIds,
  remaining: null,
});
const signedIn = {
  buyerUserId: "account-3281",
  buyerName: "Seth Explorer",
  buyerEmail: "seth@example.test",
  buyerPhone: "+15555550123",
};
const baseTicket = (makeTicketCartProps().tickets ?? [])[0];
const withExtras = (extras: unknown) =>
  [{ ...baseTicket, buyerExtras: extras }] as never;

type Renderer = ReturnType<typeof mountTicketCart>;
type Line = { quantity: number; addOns?: Array<{ addOnId: string; quantity: number }> };
const quoteLine = (): Line | undefined =>
  (mockTicketQuote.input as { lines: Line[] }).lines[0];
const press = (renderer: Renderer, label: string): void => {
  TestRenderer.act(() => {
    renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
  });
};
const addDinner = (renderer: Renderer) =>
  press(renderer, "Add one Dinner to Weekend pass");
const setTickets = (renderer: Renderer, next: number): void => {
  TestRenderer.act(() => {
    renderer.root
      .findByProps({ testID: `quantity-${TEST_TICKET_ID}` })
      .props.onQuantityChange(next);
  });
};

afterEach(() => {
  mockTicketQuote.data = null;
});

describe("issue #3281 — Explorer extras", () => {
  test("a picked extra rides the line; fewer tickets trim it and raising them doesn't bring it back", () => {
    const renderer = mountTicketCart(
      makeTicketCartProps({ ...signedIn, tickets: withExtras([dinner()]) }),
    );
    addDinner(renderer);
    addDinner(renderer);
    expect(quoteLine()?.addOns).toEqual([{ addOnId: DINNER, quantity: 2 }]);
    setTickets(renderer, 1);
    expect(quoteLine()?.addOns).toEqual([{ addOnId: DINNER, quantity: 1 }]);
    setTickets(renderer, 2);
    expect(quoteLine()?.addOns).toEqual([{ addOnId: DINNER, quantity: 1 }]);
  });

  test("a removed ticket and a closed cart drop the extras", () => {
    const props = makeTicketCartProps({ ...signedIn, tickets: withExtras([dinner()]) });
    const renderer = mountTicketCart(props);
    addDinner(renderer);
    setTickets(renderer, 0);
    setTickets(renderer, 1);
    expect(quoteLine()?.addOns).toBeUndefined();
    addDinner(renderer);
    updateTicketCart(renderer, { ...props, visible: false });
    updateTicketCart(renderer, props);
    expect(quoteLine()?.addOns).toBeUndefined();
  });

  test("the extras steppers lock while checkout is submitting", () => {
    const props = makeTicketCartProps({ ...signedIn, tickets: withExtras([dinner()]) });
    const renderer = mountTicketCart(props);
    updateTicketCart(renderer, { ...props, isSubmitting: true });
    const add = renderer.root.findAllByProps({
      accessibilityLabel: "Add one Dinner to Weekend pass",
    })[0];
    expect(add.props.disabled).toBe(true);
    expect(add.props.accessibilityState).toEqual({ disabled: true });
  });

  test("deck and chat arrivals read extras from the event bundle", () => {
    const renderer = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        extrasTickets: withExtras([dinner()]),
      }),
    );
    addDinner(renderer);
    expect(quoteLine()?.addOns).toEqual([{ addOnId: DINNER, quantity: 1 }]);
  });

  test("an all-days pass offers a date-limited extra with no dates chosen", () => {
    const future = (day: number) => `2099-03-0${day}T22:00:00Z`;
    const renderer = mountTicketCart(
      makeTicketCartProps({
        ...signedIn,
        tickets: withExtras([dinner([FRI])]),
        multiDaySelection: {
          status: "ready",
          occurrences: [
            { id: FRI, startAt: future(1), endAt: future(1), isMaster: true },
            { id: SAT, startAt: future(2), endAt: future(2), isMaster: false },
          ] as never,
          selectedEventDateIds: [],
          pricingMode: "all_days",
          allDaysPass: true,
          timezone: "UTC",
          onToggle: jest.fn(),
          onRetry: jest.fn(),
        } as never,
      }),
    );
    addDinner(renderer);
    expect(quoteLine()?.addOns).toEqual([{ addOnId: DINNER, quantity: 1 }]);
  });

  test("the breakdown lists each extra the quote priced", () => {
    mockTicketQuote.data = {
      kind: "quote",
      currency: "USD",
      lines: [],
      listSubtotalCents: 2500,
      discountCents: 0,
      netSubtotalCents: 2500,
      dueTodayNetCents: 2500,
      dueTodayListCents: 2500,
      installmentSchedule: null,
      discounts: [],
      codeOutcome: { status: "none", reason: null, required: null },
      notices: [],
      quoteDigest: "digest-3281",
      quoteListDigest: "list-digest-3281",
      feesCents: 0,
      taxCents: 0,
      buyerTotalCents: 2500,
      calculationId: null,
      subtotalCents: 2500,
      totalCents: 2500,
      extras: [
        {
          addOnId: DINNER,
          ticketTypeId: TEST_TICKET_ID,
          addOnName: "Dinner",
          ticketName: "Weekend pass",
          dayScope: null,
          quantity: 1,
          unitPriceCents: 500,
          totalCents: 500,
        },
      ],
      extrasTotalCents: 500,
    };
    const renderer = mountTicketCart(
      makeTicketCartProps({ ...signedIn, tickets: withExtras([dinner()]) }),
    );
    press(renderer, "What's included");
    expect(
      renderer.root
        .findAllByProps({ testID: "issue-3281-breakdown-extra" })
        .filter((node) => typeof node.type === "string"),
    ).toHaveLength(1);
    expect(renderedText(renderer).join(" ")).toContain("Dinner");
  });
});
