import Image from 'next/image'
import type { BlogBlock, BlogDocument, BlogTarget } from '@mingla/blog-document'
import { DeviceCta } from '@/components/cutout/device-cta'
import { blogMediaUrl, type BlogEmbeds, type BlogMediaSize } from '@/lib/blog/data'
import { BlogRichText } from './blog-rich-text'
import { CityCard } from './blocks/city-card'
import { EmbedBlockView, VideoBlockView } from './blocks/embed'
import { OfferingCard } from './blocks/offering-card'
import { PlaceCard } from './blocks/place-card'
import { PlanCard } from './blocks/plan-card'

// #4137 — renders a post's block document. Unknown block types render nothing
// (one server warning), so an older page never breaks on a newer document.

interface RenderContext {
  readonly media: Readonly<Record<string, BlogMediaSize>>
  readonly embeds: BlogEmbeds
  readonly hidePassedEventCards: boolean
}

function mediaImage(ctx: RenderContext, mediaId: string, alt: string, sizes: string) {
  const media = ctx.media[mediaId]
  if (!media) return null
  return <Image src={blogMediaUrl(media.path)} alt={alt} width={media.width} height={media.height} sizes={sizes} />
}

function TargetButton({ label, target }: { readonly label: string; readonly target: BlogTarget }) {
  if (target.kind === 'place' || target.kind === 'offering') {
    return <DeviceCta surface="explorer" location="blog_button" label={label} variant="primary" size="md" />
  }
  const href = target.kind === 'url' ? target.href : target.path
  const external = target.kind === 'url'
  return (
    <a
      href={href}
      className="cut-btn cut-btn-dark h-[2.625rem] px-5 text-[0.9375rem] focus-ring"
      {...(external ? { rel: 'noopener noreferrer', ...(target.newTab ? { target: '_blank' } : {}) } : {})}
    >
      {label}
    </a>
  )
}

function renderBlock(block: BlogBlock, ctx: RenderContext) {
  switch (block.type) {
    case 'paragraph':
      return <p key={block.id}><BlogRichText html={block.html} /></p>
    case 'heading':
      return block.level === 2 ? <h2 key={block.id}>{block.text}</h2> : <h3 key={block.id}>{block.text}</h3>
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      return <List key={block.id}>{block.items.map((item, index) => <li key={index}><BlogRichText html={item} /></li>)}</List>
    }
    case 'quote':
      return (
        <blockquote key={block.id} className="blog-quote">
          <p><BlogRichText html={block.html} /></p>
          {block.cite ? <cite>{block.cite}</cite> : null}
        </blockquote>
      )
    case 'callout':
      return (
        <aside key={block.id} className="blog-callout" data-tone={block.tone}>
          <strong className="blog-callout-label">{block.tone === 'tip' ? 'Tip' : 'Note'}</strong>
          <BlogRichText html={block.html} />
        </aside>
      )
    case 'image': {
      const image = mediaImage(ctx, block.mediaId, block.alt, '(min-width: 900px) 760px, 100vw')
      if (!image) return null
      return <figure key={block.id} className="blog-figure">{image}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>
    }
    case 'gallery':
      return (
        <div key={block.id} className={block.layout === 'pair' ? 'blog-gallery blog-gallery-pair' : 'blog-gallery blog-gallery-grid'}>
          {block.items.map((item, index) => {
            const image = mediaImage(ctx, item.mediaId, item.alt, '(min-width: 900px) 380px, 50vw')
            return image ? <figure key={index}>{image}{item.caption ? <figcaption>{item.caption}</figcaption> : null}</figure> : null
          })}
        </div>
      )
    case 'video':
      return <VideoBlockView key={block.id} block={block} />
    case 'embed':
      return <EmbedBlockView key={block.id} block={block} />
    case 'divider':
      return <hr key={block.id} />
    case 'button':
      return <div key={block.id} className="blog-cta-row"><TargetButton label={block.label} target={block.target} /></div>
    case 'place':
      return <PlaceCard key={block.id} place={ctx.embeds.places[block.placeId]} style={block.style} note={block.note} />
    case 'offering': {
      const mood = block.moodMediaId ? ctx.media[block.moodMediaId] ?? null : null
      return (
        <OfferingCard
          key={block.id}
          facts={ctx.embeds.offerings[block.eventId]}
          displayTitle={block.displayTitle}
          eyebrowCity={block.eyebrowCity}
          mood={mood}
          moodAlt={block.moodAlt}
          moodSrc={mood ? blogMediaUrl(mood.path) : null}
          hidePassed={ctx.hidePassedEventCards}
        />
      )
    }
    case 'plan':
      return <PlanCard key={block.id} title={block.title} stops={block.stops.map((id) => ctx.embeds.places[id])} />
    case 'city':
      return <CityCard key={block.id} citySlug={block.citySlug} />
    default: {
      const unknown = block as { readonly type?: unknown }
      console.warn(`[blog] unknown block type ${String(unknown.type)} skipped`)
      return null
    }
  }
}

export function BlogDocumentView({ document, media, embeds, hidePassedEventCards }: {
  readonly document: BlogDocument
  readonly media: Readonly<Record<string, BlogMediaSize>>
  readonly embeds: BlogEmbeds
  readonly hidePassedEventCards: boolean
}) {
  const ctx: RenderContext = { media, embeds, hidePassedEventCards }
  const blocks = Array.isArray(document?.blocks) ? document.blocks : []
  return <>{blocks.map((block) => renderBlock(block, ctx))}</>
}
