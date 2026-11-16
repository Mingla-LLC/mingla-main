import { selectGridOfferings, type OfferingGridConfig, type SiteOffering } from "../../contracts/generated/offerings.ts";
import { testimonialsNewestFirst, type SiteTestimonial } from "../../contracts/generated/collections.ts";
import { isManuallyOrdered } from "../../contracts/generated/artifactV2.ts";
import { historyLedger, ledgerDepartureCount, type LedgerEntry } from "../../contracts/generated/history.ts";
import type { SiteDestination } from "../../contracts/generated/collections.ts";
import type { OfferingCard } from "../../lib/offeringCards";
import { rows, text, type SharedBlock, type SharedContext } from "./parts";

/*
 * #4453 §3.3 — the data a shared layout draws, read the same way the
 * existing layouts read it (one owner per truth): offerings from Mingla's
 * live feed (the publication's snapshot as fallback), reviews from the
 * site's confirmed Testimonials, past trips counted from the feed, never
 * typed. A layout with no data renders nothing or its designed empty line.
 */

export function gridConfig(block: SharedBlock): OfferingGridConfig {
  return {
    kind: ["all", "trip", "event", "experience"].includes(text(block.kind)) ? (text(block.kind) as OfferingGridConfig["kind"]) : "all",
    mode: ["upcoming", "past", "all"].includes(text(block.mode)) ? (text(block.mode) as OfferingGridConfig["mode"]) : "upcoming",
    offering_ids: Array.isArray(block.offering_ids) ? (block.offering_ids as Array<{ id: string }>) : undefined,
    limit: typeof block.limit === "number" ? block.limit : undefined,
  };
}

export type GridItem = { offering: SiteOffering; card: OfferingCard };
export type GridResult =
  | { kind: "items"; items: GridItem[] }
  | { kind: "empty" }
  | { kind: "check_dates" }
  | { kind: "no_match" };

/** The offerings a live grid shows, each with its card (title, dates, state, price only while bookable). */
export function gridItems(block: SharedBlock, ctx: SharedContext): GridResult {
  const live = ctx.live;
  if (!live) return { kind: "empty" };
  const filters = block.show_filters === true ? live.filters : { where: null, from: null, to: null };
  const result = selectGridOfferings(live.offerings, gridConfig(block), live.now, filters);
  if (result.kind === "check_dates" || result.kind === "no_match") return { kind: result.kind };
  const entries = result.kind === "ok" ? result.offerings : [];
  const items = entries
    .map(({ offering }) => ({ offering, card: live.cards.get(offering.id) }))
    .filter((item): item is GridItem => Boolean(item.card));
  return items.length ? { kind: "items", items } : { kind: "empty" };
}

/** The v1 grid (gögi): offerings chosen by id with their title and Mingla link frozen at publish. */
export function frozenOfferings(block: SharedBlock): Array<{ id: string; label: string; summary: string; url: string }> {
  return rows(block.offerings)
    .map((row) => ({ id: text(row.id), label: text(row.label), summary: text(row.summary), url: text(row.url) }))
    .filter((row) => row.label && row.url);
}

export type Quote = { key: string; quote: string; reviewer: string; context: string; date: string | null };

/** Reviews: the site's confirmed Testimonials (newest first or the owner's pick), else the quotes typed into the block. */
export function quotes(block: SharedBlock, ctx: SharedContext): Quote[] {
  const { artifact, live } = ctx;
  if (block.from_collection === true) {
    const picked = rows(block.testimonial_ids).map((row) => text(row.id));
    const all = artifact.collections.testimonials;
    const limit = typeof block.limit === "number" ? block.limit : undefined;
    const shown: SiteTestimonial[] = (picked.length
      ? picked.map((id) => all.find((row) => row.id === id)).filter((row): row is SiteTestimonial => Boolean(row))
      : testimonialsNewestFirst(all, isManuallyOrdered(artifact, "testimonials"))).slice(0, limit);
    return shown.map((review) => {
      const offering = review.related_offering_id ? live?.offerings.find((row) => row.id === review.related_offering_id) : undefined;
      return { key: review.id, quote: review.quote, reviewer: review.reviewer, context: review.trip_name || offering?.title || "", date: review.review_date };
    });
  }
  return rows(block.items)
    .map((row, rowIndex) => ({ key: `q${rowIndex}`, quote: text(row.quote), reviewer: text(row.name), context: "", date: null }))
    .filter((row) => row.quote && row.reviewer);
}

/** Past offerings, counted from the feed (a run of departures is one row). */
export function history(block: SharedBlock, ctx: SharedContext): { entries: LedgerEntry[]; total: number } {
  const live = ctx.live;
  const kind = ["trip", "event", "experience", "all"].includes(text(block.kind)) ? (text(block.kind) as "trip") : "trip";
  const series = rows(block.series).map((row) => ({ label: text(row.label), offering_ids: rows(row.offering_ids).map((item) => ({ id: text(item.id) })) }));
  const entries = live ? historyLedger(live.offerings, live.now, { kind, series, offering_ids: rows(block.offering_ids).map((row) => ({ id: text(row.id) })) }) : [];
  return { entries, total: ledgerDepartureCount(entries) };
}

/** The destinations a grid shows: the owner's pick, in order, else every destination. */
export function destinations(block: SharedBlock, ctx: SharedContext): SiteDestination[] {
  const picked = rows(block.destinations).map((row) => text(row.slug)).filter(Boolean);
  const all = ctx.artifact.collections.destinations;
  return picked.length
    ? picked.map((slug) => all.find((row) => row.slug === slug)).filter((row): row is SiteDestination => Boolean(row))
    : all;
}

/** The gallery's pictures (approved media records carried in the block). */
export function galleryImages(block: SharedBlock): Array<{ url: string; alt: string }> {
  return rows(block.images)
    .map((image) => ({ url: text(image.url), alt: text(image.alt) }))
    .filter((image) => image.url.startsWith("/") || image.url.startsWith("https://"))
    .slice(0, 12);
}
