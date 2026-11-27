// #4636 block `getApp` — the "Get the app" section of /download: the Mingla /
// Mingla Host toggle, a QR and both store buttons for each app, "Or use Mingla
// Host on web" for Host, and the phone with its clip. Moved as-is (R1) from
// app/download/page.tsx (the phone redirect stays in the route). Every store,
// OneLink and host-web href comes from lib/app-handoff.ts →
// lib/cta-destination.ts (#4137); the Explorer QR still encodes /download.
import { ArrowRight } from 'lucide-react'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { DownloadQr } from '@/components/marketing/download-qr'
import { LandingMedia } from '@/components/landing/landing-media'
import { LazyDownloadToggle as DownloadToggle } from '../lazy-islands'  // #4636: own chunk (first-load budget)
import { AppQr } from '@/components/site/app-qr'
import { appHandoffHrefs, hostWebLabel } from '@/lib/app-handoff'
import { siteAttribution } from '@/lib/links-src'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { Em, type BlockProps } from './shared'

export interface GetAppContent {
  explorerTitle: string
  explorerLead: string
  hostTitle: string
  hostLead: string
  media: LandingMediaRef
}

export function GetAppBlock({ content, initial = 'explorer' }: BlockProps<GetAppContent> & { initial?: 'explorer' | 'host' }) {
  const explorer = appHandoffHrefs('explorer', siteAttribution('explorer_nav'))
  const host = appHandoffHrefs('host', siteAttribution('business_download'))

  const explorerPanel = (
    <>
      <h1>
        <Em text={content.explorerTitle} />
      </h1>
      <p className="lead">{content.explorerLead}</p>
      <div className="qr-row">
        <div className="qr">
          <DownloadQr size={172} />
        </div>
        <div className="stores">
          <AppStoreBadges size="lg" iosHref={explorer.stores.appStore} androidHref={explorer.stores.googlePlay} />
        </div>
      </div>
    </>
  )

  const hostPanel = (
    <>
      <h1>
        <Em text={content.hostTitle} />
      </h1>
      <p className="lead">{content.hostLead}</p>
      <div className="qr-row">
        <div className="qr">
          <AppQr value={host.phoneHref} title="QR code that opens the Mingla Host app on your phone" size={172} />
        </div>
        <div className="stores">
          <a className="store" href={host.stores.appStore} aria-label="Get Mingla Host on the App Store">
            <AppleMark />
            <span>
              <small>Get Mingla Host on the</small>
              <b>App Store</b>
            </span>
          </a>
          <a className="store" href={host.stores.googlePlay} aria-label="Get Mingla Host on Google Play">
            <PlayMark />
            <span>
              <small>Get Mingla Host on</small>
              <b>Google Play</b>
            </span>
          </a>
          <a className="btn soft" href={host.computerHref}>
            Or use Mingla Host on web <ArrowRight aria-hidden="true" />
          </a>
          <span className="sr-only">Mingla Host on web is at {hostWebLabel(host.computerHref)}</span>
        </div>
      </div>
    </>
  )

  return (
    <section className="sec get-app">
      <div className="wrap split split-center">
        <DownloadToggle initial={initial} explorer={explorerPanel} host={hostPanel} />
        <div className="phone" aria-hidden="true">
          <span className="notch" />
          <div className="scr">
            <LandingMedia media={content.media} />
          </div>
        </div>
      </div>
    </section>
  )
}
