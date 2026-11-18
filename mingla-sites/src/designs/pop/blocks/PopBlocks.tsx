import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { galleryImages } from "../../shared/data";
import { HeadlineLines, Photo, sectionId, type SharedBlock, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";

/*
 * #4453 6c — Pop's signature hero (spec §3.2), drawn from the shared role
 * variables and Pop's stylesheet only. It draws every hero field (the
 * field-parity test covers it) and keeps every booking a Mingla action.
 * Class names are prefixed `pp-`.
 */

/**
 * Up to two supporting photos for the sticker stack: the page's own gallery
 * pictures (real, approved media with their alt text), never the hero's
 * picture again. None on a page without a gallery: the stack is then the
 * hero picture alone.
 */
function stickerPhotos(blocks: readonly unknown[], hero: string | null): Array<{ url: string; alt: string }> {
  const out: Array<{ url: string; alt: string }> = [];
  for (const raw of blocks) {
    const block = raw as SharedBlock;
    if (block.type !== "gallery") continue;
    for (const image of galleryImages(block)) {
      if (image.url !== hero && !out.some((seen) => seen.url === image.url)) out.push(image);
      if (out.length === 2) return out;
    }
  }
  return out;
}

/**
 * hero:pop-stack — the copy (a sticker label, the chunky headline with the
 * last line on a highlighter, the line under it, the buttons) beside a
 * scatter of tilted photo stickers with hard offset shadows; two soft
 * colour blobs and a dot screen behind. The trip search sits under both.
 */
export function HeroPopStack({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  const extras = stickerPhotos(ctx.page.blocks, p.picture);
  return (
    <section className="mg-hero pp-hero" aria-labelledby={id} data-mg-hero="">
      <span className="pp-blob pp-blob--1" aria-hidden="true" />
      <span className="pp-blob pp-blob--2" aria-hidden="true" />
      <div className="mg-wrap">
        <div className="pp-grid">
          <div className="pp-copy">
            {p.eyebrow ? <p className="pp-kick" data-mg-in="">{p.eyebrow}</p> : null}
            <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
            {p.subheading ? <p className="pp-lede" data-mg-in="">{p.subheading}</p> : null}
            <HeroButtons ctas={p.ctas} />
          </div>
          <div className={`pp-stack pp-stack--n${extras.length + 1}`}>
            <figure className="pp-card pp-card--0">
              <div className="mg-ph" data-mg-hero-bg="">
                <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1000px) 30vw, 70vw" />
                {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
              </div>
            </figure>
            {extras.map((image, imageIndex) => (
              <figure key={image.url} className={`pp-card pp-card--${imageIndex + 1}`}>
                <div className="mg-ph"><Photo artifact={ctx.artifact} url={image.url} alt={image.alt} sizes="(min-width: 1000px) 20vw, 45vw" /></div>
                {image.alt ? <figcaption>{image.alt}</figcaption> : null}
              </figure>
            ))}
          </div>
        </div>
        {p.search ? <div className="pp-book"><TripSearch action={p.search} id={id} /></div> : null}
      </div>
    </section>
  );
}

export const POP_SIGNATURE_BLOCKS = {
  hero: { "pop-stack": HeroPopStack },
} as const;
