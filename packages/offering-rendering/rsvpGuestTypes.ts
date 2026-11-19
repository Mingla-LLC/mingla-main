/**
 * rsvpGuestTypes — issue #4508: the three guest-party shapes the eager RSVP copy
 * and the on-demand guest model both name. Types only (erased at build), so this
 * leaf lets rsvpGuestCopy and rsvpGuestPartyModel each depend on it without
 * importing each other.
 */

/** One person the inviter is bringing. */
export interface RsvpPartyGuest {
  /** Stable identity: `user:<id>` when the account is known, else `phone:<digits>`. */
  key: string;
  source: "number" | "friend";
  /** E.164; null for a friend picked from the list (no number typed). */
  phone: string | null;
  phoneCountryIso: string | null;
  /** The account, when known (friend pick, or a number the lookup matched). */
  userId: string | null;
  /** Only ever an account's name; signed-out inviters never learn it (1.8). */
  displayName: string | null;
  username: string | null;
  onMingla: boolean;
  /** Confirm-dialog / success-card name: the account's name, else the formatted number. */
  label: string;
  /**
   * issue #4508 R6 — the confirm dialog's line under the name: a text promise
   * only for a number Mingla can text. Set once when the guest is added.
   */
  confirmLine: string;
}

// ── the submit payload (wave A contract §1) ──
export type RsvpGuestPayload =
  | { phone: string; phoneCountryIso: string | null }
  | { userId: string };

/** Per-guest invite status on the success screen (1.14, 1.15). */
export interface RsvpSubmittedGuest {
  guestId: string | null;
  phoneLast4: string | null;
  onMingla: boolean;
  displayName: string | null;
  claimed: boolean;
  inviteUrl: string | null;
  inviteCode: string | null;
  /**
   * C3 — false when the server knows now that this guest will never be
   * texted (no number, the number opted out, or it had its guest invites
   * for today). Sending is asynchronous, so true means "on its way", not
   * "delivered".
   */
  willText: boolean;
  /**
   * issue #4508 P3 — why a signed-in inviter's guest will not be texted, when
   * the server says (e.g. "unsupported_region": no SMS route for the
   * country). Absent / null otherwise.
   */
  notTextedReason?: string | null;
}
