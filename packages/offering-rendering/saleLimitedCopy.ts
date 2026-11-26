export const saleLimitedCopy = (name: string, remaining: number): string =>
  remaining <= 0
    ? `The ${name} price has sold out.`
    : `Only ${remaining} left at the ${name} price.`;

/**
 * #4624 D1a: a ticket-capped discount code has fewer tickets left than the
 * basket line holds, so that line keeps full price. Approved copy (design
 * comment 7204990816). 0 left happens only when earlier lines in the same
 * basket used the last tickets.
 */
export const codeLimitedCopy = (remaining: number): string =>
  remaining <= 0
    ? "No tickets left on this code for the rest of your order."
    : remaining === 1
      ? "Only 1 ticket left on this code. Lower the number to use it."
      : `Only ${remaining} tickets left on this code. Lower the number to use it.`;
