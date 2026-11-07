/**
 * Issue #3645 — a paid ticket with no price (or one that rounds to 0) cannot
 * go live. The server raises `paid_ticket_price_required`
 * (20280428003645); the event wizard says what to fix instead of quoting a
 * code, and its own check uses the same rounding so it stops this first.
 */
import {
  describeUnmappedPublishGuard,
  PAID_TICKET_PRICE_REQUIRED_COPY,
} from "../paidPublishGuards";
import { validateStep } from "../draftEventValidation";
import type { DraftEvent } from "../../store/draftEventStore";

describe("#3645 paid_ticket_price_required", () => {
  it("names the fix instead of the code", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(describeUnmappedPublishGuard("paid_ticket_price_required")).toBe(
      PAID_TICKET_PRICE_REQUIRED_COPY,
    );
    expect(
      describeUnmappedPublishGuard('{"message":"paid_ticket_price_required","code":"22023"}'),
    ).toBe(PAID_TICKET_PRICE_REQUIRED_COPY);
    expect(describeUnmappedPublishGuard("not_paid_ticket_price_required_x")).not.toBe(
      PAID_TICKET_PRICE_REQUIRED_COPY,
    );
    spy.mockRestore();
  });

  it("the wizard refuses a price that rounds to 0, like the server", () => {
    const priceErrors = (priceGbp: number | null): string[] =>
      validateStep(4, {
        tickets: [{ id: "t1", name: "General", isFree: false, priceGbp, isUnlimited: true, capacity: null }],
      } as unknown as DraftEvent)
        .filter((e) => e.fieldKey === "tickets[0].price")
        .map((e) => e.message);
    expect(priceErrors(null)).toHaveLength(1);
    expect(priceErrors(0)).toHaveLength(1);
    expect(priceErrors(0.004)).toHaveLength(1);
    expect(priceErrors(0.01)).toHaveLength(0);
    expect(priceErrors(25)).toHaveLength(0);
  });
});
