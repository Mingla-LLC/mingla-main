/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import Link from "next/link";
import { isManuallyOrdered, type ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import {
  formatCalendarDay,
  storiesNewestFirst,
  testimonialsNewestFirst,
  type SiteDestination,
  type SiteStory,
  type SiteTestimonial,
} from "../../../contracts/generated/collections.ts";
import { historyLedger, type LedgerDeparture } from "../../../contracts/generated/history.ts";
import { formatOfferingDates } from "../../../contracts/generated/offerings.ts";
import type { LiveOfferings } from "../../../lib/offeringCards";
import { destinationHref, storyHref } from "../../../lib/siteCollections";

/*
 * #2829 W5 — the design-neutral layouts of the collection and history
 * blocks. They draw only what the publication (or Mingla's live feed) holds:
 * a missing picture, tagline or place is simply absent, never filled in.
 * Styles come from the site's design stylesheet (tokens only).
 */
type Block = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function Heading({ block, fallback }: { block: Block; fallback?: string }) {
  const heading = text(block.heading) || fallback || "";
  return (
    <>
      {text(block.eyebrow) && text(block.eyebrow) !== heading ? <p className="eyebrow">{text(block.eyebrow)}</p> : null}
      {heading ? <h2>{heading}</h2> : null}
      {text(block.intro) ? <p className="site-intro">{text(block.intro)}</p> : null}
    </>
  );
}

function BlockCta({ block }: { block: Block }) {
  const label = text(block.cta_label);
  const href = text(block.cta_href);
  if (!label || !href) return null;
  return <p className="site-block-cta"><a className="button ghost" href={href}>{label}</a></p>;
}

export function DestinationGrid({ block, artifact }: { block: Block; artifact: ArtifactV2 }) {
  const picked = rows(block.destinations).map((row) => text(row.slug));
  const all = artifact.collections.destinations;
  const shown: SiteDestination[] = picked.length
    ? picked.map((slug) => all.find((row) => row.slug === slug)).filter((row): row is SiteDestination => Boolean(row))
    : all;
  return (
    <section className="site-collection site-destinations">
      <Heading block={block} />
      <div className="grid">
        {shown.map((destination) => (
          <article className="tile site-card" key={destination.id} data-destination={destination.slug}>
            {destination.featured_image ? (
              <img className="site-card-image" src={destination.featured_image.url} alt={destination.featured_image.alt} width={destination.featured_image.width} height={destination.featured_image.height} loading="lazy" decoding="async" />
            ) : null}
            {destination.country ? <p className="site-card-kicker">{destination.country}</p> : null}
            <h3><Link href={destinationHref(artifact, destination.slug)}>{destination.title}</Link></h3>
            {destination.tagline ? <p>{destination.tagline}</p> : null}
          </article>
        ))}
      </div>
      <BlockCta block={block} />
    </section>
  );
}

export function StoryGrid({ block, artifact }: { block: Block; artifact: ArtifactV2 }) {
  const category = text(block.category) || null;
  const limit = typeof block.limit === "number" ? block.limit : undefined;
  const categories = new Map(artifact.collections.categories.map((row) => [row.slug, row.title]));
  const stories: SiteStory[] = storiesNewestFirst(artifact.collections.stories, isManuallyOrdered(artifact, "stories"))
    .filter((story) => category === null || story.category === category)
    .slice(0, limit);
  return (
    <section className="site-collection site-stories">
      <Heading block={block} />
      <div className="grid">
        {stories.map((story) => (
          <article className="tile site-card" key={story.id} data-story={story.slug}>
            {story.featured_image ? (
              <img className="site-card-image" src={story.featured_image.url} alt={story.featured_image.alt} width={story.featured_image.width} height={story.featured_image.height} loading="lazy" decoding="async" />
            ) : null}
            <p className="site-card-kicker">
              <time dateTime={story.published_at}>{formatCalendarDay(story.published_at, artifact.language)}</time>
              {story.category && categories.get(story.category) ? <> · {categories.get(story.category)}</> : null}
            </p>
            <h3><Link href={storyHref(artifact, story.slug)}>{story.title}</Link></h3>
            {story.excerpt ? <p>{story.excerpt}</p> : null}
          </article>
        ))}
      </div>
      <BlockCta block={block} />
    </section>
  );
}

/** Reviews from the Testimonials collection (only confirmed ones are ever published). */
export function TestimonialWall({ block, artifact, live }: { block: Block; artifact: ArtifactV2; live?: LiveOfferings }) {
  const picked = rows(block.testimonial_ids).map((row) => text(row.id));
  const all = artifact.collections.testimonials;
  const limit = typeof block.limit === "number" ? block.limit : undefined;
  const shown: SiteTestimonial[] = (picked.length
    ? picked.map((id) => all.find((row) => row.id === id)).filter((row): row is SiteTestimonial => Boolean(row))
    : testimonialsNewestFirst(all, isManuallyOrdered(artifact, "testimonials"))).slice(0, limit);
  return (
    <section className="site-collection site-testimonials">
      <Heading block={block} fallback="What guests say" />
      <div className="grid">
        {shown.map((review) => {
          // The trip a review is about: the owner's words, or Mingla's title for the linked trip.
          const linked = review.related_offering_id ? live?.offerings.find((offering) => offering.id === review.related_offering_id) : undefined;
          const trip = review.trip_name || linked?.title || "";
          return (
            <blockquote className="tile site-review" key={review.id}>
              <p>“{review.quote}”</p>
              <footer>
                <span className="site-review-name">{review.reviewer}</span>
                <span className="site-review-meta">
                  <time dateTime={review.review_date}>{formatCalendarDay(review.review_date, artifact.language)}</time>
                  {trip ? <> · {linked ? <a href={linked.public_url}>{trip}</a> : trip}</> : null}
                </span>
              </footer>
            </blockquote>
          );
        })}
      </div>
      <BlockCta block={block} />
    </section>
  );
}

function Departure({ departure, language, showPlace }: { departure: LedgerDeparture; language: string; showPlace: boolean }) {
  return (
    <>
      <a href={departure.href}>{departure.title}</a>
      {departure.date ? <> <time dateTime={departure.date}>{formatCalendarDay(departure.date, language)}</time></> : null}
      {showPlace && departure.place ? <span className="site-ledger-place"> · {departure.place}</span> : null}
    </>
  );
}

/** "Trips we've run": ended Mingla offerings (live feed, or the publication's snapshot). */
export function OfferingHistory({ block, artifact, live }: { block: Block; artifact: ArtifactV2; live?: LiveOfferings }) {
  const kind = ["trip", "event", "experience", "all"].includes(text(block.kind)) ? (text(block.kind) as "trip") : "trip";
  const series = rows(block.series).map((row) => ({
    label: text(row.label),
    offering_ids: rows(row.offering_ids).map((id) => ({ id: text(id.id) })),
  }));
  const entries = live ? historyLedger(live.offerings, live.now, { kind, series, offering_ids: rows(block.offering_ids).map((row) => ({ id: String(row.id ?? "") })) }) : [];
  return (
    <section className="site-collection site-ledger" data-offering-source={live?.source ?? "none"}>
      <Heading block={block} />
      {entries.length === 0 ? (
        <p className="site-empty">{live ? "Nothing to show here yet." : "This list is unavailable right now."}</p>
      ) : (
        <ol className="site-ledger-list">
          {entries.map((entry) =>
            entry.kind === "single" ? (
              <li key={entry.key} className="site-ledger-row"><Departure departure={entry.departure} language={artifact.language} showPlace /></li>
            ) : (
              <li key={entry.key} className="site-ledger-row site-ledger-series">
                <p className="site-ledger-series-name">
                  {entry.name}
                  <span className="site-ledger-count"> · {entry.departures.length} departures</span>
                  {entry.place ? <span className="site-ledger-place"> · {entry.place}</span> : null}
                </p>
                <ol>
                  {entry.departures.map((departure) => (
                    <li key={departure.id}><Departure departure={departure} language={artifact.language} showPlace={entry.place === null} /></li>
                  ))}
                </ol>
              </li>
            ))}
        </ol>
      )}
      <BlockCta block={block} />
    </section>
  );
}

/** A destination's related Mingla offerings that still resolve in the feed (others simply disappear). */
export function RelatedOfferings({ ids, live, language }: { ids: readonly string[]; live?: LiveOfferings; language: string }) {
  if (!live || ids.length === 0) return null;
  const offerings = ids
    .map((id) => live.offerings.find((offering) => offering.id === id))
    .filter((offering): offering is NonNullable<typeof offering> => Boolean(offering));
  if (offerings.length === 0) return null;
  return (
    <section className="site-related">
      <h2>Trips here</h2>
      <ul>
        {offerings.map((offering) => {
          const card = live.cards.get(offering.id);
          return (
            <li key={offering.id}>
              <a href={offering.public_url}>{offering.title}</a>
              {formatOfferingDates(offering, language) ? <> · {formatOfferingDates(offering, language)}</> : null}
              {card?.state.badge ? <> · {card.state.badge}</> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
