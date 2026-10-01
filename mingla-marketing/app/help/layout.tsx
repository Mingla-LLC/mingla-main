import '@/components/cutout/cutout.css'

// Every cutout route family imports the stylesheet from its own layout — the
// tokens live under `[data-cutout]`, not `:root`, so without this the page
// renders with no --cut-* values at all: the shell falls back to its inline
// background and the text inherits the site's dark-surface white, which reads
// as white-on-cream. The build cannot see it; only looking at the page can.
//
// The <main> landmark matters twice: it is the skip-link target, and
// scripts/verify-search-foundation.mjs measures a search-ready page's body
// text by what is inside it — no <main>, no measurable content, and the route
// fails the search contract even though the page is full of copy.
//
// `data-allow-copy` (#3431) opts Help out of the site-wide copy protection so
// support agents can select and copy the steps; every other page stays locked.
export default function HelpLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <main id="main" data-allow-copy="">
      {children}
    </main>
  )
}
