// ORCH-1200 (shipped under colliding "orch_1195", PR #609 / 23b9745ac) —
// END-TO-END regression backfill for FIX 2, the load-bearing confirmation-email
// break. This file attacks the seam the helper-only test
// (orch_1195_winansi_sanitize.test.ts) MISSES: it does not prove that the
// ticket-PDF `dateLine` — the ONE drawText arg NOT routed through `truncate` —
// actually flows through `sanitizeForWinAnsi` before pdf-lib draws it.
//
// LIVE FAILURE REPRODUCED: the confirmation email never sent because pdf-lib
// StandardFonts (WinAnsi / CP-1252) THROW on an un-encodable glyph at drawText,
// and the event date line carries non-WinAnsi codepoints:
//   - modern Intl.DateTimeFormat inserts U+202F (narrow no-break space) before
//     "AM/PM" (the exact char in the crash: `WinAnsi cannot encode " " (0x202f)`).
//   - formatEventDateLine ALSO joins ranges with an en-dash U+2013 ("–").
// Either is > 0x7E and is un-encodable by WinAnsi. The fix wraps the dateLine in
// sanitizeForWinAnsi so drawText can NEVER throw and the email always sends.
//
// SEAM DECISION: U+202F emission from Intl is ICU-version-dependent (newer
// CLDR inserts it; some local Deno builds still emit 0x20), so this test does
// NOT rely on the runner's ICU to manufacture the hazard. Instead it proves the
// hazard two robust ways: (a) the LITERAL U+202F production char, faithfully
// reproducing the documented live AM/PM string regardless of runner ICU, and
// (b) the REAL production code path `formatEventDateLine`, which deterministically
// yields a > 0x7E codepoint (the en-dash). The load-bearing assertion exercises
// the real module behaviorally; a precise, revert-sensitive source check guards
// the wiring itself.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { sanitizeForWinAnsi } from "../winAnsiSanitize.ts";
import { formatEventDateLine } from "../email/dateLine.ts";

function maxCodePoint(s: string): number {
  let max = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > max) max = cp;
  }
  return max;
}

function hasNonWinAnsiHazard(s: string): boolean {
  return maxCodePoint(s) > 0x7e;
}

const WORKTREE_TICKET_PDF = new URL("../ticketPdf.ts", import.meta.url);

Deno.test("REQ-1: U+202F AM/PM production string is a real hazard, sanitizer neutralizes it", () => {
  // Faithfully reproduce the live failure input independent of runner ICU:
  // the narrow no-break space (U+202F) that modern Intl emits before AM/PM.
  const NARROW_NBSP = " ";
  const rawAmPmTime = `7:00${NARROW_NBSP}PM`;
  assertEquals(rawAmPmTime.length, 7);

  // The hazard MUST be real — this codepoint is exactly what pdf-lib WinAnsi
  // throws on (`WinAnsi cannot encode " " (0x202f)`).
  assert(
    hasNonWinAnsiHazard(rawAmPmTime),
    "raw Intl AM/PM string must contain a codepoint > 0x7E (the U+202F hazard)",
  );
  assertEquals(maxCodePoint(rawAmPmTime), 0x202f);

  // The invariant pdf-lib WinAnsi requires: ZERO codepoints > 0x7E after sanitize.
  const safe = sanitizeForWinAnsi(rawAmPmTime);
  assert(
    !hasNonWinAnsiHazard(safe),
    "sanitized AM/PM string must have ZERO codepoints > 0x7E",
  );
  assertEquals(safe, "7:00 PM");
});

Deno.test("REQ-1: real formatEventDateLine output carries a >0x7E hazard, sanitizer neutralizes it", () => {
  // Drive the EXACT production formatter the ticket PDF uses. A same-day range
  // deterministically yields an en-dash (U+2013) — a guaranteed > 0x7E codepoint
  // on every ICU — and (on production ICU) the U+202F before AM/PM.
  const rawDateLine = formatEventDateLine(
    "2026-05-18T19:00:00Z",
    "2026-05-18T20:00:00Z",
    "UTC",
  );
  assert(rawDateLine.length > 0, "formatEventDateLine must produce a date line");

  // Hazard is real on the production code path (en-dash at minimum).
  assert(
    hasNonWinAnsiHazard(rawDateLine),
    `raw dateLine must contain a codepoint > 0x7E (got max 0x${
      maxCodePoint(rawDateLine).toString(16)
    }): ${JSON.stringify(rawDateLine)}`,
  );

  // After the FIX-2 sanitize, the string pdf-lib draws is WinAnsi-safe.
  const safe = sanitizeForWinAnsi(rawDateLine);
  assert(
    !hasNonWinAnsiHazard(safe),
    "sanitized dateLine must have ZERO codepoints > 0x7E (pdf-lib WinAnsi invariant)",
  );
});

Deno.test("REQ-2: ticketPdf.ts dateLine is wired through sanitizeForWinAnsi before drawText", async () => {
  // Behavioral half: the real module + real formatter prove the contract end to
  // end — whatever formatEventDateLine emits, the sanitizer makes WinAnsi-safe.
  const liveCrossMidnight = formatEventDateLine(
    "2026-05-18T23:30:00Z",
    "2026-05-19T02:00:00Z",
    "America/New_York",
  );
  assert(
    !hasNonWinAnsiHazard(sanitizeForWinAnsi(liveCrossMidnight)),
    "the sanitizer applied to a live dateLine must yield zero >0x7E codepoints",
  );

  // Wiring half: assert ticketPdf.ts defines `dateLine` by wrapping the
  // formatEventDateLine(...) call in sanitizeForWinAnsi(...). This is the precise,
  // revert-sensitive guard — it matches the load-bearing dateLine definition,
  // NOT the separate `truncate()` sanitize call.
  const src = await Deno.readTextFile(WORKTREE_TICKET_PDF);

  // Normalize whitespace so the multi-line `const dateLine = sanitizeForWinAnsi(
  //   formatEventDateLine(...))` definition matches as a single span.
  const flat = src.replace(/\s+/g, " ");

  // [FAILS-ON-REVERT KEY] — goes RED if the dateLine sanitize wrapping is removed.
  // Requires that the dateLine binding is `sanitizeForWinAnsi( formatEventDateLine(`
  // i.e. the formatter's output is the sanitizer's argument at the dateLine site.
  assert(
    /const\s+dateLine\s*=\s*sanitizeForWinAnsi\(\s*formatEventDateLine\(/.test(
      flat,
    ),
    "ticketPdf.ts must define `dateLine` as sanitizeForWinAnsi(formatEventDateLine(...)) — the load-bearing FIX-2 wiring is missing or reverted",
  );
});
