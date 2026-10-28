/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { formatCalendarDay, type SiteStory } from "../../../contracts/generated/collections.ts";
import type { RichTextDoc } from "../../../contracts/generated/richText.ts";
import { RichText } from "../../../components/v2/RichText";
import { srcSetFor } from "../parts";

/*
 * #2829 W7 — the voyage story page: a centred cover (the script eyebrow
 * "<category> · <Month D, YYYY>", the title, the excerpt) over the story's
 * picture, then the story in the reading column.
 */
export function StoryTemplate({ story, artifact }: { story: SiteStory; artifact: ArtifactV2 }) {
  const category = story.category ? artifact.collections.categories.find((row) => row.slug === story.category) : undefined;
  const image = story.featured_image;
  return (
    <article data-story={story.slug}>
      <header className="cover cover--center on-photo v-cover v-cover--header v-cover--entry">
        {image ? (
          <>
            <img src={image.url} srcSet={srcSetFor(artifact, image.url)} alt="" aria-hidden="true" sizes="100vw" className="v-cover__img v-cover__img--header photo-header" fetchPriority="high" decoding="sync" />
            <span aria-hidden="true" className="scrim-header v-behind" />
          </>
        ) : null}
        <div className="shell v-center v-story-head">
          <p className="eyebrow v-story-eyebrow">
            {category ? <>{category.title}<span className="v-story-eyebrow__date">{" · "}</span></> : null}
            <time dateTime={story.published_at} className="v-story-eyebrow__date">{formatCalendarDay(story.published_at, artifact.language)}</time>
          </p>
          <h1 className="v-story-title">{story.title}</h1>
          {story.excerpt ? <p className="lede v-on-photo-lede v-story-lede">{story.excerpt}</p> : null}
        </div>
      </header>
      <div className="band">
        <div className="shell">
          <div className="prose v-prose-center"><RichText doc={story.content as RichTextDoc} /></div>
        </div>
      </div>
    </article>
  );
}
