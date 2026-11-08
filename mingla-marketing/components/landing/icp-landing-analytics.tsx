'use client'
import { useEffect } from 'react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { landingIcp } from '@/lib/page-measurement'

// #4339 round B — the Host landing page's own events, from one delegated
// listener (the page stays a Server Component):
//
//   [data-icp-event]              icp_talk_to_team_clicked, icp_see_inside_clicked,
//                                 icp_tool_card_clicked        {icp}
//   <details data-icp-faq="<i>">  icp_faq_opened               {icp, faq_index}
//
// A question counts when the visitor opens it (the first one starts open and
// is not counted). Consent is captureMarketing's own gate.

const EVENTS = new Set(['icp_talk_to_team_clicked', 'icp_see_inside_clicked', 'icp_tool_card_clicked'])

export function IcpLandingAnalytics({ slug }: { slug: string }) {
  useEffect(() => {
    const icp = landingIcp(slug) ?? null
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const tagged = target?.closest<HTMLElement>('[data-icp-event]')
      const name = tagged?.dataset.icpEvent
      if (name && EVENTS.has(name)) {
        captureMarketing(name, { icp })
        return
      }
      const summary = target?.closest('summary')
      const details = summary?.parentElement
      if (details instanceof HTMLDetailsElement && details.dataset.icpFaq !== undefined && !details.open) {
        captureMarketing('icp_faq_opened', { icp, faq_index: Number(details.dataset.icpFaq) })
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [slug])
  return null
}
