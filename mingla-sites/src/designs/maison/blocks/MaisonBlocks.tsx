import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { galleryImages } from "../../shared/data";
import { HeadlineLines, Photo, SecHead, sectionId, text, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";
import { Book, Cover, GridShell, Price, State } from "../../shared/blocks/Offerings";

/*
 * #4453 6a — Maison's three signature layouts (spec §3.2), drawn from the
 * shared role variables and Maison's stylesheet only. Each draws every field
 * its block defines (the field-parity test covers them) and keeps every
 * booking a Mingla action. Class names are prefixed `ms-` so they never
 * collide with another design.
 */

const two = (value: number) => String(value + 1).padStart(2, "0");

/**
 * hero:maison-frame — centred capitals over one large framed photograph that
 * opens slowly from the centre (CSS clip-path, the design's one signature
 * moment, off under reduced motion), then a ruled row: the line under the
 * headline and the buttons, then the trip search when asked for.
 */
export function HeroMaisonFrame({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero ms-hero" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap">
        {p.eyebrow ? <p className="mg-label ms-hero__k" data-mg-in="">{p.eyebrow}</p> : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        <div className="ms-frame" data-ms-frame="">
          <div className="mg-ph" data-mg-hero-bg="">
            <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1240px) 1200px, 100vw" />
            {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
          </div>
        </div>
        {p.subheading || p.ctas.length ? (
          <div className="ms-under">
            {p.subheading ? <p className="ms-lede" data-mg-in="">{p.subheading}</p> : <span />}
            <HeroButtons ctas={p.ctas} />
          </div>
        ) : null}
        {p.search ? <div className="ms-bk"><TripSearch action={p.search} id={id} /></div> : null}
      </div>
    </section>
  );
}

/** offering_grid:maison-rows — one offering at a time: a large picture, a generous text column, sides alternating. */
export function OfferingGridMaisonRows(props: SharedBlockProps) {
  return (
    <GridShell {...props} className="ms-offers">
      {(items) => (
        <div className="ms-rows">
          {items.map((item, itemIndex) => (
            <article key={item.card.id} className="ms-row" data-offering-kind={item.card.kind}>
              <div className="mg-ph ms-row__img" data-mg-rise=""><Cover item={item} sizes="(min-width: 900px) 58vw, 100vw" /></div>
              <div className="ms-row__txt" data-mg-rise="">
                <p className="mg-label">{[two(itemIndex), item.card.destination].filter(Boolean).join(" · ")}</p>
                <h3>{item.card.title}</h3>
                {item.card.summary ? <p className="ms-row__blurb">{item.card.summary}</p> : null}
                <p className="ms-row__meta">{item.card.dates ? <span>{item.card.dates}</span> : null}<State item={item} /></p>
                <div className="ms-row__buy">
                  <Price item={item} className="mg-price" />
                  <Book item={item} ctx={props.ctx} className="mg-btn" />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </GridShell>
  );
}

/** gallery:maison-plates — one wide plate, then an offset pair, each numbered (at most 6 pictures). */
export function GalleryMaisonPlates({ block, index, ctx }: SharedBlockProps) {
  const images = galleryImages(block).slice(0, 6);
  if (!images.length) return null;
  const id = sectionId(block, index);
  return (
    <section className="mg-blk ms-gal" aria-labelledby={text(block.heading) ? id : undefined}>
      <div className="mg-wrap">
        <SecHead id={id} eyebrow={text(block.eyebrow)} heading={text(block.heading)} />
        <div className="ms-plates">
          {images.map((image, imageIndex) => (
            <figure key={imageIndex} className={`ms-plate ms-plate--${imageIndex % 3}`} data-mg-rise="">
              <div className="mg-ph"><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes={imageIndex % 3 === 0 ? "(min-width: 1240px) 1200px, 100vw" : "(min-width: 900px) 50vw, 100vw"} /></div>
              <figcaption><span className="ms-plate__n">{two(imageIndex)}</span>{image.alt ? <span>{image.alt}</span> : null}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export const MAISON_SIGNATURE_BLOCKS = {
  hero: { "maison-frame": HeroMaisonFrame },
  offering_grid: { "maison-rows": OfferingGridMaisonRows },
  gallery: { "maison-plates": GalleryMaisonPlates },
} as const;
