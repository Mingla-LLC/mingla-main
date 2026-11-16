'use client'
// #4452 §2.8 — the booked page shows the time when it came from an in-form booking in this tab.
import { useEffect, useState } from 'react'
import { bookingHandoff, bookedLine } from '@/lib/forms/booking'
import { formEvent } from '@/components/forms/form-events'

export function BookedLine() {
  const [line] = useState(() => {
    const h = bookingHandoff()
    if (!h?.booked) return null
    try { return bookedLine(h.booked, Intl.DateTimeFormat().resolvedOptions().timeZone) } catch { return bookedLine(h.booked) }
  })
  useEffect(() => { formEvent('success_viewed', null, { screen: 'booked', virtual_path: window.location.pathname }) }, [])
  return <p>{line ? `${line}. ` : ''}The invite with the video link is on its way to your inbox.</p>
}
