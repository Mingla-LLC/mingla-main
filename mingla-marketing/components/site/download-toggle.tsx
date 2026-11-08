'use client'
import { useState, type ReactNode } from 'react'
import QRCode from 'react-qr-code'
import { FilterChips } from './filter-row'

// #4339 phase 2b — the Get the app toggle: Mingla (Explorer) or Mingla Host.
// Both panels are server-rendered by app/download/page.tsx; this only chooses
// which one shows. The first panel is the one the URL asks for (`?app=host`
// opens on Mingla Host), so a link from a Host page lands on the Host panel.

const LABELS = { explorer: 'Mingla', host: 'Mingla Host' } as const
type App = keyof typeof LABELS

interface DownloadToggleProps {
  initial: App
  explorer: ReactNode
  host: ReactNode
}

export function DownloadToggle({ initial, explorer, host }: DownloadToggleProps) {
  const [app, setApp] = useState<App>(initial)
  return (
    <div data-download-app={app}>
      <FilterChips
        label="Choose the app"
        options={[LABELS.explorer, LABELS.host]}
        value={LABELS[app]}
        onChange={(label) => setApp(label === LABELS.host ? 'host' : 'explorer')}
      />
      {app === 'host' ? host : explorer}
    </div>
  )
}

/** A QR code for an app link (the Host OneLink), near-black on white. */
export function AppQr({ value, title, size = 152 }: { value: string; title: string; size?: number }) {
  return <QRCode value={value} size={size} title={title} fgColor="#111110" bgColor="#FFFFFF" level="M" />
}
