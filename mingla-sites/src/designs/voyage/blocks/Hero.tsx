/* eslint-disable @next/next/no-img-element -- the cover photograph is the site's own first-party, immutable media. */
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { HeroBackgroundVideo } from "../../../components/v2/HeroBackgroundVideo";
import { playableVideoUrl } from "../../../lib/siteVideo";
import { collectionIndexPath } from "../routing";
import { BtnIcon, mediaFor, rows, SiteLink, srcSetFor, text, type VoyageBlockProps } from "../parts";
import { TripFilters } from "./TripFilters";

/*
 * #2829 W7 — hero `cover-bottom-search`: a full-viewport cover photograph
 * (or the owner's background film over it, poster first) under a raked
 * scrim, the copy anchored bottom-left: an optional script eyebrow, the
 * headline set line by line (each line rises out of a mask), the line under
 * it, and the trip search when the owner asked for it and the site has a
 * trips page to search.
 */
export function Hero({ block, index, ctx }: VoyageBlockProps) {
  const { artifact } = ctx;
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  const media = mediaFor(artifact, picture);
  const film = picture ? playableVideoUrl(artifact, block.video_url) : null;
  const lines = rows(block.heading_lines).map((row) => text(row.text)).filter(Boolean);
  const headline = lines.length ? lines : [text(block.heading)];
  const ctas = rows(block.ctas)
    .map((cta) => ({ label: text(cta.label), href: cta.href }))
    .filter((cta): cta is { label: string; href: string } => Boolean(cta.label) && isSafeHref(cta.href))
    .slice(0, 2);
  const searchAction = block.show_search === true ? collectionIndexPath(artifact, "trips") : null;
  const Heading = index === ctx.page.blocks.findIndex((candidate) => candidate.type === "hero") ? "h1" : "h2";
  return (
    <section className={`cover cover--bottom on-photo v-cover${film ? " has-video" : ""}`}>
      {picture ? (
        <img src={picture} srcSet={srcSetFor(artifact, picture)} alt={media?.alt ?? ""} width={media?.width} height={media?.height} sizes="100vw" className="v-cover__img v-cover__img--hero photo-header" fetchPriority="high" decoding="sync" />
      ) : <div className="v-cover__ground" />}
      {film && picture ? <HeroBackgroundVideo src={film} poster={picture} saveData={ctx.saveData} /> : null}
      <span aria-hidden="true" className="scrim-hero v-behind" />
      <span aria-hidden="true" className="scrim-hero-text v-behind" />
      <div className="shell v-hero__shell">
        <div className="v-hero__copy">
          {text(block.eyebrow) ? <p className="eyebrow hero-enter v-hero__eyebrow" style={{ ["--enter-delay" as string]: "80ms" }}>{text(block.eyebrow)}</p> : null}
          <Heading className="v-hero__title">
            {headline.map((line, lineIndex) => (
              <span key={lineIndex} className="line-mask">
                <span className="v-block" style={{ ["--line-index" as string]: String(lineIndex) }}>{line}</span>
              </span>
            ))}
          </Heading>
          {text(block.subheading) ? <p className="lede hero-enter v-on-photo-lede v-hero__lede" style={{ ["--enter-delay" as string]: "340ms" }}>{text(block.subheading)}</p> : null}
          {ctas.length ? (
            <div className="hero-enter v-hero__ctas" style={{ ["--enter-delay" as string]: "420ms" }}>
              {ctas.map((cta, ctaIndex) => (
                <SiteLink key={ctaIndex} href={cta.href} className={ctaIndex === 0 ? "btn btn--primary btn--lg btn--on-photo" : "btn btn--on-teal btn--lg"}>{cta.label}<BtnIcon /></SiteLink>
              ))}
            </div>
          ) : null}
          {searchAction ? <TripFilters variant="hero" action={searchAction} /> : null}
        </div>
      </div>
    </section>
  );
}
