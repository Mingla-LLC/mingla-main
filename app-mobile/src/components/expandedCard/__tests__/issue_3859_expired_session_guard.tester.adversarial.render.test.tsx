import {
  makeTicketCartProps,
  mountTicketCart,
  renderedText,
  TestRenderer,
  TEST_TICKET_ID,
  updateTicketCart,
} from "./issue_3859_ticket_cart_session_harness";

describe("issue #3859 — adversarial auth/contact hydration", () => {
  test("stale contact cannot bypass null auth; a late partial account asks only for its missing field", () => {
    const onCheckout = jest.fn();
    const staleContactWithoutAuth = makeTicketCartProps({
      onCheckout,
      buyerUserId: null,
      buyerName: "Stale Person",
      buyerEmail: "stale@example.test",
      buyerPhone: "+15555550999",
    });
    const renderer = mountTicketCart(staleContactWithoutAuth);

    expect(
      renderer.root.findByProps({
        testID: "explorer-checkout-session-required",
      }),
    ).toBeTruthy();
    expect(renderedText(renderer)).not.toContain("Stale Person");
    expect(renderedText(renderer)).not.toContain("stale@example.test");
    expect(renderedText(renderer)).not.toContain("+15555550999");
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Full name for this booking",
      }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Email for this booking",
      }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType("PhoneInput" as never)).toHaveLength(0);
    expect(onCheckout).not.toHaveBeenCalled();

    const partialAccount = makeTicketCartProps({
      onCheckout,
      buyerUserId: "account-3859",
      buyerName: "Current Person",
      buyerEmail: "current@example.test",
      buyerPhone: "",
    });
    updateTicketCart(renderer, partialAccount);

    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Full name for this booking",
      }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Email for this booking",
      }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType("PhoneInput" as never)).toHaveLength(1);
    expect(renderedText(renderer)).not.toContain("Full name");
    expect(renderedText(renderer)).not.toContain("Email");
    expect(renderedText(renderer)).toEqual(
      expect.arrayContaining(["Mobile number"]),
    );
    expect(
      renderer.root.findByProps({ testID: `quantity-${TEST_TICKET_ID}` }).props
        .quantity,
    ).toBe(2);
    expect(onCheckout).not.toHaveBeenCalled();

    const completeAccount = makeTicketCartProps({
      onCheckout,
      buyerUserId: "account-3859",
      buyerName: "Current Person",
      buyerEmail: "current@example.test",
      buyerPhone: "+15555550123",
    });
    updateTicketCart(renderer, completeAccount);

    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Full name for this booking",
      }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Email for this booking",
      }),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType("PhoneInput" as never)).toHaveLength(0);
    expect(renderedText(renderer)).toEqual(
      expect.arrayContaining([
        "Current Person",
        "current@example.test",
        "+15555550123",
      ]),
    );
    expect(
      renderer.root.findByProps({ testID: `quantity-${TEST_TICKET_ID}` }).props
        .quantity,
    ).toBe(2);
    expect(onCheckout).not.toHaveBeenCalled();

    TestRenderer.act(() => {
      renderer.unmount();
    });
  });
});
