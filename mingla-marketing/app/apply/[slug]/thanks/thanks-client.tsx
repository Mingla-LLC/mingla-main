'use client'
// #4452 §2.8 — the thanks page of a form page: the success screen, with in-form
// booking when the answers just sent are still in memory (same tab, client
// navigation); after a booking it goes to /apply/<slug>/booked.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SuccessScreen } from '@/components/forms/success-screen'
import { formEvent } from '@/components/forms/form-events'
import { bookingHandoff, setBookingHandoff } from '@/lib/forms/booking'

export function ThanksClient() {
  const router = useRouter()
  const [done, setDone] = useState<{ first: string | null; sub: string; audience: 'host' | 'creator' | 'local' } | null>(null)
  const [handoff] = useState(() => bookingHandoff())
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('mingla:apply-done')
      if (raw) setDone(JSON.parse(raw))
    } catch {
      // nothing kept
    }
    formEvent('success_viewed', null, { screen: 'thanks', virtual_path: window.location.pathname })
  }, [])
  return (
    <SuccessScreen
      audience={handoff?.audience ?? done?.audience ?? 'creator'}
      firstName={handoff?.first ?? done?.first ?? null}
      submissionId={handoff?.submissionId ?? done?.sub ?? ''}
      booking={handoff?.basics ?? null}
      onBooked={(start) => {
        if (handoff) setBookingHandoff({ ...handoff, booked: start })
        router.push(window.location.pathname.replace(/\/thanks$/, '/booked'))
      }}
    />
  )
}
