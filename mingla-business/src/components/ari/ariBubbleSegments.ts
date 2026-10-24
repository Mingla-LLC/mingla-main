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

/** Strip leftover fence/rule/emphasis delimiters that never became structure. */
export function stripRawMarkdownDelimiters(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim()
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-_*]){3,}\s*$/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    // Any remaining Markdown punctuation must not reach the screen or SR.
    .replace(/[`*_#]+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Inline runs for bold / italic / code. Malformed pairs fall through as plain.
 * Used by the bubble renderer so `**Launch**` never shows asterisks.
 */
export function parseInlineRuns(raw: string): AriInlineRun[] {
  if (!raw) return [{ kind: "plain", text: "" }];
  const runs: AriInlineRun[] = [];
  const re = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|__([^_]+)__|_([^_\n]+)_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) {
      runs.push({ kind: "plain", text: raw.slice(last, match.index) });
    }
    if (match[2] !== undefined) {
      runs.push({ kind: "strong", text: match[2] });
    } else if (match[3] !== undefined) {
      runs.push({ kind: "strong", text: match[3] });
    } else if (match[4] !== undefined) {
      runs.push({ kind: "em", text: match[4] });
    } else if (match[5] !== undefined) {
      runs.push({ kind: "code", text: match[5] });
    } else if (match[6] !== undefined) {
      runs.push({ kind: "strong", text: match[6] });
    } else if (match[7] !== undefined) {
      runs.push({ kind: "em", text: match[7] });
    }
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    runs.push({ kind: "plain", text: raw.slice(last) });
  }
  if (runs.length === 0) return [{ kind: "plain", text: raw }];
  // If any leftover raw markers remain in plain runs, strip them.
  return runs.map((run) =>
    run.kind === "plain"
      ? { kind: "plain", text: stripRawMarkdownDelimiters(run.text) }
      : run
  );
}

function cleanLineBody(line: string): string {
  // Keep ** for parseInlineRuns; strip only structural leftovers.
  return line
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
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
            n: Number.isFinite(n) && n > 0 ? n : out.filter((s) => s.kind === "numbered").length + 1,
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

  // Final pass: if any segment still carries only delimiter noise, drop it.
  return out.filter((seg) => {
    const spoken = stripRawMarkdownDelimiters(seg.text);
    return spoken.length > 0;
  });
}

/** Spoken form — no list markers, hashes, asterisks, or backticks. */
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
 * True when rendered text would still expose raw Markdown punctuation.
 * Used by corpus regressions (#3355).
 */
export function ariTextLeaksMarkdown(raw: string): boolean {
  const spoken = toAccessibleText(raw);
  // Visible hash/asterisk/backtick markers must be gone from spoken form.
  if (/[#*`]/.test(spoken)) return true;
  if (/\*\*[^*]/.test(spoken) || /__[^_]/.test(spoken)) return true;
  // Segmenter must not leave leading markdown list markers in spoken text.
  if (/(^|\n)\s*[-*•]\s/.test(spoken)) return true;
  return false;
}
