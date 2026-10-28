import {
  formatOfferingDates,
  formatOfferingPrice,
  offeringState,
  parseFilterDate,
  parseFilterWhere,
  type OfferingFilters,
  type OfferingState,
  type SiteOffering,
} from "../contracts/generated/offerings.ts";
import { hiddenOfferingIds, type ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { isLiveOfferingGrid } from "../contracts/generated/blocks.ts";
import type { SiteBinding } from "./coreGateway";
import type { OfferingCoverMedia } from "../contracts/generated/artifactV2.ts";
import { offeringCoverSources } from "./offeringMedia";
import { siteOfferings, type SiteOfferingsView } from "./offeringsFeed";

/*
 * #2829 W4 — what one offering card says, worked out once per request on the
 * server: state in the offering's own timezone, dates and price in words, the
 * cover's token-bound URL, and the link to the EXISTING Mingla public page
 * (amendment A1.2 — the site never hosts an offering page or a checkout).
 */
export type OfferingCard = {
  id: string;
  kind: SiteOffering["kind"];
  title: string;
  summary: string | null;
  destination: string | null;
  dates: string;
  /** Null when no price line belongs on the card (ended or cancelled). */
  price: string | null;
  state: OfferingState;
  coverUrl: string | null;
  /** #2829 W7c — the cover's publish-time renditions as a `srcset`, or null. */
  coverSrcSet: string | null;
  href: string;
  cta: string;
};

export type LiveOfferings = {
  source: SiteOfferingsView["source"];
  offerings: readonly SiteOffering[];
  cards: ReadonlyMap<string, OfferingCard>;
  now: Date;
  filters: OfferingFilters;
};

const KIND_NOUN: Readonly<Record<SiteOffering["kind"], string>> = { trip: "trip", event: "event", experience: "experience" };

function ctaFor(offering: SiteOffering, state: OfferingState): string {
  if (state.bookable) return "Book";
  if (state.soldOut && !state.cancelled && state.phase !== "ended" && offering.waitlist_enabled) return "Join the waitlist";
  return `View ${KIND_NOUN[offering.kind]}`;
}

export async function offeringCard(
  siteId: string,
  offering: SiteOffering,
  now: Date,
  language: string,
  offeringMedia?: readonly OfferingCoverMedia[],
): Promise<OfferingCard> {
  const state = offeringState(offering, now);
  const cover = await offeringCoverSources(siteId, offering, offeringMedia);
  return {
    id: offering.id,
    kind: offering.kind,
    title: offering.title,
    summary: offering.summary,
    destination: offering.destination_text,
    dates: formatOfferingDates(offering, language),
    price: state.phase === "ended" || state.cancelled ? null : formatOfferingPrice(offering, language),
    state,
    coverUrl: cover?.src ?? null,
    coverSrcSet: cover?.srcSet ?? null,
    href: offering.public_url,
    cta: ctaFor(offering, state),
  };
}

/** The request's `?where=&from=&to=` (junk is ignored, never an error). */
export function offeringFilters(search: Record<string, string | string[] | undefined> | undefined): OfferingFilters {
  const one = (key: string) => {
    const value = search?.[key];
    return Array.isArray(value) ? undefined : value;
  };
  return { where: parseFilterWhere(one("where")), from: parseFilterDate(one("from")), to: parseFilterDate(one("to")) };
}

/** Does this page draw a live offering grid at all? (Only then is the feed read.) */
export function pageHasLiveGrid(blocks: readonly { type: string; mode?: unknown }[]): boolean {
  return blocks.some((block) => isLiveOfferingGrid(block));
}

/** Everything a page's live grids need, for the site Core resolved for this host. */
export async function loadLiveOfferings(
  site: SiteBinding,
  artifact: ArtifactV2,
  filters: OfferingFilters,
  now = new Date(),
): Promise<LiveOfferings> {
  const view = await siteOfferings(site, artifact);
  const offerings = withoutHiddenPast(view.offerings, artifact, now);
  const cards = new Map<string, OfferingCard>();
  for (const offering of offerings) {
    cards.set(offering.id, await offeringCard(site.site_id, offering, now, artifact.language, artifact.offering_media));
  }
  return { source: view.source, offerings, cards, now, filters };
}

/**
 * #2829 W9r — the past trips the owner hid from the website (display only:
 * the Mingla trip itself is untouched). Only an ENDED offering is ever left
 * out, from the live feed and the snapshot alike, so "Trips we've run" and
 * past-mode grids skip it; an upcoming offering is never hidden this way.
 */
export function withoutHiddenPast(
  offerings: readonly SiteOffering[],
  artifact: Pick<ArtifactV2, "site_display">,
  now: Date,
): readonly SiteOffering[] {
  const hidden = hiddenOfferingIds(artifact);
  if (hidden.size === 0) return offerings;
  return offerings.filter((offering) => !(hidden.has(offering.id.toLowerCase()) && offeringState(offering, now).phase === "ended"));
}
