/**
 * #4624 follow-up 3 — the venue order code-limit copy, in its own module so
 * it loads with the venue order review (a lazy chunk), never in the
 * business-web boot payload that saleLimitedCopy.ts sits in.
 */
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
  // A preview without lines or notices (older server, tip-only quote) has no
  // code notice to show; never throw on the review screen.
  const lines = Array.isArray(preview.lines) ? preview.lines : [];
  const notices = Array.isArray(preview.notices) ? preview.notices : [];
  const multiLine = lines.length >= 2;
  const nameCount = new Map<string, number>();
  for (const line of lines) {
    nameCount.set(line.itemNameAtOrder, (nameCount.get(line.itemNameAtOrder) ?? 0) + 1);
  }
  return notices
    .filter(isCodeLimitedNotice)
    .map((notice) => {
      const lineNo = Number(notice.lineRef);
      const line = lines.find((row) => row.lineNo === lineNo);
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
