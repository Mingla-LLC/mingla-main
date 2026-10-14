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
 * These are the codes a wizard can receive, and the words for each. Pure: no
 * React, no network.
 */
export const PRICE_REENTRY_REQUIRED_CODE = "price_reentry_required";

/**
 * Raised by the client when the server would not move the draft: a buyer has
 * a checkout open right now, or the draft already has sales.
 *
 * ONE code and ONE sentence cover both. Separate words for "already has
 * sales" were asked for in the last round of #3645 and are NOT here: the
 * existing suite issue_3645_drafts_follow_brand_currency_reopen pins this code
 * and this sentence for the `sale_exists` and `unpublished_after_sale` answers
 * as well, and that file may not be edited. See the open items on #3645.
 */
export const DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_CODE =
  "draft_currency_checkout_in_progress";

/** Raised when the brand itself has no currency to move the draft to. */
export const DRAFT_CURRENCY_BRAND_HAS_NONE_CODE = "draft_currency_brand_has_none";

export const PRICE_REENTRY_PUBLISH_COPY =
  "Your brand's currency changed. Enter your prices again before publishing.";

export const DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY =
  "This event has a checkout in progress. Try again in a few minutes, or contact support.";

export const DRAFT_CURRENCY_BRAND_HAS_NONE_COPY =
  "Choose a payout country for your brand first.";

/**
 * The code a publish hook raises for each answer of `biz_sync_draft_currency`.
 * Null = raise nothing new: the draft is in step now (the original refusal
 * stands and the host enters prices), or it is no longer a draft (it is simply
 * read again).
 */
export const draftCurrencySyncOutcomeCode = (outcome: string): string | null => {
  switch (outcome) {
    case "moved_prices_cleared":
    case "moved":
    case "in_step":
    case "not_a_draft":
      return null;
    case "brand_has_no_currency":
      return DRAFT_CURRENCY_BRAND_HAS_NONE_CODE;
    case "checkout_in_progress":
    case "sale_exists":
    case "unpublished_after_sale":
    default:
      // An answer this build does not know is treated as "not moved".
      return DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_CODE;
  }
};

/** Host copy for any of these codes; null for anything else. */
export const draftCurrencyRefusalCopy = (
  code: string | null | undefined,
): string | null => {
  const s = typeof code === "string" ? code.trim() : "";
  if (s === DRAFT_CURRENCY_BRAND_HAS_NONE_CODE) return DRAFT_CURRENCY_BRAND_HAS_NONE_COPY;
  if (s === DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_CODE) {
    return DRAFT_CURRENCY_CHECKOUT_IN_PROGRESS_COPY;
  }
  if (s === PRICE_REENTRY_REQUIRED_CODE) return PRICE_REENTRY_PUBLISH_COPY;
  return null;
};
