import '@/components/cutout/cutout.css'

// Every cutout route family imports the stylesheet from its own layout — the
// tokens live under `[data-cutout]`, not `:root`, so without this the page
// renders with no --cut-* values at all: the shell falls back to its inline
// background and the text inherits the site's dark-surface white, which reads
// as white-on-cream. The build cannot see it; only looking at the page can.
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children
}
