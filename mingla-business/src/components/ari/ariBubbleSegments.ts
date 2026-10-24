/**
 * #3429 / #3355 — the ONE segmenter for Ari's answer text, and the spoken form.
 *
 * #3355 readable-replies: Ari must never paint raw Markdown. Model output that
 * looks like Markdown is converted into typed blocks (paragraph, section label,
 * bullet, numbered step) and inline runs (plain / strong / em / code). Unknown
 * or malformed markup falls back to clean plain text with delimiters removed.
 *
 * Leaf module — both ChatBubble and SemanticRevealText import it (I-PROPOSED-K).
 */

export type AriInlineRun =
  | { kind: "plain"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string };

export interface AriBubbleSegment {
  kind: "paragraph" | "bullet" | "numbered" | "section_label";
  text: string;
  /** 1-based index for numbered steps; omitted otherwise. */
  n?: number;
}

type Segment = AriBubbleSegment;

const BULLET_LINE = /^\s*[•*-]\s+(.*)$/;
const NUMBERED_LINE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*)$/;
const HR_LINE = /^\s*(?:[-_*]){3,}\s*$/;
const FENCE_LINE = /^\s*```/;

/** Markdown link → keep label and destination in the plain-text fallback. */
function unwrapMarkdownLinks(raw: string): string {
  return raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const text = String(label).trim();
    const url = String(href).trim();
    if (!url) return text;
    if (!text) return url;
    if (text === url) return text;
    return `${text} (${url})`;
  });
}

/**
 * Word-aware single `_…_` / `*…*` — never treat `_` inside emails/identifiers
 * as emphasis (e.g. `jane_doe_sales@example.com`).
 */
function stripWordAwareEmphasis(raw: string, marker: "*" | "_"): string {
  const esc = marker === "*" ? "\\*" : "_";
  const re = new RegExp(
    `(^|[^\\w${esc}])${esc}([^${esc}\\n]+)${esc}(?!${esc})(?!\\w)`,
    "g",
  );
  return raw.replace(re, "$1$2");
}

/** Flatten nested markdown left inside a strong/em payload (keep code as text). */
function flattenInlinePayload(text: string): string {
  let out = text.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__(.+?)__/g, "$1");
  out = stripWordAwareEmphasis(out, "*");
  out = stripWordAwareEmphasis(out, "_");
  return out.replace(/\*\*/g, "").replace(/`/g, "");
}

/**
 * Strip Markdown *formatting* delimiters. Does not delete literal `#` / `_`
 * inside URLs, emails, or identifiers (only line-leading ATX headings and
 * paired emphasis/code markers with word-aware boundaries).
 */
export function stripRawMarkdownDelimiters(
  raw: string,
  options: { trim?: boolean } = {},
): string {
  const trim = options.trim !== false;
  let out = unwrapMarkdownLinks(raw)
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim()
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1");
  out = stripWordAwareEmphasis(out, "*");
  out = stripWordAwareEmphasis(out, "_");
  out = out
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-_*]){3,}\s*$/gm, "")
    // Unpaired emphasis/code fence markers only — never blanket-delete `#`/`_`.
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return trim ? out.trim() : out;
}

/**
 * Inline runs for bold / italic / code. Malformed pairs fall through as plain.
 * Used by the bubble renderer so `**Launch**` never shows asterisks.
 */
export function parseInlineRuns(raw: string): AriInlineRun[] {
  if (!raw) return [{ kind: "plain", text: "" }];
  const runs: AriInlineRun[] = [];
  // Prefer fenced code, then ***, **, __, then word-aware * and _.
  const re =
    /(`([^`]+)`|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|(^|[^*\w])\*([^*\n]+)\*(?!\*)|(^|[^_\w])_([^_\n]+)_(?!_))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    let kind: AriInlineRun["kind"] | null = null;
    let text = "";
    let prefix = "";
    if (match[2] !== undefined) {
      kind = "code";
      text = match[2];
    } else if (match[3] !== undefined) {
      kind = "strong";
      text = flattenInlinePayload(match[3]);
    } else if (match[4] !== undefined) {
      kind = "strong";
      text = flattenInlinePayload(match[4]);
    } else if (match[5] !== undefined) {
      kind = "strong";
      text = flattenInlinePayload(match[5]);
    } else if (match[7] !== undefined) {
      prefix = match[6] ?? "";
      kind = "em";
      text = flattenInlinePayload(match[7]);
    } else if (match[9] !== undefined) {
      prefix = match[8] ?? "";
      kind = "em";
      text = flattenInlinePayload(match[9]);
    }
    if (kind === null) continue;
    const contentStart = match.index + prefix.length;
    if (contentStart > last) {
      runs.push({ kind: "plain", text: raw.slice(last, contentStart) });
    }
    runs.push({ kind, text });
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    runs.push({ kind: "plain", text: raw.slice(last) });
  }
  if (runs.length === 0) return [{ kind: "plain", text: raw }];
  // Clean leftover markers in plain runs without trimming flanking spaces —
  // those spaces are the gap beside **bold** / *em* spans.
  return runs.map((run) =>
    run.kind === "plain"
      ? { kind: "plain", text: stripRawMarkdownDelimiters(run.text, { trim: false }) }
      : run.kind === "code"
        ? run
        : { ...run, text: flattenInlinePayload(run.text) }
  );
}

function cleanLineBody(line: string): string {
  // Keep `**` / `` ` `` for parseInlineRuns; unwrap links with destination kept.
  return unwrapMarkdownLinks(line).trim();
}

/** Split already-parsed model text into typed Ari segments. */
export function toSegments(raw: string): Segment[] {
  if (!raw || raw.trim().length === 0) return [];
  const paragraphs = raw.replace(/\r\n/g, "\n").split(/\n\n+/);
  const out: Segment[] = [];

  for (const para of paragraphs) {
    const lines = para.split("\n");
    let prose: string[] = [];
    const flushProse = (): void => {
      if (prose.length === 0) return;
      const text = cleanLineBody(prose.join("\n"));
      if (text.length > 0) out.push({ kind: "paragraph", text });
      prose = [];
    };

    for (const line of lines) {
      if (HR_LINE.test(line) || FENCE_LINE.test(line)) {
        flushProse();
        continue;
      }
      const heading = HEADING_LINE.exec(line);
      if (heading) {
        flushProse();
        const label = cleanLineBody(heading[1] ?? "");
        if (label.length > 0) out.push({ kind: "section_label", text: label });
        continue;
      }
      const numbered = NUMBERED_LINE.exec(line);
      if (numbered) {
        flushProse();
        const n = Number(numbered[1]);
        const body = cleanLineBody(numbered[2] ?? "");
        if (body.length > 0) {
          out.push({
            kind: "numbered",
            text: body,
            n: Number.isFinite(n) && n > 0
              ? n
              : out.filter((s) => s.kind === "numbered").length + 1,
          });
        }
        continue;
      }
      const bullet = BULLET_LINE.exec(line);
      if (bullet) {
        flushProse();
        const body = cleanLineBody(bullet[1] ?? "");
        if (body.length > 0) out.push({ kind: "bullet", text: body });
        continue;
      }
      prose.push(line);
    }
    flushProse();
  }

  return out.filter((seg) => {
    const spoken = stripRawMarkdownDelimiters(seg.text);
    return spoken.length > 0;
  });
}

/** Spoken form — no list markers or emphasis delimiters. */
export function toAccessibleText(raw: string): string {
  return toSegments(raw)
    .map((segment) => {
      const body = stripRawMarkdownDelimiters(segment.text);
      if (segment.kind === "numbered") {
        return `${segment.n ?? ""}. ${body}`.trim();
      }
      return body;
    })
    .join("\n");
}

/**
 * True when rendered/spoken text would still expose Markdown *formatting*
 * tokens. Literal `#` in a URL fragment or `_` in an email must not trip this.
 */
export function ariTextLeaksMarkdown(raw: string): boolean {
  const spoken = toAccessibleText(raw);
  if (/```/.test(spoken)) return true;
  if (/`/.test(spoken)) return true;
  if (/\*\*/.test(spoken)) return true;
  if (/(^|\n)\s*#{1,6}\s/.test(spoken)) return true;
  if (/(^|\n)\s*[-*•]\s/.test(spoken)) return true;
  if (/(^|[^\w*])\*[^*\n]+\*(?!\*)/.test(spoken)) return true;
  return false;
}
