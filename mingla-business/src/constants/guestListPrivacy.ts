/**
 * issue #3827 going-box — the one owner of the "Guests on your own list" rules
 * and copy for every host settings surface (ticketed, RSVP, trip, experience).
 *
 * Guests on the host's own list are people the host invited themselves who are
 * not on Mingla. Buyers see them added to the going NUMBER only. They never
 * use up a spot: capacity, spots left, sold out and checkout stay real.
 *
 * EXTRA_GUEST_COUNT_MAX must equal the SQL literal in
 * supabase/migrations/20271128003827_issue_3827_going_box_privacy_extra_guests.sql
 * (helper, CHECK constraint and leaf guard). A test pins the two together.
 */

export const EXTRA_GUEST_COUNT_MAX = 5000;

/** Whole number 0..EXTRA_GUEST_COUNT_MAX; anything else reads as 0. */
export const asExtraGuestCount = (value: unknown): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= EXTRA_GUEST_COUNT_MAX
    ? value
    : 0;

export const EXTRA_GUESTS_LABEL = "Guests on your own list";

export type GuestPrivacyNoun = "going" | "booked";

/** Helper line under the stepper. */
export const extraGuestsHelper = (
  privateGuestList: boolean,
  noun: GuestPrivacyNoun = "going",
): string => {
  if (privateGuestList) {
    return noun === "booked"
      ? "Your guest list is private, so guests won't see a booked count. We'll add these when you show it."
      : "Your guest list is private, so guests won't see a going count. We'll add these when you show it.";
  }
  return noun === "booked"
    ? "People you booked yourself who aren't on Mingla. We add them to your booked count. They don't use up your spots."
    : "People you invited yourself who aren't on Mingla. We add them to your going count. They don't use up your spots.";
};

/** Field error for an out-of-range value (server `invalid_extra_guest_count` / 23514). */
export const EXTRA_GUESTS_ERROR = "Enter a number from 0 to 5,000.";

/**
 * Q1 (Seth, 2026-10-20) — a private guest list switches "Hide remaining count"
 * on and locks it, because a shown capacity minus "N left" gives the count away.
 */
export const HIDE_REMAINING_LOCKED_SUB = "On while your guest list is private.";

/** True when an error from a save is the extras range refusal. */
export const isExtraGuestCountError = (error: unknown): boolean => {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  return (
    text.includes("invalid_extra_guest_count") ||
    text.includes("events_extra_guest_count_valid")
  );
};
