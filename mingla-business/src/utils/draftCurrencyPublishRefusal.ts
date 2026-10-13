/**
 * Issue #3645 — Publish refused because a draft is priced in a currency its
 * brand no longer sells in.
 *
 * The database refuses such a Publish with `price_reentry_required` (migration
 * 20270829003645). The publish hooks then ask the server to bring that one
 * draft in step (`biz_sync_draft_currency`): if it may be moved, its prices are
 * cleared and the host enters new ones; if a buyer still has a checkout open,
 * or a sale exists, it is left alone and the host is told to wait.
 *
 * These are the two codes a wizard can receive, and the words for them. Pure:
 * no React, no network.
 */
export const PRICE_REENTRY_REQUIRED_CODE = "price_reentry_required";

/** Raised by the client when the server would not move the draft. */
export const DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_CODE =
  "draft_currency_checkout_in_progress";

export const PRICE_REENTRY_PUBLISH_COPY =
  "Your brand's currency changed. Enter your prices again before publishing.";

export const DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY =
  "This event has a checkout in progress. Try again in a few minutes, or contact support.";

/** Host copy for either code; null for anything else. */
export const draftCurrencyRefusalCopy = (
  code: string | null | undefined,
): string | null => {
  const s = typeof code === "string" ? code.trim() : "";
  if (s === DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_CODE) {
    return DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY;
  }
  if (s === PRICE_REENTRY_REQUIRED_CODE) return PRICE_REENTRY_PUBLISH_COPY;
  return null;
};
