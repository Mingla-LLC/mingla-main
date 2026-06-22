// ORCH-1195 FIX 2 — sanitizeForWinAnsi must make any string WinAnsi-safe so the
// ticket PDF (pdf-lib StandardFonts) can never throw on an un-encodable glyph.
// Live failure: `WinAnsi cannot encode " " (0x202f)` (the narrow NBSP modern
// Intl.DateTimeFormat inserts before AM/PM). Fails-on-revert: remove the helper.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { sanitizeForWinAnsi } from "../winAnsiSanitize.ts";

function allWinAnsiSafe(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) return false; // collapsed to <=0xFF (we target <=0x7E for data)
  }
  return true;
}

Deno.test("U+202F narrow NBSP (7:00 PM) → normal space, WinAnsi-safe", () => {
  const out = sanitizeForWinAnsi("7:00 PM");
  assert(allWinAnsiSafe(out), "must be WinAnsi-safe");
  assertEquals(out, "7:00 PM");
});

Deno.test("dashes/quotes/ellipsis/NBSP/emoji all collapse to WinAnsi-safe", () => {
  const out = sanitizeForWinAnsi("Café – “Vibes”…  🎉");
  for (const ch of out) {
    assert((ch.codePointAt(0) ?? 0) <= 0x7e, `code point ${ch} must be <=0x7E`);
  }
  assert(out.includes("-"), "en dash → -");
  assert(out.includes('"Vibes"'), "curly quotes → straight");
  assert(out.includes("..."), "ellipsis → ...");
});

Deno.test("null/undefined → empty string (never throws)", () => {
  assertEquals(sanitizeForWinAnsi(null), "");
  assertEquals(sanitizeForWinAnsi(undefined), "");
});
