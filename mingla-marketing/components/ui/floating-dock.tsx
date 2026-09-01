'use client'
import { useRef, useState, type ReactNode } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// #2902 — Floating dock (Aceternity pattern), adapted to Mingla's stack.
//
// THREE DELIBERATE DEVIATIONS from the supplied snippet, each to avoid
// shipping a duplicate of something the repo already has:
//
//   1. `motion/react` → `framer-motion`. `motion` IS framer-motion under its
//      newer name. This app already depends on framer-motion@11, and both
//      packages ship the same engine — installing `motion` alongside it would
//      put two copies of the animation runtime in the bundle for no gain.
//      Every hook used here (useMotionValue / useSpring / useTransform /
//      AnimatePresence / MotionValue) exists in v11 under the same names.
//   2. `@tabler/icons-react` → `lucide-react`. Already a dependency, already
//      the icon set used across this codebase, and the integration notes
//      explicitly allow lucide. A second icon library is pure weight.
//   3. `@/lib/utils` → `@/lib/cn`. That is where this repo's `cn` lives.
//
// Styling is re-tinted to the Cutout system: the dock is a moulded surface
// like every other card, not the default gray-50 / neutral-900.
//
// Accessibility additions over the snippet: the dock is a real <nav> with a
// labelled list, each item is a link with an accessible name (the icon alone
// is not one), and the magnification is skipped for reduced-motion users.
// ---------------------------------------------------------------

export interface DockItem {
  title: string
  icon: ReactNode
  href: string
  /** Marks the current page for aria-current and a persistent active tint. */
  active?: boolean
}

export function FloatingDock({
  items,
  desktopClassName,
  mobileClassName,
  label = 'Primary',
}: {
  items: DockItem[]
  desktopClassName?: string
  mobileClassName?: string
  label?: string
}) {
  return (
    <>
      <FloatingDockDesktop items={items} className={desktopClassName} label={label} />
      <FloatingDockMobile items={items} className={mobileClassName} label={label} />
    </>
  )
}

/**
 * Mobile: the dock itself, pinned by the caller. Per Seth — the mobile menu is
 * the same dock, at the bottom of the screen, not a hamburger sheet.
 */
function FloatingDockMobile({
  items,
  className,
  label,
}: {
  items: DockItem[]
  className?: string
  label: string
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'cut-card flex items-end gap-1.5 rounded-full px-3 py-2 md:hidden',
        className,
      )}
    >
      {items.map((item) => (
        <a
          key={item.title}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors focus-ring',
            item.active
              ? 'cut-btn cut-btn-brand text-white'
              : 'text-[var(--cut-body)] hover:text-[var(--cut-ink)]',
          )}
        >
          <span className="h-5 w-5">{item.icon}</span>
          <span className="sr-only">{item.title}</span>
        </a>
      ))}
    </nav>
  )
}

function FloatingDockDesktop({
  items,
  className,
  label,
}: {
  items: DockItem[]
  className?: string
  label: string
}) {
  const mouseX = useMotionValue(Infinity)
  return (
    <nav
      aria-label={label}
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        'mx-auto hidden h-14 items-end gap-3 rounded-full px-4 pb-2.5 md:flex',
        className,
      )}
      style={{ background: 'var(--cut-card-sunken)' }}
    >
      {items.map((item) => (
        <DockIcon mouseX={mouseX} key={item.title} {...item} />
      ))}
    </nav>
  )
}

function DockIcon({
  mouseX,
  title,
  icon,
  href,
  active,
}: DockItem & { mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [hovered, setHovered] = useState(false)

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - bounds.x - bounds.width / 2
  })

  const spring = { mass: 0.1, stiffness: 150, damping: 12 }
  const size = useSpring(useTransform(distance, [-140, 0, 140], [40, 72, 40]), spring)
  const iconSize = useSpring(useTransform(distance, [-140, 0, 140], [18, 32, 18]), spring)

  return (
    <a
      ref={ref}
      href={href}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="relative rounded-full focus-ring"
    >
      <motion.span
        style={{ width: size, height: size }}
        className={cn(
          'relative flex aspect-square items-center justify-center rounded-full transition-colors',
          active ? 'cut-btn cut-btn-brand text-white' : 'cut-btn cut-btn-light text-[var(--cut-body)]',
        )}
      >
        <AnimatePresence>
          {hovered ? (
            <motion.span
              initial={{ opacity: 0, y: 8, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 2, x: '-50%' }}
              className="cut-card absolute -top-10 left-1/2 w-fit whitespace-pre rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--cut-ink)]"
            >
              {title}
            </motion.span>
          ) : null}
        </AnimatePresence>
        <motion.span
          style={{ width: iconSize, height: iconSize }}
          className="flex items-center justify-center"
        >
          {icon}
        </motion.span>
      </motion.span>
      <span className="sr-only">{title}</span>
    </a>
  )
}

export default FloatingDock
