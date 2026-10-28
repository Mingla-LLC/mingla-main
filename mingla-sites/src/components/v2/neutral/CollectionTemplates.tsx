/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { formatCalendarDay, type SiteDestination, type SiteStory } from "../../../contracts/generated/collections.ts";
import type { RichTextDoc } from "../../../contracts/generated/richText.ts";
import type { LiveOfferings } from "../../../lib/offeringCards";
import type { CollectionEntry } from "../../../lib/siteCollections";
import { RichText } from "../RichText";
import { RelatedOfferings } from "./CollectionBlocks";

/*
 * #2829 W5 — the design-neutral destination and story pages (templates
 * `destination_detail`, `story_detail`). The owner's words, verbatim: facts
 * are what the owner typed, never looked up; a section with nothing in it is
 * not drawn. Related trips come from Mingla's live feed and link to the
 * existing Mingla pages.
 */
function Figure({ image }: { image: NonNullable<SiteDestination["featured_image"]> }) {
  return <img className="site-entry-image" src={image.url} alt={image.alt} width={image.width} height={image.height} decoding="async" />;
}

const FACT_LABELS: ReadonlyArray<[keyof NonNullable<SiteDestination["facts"]>, string]> = [
  ["language", "Language"],
  ["currency", "Currency"],
  ["religion", "Religion"],
  ["timezone", "Time zone"],
];

export function DestinationDetail({ destination, artifact, live }: { destination: SiteDestination; artifact: ArtifactV2; live?: LiveOfferings }) {
  const facts = FACT_LABELS.filter(([key]) => destination.facts?.[key]);
  return (
    <article className="site-entry site-destination" data-destination={destination.slug}>
      {destination.featured_image ? <Figure image={destination.featured_image} /> : null}
      {destination.country || destination.tagline ? (
        <p className="site-entry-lede">{[destination.country, destination.tagline].filter(Boolean).join(" · ")}</p>
      ) : null}
      {destination.summary ? <p className="site-entry-summary">{destination.summary}</p> : null}
      {facts.length ? (
        <dl className="site-facts">
          {facts.map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{destination.facts?.[key]}</dd></div>
          ))}
        </dl>
      ) : null}
      {destination.body ? (
        <section className="prose">
          {destination.story_heading ? <h2>{destination.story_heading}</h2> : null}
          <RichText doc={destination.body as RichTextDoc} />
        </section>
      ) : null}
      {destination.seasons?.length ? (
        <section className="site-seasons">
          <h2>When to go</h2>
          <div className="grid">
            {destination.seasons.map((season) => (
              <div className="tile" key={season.heading}>
                {season.image ? <Figure image={season.image} /> : null}
                <h3>{season.heading}</h3>
                {season.body ? <p>{season.body}</p> : null}
                {season.activities?.length ? <ul>{season.activities.map((activity) => <li key={activity}>{activity}</li>)}</ul> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {destination.did_you_know?.length ? (
        <section className="site-did-you-know">
          <h2>Did you know?</h2>
          <ul>{destination.did_you_know.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        </section>
      ) : null}
      <RelatedOfferings ids={destination.related_offering_ids ?? []} live={live} language={artifact.language} />
      {destination.gallery?.length ? (
        <section className="site-entry-gallery">
          <div className="grid">{destination.gallery.map((image) => <Figure key={image.id} image={image} />)}</div>
        </section>
      ) : null}
    </article>
  );
}

export function StoryDetail({ story, artifact }: { story: SiteStory; artifact: ArtifactV2 }) {
  const category = story.category ? artifact.collections.categories.find((row) => row.slug === story.category) : undefined;
  return (
    <article className="site-entry site-story" data-story={story.slug}>
      <p className="site-entry-lede">
        <time dateTime={story.published_at}>{formatCalendarDay(story.published_at, artifact.language)}</time>
        {category ? <> · {category.title}</> : null}
      </p>
      {story.featured_image ? <Figure image={story.featured_image} /> : null}
      <section className="prose"><RichText doc={story.content as RichTextDoc} /></section>
    </article>
  );
}

export function CollectionEntryView({ entry, artifact, live }: { entry: CollectionEntry; artifact: ArtifactV2; live?: LiveOfferings }) {
  return entry.collection === "destinations"
    ? <DestinationDetail destination={entry.entry} artifact={artifact} live={live} />
    : <StoryDetail story={entry.entry} artifact={artifact} />;
}
