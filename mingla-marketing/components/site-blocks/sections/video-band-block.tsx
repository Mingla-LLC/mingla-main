// #4636 block `videoBand` — the rounded clip band that closes a page, moved
// as-is (R1). Variant = the page it came from (never an editor control):
//   plain    Home "Run a place with soul?" (copy + one button);
//   glass    For hosts "Get found. Get booked." (glass bar + one button);
//   icp      host-type pages (italic runs in spans, glass bar + Host hand-off);
//   creators /creators "Questions first?" (inside the programme frame);
//   locals   /locals "Your city, in your words." (inside the programme frame).
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { ActionButton, Em, EmSpans, type BlockAction, type BlockProps } from './shared'

export interface VideoBandContent {
  variant: 'plain' | 'glass' | 'icp' | 'creators' | 'locals'
  media: LandingMediaRef
  heading: string
  body?: string
  bring?: string
  primary: BlockAction
  secondary?: BlockAction
}

export function VideoBandBlock({ content, blockId }: BlockProps<VideoBandContent>) {
  const c = content
  if (c.variant === 'creators' || c.variant === 'locals') {
    return (
      <div className="band reveal mt-24">
        <LandingMedia media={c.media} />
        <div className="in">
          {c.variant === 'creators' ? (
            <>
              <h2>
                <Em text={c.heading} />
              </h2>
              <div className="glassbar">
                <span className="bring">{c.bring}</span>
                <ActionButton action={c.primary} className="btn white" location="band" arrow="inline" />
              </div>
            </>
          ) : (
            <>
              <div className="band-copy">
                <h2>
                  <Em text={c.heading} />
                </h2>
                <p>{c.body}</p>
              </div>
              <div className="band-actions">
                <ActionButton action={c.primary} className="btn white" location="band" arrow="inline" />
                {c.secondary ? <ActionButton action={c.secondary} className="btn glass" location="band" /> : null}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
  if (c.variant === 'icp') {
    return (
      <section className="band-sec">
        <div className="wrap">
          <div className="band">
            <LandingMedia media={c.media} />
            <div className="in">
              <h2>
                <EmSpans text={c.heading} />
              </h2>
              <div className="glassbar">
                <span className="bring">{c.bring}</span>
                <ActionButton action={c.primary} className="btn white" location="band" />
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="band-sec" aria-labelledby={blockId}>
      <div className="wrap">
        <div className="band">
          <LandingMedia media={c.media} />
          <div className="in">
            {c.variant === 'plain' ? (
              <>
                <div className="band-copy">
                  <h2 id={blockId}>
                    <Em text={c.heading} />
                  </h2>
                  <p>{c.body}</p>
                </div>
                <ActionButton action={c.primary} className="btn cta" location="band" arrow="inline" />
              </>
            ) : (
              <>
                <h2 id={blockId}>
                  <Em text={c.heading} />
                </h2>
                <div className="glassbar">
                  <span className="bring">{c.bring}</span>
                  <ActionButton action={c.primary} className="btn white" location="band" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
