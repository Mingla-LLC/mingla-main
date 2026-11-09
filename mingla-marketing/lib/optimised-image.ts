// #4339 speed fix — a srcset over Next's image optimiser (/_next/image) for a
// server component, without importing next/image. Importing next/image (even
// just getImageProps) registers its client <Image> component with the page, so
// the route ships ~5 KB of image JavaScript it never runs. This builds the same
// URLs as next/image's default loader (`url`, `w`, `q`), for widths that are in
// Next's default device/image sizes (the optimiser refuses any other width).

const OPTIMISER_WIDTHS = [384, 640, 750, 828, 1080] as const
const QUALITY = 75

export type OptimiserWidth = (typeof OPTIMISER_WIDTHS)[number]

export function optimisedImageUrl(src: string, width: OptimiserWidth): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${QUALITY}`
}

/** `src` (the widest candidate, for browsers without srcset) and `srcSet`. */
export function optimisedImageSources(src: string, widths: readonly OptimiserWidth[] = OPTIMISER_WIDTHS): { src: string; srcSet: string } {
  const sorted = [...widths].sort((a, b) => a - b)
  return {
    src: optimisedImageUrl(src, sorted[sorted.length - 1]),
    srcSet: sorted.map((width) => `${optimisedImageUrl(src, width)} ${width}w`).join(', '),
  }
}
