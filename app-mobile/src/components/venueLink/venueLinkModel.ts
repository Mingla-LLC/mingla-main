/**
 * #4490 Explorer W1 — what the app does with a venue web link it caught
 * (/visit/<id>, /visit/waitlist/<id>, /o/<id>, /reserve/<brand>/manage).
 * Pure: the screen reads the server and asks this module what to show.
 */
export type VenueLinkKind = "visit" | "waitlist" | "order" | "reserve_manage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^(?:[a-z0-9_-]{1,16}\.)?[A-Za-z0-9_-]{43}$/;

export const VENUE_LINK_COPY = {
  paidTitle: "Payment received",
  paidBody: "We've emailed your booking. Open the link in that email to see it here.",
  paidButton: "Go to Purchases",
  underOther: (masked: string) =>
    `This booking is under ${masked}. Sign in with that email to keep it in Purchases.`,
  loadFailed: "We couldn't open this booking. Check your connection and try again.",
  retry: "Try again",
} as const;

/** The booking token from a link fragment (#t=…), held in screen memory only. */
export function tokenFromFragment(fragment: string | null | undefined): string | null {
  if (!fragment) return null;
  const value = new URLSearchParams(fragment.replace(/^#/, "")).get("t");
  return value !== null && TOKEN.test(value) ? value : null;
}

export function isVenueLinkId(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** Where an owned item opens in Purchases. */
export function purchasesPathFor(kind: VenueLinkKind, id: string): string | null {
  if (!isVenueLinkId(id)) return null;
  const lower = id.toLowerCase();
  // #4490 Explorer W2 (N157 closed): the booking's or place's own detail.
  if (kind === "visit") return `/purchases/venue_booking/${lower}`;
  if (kind === "waitlist") return `/purchases/venue_waitlist/${lower}`;
  if (kind === "order") return `/purchases/order/${lower}`;
  return null;
}

export type VenueLinkDecision =
  | { kind: "purchases"; path: string }
  | { kind: "read_with_token" }
  | { kind: "paid_no_link" }
  | { kind: "web"; url: string };

/**
 * The order of checks: a path the app does not serve, or a malformed id,
 * opens on the web; an item this account owns opens in Purchases; a token
 * read shows the booking; a payment return with nothing to read shows the
 * "Payment received" fallback; anything else opens on the web (never a blank).
 */
export function decideVenueLink(input: {
  kind: VenueLinkKind;
  id: string | null;
  webUrl: string;
  owned: boolean;
  token: string | null;
  paidReturn: boolean;
}): VenueLinkDecision {
  if (input.kind === "reserve_manage" || !isVenueLinkId(input.id)) {
    return { kind: "web", url: input.webUrl };
  }
  const path = purchasesPathFor(input.kind, input.id);
  if (path !== null && (input.owned || input.kind === "order")) return { kind: "purchases", path };
  if (input.token !== null) return { kind: "read_with_token" };
  if (input.paidReturn && input.kind === "visit") return { kind: "paid_no_link" };
  return { kind: "web", url: input.webUrl };
}
