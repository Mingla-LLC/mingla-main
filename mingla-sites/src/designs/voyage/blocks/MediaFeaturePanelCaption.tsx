/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import { isSafeHref } from "../../../contracts/generated/safety.ts";
import { mediaFor, Section, srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — media_feature `panel-caption`: one wide photograph in a rounded
 * panel with its caption centred beneath. Nothing is drawn without a picture.
 */
export function MediaFeaturePanelCaption({ block, ctx }: VoyageBlockProps) {
  const picture = isSafeHref(block.media_url) ? String(block.media_url) : null;
  if (!picture) return null;
  const media = mediaFor(ctx.artifact, picture);
  const caption = text(block.caption) || text(block.heading);
  return (
    <Section>
      <figure>
        <div className="media media--panel">
          <img src={picture} srcSet={srcSetFor(ctx.artifact, picture)} sizes="(min-width: 1240px) 1160px, 92vw" alt={text(block.alt) || media?.alt || ""} width={media?.width} height={media?.height} loading="lazy" decoding="async" />
        </div>
        {caption ? <figcaption className="meta v-figcaption">{caption}</figcaption> : null}
      </figure>
    </Section>
  );
}
