// Issue #4063 — one link policy for buyer email and SMS renderers.

import {
  type ClaimLinkAdmin,
  type ClaimLinkKind,
  mintClaimLink,
  mintRedirectLink,
} from "./claimLink.ts";

export type BuyerLinkKind =
  | "order"
  | "rsvp_primary"
  | "rsvp_guest"
  | "reservation"
  | "venue_order"
  | "ticket"
  | "waitlist_offer"
  // Issue #4422 — one shared short link to an event's public page.
  | "event_page";

export interface BuyerLink {
  url: string;
  display: string;
  isShort: boolean;
  claimed: boolean;
  fallback: boolean;
}

interface BuyerLinkInput {
  kind: BuyerLinkKind;
  sourceId: string;
  targetUrl?: string | null;
  expiresAt?: string | null;
}

const DOWNLOAD_URL = "https://usemingla.com/download";
const DOWNLOAD_DISPLAY = "usemingla.com/download";

function claimKind(
  kind: Exclude<BuyerLinkKind, "waitlist_offer" | "event_page">,
): ClaimLinkKind {
  if (kind === "rsvp_primary") return "rsvp";
  return kind;
}

function fallback(input: BuyerLinkInput): BuyerLink {
  console.warn("message_link_fallback", { kind: input.kind });
  if (input.kind === "waitlist_offer") {
    return {
      url: input.targetUrl?.trim() || DOWNLOAD_URL,
      display: "",
      isShort: false,
      claimed: false,
      fallback: true,
    };
  }
  if (input.kind === "event_page") {
    // The full page link; texts show it without the scheme.
    const url = input.targetUrl?.trim() || DOWNLOAD_URL;
    return {
      url,
      display: url.replace(/^https:\/\//, ""),
      isShort: false,
      claimed: false,
      fallback: true,
    };
  }
  return {
    url: DOWNLOAD_URL,
    display: DOWNLOAD_DISPLAY,
    isShort: false,
    claimed: false,
    fallback: true,
  };
}

export async function resolveBuyerLink(
  admin: ClaimLinkAdmin,
  input: BuyerLinkInput,
): Promise<BuyerLink> {
  if (input.kind === "waitlist_offer" || input.kind === "event_page") {
    const targetUrl = input.targetUrl?.trim() ?? "";
    const expiresAt = input.expiresAt?.trim() ?? "";
    if (targetUrl.length === 0 || expiresAt.length === 0) {
      return fallback(input);
    }
    const link = await mintRedirectLink(
      admin,
      input.kind,
      input.sourceId,
      targetUrl,
      expiresAt,
    );
    return link === null ? fallback(input) : {
      url: link.url,
      display: link.display,
      isShort: true,
      claimed: false,
      fallback: false,
    };
  }

  const link = await mintClaimLink(
    admin,
    claimKind(input.kind),
    input.sourceId,
  );
  return link === null ? fallback(input) : {
    url: link.url,
    display: link.display,
    isShort: true,
    claimed: link.claimed === true,
    fallback: false,
  };
}

const DAY_MS = 86_400_000;

/**
 * Issue #4422 — when an event_page short link stops resolving: 30 days after
 * the event's last date ends (`lastEndAt`, else `endAt`, else one day after
 * `startAt`). Kept inside the database's bounds: never in the past (an
 * already-ended event gets 30 days from now) and under 400 days ahead.
 */
export function eventLinkExpiry(
  times: {
    lastEndAt?: string | null;
    endAt?: string | null;
    startAt?: string | null;
  },
  now: Date = new Date(),
): string {
  const parse = (value: string | null | undefined): number | null => {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  };
  const start = parse(times.startAt);
  const end = parse(times.lastEndAt) ?? parse(times.endAt) ??
    (start === null ? null : start + DAY_MS);
  const floor = now.getTime() + 30 * DAY_MS;
  const ceiling = now.getTime() + 399 * DAY_MS;
  const candidate = end === null ? floor : end + 30 * DAY_MS;
  return new Date(Math.min(Math.max(candidate, floor), ceiling)).toISOString();
}
