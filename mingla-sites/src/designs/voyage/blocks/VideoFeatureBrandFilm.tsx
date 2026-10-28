import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { playableVideoUrl } from "../../../lib/siteVideo";
import { VoyageBrandFilm } from "../VoyageBrandFilm";
import { Section, SectionHead, sectionId, srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — video_feature `brand-film`: the film at shell width in a
 * rounded 16:9 panel, click to play with controls. Nothing at all without a
 * still (missing is hidden, never faked). The poster is offered uncropped
 * (W7c): the 4:3 crops would cut the sides off a picture in a 16:9 panel.
 */
export function VideoFeatureBrandFilm({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  if (!isSafeHref(block.poster_url)) return null;
  const heading = text(block.heading);
  const label = heading ? `Play: ${heading}` : `Play the ${ctx.artifact.brand.display_name} film`;
  return (
    <Section labelledBy={heading ? id : undefined}>
      {heading ? <SectionHead id={id} heading={heading} intro={text(block.caption)} standalone /> : null}
      <VoyageBrandFilm src={playableVideoUrl(ctx.artifact, block.video_url)} poster={String(block.poster_url)} posterSrcSet={srcSetFor(ctx.artifact, block.poster_url, { uncropped: true })} label={label} />
    </Section>
  );
}
