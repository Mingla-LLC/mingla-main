import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { HeadlineLines, Photo, sectionId, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";

/*
 * #4453 6c — Sunset's signature hero (spec §3.2), drawn from the shared role
 * variables and Sunset's stylesheet only. It draws every hero field (the
 * field-parity test covers it) and keeps every booking a Mingla action.
 * Class names are prefixed `ss-`.
 */

/**
 * hero:sunset-sun — the copy (a sticker label, the headline with its last
 * line in the groovy accent face, the line under it, the buttons) beside a
 * retro sun: the picture in a striped disc inside mustard, orange and
 * tomato rings, with rays turning very slowly behind (the design's one
 * signature moment, CSS only, off under reduced motion and Save-Data). The
 * trip search and three sunset stripes close the hero.
 */
export function HeroSunsetSun({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero ss-hero" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap ss-grid">
        <div className="ss-copy">
          {p.eyebrow ? <p className="ss-kick" data-mg-in="">{p.eyebrow}</p> : null}
          <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
          {p.subheading ? <p className="ss-lede" data-mg-in="">{p.subheading}</p> : null}
          <HeroButtons ctas={p.ctas} />
        </div>
        <div className="ss-sun">
          <span className="ss-rays" aria-hidden="true" data-mg-hold="" />
          <span className="ss-rings" aria-hidden="true" />
          <div className="ss-disc mg-ph" data-mg-hero-bg="">
            <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1000px) 40vw, 90vw" />
            {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
          </div>
        </div>
      </div>
      {p.search ? <div className="mg-wrap ss-bk"><TripSearch action={p.search} id={id} /></div> : null}
      <div className="ss-stripes" aria-hidden="true"><i /><i /><i /></div>
    </section>
  );
}

export const SUNSET_SIGNATURE_BLOCKS = {
  hero: { "sunset-sun": HeroSunsetSun },
} as const;
