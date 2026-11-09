import Link from 'next/link'
import { BLOG_CATEGORIES, blogCategoryPath } from '@/content/blog/categories'

// #4137 — All + the four categories. Links, not a client filter, so every tab
// is a real, indexable page. No city filter, ever.
// #4339 phase 2b — drawn as the design's chip row (.tabs, components/site/
// pages.css): one row that swipes on a phone and never squashes; the current
// category is the ink chip.
export function BlogCategoryTabs({ active }: { readonly active: string | null }) {
  const tabs = [{ href: '/blog', label: 'All', slug: null as string | null }, ...BLOG_CATEGORIES.map((category) => ({
    href: blogCategoryPath(category.slug), label: category.label, slug: category.slug as string | null,
  }))]
  return (
    <nav aria-label="Blog categories" className="tabs" data-filter-row="">
      {tabs.map((tab) => {
        const current = tab.slug === active
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
