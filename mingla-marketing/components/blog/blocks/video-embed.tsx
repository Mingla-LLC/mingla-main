'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { BLOG_VIDEO_FRAME_ALLOW } from '@mingla/blog-document'

// #4255 (D6) — a YouTube or Vimeo player is on the page when the post opens
// and plays inline where it sits. loading="lazy" keeps a player below the fold
// from loading until the reader scrolls near it; the frame is 16:9 (.blog-video).
export function InlineVideoFrame({ src, title }: {
  readonly src: string
  readonly title: string
}) {
  return (
    <div className="blog-video" data-blog-block="media" data-blog-frame="inline">
      <iframe
        src={src}
        title={title}
        allow={BLOG_VIDEO_FRAME_ALLOW}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

// #4137 — click-to-load media, now only for audio embeds (Spotify): no
// third-party frame exists until the reader asks for it.
export function ClickToLoadFrame({ src, title, label, audio = false }: {
  readonly src: string
  readonly title: string
  readonly label: string
  readonly audio?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={audio ? 'blog-video blog-video-audio' : 'blog-video'} data-blog-block="media">
      {open ? (
        <iframe
          src={src}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="blog-video-facade focus-ring" onClick={() => setOpen(true)}>
          <span className="blog-play" aria-hidden="true"><Play size={28} fill="currentColor" /></span>
          {label}
        </button>
      )}
    </div>
  )
}
