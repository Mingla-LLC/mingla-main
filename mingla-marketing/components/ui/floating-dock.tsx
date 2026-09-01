'use client'
import { useRef, type ReactNode } from 'react'
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — Floating dock, adapted to Mingla's stack and to Seth's brief.
//
// DEVIATIONS FROM THE SUPPLIED SNIPPET, each avoiding a duplicate of something
// this app already has. No new dependencies were installed.
//   - `motion/react` → `framer-motion`: the same library under its newer name.
//     This app already depends on framer-motion@11; installing `motion` beside
//     it would ship two copies of the animation runtime.
//   - `@tabler/icons-react` → `lucide-react`: already a dependency and already
//     this codebase's icon set.
//   - `@/lib/utils` → `@/lib/cn`.
//
// CHANGES TO THE PATTERN ITSELF, per Seth:
//   - Items carry an ICON AND A VISIBLE LABEL. The original is icon-only with
//     the name hidden behind a hover tooltip, which means nobody knows what
//     anything is until they point at it — and on touch, never.
//   - The dock magnifies by growing each pill's height, icon and label
//     together, so the label stays legible at every size rather than being
//     scaled into blur.
//   - Reduced-motion users get the dock at its resting size with no
//     magnification at all.
// ---------------------------------------------------------------

export interface DockItem {
  title: string
  icon: ReactNode
  href: string
  active?: boolean
}

export function FloatingDock({
  items,
  className,
  label = 'Primary',
  stacked = false,
}: {
  items: DockItem[]
  className?: string
  label?: string
  /**
   * Icon ABOVE label instead of beside it.
   *
   * Five labelled items in a row need ~450px; a 390px phone has ~366px of
   * usable width, so the row version overflowed and cut "Blog" and "About"
   * off. Seth wants the labels kept, so mobile stacks them — the native
   * tab-bar pattern — which fits all five with the labels intact.
   */
  stacked?: boolean
}) {
  const mouseX = useMotionValue(Infinity)
  const reduced = useMinglaReducedMotion()

  return (
    <nav
      aria-label={label}
      onMouseMove={(e) => {
        if (!reduced) mouseX.set(e.pageX)
      }}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        'cut-card flex items-center',
        stacked ? 'w-full justify-between gap-0.5 rounded-[1.75rem] p-2' : 'gap-1.5 rounded-full p-1.5',
        className,
      )}
    >
      {items.map((item) => (
        <DockPill
          key={item.title}
          mouseX={mouseX}
          reduced={reduced}
          stacked={stacked}
          {...item}
        />
      ))}
    </nav>
  )
}

function DockPill({
  mouseX,
  reduced,
  stacked,
  title,
  icon,
  href,
  active,
}: DockItem & { mouseX: MotionValue<number>; reduced: boolean; stacked?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null)

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - bounds.x - bounds.width / 2
  })

  const spring = { mass: 0.1, stiffness: 160, damping: 14 }
  // Height, icon and label grow TOGETHER so the label never blurs.
  const height = useSpring(useTransform(distance, [-160, 0, 160], [42, 54, 42]), spring)
  const iconSize = useSpring(useTransform(distance, [-160, 0, 160], [17, 22, 17]), spring)
  const fontSize = useSpring(useTransform(distance, [-160, 0, 160], [13.5, 15.5, 13.5]), spring)

  // Stacked (mobile) is a fixed-size tab: no magnification, because there is
  // no cursor to magnify toward.
  if (stacked) {
    return (
      <a
        ref={ref}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-[1.25rem] px-1 py-2 transition-colors focus-ring',
          active ? 'cut-btn cut-btn-brand text-white' : 'text-[var(--cut-body)]',
        )}
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        <span className="font-display text-[0.6875rem] font-medium leading-none">{title}</span>
      </a>
    )
  }

  return (
    <a
      ref={ref}
      href={href}
      aria-current={active ? 'page' : undefined}
      className="rounded-full focus-ring"
    >
      <motion.span
        style={reduced ? { height: 44 } : { height }}
        className={cn(
          'flex items-center gap-2 rounded-full px-4 transition-colors duration-200',
          active
            ? 'cut-btn cut-btn-brand text-white'
            : 'text-[var(--cut-body)] hover:bg-[var(--cut-card-sunken)] hover:text-[var(--cut-ink)]',
        )}
      >
        <motion.span
          style={reduced ? { width: 18, height: 18 } : { width: iconSize, height: iconSize }}
          className="flex shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {icon}
        </motion.span>
        <motion.span
          style={reduced ? { fontSize: 14 } : { fontSize }}
          className="whitespace-nowrap font-display font-medium leading-none"
        >
          {title}
        </motion.span>
      </motion.span>
    </a>
  )
}

export default FloatingDock
