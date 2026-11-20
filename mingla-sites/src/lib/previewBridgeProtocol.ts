import { PREVIEW_SECTION_ID_RE } from "../contracts/generated/previewSections.ts";
import { PREVIEW_TOKENS_MESSAGE } from "./previewTokens";

/*
 * #4453 website workspace (build contract D) — every message the private
 * preview and the window that frames it (Host web, or the Host app's native
 * WebView) send each other. THE one file for the message types: the bridge
 * (previewBridge.ts) and its tests import from here, and a copy-ready
 * declaration for the Host lives beside the build contract
 * (preview-protocol.d.ts).
 *
 * Geometry. Every `top` and `left` is in CSS pixels of the preview's own
 * DOCUMENT (measured from the top-left of the page, not of the visible
 * window), so a section's numbers do not change while the page scrolls;
 * `scroll_y` says how far the page is scrolled. On screen a section is at
 * `top - scroll_y`. Numbers are whole pixels.
 *
 * Trust. The preview accepts a message only from the window that frames it,
 * and only when that window's origin may frame it (`previewParentAllowed`).
 * It sends only to such an origin, never to "*". Nothing here carries a
 * secret: section ids, positions, and text the owner typed.
 */

// ---------------------------------------------------------------- frame → parent

export const PREVIEW_READY_MESSAGE = "mingla:preview-ready";
export const PREVIEW_SELECT_MESSAGE = "mingla:preview-select";
export const PREVIEW_RECTS_MESSAGE = "mingla:preview-rects";

/** A section drawn on the page. `type` is the section type Studio stores (`hero`, `faq`, …). */
export type PreviewSectionBox = { id: string; type: string; top: number; height: number };

/**
 * The page has rendered and its sections are marked. Sent once the layout has
 * settled after load; sent AGAIN if the frame only learns who its parent is
 * later (a parent that never got the first one), so treat it as idempotent.
 * `sections` lists, top to bottom, the sections that drew something; a
 * section that draws nothing on this page (or whose id Studio did not give)
 * is not listed. An offering page has no sections: `sections` is [].
 */
export type PreviewReadyMessage = {
  type: typeof PREVIEW_READY_MESSAGE;
  /** The page shown, as in the preview address: "" is Home, else `about`, `trips/rome`. */
  page_path: string;
  sections: PreviewSectionBox[];
  scroll_y: number;
  doc_height: number;
};

/** The owner picked a section (a click, or Enter / Space on it). Only sent in edit mode. */
export type PreviewSelectMessage = {
  type: typeof PREVIEW_SELECT_MESSAGE;
  section_id: string;
  rect: { top: number; left: number; width: number; height: number };
  /** Additive to the contract: the scroll position `rect` was measured at. */
  scroll_y: number;
};

/** Sections moved or the page scrolled. At most one per animation frame, and only when something changed. */
export type PreviewRectsMessage = {
  type: typeof PREVIEW_RECTS_MESSAGE;
  sections: Array<{ id: string; top: number; height: number }>;
  scroll_y: number;
  /** Additive to the contract: the page's full height, which changes with the layout. */
  doc_height: number;
};

export type PreviewFrameMessage = PreviewReadyMessage | PreviewSelectMessage | PreviewRectsMessage;

// ---------------------------------------------------------------- parent → frame

export { PREVIEW_TOKENS_MESSAGE };
export const PREVIEW_MODE_MESSAGE = "mingla:preview-mode";
export const PREVIEW_MARKS_MESSAGE = "mingla:preview-marks";
export const PREVIEW_SCROLL_TO_MESSAGE = "mingla:preview-scroll-to";
export const PREVIEW_TEXT_MESSAGE = "mingla:preview-text";
export const PREVIEW_RESTORE_SCROLL_MESSAGE = "mingla:preview-restore-scroll";

/** Unsaved colours, shape and motion (#2829 W9r; unchanged). Each entry is `--name:value`. */
export type PreviewTokensMessage = { type: typeof PREVIEW_TOKENS_MESSAGE; declarations: string[] };

/**
 * Edit mode. On: a click or Enter on a section selects it and nothing on the
 * page navigates, submits or opens. Off (the default): the page behaves like
 * the live site.
 */
export type PreviewModeMessage = { type: typeof PREVIEW_MODE_MESSAGE; edit: boolean };

export type PreviewUnreadBy = "ari" | "team" | "composer";

/**
 * What the preview draws over the page. Each message REPLACES the previous
 * marks. `selected` gets an outline; `ari` gets an outline and "Ari is
 * changing this"; each `unread` section gets "Read me" (`by: "team"` reads
 * "Read me · made by the Mingla team"). An id that is not on this page is
 * ignored.
 */
export type PreviewMarksMessage = {
  type: typeof PREVIEW_MARKS_MESSAGE;
  selected: string | null;
  ari: string | null;
  unread: Array<{ id: string; by: PreviewUnreadBy }>;
};

/** Bring a section into view. */
export type PreviewScrollToMessage = { type: typeof PREVIEW_SCROLL_TO_MESSAGE; section_id: string };

/**
 * Show typed text before the draft is rebuilt: inside the section, the first
 * piece of text that is EXACTLY `from` becomes `to`. Silently ignored when no
 * piece of text matches. Plain text only.
 */
export type PreviewTextMessage = { type: typeof PREVIEW_TEXT_MESSAGE; section_id: string; from: string; to: string };

/** Put the page back where it was scrolled (after a rebuilt preview loads). Instant. */
export type PreviewRestoreScrollMessage = { type: typeof PREVIEW_RESTORE_SCROLL_MESSAGE; scroll_y: number };

export type PreviewParentMessage =
  | PreviewTokensMessage
  | PreviewModeMessage
  | PreviewMarksMessage
  | PreviewScrollToMessage
  | PreviewTextMessage
  | PreviewRestoreScrollMessage;

// ---------------------------------------------------------------- limits and parsing

export const PREVIEW_MAX_UNREAD = 200;
export const PREVIEW_MAX_TEXT = 5_000;
export const PREVIEW_MAX_SCROLL = 10_000_000;
/** A native WebView delivers a message as JSON text; anything longer is not one of ours. */
export const PREVIEW_MAX_MESSAGE_CHARS = 131_072;

export const PREVIEW_CHIP_TEXT = {
  ari: "Ari is changing this",
  unread: "Read me",
  unreadTeam: "Read me · made by the Mingla team",
} as const;

const isId = (value: unknown): value is string => typeof value === "string" && PREVIEW_SECTION_ID_RE.test(value);
const idOrNull = (value: unknown): string | null => (isId(value) ? value : null);

/** A message as an object: itself, or (native WebView) parsed from JSON text. Null for anything else. */
export function previewMessageObject(data: unknown): Record<string, unknown> | null {
  let value = data;
  if (typeof value === "string") {
    if (value.length > PREVIEW_MAX_MESSAGE_CHARS || value[0] !== "{") return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * A message from the parent in its checked form, or null when it is not one of
 * ours or is malformed (a malformed message does nothing at all). The token
 * message is passed through as it arrived: `previewTokenDeclarations` filters it.
 */
export function parsePreviewParentMessage(data: unknown): PreviewParentMessage | null {
  const message = previewMessageObject(data);
  if (!message) return null;
  switch (message.type) {
    case PREVIEW_TOKENS_MESSAGE:
      return {
        type: PREVIEW_TOKENS_MESSAGE,
        declarations: Array.isArray(message.declarations) ? message.declarations.filter((entry): entry is string => typeof entry === "string") : [],
      };
    case PREVIEW_MODE_MESSAGE:
      return typeof message.edit === "boolean" ? { type: PREVIEW_MODE_MESSAGE, edit: message.edit } : null;
    case PREVIEW_MARKS_MESSAGE: {
      const unread: PreviewMarksMessage["unread"] = [];
      const seen = new Set<string>();
      for (const entry of Array.isArray(message.unread) ? message.unread.slice(0, PREVIEW_MAX_UNREAD) : []) {
        const row = entry as { id?: unknown; by?: unknown } | null;
        if (!row || !isId(row.id) || seen.has(row.id)) continue;
        if (row.by !== "ari" && row.by !== "team" && row.by !== "composer") continue;
        seen.add(row.id);
        unread.push({ id: row.id, by: row.by });
      }
      return { type: PREVIEW_MARKS_MESSAGE, selected: idOrNull(message.selected), ari: idOrNull(message.ari), unread };
    }
    case PREVIEW_SCROLL_TO_MESSAGE:
      return isId(message.section_id) ? { type: PREVIEW_SCROLL_TO_MESSAGE, section_id: message.section_id } : null;
    case PREVIEW_TEXT_MESSAGE:
      return isId(message.section_id) &&
          typeof message.from === "string" && message.from.length > 0 && message.from.length <= PREVIEW_MAX_TEXT &&
          typeof message.to === "string" && message.to.length <= PREVIEW_MAX_TEXT
        ? { type: PREVIEW_TEXT_MESSAGE, section_id: message.section_id, from: message.from, to: message.to }
        : null;
    case PREVIEW_RESTORE_SCROLL_MESSAGE:
      return typeof message.scroll_y === "number" && Number.isFinite(message.scroll_y) && message.scroll_y >= 0 && message.scroll_y <= PREVIEW_MAX_SCROLL
        ? { type: PREVIEW_RESTORE_SCROLL_MESSAGE, scroll_y: Math.round(message.scroll_y) }
        : null;
    default:
      return null;
  }
}
