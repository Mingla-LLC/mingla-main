import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { HeadlineLines, Photo, sectionId, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";

/*
 * #4453 6b — Terra's signature hero (spec §3.2), drawn from the shared role
 * variables and Terra's stylesheet only. It draws every hero field (the
 * field-parity test covers it) and keeps every booking a Mingla action.
 * Class names are prefixed `tr-`.
 */

/** The blob behind the pebble (decorative): one closed path, filled with the design's sage. */
const BLOB = "M421 64c62 34 120 92 128 168 9 78-33 139-71 199-41 64-92 129-170 130-80 1-158-52-206-122C54 368 30 278 66 206 102 132 182 64 268 46c55-11 105-8 153 18z";

/**
 * hero:terra-pebble — the copy beside the art: the label, the headline, a
 * hand-drawn squiggle, the line under it and the buttons; the art is the
 * picture cut as a pebble over a slowly turning sage blob (the design's one
 * signature moment, CSS only, off under reduced motion) and a clay sun.
 * The trip search sits under both when asked for.
 */
export function HeroTerraPebble({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero tr-hero" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap tr-grid">
        <div className="tr-copy">
          {p.eyebrow ? <p className="mg-label" data-mg-in="">{p.eyebrow}</p> : null}
          <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
          <span className="tr-scrawl" aria-hidden="true" />
          {p.subheading ? <p className="tr-lede" data-mg-in="">{p.subheading}</p> : null}
          <HeroButtons ctas={p.ctas} />
        </div>
        <div className="tr-art">
          <svg className="tr-blob" viewBox="0 0 600 600" aria-hidden="true" focusable="false"><path d={BLOB} /></svg>
          <span className="tr-sun" aria-hidden="true" />
          <div className="tr-pebble mg-ph" data-mg-hero-bg="">
            <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 980px) 40vw, 100vw" />
            {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
          </div>
        </div>
      </div>
      {p.search ? <div className="mg-wrap tr-bkline"><TripSearch action={p.search} id={id} /></div> : null}
    </section>
  );
}

export const TERRA_SIGNATURE_BLOCKS = {
  hero: { "terra-pebble": HeroTerraPebble },
} as const;
