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
    // issue #4420 — section 34 + the 26pt display heading (31.2) + 14.
    79.2 +
    (policy === null ? 0 : final ? 56 : 57) +
    (disclosure ? 56 : 0) +
    // issue #4420 — the vertical timeline: 8 above, then per window the
    // refund line (18.6) + the window line (22) + 18 between windows.
    (tiers.length > 0 && !final ? 8 + tiers.length * 58.6 - 18 : 0) +
    (!isTrip && policy !== null && !final ? 30 : 0) +
    (deadline ? 57 : 0)
  );
}
