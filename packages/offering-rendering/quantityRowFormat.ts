/**
 * quantityRowFormat — pure date/time formatting for the shared QuantityRow
 * "Sales open …" pre-sale banner, extracted so it is unit-testable (no RN
 * import). Consumed by QuantityRow.tsx.
 *
 * ORCH-1162 Bug 1 (A.2): restore the meridiem on the pre-sale banner. en-GB is a
 * 24h-default locale (it rendered "Wed 15 Jul, 19:00"); en-US + hour12 emits a
 * meridiem ("Wed, Jul 15, 7:00 PM"). No timezone arg by design — renders in the
 * host's local zone (existing behavior; do NOT add a tz). Keeps the
 * Number.isFinite guard + "soon" fallback.
 * I-PROPOSED-1162-PUBLIC-TIME-HAS-MERIDIEM.
 */
export const formatSaleDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "soon";
  return d.toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};
