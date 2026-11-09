// #4339 round B (speed) — which copy of a site clip a browser downloads, and
// when. Every clip in public/marketing/site/m has <name>.mp4 (H.264, the
// master) and <name>-sm.mp4 (phone size, long edge 640), plus AV1 copies
// (<name>.webm, <name>-sm.webm) where AV1 is really lighter
// (scripts/encode-site-clips.mjs, then scripts/clip-copies-manifest.mjs, which
// writes lib/clip-av1.generated.json). Pure and React-free (the node test
// loads it).
//
//   phone-sized screen (≤ 820 CSS px, or a coarse pointer under 1024)
//                    → the -sm copy
//   AV1 playable and an AV1 copy exists → .webm, else .mp4
//
// Timing (startClipWhenReady): the hero clip starts after the page's first
// paint and load; every other clip waits for load and an idle moment, then
// for its card to be on screen. Until then only the poster (a small WebP)
// paints, and it is the page's LCP image.

import AV1 from './clip-av1.generated.json'

export interface ClipEnvironment {
  /** CSS pixel width of the viewport. */
  viewportWidth: number
  /** True when the device's main pointer is coarse (a touch screen). */
  coarsePointer: boolean
  /** True when the browser says it can play AV1 in WebM. */
  av1: boolean
}

export const SMALL_VIEWPORT_MAX = 820

const AV1_FULL: ReadonlySet<string> = new Set(AV1.full)
const AV1_SMALL: ReadonlySet<string> = new Set(AV1.small)

/** The copy of `src` (a `/…/<name>.mp4` master) this browser should load. */
export function clipSourceFor(src: string, env: ClipEnvironment): string {
  const match = /^(.*\/)([a-z0-9-]+)\.mp4$/.exec(src)
  if (!match) return src
  const [, dir, name] = match
  const small = env.viewportWidth <= SMALL_VIEWPORT_MAX || (env.coarsePointer && env.viewportWidth < 1024)
  const av1 = env.av1 && (small ? AV1_SMALL : AV1_FULL).has(name)
  return `${dir}${name}${small ? '-sm' : ''}.${av1 ? 'webm' : 'mp4'}`
}

/** The small WebP poster beside a clip's JPEG poster (same name). */
export function webpPoster(poster: string): string {
  return poster.replace(/\.jpg$/, '.webp')
}

/** The live environment (browser only). */
export function clipEnvironment(): ClipEnvironment {
  const video = typeof document === 'undefined' ? null : document.createElement('video')
  const av1 = video?.canPlayType('video/webm; codecs="av01.0.05M.08"') === 'probably'
  return {
    viewportWidth: typeof window === 'undefined' ? 1440 : window.innerWidth,
    coarsePointer: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
    av1,
  }
}

let loaded: Promise<void> | null = null

/** Resolves after the window `load` event and one idle moment (or 1.5 s). */
export function afterLoadAndIdle(): Promise<void> {
  if (loaded) return loaded
  loaded = new Promise<void>((resolve) => {
    const idle = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
      if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 1500 })
      else window.setTimeout(resolve, 200)
    }
    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
  })
  return loaded
}

/** Resolves after the window `load` event and the next frame (the hero clip). */
export function afterFirstPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    const frame = () => window.requestAnimationFrame(() => resolve())
    if (document.readyState === 'complete') frame()
    else window.addEventListener('load', frame, { once: true })
  })
}
