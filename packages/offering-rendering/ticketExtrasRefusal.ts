/**
 * issue #3281 — buyer copy for a checkout refusal the server names after
 * add-ons. Its own module so the event cart reads it without loading the
 * add-on picker (which every cart loads on use).
 */

const EXTRAS_REFUSAL_COPY: Record<string, string> = {
  extras_invalid: "We couldn't read your extras. Change them and try again.",
  extra_not_available: "One of your extras is no longer on sale. Remove it to continue.",
  extra_quantity_above_max: "You've picked more of an extra than your tickets allow.",
  extra_not_on_chosen_days: "One of your extras isn't on the dates you picked.",
  extra_capacity_exceeded: "One of your extras just sold out. Pick fewer to continue.",
  extras_need_paid_ticket: "Paid extras need a paid ticket.",
  extras_not_on_installments: "Extras are paid in full, so they can't go on a payment plan.",
};

/** Buyer copy for a refusal the server names after extras; null for anything else. */
export function extrasRefusalCopy(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  return EXTRAS_REFUSAL_COPY[code] ?? null;
}

/** The refusal token inside a raw server message, if it is an extras one. */
export function extrasRefusalIn(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  for (const code of Object.keys(EXTRAS_REFUSAL_COPY)) {
    if (message.includes(code)) return code;
  }
  return null;
}
