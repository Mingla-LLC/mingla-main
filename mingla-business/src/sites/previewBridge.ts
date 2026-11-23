/**
 * #4453 Website workspace — the preview bridge (build contract D), Host side.
 * The draft runs in a frame on another origin; these are the only messages
 * that cross. Everything read from the frame is validated here before any
 * component sees it, and nothing here sends more than ids, colours and the
 * owner's own words back in.
 *
 * Geometry (preview-protocol.d.ts, as built): every `top` / `left` the frame
 * sends is in DOCUMENT pixels of the frame's own page, before any scaling;
 * inside the frame a section sits at `top - scroll_y`. The frame is drawn
 * scaled, so a rect is moved by the scroll and multiplied by the scale
 * before it meets Host pixels. `ready` may arrive more than once for one
 * load (treat it as idempotent), and lists only sections that drew something.
 */
import type { WorkspaceSection } from "./contentApi";

export const PREVIEW_READY = "mingla:preview-ready";
export const PREVIEW_SELECT = "mingla:preview-select";
export const PREVIEW_RECTS = "mingla:preview-rects";
export const PREVIEW_MODE = "mingla:preview-mode";
export const PREVIEW_MARKS = "mingla:preview-marks";
export const PREVIEW_SCROLL_TO = "mingla:preview-scroll-to";
export const PREVIEW_TEXT = "mingla:preview-text";
export const PREVIEW_RESTORE_SCROLL = "mingla:preview-restore-scroll";
/** #4572 item 1 — the frame's page says the grant is for an older draft (refresh it), or it couldn't load. */
export const PREVIEW_STALE = "mingla:preview-stale";
export const PREVIEW_FAILED = "mingla:preview-failed";

export type FrameSection = { id: string; type: string | null; top: number; height: number };
export type FrameRect = { top: number; left: number; width: number; height: number };

export type PreviewInbound =
  | { type: typeof PREVIEW_READY; pagePath: string; sections: FrameSection[]; scrollY: number; docHeight: number }
  | { type: typeof PREVIEW_SELECT; sectionId: string; /** Document pixels. */ rect: FrameRect; scrollY: number }
  | { type: typeof PREVIEW_RECTS; sections: FrameSection[]; scrollY: number };

export type MarkBy = "ari" | "team" | "composer";
export type PreviewMarks = { selected: string | null; ari: string | null; unread: { id: string; by: MarkBy }[] };

export type PreviewOutbound =
  | { type: typeof PREVIEW_MODE; edit: boolean }
  | ({ type: typeof PREVIEW_MARKS } & PreviewMarks)
  | { type: typeof PREVIEW_SCROLL_TO; section_id: string }
  | { type: typeof PREVIEW_TEXT; section_id: string; from: string; to: string }
  | { type: typeof PREVIEW_RESTORE_SCROLL; scroll_y: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
// The same limits the frame enforces (mingla-sites previewBridgeProtocol.ts).
const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SECTIONS = 200;
/** The most "read me" marks the frame keeps; later ones are dropped there. */
export const PREVIEW_UNREAD_MAX = 200;
/** The longest `from` / `to` the frame's optimistic text swap accepts. */
export const PREVIEW_TEXT_MAX = 5000;

/** Whether the frame would act on this optimistic text swap (`from` 1 to 5000 characters, `to` up to 5000). */
export function previewTextSendable(from: string, to: string): boolean {
  return from.length >= 1 && from.length <= PREVIEW_TEXT_MAX && to.length <= PREVIEW_TEXT_MAX;
}

function sectionsOf(value: unknown): FrameSection[] | null {
  if (!Array.isArray(value) || value.length > MAX_SECTIONS) return null;
  const out: FrameSection[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !SECTION_ID.test(entry.id)) return null;
    const top = num(entry.top);
    const height = num(entry.height);
    if (top === null || height === null || height < 0) return null;
    out.push({ id: entry.id, type: typeof entry.type === "string" ? entry.type : null, top, height });
  }
  return out;
}

/**
 * A message from the frame, or null when it is not one of ours or is
 * malformed. Native WebViews deliver strings, so JSON text is accepted too.
 */
export function parsePreviewMessage(raw: unknown): PreviewInbound | null {
  let data = raw;
  if (typeof raw === "string") {
    if (raw.length > 200_000 || !raw.includes("mingla:preview-")) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || typeof data.type !== "string") return null;
  if (data.type === PREVIEW_READY) {
    const sections = sectionsOf(data.sections);
    const scrollY = num(data.scroll_y);
    const docHeight = num(data.doc_height);
    if (!sections || scrollY === null || docHeight === null) return null;
    return { type: PREVIEW_READY, pagePath: typeof data.page_path === "string" ? data.page_path : "", sections, scrollY, docHeight };
  }
  if (data.type === PREVIEW_RECTS) {
    const sections = sectionsOf(data.sections);
    const scrollY = num(data.scroll_y);
    if (!sections || scrollY === null) return null;
    return { type: PREVIEW_RECTS, sections, scrollY };
  }
  if (data.type === PREVIEW_SELECT) {
    const rect = isRecord(data.rect) ? data.rect : null;
    const top = num(rect?.top);
    const left = num(rect?.left);
    const width = num(rect?.width);
    const height = num(rect?.height);
    if (typeof data.section_id !== "string" || !SECTION_ID.test(data.section_id)) return null;
    if (top === null || left === null || width === null || height === null || width < 0 || height < 0) return null;
    return { type: PREVIEW_SELECT, sectionId: data.section_id, rect: { top, left, width, height }, scrollY: num(data.scroll_y) ?? 0 };
  }
  return null;
}

/** The preview's own origin: messages from anywhere else are dropped. */
export function previewOriginOf(frameUrl: string): string | null {
  try {
    return new URL(frameUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Web: a message counts only when it came from one of OUR frames' windows.
 * The frame redirects from Studio to the site runtime, so its final origin
 * is not known in advance; the window identity is the check that cannot be
 * forged by another tab or an embedded third party.
 */
export function messageFromFrame(source: unknown, frameWindows: readonly unknown[]): number {
  if (source === null || source === undefined) return -1;
  return frameWindows.findIndex((candidate) => candidate !== null && candidate !== undefined && candidate === source);
}

/** A document rect as it sits in the frame's viewport at this scroll. */
export function viewportRect(rect: FrameRect, scrollY: number): FrameRect {
  return { ...rect, top: rect.top - scrollY };
}

/** A section's rect in the frame's viewport, from its document position and the scroll. */
export function sectionViewportRect(section: FrameSection, scrollY: number, frameWidth: number): FrameRect {
  return { top: section.top - scrollY, left: 0, width: frameWidth, height: section.height };
}

/** Frame pixels -> Host pixels inside the stage (the frame is drawn at `scale`, offset by `left`/`top`). */
export function scaleRect(rect: FrameRect, scale: number, offset: { left: number; top: number } = { left: 0, top: 0 }): FrameRect {
  const safe = scale > 0 && Number.isFinite(scale) ? scale : 1;
  return {
    top: rect.top * safe + offset.top,
    left: rect.left * safe + offset.left,
    width: rect.width * safe,
    height: rect.height * safe,
  };
}

export const ARI_CARD_WIDTH = 340;
export const ARI_CARD_MARGIN = 12;

/**
 * Where the small Ari card sits: in the selected section's top right corner,
 * kept fully inside the stage (never cut off, never under the top bar), and
 * pinned to the stage's top when the section is scrolled above it.
 */
export function ariCardPosition(
  rect: FrameRect,
  stage: { width: number; height: number },
  card: { width: number; height: number } = { width: ARI_CARD_WIDTH, height: 260 },
): { top: number; left: number; width: number } {
  const width = Math.max(0, Math.min(card.width, stage.width - ARI_CARD_MARGIN * 2));
  const wantLeft = rect.left + rect.width - width - ARI_CARD_MARGIN;
  const left = Math.max(ARI_CARD_MARGIN, Math.min(wantLeft, stage.width - width - ARI_CARD_MARGIN));
  const wantTop = rect.top + ARI_CARD_MARGIN;
  const maxTop = Math.max(ARI_CARD_MARGIN, stage.height - card.height - ARI_CARD_MARGIN);
  const top = Math.max(ARI_CARD_MARGIN, Math.min(wantTop, maxTop));
  return { top, left, width };
}

/** Who made a Draft section, in the three words the bridge can draw. */
export function markByOf(section: Pick<WorkspaceSection, "review">): MarkBy | null {
  if (!section.review || section.review.state !== "draft") return null;
  if (section.review.source === "team") return "team";
  if (section.review.source === "ari") return "ari";
  return "composer";
}

export function buildMarks(input: { sections: readonly Pick<WorkspaceSection, "id" | "review">[]; selected: string | null; ari: string | null }): PreviewMarks {
  const ids = new Set(input.sections.map((section) => section.id));
  const unread: PreviewMarks["unread"] = [];
  for (const section of input.sections) {
    const by = markByOf(section);
    if (by) unread.push({ id: section.id, by });
  }
  return {
    selected: input.selected && ids.has(input.selected) ? input.selected : null,
    ari: input.ari && ids.has(input.ari) ? input.ari : null,
    unread: unread.slice(0, PREVIEW_UNREAD_MAX),
  };
}

/** The chip the bridge draws, in words (also the Edit list's label). */
export function markLabel(by: MarkBy | null, ariWorking = false): string | null {
  if (ariWorking) return "Ari is changing this";
  if (by === "team") return "Read me · made by the Mingla team";
  return by ? "Read me" : null;
}

/* ── Flash-free refresh: two frames, swap when the new one is ready ─────── */
export type FrameSlot = { key: number; url: string; /** The page this address shows (the workspace's page id). */ page: string | null };
export type SwapState = {
  /** The frame the owner sees. */
  shown: FrameSlot | null;
  /** The next draft, loading out of sight. */
  loading: FrameSlot | null;
  /** Scroll to hand to the next frame when it swaps in (0 when the next frame shows another page). */
  scrollY: number;
  nextKey: number;
  /** The newest draft did not load, so the frame on screen is an older one. */
  stale?: boolean;
};

export const EMPTY_SWAP: SwapState = { shown: null, loading: null, scrollY: 0, nextKey: 1 };

export type SwapEvent =
  | { type: "url"; url: string | null; page?: string | null }
  | { type: "ready"; key: number }
  | { type: "scroll"; key: number; scrollY: number }
  | { type: "timeout"; key: number }
  /** The next draft never loaded, while the page on screen is alive: keep that page, and say it is behind. */
  | { type: "drop"; key: number };

/**
 * A new draft address loads in a second, hidden frame and takes over only
 * once it says it is ready (or after a short wait if the bridge is silent),
 * so the page never blanks between saves. The first address shows at once.
 */
export function swapReducer(state: SwapState, event: SwapEvent): SwapState {
  switch (event.type) {
    case "url": {
      if (event.url === null) return { ...EMPTY_SWAP, nextKey: state.nextKey };
      if (state.shown?.url === event.url) return state.loading ? { ...state, loading: null } : state;
      if (state.loading?.url === event.url) return state;
      const slot: FrameSlot = { key: state.nextKey, url: event.url, page: event.page ?? null };
      if (!state.shown) return { ...state, shown: slot, loading: null, nextKey: state.nextKey + 1 };
      return { ...state, loading: slot, nextKey: state.nextKey + 1 };
    }
    case "ready":
    case "timeout": {
      if (!state.loading || state.loading.key !== event.key) return state;
      // The same page rebuilt keeps the owner's place; another page starts at its top.
      const samePage = state.loading.page === (state.shown?.page ?? null);
      return { ...state, shown: state.loading, loading: null, scrollY: samePage ? state.scrollY : 0, stale: false };
    }
    case "drop":
      return state.loading && state.loading.key === event.key ? { ...state, loading: null, stale: true } : state;
    case "scroll":
      return state.shown?.key === event.key && state.scrollY !== event.scrollY ? { ...state, scrollY: event.scrollY } : state;
  }
}

/** How long a hidden frame may stay silent before it is shown anyway. */
export const SWAP_FALLBACK_MS = 6_000;

/**
 * Native (react-native-webview): the preview is the WebView's top document,
 * so a command is delivered by dispatching a message event on its window, as
 * the bridge's protocol asks. The data travels as JSON text.
 */
export function nativeBridgeCall(message: PreviewOutbound | { type: string; declarations: readonly string[] }): string {
  return `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(JSON.stringify(message))}}));true;`;
}

/**
 * The workspace draws the draft at the device's real CSS width, scaled down
 * to the stage's width (never up) and as tall as the stage, so the page
 * fills the space and its own breakpoints still apply.
 */
export function stageFrame(stage: { width: number; height: number }, deviceWidth: number): { scale: number; width: number; height: number; left: number } {
  if (stage.width <= 0 || stage.height <= 0 || deviceWidth <= 0) return { scale: 0, width: deviceWidth, height: 0, left: 0 };
  const scale = Math.min(stage.width / deviceWidth, 1);
  return { scale, width: deviceWidth, height: Math.ceil(stage.height / scale), left: Math.max(0, (stage.width - deviceWidth * scale) / 2) };
}
