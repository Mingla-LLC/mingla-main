export const saleLimitedCopy = (name: string, remaining: number): string =>
  remaining <= 0
    ? `The ${name} price has sold out.`
    : `Only ${remaining} left at the ${name} price.`;

/**
 * #4624 D1a: a ticket-capped discount code has fewer tickets left than the
 * basket line holds, so that line keeps full price. Approved copy (design
 * comment 7204990816 and rework spec 7206302208, item 6):
 * - 0 left (earlier lines in the same basket took the last tickets);
 * - per-day line where fewer tickets are left than days picked (lowerTo 0);
 * - two or more ticket types and the name is known: name the type to lower (D-6);
 * - otherwise the generic sentence.
 */
export interface CodeLimitedCopyInput {
  remaining: number;
  /** The ticket type the notice is about, when the basket can name it. */
  ticketName?: string | null;
  /**
   * The picker number that fits, in the buyer's own units. 0 means no whole
   * number fits (per-day line); null or undefined means not offered.
   */
  lowerTo?: number | null;
  /** True when the basket holds two or more ticket types. */
  multiLine?: boolean;
}

export const codeLimitedCopy = ({
  remaining,
  ticketName = null,
  lowerTo = null,
  multiLine = false,
}: CodeLimitedCopyInput): string => {
  if (remaining <= 0) {
    return "No tickets left on this code for the rest of your order.";
  }
  const lead = remaining === 1
    ? "Only 1 ticket left on this code."
    : `Only ${remaining} tickets left on this code.`;
  if (lowerTo === 0) {
    return `${lead} That's not enough for every day you picked.`;
  }
  if (multiLine && ticketName && lowerTo !== null && lowerTo >= 1) {
    return `${lead} Lower ${ticketName} to ${lowerTo} to use it.`;
  }
  return `${lead} Lower the number to use it.`;
};

/** The quote fields the code-notice model reads (structural, both apps). */
export interface CodeLimitedQuoteShape {
  lines: ReadonlyArray<{ ticketTypeId: string; ticketName: string; quantity: number }>;
  notices: ReadonlyArray<{
    type: string;
    discountId: string;
    lineRef: string;
    remaining: number;
    discountKind?: string;
  }>;
}

export interface CodeLimitedNoticeModel {
  /** `${discountId}:${lineRef}` — the dismissal and analytics key. */
  key: string;
  discountId: string;
  lineRef: string;
  remaining: number;
  /** In the buyer's picker units; 0 = no whole number fits; null = not offered. */
  lowerTo: number | null;
  ticketName: string | null;
  text: string;
}

/**
 * Every code notice (discountKind "code") in quote line order, with its copy.
 * `pickerQuantityByLineRef` is the buyer's own number per ticket type: the
 * quote line holds tickets issued, which for a per-day multi-day line is
 * people x days. null means the line is picked date by date (no single number
 * to lower to); a missing entry means the picker equals the quote quantity.
 */
export function codeLimitedNotices(
  quote: CodeLimitedQuoteShape,
  pickerQuantityByLineRef: Readonly<Record<string, number | null | undefined>> = {},
): CodeLimitedNoticeModel[] {
  const multiLine = quote.lines.length >= 2;
  const order = new Map(quote.lines.map((line, index) => [line.ticketTypeId, index]));
  return quote.notices
    .filter((notice) => notice.type === "sale_limited" && notice.discountKind === "code")
    .slice()
    .sort((a, b) =>
      (order.get(a.lineRef) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.lineRef) ?? Number.MAX_SAFE_INTEGER)
    )
    .map((notice) => {
      const line = quote.lines.find((row) => row.ticketTypeId === notice.lineRef);
      const picker = pickerQuantityByLineRef[notice.lineRef];
      let lowerTo: number | null;
      if (picker === null) {
        lowerTo = null;
      } else if (picker === undefined || !line || picker <= 0) {
        lowerTo = Math.max(0, notice.remaining);
      } else {
        const perPick = line.quantity / picker;
        lowerTo = Number.isInteger(perPick) && perPick >= 1
          ? Math.floor(Math.max(0, notice.remaining) / perPick)
          : Math.max(0, notice.remaining);
      }
      const ticketName = line?.ticketName ?? null;
      return {
        key: `${notice.discountId}:${notice.lineRef}`,
        discountId: notice.discountId,
        lineRef: notice.lineRef,
        remaining: notice.remaining,
        lowerTo,
        ticketName,
        text: codeLimitedCopy({
          remaining: notice.remaining,
          ticketName,
          lowerTo,
          multiLine,
        }),
      };
    });
}
