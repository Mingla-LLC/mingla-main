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

/**
 * #4624 follow-up 3: a ticket-capped code also caps menu items (the engine
 * counts one unit per item on a venue order line). A line with more items
 * than the code has left keeps full price, and the buyer is told why, in the
 * same shape as the ticket copy above. Proposed copy, awaiting Seth's approval:
 * - 0 left (earlier lines in the same order took the last ones);
 * - two or more lines and the item is named once in the order: name it;
 * - otherwise the generic sentence.
 */
export interface ItemCodeLimitedCopyInput {
  remaining: number;
  /** The menu item the notice is about, when the order can name it. */
  itemName?: string | null;
  /** The number that fits; null or undefined means not offered. */
  lowerTo?: number | null;
  /** True when the order holds two or more lines. */
  multiLine?: boolean;
}

export const itemCodeLimitedCopy = ({
  remaining,
  itemName = null,
  lowerTo = null,
  multiLine = false,
}: ItemCodeLimitedCopyInput): string => {
  if (remaining <= 0) {
    return "Nothing left on this code for the rest of your order.";
  }
  const lead = `Only ${remaining} left on this code.`;
  if (multiLine && itemName && lowerTo !== null && lowerTo >= 1) {
    return `${lead} Lower ${itemName} to ${lowerTo} to use it.`;
  }
  return `${lead} Lower the number to use it.`;
};

/** The venue order preview fields the item-notice model reads. */
export interface VenueCodeLimitedPreviewShape {
  lines: ReadonlyArray<{ lineNo: number; itemNameAtOrder: string; quantity: number }>;
  /** The server's notices, untyped on the venue wire. */
  notices: ReadonlyArray<unknown>;
}

export interface VenueCodeLimitedNoticeModel {
  /** `${discountId}:${lineRef}`. */
  key: string;
  discountId: string;
  /** The engine's line ref ("001"), the order line number padded to 3. */
  lineRef: string;
  lineNo: number;
  remaining: number;
  lowerTo: number;
  text: string;
}

function isCodeLimitedNotice(notice: unknown): notice is {
  type: "sale_limited";
  discountId: string;
  lineRef: string;
  remaining: number;
  discountKind: "code";
} {
  if (notice === null || typeof notice !== "object") return false;
  const value = notice as Record<string, unknown>;
  return value.type === "sale_limited" && value.discountKind === "code" &&
    typeof value.discountId === "string" && typeof value.lineRef === "string" &&
    typeof value.remaining === "number" && Number.isFinite(value.remaining);
}

/**
 * Every code notice on a venue order (discountKind "code"), in line order,
 * with its copy. The venue engine line ref is the order line number padded to
 * three digits (venueOrderPricing.ts), so a notice maps to `lines[].lineNo`.
 */
export function venueCodeLimitedNotices(
  preview: VenueCodeLimitedPreviewShape,
): VenueCodeLimitedNoticeModel[] {
  const multiLine = preview.lines.length >= 2;
  const nameCount = new Map<string, number>();
  for (const line of preview.lines) {
    nameCount.set(line.itemNameAtOrder, (nameCount.get(line.itemNameAtOrder) ?? 0) + 1);
  }
  return preview.notices
    .filter(isCodeLimitedNotice)
    .map((notice) => {
      const lineNo = Number(notice.lineRef);
      const line = preview.lines.find((row) => row.lineNo === lineNo);
      const remaining = notice.remaining;
      const lowerTo = Math.max(0, remaining);
      // An item named on two lines (different modifiers) is not named: the
      // buyer could not tell which one to lower.
      const itemName = line && nameCount.get(line.itemNameAtOrder) === 1
        ? line.itemNameAtOrder
        : null;
      return {
        key: `${notice.discountId}:${notice.lineRef}`,
        discountId: notice.discountId,
        lineRef: notice.lineRef,
        lineNo,
        remaining,
        lowerTo,
        text: itemCodeLimitedCopy({ remaining, itemName, lowerTo, multiLine }),
      };
    })
    .filter((model) => Number.isInteger(model.lineNo) && model.lineNo >= 1)
    .sort((a, b) => a.lineNo - b.lineNo);
}
