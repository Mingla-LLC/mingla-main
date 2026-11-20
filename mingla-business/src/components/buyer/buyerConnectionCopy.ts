/**
 * buyerConnectionCopy — #4518: the ONE owner of what a buyer is told when a
 * page or checkout step could not connect. Seth approved every word (design
 * artifact, copy proposals P1 "or Wi-Fi" and P2 STILL_TITLE).
 *
 * Never blames the brand that sells, never says the page is unsafe: the
 * banned-word test in issue_4518_connection_notice.implementor.test.tsx
 * reads this file.
 */
export const BUYER_CONNECTION_COPY = {
  CONNECTION_TITLE: "We couldn’t connect",
  /** After a retry fails, so a repeat failure visibly differs from the first. */
  STILL_TITLE: "Still can’t connect",
  CONNECTION_BODY:
    "Your connection looks weak or unstable. Check your signal or Wi‑Fi, then try again.",
  ACCESS_CHECK_BODY:
    "Your connection looks weak or unstable, so we couldn’t confirm this sale is open to you. Check your signal or Wi‑Fi, then try again.",
  SERVER_TITLE: "Something went wrong",
  SERVER_BODY: "This page didn’t load. Try again in a moment.",
  PAYMENT_CONNECTION_ERROR:
    "We couldn’t connect. Your connection looks weak or unstable. Check your signal or Wi‑Fi, then try again.",
  TRY_AGAIN: "Try again",
  TRYING_AGAIN: "Trying again…",
  TRY_AGAIN_A11Y: "Try connecting again",
  BACK: "Back",
} as const;
