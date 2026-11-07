// issue #1023 — platform-neutral rules for the theme entrance motion:
// the text-safe zone, the dev-only `?motion=` preview override and the
// per-device paused preference. Pure (no react-native imports) so the native
// and web components share one definition and tests run without a renderer.

import { THEME_ANIMATION_SLUGS, type ThemeAnimationSlug } from "./designTokens";

/* -------------------------------------------------------- text-safe zone -- */

/** The rect of on-cover text, relative to the animation container (points). */
export interface TextSafeZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where on-cover text sits when it could not be measured: the approved
 * reference's zone, from 47% of the height down with 6% side gutters.
 */
export const DEFAULT_TEXT_SAFE_ZONE = { topFraction: 0.47, sideFraction: 0.06 } as const;

/** Opacity of motion inside the zone, per phase (reference: ~50% / ~86% removed). */
export const SAFE_ZONE_OPACITY = { intro: 0.5, loop: 0.14 } as const;
export const SAFE_ZONE_FEATHER = 16;

export type TextSafeZoneProp = TextSafeZone | "default" | null | undefined;

/**
 * `undefined`/`null` = no text on the animation, so no zone. `"default"` =
 * text overlaps but was not measured (yet): the reference zone. A rect is
 * clamped to the container and dropped when empty.
 */
export function resolveTextSafeZone(
  zone: TextSafeZoneProp,
  width: number,
  height: number,
): TextSafeZone | null {
  if (zone === null || zone === undefined || width <= 0 || height <= 0) return null;
  if (zone === "default") {
    const side = width * DEFAULT_TEXT_SAFE_ZONE.sideFraction;
    const top = height * DEFAULT_TEXT_SAFE_ZONE.topFraction;
    return { x: side, y: top, width: width - side * 2, height: height - top };
  }
  const x = Math.max(0, Math.min(width, zone.x));
  const y = Math.max(0, Math.min(height, zone.y));
  const right = Math.max(x, Math.min(width, zone.x + zone.width));
  const bottom = Math.max(y, Math.min(height, zone.y + zone.height));
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export interface SafeZoneBand {
  top: number;
  height: number;
  opacity: number;
}

/**
 * Native has no masking primitive (adding a masked-view native module would
 * need a store build), so the zone is drawn with synchronised copies of the
 * same animation clipped into horizontal bands:
 *   full opacity above/below the zone,
 *   the midpoint opacity in a 16 pt feather band at each edge,
 *   the faded zone opacity across the zone itself.
 * Horizontal bands ignore the zone's side gutters: the on-cover text spans
 * nearly the full width, so a full-width band costs one copy instead of four.
 * Returns ONE full-opacity band when there is no zone.
 */
export function computeSafeZoneBands(
  height: number,
  zone: TextSafeZone | null,
  insideOpacity: number,
  feather: number = SAFE_ZONE_FEATHER,
): SafeZoneBand[] {
  if (height <= 0) return [];
  if (zone === null) return [{ top: 0, height, opacity: 1 }];
  const mid = (1 + insideOpacity) / 2;
  const zTop = Math.max(0, zone.y);
  const zBottom = Math.min(height, zone.y + zone.height);
  const edges: Array<[number, number, number]> = [
    [0, zTop - feather, 1],
    [zTop - feather, zTop, mid],
    [zTop, zBottom, insideOpacity],
    [zBottom, zBottom + feather, mid],
    [zBottom + feather, height, 1],
  ];
  const out: SafeZoneBand[] = [];
  for (const [a, b, opacity] of edges) {
    const top = Math.max(0, a);
    const bottom = Math.min(height, b);
    if (bottom - top >= 0.5) out.push({ top, height: bottom - top, opacity });
  }
  return out;
}

export interface FollowBand {
  /** Offset of the band's top edge from the moving zone top (points). */
  from: number;
  height: number;
  opacity: number;
}

/**
 * Native, FULL-SCREEN overlay whose text zone is the page's details sheet:
 * everything below the sheet's top edge is page text, and that edge moves as
 * the page scrolls. Three bands are positioned RELATIVE to the edge (so a
 * single moving value — `translateY = edge + from` — drives all of them, no
 * re-render per scroll frame): full strength above, the feather, then the
 * faded zone down to the bottom of the screen.
 */
export function computeFollowBands(
  height: number,
  insideOpacity: number,
  feather: number = SAFE_ZONE_FEATHER,
): FollowBand[] {
  if (height <= 0) return [];
  return [
    { from: -height, height: height - feather, opacity: 1 },
    { from: -feather, height: feather, opacity: (1 + insideOpacity) / 2 },
    { from: 0, height, opacity: insideOpacity },
  ];
}

/**
 * Web: the text zone is the on-screen rect of the page's details element,
 * relative to the full-screen overlay, clamped to it. Null when the element is
 * entirely off screen (no text under the motion).
 */
export function zoneFromRects(
  target: { left: number; top: number; right: number; bottom: number },
  overlay: { left: number; top: number; width: number; height: number },
): TextSafeZone | null {
  return resolveTextSafeZone(
    {
      x: target.left - overlay.left,
      y: target.top - overlay.top,
      width: target.right - target.left,
      height: target.bottom - target.top,
    },
    overlay.width,
    overlay.height,
  );
}

/**
 * Web: one CSS mask. Fully opaque outside the zone, `insideOpacity` inside, a
 * blurred (soft) edge between, drawn as an SVG data URL sized to the
 * container. Returns null when there is no zone.
 */
export function buildSafeZoneMaskUrl(
  width: number,
  height: number,
  zone: TextSafeZone | null,
  insideOpacity: number,
  feather: number = SAFE_ZONE_FEATHER,
): string | null {
  if (zone === null || width <= 0 || height <= 0) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  const pad = feather * 4;
  const zx = Math.round(zone.x);
  const zy = Math.round(zone.y);
  const zw = Math.round(zone.width);
  const zh = Math.round(zone.height);
  // Outer frame (well past the edges so the blur never thins the border)
  // with the zone cut out, plus the zone itself at `insideOpacity`.
  const frame =
    `M${-pad} ${-pad}H${w + pad}V${h + pad}H${-pad}Z` +
    `M${zx} ${zy}V${zy + zh}H${zx + zw}V${zy}Z`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<filter id='f' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='${(feather / 2.5).toFixed(1)}'/></filter>` +
    `<g filter='url(#f)'><path d='${frame}' fill='#000' fill-rule='evenodd'/>` +
    `<rect x='${zx}' y='${zy}' width='${zw}' height='${zh}' fill='#000' fill-opacity='${insideOpacity}'/></g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/* --------------------------------------------- dev-only preview override -- */

const ANIMATED_SLUGS = new Set<string>(THEME_ANIMATION_SLUGS.filter((s) => s !== "none"));

export const isPreviewableMotionSlug = (value: unknown): value is ThemeAnimationSlug =>
  typeof value === "string" && (value === "none" || ANIMATED_SLUGS.has(value));

/** Reads `?motion=<slug>` from a query string. Only a known slug counts. */
export function parseMotionQueryParam(search: string | null | undefined): ThemeAnimationSlug | null {
  if (typeof search !== "string" || search.length === 0) return null;
  const match = /[?&]motion=([^&#]*)/.exec(search.startsWith("?") ? search : `?${search}`);
  if (match === null) return null;
  const value = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
  return isPreviewableMotionSlug(value) ? value : null;
}

let devOverride: ThemeAnimationSlug | null = null;
/** Bumped on every set, so re-sending the SAME slug still replays the entrance. */
let devOverrideVersion = 0;
const devListeners = new Set<() => void>();

/**
 * Dev builds only: make every mounted entrance layer play `slug` (null
 * clears). The business Theme sheet calls this for preview-only tiles so the
 * real public pages behind it show the pick without saving. A no-op when
 * `isDev` is false, so a production build can never be overridden.
 */
export function setThemeMotionDevOverride(slug: ThemeAnimationSlug | null, isDev: boolean): void {
  if (!isDev) return;
  devOverride = slug;
  devOverrideVersion += 1;
  devListeners.forEach((listener) => listener());
}

export function getThemeMotionDevOverride(): ThemeAnimationSlug | null {
  return devOverride;
}

export function getThemeMotionDevOverrideVersion(): number {
  return devOverrideVersion;
}

export function subscribeThemeMotionDevOverride(listener: () => void): () => void {
  devListeners.add(listener);
  return () => {
    devListeners.delete(listener);
  };
}

/**
 * The slug a mount actually plays. The override (sheet pick, or `?motion=` on
 * web) wins ONLY when `isDev` is true; production always plays the theme.
 */
export function resolveThemeMotionSlug(
  themeSlug: ThemeAnimationSlug,
  override: ThemeAnimationSlug | null,
  isDev: boolean,
): ThemeAnimationSlug {
  if (!isDev || override === null) return themeSlug;
  return override;
}

/* ------------------------------------------------- paused, per device ---- */

export const MOTION_PAUSED_STORAGE_KEY = "mingla.themeMotion.paused";

export interface MotionPauseStorage {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
}

export interface MotionPauseStore {
  get: () => boolean;
  set: (paused: boolean) => void;
  subscribe: (listener: () => void) => () => void;
  hydrate: () => Promise<void>;
}

/**
 * One paused flag shared by every entrance layer on the device, remembered
 * across visits. Storage failures (private mode, quota, a missing native
 * module) never break playback: the flag still works for this session and
 * the failure is reported through `onError`.
 */
export function createMotionPauseStore(
  storage: MotionPauseStorage,
  onError: (error: unknown) => void,
): MotionPauseStore {
  let paused = false;
  let hydrated: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());
  return {
    get: () => paused,
    set: (next) => {
      if (next === paused) return;
      paused = next;
      emit();
      storage.write(next ? "1" : "0").catch(onError);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate: () => {
      if (hydrated === null) {
        hydrated = storage
          .read()
          .then((value) => {
            const next = value === "1";
            if (next !== paused) {
              paused = next;
              emit();
            }
          })
          .catch(onError);
      }
      return hydrated;
    },
  };
}
