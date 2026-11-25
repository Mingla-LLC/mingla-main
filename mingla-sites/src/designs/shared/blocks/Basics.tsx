/* eslint-disable @next/next/no-img-element -- site media is first-party and immutable (/media). */
import { STATS_ICON_NAMES } from "../../../contracts/generated/icons.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import type { StatsIcon } from "../../../contracts/artifact";
import { BrandFilm } from "../../../components/v2/BrandFilm";
import { MapEmbed } from "../../../components/MapEmbed";
import { StatIcon } from "../../../components/StatIcon";
import { MenuNeutral } from "../../../components/v2/neutral/RestaurantNeutral";
import { StoryGrid } from "../../../components/v2/neutral/CollectionBlocks";
import { ContactFormBlock } from "../../../components/v2/neutral/FormBlocks";
import { ContactDetailsNeutral } from "../../../components/v2/neutral/BasicBlocks";
import { playableVideoUrl } from "../../../lib/siteVideo";
import { ActionButton, Blk, HeadlineLines, Label, Photo, rows, SecHead, sectionId, text, type SharedBlockProps } from "../parts";
import { galleryImages } from "../data";

/*
 * #4453 6a — the design-neutral layout ("neutral") of every block type the
 * shared library has no gallery layout for, drawn for the gallery designs
 * (Nocturne, Haven, Maison) from the shared role variables only, so each
 * design's tokens and type colour it. Every field the block defines is drawn
 * (the field-parity test covers these too); a block missing its required
 * content renders nothing rather than something invented.
 */

function isStatsIcon(value: unknown): value is StatsIcon {
  return typeof value === "string" && (STATS_ICON_NAMES as readonly string[]).includes(value);
}

/** The page's title band, over the owner's picture or the dark band. */
export function PageHeaderBasic({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  const lines = text(block.subheading).split("\n").map((line) => line.trim()).filter(Boolean);
  if (picture && ctx.artifact.design.options?.cover === "full") return <PageHeaderCover block={block} index={index} ctx={ctx} picture={picture} lines={lines} />;
  return (
    <section className={`mg-phd${picture ? " mg-phd--photo mg-on-photo" : " mg-band"}`} aria-labelledby={id} data-mg-hero="">
      {picture ? <div className="mg-phd__bg" data-mg-hero-bg=""><Photo artifact={ctx.artifact} url={picture} hero sizes="100vw" /></div> : null}
      <div className="mg-wrap mg-phd__inner">
        <h1 id={id} className="mg-phd__h">{text(block.heading)}</h1>
        {lines.length ? <p className="mg-lede mg-phd__sub">{lines.map((line, lineIndex) => <span key={lineIndex} className="mg-phd__line">{line}</span>)}</p> : null}
      </div>
    </section>
  );
}

/**
 * #4575 — a page title over a photo, drawn as the full-screen cover: the same
 * markup and classes as HeroFullbleed, so the design's cover rules apply.
 */
function PageHeaderCover({ block, index, ctx, picture, lines }: SharedBlockProps & { picture: string; lines: string[] }) {
  const id = sectionId(block, index);
  const heading = text(block.heading);
  return (
    <section className="mg-hero mg-hero-full mg-on-photo" aria-labelledby={id} data-mg-hero="">
      <div className="mg-hero__bg" data-mg-hero-bg="">
        <Photo artifact={ctx.artifact} url={picture} hero sizes="100vw" />
      </div>
      <div className="mg-wrap mg-hero__inner">
        <HeadlineLines lines={[heading]} heading={heading} as="h1" id={id} />
        {lines.length ? (
          <div className="mg-hero__row">
            <div className="mg-hero__main">
              <p className="mg-lede" data-mg-in="">{lines.join(" · ")}</p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A picture beside a heading, caption, optional badge, quote and button. */
export function MediaFeatureBasic({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  if (!isSafeHref(block.media_url)) return null;
  const quote = text(block.quote);
  const figure = text(block.badge_figure);
  const badgeLabel = text(block.badge_label);
  return (
    <Blk className={`mg-mf mg-mf--${text(block.alignment) === "left" ? "left" : "right"}${text(block.media_shape) === "circle" ? " mg-mf--circle" : ""}`} labelledBy={text(block.heading) ? id : undefined}>
      <div className="mg-mf__grid">
        <figure className="mg-mf__fig" data-mg-rise="">
          <div className="mg-ph"><Photo artifact={ctx.artifact} url={block.media_url} alt={text(block.alt)} sizes="(min-width: 900px) 50vw, 100vw" /></div>
          {figure || badgeLabel ? <figcaption className="mg-mf__badge"><b>{figure}</b><span>{badgeLabel}</span></figcaption> : null}
        </figure>
        <div className="mg-mf__txt" data-mg-rise="">
          <Label>{text(block.eyebrow)}</Label>
          {text(block.heading) ? <h2 id={id}>{text(block.heading)}</h2> : null}
          {text(block.caption) ? <p className="mg-mf__cap">{text(block.caption)}</p> : null}
          {quote ? (
            <blockquote className="mg-mf__q">
              <p>{quote}</p>
              {text(block.quote_attribution) ? <cite className="mg-cite">{text(block.quote_attribution)}</cite> : null}
            </blockquote>
          ) : null}
          <ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn" />
        </div>
      </div>
    </Blk>
  );
}

/** One heading, one sentence, one button: call to action, contact, menu link and the Mingla reservation. */
export function CalloutBasic({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const reservation = block.type === "venue_reservation";
  const href = reservation ? block.url : block.href;
  const label = reservation ? "Continue with Mingla" : text(block.label);
  if (!label) return null;
  // #4572: older owner-created CTA rows stored "/" only to satisfy the
  // required field. It was never an intentional destination. Keep the band,
  // but hide that dead home button until the owner supplies a real target.
  const actionHref =
    block.type === "cta" && href === "/" ? null : href;
  if (block.type !== "cta" && !isSafeHref(actionHref)) return null;
  return (
    <Blk className={`mg-callout mg-callout--${block.type}`} labelledBy={text(block.heading) ? id : undefined} tone={block.type === "cta" ? "band" : undefined}>
      <div className="mg-callout__in" data-mg-rise="">
        <Label>{text(block.eyebrow)}</Label>
        {text(block.heading) ? <h2 id={id}>{text(block.heading)}</h2> : null}
        {text(block.body) ? <p className="mg-callout__body">{text(block.body)}</p> : null}
        <ActionButton label={label} href={actionHref} className={block.type === "cta" ? "mg-btn mg-btn--accent" : "mg-btn"} />
      </div>
    </Blk>
  );
}

/** The owner's film behind its still (a labelled play button; with no playable film, only the still). */
export function VideoFeatureBasic({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  if (!isSafeHref(block.poster_url)) return null;
  const heading = text(block.heading);
  const groupHeading = text(block.group_heading);
  return (
    <Blk className="mg-film" labelledBy={groupHeading || heading ? id : undefined}>
      <Label>{text(block.eyebrow)}</Label>
      {groupHeading ? <h2 id={id}>{groupHeading}</h2> : null}
      <figure className="mg-film__fig" data-mg-rise="">
        <BrandFilm src={playableVideoUrl(ctx.artifact, block.video_url)} poster={String(block.poster_url)} label={heading || groupHeading || "Film"} className="mg-film__player" />
        {heading || text(block.caption) ? (
          <figcaption className="mg-film__cap">
            {heading ? (groupHeading ? <h3>{heading}</h3> : <h2 id={id}>{heading}</h2>) : null}
            {text(block.caption) ? <p className="mg-muted">{text(block.caption)}</p> : null}
          </figcaption>
        ) : null}
      </figure>
      <ActionButton label={text(block.group_cta_label)} href={block.group_cta_href} className="mg-btn mg-btn--ghost" />
    </Blk>
  );
}

/** A row of figures, each with its line and sentence. */
export function StatsBasic({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const items = rows(block.items).filter((item) => text(item.figure));
  if (!items.length) return null;
  return (
    <Blk className="mg-stats" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.body)} />
      <ul className="mg-stats__row" data-mg-stagger="">
        {items.map((item, itemIndex) => (
          <li key={itemIndex} className={`mg-stat${item.highlight === true ? " mg-stat--hi" : ""}`}>
            {isStatsIcon(item.icon) ? <span className="mg-stat__ic"><StatIcon name={item.icon} /></span> : null}
            <b className="mg-big-num">{text(item.figure)}</b>
            {text(item.label) ? <span className="mg-stat__l">{text(item.label)}</span> : null}
            {text(item.body) ? <p className="mg-muted">{text(item.body)}</p> : null}
          </li>
        ))}
      </ul>
    </Blk>
  );
}

/** The people, with roles and optional portraits (the owner's preview count, then the button). */
export function TeamBasic({ block, index, ctx }: SharedBlockProps) {
  const id = sectionId(block, index);
  const count = typeof block.preview_count === "number" ? block.preview_count : undefined;
  const members = rows(block.members).filter((member) => text(member.name)).slice(0, count);
  if (!members.length) return null;
  return (
    <Blk className="mg-team" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.caption)} extra={<ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />} />
      <ul className="mg-team__grid" data-mg-stagger="">
        {members.map((member, memberIndex) => (
          <li key={memberIndex} className="mg-team__p">
            {isSafeHref(member.media_url) ? <div className="mg-ph mg-team__ph"><Photo artifact={ctx.artifact} url={member.media_url} alt={text(member.alt)} sizes="(min-width: 900px) 25vw, 50vw" /></div> : null}
            <h3>{text(member.name)}</h3>
            {text(member.role) ? <p className="mg-muted">{text(member.role)}</p> : null}
          </li>
        ))}
      </ul>
    </Blk>
  );
}

/** One line lifted out, with who said it. */
export function PullQuoteBasic({ block }: SharedBlockProps) {
  const quote = text(block.quote);
  if (!quote) return null;
  return (
    <Blk className="mg-pq">
      <figure className="mg-pq__fig" data-mg-rise="">
        <blockquote><p className="mg-bigq">{quote}</p></blockquote>
        {text(block.attribution) ? <figcaption className="mg-cite">{text(block.attribution)}</figcaption> : null}
      </figure>
    </Blk>
  );
}

/** A map of one place, loaded only when the visitor asks (the existing map panel). */
export function MapEmbedBasic({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const latitude = typeof block.latitude === "number" ? block.latitude : Number.NaN;
  const longitude = typeof block.longitude === "number" ? block.longitude : Number.NaN;
  return (
    <Blk className="mg-map" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.body)} />
      <div className="mg-map__panel"><MapEmbed latitude={latitude} longitude={longitude} label={text(block.place_label)} /></div>
      <ActionButton label="Directions" href={block.directions_url} className="mg-btn mg-btn--ghost" />
    </Blk>
  );
}

/** A few dishes from the Mingla menu beside the owner's photographs. */
export function MenuPreviewBasic({ block, index, ctx }: SharedBlockProps) {
  const images = galleryImages(block).slice(0, 4);
  return (
    <section className="mg-blk mg-basic mg-menu-preview" aria-labelledby={text(block.heading) ? sectionId(block, index) : undefined}>
      <div className="mg-wrap mg-menu-preview__grid">
        <div className="mg-basic__in"><MenuNeutral block={block} /></div>
        {images.length ? (
          <div className="mg-menu-preview__pics">
            {images.map((image) => <div key={image.url} className="mg-ph"><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes="(min-width: 900px) 25vw, 50vw" /></div>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Stories, newest first (the runtime's collection grid inside the design's section). */
export function StoryGridBasic({ block, ctx }: SharedBlockProps) {
  return <div className="mg-blk mg-basic mg-basic--stories"><div className="mg-wrap"><StoryGrid block={block} artifact={ctx.artifact} /></div></div>;
}

/** The contact form (Mingla receives the message; the runtime's form inside the design's section). */
export function ContactFormBasic({ block, index, ctx }: SharedBlockProps) {
  if (!ctx.forms) return null;
  return (
    <div className="mg-blk mg-basic mg-basic--form">
      <div className="mg-wrap"><ContactFormBlock block={block} artifact={ctx.artifact} forms={ctx.forms} pagePath={ctx.page.path} blockIndex={index} /></div>
    </div>
  );
}

/** Email and place, in the design's section. */
export function ContactDetailsBasic({ block }: SharedBlockProps) {
  return <div className="mg-blk mg-basic mg-basic--contact"><div className="mg-wrap"><ContactDetailsNeutral block={block} /></div></div>;
}

export function DividerBasic() {
  return <div className="mg-wrap mg-divider-wrap"><hr className="mg-divider" /></div>;
}

export function SpacerBasic({ block }: SharedBlockProps) {
  const size = ["small", "medium", "large"].includes(text(block.size)) ? text(block.size) : "medium";
  return <div className={`mg-spacer mg-spacer--${size}`} aria-hidden="true" />;
}
