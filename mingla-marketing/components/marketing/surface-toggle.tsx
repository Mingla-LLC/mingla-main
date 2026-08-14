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
  { surface: 'explorer', label: 'Mingla', href: '/' },
  { surface: 'organiser', label: 'Mingla Host', href: '/host' },
]

export function SurfaceToggle() {
  const pathname = usePathname()
  const active: 'explorer' | 'organiser' = pathname.startsWith('/host')
    ? 'organiser'
    : 'explorer'

  return (
    <nav aria-label="Mingla products" className="glass-soft relative flex min-h-11 items-center gap-1 rounded-full p-1">
      {SEGMENTS.map((seg) => {
        const isActive = active === seg.surface
        return (
          <Link
            key={seg.surface}
            href={seg.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4 font-display text-sm font-medium tracking-[-0.005em] transition-colors duration-200 focus-ring',
              isActive
                ? 'bg-warm text-white'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {seg.label}
          </Link>
        )
      })}
    </nav>
  )
}
