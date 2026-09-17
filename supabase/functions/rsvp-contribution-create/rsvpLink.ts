/**
 * Chip-in → RSVP linkage for rsvp-contribution-create.
 *
 * A chip-in is a second, voluntary action after an RSVP, so every paid
 * contribution should point at the RSVP of the person who paid
 * (`event_rsvp_contributions.rsvp_id`). The host guest console attaches the
 * contribution (and its refund control) to a guest through that column, and
 * the refund needs-attention SMS reads the guest phone through it.
 *
 * Before this module, the handler copied `body.rsvpId` straight into the row,
 * and no caller sent it, so every contribution was written unlinked. The
 * server now owns the link:
 *
 *   1. A client-supplied RSVP id is used only when that RSVP belongs to the
 *      same event AND to the same buyer (account match for an account-held
 *      RSVP, case-insensitive email match for a link-guest RSVP).
 *   2. Otherwise a signed-in buyer links to their own RSVP on the event
 *      (unique on event_id + user_id).
 *   3. Otherwise the buyer's email links to a link-guest RSVP on the event
 *      (unique on event_id + lower(guest_email)).
 *
 * Every rule requires exactly one matching RSVP. Anything else stays unlinked,
 * and a failed lookup never blocks the chip-in.
 *
 * Kept in a sibling module (the returnUrls.ts / ngPaystackSplit.ts pattern) so
 * it is unit-testable without importing the serve()-on-load entry.
 */

export interface RsvpLinkRow {
  id: string;
  event_id: string;
  user_id: string | null;
  guest_email: string | null;
}

/** Read port. Every method returns [] / null on a read error. */
export interface RsvpLinkReader {
  byId(rsvpId: string): Promise<RsvpLinkRow | null>;
  byUser(eventId: string, userId: string): Promise<RsvpLinkRow[]>;
  /** Case-insensitive candidates; the resolver re-checks exact equality. */
  byEmail(eventId: string, normalizedEmail: string): Promise<RsvpLinkRow[]>;
}

export interface RsvpLinkInput {
  eventId: string;
  userId: string | null;
  guestEmail: string | null;
  claimedRsvpId: string | null;
}

export type RsvpLinkSource = "claimed" | "user" | "email" | "none";

export interface RsvpLinkResult {
  rsvpId: string | null;
  source: RsvpLinkSource;
  /** A client sent an RSVP id that does not belong to this event and buyer. */
  claimRejected: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeLinkEmail(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Does this RSVP belong to this buyer on this event? An account-held RSVP
 * needs the same account. A link-guest RSVP needs the same email.
 */
export function rsvpBelongsToBuyer(
  row: RsvpLinkRow,
  input: RsvpLinkInput,
): boolean {
  if (row.event_id !== input.eventId) return false;
  if (row.user_id !== null) {
    return input.userId !== null && row.user_id === input.userId;
  }
  const buyerEmail = normalizeLinkEmail(input.guestEmail);
  return buyerEmail !== null &&
    normalizeLinkEmail(row.guest_email) === buyerEmail;
}

function single(
  rows: RsvpLinkRow[],
  input: RsvpLinkInput,
): RsvpLinkRow | null {
  const owned = rows.filter((row) => rsvpBelongsToBuyer(row, input));
  return owned.length === 1 ? owned[0] : null;
}

export async function resolveContributionRsvpId(
  reader: RsvpLinkReader,
  input: RsvpLinkInput,
): Promise<RsvpLinkResult> {
  let claimRejected = false;

  const claimed = input.claimedRsvpId?.trim() ?? "";
  if (claimed.length > 0) {
    const row = UUID_RE.test(claimed) ? await reader.byId(claimed) : null;
    if (row !== null && rsvpBelongsToBuyer(row, input)) {
      return { rsvpId: row.id, source: "claimed", claimRejected: false };
    }
    claimRejected = true;
  }

  if (input.userId !== null) {
    const row = single(await reader.byUser(input.eventId, input.userId), input);
    if (row !== null) return { rsvpId: row.id, source: "user", claimRejected };
  }

  const email = normalizeLinkEmail(input.guestEmail);
  if (email !== null) {
    const row = single(await reader.byEmail(input.eventId, email), input);
    if (row !== null) return { rsvpId: row.id, source: "email", claimRejected };
  }

  return { rsvpId: null, source: "none", claimRejected };
}

/** Escape LIKE metacharacters so an email is matched literally by ILIKE. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// deno-lint-ignore no-explicit-any
type QueryClient = { from: (table: string) => any };

/** supabase-js implementation of the read port (service-role client). */
export function supabaseRsvpLinkReader(client: QueryClient): RsvpLinkReader {
  const columns = "id,event_id,user_id,guest_email";
  const rows = (data: unknown): RsvpLinkRow[] =>
    Array.isArray(data) ? (data as RsvpLinkRow[]) : [];
  return {
    async byId(rsvpId) {
      try {
        const { data, error } = await client.from("event_rsvps")
          .select(columns).eq("id", rsvpId).maybeSingle();
        return error ? null : (data as RsvpLinkRow | null) ?? null;
      } catch {
        return null;
      }
    },
    async byUser(eventId, userId) {
      try {
        const { data, error } = await client.from("event_rsvps")
          .select(columns).eq("event_id", eventId).eq("user_id", userId)
          .limit(2);
        return error ? [] : rows(data);
      } catch {
        return [];
      }
    },
    async byEmail(eventId, normalizedEmail) {
      try {
        const { data, error } = await client.from("event_rsvps")
          .select(columns).eq("event_id", eventId)
          .ilike("guest_email", escapeLikePattern(normalizedEmail))
          .limit(5);
        return error ? [] : rows(data);
      } catch {
        return [];
      }
    },
  };
}
