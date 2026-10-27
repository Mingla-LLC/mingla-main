import Image from 'next/image'
import { hostImage } from '@/lib/design-preview/host-imagery'
import { CutoutSection } from './primitives'
import { DeviceCta } from './device-cta'

// ---------------------------------------------------------------
// #4137 — the "Start hosting" closing card on /host. It replaces the city
// guide list there (RootCityGrid stays defined in city-hub.tsx for the city
// pages). Three decorative photos and one device-aware button; no device note,
// caption or credit line.
// ---------------------------------------------------------------

const PHOTOS = ['P1', 'P2', 'P3'] as const

export function HostStartCta() {
  return (
    <CutoutSection aria-label="Start hosting" rhythm="tight">
      <div className="cut-start mx-auto max-w-6xl">
        <div aria-hidden="true" className="cut-start-photos">
          {PHOTOS.map((slot) => {
            const image = hostImage(slot)
            return (
              <div key={slot} className="cut-start-photo">
                <Image
                  src={image.file}
                  alt=""
                  fill
                  sizes="(min-width: 768px) 15vw, 30vw"
                  loading="lazy"
                  className="object-cover"
                />
              </div>
            )
          })}
        </div>
        <div>
          <p className="text-[0.75rem] font-extrabold uppercase tracking-[0.12em] text-[var(--cut-accent)]">
            Start hosting
          </p>
          <h2
            id="host-start-title"
            className="mt-2 font-display text-[clamp(1.875rem,4.4vw,3.25rem)] leading-[1.06] tracking-[-0.02em] text-[var(--cut-ink)]"
          >
            Open your doors to <span className="cut-gradient-brand">the whole city.</span>
          </h2>
          <p className="mb-6 mt-3 max-w-[28.75rem] text-[1.0625rem] leading-relaxed text-[#4a423a]">
            Put your place, event or trip in front of the people planning their weekend, and start selling the same day.
          </p>
          <DeviceCta surface="host" location="host_start_hosting_final" variant="primary" size="lg" />
        </div>
      </div>
    </CutoutSection>
  )
}
