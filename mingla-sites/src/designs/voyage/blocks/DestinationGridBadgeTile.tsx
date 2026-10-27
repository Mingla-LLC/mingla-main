/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import Link from "next/link";
import type { SiteDestination } from "../../../contracts/generated/collections.ts";
import { destinationHref } from "../../../lib/siteCollections";
import { Reveal } from "../Reveal";
import { gridSizes, HeadRow, rows, Section, sectionId, srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — destination_grid `badge-tile`: each destination a square photo
 * with a name plate straddling its lower edge (the name in the accent face,
 * "Destination guide" under it); the whole tile is the link. A lone
 * destination lies on its side from 48rem.
 */
export function DestinationGridBadgeTile({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const { artifact } = ctx;
  const picked = rows(block.destinations).map((row) => text(row.slug));
  const all = artifact.collections.destinations;
  const shown: SiteDestination[] = picked.length
    ? picked.map((slug) => all.find((row) => row.slug === slug)).filter((row): row is SiteDestination => Boolean(row))
    : all;
  if (!shown.length) return null;
  return (
    <Section labelledBy={id}>
      <HeadRow id={id} heading={text(block.heading) || undefined} intro={text(block.intro)} link={{ label: text(block.cta_label), href: block.cta_href }} />
      <div className="grid-cards">
        {shown.map((destination, destinationIndex) => (
          <Reveal key={destination.id} delay={destinationIndex}>
            <Link href={destinationHref(artifact, destination.slug)} className="dest-tile" data-destination={destination.slug}>
              <span className="dest-tile__thumb">
                {destination.featured_image ? (
                  <img src={destination.featured_image.url} srcSet={srcSetFor(artifact, destination.featured_image.url)} sizes={gridSizes(shown.length)} alt={destination.featured_image.alt} width={destination.featured_image.width} height={destination.featured_image.height} loading="lazy" decoding="async" />
                ) : null}
                <span aria-hidden="true" className="dest-tile__scrim" />
              </span>
              <span className="dest-tile__caption">
                <span className="dest-tile__name">{destination.title}</span>
                <span className="dest-tile__role">Destination guide</span>
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
