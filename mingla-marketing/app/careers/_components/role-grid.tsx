'use client'
// META-ORCH-1222 [Careers site] — index role card grid (DESIGN §2.2–§2.5 + D-3).
// 2-up desktop/tablet, 1-up mobile. Cards fade+rise on mount (stagger 60ms, cap
// 6), hover lift + arrow shift (pointer:fine). Reduced-motion → opacity-only.
// The full card is one link to /roles/{slug}.

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { employmentLabel, type JobPosting } from '@/lib/careers-data'

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-medium"
      style={{ background: 'var(--coral-050)', color: 'var(--ink-muted)' }}
    >
      {children}
    </span>
  )
}

export function RoleGrid({ roles }: { roles: JobPosting[] }) {
  const reduced = useMinglaReducedMotion()

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {roles.map((role, i) => (
        <motion.div
          key={role.slug}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={
            reduced
              ? { duration: 0.12 }
              : { type: 'spring', stiffness: 260, damping: 30, delay: Math.min(i, 6) * 0.06 }
          }
        >
          <Link href={`/roles/${role.slug}`} className="group block focus-visible:outline-none">
            <article
              className="h-full rounded-2xl p-7 transition-all duration-[180ms] ease-out group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-[var(--coral-500)]"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 1px 2px rgba(15,17,21,0.04)',
              }}
            >
              <div className="flex flex-wrap gap-2">
                <Chip>{role.department}</Chip>
                <Chip>{role.location}</Chip>
                <Chip>{employmentLabel(role.employment_type)}</Chip>
              </div>

              <h2
                className="mt-3.5 font-[family-name:var(--font-mochiy)] text-[22px] leading-[1.25]"
                style={{ color: 'var(--ink)' }}
              >
                {role.title}
              </h2>

              <p
                className="mt-2 line-clamp-3 text-[15.5px] leading-[1.6]"
                style={{ color: 'var(--ink-muted)' }}
              >
                {role.summary}
              </p>

              <hr className="my-5" style={{ borderColor: 'var(--border)' }} />

              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {role.salary_display}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[14px] font-semibold"
                  style={{ color: 'var(--coral-500)' }}
                >
                  View role
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-[180ms] ease-out group-hover:translate-x-1"
                  />
                </span>
              </div>
            </article>
          </Link>
        </motion.div>
      ))}
    </div>
  )
}
