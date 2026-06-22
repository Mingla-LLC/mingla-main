// ORCH-1195 FIX 2 — WinAnsi-safe text sanitizer for pdf-lib StandardFonts.
//
// pdf-lib's StandardFonts (Helvetica family) encode text with WinAnsi (CP-1252),
// which CANNOT encode U+202F (narrow no-break space — modern
// Intl.DateTimeFormat inserts it before "AM/PM", e.g. "7:00 PM"), nor a
// handful of other non-WinAnsi glyphs. An un-encodable char makes pdf-lib THROW
// at `drawText` ("WinAnsi cannot encode \" \" (0x202f)") which previously hard-
// failed the WHOLE ticket-confirmation email (no PDF → no send).
//
// `sanitizeForWinAnsi` runs every user/data-derived string through a defensive
// map BEFORE drawText so the PDF can NEVER throw on an un-encodable char:
//   - U+202F narrow NBSP, U+00A0 NBSP, U+2009 thin space, U+2007 figure space,
//     U+2060 word-joiner, U+200B zero-width space → regular space (0x20)
//   - en/em dashes U+2013/U+2014 → "-"
//   - curly single quotes U+2018/U+2019 → "'"
//   - curly double quotes U+201C/U+201D → '"'
//   - ellipsis U+2026 → "..."
//   - bullet U+2022 → "-"
//   - FINAL GUARD: any remaining code point > 0x7E that WinAnsi cannot safely
//     encode is replaced with " " so a stray emoji/glyph can never hard-fail the
//     render again. (We keep code points 0x20–0x7E ASCII verbatim; everything
//     above the printable-ASCII range is collapsed to a space after the explicit
//     map runs. WinAnsi has a few extra Latin-1 glyphs but collapsing to space is
//     the safe, never-throw choice for an opaque data string.)

const EXPLICIT_MAP: Record<string, string> = {
  " ": " ", // narrow no-break space (the live failure)
  " ": " ", // no-break space
  " ": " ", // thin space
  " ": " ", // figure space
  "⁠": " ", // word joiner
  "​": " ", // zero-width space
  "–": "-", // en dash
  "—": "-", // em dash
  "‘": "'", // left single quote
  "’": "'", // right single quote / apostrophe
  "“": '"', // left double quote
  "”": '"', // right double quote
  "…": "...", // horizontal ellipsis
  "•": "-", // bullet
};

export function sanitizeForWinAnsi(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  let out = "";
  for (const ch of String(text)) {
    const mapped = EXPLICIT_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0x20;
    if (cp >= 0x20 && cp <= 0x7e) {
      // Printable ASCII — always WinAnsi-safe.
      out += ch;
    } else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      // Tab / newline / carriage-return → space (single-line PDF draw).
      out += " ";
    } else {
      // FINAL GUARD: anything else (incl. emoji, surrogate pairs, untouched
      // Latin-1 punctuation) → space so drawText can NEVER throw.
      out += " ";
    }
  }
  return out;
}
