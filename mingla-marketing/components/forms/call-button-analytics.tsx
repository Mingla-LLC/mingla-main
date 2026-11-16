'use client'

// #4452 §8 call_button_clicked for the host ICP hero's CTA-bar call link
// ({where:"cta_bar", dest}). The top bar's call link fires its own.
import { useEffect } from 'react'
import { formEvent } from './form-events'

export function CallButtonAnalytics() {
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-call-button="cta_bar"]') : null
      if (el) formEvent('call_button_clicked', null, { where: 'cta_bar', dest: el.getAttribute('href') ?? '' })
    }
    document.addEventListener('click', on)
    return () => document.removeEventListener('click', on)
  }, [])
  return null
}
