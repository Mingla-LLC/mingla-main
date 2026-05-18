/**
 * ORCH-0864 [Marketing Composer V2] — Stage A.
 *
 * Pure parser/serializer between Mingla's `channel_payload.body_html` string
 * and a TenTap-compatible ProseMirror document. Foundation of the V2
 * composer — every keystroke flows through here on save (doc → string) and
 * every draft hydration flows through here on open (string → doc).
 *
 * Token-preservation regex (do not remove — I-PROPOSED-MKT-COMPOSER-V2-
 * TOKEN-ROUNDTRIP-LOSSLESS):
 *
 *   PERSONALIZATION_TOKEN_RE matches `{first_name}` etc — exactly the 11
 *   tokens documented in marketingRenderingService.ts line 37. EVENT_TOKEN_RE
 *   matches `{{event:<uuid>}}`. Anything else inside braces is literal text.
 *
 * Round-trip contract (asserted by T-01..T-05):
 *   - V1 string → doc → string is BYTE-IDENTICAL for the V1 token vocabulary
 *     (plain text + {token} + {{event:uuid}} + \n paragraph breaks)
 *   - V2 string (adds <strong>, <em>, <a href>) → doc → string is
 *     canonical-equivalent (attributes double-quoted, marks ordered
 *     consistently, but no token loss or position drift)
 *
 * Zero runtime dependencies — pure string functions. The actual TenTap
 * package is consumed by Stage B (custom node views + hook). The document
 * shape declared here matches ProseMirror JSON, which is what TenTap's
 * `editor.setContent()` and `editor.getJSON()` accept.
 */

export type PersonalizationToken =
  | "first_name"
  | "brand_name"
  | "event_name"
  | "event_date"
  | "event_time"
  | "doors_open"
  | "event_url"
  | "spots_left"
  | "previous_event_name"
  | "next_event_name"
  | "event_id";

const PERSONALIZATION_TOKENS: readonly PersonalizationToken[] = [
  "first_name",
  "brand_name",
  "event_name",
  "event_date",
  "event_time",
  "doors_open",
  "event_url",
  "spots_left",
  "previous_event_name",
  "next_event_name",
  "event_id",
] as const;

// I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS — DO NOT WEAKEN.
// Removing or loosening these regexes is the designated T-04 fails-on-revert
// trigger. The CI gate at .github/scripts/strict-grep/orch-0864-composer-v2.mjs
// asserts these literals exist.
const PERSONALIZATION_TOKEN_RE = new RegExp(
  `\\{(${PERSONALIZATION_TOKENS.join("|")})\\}`,
  "g",
);
const EVENT_TOKEN_RE =
  /\{\{event:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\}/gi;

// ─── Document shape (matches Tiptap/ProseMirror JSON) ──────────────────────

export type TextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export type InlineNode =
  | { type: "text"; text: string; marks?: TextMark[] }
  | {
      type: "personalizationChip";
      attrs: { token: PersonalizationToken };
      marks?: TextMark[];
    }
  | { type: "eventChip"; attrs: { eventId: string }; marks?: TextMark[] }
  | { type: "hardBreak" };

export type BlockNode = { type: "paragraph"; content?: InlineNode[] };

export interface TenTapDocument {
  type: "doc";
  content: BlockNode[];
}

// ─── Parse: body_html string → TenTap doc ──────────────────────────────────

/**
 * Parse a body_html token-bearing string into a TenTap document.
 *
 * Recognized syntax:
 *   - `{first_name}` etc → inline personalizationChip
 *   - `{{event:<uuid>}}` → block eventChip (forces paragraph break around it)
 *   - `<strong>…</strong>` → bold mark
 *   - `<em>…</em>` → italic mark
 *   - `<a href="…">…</a>` → link mark
 *   - `\n\n` or `\n` → paragraph break
 *
 * Unknown HTML is treated as literal text (we do NOT silently strip).
 * Malformed event UUIDs (not matching the 8-4-4-4-12 hex pattern) become
 * literal text — they don't become event chips.
 */
export function bodyHtmlToTenTapDoc(bodyHtml: string): TenTapDocument {
  if (bodyHtml.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  // Split on \n into paragraphs. Each paragraph is parsed for inline content
  // (text + marks + personalization chips + event chips). Event chips stay
  // inline within their paragraph so V1 strings like "see ya at {{event:x}}."
  // round-trip byte-identical. The V2 editor's node view (Stage B) is free
  // to render the inline event chip as a full-width visual block.
  const paragraphs = bodyHtml.split("\n");
  const blocks: BlockNode[] = paragraphs.map((p) => {
    const inline = parseInlineSegment(p);
    return inline.length > 0
      ? { type: "paragraph", content: inline }
      : { type: "paragraph" };
  });
  return { type: "doc", content: blocks };
}

interface InlineParseFrame {
  marks: TextMark[];
  out: InlineNode[];
}

function parseInlineSegment(text: string): InlineNode[] {
  // Walk left-to-right tracking active marks (bold/italic/link). HTML tags
  // open/close marks; personalization tokens become chip nodes; everything
  // else is text under current marks.
  const root: InlineParseFrame = { marks: [], out: [] };
  const stack: InlineParseFrame[] = [root];
  const top = (): InlineParseFrame => stack[stack.length - 1] ?? root;

  const pushText = (chunk: string): void => {
    if (chunk.length === 0) return;
    const t = top();
    const last = t.out[t.out.length - 1];
    if (last !== undefined && last.type === "text" && marksEqual(last.marks ?? [], t.marks)) {
      last.text += chunk;
      return;
    }
    const node: InlineNode = t.marks.length > 0
      ? { type: "text", text: chunk, marks: [...t.marks] }
      : { type: "text", text: chunk };
    t.out.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // HTML tag detection — very narrow set we recognize.
    if (ch === "<") {
      const tagMatch = tryReadTag(text, i);
      if (tagMatch !== null) {
        const t = top();
        if (tagMatch.kind === "open") {
          t.marks.push(tagMatch.mark);
        } else {
          // Close mark — pop the matching one (innermost first).
          for (let m = t.marks.length - 1; m >= 0; m--) {
            const candidate = t.marks[m];
            if (candidate !== undefined && candidate.type === tagMatch.type) {
              t.marks.splice(m, 1);
              break;
            }
          }
        }
        i += tagMatch.consumed;
        continue;
      }
      // Unknown HTML — treat as literal text.
      pushText("<");
      i += 1;
      continue;
    }

    // Event chip detection (double-brace) — check before personalization
    // since both start with `{`.
    if (ch === "{" && text[i + 1] === "{") {
      EVENT_TOKEN_RE.lastIndex = i;
      const eventMatch = EVENT_TOKEN_RE.exec(text);
      if (eventMatch !== null && eventMatch.index === i) {
        const t = top();
        t.out.push(
          t.marks.length > 0
            ? { type: "eventChip", attrs: { eventId: eventMatch[1] }, marks: [...t.marks] }
            : { type: "eventChip", attrs: { eventId: eventMatch[1] } },
        );
        i += eventMatch[0].length;
        continue;
      }
      // Malformed `{{...}}` — literal text.
      pushText("{");
      i += 1;
      continue;
    }

    // Personalization token detection.
    if (ch === "{") {
      PERSONALIZATION_TOKEN_RE.lastIndex = i;
      const tokenMatch = PERSONALIZATION_TOKEN_RE.exec(text);
      if (tokenMatch !== null && tokenMatch.index === i) {
        const t = top();
        const token = tokenMatch[1] as PersonalizationToken;
        t.out.push(
          t.marks.length > 0
            ? { type: "personalizationChip", attrs: { token }, marks: [...t.marks] }
            : { type: "personalizationChip", attrs: { token } },
        );
        i += tokenMatch[0].length;
        continue;
      }
      // Unknown brace expression — literal text.
      pushText("{");
      i += 1;
      continue;
    }

    pushText(ch);
    i += 1;
  }

  return root.out;
}

function marksEqual(a: TextMark[], b: TextMark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ma = a[i];
    const mb = b[i];
    if (ma === undefined || mb === undefined) return false;
    if (ma.type !== mb.type) return false;
    if (ma.type === "link" && mb.type === "link" && ma.attrs.href !== mb.attrs.href) return false;
  }
  return true;
}

type TagMatch =
  | { kind: "open"; type: "bold" | "italic" | "link"; mark: TextMark; consumed: number }
  | { kind: "close"; type: "bold" | "italic" | "link"; consumed: number };

function tryReadTag(text: string, start: number): TagMatch | null {
  // Recognize: <strong>, </strong>, <em>, </em>, <a href="…">, </a>.
  const lower = text.slice(start, Math.min(start + 200, text.length)).toLowerCase();
  if (lower.startsWith("<strong>")) {
    return { kind: "open", type: "bold", mark: { type: "bold" }, consumed: 8 };
  }
  if (lower.startsWith("</strong>")) {
    return { kind: "close", type: "bold", consumed: 9 };
  }
  if (lower.startsWith("<em>")) {
    return { kind: "open", type: "italic", mark: { type: "italic" }, consumed: 4 };
  }
  if (lower.startsWith("</em>")) {
    return { kind: "close", type: "italic", consumed: 5 };
  }
  if (lower.startsWith("</a>")) {
    return { kind: "close", type: "link", consumed: 4 };
  }
  if (lower.startsWith("<a ")) {
    // Find end of opening tag; parse href.
    const end = text.indexOf(">", start);
    if (end === -1) return null;
    const tagContent = text.slice(start, end + 1);
    const hrefMatch = /\shref\s*=\s*"([^"]*)"/i.exec(tagContent) ??
      /\shref\s*=\s*'([^']*)'/i.exec(tagContent);
    if (hrefMatch === null) return null;
    return {
      kind: "open",
      type: "link",
      mark: { type: "link", attrs: { href: hrefMatch[1] } },
      consumed: end - start + 1,
    };
  }
  return null;
}

// ─── Serialize: TenTap doc → body_html string ──────────────────────────────

/**
 * Inverse of `bodyHtmlToTenTapDoc`. Emits a canonical body_html string:
 *   - Paragraphs joined by `\n`
 *   - Personalization chips emitted as `{token}`
 *   - Event chips emitted as `{{event:<uuid>}}` on their own line
 *   - Marks emitted as `<strong>` / `<em>` / `<a href="…">` (double-quoted)
 *
 * Round-trip: bodyHtmlToTenTapDoc(toBodyHtml(doc)) preserves doc shape
 * (modulo trivial whitespace canonicalization). toBodyHtml(bodyHtmlToTenTapDoc(s))
 * is byte-identical for V1 (no HTML marks) inputs.
 */
export function toBodyHtml(doc: TenTapDocument): string {
  const parts: string[] = [];
  for (const block of doc.content) {
    const inlineParts: string[] = [];
    for (const node of block.content ?? []) {
      if (node.type === "personalizationChip") {
        inlineParts.push(emitTextWithMarks(`{${node.attrs.token}}`, node.marks ?? []));
      } else if (node.type === "eventChip") {
        inlineParts.push(emitTextWithMarks(`{{event:${node.attrs.eventId}}}`, node.marks ?? []));
      } else if (node.type === "hardBreak") {
        inlineParts.push("\n");
      } else {
        inlineParts.push(emitTextWithMarks(node.text, node.marks ?? []));
      }
    }
    parts.push(inlineParts.join(""));
  }
  return parts.join("\n");
}

function emitTextWithMarks(text: string, marks: TextMark[]): string {
  if (marks.length === 0) return text;
  // Marks are stored in the order they were opened during parse (outermost
  // first). Wrap innermost-last so emission order matches input order.
  let inner = text;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m === undefined) continue;
    if (m.type === "bold") inner = `<strong>${inner}</strong>`;
    else if (m.type === "italic") inner = `<em>${inner}</em>`;
    else if (m.type === "link") inner = `<a href="${m.attrs.href}">${inner}</a>`;
  }
  return inner;
}

// ─── Public helpers ────────────────────────────────────────────────────────

export function isPersonalizationToken(s: string): s is PersonalizationToken {
  return (PERSONALIZATION_TOKENS as readonly string[]).includes(s);
}

export function extractEmbeddedEventIds(bodyHtml: string): string[] {
  const ids: string[] = [];
  EVENT_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EVENT_TOKEN_RE.exec(bodyHtml)) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

// ─── Pell-side HTML emitters (Stage F.5 pivot from TenTap to pell) ─────────
//
// Pell's editor stores raw HTML. We render chips as <span> elements with
// data-* attrs the inverse parser can recover. The doc round-trip from
// V1 token-string is:
//   bodyHtml (token string) → bodyHtmlToTenTapDoc (existing Stage A)
//     → docToHtml (NEW)      → pell.setContentHTML
//   pell.getContentHtml      → htmlToTokenString (NEW) → bodyHtml (token string)
//
// The TenTapDocument type is preserved as the intermediate AST so Stage A's
// 15 byte-roundtrip tests remain valid contracts.

/**
 * Render a TenTapDocument into the HTML form pell's editor consumes.
 * Personalization chips become `.mingla-personalization-chip` spans with
 * data-token; event chips become `.mingla-event-chip` spans with data-event-id.
 * Marks (bold/italic/link) become standard HTML tags.
 * Paragraphs are joined by `<br>` (pell uses `<div>` as its paragraph
 * separator by default; `<br>` is the safest cross-version line break).
 */
export function docToHtml(doc: TenTapDocument): string {
  const parts: string[] = [];
  for (const block of doc.content) {
    const inlineParts: string[] = [];
    for (const node of block.content ?? []) {
      if (node.type === "personalizationChip") {
        const inner = renderPersonalizationChip(node.attrs.token);
        inlineParts.push(wrapMarks(inner, node.marks ?? []));
      } else if (node.type === "eventChip") {
        const inner = renderEventChipPlaceholder(node.attrs.eventId);
        inlineParts.push(wrapMarks(inner, node.marks ?? []));
      } else if (node.type === "hardBreak") {
        inlineParts.push("<br>");
      } else {
        inlineParts.push(wrapMarks(escapeHtmlText(node.text), node.marks ?? []));
      }
    }
    parts.push(inlineParts.join(""));
  }
  return parts.join("<br>");
}

/**
 * Inverse: parse pell's emitted HTML back into a token-bearing body string
 * that matches the V1 channel_payload.body_html format byte-for-byte for
 * the V1 token vocabulary. Recognizes:
 *   <span class="mingla-personalization-chip" data-token="X">…</span>
 *     → `{X}`
 *   <span class="mingla-event-chip" data-event-id="UUID">…</span>
 *     → `{{event:UUID}}`
 *   <strong>, <em>, <a href> — preserved verbatim
 *   <br>, <div>, <p> — normalized to newlines
 *   contenteditable="false", style="", and other pell-emitted attrs — stripped
 *
 * Anything else is treated as literal text after entity decode.
 */
export function htmlToTokenString(html: string): string {
  if (html.length === 0) return "";
  let out = html;

  // Stage F.8: strip the inline `<span class="mingla-chip-x">×</span>`
  // close-buttons BEFORE the chip regex runs. They are UI sugar, not
  // content. Without this step the outer chip regex's `[\s\S]*?` would
  // stop at the X span's `</span>` instead of the chip's, breaking
  // token extraction.
  out = out.replace(
    /<span\b[^>]*?\bclass="mingla-chip-x"[^>]*>[^<]*<\/span>/gi,
    "",
  );
  // Same for any chip-glyph spans (event chip's ▣ marker).
  out = out.replace(
    /<span\b[^>]*?\bclass="mingla-chip-glyph"[^>]*>[^<]*<\/span>/gi,
    "",
  );
  // And chip-content wrappers — strip the wrapper tags but keep text.
  out = out.replace(
    /<span\b[^>]*?\bclass="mingla-chip-content"[^>]*>([\s\S]*?)<\/span>/gi,
    "$1",
  );

  // Personalization chips: capture data-token, drop the span entirely.
  // The class attr may have additional classes pell adds (e.g., selection
  // marker), so match by `data-token` presence to be lenient.
  out = out.replace(
    /<span\b[^>]*?\bdata-token="([a-z_]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_, token: string) => `{${token}}`,
  );
  // Event chips: capture data-event-id.
  out = out.replace(
    /<span\b[^>]*?\bdata-event-id="([0-9a-f-]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_, id: string) => `{{event:${id}}}`,
  );

  // Normalize pell's paragraph wrappers to newlines.
  out = out.replace(/<\/?(?:div|p)[^>]*>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");

  // Preserve mark tags as-is (lowercase, drop attrs except href).
  out = out.replace(/<\/?(strong|em)\b[^>]*>/gi, (match) =>
    match.toLowerCase().replace(/<(\/?\w+)[^>]*>/, "<$1>"),
  );
  out = out.replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>/gi, (_, href: string) => `<a href="${href}">`);
  out = out.replace(/<\/a>/gi, "</a>");

  // Strip any remaining unknown tags (pell can inject <font>, <span style>,
  // etc.) but keep their inner text. EXCLUDE preserved mark tags (strong,
  // em, a) which are kept verbatim above.
  out = out.replace(
    /<\/?(?!(?:strong|em|a)\b)[a-z][^>]*>/gi,
    "",
  );

  // Decode common HTML entities back to characters.
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  // Collapse 3+ consecutive newlines to a max of 2 (paragraph break) and
  // trim leading/trailing whitespace pell sometimes adds via wrapper divs.
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");

  return out;
}

function renderPersonalizationChip(token: PersonalizationToken): string {
  return (
    `<span class="mingla-personalization-chip" contenteditable="false"` +
    ` data-token="${token}">${token}</span>`
  );
}

function renderEventChipPlaceholder(eventId: string): string {
  // The full chip render (title, date, cover) requires runtime brand-event
  // lookup. At doc→html time we don't have that data, so emit a minimal
  // chip stub with just the event-id. The host (ComposerV2Editor)
  // re-renders chips with full title/date via insertHTML on every fresh
  // insert; this stub is only the format pell stores between session loads.
  return (
    `<span class="mingla-event-chip" contenteditable="false"` +
    ` data-event-id="${eventId}" data-cta="tickets">▣ Event</span>`
  );
}

function wrapMarks(inner: string, marks: TextMark[]): string {
  if (marks.length === 0) return inner;
  // Wrap innermost-last so emission order matches input order (matches
  // toBodyHtml's mark-ordering rule from Stage A).
  let out = inner;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m === undefined) continue;
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "link") out = `<a href="${m.attrs.href}">${out}</a>`;
  }
  return out;
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
