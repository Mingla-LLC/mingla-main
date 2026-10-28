import { ExternalLink } from 'lucide-react'
import { BLOG_EMBED_PROVIDER_LABELS, blogEmbedFrameSrc, blogVideoFrameSrc, type EmbedBlock, type VideoBlock } from '@mingla/blog-document'
import { ClickToLoadFrame } from './video-embed'

// #4137 — Spotify, YouTube and Vimeo load as click-to-load iframes; Instagram,
// TikTok and X render as a plain link card (no third-party script, ever).
export function VideoBlockView({ block }: { readonly block: VideoBlock }) {
  return <ClickToLoadFrame src={blogVideoFrameSrc(block)} title={block.title} label={`Play video: ${block.title}`} />
}

export function EmbedBlockView({ block }: { readonly block: EmbedBlock }) {
  const provider = BLOG_EMBED_PROVIDER_LABELS[block.provider]
  const frame = blogEmbedFrameSrc(block)
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
