'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { SitePage } from '@/components/site/site-page'

// #4137 — the blog's data could not be read. Says so; never shows made-up
// stories in their place.
//
// #4339 — the blog index, the categories (phase 2b) and the posts (phase 2c)
// render without app/blog/layout.tsx's old frame, so on those paths the error
// brings the site nav and the canonical footer itself. The staff preview keeps
// the layout's frame, so it gets the bare section.
export default function BlogError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  const pathname = usePathname()
  useEffect(() => { console.error('[blog] page failed to load', error) }, [error])
  const section = (
    <section className="blog-error blog-read" role="alert">
      <h1 className="blog-display" style={{ fontSize: 40, margin: '0 0 16px' }}>Stories didn’t load.</h1>
      <p className="blog-empty">
        Stories didn’t load. Try again in a minute.{' '}
        <a href="#retry" onClick={(event) => { event.preventDefault(); reset() }}>Retry</a>
      </p>
    </section>
  )
  if (pathname?.startsWith('/blog/preview/')) return section
  return (
    <SitePage surface="explorer">
      <div className="blog-post">{section}</div>
    </SitePage>
  )
}
