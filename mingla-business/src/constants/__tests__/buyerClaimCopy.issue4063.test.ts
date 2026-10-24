import {
  BUYER_CLAIM_COPY,
  buyerBusinessSentCopy,
  buyerDesktopTextFallback,
  buyerOrderReference,
  buyerSignInCopy,
} from "../buyerClaimCopy";

describe("#4063 buyer claim copy", () => {
  test("pins the purchase promises and one-button labels", () => {
    expect(BUYER_CLAIM_COPY.checkoutPromise).toEqual({
      ticket: "We'll email and text you a link to your tickets.",
      pass: "We'll email and text you a link to your pass.",
      booking: "We'll email and text you a link to your booking.",
      guestList: "We'll email and text each person a link to their ticket.",
    });
    expect(BUYER_CLAIM_COPY.button).toEqual({
      ticket: "Get my tickets",
      pass: "Get my pass",
      booking: "Get my booking",
      receipt: "Get my receipt",
    });
    expect(BUYER_CLAIM_COPY.allInNote).toBe(
      "All-in price. Taxes and fees included.",
    );
  });

  test("chooses a complete sign-in sentence without empty slots", () => {
    expect(
      buyerSignInCopy({ emailMasked: "a•••@e•••.com", phoneLast4: "0123" }),
    ).toBe("Sign in with a•••@e•••.com or the number ending 0123");
    expect(buyerSignInCopy({ emailMasked: "a•••@e•••.com" })).toBe(
      "Sign in with a•••@e•••.com",
    );
    expect(buyerSignInCopy({ phoneLast4: "0123" })).toBe(
      "Sign in with the number ending 0123",
    );
    expect(buyerSignInCopy({})).toBe(
      "Sign in with the email or mobile number you used.",
    );
    expect(
      buyerSignInCopy({ emailMasked: " ", phoneLast4: " " }),
    ).not.toContain("{}");
  });

  test("formats the optional text fallback and stable order reference", () => {
    expect(buyerDesktopTextFallback("4242")).toBe(
      "We also texted the link to the number ending 4242.",
    );
    expect(buyerDesktopTextFallback(" ")).toBeNull();
    expect(buyerOrderReference("7f3a91c2-1111-4111-8111-111111111111")).toBe(
      "Order 7F3A91C2",
    );
    expect(buyerOrderReference("not-an-order")).toBeNull();
  });

  test("formats the host-sent confirmation and rejects an empty name", () => {
    expect(buyerBusinessSentCopy(" Ama ")).toEqual({
      title: "Ticket sent to Ama.",
      body: "We emailed and texted Ama a link to the ticket.",
    });
    expect(() => buyerBusinessSentCopy(" ")).toThrow(
      "buyer_first_name_required",
    );
  });

  test("keeps QR language limited to the app and handoff disclaimer", () => {
    expect(BUYER_CLAIM_COPY.underButton.ticket).toContain(
      "Your QR code, receipt and group chat are there.",
    );
    expect(BUYER_CLAIM_COPY.scanDisclaimer).toBe(
      "This is not your ticket. It works once, for 10 minutes.",
    );
  });
});
