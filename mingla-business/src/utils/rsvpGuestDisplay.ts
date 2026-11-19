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
    });
  });
  return out;
};
