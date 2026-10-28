/* eslint-disable @next/next/no-img-element -- covers are served by the token-bound /om route (immutable, same origin). */
import { selectGridOfferings, type OfferingGridConfig } from "../../contracts/generated/offerings.ts";
import type { SiteEventContext } from "../../lib/clientAnalytics";
import type { LiveOfferings, OfferingCard } from "../../lib/offeringCards";
import { TrackedLink } from "../TrackedLink";

/*
 * #2829 W4 — a LIVE offering grid: trips, events and experiences from
 * Mingla's feed (or the publication's snapshot when Core is unreachable),
 * each card linking to the existing Mingla public page (A1.2), where the
 * existing checkout runs unchanged.
 *
 * Cards carry only what Mingla knows: a missing cover, date or summary is
 * simply absent; a missing price reads "Price on request". Ended and
 * cancelled offerings show their badge and no price, and only a bookable
 * offering says "Book". Filters (`?where=&from=&to=`) are applied on the
 * server, so the grid works without JavaScript.
 */
type GridBlock = Readonly<Record<string, unknown>>;

const KIND_PLURAL: Readonly<Record<string, string>> = { all: "offerings", trip: "trips", event: "events", experience: "experiences" };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function gridConfig(block: GridBlock): OfferingGridConfig {
  return {
    kind: ["all", "trip", "event", "experience"].includes(text(block.kind)) ? (text(block.kind) as OfferingGridConfig["kind"]) : "all",
    mode: ["upcoming", "past", "all"].includes(text(block.mode)) ? (text(block.mode) as OfferingGridConfig["mode"]) : "upcoming",
    offering_ids: Array.isArray(block.offering_ids) ? (block.offering_ids as Array<{ id: string }>) : undefined,
    limit: typeof block.limit === "number" ? block.limit : undefined,
  };
}

function Card({ card, context }: { card: OfferingCard; context: SiteEventContext }) {
  return (
    <article className="tile offering-card" data-offering-state={card.state.cancelled ? "cancelled" : card.state.phase} data-offering-kind={card.kind}>
      {card.coverUrl ? <img className="offering-cover" src={card.coverUrl} alt="" loading="lazy" decoding="async" /> : null}
      {card.state.badge ? <p className="offering-badge">{card.state.badge}</p> : null}
      <h3>{card.title}</h3>
      {card.dates ? <p className="offering-dates">{card.dates}</p> : null}
      {card.destination ? <p className="offering-place">{card.destination}</p> : null}
      {card.summary ? <p>{card.summary}</p> : null}
      {card.price ? <p className="offering-price">{card.price}</p> : null}
      <TrackedLink href={card.href} context={context} ctaKind="offering" offeringId={card.id} className={card.state.bookable ? "button accent offering-cta" : "offering-cta"}>
        {card.cta}<span className="sr-only">: {card.title} on Mingla</span>
      </TrackedLink>
    </article>
  );
}

export function LiveOfferingGrid({ block, live, context, clearHref, eyebrow }: {
  block: GridBlock;
  live: LiveOfferings | undefined;
  context: SiteEventContext;
  clearHref: string;
  eyebrow?: React.ReactNode;
}) {
  const config = gridConfig(block);
  const heading = text(block.heading);
  const noun = KIND_PLURAL[config.kind ?? "all"] ?? "offerings";
  const result = live
    ? selectGridOfferings(live.offerings, config, live.now, block.show_filters === true ? live.filters : { where: null, from: null, to: null })
    : { kind: "empty" as const };
  const filters = live?.filters;
  return (
    <section className="editorial-grid offering-grid" data-offering-source={live?.source ?? "none"}>
      {eyebrow}
      {heading ? <h2>{heading}</h2> : null}
      {block.show_filters === true ? (
        <form className="offering-filters" method="get" role="search" aria-label={`Search ${noun}`}>
          <label>Where<input type="text" name="where" maxLength={80} defaultValue={filters?.where ?? ""} /></label>
          <label>From<input type="date" name="from" defaultValue={filters?.from ?? ""} /></label>
          <label>To<input type="date" name="to" defaultValue={filters?.to ?? ""} /></label>
          <button type="submit" className="button accent">Search</button>
        </form>
      ) : null}
      {result.kind === "check_dates" ? (
        <p className="offering-grid-message" role="status">Check your dates: the end comes before the start. <a href={clearHref}>Clear search</a></p>
      ) : result.kind === "no_match" ? (
        <p className="offering-grid-message" role="status">No {noun} match those dates. <a href={clearHref}>Clear search</a></p>
      ) : result.kind === "empty" ? (
        <p className="offering-grid-message">{text(block.empty_text) || `No ${noun} to show right now.`}</p>
      ) : (
        <div className="grid">
          {result.offerings.map(({ offering }) => {
            const card = live?.cards.get(offering.id);
            return card ? <Card key={card.id} card={card} context={context} /> : null;
          })}
        </div>
      )}
    </section>
  );
}
