// Issue #1529 — T-5, the SQL/TypeScript parity contract, TypeScript side.
//
// WHY THIS EXISTS. `public.mingla_e164_country()` and `countryFromE164()` are
// two implementations of ONE rule: turn a recipient's phone into the ISO-2
// country that governs their SMS. The SQL copy decides what gets written onto
// `notification_outbox.country_code`; the TypeScript copy decides what the
// edge functions derive at dispatch. If they drift, the stored country stops
// matching the derived country and #1529 returns wearing a different hat.
//
// HOW DRIFT IS MADE IMPOSSIBLE. This test does NOT keep its own copy of the
// fixtures. It READS them out of
// `supabase/migrations/__tests__/issue_1529_e164_parity.test.sql` — the same
// rows the SQL suite asserts against — and re-runs them through the TypeScript
// implementation. One fixture list, two implementations, one expected answer.
// That is the specific defence against the #1518 lesson (a test that keeps its
// own duplicate of the thing it is testing passes vacuously; see #1529
// Discovery 2, where `marketing-send/orch-1270-defer.test.ts` asserts against
// a verbatim copy of `countryFromE164` and would stay green if the production
// copy were deleted outright).
//
// fails-on-revert: delete the `+`-prepend in `normalizeE164` and every no-plus
// fixture (`ng_no_plus`, `ng_production_row`, `us_no_plus`) returns null
// instead of E.164, failing T5-2. Restore the `?? "US"`-style coercion
// anywhere in the country rule and `de_unmapped` / the email / the null cases
// stop being null, failing T5-3 and T5-5.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { countryFromE164, normalizeE164 } from "./e164Country.ts";

const FIXTURE_SQL_PATH = new URL(
  "../../migrations/__tests__/issue_1529_e164_parity.test.sql",
  import.meta.url,
);

interface Fixture {
  label: string;
  raw: string | null;
  expectE164: string | null;
  expectCountry: string | null;
}

/** `NULL` → null; `'…'` → the unquoted string. Fixtures never embed quotes. */
function parseSqlLiteral(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  assert(
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2,
    `fixture value is neither NULL nor a quoted literal: ${token}`,
  );
  return trimmed.slice(1, -1);
}

/**
 * Pull the canonical fixture rows out of the SQL test file.
 *
 * Deliberately strict: a missing marker, an empty block, or a malformed tuple
 * THROWS rather than yielding an empty list, because a silently-empty fixture
 * set is exactly how a parity test becomes unfalsifiable.
 */
function loadFixtures(): Fixture[] {
  const sql = Deno.readTextFileSync(FIXTURE_SQL_PATH);
  const begin = sql.indexOf("-- #1529-T5-FIXTURES-BEGIN");
  const end = sql.indexOf("-- #1529-T5-FIXTURES-END");
  assert(begin >= 0, "fixture BEGIN marker missing from the SQL test file");
  assert(end > begin, "fixture END marker missing/misordered in the SQL file");

  const block = sql.slice(begin, end);
  const fixtures: Fixture[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(")) continue;
    const inner = trimmed.slice(1, trimmed.lastIndexOf(")"));
    // Split on commas that are NOT inside a quoted literal.
    const parts: string[] = [];
    let current = "";
    let inQuote = false;
    for (const ch of inner) {
      if (ch === "'") inQuote = !inQuote;
      if (ch === "," && !inQuote) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current);
    assertEquals(
      parts.length,
      4,
      `fixture tuple must have 4 columns, got ${parts.length}: ${trimmed}`,
    );
    fixtures.push({
      label: parseSqlLiteral(parts[0]) ?? "<unlabelled>",
      raw: parseSqlLiteral(parts[1]),
      expectE164: parseSqlLiteral(parts[2]),
      expectCountry: parseSqlLiteral(parts[3]),
    });
  }
  return fixtures;
}

// ---------------------------------------------------------------------------
// T5-1 — VACUITY GUARD. Runs first and asserts the fixture set is non-empty
// and still covers every branch. If the SQL file is renamed, reflowed, or
// emptied, this FAILS instead of passing over zero rows.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-1: the shared fixture set loads, is non-empty, and keeps full branch coverage", () => {
  const fixtures = loadFixtures();
  assert(
    fixtures.length > 0,
    "ZERO fixtures parsed from the SQL file — the parity test would be vacuous",
  );
  assert(
    fixtures.length >= 18,
    `fixture set shrank: expected at least 18, got ${fixtures.length}`,
  );
  const countries = new Set(fixtures.map((f) => f.expectCountry));
  for (const required of ["NG", "US", "GB", "BE"]) {
    assert(countries.has(required), `fixture set lost ${required} coverage`);
  }
  assert(countries.has(null), "fixture set lost not-derivable (null) coverage");
  // The two cases that encode the bug must never disappear.
  assert(
    fixtures.some((f) => f.label === "ng_no_plus" && f.expectCountry === "NG"),
    "fixture set lost the plus-less Nigerian case (#1529 F-2)",
  );
  assert(
    fixtures.some((f) =>
      f.label === "de_unmapped" && f.expectCountry === null
    ),
    "fixture set lost the unmapped-calling-code-is-null case (#1529 F-1)",
  );
});

// ---------------------------------------------------------------------------
// T5-2 — normalizeE164 matches the SQL expectation on every fixture.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-2: normalizeE164 agrees with public.mingla_e164_normalize on every fixture", () => {
  const fixtures = loadFixtures();
  for (const f of fixtures) {
    assertEquals(
      normalizeE164(f.raw),
      f.expectE164,
      `normalizeE164 diverged from SQL on fixture "${f.label}" (raw=${
        JSON.stringify(f.raw)
      })`,
    );
  }
});

// ---------------------------------------------------------------------------
// T5-3 — countryFromE164 matches the SQL expectation on every fixture.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-3: countryFromE164 agrees with public.mingla_e164_country on every fixture", () => {
  const fixtures = loadFixtures();
  for (const f of fixtures) {
    assertEquals(
      countryFromE164(f.raw),
      f.expectCountry,
      `countryFromE164 diverged from SQL on fixture "${f.label}" (raw=${
        JSON.stringify(f.raw)
      })`,
    );
  }
});

// ---------------------------------------------------------------------------
// T5-4 — the Nigerian Stay case, asserted on its own.
//
// This is the exact production shape (#1529 F-2): Supabase stores the handset
// as `2347084065203` with no `+`, the dispatcher only recognises `+`-prefixed
// contacts as phones, so the row died as `no_contact` before country was ever
// consulted. Both halves must hold, or Nigeria stays untestable.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-4: the plus-less production Nigerian handset normalises AND resolves to NG", () => {
  assertEquals(normalizeE164("2347084065203"), "+2347084065203");
  assertEquals(countryFromE164("2347084065203"), "NG");
});

// ---------------------------------------------------------------------------
// T5-5 — NULL NEVER MEANS US. The defect, stated directly.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-5: an underivable contact returns null and is NEVER coerced to a country", () => {
  for (
    const underivable of [
      null,
      undefined,
      "",
      "   ",
      "guest@example.com",
      "user2000@example.com", // digits in the local part must not be mined
      "+4915112345678", // valid E.164, calling code not in the table
      "+",
      "not a number",
    ]
  ) {
    assertEquals(
      countryFromE164(underivable),
      null,
      `countryFromE164(${JSON.stringify(underivable)}) invented a country`,
    );
  }
});

// ---------------------------------------------------------------------------
// T5-6 — an unmapped calling code must not be silently absorbed by a shorter
// prefix. Guards the longest-prefix-first ordering: a naive `startsWith("+2")`
// or a reordered table would hand a German or Swiss handset to a mapped
// country.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-6: prefix matching is longest-first and does not over-match", () => {
  // +234 (NG) must not be shadowed, and its neighbours must not inherit it.
  assertEquals(countryFromE164("+2348012345678"), "NG");
  assertEquals(countryFromE164("+233201234567"), null); // Ghana — unmapped
  assertEquals(countryFromE164("+27831234567"), null); // South Africa — unmapped
  // +44 (GB) vs +4x neighbours.
  assertEquals(countryFromE164("+447700900000"), "GB");
  assertEquals(countryFromE164("+4915112345678"), null); // Germany — unmapped
  assertEquals(countryFromE164("+41441234567"), null); // Switzerland — unmapped
  // +1 (US/NANP) is the SHORTEST prefix and must be tested last, so it cannot
  // swallow a longer mapped code.
  assertEquals(countryFromE164("+14155550123"), "US");
});
