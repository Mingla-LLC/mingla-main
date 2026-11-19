/**
 * issue #3645 / #3281 — the price label on the Host experience detail screen.
 *
 * "Free" only when the experience is free: the host's choice
 * (ExperienceDetail.isFree, the server's issue_3645_experience_is_free rule),
 * falling back to the first option for details that predate it. A paid
 * experience whose first option is free (Kids 0 beside Adult) is labelled by
 * its price, never "Free":
 *   - whole price, when every visible paid option is that price;
 *   - else the lowest visible paid option, "From …" when the paid options
 *     differ (hidden options are not offered to buyers, so they do not count);
 *   - else (per-stop, no whole price) the first priced option.
 *
 * The buyer-facing label (packages/offering-rendering experiencePriceLabel)
 * is a separate, open product call (#3645).
 */

export interface HostPriceOption {
  priceCents: number;
  isFree: boolean;
  isHidden?: boolean;
}

export interface HostPriceExperience {
  isFree?: boolean;
  pricingMode: "whole" | "per_stop" | null;
  wholePriceCents: number | null;
  ticket: HostPriceOption | null;
  tickets?: readonly HostPriceOption[];
}

export function experienceHostPriceLabel(
  exp: HostPriceExperience,
  format: (cents: number) => string,
): string {
  const options = exp.tickets ?? (exp.ticket !== null ? [exp.ticket] : []);
  if (options.length === 0 && exp.ticket === null) return "—";
  if (exp.isFree ?? exp.ticket?.isFree ?? false) return "Free";

  const paid = options
    .filter((o) => o.isHidden !== true && o.priceCents > 0)
    .map((o) => o.priceCents);
  const whole = exp.pricingMode === "whole" && (exp.wholePriceCents ?? 0) > 0
    ? (exp.wholePriceCents as number)
    : null;
  if (whole !== null && paid.every((cents) => cents === whole)) {
    return format(whole);
  }
  if (paid.length > 0) {
    const lowest = Math.min(...paid);
    return new Set(paid).size > 1 ? `From ${format(lowest)}` : format(lowest);
  }
  if (whole !== null) return format(whole);
  const priced = options.find((o) => o.priceCents > 0);
  return priced !== undefined ? format(priced.priceCents) : "—";
}
