import {
  makeTicketCartProps,
  mountTicketCart,
  renderedText,
  TestRenderer,
  TEST_TICKET_ID,
  updateTicketCart,
} from "./issue_3859_ticket_cart_session_harness";
// #4174 — Due today appears only for payment-plan quotes (same harness).
import "./issue_4174_due_today_plan_only.cases";

describe("issue #3859 — Explorer expired-session checkout guard", () => {
  test("null account never becomes anonymous contact entry, then late auth restores the recap without losing lines", () => {
    const onCheckout = jest.fn();
    const initial = makeTicketCartProps({ onCheckout });
    const renderer = mountTicketCart(initial);

    expect(
      renderer.root.findByProps({
        testID: "explorer-checkout-session-required",
      }),
    ).toBeTruthy();
    // #3872 adds an independent discount-code TextInput. This session test
    // guards the booking-contact editor specifically, so assert those fields
    // stay closed without treating the discount input as contact UI.
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
    expect(
      renderer.root.findAllByProps({ accessibilityRole: "checkbox" }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: "Continue to Payment",
      }),
    ).toHaveLength(0);
    expect(onCheckout).not.toHaveBeenCalled();

    const hydrated = makeTicketCartProps({
      onCheckout,
      buyerUserId: "account-3859",
      buyerName: "Seth Explorer",
      buyerEmail: "seth@example.test",
      buyerPhone: "+15555550123",
    });
    updateTicketCart(renderer, hydrated);

    expect(
      renderer.root.findAllByProps({
        testID: "explorer-checkout-session-required",
      }),
    ).toHaveLength(0);
    expect(renderedText(renderer)).toEqual(
      expect.arrayContaining([
        "Seth Explorer",
        "seth@example.test",
        "+15555550123",
      ]),
    );
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
