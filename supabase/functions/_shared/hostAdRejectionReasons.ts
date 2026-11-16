/**
 * #4238 W4b (amendment B §1): plain-words reasons for an app's ad rejection.
 *
 * The apps' review text lands in ads.review_detail (Meta ad_review_feedback,
 * Snap review_status_reasons, Reddit rejection_reason, Google policy_summary,
 * TikTok reject reason). Each class is {match, reason_key, fix_key}; the keys
 * are rendered by hostAdNoticeCopy.ts in the recipient's language. Anything
 * unmatched gets the fallback copy. Raw platform text is never put in a
 * notice title or body.
 */

export type HostAdRejectionClass =
  | "text_heavy"
  | "misleading"
  | "alcohol"
  | "personal_attributes"
  | "landing_page"
  | "low_quality"
  | "prohibited"
  | "identity";

export type HostAdRejectionReason = {
  cls: HostAdRejectionClass;
  match: RegExp;
  reason_key: string;
  fix_key: string;
};

/** First match wins: the specific classes come before the broad ones. */
export const HOST_AD_REJECTION_REASONS: readonly HostAdRejectionReason[] = [
  {
    cls: "text_heavy",
    match:
      /too much text|text[ _-]?(heavy|overlay|in image)|20 ?% text|excessive text/i,
    reason_key: "reason_text_heavy",
    fix_key: "fix_text_heavy",
  },
  {
    cls: "alcohol",
    match: /alcohol|liquor|beer|wine|spirits/i,
    reason_key: "reason_alcohol",
    fix_key: "fix_alcohol",
  },
  {
    cls: "personal_attributes",
    match:
      /personal (attribute|health|characteristic)|implies? .*(age|race|religion|health)/i,
    reason_key: "reason_personal_attributes",
    fix_key: "fix_personal_attributes",
  },
  {
    cls: "misleading",
    match:
      /mislead|deceptive|false claim|unrealistic|exaggerat|sensational|clickbait/i,
    reason_key: "reason_misleading",
    fix_key: "fix_misleading",
  },
  {
    cls: "landing_page",
    match:
      /landing page|destination|non[ -]?functional|broken link|mismatch|url/i,
    reason_key: "reason_landing_page",
    fix_key: "fix_landing_page",
  },
  {
    cls: "low_quality",
    match:
      /low[ -]?quality|blurry|pixelat|resolution|poor quality|image quality|video quality/i,
    reason_key: "reason_low_quality",
    fix_key: "fix_low_quality",
  },
  {
    cls: "identity",
    match:
      /identity|permission|authori[sz]|trademark|copyright|intellectual property|impersonat/i,
    reason_key: "reason_identity",
    fix_key: "fix_identity",
  },
  {
    cls: "prohibited",
    match:
      /prohibited|restricted|weapon|drug|tobacco|adult|sexual|violen|gambling/i,
    reason_key: "reason_prohibited",
    fix_key: "fix_prohibited",
  },
];

/** Every string value inside an ads.review_detail value, depth-limited. */
export function reviewDetailText(detail: unknown, depth = 0): string {
  if (depth > 6 || detail === null || detail === undefined) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => reviewDetailText(item, depth + 1)).join(" ");
  }
  if (typeof detail === "object") {
    // Values only: a key name (destination_url, …) must never match a class.
    return Object.values(detail as Record<string, unknown>)
      .map((value) => reviewDetailText(value, depth + 1))
      .join(" ");
  }
  return "";
}

/** The class for one rejected ad's review detail, or null (fallback copy). */
export function classifyHostAdRejection(
  detail: unknown,
): HostAdRejectionReason | null {
  const text = reviewDetailText(detail).slice(0, 4000);
  if (!text.trim()) return null;
  return HOST_AD_REJECTION_REASONS.find((entry) => entry.match.test(text)) ??
    null;
}
