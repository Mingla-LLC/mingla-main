'use client'

import { useEffect } from 'react'

// #4137 — the blog's data could not be read. Says so; never shows made-up
// stories in their place.
export default function BlogError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => { console.error('[blog] page failed to load', error) }, [error])
  return (
    <section className="blog-error blog-read" role="alert">
      <h1 className="blog-display" style={{ fontSize: 40, margin: '0 0 16px' }}>Stories didn’t load.</h1>
      <p className="blog-empty">
        Stories didn’t load. Try again in a minute.{' '}
        <a href="#retry" onClick={(event) => { event.preventDefault(); reset() }}>Retry</a>
      </p>
    </section>
  )
}
