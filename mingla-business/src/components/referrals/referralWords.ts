// #3872 — referral workspace words (no raw status keys or codes on screen).
import type {
  ReferralMember,
  ReferralOffer,
} from "../../services/referralService";
import { programMoney, shortDate } from "../../utils/creatorProgramFormat";

export function offerPill(offer: Pick<ReferralOffer, "status">): {
  label: string;
  tone: "live" | "paused" | "ended" | "waiting";
} {
  switch (offer.status) {
    case "active":
      return { label: "Live", tone: "live" };
    case "paused":
      return { label: "Paused", tone: "paused" };
    case "ended":
      return { label: "Ended", tone: "ended" };
    default:
      return { label: "Draft", tone: "waiting" };
  }
}

/** "10% cash · 3 promoters", "10% back as a voucher · whole brand", "Ended Sep 30". */
export function offerSummary(
  offer: Pick<
    ReferralOffer,
    | "status"
    | "rewardKind"
    | "shareBps"
    | "perkText"
    | "audience"
    | "scopeKind"
    | "listings"
    | "memberCount"
    | "endsAt"
    | "voucherTemplate"
    | "currency"
  >,
  currency: string,
  rewardOnly = false,
): string {
  const percent = offer.shareBps ? `${offer.shareBps / 100}%` : null;
  const voucherMinor =
    typeof offer.voucherTemplate?.amount_minor === "number"
      ? offer.voucherTemplate.amount_minor
      : null;
  const reward =
    offer.rewardKind === "cash"
      ? `${percent ?? "A share"} cash`
      : offer.rewardKind === "voucher"
        ? voucherMinor !== null
          ? `${programMoney(voucherMinor, offer.currency || currency)} voucher`
          : `${percent ?? "A"}${percent ? " back as a" : ""} voucher`
        : (offer.perkText ?? "A perk");
  if (rewardOnly) return reward;
  if (offer.status === "ended")
    return offer.endsAt ? `Ended ${shortDate(offer.endsAt)}` : "Ended";
  const who =
    offer.audience === "buyers"
      ? offer.scopeKind === "brand"
        ? "whole brand"
        : `${offer.listings.length} listing${offer.listings.length === 1 ? "" : "s"}`
      : `${offer.memberCount} promoter${offer.memberCount === 1 ? "" : "s"}`;
  const audience =
    offer.audience === "buyers"
      ? "Every buyer earns"
      : offer.audience === "both"
        ? "Buyers and promoters"
        : "Promoter team";
  return `${audience} · ${reward} · ${who}`;
}

/**
 * #3872 round 2 — the one-line offer row ("Promoter team · 1 promoter",
 * "Every buyer · whole brand"). The reward stays in the offer sheet.
 */
export function offerRowSummary(
  offer: Pick<
    ReferralOffer,
    "status" | "audience" | "scopeKind" | "listings" | "memberCount" | "endsAt"
  >,
): string {
  if (offer.status === "ended")
    return offer.endsAt ? `Ended ${shortDate(offer.endsAt)}` : "Ended";
  const audience =
    offer.audience === "buyers"
      ? "Every buyer"
      : offer.audience === "both"
        ? "Buyers and promoters"
        : "Promoter team";
  const who =
    offer.audience === "buyers"
      ? offer.scopeKind === "brand"
        ? "whole brand"
        : `${offer.listings.length} listing${offer.listings.length === 1 ? "" : "s"}`
      : `${offer.memberCount} promoter${offer.memberCount === 1 ? "" : "s"}`;
  return `${audience} · ${who}`;
}

export function memberStatusWords(
  status: ReferralMember["status"] | string,
): string {
  switch (status) {
    case "active":
      return "Earning";
    case "invited":
      return "Invited";
    case "declined":
      return "Declined";
    case "removed":
      return "Removed";
    default:
      return "Invited";
  }
}

export function rankLeaderboard(
  rows: readonly ReferralMember[],
): ReferralMember[] {
  return [...rows]
    .filter((row) => row.status !== "removed")
    .sort(
      (a, b) =>
        b.salesCount - a.salesCount ||
        b.revenueMinor - a.revenueMinor ||
        a.displayName.localeCompare(b.displayName),
    );
}

/** The tracking-link ending the server accepts. */
export function slugIsValid(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{5,47}$/.test(slug);
}
