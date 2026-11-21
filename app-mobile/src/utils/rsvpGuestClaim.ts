/**
 * issue #4508 1.16-1.21 — the RSVP guest link ("{Inviter} saved you a spot").
 *
 * Pure (no react / react-native / supabase import) so it is Deno-testable:
 * the claim-link contract (wave A CONTRACTS §2) parsed into one view state,
 * and every claim outcome mapped to a designed screen with a way forward.
 */

/** Claim codes: 10 characters, the claim-link alphabet (no I, L, O, U). */
export const RSVP_GUEST_CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;

export const normalizeRsvpGuestCode = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return RSVP_GUEST_CODE_RE.test(code) ? code : null;
};

/** The in-app route for a guest link. */
export const rsvpGuestRoutePath = (code: string): string =>
  `/rsvp-guest/${encodeURIComponent(code)}`;

export type RsvpGuestLinkStatus =
  | "open"
  | "claimed"
  | "released"
  | "ended"
  | "not_eligible"
  | "not_found";

export interface RsvpGuestEvent {
  id: string | null;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  venueLine: string | null;
  brandName: string | null;
  eventUrl: string | null;
}

export interface RsvpGuestResolved {
  status: RsvpGuestLinkStatus;
  guestId: string | null;
  rsvpId: string | null;
  inviterName: string;
  inviterFirstName: string | null;
  inviterHasAccount: boolean;
  phoneLast4: string | null;
  claimedByViewer: boolean;
  viewerCanClaim: boolean;
  viewerIsInviter: boolean;
  event: RsvpGuestEvent | null;
}

const STATUSES: ReadonlySet<string> = new Set([
  "open",
  "claimed",
  "released",
  "ended",
  "not_eligible",
  "not_found",
]);

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/** `rsvp_guest_resolve` → view model. Anything unrecognised reads as not found. */
export const parseRsvpGuestResolve = (data: unknown): RsvpGuestResolved => {
  const row = (data !== null && typeof data === "object" && !Array.isArray(data)
    ? data
    : {}) as Record<string, unknown>;
  const statusText = text(row.status);
  const status = (statusText !== null && STATUSES.has(statusText)
    ? statusText
    : "not_found") as RsvpGuestLinkStatus;
  const ev = row.event !== null && typeof row.event === "object" && !Array.isArray(row.event)
    ? (row.event as Record<string, unknown>)
    : null;
  return {
    status,
    guestId: text(row.guestId),
    rsvpId: text(row.rsvpId),
    inviterName: text(row.inviterName) ?? "A friend",
    inviterFirstName: text(row.inviterFirstName),
    inviterHasAccount: row.inviterHasAccount === true,
    phoneLast4: text(row.phoneLast4),
    claimedByViewer: row.claimedByViewer === true,
    viewerCanClaim: row.viewerCanClaim === true,
    viewerIsInviter: row.viewerIsInviter === true,
    event: ev === null
      ? null
      : {
          id: text(ev.id),
          title: text(ev.title) ?? "This event",
          startsAt: text(ev.startsAt),
          endsAt: text(ev.endsAt),
          timezone: text(ev.timezone),
          venueLine: text(ev.venueLine),
          brandName: text(ev.brandName),
          eventUrl: text(ev.eventUrl),
        },
  };
};

/** `https://host.usemingla.com/e/{brand}/{event}` → the in-app `/e/{brand}/{event}`. */
export const inAppEventPath = (eventUrl: string | null): string | null => {
  if (eventUrl === null) return null;
  const match = /^https:\/\/(?:host\.)?usemingla\.com\/e\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/?$/i
    .exec(eventUrl);
  return match ? `/e/${match[1]}/${match[2]}` : null;
};

export type RsvpGuestClaimOutcome =
  | "claimed"
  | "already_claimed"
  | "claimed_by_other"
  | "own_party"
  | "already_on_list"
  | "ineligible"
  | "released"
  | "not_found"
  | "phone_unproved"
  | "unauthorized"
  | "conflict"
  | "rate_limited"
  | "unavailable";

export interface RsvpGuestClaimResult {
  outcome: RsvpGuestClaimOutcome;
  guestId: string | null;
  rsvpId: string | null;
  eventId: string | null;
  inviterName: string | null;
  friendship: "connected" | "already_friends" | "blocked" | "none" | null;
  closeFriend: boolean;
  phoneLast4: string | null;
}

const OUTCOMES: ReadonlySet<string> = new Set([
  "claimed",
  "already_claimed",
  "claimed_by_other",
  "own_party",
  "already_on_list",
  "ineligible",
  "released",
  "not_found",
  "phone_unproved",
]);

/** `rsvp_guest_claim` (body, or the error body of a non-2xx) → result. */
export const parseRsvpGuestClaim = (
  data: unknown,
  httpStatus: number | null = null,
): RsvpGuestClaimResult => {
  const row = (data !== null && typeof data === "object" && !Array.isArray(data)
    ? data
    : {}) as Record<string, unknown>;
  const outcomeText = text(row.outcome);
  const errorText = text(row.error);
  const outcome: RsvpGuestClaimOutcome = outcomeText !== null && OUTCOMES.has(outcomeText)
    ? (outcomeText as RsvpGuestClaimOutcome)
    : errorText === "unauthorized" || httpStatus === 401
      ? "unauthorized"
      : errorText === "conflict" || httpStatus === 409
        ? "conflict"
        : errorText === "rate_limited" || httpStatus === 429
          ? "rate_limited"
          : "unavailable";
  const friendship = text(row.friendship);
  return {
    outcome,
    guestId: text(row.guestId),
    rsvpId: text(row.rsvpId),
    eventId: text(row.eventId),
    inviterName: text(row.inviterName),
    friendship:
      friendship === "connected" || friendship === "already_friends" ||
        friendship === "blocked" || friendship === "none"
        ? friendship
        : null,
    closeFriend: row.closeFriend === true,
    phoneLast4: text(row.phoneLast4),
  };
};

/** What the claim screen shows. Every state has a way forward. */
export type RsvpGuestScreen =
  | { kind: "loading" }
  | { kind: "load_error" }
  | { kind: "invite"; mode: "one_tap" | "confirm_number" | "sign_in" }
  | { kind: "verify_number" }
  | { kind: "claimed"; friendshipLine: string | null }
  | { kind: "info"; title: string; body: string; primary: "home" | "event" | "pass" | "retry" };

export const friendshipSentence = (inviterFirstName: string): string =>
  `Getting your pass also makes you and ${inviterFirstName} close friends on Mingla. You can change that anytime in Connections.`;

/** Before the tap: which invite mode applies (1.19). */
export const inviteMode = (
  resolved: RsvpGuestResolved,
  signedIn: boolean,
): "one_tap" | "confirm_number" | "sign_in" =>
  !signedIn ? "sign_in" : resolved.viewerCanClaim ? "one_tap" : "confirm_number";

/** A resolved link that cannot be claimed → its designed screen; null ⇒ claimable. */
export const resolvedInfoScreen = (
  resolved: RsvpGuestResolved,
): Extract<RsvpGuestScreen, { kind: "info" }> | { kind: "claimed"; friendshipLine: null } | null => {
  switch (resolved.status) {
    case "open":
      if (resolved.viewerIsInviter) {
        return {
          kind: "info",
          title: "This is your guest's link",
          body: "Send it to the person you're bringing so they can get their pass.",
          primary: "event",
        };
      }
      return null;
    case "claimed":
      return resolved.claimedByViewer
        ? { kind: "claimed", friendshipLine: null }
        : {
            kind: "info",
            title: "This pass has been claimed",
            body: `Someone already got this pass. If it was meant for you, ask ${resolved.inviterFirstName ?? "your friend"} to add you again.`,
            primary: "event",
          };
    case "released":
      return {
        kind: "info",
        title: "This spot was given back",
        body: "Someone said this invite wasn't for them, so the spot is free again. You can still RSVP yourself.",
        primary: "event",
      };
    case "ended":
      return {
        kind: "info",
        title: "This event has ended",
        body: "This invite was for an event that's over. See what's on next in Mingla.",
        primary: "home",
      };
    case "not_eligible":
      return {
        kind: "info",
        title: "Not confirmed yet",
        body: `${resolved.inviterFirstName ?? "Your friend"}'s RSVP is waiting for the host. We'll text you as soon as your spot is confirmed.`,
        primary: "event",
      };
    case "not_found":
    default:
      return {
        kind: "info",
        title: "This link doesn't work any more",
        body: "The invite may have been changed or removed. Ask your friend to send it again.",
        primary: "home",
      };
  }
};

/** After a claim attempt → the next screen (1.19-1.21). */
export const claimOutcomeScreen = (
  result: RsvpGuestClaimResult,
  inviterFirstName: string | null,
): RsvpGuestScreen => {
  const friend = inviterFirstName ?? "your friend";
  switch (result.outcome) {
    case "claimed":
      return {
        kind: "claimed",
        friendshipLine:
          result.friendship === "connected"
            ? `You and ${friend} are now close friends on Mingla.`
            : result.friendship === "already_friends"
              ? `You and ${friend} are close friends on Mingla.`
              : null,
      };
    case "already_claimed":
      return { kind: "claimed", friendshipLine: null };
    case "phone_unproved":
      return { kind: "verify_number" };
    case "claimed_by_other":
      return {
        kind: "info",
        title: "This pass has been claimed",
        body: `Another account already got this pass. If it was meant for you, ask ${friend} to add you again.`,
        primary: "event",
      };
    case "own_party":
      return {
        kind: "info",
        title: "You're already going",
        body: "This spot is part of your own RSVP. Send the link to the person you're bringing.",
        primary: "event",
      };
    case "already_on_list":
      return {
        kind: "info",
        title: "You're already on the list",
        body: "You have your own pass for this event, so you don't need this one.",
        primary: "event",
      };
    case "ineligible":
      return {
        kind: "info",
        title: "Not confirmed yet",
        body: `${friend === "your friend" ? "Your friend" : friend}'s RSVP isn't confirmed, or the event has changed. We'll text you if your spot is confirmed.`,
        primary: "event",
      };
    case "released":
      return {
        kind: "info",
        title: "This spot was given back",
        body: "This invite was released, so there's no pass to claim. You can still RSVP yourself.",
        primary: "event",
      };
    case "not_found":
      return {
        kind: "info",
        title: "This link doesn't work any more",
        body: "The invite may have been changed or removed. Ask your friend to send it again.",
        primary: "home",
      };
    case "unauthorized":
      return { kind: "invite", mode: "sign_in" };
    case "conflict":
    case "rate_limited":
    case "unavailable":
    default:
      return {
        kind: "info",
        title: "We couldn't get your pass just now",
        body: result.outcome === "rate_limited"
          ? "Too many tries in a row. Wait a minute, then try again."
          : "Check your connection and try again.",
        primary: "retry",
      };
  }
};

/** "This isn't me" → what to say. */
export const releaseOutcomeMessage = (outcome: string): { title: string; body: string } => {
  switch (outcome) {
    case "released":
    case "already_released":
      return {
        title: "Thanks for letting us know",
        body: "We've given the spot back and won't text this number about this event again.",
      };
    case "already_claimed":
      return {
        title: "This pass is already claimed",
        body: "Someone already got this pass, so there's nothing to give back.",
      };
    default:
      return {
        title: "This link doesn't work any more",
        body: "There's nothing to give back for this invite.",
      };
  }
};

/** A friendly date for the event card, in the event's own time zone. */
export const formatGuestEventWhen = (
  startsAt: string | null,
  timezone: string | null,
  locale?: string,
): string | null => {
  if (startsAt === null) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toUTCString();
  }
};
