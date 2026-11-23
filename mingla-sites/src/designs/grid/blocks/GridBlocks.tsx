import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { HeadlineLines, Photo, sectionId, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, HeroFullbleed, TripSearch, heroParts } from "../../shared/blocks/Hero";

/*
 * #4453 6b — Grid's signature hero (spec §3.2), drawn from the shared role
 * variables and Grid's stylesheet only. It draws every hero field (the
 * field-parity test covers it) and keeps every booking a Mingla action.
 * Class names are prefixed `gr-`.
 */

/**
 * hero:grid-index — the index sheet, type first: the label on a ruled row,
 * the headline in heavy capitals, the trip search when asked for, then a
 * 12-column row: the picture across eight columns (monochrome until hover)
 * and an aside with the line under the headline, the buttons and, when the
 * site has one, where it is (the footer's location: real data, never typed
 * here).
 */
export function HeroGridIndex({ block, index, ctx }: SharedBlockProps) {
  // #4575 — with Grid's full-screen cover on, every index-sheet hero draws as the full-screen photo.
  if (ctx.artifact.design.options?.cover === "full") return <HeroFullbleed block={block} index={index} ctx={ctx} />;
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  const place = ctx.artifact.footer.location;
  return (
    <section className="mg-hero gr-hero" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap">
        {p.eyebrow ? <div className="gr-top" data-mg-in=""><p className="mg-label">{p.eyebrow}</p></div> : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        {p.search ? <div className="gr-book"><TripSearch action={p.search} id={id} /></div> : null}
        <div className="gr-row">
          <div className="gr-img mg-ph" data-mg-hero-bg="">
            <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1000px) 66vw, 100vw" />
            {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
          </div>
          <div className="gr-side">
            {p.subheading ? <p className="gr-lede" data-mg-in="">{p.subheading}</p> : null}
            {p.ctas.length ? <div className="gr-acts"><HeroButtons ctas={p.ctas} /></div> : null}
            {place ? <dl className="gr-rows" data-mg-in=""><div><dt>Where</dt><dd>{place}</dd></div></dl> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export const GRID_SIGNATURE_BLOCKS = {
  hero: { "grid-index": HeroGridIndex },
} as const;
