import Link from 'next/link'
import { BLOG_CATEGORIES, blogCategoryPath } from '@/content/blog/categories'

// #4137 — All + the four categories. Links, not a client filter, so every tab
// is a real, indexable page. No city filter, ever.
export function BlogCategoryTabs({ active }: { readonly active: string | null }) {
  const tabs = [{ href: '/blog', label: 'All', slug: null as string | null }, ...BLOG_CATEGORIES.map((category) => ({
    href: blogCategoryPath(category.slug), label: category.label, slug: category.slug as string | null,
  }))]
  return (
    <nav aria-label="Blog categories" className="blog-tabs">
      {tabs.map((tab) => {
        const current = tab.slug === active
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={current ? 'cut-btn cut-btn-dark focus-ring' : 'cut-btn cut-btn-light focus-ring'}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
