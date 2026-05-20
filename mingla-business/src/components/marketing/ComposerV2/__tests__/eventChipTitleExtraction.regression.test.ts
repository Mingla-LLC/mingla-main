/**
 * ORCH-0891 M1 fix-cycle — event chip title extraction regression test.
 *
 * # The bug this catches
 * The event chip HTML emitted by `composerChipHtml.eventChipHtml(...)`
 * has a nested `<span class="mingla-chip-glyph">▣</span>` inside the
 * outer event chip span. When `richEditor.tsx insertChipOrHtml` used
 * a LAZY regex (`[\s\S]*?`) to capture the inner content between the
 * outer `<span>` and `</span>`, the lazy match stopped at the FIRST
 * `</span>` it saw — the inner glyph span's closing tag — and the
 * event title was dropped. Result: the event chip rendered as just
 * the ▣ glyph with no title text (operator-reported in the M1
 * checkpoint smoke).
 *
 * # The fix
 * Use GREEDY `[\s\S]*` for the inner content capture. The trailing
 * `</span>` then anchors to the LAST closing tag (the outer one),
 * and the full inner content (including the nested glyph span +
 * title text) is captured. Title extraction strips tags + the ▣
 * glyph, leaving the title plain text.
 *
 * # Why this needs its own test
 * The original M1 implementor-happy + adversarial tests verified
 * source contracts (Tiptap imports, chip class names, backspace
 * handler) but NOT the regex's runtime behavior for nested-span
 * title extraction. A future regression that swaps greedy back to
 * lazy would silently break event-chip rendering without tripping
 * any other gate.
 *
 * # Source-grep style (repo precedent)
 * Asserts that the source contains `[\s\S]*` (greedy) NOT `[\s\S]*?`
 * (lazy) in the event-chip-parsing regex. The test catches the
 * one-character difference that causes the bug.
 */

import fs from "node:fs";
import path from "node:path";

const RICH_EDITOR_PATH = path.resolve(__dirname, "..", "richEditor.tsx");

describe("ORCH-0891 M1 fix — event chip title extraction (lazy→greedy regex fix)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(RICH_EDITOR_PATH, "utf8");
  });

  it("(T-M1-FIX-01) event chip inner-content regex uses GREEDY [\\s\\S]* before </span>", () => {
    // Find the event-chip parsing line by anchoring on `data-event-id`.
    // The regex on that line MUST contain `[\s\S]*<\/span>` (greedy, no `?`).
    // The lazy form `[\s\S]*?<\/span>` is the bug — it stops at the FIRST
    // </span> (the nested glyph span's closing tag) and drops the title.
    const eventChipLine = source.split("\n").find((l) =>
      l.includes("data-event-id") && l.includes("/i,"),
    );
    expect(eventChipLine).toBeDefined();
    // The source line contains the JS regex literal
    //   `...([\s\S]*)<\/span>/i,`
    // The closing paren `)` for the capture group sits between `*` and `<`.
    // Verify: greedy `[\s\S]*)` is present AND lazy `[\s\S]*?)` is absent.
    const line = eventChipLine ?? "";
    expect(line.includes("[\\s\\S]*)<\\/span>")).toBe(true);
    expect(line.includes("[\\s\\S]*?)<\\/span>")).toBe(false);
  });

  it("(T-M1-FIX-03) title extraction strips both HTML tags AND the ▣ glyph character", () => {
    // After greedy match captures the full inner content, the title
    // extraction logic strips ALL nested HTML tags (the glyph span)
    // AND the literal ▣ character that may have been left as text.
    // Both replacements MUST be present in the source.
    expect(source).toMatch(/replace\(\/<\[\^>\]\+>\/g,\s*["']\s*["']\)/);
    expect(source).toMatch(/replace\(\/▣\/g,\s*["']\s*["']\)/);
  });
});
