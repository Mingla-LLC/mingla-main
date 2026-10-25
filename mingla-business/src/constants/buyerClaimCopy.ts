export type BuyerClaimNoun = "ticket" | "booking" | "pass" | "receipt";

export const BUYER_CLAIM_COPY = {
  checkoutPromise: {
    ticket: "We'll email and text you a link to your tickets.",
    pass: "We'll email and text you a link to your pass.",
    booking: "We'll email and text you a link to your booking.",
    guestList: "We'll email and text each person a link to their ticket.",
  },
  rsvpGroupPromise: "We'll email and text each of you a link to your pass.",
  allInNote: "All-in price. Taxes and fees included.",
  approvalToast:
    "This ticket needs the host's approval. We'll text and email you when you're in.",
  confirmTotalLabel: "Total, fees and tax included",
  youreIn: "You're in.",
  waiting: {
    ticket: {
      phone: "Your ticket is waiting in the Mingla app.",
      desktop: "Your ticket is waiting in the Mingla app on your phone.",
    },
    booking: {
      phone: "Your booking is waiting in the Mingla app.",
      desktop: "Your booking is waiting in the Mingla app on your phone.",
    },
    pass: {
      phone: "Your pass is waiting in the Mingla app.",
      desktop: "Your pass is waiting in the Mingla app on your phone.",
    },
  },
  signInWith: "Sign in with {email} or the number ending {last4}",
  signInWithEmailOnly: "Sign in with {email}",
  signInWithPhoneOnly: "Sign in with the number ending {last4}",
  signInGeneric: "Sign in with the email or mobile number you used.",
  button: {
    ticket: "Get my tickets",
    pass: "Get my pass",
    booking: "Get my booking",
    receipt: "Get my receipt",
  },
  underButton: {
    ticket: "Free app. Your QR code, receipt and group chat are there.",
    booking: "Free app. Your booking, receipt and group chat are there.",
    pass: "Free app. Your QR code and group chat are there.",
  },
  desktopTextFallback: "We also texted the link to the number ending {last4}.",
  scanInstruction: {
    ticket: "Scan with your phone camera to get your tickets.",
    booking: "Scan with your phone camera to get your booking.",
    pass: "Scan with your phone camera to get your pass.",
  },
  scanDisclaimer: "This is not your ticket. It works once, for 10 minutes.",
  scanExpired: "This code has expired.",
  scanRefresh: "Get a new code",
  scanPreparing: "Preparing your code…",
  scanError:
    "We couldn't prepare a code. Your ticket is safe: open Mingla on your phone and sign in with the email or mobile number you used.",
  scanRateLimited:
    "Too many codes for this ticket. Try again in a few minutes.",
  receipt: {
    feesTax: "Fees & tax",
    paid: "Paid",
    free: "Free",
    orderRef: "Order {REF8}",
  },
  rsvp: {
    title: {
      going: "You're on the list.",
      pending: "RSVP sent for approval",
      waitlisted: "You're on the waitlist",
    },
    pendingLine:
      "Needs approval? We'll text and email you when the host says yes.",
    waitlistLine: "A spot opened? We'll text and email you automatically.",
  },
  venue: { title: "Your table is reserved." },
  guestList: {
    title: "You're on the list.",
    pending: "Request sent",
    pendingBody:
      "The host will review your group. No places are held until they approve it.",
  },
  pass: { genericTitle: "Your pass is in the Mingla app" },
  order: { genericTitle: "Your ticket is in the Mingla app" },
  notFound: { cta: "Go to usemingla.com" },
  venueOrder: { back: "Back to the menu" },
  reserve: { alsoInApp: "Also in the Mingla app" },
  bizCheckout: {
    forSomeoneElse:
      "Buying for someone else? Enter their details. The ticket goes to them, not your account.",
    sentTitle: "Ticket sent to {firstName}.",
    sentBody: "We emailed and texted {firstName} a link to the ticket.",
    done: "Done",
  },
} as const;

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function fill(template: string, slots: Record<string, string>): string {
  return template.replace(
    /\{([A-Za-z0-9]+)\}/g,
    (_match, key: string) => slots[key] ?? "",
  );
}

export function buyerSignInCopy(input: {
  emailMasked?: string | null;
  phoneLast4?: string | null;
}): string {
  const email = nonBlank(input.emailMasked);
  const last4 = nonBlank(input.phoneLast4);
  if (email && last4) {
    return fill(BUYER_CLAIM_COPY.signInWith, { email, last4 });
  }
  if (email) {
    return fill(BUYER_CLAIM_COPY.signInWithEmailOnly, { email });
  }
  if (last4) {
    return fill(BUYER_CLAIM_COPY.signInWithPhoneOnly, { last4 });
  }
  return BUYER_CLAIM_COPY.signInGeneric;
}

export function buyerDesktopTextFallback(
  phoneLast4: string | null | undefined,
): string | null {
  const last4 = nonBlank(phoneLast4);
  return last4 ? fill(BUYER_CLAIM_COPY.desktopTextFallback, { last4 }) : null;
}

export function buyerOrderReference(orderId: string): string | null {
  const compact = orderId.replaceAll("-", "").trim();
  if (!/^[0-9a-fA-F]{8,}$/.test(compact)) return null;
  return fill(BUYER_CLAIM_COPY.receipt.orderRef, {
    REF8: compact.slice(0, 8).toUpperCase(),
  });
}

export function buyerBusinessSentCopy(firstName: string): {
  title: string;
  body: string;
} {
  const name = nonBlank(firstName);
  if (!name) throw new Error("buyer_first_name_required");
  return {
    title: fill(BUYER_CLAIM_COPY.bizCheckout.sentTitle, { firstName: name }),
    body: fill(BUYER_CLAIM_COPY.bizCheckout.sentBody, { firstName: name }),
  };
}
