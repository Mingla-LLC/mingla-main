'use client'

import { usePathname } from 'next/navigation'

export function SkipLink() {
  const pathname = usePathname()
  const label = pathname.startsWith('/cities/') ? 'Skip to city guide' : 'Skip to content'
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[160] focus:rounded-md focus:bg-coral-500 focus:px-4 focus:py-2 focus:text-white"
    >
      {label}
    </a>
  )
}
