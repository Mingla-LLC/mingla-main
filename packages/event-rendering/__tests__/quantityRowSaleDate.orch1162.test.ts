// ORCH-1162 Bug 1 — shared "Sales open …" pre-sale banner restores the meridiem.
// (implementor-owned happy-path; Deno-runnable — quantityRowFormat.ts is pure.)
//
// THE FIX (F-2): QuantityRow.formatSaleDate was pinned to "en-GB" (24h-default),
// so the banner rendered "Wed 15 Jul, 19:00". The pure formatter (extracted to
// quantityRowFormat.ts) now uses en-US + hour12 → "Wed, Jul 15, 7:00 PM".
//
// FAILS-ON-REVERT: revert the locale to "en-GB" with hour:"2-digit" → the output
// has no meridiem ("19:00") and these assertions FAIL. Verified by true
// line-deletion in the implementation report.
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { formatSaleDate } from "../quantityRowFormat.ts";

Deno.test("TC-2: formatSaleDate renders a meridiem, not 24h", () => {
  const out = formatSaleDate("2026-07-15T19:00:00Z");
  assert(
    /\b(AM|PM)\b/.test(out),
    `expected a meridiem in "${out}" — en-GB 24h regression if "19:00" appears`,
  );
  assert(!out.includes("19:00"), `must NOT render 24h "19:00": "${out}"`);
});

Deno.test("TC-2b: invalid iso falls back to 'soon'", () => {
  assert(formatSaleDate("not-a-date") === "soon");
});
