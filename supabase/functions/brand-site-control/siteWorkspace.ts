/**
 * #4453 website workspace (build contract A, B, E) — what Core adds for the
 * Website workspace in Host.
 *
 * Core stays the gate it is for every other Website action: it checks the
 * member's live rank (the content minimum for all of these), signs the site,
 * brand, member and rank into Studio's request, and for Ari's steps signs the
 * same Mingla facts as for every designer write. Studio does the work; these
 * are only the names Core lets through and the refusals it relays.
 *
 *   - Owner actions on POST /v1/sites/<id>/content (`WORKSPACE_CONTENT_ACTIONS`).
 *   - Ari's actions on POST /v1/sites/<id>/ari (`WORKSPACE_ARI_ACTIONS`). A
 *     section Ari changes in the workspace always starts Draft, so Core signs
 *     `review_drafts` in for them whatever SITES_PROOF_PART says.
 *   - Each refusal has one plain sentence for the owner, and only bounded
 *     detail passes (which field, how long it may be, which layouts exist).
 */
type JsonObject = Record<string, unknown>;

/** The section editor, the look, and undo / redo. All at the content minimum rank (20). */
export const WORKSPACE_CONTENT_ACTIONS: ReadonlySet<string> = new Set([
  "workspace", "page_sections", "section_catalog",
  "edit_section", "move_section", "remove_section", "add_section", "set_section_media",
  "set_look", "set_page_enabled",
  "history", "undo", "redo",
]);

/** Ari's planning snapshot, one typed step, and rolling a change set back. */
export const WORKSPACE_ARI_ACTIONS: ReadonlySet<string> = new Set([
  "get_site_workspace", "apply_site_change", "undo_site_change_group",
]);

export const WORKSPACE_MESSAGES = {
  SECTION_NOT_FOUND: "That section isn't on this page any more.",
  FIELD_NOT_EDITABLE: "That part of the section can't be changed here.",
  FIELD_REQUIRED: "This can't be left empty.",
  VALUE_TOO_LONG: "That's too long for this spot. Shorten it and try again.",
  LAYOUT_NOT_IN_DESIGN: "Your style doesn't have that layout. Choose one of the layouts shown.",
  SECTION_TYPE_NOT_AVAILABLE: "That kind of section can't be added here.",
  SECTION_LIMIT_REACHED: "This page is full. Remove a section before adding another.",
  SECTION_CANNOT_BE_REMOVED: "Your home page keeps its top picture. You can change the picture instead.",
  HOME_ALWAYS_ON: "Your home page is always on.",
  MEDIA_REQUIRED: "Choose a photo for this section first.",
  CHANGED_SINCE: "This has been changed since, so that step can't be undone or redone from here.",
  NOTHING_TO_UNDO: "There's nothing to undo.",
  NOTHING_TO_REDO: "There's nothing to redo.",
  UNREADABLE_COLOURS: "Those colours would make some words hard to read.",
} as const;

/** Refusals the Ari route already names; the content route learns them here, in the owner's words. */
export const WORKSPACE_CONTENT_MEDIA_MESSAGES = {
  MEDIA_NOT_FOUND: "That photo or video isn't in your library.",
  MEDIA_WRONG_KIND: "That spot needs a different kind of file.",
} as const;

export type WorkspaceCode = keyof typeof WORKSPACE_MESSAGES;
export type WorkspaceContentCode = WorkspaceCode | keyof typeof WORKSPACE_CONTENT_MEDIA_MESSAGES;

export function isWorkspaceCode(value: unknown): value is WorkspaceContentCode {
  return typeof value === "string" && (Object.prototype.hasOwnProperty.call(WORKSPACE_MESSAGES, value) ||
    Object.prototype.hasOwnProperty.call(WORKSPACE_CONTENT_MEDIA_MESSAGES, value));
}

const HEX = /^#[0-9a-f]{6}$/i;
const text = (value: unknown, max: number): string | undefined => (typeof value === "string" ? value.slice(0, max) : undefined);
const texts = (value: unknown, count: number, max: number): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, count).map((item) => item.slice(0, max)) : undefined;

/** The detail of a workspace refusal that may reach the app: named keys only, each bounded. */
export function workspaceDetail(error: JsonObject): JsonObject {
  const detail: JsonObject = {};
  const key = text(error.key, 120);
  if (key !== undefined) detail.key = key;
  if (typeof error.max === "number" && Number.isFinite(error.max)) detail.max = error.max;
  const layouts = texts(error.layouts, 20, 60);
  if (layouts) detail.layouts = layouts;
  const problems = texts(error.problems, 8, 300);
  if (problems) detail.problems = problems;
  if (error.target === "page" || error.target === "look" || error.target === "menu") detail.target = error.target;
  const pageId = text(error.page_id, 64);
  if (pageId !== undefined && /^[A-Za-z0-9-]{1,64}$/.test(pageId)) detail.page_id = pageId;
  if (Array.isArray(error.suggestions)) {
    detail.suggestions = error.suggestions.slice(0, 8).filter((row): row is JsonObject => Boolean(row) && typeof row === "object").map((row) => ({
      sentence: text(row.sentence, 300) ?? "",
      foreground: typeof row.foreground === "string" && HEX.test(row.foreground) ? row.foreground : null,
      background: typeof row.background === "string" && HEX.test(row.background) ? row.background : null,
      nearest_readable: typeof row.nearest_readable === "string" && HEX.test(row.nearest_readable) ? row.nearest_readable : null,
    }));
  }
  return detail;
}
