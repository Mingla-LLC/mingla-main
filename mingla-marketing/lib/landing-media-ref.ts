// #4339 — a landing media reference (`v:<clip>` or `p:<photo>`) and where its
// files live. Split from content/host-landing/icps.ts (#4339 speed fix) so the
// client media player (components/landing/landing-media.tsx) and the reel
// carousel import a few lines instead of every landing page's copy.

export type LandingMediaRef = `v:${string}` | `p:${string}`

export interface ResolvedLandingMedia {
  readonly kind: 'video' | 'photo'
  /** The clip (video only). */
  readonly src: string | null
  /** The still: the clip's poster, or the photo itself. */
  readonly poster: string
}

const MEDIA_ROOT = '/marketing/site'

export function resolveLandingMedia(ref: LandingMediaRef): ResolvedLandingMedia {
  const name = ref.slice(2)
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`#4339 landing media name is not a plain slug: ${ref}`)
  if (ref.startsWith('v:')) {
    return { kind: 'video', src: `${MEDIA_ROOT}/m/${name}.mp4`, poster: `${MEDIA_ROOT}/m/${name}.jpg` }
  }
  return { kind: 'photo', src: null, poster: `${MEDIA_ROOT}/p/${name}.jpg` }
}
