'use client'

import { useState, type MouseEvent } from 'react'
import { ArrowUpRight, Sparkles, Star } from 'lucide-react'
import { DeviceCta } from '@/components/cutout'
import type { CataloguePlace, CataloguePlan } from '@/content/page-system/shared'

interface ExplorerCatalogueCardProps {
  readonly item: CataloguePlace | CataloguePlan
  readonly cityName?: string
  readonly href?: string
  readonly featured?: boolean
  readonly onOpen?: (href: string, opener: HTMLAnchorElement) => void
  readonly appCtaLocation: 'page_system_city_place_card' | 'page_system_explorer_guide_place_card'
}

function scoreLabel(score: number): string {
  return Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)
}

export function ExplorerCatalogueCard({ item, cityName = 'Lagos', href = item.detailHref, featured = false, onOpen, appCtaLocation }: ExplorerCatalogueCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const isPlace = item.kind === 'place'
  const action = isPlace ? 'View place' : 'View plan'
  const ariaLabel = isPlace
    ? `${action}, ${item.name}, Mingla score ${scoreLabel(item.signalScore)}, ${item.categoryLabel}`
    : `${action}, ${item.title}, ${item.stops.length} stops`
  const photo = item.photoUrls[0]
  const aiDescriptionId = isPlace && item.aiBlended ? `ai-meaning-${item.placePoolId}` : undefined

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(href, event.currentTarget)
  }

  return (
    <article
      className="ps-catalogue-card"
      data-kind={item.kind}
      data-featured={featured ? 'true' : undefined}
    >
      <a
        href={href}
        className="ps-catalogue-detail-link"
        data-kind={item.kind}
        onClick={handleClick}
        aria-label={ariaLabel}
        aria-describedby={aiDescriptionId}
      >
        <div className="ps-catalogue-photo">
          {!imageFailed && photo ? (
            <img
              src={photo}
              alt={isPlace ? `${item.name}, in the Explorer ${cityName} pool` : `${item.title}, a Mingla ${cityName} plan`}
              width="720"
              height="900"
              loading={featured ? 'eager' : 'lazy'}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="ps-catalogue-image-fallback" role="img" aria-label={`Photo unavailable for ${isPlace ? item.name : item.title}`}>
              <img src="/brand/mingla-business-logo.svg" alt="" width="64" height="64" />
              <span>{isPlace ? item.name : item.title}</span>
            </div>
          )}
          <div className="ps-catalogue-scrim" aria-hidden="true" />
          <div className="ps-catalogue-badges">
            <span>{isPlace ? item.categoryLabel : 'Ready-made plan'}</span>
          </div>
        </div>

        {!isPlace ? <div className="ps-plan-slivers" aria-hidden="true"><span /><span /></div> : null}
        <div className="ps-catalogue-plate">
          <div className="ps-catalogue-title">
            <h3>{isPlace ? item.name : item.title}</h3>
            <strong>{isPlace ? `Mingla score ${scoreLabel(item.signalScore)}` : `${item.stops.length} stops`}</strong>
          </div>
          <div className="ps-catalogue-facts">
            {isPlace ? (
              <>
                {item.rating && item.reviewCount ? (
                  <span><Star aria-hidden="true" size={14} fill="currentColor" />{item.rating.toFixed(1)} · {item.reviewCount.toLocaleString()} Google reviews</span>
                ) : null}
                {item.aiBlended ? (
                  <span><Sparkles aria-hidden="true" size={14} />AI-informed ranking<span id={aiDescriptionId} className="sr-only">. AI-informed means an AI signal was blended into this stored Mingla category score.</span></span>
                ) : <span>Rules-informed ranking</span>}
              </>
            ) : (
              <>
                <span>{item.sellLine}</span>
                <span>{item.itineraryLabel} · {item.intentLabel}</span>
              </>
            )}
          </div>
          <span className="ps-catalogue-action">{action}<ArrowUpRight aria-hidden="true" size={16} /></span>
        </div>
      </a>
      {isPlace ? (
        <div className="ps-catalogue-app-cta">
          <DeviceCta surface="explorer" location={appCtaLocation} label="Get the app" size="md" className="ps-catalogue-app-button" />
        </div>
      ) : null}
    </article>
  )
}
