/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import type { SiteDestination } from "../../../contracts/generated/collections.ts";
import type { RichTextDoc } from "../../../contracts/generated/richText.ts";
import { RichText } from "../../../components/v2/RichText";
import { gridSizes, srcSetFor } from "../parts";
import type { SiteEventContext } from "../../../lib/clientAnalytics";
import type { LiveOfferings } from "../../../lib/offeringCards";
import { Breadcrumb, type Crumb } from "../blocks/PageHeader";
import { PhotoCard } from "../blocks/OfferingGridPhotoCard";
import { Reveal } from "../Reveal";
import { collectionIndexPage } from "../routing";
import { hrefForPage } from "../../../lib/pageRouting";

/*
 * #2829 W7 — the voyage destination page: a cover header (breadcrumb Home /
 * <destinations page> / <place>, the name, the tagline), the owner's facts on
 * a dark strip, the story, the seasons as cards with activity chips, the
 * "did you know" cards, and the related Mingla trips as photo cards linking
 * to their Mingla pages. Every word is the owner's; a section with nothing in
 * it is not drawn.
 */
const FACT_LABELS: ReadonlyArray<[keyof NonNullable<SiteDestination["facts"]>, string]> = [
  ["language", "Language"],
  ["currency", "Currency"],
  ["religion", "Religion"],
  ["timezone", "Timezone"],
];

export function DestinationTemplate({ destination, artifact, live, analytics }: { destination: SiteDestination; artifact: ArtifactV2; live?: LiveOfferings; analytics: SiteEventContext }) {
  const index = collectionIndexPage(artifact, "destinations");
  const crumbs: Crumb[] = [{ label: "Home", href: "/" }, ...(index ? [{ label: index.title, href: hrefForPage(index) }] : []), { label: destination.title, href: null }];
  const facts = FACT_LABELS.filter(([key]) => destination.facts?.[key]);
  const related = (destination.related_offering_ids ?? [])
    .map((id) => live?.offerings.find((offering) => offering.id === id))
    .filter((offering): offering is NonNullable<typeof offering> => Boolean(offering));
  const image = destination.featured_image;
  return (
    <article data-destination={destination.slug}>
      <header className="cover cover--center on-photo v-cover v-cover--header v-cover--entry">
        {image ? (
          <>
            <img src={image.url} srcSet={srcSetFor(artifact, image.url)} alt="" aria-hidden="true" sizes="100vw" className="v-cover__img v-cover__img--header photo-header" fetchPriority="high" decoding="sync" />
            <span aria-hidden="true" className="scrim-header v-behind" />
          </>
        ) : null}
        <div className="shell">
          <Breadcrumb crumbs={crumbs} />
          <h1 className="v-entry-title">{destination.title}</h1>
          {destination.tagline ? <p className="lede v-on-photo-lede v-entry-lede">{destination.tagline}</p> : null}
        </div>
      </header>
      {facts.length ? (
        <section className="dest-facts on-dark" aria-label="Facts">
          <dl className="shell v-dest-facts">
            {facts.map(([key, label]) => (
              <div key={key} className="dest-fact">
                <dt className="micro-label">{label}</dt>
                <dd className="v-dest-fact__value">{destination.facts?.[key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {destination.body ? (
        <section className="band" aria-labelledby="dest-story">
          <div className="shell">
            <h2 id="dest-story">{destination.story_heading || `The story of ${destination.title}`}</h2>
            <div className="prose v-prose-gap"><RichText doc={destination.body as RichTextDoc} /></div>
          </div>
        </section>
      ) : null}
      {destination.seasons?.length ? (
        <section className="band is-tinted" aria-labelledby="dest-seasons">
          <div className="shell">
            <h2 id="dest-seasons" className="v-heading-gap">Seasonal activities</h2>
            <div className="v-two-up">
              {destination.seasons.map((season, seasonIndex) => (
                <Reveal key={season.heading} delay={seasonIndex}>
                  <article className="card card--raised v-season">
                    <h3>{season.heading}</h3>
                    {season.body ? <p className="v-season__body">{season.body}</p> : null}
                    {season.activities?.length ? <ul className="v-chips">{season.activities.map((activity) => <li key={activity} className="chip-activity">{activity}</li>)}</ul> : null}
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {destination.did_you_know?.length ? (
        <section className="band" aria-labelledby="dest-know">
          <div className="shell">
            <h2 id="dest-know" className="v-heading-gap">{destination.title} – must know &amp; facts</h2>
            <div className="v-three-up">
              {destination.did_you_know.map((fact, factIndex) => (
                <Reveal key={fact} delay={factIndex}>
                  <article className="know-card">
                    <span className="know-card__bar" aria-hidden="true" />
                    <p className="micro-label">Did you know?</p>
                    <p className="v-know__text">{fact}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {related.length ? (
        <section className="band is-tinted" aria-labelledby="dest-trips">
          <div className="shell">
            <h2 id="dest-trips" className="v-heading-gap">Related trips</h2>
            <div className="grid-cards">
              {related.map((offering, offeringIndex) => {
                const card = live?.cards.get(offering.id);
                return card ? <Reveal key={offering.id} delay={offeringIndex}><PhotoCard card={card} offering={offering} analytics={analytics} sizes={gridSizes(related.length)} /></Reveal> : null;
              })}
            </div>
          </div>
        </section>
      ) : null}
    </article>
  );
}
