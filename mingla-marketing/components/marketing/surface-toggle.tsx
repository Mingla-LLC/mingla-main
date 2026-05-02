'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'

interface Segment {
  surface: 'explorer' | 'organiser'
  label: string
  href: string
}

const SEGMENTS: Segment[] = [
  { surface: 'explorer', label: 'Explorer', href: '/' },
  { surface: 'organiser', label: 'Organiser', href: '/organisers' },
]

export function SurfaceToggle() {
  const pathname = usePathname()
  const active: 'explorer' | 'organiser' = pathname.startsWith('/organisers')
    ? 'organiser'
    : 'explorer'

  return (
    <div
      role="tablist"
      aria-label="Switch surface"
      className="glass-soft relative flex h-10 items-center gap-1 rounded-full p-1"
    >
      {SEGMENTS.map((seg) => {
        const isActive = active === seg.surface
        return (
          <Link
            key={seg.surface}
            href={seg.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center rounded-full px-4 font-display text-base font-medium tracking-[-0.005em] transition-colors duration-200 focus-ring',
              isActive
                ? 'bg-warm text-white'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {seg.label}
          </Link>
        )
      })}
    </div>
  )
}
