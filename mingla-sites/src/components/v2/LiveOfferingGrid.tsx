/* eslint-disable @next/next/no-img-element -- covers are served by the token-bound /om route (immutable, same origin). */
import { SiteDateInput } from "./SiteDateInput";
import { selectGridOfferings, type OfferingGridConfig } from "../../contracts/generated/offerings.ts";
import type { SiteEventContext } from "../../lib/clientAnalytics";
import type { LiveOfferings, OfferingCard } from "../../lib/offeringCards";
import { SiteAnchor, SiteSearchForm } from "../PreviewLinks";
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

const KIND_PLURAL: Readonly<Record<string, string>> = { all: "offerings", trip: "trips", event: "events", experience: "experiences", stay: "stays", venue: "venue offers" };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function gridConfig(block: GridBlock): OfferingGridConfig {
  return {
    kind: ["all", "trip", "event", "experience", "stay", "venue"].includes(text(block.kind)) ? (text(block.kind) as OfferingGridConfig["kind"]) : "all",
    mode: ["upcoming", "past", "all"].includes(text(block.mode)) ? (text(block.mode) as OfferingGridConfig["mode"]) : "upcoming",
    offering_ids: Array.isArray(block.offering_ids) ? (block.offering_ids as Array<{ id: string }>) : undefined,
    limit: typeof block.limit === "number" ? block.limit : undefined,
  };
}

function Card({ card, context }: { card: OfferingCard; context: SiteEventContext }) {
  return (
    <article className="tile offering-card" data-offering-state={card.state.cancelled ? "cancelled" : card.state.phase} data-offering-kind={card.kind}>
      {card.coverUrl ? (card.detailHref
        ? <a href={card.detailHref} tabIndex={-1} aria-hidden="true"><img className="offering-cover" src={card.coverUrl} alt="" loading="lazy" decoding="async" /></a>
        : <img className="offering-cover" src={card.coverUrl} alt="" loading="lazy" decoding="async" />) : null}
      {/* #4453 milestone 10 — a plan preview's labelled sample listing (never published). */}
      {card.sample ? <p className="offering-badge offering-sample" data-sample="1">Sample</p> : card.state.badge ? <p className="offering-badge">{card.state.badge}</p> : null}
      {/* #4453 milestone 9 — with detail pages on, the title opens the site's own page; the CTA below still goes to Mingla. */}
      <h3>{card.detailHref ? <a className="mg-to-detail" href={card.detailHref}>{card.title}</a> : card.title}</h3>
      {card.dates ? <p className="offering-dates">{card.dates}</p> : null}
      {card.destination ? <p className="offering-place">{card.destination}</p> : null}
      {card.summary ? <p>{card.summary}</p> : null}
      {card.price ? <p className="offering-price">{card.price}</p> : null}
      {card.sample ? <p className="offering-cta">Sample listing</p> : (
        <TrackedLink href={card.href} context={context} ctaKind="offering" offeringId={card.id} className={card.state.bookable ? "button accent offering-cta" : "offering-cta"}>
          {/* #2830 — no colon: the link reads "Book Fixture coast walk on Mingla". */}
          {card.cta}<span className="sr-only"> {card.title} on Mingla</span>
        </TrackedLink>
      )}
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
  /*
   * #4453 I-SITES-NO-PUBLIC-EMPTY-STATE (spec v1 §4.2.3) — a grid with no
   * live offering is not rendered at all: no heading, no message, no wrapper.
   * `empty_text` stays in the schema for stored blocks; it is never printed.
   */
  if (result.kind === "empty") return null;
  return (
    <section className="editorial-grid offering-grid" data-offering-source={live?.source ?? "none"}>
      {eyebrow}
      {heading ? <h2>{heading}</h2> : null}
      {text(block.intro) ? <p className="offering-grid-intro">{text(block.intro)}</p> : null}
      {block.show_filters === true ? (
        <SiteSearchForm className="offering-filters" role="search" aria-label={`Search ${noun}`}>
          <label>Where<input type="text" name="where" maxLength={80} defaultValue={filters?.where ?? ""} /></label>
          <label>From<SiteDateInput name="from" defaultValue={filters?.from ?? ""} ariaLabel="From" /></label>
          <label>To<SiteDateInput name="to" defaultValue={filters?.to ?? ""} ariaLabel="To" /></label>
          <button type="submit" className="button accent">Search</button>
        </SiteSearchForm>
      ) : null}
      {result.kind === "check_dates" ? (
        <p className="offering-grid-message" role="status">Check your dates: the end comes before the start. <SiteAnchor href={clearHref}>Clear search</SiteAnchor></p>
      ) : result.kind === "no_match" ? (
        <p className="offering-grid-message" role="status">No {noun} match those dates. <SiteAnchor href={clearHref}>Clear search</SiteAnchor></p>
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
