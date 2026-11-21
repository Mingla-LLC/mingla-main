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

import type {
  RsvpGuestPayload,
  RsvpPartyGuest,
  RsvpSubmittedGuest,
} from "./rsvpGuestTypes.ts";
export type { RsvpGuestPayload, RsvpPartyGuest, RsvpSubmittedGuest };
// issue #4508 R6 — the server's text route rule, so the form never promises
// a text to a number Mingla cannot text.
import { rsvpGuestNumberTextable } from "./rsvpGuestTextRoute.ts";

const E164_RE = /^\+[1-9][0-9]{7,14}$/;
export const isCompleteE164 = (phone: string | null | undefined): phone is string =>
  typeof phone === "string" && E164_RE.test(phone.trim());

/**
 * Number guests send `{ phone, phoneCountryIso }` only (no name, no email:
 * 1.1). A friend picked from the list sends `{ userId }` alone (contract v2,
 * C1): the server checks the friendship and resolves their proven number,
 * which this device never sees.
 */
export const guestPayloadOf = (
  g: Pick<RsvpPartyGuest, "source" | "phone" | "phoneCountryIso" | "userId">,
): RsvpGuestPayload =>
  g.source !== "friend" && g.phone !== null
    ? { phone: g.phone, phoneCountryIso: g.phoneCountryIso }
    : { userId: g.userId as string };
export const buildGuestPayload = (party: ReadonlyArray<RsvpPartyGuest>): RsvpGuestPayload[] =>
  party.map(guestPayloadOf);

// The two refusals the guest form shows inline. rsvpGuestErrors.ts repeats the
// same words for the server's refusals (a separate on-demand chunk: a module
// both imported would be hoisted into the boot payload); a test pins them equal.
export const RSVP_GUEST_LIMIT_REACHED = "That's the most this host allows.";
export const RSVP_GUEST_OWN_NUMBER = "That's you. Enter a friend's number.";
/** The confirm dialog's line for a guest Mingla can text. */
export const RSVP_GUEST_GETS_TEXT_AND_PASS = "Gets a text and a pass";
/** issue #4508 R6 — before submit, for a number Mingla cannot text yet. */
export const RSVP_GUEST_CANT_TEXT_YET =
  "We can't text this number yet. You'll get an invite to send them.";


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
  // issue #4508 R1 — the lookup answered rate_limited.
  lookupRateLimited: "Too many lookups. Try again in a minute.",
  // issue #4508 round 8 — the 200-a-day lookup ceiling.
  lookupRateLimitedToday: "You've checked a lot of numbers today. Try again tomorrow, or add this one anyway.",
  // issue #4508 round 8 — a number the lookup never checked: the text route
  // only, never "Not on Mingla yet".
  uncheckedTexted: "We'll text them an invite",
  // issue #4508 P3 — digits typed with no country picked.
  pickCountry: "Pick a country first",
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
    | { state: "failed"; code?: string };
}

export const digitsOf = (phone: string): string => phone.replace(/\D/g, "");

/**
 * issue #4508 (round 7) — the length of an E.164 number's country calling
 * code. ITU calling codes are prefix-free: 1 and 7 are one digit, these
 * two-digit codes are listed, and every other code is three digits.
 */
const TWO_DIGIT_CALLING_CODES = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46",
  "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63",
  "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
]);
export const callingCodeLength = (digits: string): number =>
  digits.startsWith("1") || digits.startsWith("7")
    ? 1
    : TWO_DIGIT_CALLING_CODES.has(digits.slice(0, 2))
      ? 2
      : 3;

/**
 * Display grouping for a guest number: the country's calling code on its own,
 * then the national number as "… 123 4567" ("+1 555 123 4567",
 * "+233 24 123 4567", "+44 770 090 0123"). Display only.
 */
export const formatPartyPhone = (phone: string): string => {
  const d = digitsOf(phone);
  if (d.length <= 4) return phone;
  const cc = Math.min(callingCodeLength(d), d.length - 4);
  const national = d.slice(cc);
  if (national.length <= 4) return `+${d.slice(0, cc)} ${national}`;
  const head = national.slice(0, -4).replace(/\B(?=(\d{3})+$)/g, " ");
  return `+${d.slice(0, cc)} ${head} ${national.slice(-4)}`;
};

/**
 * The name a guest shows under in the confirm dialog and on the success card:
 * the account's name when known, else the number (1.7). Set once when the guest
 * is added (`label`), so the eager RSVP body never carries the formatter.
 */
export const partyGuestLabel = (g: Pick<RsvpPartyGuest, "displayName" | "phone">): string =>
  g.displayName !== null && g.displayName.trim().length > 0
    ? g.displayName.trim()
    : g.phone !== null
      ? formatPartyPhone(g.phone)
      : "Guest";

/**
 * issue #4508 round 8 — a number whose lookup did not answer (rate limited,
 * offline): nothing is known about an account, so the line says only whether
 * a text can go.
 */
export const rsvpUncheckedLine = (phone: string): string =>
  rsvpGuestNumberTextable(phone) ? RSVP_PARTY_COPY.uncheckedTexted : RSVP_GUEST_CANT_TEXT_YET;

/** issue #4508 round 8 — the words for a lookup that did not answer. */
export const rsvpLookupFailedMessage = (code: string | undefined): string => {
  const c = code ?? "";
  if (c.includes("rate_limited_today")) return RSVP_PARTY_COPY.lookupRateLimitedToday;
  if (c.includes("rate_limited")) return RSVP_PARTY_COPY.lookupRateLimited;
  return RSVP_PARTY_COPY.lookupFailed;
};

/** issue #4508 R6 — the "not on Mingla" line: a text promise only when one can go. */
export const rsvpNotOnMinglaLine = (phone: string | null): string =>
  phone !== null && !rsvpGuestNumberTextable(phone)
    ? RSVP_GUEST_CANT_TEXT_YET
    : RSVP_PARTY_COPY.notOnMingla;

const numberGuest = (
  phone: string,
  iso: string | null,
  result: RsvpGuestLookupResult | null,
): RsvpPartyGuest => {
  const user = result?.user ?? null;
  return {
    // R6: set once at add time, so the confirm dialog (its own chunk) and
    // the eager body never carry the route rule.
    confirmLine: rsvpGuestNumberTextable(phone)
      ? RSVP_GUEST_GETS_TEXT_AND_PASS
      : RSVP_GUEST_CANT_TEXT_YET,
    key: partyGuestKey({ userId: user?.id ?? null, phone }),
    source: "number",
    phone,
    phoneCountryIso: iso,
    userId: user?.id ?? null,
    displayName: user?.displayName ?? null,
    username: user?.username ?? null,
    onMingla: result?.onMingla === true,
    label: partyGuestLabel({ displayName: user?.displayName ?? null, phone }),
    payload: { phone, phoneCountryIso: iso },
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
      line: rsvpUncheckedLine(phone),
      message: rsvpLookupFailedMessage(input.lookup.code),
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
        line: rsvpNotOnMinglaLine(phone),
      };
};

/** The guest an Add press (bar, preview or done key) would add; null ⇒ nothing to add. */
export const addableFromPreview = (preview: RsvpNumberPreview): RsvpPartyGuest | null =>
  preview.kind === "ready" || preview.kind === "unchecked" ? preview.guest : null;

export const friendGuest = (friend: RsvpFriendOption): RsvpPartyGuest => ({
  key: partyGuestKey({ userId: friend.userId, phone: null }),
  confirmLine: RSVP_GUEST_GETS_TEXT_AND_PASS,
  source: "friend",
  phone: null,
  phoneCountryIso: null,
  userId: friend.userId,
  displayName: friend.displayName,
  username: friend.username,
  onMingla: true,
  label: partyGuestLabel({ displayName: friend.displayName, phone: null }),
  payload: { userId: friend.userId },
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



