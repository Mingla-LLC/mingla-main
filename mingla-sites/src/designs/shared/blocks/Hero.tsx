import type { RichTextDoc } from "../../../contracts/generated/richText.ts";
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { RichText } from "../../../components/v2/RichText";
import { SiteSearchForm } from "../../../components/PreviewLinks";
import { playableVideoUrl } from "../../../lib/siteVideo";
import { hrefForPage, sitePages } from "../../../lib/pageRouting";
import { ActionButton, Arrow, Blk, HeadlineLines, Label, Photo, rows, sectionId, text, type SharedBlockProps, type SharedContext } from "../parts";

/*
 * #4453 §3.3 — the three shared hero layouts. Each draws every hero field:
 * the label line, the headline line by line, the line under it, up to two
 * buttons, the picture (eager, fetchpriority high), the owner's background
 * film over it, and the trip search when the owner asked for it and the
 * site has a trips page. Fields are blank by default (real input types);
 * nothing is pre-filled. Only the page's first hero is its h1.
 */

export function heroParts(block: SharedBlockProps["block"], index: number, ctx: SharedContext) {
  const lines = rows(block.heading_lines).map((row) => text(row.text)).filter(Boolean);
  const ctas = rows(block.ctas)
    .map((cta) => ({ label: text(cta.label), href: cta.href }))
    .filter((cta) => cta.label && isSafeHref(cta.href))
    .slice(0, 2);
  const tripsPage = sitePages(ctx.artifact).find((page) => page.enabled && page.kind === "collection_index" && page.collection === "trips");
  const search = block.show_search === true && tripsPage ? hrefForPage(tripsPage) : null;
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  const film = picture ? playableVideoUrl(ctx.artifact, block.video_url) : null;
  const firstHero = index === ctx.page.blocks.findIndex((candidate) => candidate.type === "hero");
  return {
    lines: lines.length ? lines : [text(block.heading)],
    heading: text(block.heading),
    eyebrow: text(block.eyebrow),
    subheading: text(block.subheading),
    ctas,
    search,
    picture,
    film,
    as: firstHero ? ("h1" as const) : ("h2" as const),
  };
}

/** The trip search: where, from and to, blank, submitted to the site's own trips page. */
export function TripSearch({ action, id }: { action: string; id: string }) {
  return (
    <SiteSearchForm action={action} className="mg-bk" aria-label="Search trips" data-mg-in="">
      <label htmlFor={`${id}-where`}><span className="mg-bk__k">Where</span><input id={`${id}-where`} name="where" type="search" maxLength={80} /></label>
      <label htmlFor={`${id}-from`}><span className="mg-bk__k">From</span><input id={`${id}-from`} name="from" type="date" /></label>
      <label htmlFor={`${id}-to`}><span className="mg-bk__k">To</span><input id={`${id}-to`} name="to" type="date" /></label>
      <button type="submit" className="mg-btn"><span>Search</span><Arrow /></button>
    </SiteSearchForm>
  );
}

export function HeroButtons({ ctas }: { ctas: Array<{ label: string; href: unknown }> }) {
  if (!ctas.length) return null;
  return (
    <div className="mg-hero__acts" data-mg-in="">
      {ctas.map((cta, ctaIndex) => <ActionButton key={ctaIndex} label={cta.label} href={cta.href} className={ctaIndex === 0 ? "mg-btn mg-btn--accent" : "mg-btn mg-btn--ghost"} />)}
    </div>
  );
}

export function HeroFullbleed({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero mg-hero-full mg-on-photo" aria-labelledby={id} data-mg-hero="">
      <div className="mg-hero__bg" data-mg-hero-bg="">
        <Photo artifact={ctx.artifact} url={p.picture} hero sizes="100vw" />
        {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
      </div>
      <div className="mg-wrap mg-hero__inner">
        {p.eyebrow ? <p className="mg-label mg-kicker" data-mg-in="">{p.eyebrow}</p> : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        <div className="mg-hero__row">
          <div className="mg-hero__main">
            {p.subheading ? <p className="mg-lede" data-mg-in="">{p.subheading}</p> : null}
            <HeroButtons ctas={p.ctas} />
            {p.search ? <TripSearch action={p.search} id={id} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroEditorial({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero mg-hero-ed mg-on-photo" aria-labelledby={id} data-mg-hero="">
      <div className="mg-hero__bg" data-mg-hero-bg="">
        <Photo artifact={ctx.artifact} url={p.picture} hero sizes="100vw" />
        {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
      </div>
      <div className="mg-wrap mg-hero__inner">
        {p.eyebrow ? <p className="mg-label" data-mg-in="">{p.eyebrow}</p> : null}
        <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
        <div className="mg-hero-ed__foot">
          {p.subheading ? <p className="mg-lede" data-mg-in="">{p.subheading}</p> : <span />}
          <HeroButtons ctas={p.ctas} />
        </div>
        {p.search ? <div className="mg-hero-ed__bk"><TripSearch action={p.search} id={id} /></div> : null}
      </div>
    </section>
  );
}

export function HeroArch({ block, index, ctx }: SharedBlockProps) {
  const p = heroParts(block, index, ctx);
  const id = sectionId(block, index);
  return (
    <section className="mg-hero mg-hero-arch" aria-labelledby={id} data-mg-hero="">
      <div className="mg-wrap">
        <div className="mg-hero-arch__top">
          <div>
            {p.eyebrow ? <p className="mg-label" data-mg-in="">{p.eyebrow}</p> : null}
            <HeadlineLines lines={p.lines} heading={p.heading} as={p.as} id={id} />
          </div>
          <div className="mg-hero-arch__side">
            {p.subheading ? <p className="mg-lede" data-mg-in="">{p.subheading}</p> : null}
            <HeroButtons ctas={p.ctas} />
          </div>
        </div>
        <div className="mg-hero-arch__arch" data-mg-arch="">
          <div className="mg-ph" data-mg-hero-bg="">
            <Photo artifact={ctx.artifact} url={p.picture} hero sizes="(min-width: 1320px) 1280px, 100vw" />
            {p.film && p.picture ? <HeroBackgroundVideo src={p.film} poster={p.picture} saveData={ctx.saveData} /> : null}
          </div>
        </div>
        {p.search ? <div className="mg-hero-arch__bk"><TripSearch action={p.search} id={id} /></div> : null}
      </div>
    </section>
  );
}

/* ---------------- marquee: ticker ---------------- */

/**
 * The owner's phrases on a moving strip. The strip is decorative (aria-hidden)
 * and repeated once for the loop; the phrases are also a real list for
 * assistive tech. It pauses on hover and focus; reduced motion and
 * `motion: none` show a still, wrapping list.
 */
export function MarqueeTicker({ block }: SharedBlockProps) {
  const phrases = rows(block.phrases).map((row) => text(row.text)).filter(Boolean);
  if (phrases.length < 2) return null;
  const run = (hidden: boolean) => (
    <span className="mg-mq__run" aria-hidden={hidden ? "true" : undefined}>
      {phrases.map((phrase, phraseIndex) => <span key={phraseIndex} className="mg-mq__it">{phrase}<em className="mg-mq__dot" aria-hidden="true" /></span>)}
    </span>
  );
  return (
    <div className="mg-mq" data-mg-marquee="" tabIndex={0} role="region" aria-label="Highlights">
      <ul className="mg-sr">{phrases.map((phrase, phraseIndex) => <li key={phraseIndex}>{phrase}</li>)}</ul>
      <div className="mg-mq__track" aria-hidden="true">{run(true)}{run(true)}</div>
    </div>
  );
}

/* ---------------- rich_text: manifesto ---------------- */

/**
 * The owner's writing set large, one statement. Words light up as they
 * scroll past on desktop (scroll-driven opacity); with motion off every word
 * is at full strength.
 */
export function RichTextManifesto({ block, index }: SharedBlockProps) {
  const id = sectionId(block, index);
  const heading = text(block.heading);
  return (
    <Blk className={`mg-manifesto${text(block.width) === "full" ? " mg-manifesto--full" : ""}`} labelledBy={heading ? id : undefined}>
      <Label>{text(block.eyebrow)}</Label>
      {heading ? <h2 id={id} className="mg-manifesto__h">{heading}</h2> : null}
      <div className="mg-manifesto__big" data-mg-words=""><RichText doc={block.body as RichTextDoc} /></div>
    </Blk>
  );
}
