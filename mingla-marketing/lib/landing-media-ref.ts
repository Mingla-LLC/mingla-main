// #4339 — a landing media reference (`v:<clip>` or `p:<photo>`) and where its
// files live. Split from content/host-landing/icps.ts (#4339 speed fix) so the
// client media player (components/landing/landing-media.tsx) and the reel
// carousel import a few lines instead of every landing page's copy.

// #4636: `mv:<uuid>` / `mp:<uuid>` are media library items (a clip / a still),
// resolved from a block's `m:<uuid>` by lib/site-blocks/media.ts. Plain public
// storage object URLs: never /render/image (#1643, I-4636-NO-IMAGE-TRANSFORMS).
export type LandingMediaRef = `v:${string}` | `p:${string}` | `mv:${string}` | `mp:${string}`

export interface ResolvedLandingMedia {
  readonly kind: 'video' | 'photo'
  /** The clip (video only). */
  readonly src: string | null
  /** The still: the clip's poster, or the photo itself. */
  readonly poster: string
}

const MEDIA_ROOT = '/marketing/site'
const LIBRARY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The public object root of the site buckets ('' when the site has no Supabase URL). */
export function libraryRoot(): string {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '')}/storage/v1/object/public`
}

/** True for a media library file (served as-is: no -sm / .webm / .webp siblings). */
export function isLibraryUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/site-')
}

export function resolveLandingMedia(ref: LandingMediaRef): ResolvedLandingMedia {
  if (ref.startsWith('mv:') || ref.startsWith('mp:')) {
    const id = ref.slice(3)
    if (!LIBRARY_ID.test(id)) throw new Error(`#4636 library media id is not a uuid: ${ref}`)
    const root = libraryRoot()
    return ref.startsWith('mv:')
      ? { kind: 'video', src: `${root}/site-video/library/${id}.mp4`, poster: `${root}/site-media/library/${id}_poster.jpg` }
      : { kind: 'photo', src: null, poster: `${root}/site-media/library/${id}.jpg` }
  }
  const name = ref.slice(2)
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`#4339 landing media name is not a plain slug: ${ref}`)
  if (ref.startsWith('v:')) {
    return { kind: 'video', src: `${MEDIA_ROOT}/m/${name}.mp4`, poster: `${MEDIA_ROOT}/m/${name}.jpg` }
  }
  return { kind: 'photo', src: null, poster: `${MEDIA_ROOT}/p/${name}.jpg` }
}
