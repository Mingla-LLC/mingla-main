import type { OfferingRefundLadderProps } from "./OfferingRefundLadder";

/**
 * The height OfferingRefundLadder takes for these props, from its own styles.
 * Shared by the web lazy boundary and its native eager twin so their layout
 * contract cannot drift.
 */
export function reservedLadderHeight({
  policy,
  bookingDeadline = null,
  offeringType = "trip",
  isPaid = true,
}: OfferingRefundLadderProps): number {
  const isTrip = offeringType === "trip";
  const tiers = policy?.tiers ?? [];
  const final =
    !isTrip && tiers.length > 0 && tiers.every((t) => t.refund_pct === 0);
  const disclosure = !isTrip && policy === null && isPaid;
  const deadline = isTrip && Number.isFinite(Date.parse(bookingDeadline ?? ""));
  if (policy === null && !deadline && !disclosure) return 0;
  return (
    60 +
    (policy === null ? 0 : final ? 56 : 57) +
    (disclosure ? 56 : 0) +
    (tiers.length > 0 && !final ? 7 + tiers.length * 30.6 : 0) +
    (!isTrip && policy !== null && !final ? 30 : 0) +
    (deadline ? 57 : 0)
  );
}
