/* eslint-disable @next/next/no-img-element -- covers are served by the token-bound /om route (immutable, same origin). */
import { localDate, offeringTimeZone, selectGridOfferings, type OfferingGridConfig, type SiteOffering } from "../../../contracts/generated/offerings.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import type { SiteEventContext } from "../../../lib/clientAnalytics";
import type { OfferingCard } from "../../../lib/offeringCards";
import { hrefForPage } from "../../../lib/pageRouting";
import { TrackedLink } from "../../../components/TrackedLink";
import { Reveal } from "../Reveal";
import { CalendarGlyph, GridEmpty, gridSizes, HeadRow, Section, sectionId, text, type VoyageBlockProps } from "../parts";
import { TripFilters } from "./TripFilters";

/*
 * #2829 W7 — offering_grid `photo-card`: Mingla's live trips, events or
 * experiences as padded photo cards, each linking to its existing Mingla
 * page (A1.2). A card shows only what Mingla knows: the place chip, the
 * state chip ("Ended", "Happening now", "Sold out", …), the dates, the title,
 * the summary, the length of a trip, and a price only while it can be booked.
 *
 * Bands follow the reference: an upcoming or past list is one tinted band;
 * "all" is a white "Upcoming" band (with the search) then a tinted "Past"
 * band. An empty list is a designed card with the owner's way on; filters
 * that match nothing, or an inverted date range, say so with a way to clear.
 */
const KIND_PLURAL: Readonly<Record<string, string>> = { all: "offerings", trip: "trips", event: "events", experience: "experiences" };

function gridConfig(block: Readonly<Record<string, unknown>>): OfferingGridConfig {
  return {
    kind: ["all", "trip", "event", "experience"].includes(text(block.kind)) ? (text(block.kind) as OfferingGridConfig["kind"]) : "all",
    mode: ["upcoming", "past", "all"].includes(text(block.mode)) ? (text(block.mode) as OfferingGridConfig["mode"]) : "upcoming",
    offering_ids: Array.isArray(block.offering_ids) ? (block.offering_ids as Array<{ id: string }>) : undefined,
    limit: typeof block.limit === "number" ? block.limit : undefined,
  };
}

/** Whole days between a trip's local start and end dates ("7 days" for 14–21 August). */
export function tripLength(offering: Pick<SiteOffering, "kind" | "start_at" | "end_at" | "timezone">): string | null {
  if (offering.kind !== "trip" || !offering.start_at || !offering.end_at) return null;
  const zone = offeringTimeZone(offering);
  const start = localDate(offering.start_at, zone);
  const end = localDate(offering.end_at, zone);
  if (!start || !end || end < start) return null;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  const count = Math.max(days, 1);
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/*
 * #2829 W7c — `sizes` follows how many cards share the row (the count-aware
 * grid), so the browser picks the publish-time rendition that fits.
 */
export function PhotoCard({ card, offering, analytics, sizes }: { card: OfferingCard; offering: SiteOffering; analytics: SiteEventContext; sizes?: string }) {
  const length = tripLength(offering);
  const badge = card.state.badge;
  const price = card.state.bookable ? card.price : null;
  const from = price?.startsWith("From ") ? price.slice(5) : null;
  return (
    <article className="card card--interactive card--padded v-card" data-offering-state={card.state.cancelled ? "cancelled" : card.state.phase} data-offering-kind={card.kind}>
      <TrackedLink href={card.href} context={analytics} ctaKind="offering" offeringId={card.id}>
        <div className="v-card__media">
          <div className="media media--flush v-ratio-4-3">
            {card.coverUrl ? <img src={card.coverUrl} srcSet={card.coverSrcSet ?? undefined} sizes={card.coverSrcSet ? sizes ?? gridSizes(3) : undefined} alt="" loading="lazy" decoding="async" className="v-card__img" /> : null}
            <span aria-hidden="true" className="v-card__shade" />
          </div>
          {card.destination ? <span className="chip-location"><PinIcon />{card.destination}</span> : null}
          {badge ? <span className={`chip-status ${badge === "Happening now" ? "chip-status--accent" : "chip-status--state"}`}>{badge}</span> : null}
        </div>
        <div className="v-card__body">
          {card.dates ? <p className="meta v-card__dates"><CalendarGlyph /><span className="tnum">{card.dates}</span></p> : null}
          <h3 className="card__title v-clamp-2">{card.title}</h3>
          {card.summary ? <p className="card__body v-clamp-2 v-card__summary">{card.summary}</p> : null}
          <div className="card__meta">
            {length ? <p className="meta v-card__length"><ClockIcon /><span>{length}</span></p> : <span />}
            {price ? (
              from
                ? <p className="v-card__price"><span className="micro-label v-block">From</span><span className="card__price">{from}</span></p>
                : <p className="meta v-card__price">{price}</p>
            ) : null}
          </div>
          <span className="sr-only">{`${card.cta}: ${card.title} on Mingla`}</span>
        </div>
      </TrackedLink>
    </article>
  );
}

export function OfferingGridPhotoCard({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const config = gridConfig(block);
  const noun = KIND_PLURAL[config.kind ?? "all"] ?? "offerings";
  const live = ctx.live;
  const showFilters = block.show_filters === true;
  const filters = showFilters && live ? live.filters : { where: null, from: null, to: null };
  const pageHref = hrefForPage(ctx.page);
  const heading = text(block.heading);
  const intro = text(block.intro);
  const headLink = { label: text(block.cta_label), href: block.cta_href };
  const emptyAction = text(block.empty_cta_label) && isSafeHref(block.empty_cta_href)
    ? { label: text(block.empty_cta_label), href: String(block.empty_cta_href) }
    : null;
  const result = live ? selectGridOfferings(live.offerings, config, live.now, filters) : { kind: "empty" as const };
  const filterPanel = showFilters ? <div className="v-filters"><TripFilters variant="panel" action={pageHref} filters={live?.filters} /></div> : null;

  const cards = (entries: ReadonlyArray<{ offering: SiteOffering }>) => (
    <div className="grid-cards">
      {entries.map(({ offering }, cardIndex) => {
        const card = live?.cards.get(offering.id);
        return card ? <Reveal key={card.id} delay={cardIndex}><PhotoCard card={card} offering={offering} analytics={ctx.analytics} sizes={gridSizes(entries.length)} /></Reveal> : null;
      })}
    </div>
  );
  const noUpcoming = (
    <GridEmpty
      heading={`No upcoming ${noun} right now`}
      body={text(block.empty_text) || `New ${noun} will appear here as soon as they are on sale.`}
      action={emptyAction}
    />
  );
  const source = live?.source ?? "none";

  if (result.kind === "check_dates") {
    return (
      <Section tinted labelledBy={id} source={source}>
          <HeadRow id={id} heading={heading} intro={intro} />
          {filterPanel}
          <GridEmpty heading="Check your dates" body="Your “From” date is after your “To” date." action={{ label: "Clear search", href: pageHref }} />
      </Section>
    );
  }
  if (result.kind === "no_match") {
    return (
      <Section tinted labelledBy={id} source={source}>
          <HeadRow id={id} heading={heading} intro={intro} />
          {filterPanel}
          <GridEmpty heading={`No ${noun} match those dates`} body="Try a wider range, or clear the search to see everything." action={{ label: "Clear search", href: pageHref }} />
      </Section>
    );
  }
  const entries = result.kind === "ok" ? result.offerings : [];
  if (config.mode === "past") {
    if (!entries.length) return null;
    return (
      <Section tinted labelledBy={id} source={source}>
          <HeadRow id={id} heading={heading} intro={intro} link={headLink} />
          {filterPanel}
          {cards(entries)}
      </Section>
    );
  }
  if (config.mode === "upcoming") {
    return (
      <Section tinted labelledBy={id} source={source}>
          <HeadRow id={id} heading={heading} intro={intro} link={headLink} />
          {filterPanel}
          {entries.length ? cards(entries) : noUpcoming}
      </Section>
    );
  }
  // "all": upcoming first (white, with the search), then what has already run (tinted).
  const upcoming = entries.filter(({ state }) => state.phase !== "ended");
  const past = entries.filter(({ state }) => state.phase === "ended");
  return (
    <>
      <Section labelledBy={`${id}-upcoming`} source={source}>
        <HeadRow id={`${id}-upcoming`} heading={`Upcoming ${noun}`} intro={intro} link={headLink} />
        {filterPanel}
        {upcoming.length ? cards(upcoming) : noUpcoming}
      </Section>
      {past.length ? (
        <Section tinted labelledBy={`${id}-past`}>
          <HeadRow id={`${id}-past`} heading={`Past ${noun}`} intro="Where we’ve already been." />
          {cards(past)}
        </Section>
      ) : null}
    </>
  );
}
