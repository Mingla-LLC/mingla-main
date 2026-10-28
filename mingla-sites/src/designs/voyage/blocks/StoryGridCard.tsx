/* eslint-disable @next/next/no-img-element -- site media is served first-party and immutable from /media. */
import Link from "next/link";
import { formatCalendarDay, storiesNewestFirst } from "../../../contracts/generated/collections.ts";
import { isManuallyOrdered } from "../../../contracts/generated/artifactV2.ts";
import { storyHref } from "../../../lib/siteCollections";
import { Reveal } from "../Reveal";
import { Arrow, gridSizes, HeadRow, Section, sectionId, srcSetFor, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — story_grid `card`: stories newest first as padded cards (16:10
 * picture, category chip and date, title, excerpt, "Read story"), on a
 * tinted band. The whole card is the link; a lone story lies on its side
 * from 48rem.
 */
export function StoryGridCard({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const { artifact } = ctx;
  const category = text(block.category) || null;
  const limit = typeof block.limit === "number" ? block.limit : 3;
  const categories = new Map(artifact.collections.categories.map((row) => [row.slug, row.title]));
  const stories = storiesNewestFirst(artifact.collections.stories, isManuallyOrdered(artifact, "stories"))
    .filter((story) => category === null || story.category === category)
    .slice(0, limit);
  if (!stories.length) return null;
  return (
    <Section tinted labelledBy={id}>
      <HeadRow id={id} heading={text(block.heading) || undefined} intro={text(block.intro)} link={{ label: text(block.cta_label), href: block.cta_href }} />
      <div className="grid-cards">
        {stories.map((story, storyIndex) => {
          const categoryTitle = story.category ? categories.get(story.category) : undefined;
          return (
            <Reveal key={story.id} delay={storyIndex}>
              <article className="card card--interactive card--padded v-card" data-story={story.slug}>
                <Link href={storyHref(artifact, story.slug)}>
                  {story.featured_image ? (
                    <div className="media media--flush v-ratio-16-10">
                      <img src={story.featured_image.url} srcSet={srcSetFor(artifact, story.featured_image.url)} sizes={gridSizes(stories.length)} alt={story.featured_image.alt} loading="lazy" decoding="async" />
                    </div>
                  ) : <div className="media media--flush v-ratio-16-10" />}
                  <div className="v-story__body">
                    <p className="v-story__kicker">
                      {categoryTitle ? <span className="chip-category">{categoryTitle}</span> : null}
                      <time dateTime={story.published_at} className="meta tnum">{formatCalendarDay(story.published_at, artifact.language)}</time>
                    </p>
                    <h3 className="card__title v-clamp-2 v-story__title">{story.title}</h3>
                    {story.excerpt ? <p className="card__body v-clamp-3 v-story__excerpt">{story.excerpt}</p> : null}
                    <span className="v-story__more">Read story<Arrow size={15} className="card__arrow" /></span>
                  </div>
                </Link>
              </article>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
