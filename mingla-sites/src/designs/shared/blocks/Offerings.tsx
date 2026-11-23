/* eslint-disable @next/next/no-img-element -- covers are served by the token-bound /om route (immutable, same origin). */
import { SiteDateInput } from "../../../components/v2/SiteDateInput";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import type { SiteDestination } from "../../../contracts/generated/collections.ts";
import { TrackedLink } from "../../../components/TrackedLink";
import { GalleryLightbox } from "../../../components/GalleryLightbox";
import { SiteSearchForm } from "../../../components/PreviewLinks";
import { menuPrice } from "../../../components/v2/neutral/RestaurantNeutral";
import { FeatureIcon } from "../../voyage/icons";
import { destinationHref } from "../../../lib/siteCollections";
import { hrefForPage } from "../../../lib/pageRouting";
import { showsDraftHints } from "../../../lib/previewPublication";
import { destinations, frozenOfferings, galleryImages, gridItems, type GridItem } from "../data";
import { ActionButton, Arrow, Blk, Go, Label, MinglaNote, Photo, rows, SecHead, sectionId, text, type SharedBlockProps, type SharedContext } from "../parts";

/*
 * #4453 §3.3 — shared layouts for the things Mingla sells and the blocks
 * around them. An offering card shows only what Mingla knows (title, dates,
 * place, state, summary, a price only while it can be booked) and its one
 * action opens the offering's own Mingla page (A1.2): nothing is booked or
 * priced on the site.
 */

const KIND_PLURAL: Readonly<Record<string, string>> = { all: "offerings", trip: "trips", event: "events", experience: "experiences" };

export function GridShell({ block, index, ctx, className, children }: SharedBlockProps & { className: string; children: (items: GridItem[]) => React.ReactNode }) {
  const id = sectionId(block, index);
  const result = gridItems(block, ctx);
  const noun = KIND_PLURAL[text(block.kind) || "all"] ?? "offerings";
  const pageHref = hrefForPage(ctx.page);
  const head = (
    <SecHead
      id={id}
      eyebrow={text(block.eyebrow)}
      heading={text(block.heading)}
      intro={text(block.intro)}
      extra={<ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />}
    />
  );
  const filters = block.show_filters === true ? (
    <SiteSearchForm action={pageHref} className="mg-bk mg-bk--panel" aria-label={`Search ${noun}`}>
      <label htmlFor={`${id}-where`}><span className="mg-bk__k">Where</span><input id={`${id}-where`} name="where" type="search" maxLength={80} defaultValue={ctx.live?.filters.where ?? undefined} /></label>
      <label htmlFor={`${id}-from`}><span className="mg-bk__k">From</span><SiteDateInput id={`${id}-from`} name="from" defaultValue={ctx.live?.filters.from ?? undefined} /></label>
      <label htmlFor={`${id}-to`}><span className="mg-bk__k">To</span><SiteDateInput id={`${id}-to`} name="to" defaultValue={ctx.live?.filters.to ?? undefined} /></label>
      <button type="submit" className="mg-btn"><span>Search</span><Arrow /></button>
    </SiteSearchForm>
  ) : null;
  const frozen = frozenOfferings(block);
  let body: React.ReactNode;
  if (frozen.length && !text(block.mode)) {
    // The original (v1) grid: titles and Mingla links frozen at publish.
    body = (
      <ul className="mg-lrows">
        {frozen.map((row) => (
          <li key={row.id} className="mg-lrow mg-lrow--frozen">
            <div className="mg-lrow__t"><h3>{row.label}</h3>{row.summary ? <p>{row.summary}</p> : null}</div>
            <ActionButton label="See on Mingla" href={row.url} className="mg-btn mg-btn--small" />
          </li>
        ))}
      </ul>
    );
  } else if (result.kind === "check_dates" || result.kind === "no_match") {
    body = (
      <div className="mg-empty">
        <p>{result.kind === "check_dates" ? "Your “From” date is after your “To” date." : `No ${noun} match those dates.`}</p>
        <Go href={pageHref} className="mg-btn mg-btn--ghost"><span>Clear search</span></Go>
      </div>
    );
  } else if (result.kind === "empty") {
    if (text(block.mode) === "past") return null;
    // #4453 I-SITES-NO-PUBLIC-EMPTY-STATE — left out of the public site; only a
    // Draft preview keeps the owner's hint.
    if (!(ctx.preview ?? showsDraftHints(ctx.analytics.publicationId))) return null;
    body = (
      <div className="mg-empty">
        <p>{text(block.empty_text) || `New ${noun} will appear here as soon as they are on sale.`}</p>
        <ActionButton label={text(block.empty_cta_label)} href={block.empty_cta_href} className="mg-btn mg-btn--ghost" />
      </div>
    );
  } else {
    body = children(result.items);
  }
  return (
    <Blk className={className} labelledBy={text(block.heading) ? id : undefined} source={ctx.live?.source ?? "none"}>
      {head}
      {filters}
      {body}
      {result.kind === "items" ? <div className="mg-offers-note"><MinglaNote /></div> : null}
    </Blk>
  );
}

export function State({ item }: { item: GridItem }) {
  const badge = item.card.state.badge;
  return badge ? <span className={`mg-avail${item.card.state.bookable ? "" : " mg-avail--out"}`}>{badge}</span> : null;
}

export function Price({ item, className }: { item: GridItem; className: string }) {
  const price = item.card.state.bookable ? item.card.price : null;
  if (!price) return null;
  const from = price.startsWith("From ") ? price.slice(5) : null;
  return <div className={className}>{from ? <><small>From</small>{from}</> : price}</div>;
}

export function Book({ item, ctx, className }: { item: GridItem; ctx: SharedContext; className: string }) {
  // #4453 M10 — a plan preview's labelled sample: its CTA is plain text, never a link.
  if (item.card.sample) return <span className={className} data-sample="1"><span>{item.card.cta}</span></span>;
  return (
    <TrackedLink href={item.card.href} context={ctx.analytics} ctaKind="offering" offeringId={item.card.id} className={className}>
      <span>{item.card.cta}</span><Arrow /><span className="mg-sr">{`: ${item.card.title} on Mingla`}</span>
    </TrackedLink>
  );
}

export function Cover({ item, sizes, face = false }: { item: GridItem; sizes: string; face?: boolean }) {
  /*
   * #4453 — no usable cover (none, or a video cover the feed cannot serve as a
   * picture): on the cards layout (`face`), a designed face with the
   * offering's title instead of an empty box. Decorative only: the title is
   * also the card's heading. Other layouts keep their own no-picture rule.
   */
  const image = item.card.coverUrl
    ? <img src={item.card.coverUrl} srcSet={item.card.coverSrcSet ?? undefined} sizes={item.card.coverSrcSet ? sizes : undefined} alt="" loading="lazy" decoding="async" />
    : face ? <span className="mg-ph-none" aria-hidden="true"><span className="mg-ph-none__t">{item.card.title}</span></span> : null;
  // #4453 milestone 9 — with detail pages on, the image opens the site's own
  // page (a duplicate of the title link, so it is hidden from the keyboard and readers).
  return image && item.card.detailHref
    ? <a className="mg-to-detail-img" href={item.card.detailHref} tabIndex={-1} aria-hidden="true">{image}</a>
    : image;
}

/**
 * #4453 milestone 9 — a card's title: a link to the offering's page on this
 * site while SITES_DETAIL_PAGES is on, plain text otherwise (the card's Book
 * button always goes to Mingla).
 */
export function CardTitle({ card }: { card: Pick<GridItem["card"], "title" | "detailHref"> }) {
  return card.detailHref ? <a className="mg-to-detail" href={card.detailHref}>{card.title}</a> : <>{card.title}</>;
}

export function OfferingGridPoster(props: SharedBlockProps) {
  return (
    <GridShell {...props} className="mg-offers-poster">
      {(items) => (
        <div className="mg-posters" data-mg-stagger="">
          {items.map((item, itemIndex) => (
            <article key={item.card.id} className={`mg-poster${itemIndex === 0 && items.length % 2 ? " mg-poster--wide" : ""}`} data-offering-kind={item.card.kind}>
              <div className="mg-ph"><Cover item={item} sizes={itemIndex === 0 && items.length % 2 ? "(min-width: 1320px) 1280px, 100vw" : "(min-width: 900px) 50vw, 100vw"} /></div>
              <div className="mg-poster__body">
                {item.card.destination || item.card.dates ? <p className="mg-poster__where">{[item.card.destination, item.card.dates].filter(Boolean).join(" · ")}</p> : null}
                <h3><CardTitle card={item.card} /></h3>
                {item.card.summary ? <p className="mg-poster__blurb">{item.card.summary}</p> : null}
                <div className="mg-chips"><State item={item} /></div>
                <div className="mg-poster__foot">
                  <Price item={item} className="mg-price" />
                  <Book item={item} ctx={props.ctx} className="mg-btn mg-btn--accent" />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </GridShell>
  );
}

/** A srcset entry's or a URL's path ends in a centre crop (`/c400`, `/c768`), before any `?` query. */
const CROP_PATH = /\/c(?:400|768)$/;
const pathOf = (url: string) => url.split("?")[0]!;

/**
 * #4575 — the WHOLE cover picture for a flyer, never a 4:3 centre crop: the
 * card's srcset without its `c400` / `c768` crops (preview-stamped URLs keep
 * their `?` key), `src` its first remaining entry; with no srcset left, the
 * stored cover (`/original`) in place of a crop. Null with no cover.
 */
export function wholeCoverSources(card: { coverUrl: string | null; coverSrcSet: string | null }): { src: string; srcSet: string | null } | null {
  if (!card.coverUrl) return null;
  const kept = (card.coverSrcSet ?? "")
    .split(/,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !CROP_PATH.test(pathOf(entry.split(/\s+/)[0]!)));
  if (kept.length) return { src: kept[0]!.split(/\s+/)[0]!, srcSet: kept.join(", ") };
  const [path, ...query] = card.coverUrl.split("?");
  const src = path!.replace(CROP_PATH, "/original");
  return { src: query.length ? `${src}?${query.join("?")}` : src, srcSet: null };
}

/** #4575 — a list row's flyer (Grid's full-screen cover): the whole picture, at its own shape. */
function FlyerThumb({ item }: { item: GridItem }) {
  const sources = wholeCoverSources(item.card);
  if (!sources) return null;
  const image = (
    <img
      src={sources.src}
      srcSet={sources.srcSet ?? undefined}
      sizes={sources.srcSet ? "(min-width: 861px) 15vw, (min-width: 721px) 25vw, 66vw" : undefined}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
  return item.card.detailHref
    ? <a className="mg-to-detail-img" href={item.card.detailHref} tabIndex={-1} aria-hidden="true">{image}</a>
    : image;
}

export function OfferingGridList(props: SharedBlockProps) {
  // #4575 — Grid's full-screen cover adds a flyer column to each row.
  const flyers = props.ctx.artifact.design.options?.cover === "full";
  return (
    <GridShell {...props} className="mg-offers-list">
      {(items) => (
        <ul className="mg-lrows" data-mg-stagger="">
          {items.map((item) => (
            <li key={item.card.id} className="mg-lrow" data-offering-kind={item.card.kind}>
              <p className="mg-lrow__d">{item.card.dates}</p>
              {flyers ? <div className="mg-lrow__img"><FlyerThumb item={item} /></div> : null}
              <div className="mg-lrow__t">
                <h3><CardTitle card={item.card} /></h3>
                {item.card.summary ? <p>{item.card.summary}</p> : null}
              </div>
              <div className="mg-lrow__meta">
                {item.card.destination ? <span>{item.card.destination}</span> : null}
                <Price item={item} className="mg-lrow__price" />
                <State item={item} />
              </div>
              <Book item={item} ctx={props.ctx} className="mg-btn mg-btn--small" />
            </li>
          ))}
        </ul>
      )}
    </GridShell>
  );
}

export function OfferingGridCards(props: SharedBlockProps) {
  return (
    <GridShell {...props} className="mg-offers-cards">
      {(items) => (
        <div className={`mg-ocards mg-ocards--c${Math.min(items.length, 4)}`} data-mg-stagger="">
          {items.map((item) => (
            <article key={item.card.id} className="mg-ocard" data-offering-kind={item.card.kind}>
              <div className="mg-ph"><Cover item={item} face sizes="(min-width: 1000px) 33vw, (min-width: 720px) 50vw, 100vw" /></div>
              <div className="mg-ocard__b">
                {item.card.dates ? <p className="mg-ocard__when">{item.card.dates}</p> : null}
                <h3><CardTitle card={item.card} /></h3>
                {item.card.summary ? <p className="mg-ocard__blurb">{item.card.summary}</p> : null}
                {item.card.destination ? <p className="mg-ocard__where">{item.card.destination}</p> : null}
                <State item={item} />
                <div className="mg-ocard__row">
                  <Price item={item} className="mg-price" />
                  <Book item={item} ctx={props.ctx} className="mg-btn mg-btn--small" />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </GridShell>
  );
}

/* ---------------- menu_board: columns ---------------- */

/** The Mingla menu in columns: each section a heading and its dishes, prices from Mingla only. */
export function MenuBoardColumns({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const sections = rows(block.sections);
  if (!sections.length) return null;
  return (
    <Blk className="mg-menu" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} />
      <div className="mg-mcols" data-mg-stagger="">
        {sections.map((section, sectionIndex) => (
          <div key={sectionIndex} className="mg-mcol">
            <h3>{text(section.name)}</h3>
            {text(section.description) ? <p className="mg-mcol__note">{text(section.description)}</p> : null}
            <ul>
              {rows(section.items).map((item) => {
                const price = menuPrice(item.price_minor, item.currency);
                return (
                  <li key={text(item.id)}>
                    <div><b>{text(item.name)}</b>{text(item.description) ? <span>{text(item.description)}</span> : null}</div>
                    {price ? <em>{price}</em> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {text(block.note) ? <p className="mg-mfoot">{text(block.note)}</p> : null}
    </Blk>
  );
}

/* ---------------- feature_cards: tiles, numbered ---------------- */

function cards(block: SharedBlockProps["block"]) {
  return rows(block.cards).map((card) => ({ title: text(card.title), body: text(card.body), icon: typeof card.icon === "string" ? card.icon : null }))
    .filter((card) => card.title);
}

export function FeatureCardsTiles({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const items = cards(block);
  if (!items.length) return null;
  return (
    <Blk className="mg-feats-tiles" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} heading={text(block.heading)} intro={text(block.intro)} />
      <ul className={`mg-tiles mg-tiles--t${Math.min(items.length, 4)}`} data-mg-stagger="">
        {items.map((card, cardIndex) => (
          <li key={cardIndex} className="mg-tile">
            {card.icon ? <span className="mg-tile__ic"><FeatureIcon name={card.icon as Parameters<typeof FeatureIcon>[0]["name"]} /></span> : null}
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </li>
        ))}
      </ul>
    </Blk>
  );
}

export function FeatureCardsNumbered({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const items = cards(block);
  if (!items.length) return null;
  return (
    <Blk className="mg-feats-num" labelledBy={text(block.heading) ? id : undefined}>
      <div className="mg-fn-grid">
        <div>
          {text(block.heading) ? <h2 id={id}>{text(block.heading)}</h2> : null}
          {text(block.intro) ? <p className="mg-fn-intro">{text(block.intro)}</p> : null}
        </div>
        <ol className="mg-fn" data-mg-stagger="">
          {items.map((card, cardIndex) => (
            <li key={cardIndex}>
              <span className="mg-fn__n" aria-hidden="true">{String(cardIndex + 1).padStart(2, "0")}</span>
              <div>
                {card.icon ? <span className="mg-tile__ic"><FeatureIcon name={card.icon as Parameters<typeof FeatureIcon>[0]["name"]} /></span> : null}
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Blk>
  );
}

/* ---------------- gallery: pinned, mosaic, stagger ---------------- */

function GalleryHead({ block, id }: { block: SharedBlockProps["block"]; id: string }) {
  return <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} />;
}

/**
 * The pictures in one row that scrolls sideways as the page scrolls down
 * (sticky + scroll-driven translateX, desktop only; the one pinned section a
 * page may have). Phones get a native scroll-snap rail; motion off gets a
 * still grid. Fewer than 4 pictures draw the mosaic instead (§5.2).
 */
export function GalleryPinned(props: SharedBlockProps) {
  const { block, index, ctx } = props;
  const images = galleryImages(block);
  if (images.length < 4) return <GalleryMosaic {...props} />;
  const id = sectionId(block, index);
  return (
    <section className="mg-pinned" aria-labelledby={text(block.heading) ? id : undefined} data-mg-pinned="">
      <div className="mg-pinned__sticky">
        <div className="mg-pinned__track">
          <div className="mg-pinned__intro">
            <Label>{text(block.eyebrow)}</Label>
            {text(block.heading) ? <h2 id={id}>{text(block.heading)}</h2> : null}
          </div>
          {images.slice(0, 10).map((image, imageIndex) => (
            <figure key={imageIndex}><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes="(min-width: 721px) 40vw, 90vw" /><GalleryCaption image={image} /></figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function GalleryMosaic({ block, index }: SharedBlockProps) {
  const images = galleryImages(block);
  if (!images.length) return null;
  const id = sectionId(block, index);
  return (
    <Blk className="mg-gal-mosaic" labelledBy={text(block.heading) ? id : undefined}>
      <GalleryHead block={block} id={id} />
      <GalleryLightbox images={images.slice(0, 5).map(({ url, alt }) => ({ url, alt }))} className={`mg-mosaic mg-mosaic--n${Math.min(images.length, 5)}`} />
      {images.slice(0, 5).some((image) => image.caption) ? (
        <ol className="mg-gal-caps">
          {images.slice(0, 5).map((image, imageIndex) => image.caption ? <li key={imageIndex} value={imageIndex + 1}><GalleryCaption image={image} as="p" /></li> : null)}
        </ol>
      ) : null}
    </Blk>
  );
}

/** #4453 milestone 5 (§5.2) — the owner's caption and its small line; nothing when there is none. */
function GalleryCaption({ image, as = "figcaption" }: { image: { caption?: string; sub?: string }; as?: "figcaption" | "p" }) {
  if (!image.caption) return null;
  const Tag = as;
  return <Tag className="mg-gal-cap">{image.caption}{image.sub ? <span className="mg-gal-cap__sub">{image.sub}</span> : null}</Tag>;
}

export function GalleryStagger(props: SharedBlockProps) {
  const { block, index, ctx } = props;
  const images = galleryImages(block);
  if (images.length < 3) return <GalleryMosaic {...props} />;
  const id = sectionId(block, index);
  return (
    <Blk className="mg-gal-stagger" labelledBy={text(block.heading) ? id : undefined}>
      <GalleryHead block={block} id={id} />
      <div className="mg-stg">
        {images.slice(0, 3).map((image, imageIndex) => (
          <figure key={imageIndex} className={`mg-stg__s${imageIndex}`} data-mg-rise="">
            <div className="mg-ph"><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes="(min-width: 721px) 33vw, 100vw" /></div>
            <GalleryCaption image={image} />
          </figure>
        ))}
      </div>
    </Blk>
  );
}

/* ---------------- destination_grid: tiles ---------------- */

export function DestinationGridTiles({ block, index, ctx }: SharedBlockProps) {
  const shown: SiteDestination[] = destinations(block, ctx);
  if (!shown.length) return null;
  const id = sectionId(block, index);
  return (
    <Blk className="mg-dests" labelledBy={text(block.heading) ? id : undefined}>
      <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} intro={text(block.intro)}
        extra={<ActionButton label={text(block.cta_label)} href={block.cta_href} className="mg-btn mg-btn--ghost" />} />
      <div className="mg-dgrid">
        {shown.map((destination, destinationIndex) => (
          <Go key={destination.id} href={destinationHref(ctx.artifact, destination.slug)} className={`mg-dest${destinationIndex === 0 ? " mg-dest--big" : ""}`} data-destination={destination.slug}>
            {destination.featured_image && isSafeHref(destination.featured_image.url)
              ? <Photo artifact={ctx.artifact} url={destination.featured_image.url} alt={destination.featured_image.alt} sizes="(min-width: 721px) 50vw, 100vw" />
              : null}
            <span className="mg-dest__b">
              <span><small>Destination guide</small><span className="mg-dest__name">{destination.title}</span></span>
              <span className="mg-circ" aria-hidden="true"><Arrow /></span>
            </span>
          </Go>
        ))}
      </div>
    </Blk>
  );
}
