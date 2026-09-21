/**
 * #3429 — the ONE segmenter for Ari's answer text, and the spoken form built
 * from it.
 *
 * It lives in its own module rather than in `ChatBubble` or in
 * `SemanticRevealText` because BOTH of those need it and `ChatBubble` renders
 * `SemanticRevealText`: with the segmenter in either one, the other has to
 * import back and that is a require cycle (I-PROPOSED-K). A leaf module both
 * can depend on breaks the cycle without either importing the other.
 *
 * It is deliberately NOT in `SemanticRevealText`: suites that render a bubble
 * routinely `jest.mock("../SemanticRevealText")`, and a re-export through a
 * module people stub would make the segmenter vanish under the stub. A leaf
 * nobody mocks does not have that failure mode.
 *
 * `ChatBubble` re-exports both functions, because that is where callers have
 * always imported them from.
 */

export interface AriBubbleSegment {
  kind: "paragraph" | "bullet";
  text: string;
}

type Segment = AriBubbleSegment;

const BULLET_LINE = /^\s*[•-]\s+/;

/** Split already-parsed plain text into paragraph / bullet segments.
 *  Container-level formatting only (no inline markdown).
 *  #3429 REWORK-1 P2-4: the ONE segmenter — the semantic reveal renders these
 *  same segments, so a revealed answer and its settled row never differ. */
export function toSegments(raw: string): Segment[] {
  const paragraphs = raw.split(/\n\n+/);
  const out: Segment[] = [];
  for (const para of paragraphs) {
    const lines = para.split("\n");
    // #3429 REWORK-2 R-6: a paragraph is split AT its first bullet, not
    // all-or-nothing. Requiring every line to be a bullet meant the single most
    // common shape an answer takes — an intro line, then bullets, with no blank
    // line between them — fell through to one plain paragraph and rendered the
    // literal "- " dashes the writer meant as a list. Consecutive non-bullet
    // lines still group into one paragraph, so an all-prose paragraph and an
    // all-bullet paragraph are byte-for-byte what they were before.
    let prose: string[] = [];
    const flushProse = (): void => {
      if (prose.length === 0) return;
      out.push({ kind: "paragraph", text: prose.join("\n") });
      prose = [];
    };
    for (const line of lines) {
      if (BULLET_LINE.test(line)) {
        flushProse();
        out.push({ kind: "bullet", text: line.replace(BULLET_LINE, "") });
      } else {
        prose.push(line);
      }
    }
    flushProse();
  }
  return out;
}

/** The SPOKEN form of a bubble, built from the SAME segments the renderer uses.
 *  #3429 REWORK-4 N-2: the visible rows render "- item" as a real bullet row
 *  (R-6), but the accessibility label was still built from the raw text, so
 *  TalkBack and VoiceOver announced "dash" before every list item while the
 *  screen showed a bullet — sighted users got the R-6 fix and screen-reader
 *  users did not. Taking the label from `toSegments` strips the list markers
 *  and means the announcement cannot drift from what is on screen. */
export function toAccessibleText(raw: string): string {
  return toSegments(raw)
    .map((segment) => segment.text)
    .join("\n");
}
