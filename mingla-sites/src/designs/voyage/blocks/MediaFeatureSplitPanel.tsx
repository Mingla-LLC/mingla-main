/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { Reveal } from "../Reveal";
import { ActionLink, mediaFor, Section, sectionId, srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — media_feature `split-panel`: a heading and a lede beside one
 * photograph in a rounded 5:4 panel, the picture on the side the owner chose
 * (right by default), stacked below 64rem.
 */
export function MediaFeatureSplitPanel({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  const media = mediaFor(ctx.artifact, picture);
  return (
    <Section labelledBy={id}>
      <div className={`v-split${text(block.alignment) === "left" ? " v-split--image-left" : ""}`}>
        <Reveal>
          <div>
            <h2 id={id}>{text(block.heading)}</h2>
            {text(block.caption) ? <p className="lede v-split__lede">{text(block.caption)}</p> : null}
            {text(block.cta_label) && isSafeHref(block.cta_href) ? <div className="v-split__action"><ActionLink label={text(block.cta_label)} href={block.cta_href} /></div> : null}
          </div>
        </Reveal>
        <Reveal delay={1}>
          <div className="media media--panel v-ratio-5-4">
            {picture ? <img src={picture} srcSet={srcSetFor(ctx.artifact, picture)} sizes="(min-width: 1024px) 560px, 92vw" alt={text(block.alt) || media?.alt || ""} loading="lazy" decoding="async" /> : null}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
