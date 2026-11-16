'use client'
import { useEffect, useState } from 'react'
import { SuccessScreen } from '@/components/forms/success-screen'
import { captureMarketing } from '@/components/marketing/marketing-capture'

export function ThanksClient() {
  const [done, setDone] = useState<{ first: string | null; sub: string; audience: 'host' | 'creator' | 'local' } | null>(null)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('mingla:apply-done')
      if (raw) setDone(JSON.parse(raw))
    } catch {
      // nothing kept
    }
    captureMarketing('success_viewed', { screen: 'thanks', virtual_path: window.location.pathname })
  }, [])
  return <SuccessScreen audience={done?.audience ?? 'creator'} firstName={done?.first ?? null} submissionId={done?.sub ?? ''} />
}
