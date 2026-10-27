import Link from 'next/link'

// #4137 — a post that is not public (or never existed).
export default function BlogPostNotFound() {
  return (
    <section className="blog-error blog-read">
      <h1 className="blog-display" style={{ fontSize: 40, margin: '0 0 16px' }}>This story isn’t available.</h1>
      <p className="blog-empty">It may have been taken down, or the address is wrong. <Link href="/blog">See every story on the blog</Link>.</p>
    </section>
  )
}
