/**
 * #4459 design v2 — what a booking offers for the brand's Guest chat:
 *  - member        → "Open guest chat"
 *  - left (still eligible) → "Rejoin guest chat" (leave is sticky; this is the way back)
 *  - removed       → "Message <Brand>" (only the brand can add you back)
 *  - anything else → nothing (no dead taps)
 *
 * Pure (no React Native) so it runs under Deno.
 */
export type BrandGuestBookingAction = "open" | "rejoin" | "message" | null;

export function brandGuestBookingAction(
  status: { status: "member" | "left" | "removed" | "not_eligible"; canRejoin: boolean } | null | undefined,
): BrandGuestBookingAction {
  if (!status) return null;
  switch (status.status) {
    case "member":
      return "open";
    case "left":
      return status.canRejoin ? "rejoin" : null;
    case "removed":
      return "message";
    case "not_eligible":
      return null;
    default: {
      const exhaustive: never = status.status;
      return exhaustive;
    }
  }
}
