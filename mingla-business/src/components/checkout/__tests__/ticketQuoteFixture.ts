import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import type { CartLine } from "../CartContext";

/** Legacy cart-test adapter: express the old all-in fixtures as a server quote. */
export const ticketQuoteFromLines = (lines: CartLine[]): TicketQuote | null => {
  if (lines.length === 0) return null;
  const listSubtotalCents = lines.reduce(
    (sum, line) => sum + Math.round(line.unitPrice * 100) * line.quantity,
    0,
  );
  const buyerTotalCents = lines.reduce(
    (sum, line) =>
      sum +
      Math.round((line.unitPriceAllIn ?? line.unitPrice) * 100) * line.quantity,
    0,
  );
  return {
    kind: "quote",
    currency: lines[0]?.currency ?? "",
    lines: [],
    listSubtotalCents,
    discountCents: 0,
    netSubtotalCents: listSubtotalCents,
    dueTodayNetCents: listSubtotalCents,
    dueTodayListCents: listSubtotalCents,
    installmentSchedule: null,
    discounts: [],
    codeOutcome: {
      status: "none",
      reason: null,
      required: null,
      with: null,
      replaced: [],
    },
    notices: [],
    quoteDigest: "00000000000000000000000000000000",
    quoteListDigest: "11111111111111111111111111111111",
    feesCents: Math.max(0, buyerTotalCents - listSubtotalCents),
    taxCents: null,
    buyerTotalCents,
    calculationId: null,
    subtotalCents: listSubtotalCents,
    totalCents: buyerTotalCents,
  };
};
