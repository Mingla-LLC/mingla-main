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
  | "waitlist_offer";

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
  kind: Exclude<BuyerLinkKind, "waitlist_offer">,
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
  if (input.kind === "waitlist_offer") {
    const targetUrl = input.targetUrl?.trim() ?? "";
    const expiresAt = input.expiresAt?.trim() ?? "";
    if (targetUrl.length === 0 || expiresAt.length === 0) {
      return fallback(input);
    }
    const link = await mintRedirectLink(
      admin,
      "waitlist_offer",
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
