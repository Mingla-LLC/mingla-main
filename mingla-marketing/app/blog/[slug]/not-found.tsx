import Link from 'next/link'
import { SitePage } from '@/components/site/site-page'

// #4137 — a post that is not public (or never existed).
//
// #4339 phase 2c — posts render without the blog layout's old frame, so this
// page brings the site nav and the canonical footer itself.
export default function BlogPostNotFound() {
  return (
    <SitePage surface="explorer">
      <div className="blog-post">
        <section className="blog-error blog-read">
          <h1 className="blog-display" style={{ fontSize: 40, margin: '0 0 16px' }}>This story isn’t available.</h1>
          <p className="blog-empty">It may have been taken down, or the address is wrong. <Link href="/blog">See every story on the blog</Link>.</p>
        </section>
      </div>
    </SitePage>
  )
}
