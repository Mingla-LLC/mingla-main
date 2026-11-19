// Issue #4508 1.9 — plus-ones are a phone number each. Name and email are
// optional, so older app versions that still send {name, email, phone} keep
// working. C1: a signed-in inviter may instead send {userId} for a friend
// picked from their friends list; the database checks the friendship and
// resolves that account's proven number itself (never sent back). The
// database re-checks everything (host limit, own number, duplicates, numbers
// already on the list, released numbers, the caps); this module gives the
// friendly 400s before the write.

export type NormalizedGuest =
  | {
    name?: string;
    email?: string;
    phone: string;
    phoneCountryIso: string | null;
  }
  | { userId: string };

export type GuestParseResult =
  | { ok: true; guests: NormalizedGuest[]; plusCount: number }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
const COUNTRY_ISO_RE = /^[A-Z]{2}$/;
const GUEST_KEYS = ["name", "email", "phone", "phoneCountryIso"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const digitsOf = (phone: string): string => phone.replace(/\D/g, "");

/**
 * `plusCount` may be omitted by new clients: it is then the number of guests.
 * When sent, it must equal the number of guests (going / maybe).
 *
 * The inviter's own number is NOT refused here (P3-6): an older app re-sends
 * the whole party, and a guest already on it must pass. The database refuses
 * the own number only for a guest being added (rsvp_guest_own_number).
 */
export function parseGuests(input: {
  rawGuests: unknown;
  rawPlusCount: unknown;
  rsvpStatus: "going" | "not_going" | "maybe";
  primaryPhone: string | null;
  /** C1: only a signed-in inviter may pick a friend by account. */
  signedIn?: boolean;
}): GuestParseResult {
  if (input.rsvpStatus === "not_going") {
    return { ok: true, guests: [], plusCount: 0 };
  }
  const rawGuests = Array.isArray(input.rawGuests) ? input.rawGuests : [];
  const plusCount = typeof input.rawPlusCount === "number" &&
      Number.isFinite(input.rawPlusCount)
    ? Math.max(0, Math.floor(input.rawPlusCount))
    : rawGuests.length;
  if (plusCount === 0) return { ok: true, guests: [], plusCount: 0 };
  if (rawGuests.length !== plusCount) {
    return { ok: false, error: "rsvp_guest_count_mismatch" };
  }
  const seen = new Set<string>();
  const seenUsers = new Set<string>();
  const guests: NormalizedGuest[] = [];
  for (const g of rawGuests) {
    // C1: {userId} alone, from a signed-in inviter.
    if (
      g && typeof g === "object" && !Array.isArray(g) &&
      "userId" in (g as Record<string, unknown>)
    ) {
      const picked = g as Record<string, unknown>;
      if (
        input.signedIn !== true || Object.keys(picked).length !== 1 ||
        typeof picked.userId !== "string" || !UUID_RE.test(picked.userId)
      ) {
        return { ok: false, error: "rsvp_guest_keys_invalid" };
      }
      const userId = picked.userId.toLowerCase();
      if (seenUsers.has(userId)) {
        return { ok: false, error: "rsvp_guest_duplicate" };
      }
      seenUsers.add(userId);
      guests.push({ userId });
      continue;
    }
    if (
      !g || typeof g !== "object" || Array.isArray(g) ||
      Object.keys(g).some((key) => !GUEST_KEYS.includes(key))
    ) {
      return { ok: false, error: "rsvp_guest_keys_invalid" };
    }
    const guest = g as Record<string, unknown>;
    if (
      (guest.name !== undefined && guest.name !== null &&
        typeof guest.name !== "string") ||
      (guest.email !== undefined && guest.email !== null &&
        typeof guest.email !== "string")
    ) {
      return { ok: false, error: "rsvp_guest_keys_invalid" };
    }
    const name = typeof guest.name === "string" ? guest.name.trim() : "";
    const email = typeof guest.email === "string" ? guest.email.trim() : "";
    const rawPhone = typeof guest.phone === "string" ? guest.phone.trim() : "";
    if (name.length > 120 || email.length > 254 || rawPhone.length > 40) {
      return { ok: false, error: "rsvp_guest_payload_invalid" };
    }
    if (rawPhone.length === 0) {
      return { ok: false, error: "rsvp_guest_contact_required" };
    }
    if (email.length > 0 && !EMAIL_RE.test(email)) {
      return { ok: false, error: "rsvp_guest_email_invalid" };
    }
    const iso = guest.phoneCountryIso;
    let phoneCountryIso: string | null = null;
    if (iso !== undefined && iso !== null && iso !== "") {
      if (typeof iso !== "string" || !COUNTRY_ISO_RE.test(iso)) {
        return { ok: false, error: "rsvp_guest_phone_country_invalid" };
      }
      phoneCountryIso = iso;
    }
    if (!PHONE_RE.test(rawPhone)) {
      return { ok: false, error: "rsvp_guest_phone_invalid" };
    }
    const digits = digitsOf(rawPhone);
    if (seen.has(digits)) return { ok: false, error: "rsvp_guest_duplicate" };
    seen.add(digits);
    guests.push({
      ...(name.length > 0 ? { name } : {}),
      ...(email.length > 0 ? { email } : {}),
      phone: rawPhone,
      phoneCountryIso,
    });
  }
  return { ok: true, guests, plusCount };
}

/** RPC messages the form can act on, with their HTTP status. */
export const GUEST_RPC_ERRORS: ReadonlyArray<readonly [string, number]> = [
  ["rsvp_plus_ones_exceeded", 400],
  ["rsvp_guest_own_number", 400],
  ["rsvp_guest_duplicate", 400],
  ["rsvp_guest_already_listed", 409],
  ["rsvp_guest_released", 409],
  ["rsvp_guest_email_invalid", 400],
  ["rsvp_guest_phone_invalid", 400],
  ["rsvp_guest_phone_country_invalid", 400],
  ["rsvp_guest_keys_invalid", 400],
  ["rsvp_guest_not_friend", 400],
  ["rsvp_guest_daily_cap", 429],
];

export function mapGuestRpcError(
  code: string | undefined,
  message: string | undefined,
): { error: string; status: number } | null {
  if (code === "P4508") return { error: "rsvp_guest_daily_cap", status: 429 };
  const text = message ?? "";
  for (const [error, status] of GUEST_RPC_ERRORS) {
    if (text.includes(error)) return { error, status };
  }
  return null;
}

/** Issue #4508 P1-2 — the salted hash a signed-out inviter's caps are keyed
 * by (hex, 64). The raw address never leaves this function. */
export async function rsvpClientKey(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`mingla-rsvp-client:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
