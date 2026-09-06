'use client'

import { useEffect, useRef, type MouseEvent } from 'react'
import { ArrowLeft, Sparkles, Star, X } from 'lucide-react'
import { DeviceCta } from '@/components/cutout'
import type { CataloguePlace, CataloguePlan } from '@/content/page-system/shared'

interface CatalogueDetailProps {
  readonly item: CataloguePlace | CataloguePlan
  readonly cityName: string
  readonly backHref: string
  readonly onClose: () => void
}

function scoreLabel(score: number): string {
  return Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)
}

export function CatalogueDetail({ item, cityName, backHref, onClose }: CatalogueDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const childDialogOpenRef = useRef(false)
  const isPlace = item.kind === 'place'
  const backLabel = cityName === 'Lagos' ? 'Back to Lagos picks' : `Back to ${cityName} picks`

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (childDialogOpenRef.current) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  function close(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    onClose()
  }

  return (
    <div className="ps-detail-layer" data-catalogue-detail>
      <a href={backHref} className="ps-detail-backdrop" aria-label={backLabel} onClick={close} />
      <div
        ref={panelRef}
        className="ps-detail-panel"
        data-kind={item.kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalogue-detail-title"
        aria-describedby={isPlace && item.aiBlended ? 'catalogue-ai-meaning' : undefined}
        tabIndex={-1}
      >
        <header className="ps-detail-header">
          <div><span>{isPlace ? item.categoryLabel : 'Mingla ready-made plan'}</span><strong>{isPlace ? 'Place details' : 'Plan details'}</strong></div>
          <a href={backHref} aria-label="Close details" onClick={close}><X aria-hidden="true" size={20} /></a>
        </header>

        <div className="ps-detail-gallery" data-count={Math.min(item.photoUrls.length, 3)}>
          {item.photoUrls.slice(0, 3).map((photo, index) => (
            <img key={photo} src={photo} alt={index === 0 ? `${isPlace ? `${item.name}, in the Explorer ${cityName} pool` : `${item.title}, a Mingla ${cityName} plan`}` : ''} width="900" height="700" />
          ))}
        </div>

        <div className="ps-detail-copy">
          <p className="ps-eyebrow">{isPlace ? 'Mingla-ranked place' : item.intentLabel}</p>
          <h2 id="catalogue-detail-title">{isPlace ? item.name : item.title}</h2>
          {isPlace ? (
            <>
              <div className="ps-detail-score">
                <strong>Mingla score {scoreLabel(item.signalScore)}</strong>
                {item.aiBlended ? <span><Sparkles aria-hidden="true" size={15} />AI-informed</span> : <span>Rules-informed</span>}
              </div>
              <p id={item.aiBlended ? 'catalogue-ai-meaning' : undefined}>The Mingla score is the stored ranking value used by Explorer for this category. AI contributes only where the score receipt says it was blended.</p>
              {item.rating && item.reviewCount ? <p className="ps-detail-rating"><Star aria-hidden="true" size={16} fill="currentColor" />{item.rating.toFixed(1)} from {item.reviewCount.toLocaleString()} Google reviews stored with this place.</p> : null}
              {item.oneLiner ? <p>{item.oneLiner}</p> : null}
              {item.address ? <address>{item.address}</address> : null}
              <p className="ps-source-note">Score captured {new Date(item.scoredAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}. Place record refreshed {new Date(item.sourceUpdatedAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}.</p>
            </>
          ) : (
            <>
              <p className="ps-detail-lede">{item.sellLine}</p>
              <p>{item.itineraryLabel}. This is a captured Mingla editorial plan made from real place records; it is not a ranked place and has no fabricated score.</p>
              <ol className="ps-plan-stops">
                {item.stops.map((stop, index) => (
                  <li key={stop.id}>
                    <img src={stop.photoUrl} alt="" width="160" height="120" />
                    <div><span>Stop {index + 1} · {stop.role}</span><strong>{stop.name}</strong>{stop.address ? <address>{stop.address}</address> : null}</div>
                  </li>
                ))}
              </ol>
              <p className="ps-source-note">Editorial plan snapshot captured {new Date(item.generatedAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}. Live availability and opening hours are not implied.</p>
            </>
          )}
          <div className="ps-detail-app-cta">
            <DeviceCta
              surface="explorer"
              location={isPlace ? 'page_system_catalogue_detail_place' : 'page_system_catalogue_detail_plan'}
              label="Get the app"
              size="md"
              onDialogOpenChange={(open) => { childDialogOpenRef.current = open }}
            />
          </div>
          <a href={backHref} className="ps-back-link" onClick={close}><ArrowLeft aria-hidden="true" size={17} />{backLabel}</a>
        </div>
      </div>
    </div>
  )
}
