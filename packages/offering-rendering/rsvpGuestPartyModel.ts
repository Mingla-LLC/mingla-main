/**
 * rsvpGuestPartyModel — issue #4508 "Bring a friend with just their number".
 *
 * Pure, dependency-free model behind the RSVP form's "Who's coming with you?"
 * block (spec 1.1-1.8 with amendments 1-4). No react / react-native import, so
 * the rules are Deno-testable and identical on every surface (Explorer, buyer
 * web, Host preview).
 *
 * Two routes add a person, with ONE result (amendment 4, 1.2c):
 *   - By phone number (first): a complete valid number shows a live preview
 *     (server op `guest_lookup`), then Add (bar button, preview button or the
 *     keyboard's done key).
 *   - Or from your friends (signed-in only): a search over the already-loaded
 *     friends list, and three chips while the search box is empty.
 * A person is the same guest whichever way they were added: a number whose
 * account is a friend already in the party reads "Already coming with you",
 * and the reverse.
 */

import {
  RSVP_GUEST_GETS_TEXT_AND_PASS,
  RSVP_GUEST_LIMIT_REACHED,
  RSVP_GUEST_OWN_NUMBER,
  digitsOf,
  formatPartyPhone,
  isCompleteE164,
} from "./rsvpGuestCopy";

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
}

/** A friend the signed-in inviter can pick (from `get_user_circle`). */
export interface RsvpFriendOption {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  /** tier 'close' — close friends lead the chips (1.4c). */
  closeFriend: boolean;
}

/** The `guest_lookup` answer (wave A contract §1). */
export interface RsvpGuestLookupResult {
  valid: boolean;
  isYou: boolean;
  onMingla: boolean;
  alreadyOnList: boolean;
  released: boolean;
  /** Present only for a signed-in caller whose number matched an account. */
  user?: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  } | null;
}

/** Surface-supplied lookup. Throws Error(code) on failure (rate_limited, unavailable, offline…). */
export type RsvpGuestLookup = (phoneE164: string) => Promise<RsvpGuestLookupResult>;

// ── copy (exact strings from the spec; amendments win) ──
export const RSVP_PARTY_COPY = {
  title: "Who's coming with you?",
  numberLabel: "By phone number",
  numberPlaceholder: "Phone number",
  friendsLabel: "Or from your friends",
  friendsPlaceholder: "Search friends",
  chipsLabel: "People you go out with most",
  notOnMingla: "Not on Mingla yet · We'll text them an invite",
  onMingla: "On Mingla",
  alreadyComing: "Already coming with you",
  invalid: "Enter a valid phone number",
  own: RSVP_GUEST_OWN_NUMBER,
  released: "This number can't be invited to this event.",
  limitReached: RSVP_GUEST_LIMIT_REACHED,
  checking: "Checking this number…",
  lookupFailed: "Couldn't check this number. You can still add it.",
  add: "Add",
  getsTextAndPass: RSVP_GUEST_GETS_TEXT_AND_PASS,
} as const;

export const rsvpPartyHelper = (max: number): string =>
  max === 1
    ? "Up to 1 person. Just their number."
    : `Up to ${max} people. Just their number.`;

export const rsvpNoFriendMatch = (text: string): string =>
  `No friend called "${text}". Add them by phone number above.`;

export const rsvpAlreadyListed = (name: string | null): string =>
  `${name !== null && name.trim().length > 0 ? name.trim() : "This number"} is already on the list`;

/** "On Mingla · @username" (signed in, matched) or "On Mingla" (signed out / no username). */
export const rsvpOnMinglaLine = (username: string | null): string =>
  username !== null && username.trim().length > 0
    ? `On Mingla · @${username.trim().replace(/^@/, "")}`
    : RSVP_PARTY_COPY.onMingla;

export const rsvpFriendLine = (username: string | null): string =>
  username !== null && username.trim().length > 0
    ? `Friend · @${username.trim().replace(/^@/, "")}`
    : "Friend";

export const partyGuestKey = (input: { userId: string | null; phone: string | null }): string =>
  input.userId !== null ? `user:${input.userId}` : `phone:${digitsOf(input.phone ?? "")}`;

/** Is this person (by account or by number) already in the party? */
export const partyHas = (
  party: ReadonlyArray<RsvpPartyGuest>,
  probe: { userId?: string | null; phone?: string | null },
): boolean => {
  const digits = probe.phone ? digitsOf(probe.phone) : null;
  return party.some(
    (g) =>
      (probe.userId != null && g.userId === probe.userId) ||
      (digits !== null && digits.length > 0 && g.phone !== null && digitsOf(g.phone) === digits),
  );
};

/** What the preview row under the number field shows (amendment 4). */
export type RsvpNumberPreview =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "refused"; message: string }
  | { kind: "ready"; guest: RsvpPartyGuest; title: string; line: string }
  | { kind: "unchecked"; guest: RsvpPartyGuest; title: string; line: string; message: string };

export interface NumberPreviewInput {
  phone: string | null;
  phoneCountryIso: string | null;
  party: ReadonlyArray<RsvpPartyGuest>;
  /** The inviter's own number(s), digits or E.164; refused locally (1.3, 17). */
  ownPhones: ReadonlyArray<string>;
  lookup:
    | { state: "none" }
    | { state: "checking" }
    | { state: "done"; result: RsvpGuestLookupResult }
    | { state: "failed" };
}

const numberGuest = (
  phone: string,
  iso: string | null,
  result: RsvpGuestLookupResult | null,
): RsvpPartyGuest => {
  const user = result?.user ?? null;
  return {
    key: partyGuestKey({ userId: user?.id ?? null, phone }),
    source: "number",
    phone,
    phoneCountryIso: iso,
    userId: user?.id ?? null,
    displayName: user?.displayName ?? null,
    username: user?.username ?? null,
    onMingla: result?.onMingla === true,
  };
};

/** The single owner of the number route's refusals and preview. */
export const numberPreview = (input: NumberPreviewInput): RsvpNumberPreview => {
  const phone = input.phone?.trim() ?? "";
  if (!isCompleteE164(phone)) return { kind: "idle" };
  const digits = digitsOf(phone);
  if (input.ownPhones.some((own) => own.length > 0 && digitsOf(own) === digits)) {
    return { kind: "refused", message: RSVP_PARTY_COPY.own };
  }
  if (partyHas(input.party, { phone })) {
    return { kind: "refused", message: RSVP_PARTY_COPY.alreadyComing };
  }
  if (input.lookup.state === "none" || input.lookup.state === "checking") {
    return { kind: "checking" };
  }
  if (input.lookup.state === "failed") {
    const guest = numberGuest(phone, input.phoneCountryIso, null);
    return {
      kind: "unchecked",
      guest,
      title: formatPartyPhone(phone),
      line: RSVP_PARTY_COPY.notOnMingla,
      message: RSVP_PARTY_COPY.lookupFailed,
    };
  }
  const result = input.lookup.result;
  if (!result.valid) return { kind: "refused", message: RSVP_PARTY_COPY.invalid };
  if (result.isYou) return { kind: "refused", message: RSVP_PARTY_COPY.own };
  if (result.user && partyHas(input.party, { userId: result.user.id })) {
    return { kind: "refused", message: RSVP_PARTY_COPY.alreadyComing };
  }
  if (result.alreadyOnList) {
    return { kind: "refused", message: rsvpAlreadyListed(result.user?.displayName ?? null) };
  }
  if (result.released) return { kind: "refused", message: RSVP_PARTY_COPY.released };
  const guest = numberGuest(phone, input.phoneCountryIso, result);
  return guest.onMingla
    ? {
        kind: "ready",
        guest,
        title: guest.displayName ?? formatPartyPhone(phone),
        line: rsvpOnMinglaLine(guest.username),
      }
    : {
        kind: "ready",
        guest,
        title: formatPartyPhone(phone),
        line: RSVP_PARTY_COPY.notOnMingla,
      };
};

/** The guest an Add press (bar, preview or done key) would add; null ⇒ nothing to add. */
export const addableFromPreview = (preview: RsvpNumberPreview): RsvpPartyGuest | null =>
  preview.kind === "ready" || preview.kind === "unchecked" ? preview.guest : null;

export const friendGuest = (friend: RsvpFriendOption): RsvpPartyGuest => ({
  key: partyGuestKey({ userId: friend.userId, phone: null }),
  source: "friend",
  phone: null,
  phoneCountryIso: null,
  userId: friend.userId,
  displayName: friend.displayName,
  username: friend.username,
  onMingla: true,
});

/** Add with the limit and de-duplication enforced in one place. */
export const addPartyGuest = (
  party: ReadonlyArray<RsvpPartyGuest>,
  guest: RsvpPartyGuest,
  max: number,
): RsvpPartyGuest[] => {
  if (party.length >= max) return [...party];
  if (partyHas(party, { userId: guest.userId, phone: guest.phone })) return [...party];
  return [...party, guest];
};

export const removePartyGuest = (
  party: ReadonlyArray<RsvpPartyGuest>,
  key: string,
): RsvpPartyGuest[] => party.filter((g) => g.key !== key);

// ── friends search (amendment 1 1.4a / amendment 2) ──
const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Matches any word start of the name or the username, ignoring case and accents. */
export const friendMatches = (friend: RsvpFriendOption, query: string): boolean => {
  const q = fold(query.trim()).replace(/^@/, "");
  if (q.length === 0) return false;
  const words = [
    ...fold(friend.displayName).split(/[\s\-_.']+/),
    ...(friend.username !== null ? [fold(friend.username).replace(/^@/, "")] : []),
  ].filter((w) => w.length > 0);
  if (words.some((w) => w.startsWith(q))) return true;
  // A full-name query ("ada lov") matches from the first word start.
  return fold(friend.displayName).startsWith(q);
};

/** People already in the party or on the event's list are left out (1.4d). */
const available = (
  friends: ReadonlyArray<RsvpFriendOption>,
  party: ReadonlyArray<RsvpPartyGuest>,
  listedUserIds: ReadonlySet<string>,
): RsvpFriendOption[] =>
  friends.filter((f) => !partyHas(party, { userId: f.userId }) && !listedUserIds.has(f.userId));

export const searchFriends = (
  friends: ReadonlyArray<RsvpFriendOption>,
  query: string,
  party: ReadonlyArray<RsvpPartyGuest>,
  listedUserIds: ReadonlySet<string> = new Set(),
): RsvpFriendOption[] =>
  available(friends, party, listedUserIds)
    .filter((f) => friendMatches(f, query))
    .slice(0, 5);

/**
 * Three chips while the search box is empty: close friends first, then
 * friends, in the list's own order (no "most attended with" ranking exists).
 */
export const friendChips = (
  friends: ReadonlyArray<RsvpFriendOption>,
  party: ReadonlyArray<RsvpPartyGuest>,
  listedUserIds: ReadonlySet<string> = new Set(),
): RsvpFriendOption[] => {
  const pool = available(friends, party, listedUserIds);
  return [...pool.filter((f) => f.closeFriend), ...pool.filter((f) => !f.closeFriend)].slice(0, 3);
};

// ── the submit payload (wave A contract §1) ──
export type RsvpGuestPayload =
  | { phone: string; phoneCountryIso: string | null }
  | { userId: string };

// ── "Send it yourself too" (1.15) and Nudge (1.24) ──
export interface GuestInviteMessageInput {
  eventName: string;
  /** e.g. "Sat 22 Nov · 8:00 PM" — split into "{short date}, {time}". */
  dateLine: string;
  /** City-level area only; null for online or unknown. */
  area: string | null;
  online: boolean;
  link: string;
}


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
}

