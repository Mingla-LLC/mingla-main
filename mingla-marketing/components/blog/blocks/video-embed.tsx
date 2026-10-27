'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

// #4137 — click-to-load media. No third-party iframe exists until the reader
// asks for it (AC-P9), so a post page loads no YouTube, Vimeo or Spotify code.
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
