'use client'
import { useEffect, useRef } from 'react'
import { resolveLandingMedia, type LandingMediaRef } from '@/content/host-landing/icps'
import { prefersStillMedia } from '@/components/landing/landing-media'

// #4339 — the "Reelmark" carousel under the home and Mingla Host heroes: a
// curved, draggable, auto-scrolling row of tall cards, built in the DOM.
// Ported from the approved design's mountReels, unit for unit:
//
//   u        = clamp(vw / 1440, 0.52, 1.12)     (vw = the stage's width)
//   spacing  = 236u
//   d        = card offset from centre / half the stage width, |d| ≤ 1.6
//   width    = (170 + 48·d²)u
//   height   = (280 + 92·|d|^2.6)u
//   x        = offset · (1 + 0.083·d²)          (the outward push)
//   rotateY  = clamp(−d·16°, −26°, 26°)
//
// It drifts right to left at 50u per second; a drag moves it 1:1 and a
// release carries the drag's velocity, easing back to the drift. Under
// prefers-reduced-motion it does not drift and no clip plays; under Save-Data
// no clip loads either (the poster stays). Only the clips of cards near the
// centre play; a clip's file is requested the first time its card gets there.
// Frames only run while the stage is on screen and the tab is visible.

export interface ReelCard {
  media: LandingMediaRef
  caption: string
}

const SPACING = 236
const DRIFT = 50

export function ReelStage({ cards }: { cards: readonly ReelCard[] }) {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const section = stage?.closest<HTMLElement>('.rm')
    if (!stage || !section) return
    const els = Array.from(stage.querySelectorAll<HTMLElement>('.rm-card'))
    const vids = els.map((el) => el.querySelector('video'))
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const still = prefersStillMedia()
    const n = els.length
    const auto = reduced ? 0 : DRIFT

    let u = 1
    let vw = 1
    let spacing = SPACING
    let off = 0
    let vel = 0
    let dragging = false
    let lastX = 0
    let lastT = 0
    let raf = 0
    let onScreen = true
    let prev = performance.now()

    const size = () => {
      vw = stage.clientWidth || 1
      u = Math.max(0.52, Math.min(1.12, vw / 1440))
      section.style.setProperty('--u', String(u))
      spacing = SPACING * u
    }

    const layout = () => {
      const loop = n * spacing
      const half = vw / 2
      els.forEach((el, i) => {
        let p = (((i * spacing - off) % loop) + loop) % loop
        if (p > loop / 2) p -= loop
        const d = p / half
        const ad = Math.min(Math.abs(d), 1.6)
        const w = (170 + 48 * ad * ad) * u
        const h = (280 + 92 * Math.pow(ad, 2.6)) * u
        const x = p * (1 + 0.083 * ad * ad)
        const ry = Math.max(-26, Math.min(26, -d * 16))
        el.style.width = `${w}px`
        el.style.height = `${h}px`
        el.style.transform = `translate(${x - w / 2}px, ${-h / 2}px) perspective(1200px) rotateY(${ry}deg)`
        el.style.zIndex = String(100 - Math.round(ad * 20))
        const video = vids[i]
        if (!video || still) return
        const near = Math.abs(p) < Math.max(1.5 * spacing, half * 0.5)
        if (near && onScreen && !document.hidden) {
          if (!video.getAttribute('src')) {
            video.muted = true
            video.preload = 'metadata'
            video.src = video.dataset.src ?? ''
          }
          if (video.paused) {
            video.play().catch(() => {
              // Autoplay can be refused (low-power mode); the poster is the
              // designed fallback, so the card stays correct.
              video.dataset.autoplay = 'refused'
            })
          }
        } else if (!video.paused) {
          video.pause()
        }
      })
    }

    const frame = (t: number) => {
      raf = 0
      const dt = Math.min(0.05, (t - prev) / 1000)
      prev = t
      if (!dragging) {
        vel += (auto * u - vel) * Math.min(1, dt * 2.2)
        off += vel * dt
      }
      layout()
      const moving = dragging || auto !== 0 || Math.abs(vel) > 0.5
      if (onScreen && !document.hidden && moving) raf = window.requestAnimationFrame(frame)
    }
    const kick = () => {
      if (raf === 0) {
        prev = performance.now()
        raf = window.requestAnimationFrame(frame)
      }
    }

    const down = (e: PointerEvent) => {
      dragging = true
      stage.classList.add('drag')
      lastX = e.clientX
      lastT = performance.now()
      vel = 0
      stage.setPointerCapture(e.pointerId)
      kick()
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const now = performance.now()
      const dx = e.clientX - lastX
      off -= dx
      const inst = (-dx / Math.max(1, now - lastT)) * 1000
      vel = vel * 0.6 + inst * 0.4
      lastX = e.clientX
      lastT = now
    }
    const up = () => {
      if (!dragging) return
      dragging = false
      stage.classList.remove('drag')
      vel = Math.max(-4000, Math.min(4000, vel))
      kick()
    }
    const onResize = () => {
      size()
      layout()
    }
    const onVisibility = () => {
      if (document.hidden) vids.forEach((v) => v?.pause())
      else kick()
    }

    size()
    layout()
    stage.setAttribute('data-ready', '')
    kick()

    stage.addEventListener('pointerdown', down)
    stage.addEventListener('pointermove', move)
    stage.addEventListener('pointerup', up)
    stage.addEventListener('pointercancel', up)
    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry?.isIntersecting ?? false
        if (onScreen) kick()
        else vids.forEach((v) => v?.pause())
      },
      { threshold: 0 },
    )
    io.observe(stage)

    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      io.disconnect()
      stage.removeEventListener('pointerdown', down)
      stage.removeEventListener('pointermove', move)
      stage.removeEventListener('pointerup', up)
      stage.removeEventListener('pointercancel', up)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      vids.forEach((v) => v?.pause())
    }
  }, [])

  return (
    <div ref={stageRef} className="rm-stage" aria-hidden="true">
      {cards.map((card, i) => {
        const media = resolveLandingMedia(card.media)
        return (
          <div className="rm-card" key={`${card.media}-${i}`}>
            {media.kind === 'video' ? (
              <video
                poster={media.poster}
                data-src={media.src ?? ''}
                muted
                loop
                playsInline
                preload="none"
                disablePictureInPicture
                tabIndex={-1}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.poster} alt="" loading="lazy" decoding="async" draggable={false} />
            )}
            <div className="cap">
              <span className="pill glass">{card.caption}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
