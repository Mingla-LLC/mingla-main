'use client'

import { useEffect, useState } from 'react'

// SHARE-SEMANTIC-ROLE:content-transport

// #4137 — Share: Copy link, WhatsApp, X and (where the device has one) the
// native share sheet. No Instagram button: Instagram has no web share URL.
export function BlogShare({ url, title }: { readonly url: string; readonly title: string }) {
  const [canShare, setCanShare] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function') }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setStatus('Link copied')
    } catch {
      const input = document.getElementById('blog-share-url') as HTMLInputElement | null
      input?.select()
      setStatus('Press Ctrl+C or Cmd+C to copy the link')
    }
  }

  async function shareMore() {
    // SHARE-CONTENT-CALL:transport
    await navigator.share({ title, url })
  }

  const button = 'cut-btn cut-btn-light focus-ring'
  return (
    <div className="blog-share" role="group" aria-label="Share this story">
      <span className="blog-share-label">Share</span>
      <button type="button" className={button} onClick={() => void copy()}>Copy link</button>
      <a className={button} href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className={button} href={`https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`} target="_blank" rel="noopener noreferrer">X</a>
      {canShare ? (
        <button type="button" className={button} onClick={() => { void shareMore().catch(() => undefined) }}>More</button>
      ) : null}
      <input id="blog-share-url" className="sr-live" readOnly value={url} aria-hidden="true" tabIndex={-1} />
      <span className="sr-live" aria-live="polite">{status}</span>
    </div>
  )
}
