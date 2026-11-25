// Issue #4490, Explorer W1: the handoff to the Mingla app for venue bookings.
//
// Invariant I-VENUE-PASS-SERVER-WITHHELD-ON-WEB (declared in venue-offers/index.issue4490.w1.implementor.test.ts): with VENUE_PASS_APP_ONLY on, the pass QR pepper reaches the SQL projections only for a signed-in owner reading without a booking or member token; every token read (buyer web) gets no QR. The page never decides.
//
// One rule for every pepper site except staff check-in (venue-offers get,
// confirm_return, membership_get; venue-membership-pay-link get).

import type { ClaimLinkAdmin } from "./claimLink.ts";
import { resolveBuyerLink } from "./messageLinks.ts";

export type VenueClaimKind =
  | "stay_group"
  | "venue_booking"
  | "venue_membership"
  | "venue_waitlist"
  | "venue_till_sale";

export interface VenueClaim {
  shortUrl: string | null;
  code: string | null;
  /** N155: a text with this link was actually queued (offer bookings only). */
  texted?: boolean;
  /** N159: app-link texts still allowed for this booking (0 to 3). */
  textsLeft?: number;
}

export const NO_VENUE_CLAIM: VenueClaim = { shortUrl: null, code: null };

interface FlagClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Reads one #4490 rollout flag. A failed read is "off" (the safe default). */
export async function venueFlagOn(
  client: FlagClient,
  flag: "VENUE_APP_HANDOFF" | "VENUE_PASS_APP_ONLY",
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("issue_4490_flag_on", {
      p_flag: flag,
    });
    if (error) {
      console.warn("venue_flag_read_failed", { flag });
      return false;
    }
    return data === true;
  } catch {
    console.warn("venue_flag_read_failed", { flag });
    return false;
  }
}

/**
 * The pepper to pass to a projection. Off: always the pepper (today). On:
 * only a signed-in caller reading without a token (ownership is enforced by
 * callerOwnsBooking or the membership RPC before this runs).
 */
export function passPepperFor(
  pepper: string | null,
  appOnly: boolean,
  caller: { userId: string | null },
  tokenHash: string | null,
): string | null {
  if (!appOnly) return pepper;
  return caller.userId && !tokenHash ? pepper : null;
}

/**
 * The claim link for a venue subject, minted only while VENUE_APP_HANDOFF is
 * on. A download fallback is never offered as a claim (the card hides).
 */
export async function venueClaimFor(
  client: ClaimLinkAdmin,
  handoffOn: boolean,
  kind: VenueClaimKind,
  subjectId: string,
): Promise<VenueClaim> {
  if (!handoffOn || !subjectId) return NO_VENUE_CLAIM;
  try {
    const link = await resolveBuyerLink(client, { kind, sourceId: subjectId });
    if (link.fallback || !link.isShort) return NO_VENUE_CLAIM;
    const code = link.url.slice(link.url.lastIndexOf("/") + 1);
    return { shortUrl: link.url, code: code.length > 0 ? code : null };
  } catch {
    console.warn("venue_claim_mint_failed", { kind });
    return NO_VENUE_CLAIM;
  }
}

/** Adds `claim` to an object read; anything else is returned unchanged. */
export function withClaim(data: unknown, claim: VenueClaim): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  return { ...(data as Record<string, unknown>), claim };
}
