/**
 * #4490 W2-N26 part 4 — what the signed-out welcome offers when a claim card
 * shows. The card is someone's purchase, and the person holding the phone may
 * not be that someone: Apple, Google and plain "Continue with email" are
 * ALWAYS offered beside it, and "Use a different account" (the claim flow's
 * existing words, AttendanceClaimSheet) forgets the card. The purchase-email
 * shortcut ("Continue with g•••@e•••.com") is still the first button for the
 * owner. Privacy rules are unchanged: the card holds only what resolve
 * returns (title, date, masked email); no pass or QR before sign-in.
 */
import type { ClaimNoun, PendingClaim } from "../../services/attendanceClaimService";

export const WELCOME_DISMISS_CLAIM_LABEL = "Use a different account";

export type WelcomeSignInOptions = {
  /** The "Your pass is waiting" card. */
  claimCard: boolean;
  /** "Continue with {masked purchase email}". */
  claimEmail: boolean;
  /** Under the card: forget it and stay on the normal welcome. */
  dismissClaim: boolean;
  apple: boolean;
  google: boolean;
  /** The plain "Continue with email" option. */
  email: boolean;
};

export function welcomeSignInOptions(input: {
  ticketClaim: PendingClaim | null;
  platform: string;
  emailSignInAvailable: boolean;
  /** The purchase-email send failed for a reason another way can fix. */
  claimEmailFallback: boolean;
  /** The six-digit code for the purchase email is being entered. */
  claimEmailCodeOpen: boolean;
}): WelcomeSignInOptions {
  const claim = input.ticketClaim;
  const claimEmail = Boolean(
    claim && !claim.expired && claim.preferredProof === "email" &&
      claim.emailMasked && !input.claimEmailFallback,
  );
  return {
    claimCard: Boolean(claim && !claim.expired),
    claimEmail,
    dismissClaim: claim !== null,
    apple: input.platform === "ios",
    google: true,
    // Hidden only while the purchase email's code panel is open, so the
    // screen never has two code fields at once.
    email: input.emailSignInAvailable && !(claimEmail && input.claimEmailCodeOpen),
  };
}

/**
 * #4490 W2-N33 — the noun for "Opening your …" while a claim link resolves.
 * A OneLink claim link carries it (`c=<noun>`, claim-link `appLink`); a direct
 * `/c/<code>` link does not, and the resolve answer is what brings the noun.
 * Unknown → null: the welcome then shows the spinner without a line rather
 * than call a pass a ticket.
 */
export function claimLinkNounFromUrl(url: string): ClaimNoun | null {
  try {
    const value = new URL(url).searchParams.get("c");
    return value === "ticket" || value === "pass" || value === "booking" || value === "receipt"
      ? value
      : null;
  } catch {
    return null;
  }
}
