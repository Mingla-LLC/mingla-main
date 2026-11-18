import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { HeadlineLines, Photo, sectionId, type SharedBlockProps } from "../../shared/parts";
import { HeroButtons, TripSearch, heroParts } from "../../shared/blocks/Hero";

/*
 * #4453 6c — Pulse's signature hero (spec §3.2), drawn from the shared role
 * variables and Pulse's stylesheet only. It draws every hero field (the
 * field-parity test covers it) and keeps every booking a Mingla action.
 * Class names are prefixed `pl-`.
 */

/**
 * hero:pulse-stage — the stage: the picture in grayscale multiplied through
 * the neon gradient (a duotone), two blurred light orbs that drift (the
 * design's one signature moment: transform only, holding two of the 12
 * animation slots while they move, off under reduced motion and Save-Data),
 * a faint grid, a glass label with an equaliser mark, giant wide capitals,
 * then a ruled row with the line under them and the buttons, and the trip
 * search. The copy zone keeps the shared scrim's floor (contrast §3.8).
 */
export function HeroPulseStage({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero pl-hero mg-on-photo" aria-labelledby={id} data-mg-hero="">
      <div className="pl-bg" data-mg-hero-bg="">
        <Photo artifact={ctx.artifact} url={p.picture} hero sizes="100vw" />
        {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
      </div>
      <span className="pl-tint" aria-hidden="true" />
      <span className="pl-orb pl-orb--1" aria-hidden="true" data-mg-hold="" />
      <span className="pl-orb pl-orb--2" aria-hidden="true" data-mg-hold="" />
      <span className="pl-grid" aria-hidden="true" />
      <div className="mg-wrap pl-inner">
        {p.eyebrow ? (
          <p className="pl-kick" data-mg-in="">
            <span className="pl-eq" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>{p.eyebrow}</span>
          </p>
        ) : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        <div className="pl-row">
          {p.subheading ? <p className="pl-lede" data-mg-in="">{p.subheading}</p> : <span />}
          <HeroButtons ctas={p.ctas} />
        </div>
        {p.search ? <div className="pl-bk"><TripSearch action={p.search} id={id} /></div> : null}
      </div>
    </section>
  );
}

export const PULSE_SIGNATURE_BLOCKS = {
  hero: { "pulse-stage": HeroPulseStage },
} as const;
