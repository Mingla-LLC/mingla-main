// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts). Deno typechecks it at run.
//
// ORCH-1359 [guest-list-sheet-identity-display] — implementor-owned happy-path
// suite for the guest-row copy rewrite (SPEC §5 SC-1/SC-2/SC-3/SC-5).
//
// Deno-runnable source-structure suite in the 1341 house style (read the sheet
// source → strip comments → assert the rendered code). Enforces:
//   (b) named rows show name only — NO `@username` / "On Mingla" line2.
//   (c) named rows show the public CITY via cityFor(guest.location), or nothing
//       when location is null (Constitution #9 — no fabrication).
//   (e) unlinked rows carry "Not on Mingla"; anon-Mingla-private rows keep
//       "Keeping it low-key" — the two stay visually distinct.
// Plus: line1 name source-of-truth untouched; the server-final payload is never
// client-filtered (A-2 seal carried forward).
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - restore the `@${guest.username}` / "On Mingla" line2 branch → T-1 FAILS.
//   - drop cityFor / the cityFor(guest.location) line2 → T-2/T-4 FAIL.
//   - change the unlinked caption away from "Not on Mingla" → T-3 FAILS.
//   - collapse the unlinked + anon-private captions into one → T-3b FAILS.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Line comments FIRST, then block comments — a `/*` inside a line comment must
// not open a phantom block that swallows real code (house-style strip).
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET_RAW = await read("../EventGuestListSheet.tsx");
const TYPES_RAW = await read(
  "../../../../packages/offering-rendering/socialProofTypes.ts",
);
const SHEET = strip(SHEET_RAW);

// ── T-1 (b) — named rows never render @username / "On Mingla" ────────────────

Deno.test("T-1 the @username / 'On Mingla' named-row line2 is GONE (item b)", () => {
  assert(
    !/`@\$\{guest\.username\}`/.test(SHEET),
    "named rows must not render `@${guest.username}` anymore",
  );
  assert(
    !/"On Mingla"/.test(SHEET),
    "the 'On Mingla' fallback branch is removed (replaced by the city / null)",
  );
  // line1 name source-of-truth is untouched (name still resolves the same way).
  assertStringIncludes(SHEET, 'guest.displayName ?? guest.username ?? "Guest"');
});

// ── T-2 (c) — named line2 shows the public city via cityFor(location) ───────

Deno.test("T-2 named line2 uses cityFor(guest.location) (item c)", () => {
  assertStringIncludes(SHEET, "const cityFor");
  // cityFor takes the first comma-segment (mirrors ViewFriendProfileScreen:638).
  assert(
    /loc\.split\(","\)\[0\]/.test(SHEET),
    "cityFor extracts the first comma-segment of profiles.location",
  );
  // The named branch of line2 is the computed city (not @username, not a
  // fabricated placeholder). city is derived from cityFor(guest.location).
  assertStringIncludes(SHEET, "cityFor(guest.location)");
  assert(
    /const city = item\.isNamed \? cityFor\(guest\.location\) : null;/.test(SHEET),
    "city is computed once from the gated location, null for non-named rows",
  );
});

// ── T-3 (e) — unlinked caption; distinct from anon-Mingla-private ───────────

Deno.test("T-3 unlinked rows show 'Not on Mingla' (item e)", () => {
  assertStringIncludes(SHEET, '"Not on Mingla"');
  // a11y parity for the unlinked case.
  assertStringIncludes(SHEET, '"Guest, not on Mingla"');
});

Deno.test("T-3b anon-Mingla-private stays 'Keeping it low-key' — the two cases are DISTINCT", () => {
  assertStringIncludes(SHEET, '"Keeping it low-key"');
  // The unlinked branch (isMinglaUser === false) and the anon-private branch
  // (isMinglaUser === true) resolve to DIFFERENT captions in the same ternary.
  assert(
    /guest\.isMinglaUser\s*\n?\s*\?\s*"Keeping it low-key"\s*\n?\s*:\s*"Not on Mingla"/.test(
      SHEET,
    ),
    "isMinglaUser splits into 'Keeping it low-key' (private) vs 'Not on Mingla' (unlinked)",
  );
});

// ── T-4 (c) — a11y label shows the city when present, name-only otherwise ───

Deno.test("T-4 a11y label appends the city for named rows, name-only when null", () => {
  assertStringIncludes(SHEET, "city !== null");
  assertStringIncludes(SHEET, "`${name}, ${city}`");
});

// ── T-5 — server-final payload is never client-filtered (A-2 seal) ──────────

Deno.test("T-5 no client-side row filtering introduced by the copy rewrite", () => {
  assert(!/\.filter\(/.test(SHEET), "no client-side row filtering (server-final)");
});

// ── T-6 — the type carries the location field the sheet consumes ────────────

Deno.test("T-6 PeerGuestRow declares location: string | null", () => {
  assert(
    /location:\s*string\s*\|\s*null;/.test(TYPES_RAW),
    "PeerGuestRow.location is the typed payload the sheet reads",
  );
});

// ── contract semantics (mirror of cityFor — documents SC-2/SC-3) ────────────

Deno.test("cityFor contract: first comma-segment, trimmed; empty/null → null", () => {
  // Mirror of the in-module helper (SPEC §4.3.1) — locks the intended behavior.
  const cityFor = (loc: string | null): string | null => {
    if (loc === null) return null;
    const city = loc.split(",")[0]?.trim() ?? "";
    return city.length > 0 ? city : null;
  };
  assertEquals(cityFor("Austin, Texas, United States"), "Austin"); // SC-2
  assertEquals(cityFor("London, England, United Kingdom"), "London");
  assertEquals(cityFor("London"), "London"); // no comma → whole string
  assertEquals(cityFor(null), null); // SC-3 — no fabrication
  assertEquals(cityFor("   "), null); // whitespace-only → null
  assertEquals(cityFor(""), null);
});
