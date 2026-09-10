/*
 * #3149 — CAN A GUEST ACTUALLY LEAVE FOR PAYSTACK?
 *
 * The runtime's policy is `connect-src 'self'`, which is why ordering goes
 * through this app's own route rather than calling Mingla from the page. The
 * question the checkout raises is a different one: CSP also governs where a
 * document may go, and a policy that blocked the hop to Paystack would produce
 * an order that exists, is unpaid, and cannot be paid.
 *
 * Two directives could do it and neither does:
 *
 *   form-action  — governs FORM SUBMISSIONS only. The checkout does not submit
 *                  a form across origins; it sets `location.href`, which this
 *                  directive has never covered. It is asserted here anyway, so
 *                  that anyone who later reaches for a cross-origin <form>
 *                  action finds out from a test rather than from a guest
 *                  stranded at an unpaid order.
 *   navigate-to  — would have governed it. It was dropped from the CSP spec
 *                  and shipped in no browser, and it is not in this policy.
 *
 * So no change to the policy was needed for #3149, and this pins that reading
 * so a future tightening cannot silently break paying for dinner.
 */
import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const policy = buildCsp({ nonce: "nonce-value", pathname: "/menu" });
const directive = (name: string) =>
  policy.split(";").map((part) => part.trim()).find((part) =>
    part === name || part.startsWith(`${name} `)
  ) ?? null;

describe("#3149 leaving for the payment provider", () => {
  it("carries no directive that governs a top-level navigation", () => {
    expect(directive("navigate-to")).toBeNull();
  });

  it("still refuses the page its own connection to a payments origin", () => {
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });

  it("does not allow a cross-origin FORM submission, which checkout must not use", () => {
    // If someone converts the checkout into a form that posts to Paystack,
    // this is the assertion that tells them why it silently stopped working.
    const formAction = directive("form-action");
    expect(formAction).not.toBeNull();
    expect(formAction).not.toContain("paystack");
    expect(formAction).not.toContain("*");
  });

  it("keeps every other origin out of the page itself", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
  });
});
