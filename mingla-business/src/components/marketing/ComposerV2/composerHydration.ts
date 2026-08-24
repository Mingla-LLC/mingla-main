/**
 * #2517 — draft-hydration decision for the campaign composer.
 *
 * Lives in its own module, deliberately: it must be unit-testable WITHOUT
 * pulling in `richEditor.tsx`, which imports Tiptap and (independently of this
 * fix) does not type-check under the pinned @tiptap version. A pure decision
 * function should not need a WebView to be proven.
 */

/**
 * Should the editor adopt a body that arrived AFTER mount?
 *
 * `initialContentHtml` in `ComposerV2Editor` is frozen at mount, while
 * `compose.tsx` hydrates a draft in an effect that awaits
 * `getCampaign(draftId)`. On Resume the editor therefore mounted with an EMPTY
 * snapshot, the preview filled in from parent state, and the editor stayed
 * blank forever — every saved draft opened uneditable.
 *
 * Each guard answers one of two questions: "has the draft actually arrived?"
 * and "would adopting it destroy something the operator typed?"
 *
 * - `alreadyHydrated` — one shot per mount, so a later parent re-render can
 *   never re-push and clobber live edits.
 * - `editorReady` — `setContentHTML` is a no-op before the editor's
 *   `editorInitializedCallback` fires.
 * - `incomingBodyHtml` empty — nothing to adopt; a new campaign starts blank.
 * - `lastEmittedBodyHtml` non-empty — the operator began typing before the
 *   fetch landed. Their words win; the stored draft is left alone.
 */
export function shouldAdoptDraftBody(input: {
  alreadyHydrated: boolean;
  editorReady: boolean;
  incomingBodyHtml: string;
  lastEmittedBodyHtml: string;
}): boolean {
  if (input.alreadyHydrated) return false;
  if (!input.editorReady) return false;
  if (input.incomingBodyHtml.length === 0) return false;
  if (input.lastEmittedBodyHtml.length > 0) return false;
  return true;
}
