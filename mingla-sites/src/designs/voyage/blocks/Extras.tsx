/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { STATS_ICON_NAMES } from "../../../contracts/generated/icons.ts";
import type { StatsIcon } from "../../../contracts/artifact";
import { GalleryLightbox } from "../../../components/GalleryLightbox";
import { MapEmbed } from "../../../components/MapEmbed";
import { StatIcon } from "../../../components/StatIcon";
import { Reveal } from "../Reveal";
import { ActionLink, rows, Section, SectionHead, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 (AD-4) — voyage's own layouts for the general blocks a travel
 * brand may use: gallery, divider, space, figures, team, pull quote and map.
 * They are built from the design's primitives (bands, cards, media frames),
 * so they restyle with the tokens like everything else.
 */

export function GalleryVoyage({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const images = rows(block.images).slice(0, 12).filter((image) => isSafeHref(image.url)).map((image) => ({ url: text(image.url), alt: text(image.alt) }));
  if (!images.length) return null;
  return (
    <Section tinted labelledBy={text(block.heading) ? id : undefined}>
      <SectionHead id={id} heading={text(block.heading)} standalone />
      <GalleryLightbox images={images} className="v-gallery" />
    </Section>
  );
}

export function DividerVoyage() {
  return <div className="shell"><hr className="v-divider" /></div>;
}

export function SpacerVoyage({ block }: VoyageBlockProps) {
  const size = ["small", "medium", "large"].includes(text(block.size)) ? text(block.size) : "medium";
  return <div className={`v-spacer v-spacer--${size}`} aria-hidden="true" />;
}

function isStatsIcon(value: unknown): value is StatsIcon {
  return typeof value === "string" && (STATS_ICON_NAMES as readonly string[]).includes(value);
}

export function StatsVoyage({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const items = rows(block.items);
  if (!items.length) return null;
  return (
    <Section labelledBy={text(block.heading) ? id : undefined}>
      <SectionHead id={id} heading={text(block.heading)} intro={text(block.body)} standalone />
      <dl className="v-tiles" data-count={Math.min(items.length, 4)}>
        {items.map((item, itemIndex) => (
          <Reveal key={itemIndex} delay={itemIndex}>
            <div className="tile card card--raised v-tile">
              {isStatsIcon(item.icon) ? <span className="tile-icon"><StatIcon name={item.icon} /></span> : null}
              <dt className="v-stat__figure">{text(item.figure)}</dt>
              {text(item.label) ? <dd className="card__title v-tile__title">{text(item.label)}</dd> : null}
              {text(item.body) ? <dd className="card__body v-tile__body">{text(item.body)}</dd> : null}
            </div>
          </Reveal>
        ))}
      </dl>
    </Section>
  );
}

export function TeamVoyage({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const members = rows(block.members);
  const shown = typeof block.preview_count === "number" ? members.slice(0, block.preview_count) : members;
  return (
    <Section labelledBy={id}>
      <div className="head-row">
        <SectionHead id={id} heading={text(block.heading) || "The team"} intro={text(block.caption)} />
        <ActionLink label={text(block.cta_label)} href={block.cta_href} />
      </div>
      <ul className="grid-cards v-team">
        {shown.map((member, memberIndex) => (
          <li key={memberIndex} className="card card--raised card--padded">
            <div className="media media--flush v-ratio-1-1">
              {isSafeHref(member.media_url) ? <img src={text(member.media_url)} alt={text(member.alt)} loading="lazy" decoding="async" /> : <span className="v-team__initial" aria-hidden="true">{text(member.name).slice(0, 1)}</span>}
            </div>
            <div className="v-team__body">
              {text(member.role) ? <p className="micro-label v-label-accent">{text(member.role)}</p> : null}
              <p className="card__title">{text(member.name)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function PullQuoteVoyage({ block }: VoyageBlockProps) {
  const quote = text(block.quote);
  if (!quote) return null;
  return (
    <Section>
      <figure className="card card--raised quote v-pull-quote">
        <span className="quote__mark" aria-hidden="true">&ldquo;</span>
        <blockquote className="quote__text"><p>{quote}</p></blockquote>
        {text(block.attribution) ? <figcaption className="quote__who"><span className="quote__name">{text(block.attribution)}</span></figcaption> : null}
      </figure>
    </Section>
  );
}

export function MapEmbedVoyage({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const latitude = typeof block.latitude === "number" ? block.latitude : Number.NaN;
  const longitude = typeof block.longitude === "number" ? block.longitude : Number.NaN;
  return (
    <Section labelledBy={text(block.heading) ? id : undefined}>
      <SectionHead id={id} heading={text(block.heading)} intro={text(block.body)} standalone />
      <div className="v-map card card--raised">
        <MapEmbed latitude={latitude} longitude={longitude} label={text(block.place_label)} />
      </div>
      {isSafeHref(block.directions_url) ? <div className="v-map__action"><ActionLink label="Directions" href={block.directions_url} /></div> : null}
    </Section>
  );
}
