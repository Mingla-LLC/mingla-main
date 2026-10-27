/**
 * Issue #4114 Wave 7 — the media card layout, in one dependency-free module
 * (no React Native imports, so it runs under Deno).
 *
 *   * A card is up to 72% of the screen width and keeps the photo's or
 *     video's shape, clamped between 3:4 (portrait) and 16:9 (landscape).
 *     Unknown dimensions draw a 4:3 card. Corners are 20pt.
 *   * 14pt of space separates a media card from anything above or below it;
 *     plain bubbles keep their tight grouping (1pt inside a run, 6pt at its end).
 *   * Photos sent together (same sender, same album id) become one album:
 *     up to 4 tiles in a 2×2 grid, "+N" on the 4th tile when there are more,
 *     and tapping a tile opens the lightbox at that photo.
 *   * A video's length reads m:ss (h:mm:ss past an hour).
 */

export const MEDIA_CARD_MAX_WIDTH_RATIO = 0.72;
/** Narrowest shape (width / height): 3:4 portrait. */
export const MEDIA_MIN_ASPECT = 3 / 4;
/** Widest shape (width / height): 16:9 landscape. */
export const MEDIA_MAX_ASPECT = 16 / 9;
export const MEDIA_DEFAULT_ASPECT = 4 / 3;
export const MEDIA_CARD_RADIUS = 20;
/** Space above and below a media card. */
export const MEDIA_CARD_GAP = 14;
/** Plain bubbles: inside a run, and at the end of a run. */
export const BUBBLE_GAP_CONTINUE = 1;
export const BUBBLE_GAP_GROUP_END = 6;
export const ALBUM_MAX_TILES = 4;
export const ALBUM_TILE_GAP = 3;
export const PLAY_BUTTON_SIZE = 50;

export interface MediaCardSize {
  width: number;
  height: number;
  aspect: number;
}

export function clampMediaAspect(width: number | null | undefined, height: number | null | undefined): number {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MEDIA_DEFAULT_ASPECT;
  }
  return Math.min(MEDIA_MAX_ASPECT, Math.max(MEDIA_MIN_ASPECT, width / height));
}

export function mediaCardSize(args: {
  screenWidth: number;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}): MediaCardSize {
  const width = Math.round(Math.max(0, args.screenWidth) * MEDIA_CARD_MAX_WIDTH_RATIO);
  const aspect = clampMediaAspect(args.mediaWidth, args.mediaHeight);
  return { width, height: Math.round(width / aspect), aspect };
}

/** An album is always square tiles in a 2-column grid. */
export function albumCardSize(screenWidth: number, count: number): MediaCardSize {
  const width = Math.round(Math.max(0, screenWidth) * MEDIA_CARD_MAX_WIDTH_RATIO);
  const tile = (width - ALBUM_TILE_GAP) / 2;
  const rows = Math.min(ALBUM_MAX_TILES, Math.max(1, count)) > 2 ? 2 : 1;
  const height = Math.round(rows * tile + (rows - 1) * ALBUM_TILE_GAP);
  return { width, height, aspect: width / Math.max(1, height) };
}

export interface AlbumTile {
  /** Index into the album's items (and the lightbox). */
  index: number;
  /** "+N" on the last visible tile when more items exist. */
  overflow: number;
}

export function albumTiles(count: number): AlbumTile[] {
  const visible = Math.min(ALBUM_MAX_TILES, Math.max(0, count));
  const hidden = Math.max(0, count - ALBUM_MAX_TILES);
  return Array.from({ length: visible }, (_, index) => ({
    index,
    overflow: index === visible - 1 ? hidden : 0,
  }));
}

export type BubbleKind = 'media' | 'plain';

/**
 * The space under a row (the thread is drawn bottom-up, so "under" is the gap
 * to the next message). Media cards get 14pt on both sides: a plain bubble
 * above or below a card still sits 14pt away.
 */
export function bubbleBottomGap(args: {
  kind: BubbleKind;
  nextKind: BubbleKind | null;
  groupEnd: boolean;
}): number {
  if (args.kind === 'media' || args.nextKind === 'media') return MEDIA_CARD_GAP;
  return args.groupEnd ? BUBBLE_GAP_GROUP_END : BUBBLE_GAP_CONTINUE;
}

/** Space above the first row of a thread when it is a media card. */
export function bubbleTopGap(args: { kind: BubbleKind; previousKind: BubbleKind | null }): number {
  return args.kind === 'media' && args.previousKind === null ? MEDIA_CARD_GAP : 0;
}

export function formatMediaDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** What an album grouping needs to know about a message. */
export interface AlbumCandidate {
  id: string;
  senderId: string;
  type: string;
  albumId?: string | null;
  viewOnce?: boolean;
  failed?: boolean;
}

/**
 * Groups consecutive photos of one album (same sender and album id, ordinary,
 * not failed) into runs. Input and output are in thread order (oldest first);
 * every message appears in exactly one run, so nothing is dropped.
 */
export function groupAlbums<T extends AlbumCandidate>(messages: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (const message of messages) {
    const last = runs[runs.length - 1];
    const head = last?.[0];
    const joinable =
      !!message.albumId &&
      message.type === 'image' &&
      !message.viewOnce &&
      !message.failed;
    if (
      joinable &&
      head &&
      head.albumId === message.albumId &&
      head.senderId === message.senderId &&
      head.type === 'image' &&
      !head.viewOnce &&
      !head.failed
    ) {
      last.push(message);
    } else {
      runs.push([message]);
    }
  }
  return runs;
}
