// #4636 — media library references in block content.
//
// A block stores a library item as `m:<uuid>` (the registry accepts the shape;
// the database checks the item exists). The public read (site_public_page)
// returns a map of the items a page uses. Before rendering, each `m:<uuid>` is
// turned into a reference the landing media player can draw:
//   `mv:<uuid>`  a clip  (site-video/library/<uuid>.mp4, poster site-media/library/<uuid>_poster.jpg)
//   `mp:<uuid>`  a still (site-media/library/<uuid>.jpg)
// (lib/landing-media-ref.ts builds the plain public object URLs: never
// /render/image, hold #1643, I-4636-NO-IMAGE-TRANSFORMS).
//
// A block that names a library item the map does not have is reported and
// skipped, never drawn with a broken file.
//
// No imports: plain node tests load this file by stripping its types.

export interface LibraryMedia {
  kind: 'image' | 'video'
  bucket?: string
  path?: string
  thumb_path?: string
  width?: number
  height?: number
  alt?: string
  duration_seconds?: number | null
}

export type MediaMap = Readonly<Record<string, LibraryMedia>>

const LIBRARY_REF = /^m:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** Every library id a value names (deep). */
export function libraryIds(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    const m = LIBRARY_REF.exec(value)
    if (m?.[1]) out.add(m[1])
  } else if (Array.isArray(value)) {
    for (const v of value) libraryIds(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) libraryIds(v, out)
  }
  return out
}

/** The value with each known `m:<uuid>` turned into `mv:` / `mp:`; `missing` lists the ids the map lacks. */
export function resolveLibraryRefs<T>(value: T, media: MediaMap | null | undefined): { value: T; missing: string[] } {
  const missing: string[] = []
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = LIBRARY_REF.exec(v)
      if (!m?.[1]) return v
      const item = media?.[m[1]]
      if (!item || (item.kind !== 'image' && item.kind !== 'video')) {
        missing.push(m[1])
        return v
      }
      return `${item.kind === 'video' ? 'mv' : 'mp'}:${m[1]}`
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x)
      return o
    }
    return v
  }
  return { value: walk(value) as T, missing }
}
