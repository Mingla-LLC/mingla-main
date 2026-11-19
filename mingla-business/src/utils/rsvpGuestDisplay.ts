/**
 * #4508 1.11 / 1.25 — pure display helpers for plus-one guests on the Host
 * guest list and the door scanner. The server owns the display-name rule
 * (account name, else the name given, else "{Inviter first name}'s guest",
 * else "Guest"); these helpers only make sure the client never renders an
 * empty name, "null" or "undefined", and shapes the "Invited by" line and the
 * Claimed / Not claimed pill.
 */

export interface RsvpPlusGuestInput {
  id?: string | null;
  name?: string | null;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  invitedByName?: string | null;
  claimed?: boolean | null;
  onMingla?: boolean | null;
  broughtByGuestId?: string | null;
  phoneLast4?: string | null;
}

export interface RsvpPlusGuest {
  id: string;
  name: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  invitedByName: string | null;
  claimed: boolean;
  onMingla: boolean;
  broughtByGuestId: string | null;
  /** #4508 C8 - last four digits of the number the plus-one was added with; never the full number. */
  phoneLast4: string | null;
}

/** Trimmed text, or null when empty or a stringified-null artefact. */
export const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0) return null;
  const lower = t.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  return t;
};

/** "Ada O." -> "Ada". Used only when the server name is empty. */
const firstWord = (value: string): string => value.split(/\s+/)[0] ?? value;

/** Never empty: server name, else "{first}'s guest", else "Guest". */
export const guestDisplayName = (
  name: unknown,
  invitedByName?: unknown,
): string => {
  const own = cleanText(name);
  if (own !== null) return own;
  const inviter = cleanText(invitedByName);
  if (inviter !== null) return `${firstWord(inviter)}'s guest`;
  return "Guest";
};

/** "Invited by Ada O." or null when the server gave no inviter. */
export const invitedByLine = (invitedByName: unknown): string | null => {
  const inviter = cleanText(invitedByName);
  return inviter === null ? null : `Invited by ${inviter}`;
};

export const claimStatusLabel = (claimed: boolean | null | undefined): string =>
  claimed === true ? "Claimed" : "Not claimed";

/** Empty or null-ish cell -> "-" (plain hyphen, for lists and CSV alike). */
export const emptyCell = (value: unknown): string => cleanText(value) ?? "-";

/** Door scanner overlay detail line for a successful or repeat scan. */
export const scanDetailLine = (
  entityType: "primary" | "guest" | null | undefined,
  invitedByName: unknown,
): string => {
  if (entityType !== "guest") return "Primary guest";
  const invited = invitedByLine(invitedByName);
  return invited === null ? "Plus-one" : `Plus-one · ${invited}`;
};

/** Defensive map of the server's plus_checkins[] jsonb (older shapes safe). */
export const normalisePlusGuests = (raw: unknown): RsvpPlusGuest[] => {
  if (!Array.isArray(raw)) return [];
  const out: RsvpPlusGuest[] = [];
  raw.forEach((item: unknown, index: number) => {
    if (item === null || typeof item !== "object") return;
    const g = item as RsvpPlusGuestInput;
    const invitedByName = cleanText(g.invitedByName);
    out.push({
      id: cleanText(g.id) ?? `guest-${index}`,
      name: guestDisplayName(g.name, invitedByName),
      checkedInAt: cleanText(g.checkedInAt),
      checkedInBy: cleanText(g.checkedInBy),
      invitedByName,
      claimed: g.claimed === true,
      onMingla: g.onMingla === true,
      broughtByGuestId: cleanText(g.broughtByGuestId),
      phoneLast4: cleanPhoneLast4(g.phoneLast4),
    });
  });
  return out;
};

/**
 * Exactly four digits, or null. Anything longer (a full number leaking through
 * a wrong field) or malformed is dropped, so the client can never render more
 * than the last four digits.
 */
export const cleanPhoneLast4 = (value: unknown): string | null => {
  const t = cleanText(value);
  return t !== null && /^\d{4}$/.test(t) ? t : null;
};

/** "Number ending 0199", or null when the server gave no usable digits. */
export const phoneLast4Line = (value: unknown): string | null => {
  const digits = cleanPhoneLast4(value);
  return digits === null ? null : `Number ending ${digits}`;
};

/** A plus-one the host may admit by hand: has not claimed and is not in yet. */
export const canCheckInByHand = (
  guest: Pick<RsvpPlusGuest, "claimed" | "checkedInAt">,
): boolean => guest.claimed !== true && cleanText(guest.checkedInAt) === null;

/** "Check in with Ada" (first name of the inviter), or "Check in". */
export const manualCheckInLabel = (invitedByName: unknown): string => {
  const inviter = cleanText(invitedByName);
  return inviter === null ? "Check in" : `Check in with ${firstWord(inviter)}`;
};

export type ManualCheckInOutcome =
  | { kind: "checked_in"; message: string; checkedInAt: string | null }
  | { kind: "refused"; message: string };

/**
 * Reads host_check_in_rsvp_guest's answer (same shape as a door scan) into one
 * truthful outcome. success and duplicate both mean the guest IS checked in;
 * every other answer is a refusal that says why, and an unknown answer is
 * never shown as a success.
 */
export const manualCheckInOutcome = (
  response: { result?: unknown; checkedInAt?: unknown } | null | undefined,
): ManualCheckInOutcome => {
  const result = response?.result;
  const at = cleanText(response?.checkedInAt);
  switch (result) {
    case "success":
      return { kind: "checked_in", message: "Checked in.", checkedInAt: at };
    case "duplicate":
      return { kind: "checked_in", message: "Already checked in.", checkedInAt: at };
    case "not_eligible":
      return { kind: "refused", message: "This guest's RSVP isn't approved, so they can't be checked in." };
    case "revoked":
      return { kind: "refused", message: "This RSVP was removed or the event was cancelled." };
    case "not_yet_open":
      return { kind: "refused", message: "Check-in isn't open yet for this event." };
    case "event_ended":
      return { kind: "refused", message: "This event has ended, so check-in is closed." };
    default:
      return { kind: "refused", message: "We couldn't check this guest in. Try again." };
  }
};

/** Copy for a failed manual check-in call; null = use the generic RPC copy. */
export const manualCheckInFailureCopy = (message: unknown): string | null =>
  typeof message === "string" && message.includes("scanner_not_authorized")
    ? "You don't have permission to check guests in for this event."
    : null;

/** Mark one plus-one checked in on a list without touching the others. */
export const markPlusGuestCheckedIn = (
  list: readonly RsvpPlusGuest[],
  guestId: string,
  checkedInAt: string,
): RsvpPlusGuest[] =>
  list.map((g) =>
    g.id === guestId && g.checkedInAt === null ? { ...g, checkedInAt } : g,
  );
