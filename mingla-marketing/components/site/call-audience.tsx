'use client'

// #4452 §2.11 (rework 1, P2-13): a form page tells the top-bar call link its
// form's audience (creator -> /schedule/creators, local -> /schedule/locals)
// without threading a prop through the shared SitePage shell.
import { createContext, useContext, type ReactNode } from 'react'
import type { CallAudience } from '@/lib/cta-destination'

const CallAudienceContext = createContext<CallAudience | null>(null)

export function CallAudienceProvider({ audience, children }: { audience: CallAudience; children: ReactNode }) {
  return <CallAudienceContext.Provider value={audience}>{children}</CallAudienceContext.Provider>
}

export function useCallAudience(): CallAudience | null {
  return useContext(CallAudienceContext)
}
