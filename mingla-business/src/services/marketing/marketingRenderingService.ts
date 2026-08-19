/**
 * marketingRenderingService — client-side preview-only renderer.
 *
 * The composer's "Preview email" sub-sheet renders body + first-buyer-name
 * substitution INLINE in React Native (no WebView) so reduce-motion +
 * dark-mode + offline all work. The server-side renderer (Deno
 * `_shared/marketingEmailRender.ts`) is what actually ships emails.
 *
 * Variable substitution mirrors the server-side set (SPEC §7.1). For
 * preview, unknown event IDs render as a placeholder card "Event card
 * (preview)". Real event card rendering happens server-side.
 */

export interface PreviewVariables {
  first_name?: string | null;
  event_name?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  doors_open?: string | null;
  brand_name?: string | null;
  event_url?: string | null;
  spots_left?: string | null;
  previous_event_name?: string | null;
  next_event_name?: string | null;
  event_id?: string | null;
}

export interface PreviewBlock {
  kind: "paragraph" | "event_card";
  /** For paragraph: the substituted text. For event_card: token event ID. */
  content: string;
}

const VAR_RE =
  /\{(first_name|event_name|event_date|event_time|doors_open|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g;
// ORCH-0891 M1: optionally capture the `|size` suffix introduced by the
// Tiptap composer rewrite + tenTapTokenBridge extension. The preview-side
// event card already renders at a fixed size; the size info is captured
// for forward-compat (M2 wires size-aware preview rendering) but ignored
// by the current paragraph/event_card splitter. Backwards-compat preserved:
// legacy `{{event:UUID}}` tokens (no suffix) still match.
//   Group 1: UUID (36 chars hex/dash)
//   Group 2: size if present, else undefined (compact | medium | large)
const EVENT_TOKEN_RE = /\{\{event:([0-9a-fA-F-]{36})(?:\|(compact|medium|large))?\}\}/g;

export function substituteVariables(
  template: string,
  variables: PreviewVariables,
): string {
  return template.replace(VAR_RE, (_match, key: string) => {
    const value = (variables as Record<string, string | null | undefined>)[key];
    if (value === null || value === undefined) return "";
    return value;
  });
}

/**
 * Split the composer body into preview blocks. Each `{{event:<id>}}` token
 * becomes its own block; everything between is a paragraph block.
 */
export function previewBlocks(
  bodyHtml: string,
  variables: PreviewVariables,
): PreviewBlock[] {
  const substituted = substituteVariables(bodyHtml, variables);
  const blocks: PreviewBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EVENT_TOKEN_RE.lastIndex = 0;
  while ((match = EVENT_TOKEN_RE.exec(substituted)) !== null) {
    const before = substituted.slice(lastIndex, match.index).trim();
    if (before.length > 0) {
      blocks.push({ kind: "paragraph", content: before });
    }
    blocks.push({ kind: "event_card", content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  const tail = substituted.slice(lastIndex).trim();
  if (tail.length > 0) blocks.push({ kind: "paragraph", content: tail });
  return blocks;
}

// issue #2291 — `validateChannelPayload` lived here and was DEAD CODE: it
// encoded exactly the right rule (`subject.trim()` and `body_html.trim()`
// non-empty) and had ZERO production callers, its only references in the whole
// monorepo being its own definition and its own test. It also dereferenced
// without a guard, so it would have thrown on the very payload it existed to
// reject, and its SMS arm still answered "SMS channel not yet enabled" though
// SMS has been live since META-ORCH-1161.
//
// It is replaced — not duplicated — by `./campaignPayloadContract.ts`, which is
// null-safe, knows SMS is live, and is mirrored byte-for-behaviour in
// `supabase/functions/_shared/campaignPayloadContract.ts` so the composer and
// the send path answer the same question the same way. Import it from there.
