import { ExternalLink } from 'lucide-react'
import {
  BLOG_EMBED_PROVIDER_LABELS,
  BLOG_INLINE_FRAME_PROVIDERS,
  blogEmbedFrameSrc,
  blogVideoFrameSrc,
  type EmbedBlock,
  type VideoBlock,
} from '@mingla/blog-document'
import { ClickToLoadFrame, InlineVideoFrame } from './video-embed'

// #4255 (D6) — YouTube and Vimeo players are on the page and play inline;
// Spotify stays click-to-load; Instagram, TikTok and X render as a plain link
// card (no third-party script, ever).
export function VideoBlockView({ block }: { readonly block: VideoBlock }) {
  return <InlineVideoFrame src={blogVideoFrameSrc(block)} title={block.title} />
}

export function EmbedBlockView({ block }: { readonly block: EmbedBlock }) {
  const provider = BLOG_EMBED_PROVIDER_LABELS[block.provider]
  const frame = blogEmbedFrameSrc(block)
  if (frame && BLOG_INLINE_FRAME_PROVIDERS.has(block.provider)) {
    return <InlineVideoFrame src={frame} title={`${provider} video`} />
  }
  if (frame) {
    return (
      <ClickToLoadFrame
        src={frame}
        title={`${provider} embed`}
        label={`Load ${provider}`}
        audio={block.provider === 'spotify'}
      />
    )
  }
  let host = ''
  try { host = new URL(block.url).hostname } catch { return null }
  return (
    <a href={block.url} target="_blank" rel="noopener noreferrer" className="blog-linkcard focus-ring" data-blog-block="embed-link">
      <span>
        <strong>Open on {provider}</strong>
        <small>{host}</small>
      </span>
      <ExternalLink aria-hidden="true" size={20} />
    </a>
  )
}
