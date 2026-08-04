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

import {
  countryFromE164,
  normalizeE164,
  PRODUCTION_CALLING_CODES,
} from "./e164Country.ts";

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
// T5-7 (#1529 P2-1) — EVERY CALLING CODE PRESENT IN PRODUCTION MUST RESOLVE.
//
// The SPEC justified the bounded map on the stated basis that the excluded
// population was "zero in production today". That was FALSE: a direct query of
// auth.users.phone on 2026-08-03 returned +1 26, +234 18, +44 3, +32 2, and
// **+33 2**. Two real users hold French handsets and, under the original map,
// would have failed closed with country_unresolved — no text, ever, by
// construction — where origin/main reached them over Twilio.
//
// THIS IS THE ASSERTION THAT STOPS IT RECURRING: reaching a new market fails
// this test until the calling code is mapped, rather than silently condemning
// the new users to permanent non-delivery. Mirrored by the SQL twin's
// $production_coverage$ block.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-7: every calling code observed in production resolves to a country", () => {
  // Full-length samples per code: the P3-1 minimum-digit floor means a bare
  // calling code correctly resolves to null, so short samples would make this
  // assertion lie about what it proves.
  const samples: Record<string, string> = {
    "+1": "+14155550123",
    "+234": "+2348012345678",
    "+44": "+447700900000",
    "+33": "+33075123456",
    "+32": "+32460964460",
  };

  assert(
    PRODUCTION_CALLING_CODES.length > 0,
    "PRODUCTION_CALLING_CODES is empty — this guard would be vacuous",
  );
  assert(
    PRODUCTION_CALLING_CODES.length >= 5,
    `production calling-code inventory shrank: ${PRODUCTION_CALLING_CODES.length}`,
  );

  for (const code of PRODUCTION_CALLING_CODES) {
    const sample = samples[code];
    assert(
      sample !== undefined,
      `no sample handset for production calling code ${code} — add one so this guard cannot be silently skipped`,
    );
    assert(
      countryFromE164(sample) !== null,
      `production calling code ${code} HAS NO MAPPING — real users on this code would never receive a text`,
    );
  }

  // France specifically, because it is the one that was actually missing.
  assertEquals(countryFromE164("+33075123456"), "FR");
  // Nigeria must still resolve to NG, not merely to "something".
  assertEquals(countryFromE164("+2348012345678"), "NG");
});

// ---------------------------------------------------------------------------
// T5-8 (#1529 P3-1) — a bare calling code is not a reachable handset.
//
// `E164_RE` alone accepts any 2-15 digit string, so '+234' used to resolve to
// NG and '+1 (800) FLOWERS' stripped to '+1800' and resolved to US. Neither is
// a phone number. They still NORMALISE (they are syntactically valid E.164 —
// the normaliser's contract is unchanged, which is what keeps the tester's
// hostile fixtures honest) but they must resolve to NO country.
// ---------------------------------------------------------------------------
Deno.test("#1529 T5-8: a bare calling code normalises but resolves to no country", () => {
  for (const bare of ["+234", "+1800", "+44", "+33", "+32"]) {
    assertEquals(
      normalizeE164(bare),
      bare,
      `${bare} must still normalise — the normaliser contract is unchanged`,
    );
    assertEquals(
      countryFromE164(bare),
      null,
      `${bare} is a calling code, not a handset, and must not resolve`,
    );
  }
  // '+1 (800) FLOWERS' — letters stripped, leaving a non-handset.
  assertEquals(countryFromE164("+1 (800) FLOWERS"), null);
  // The floor must not reject genuinely short-but-real numbers: 7 digits total.
  assertEquals(normalizeE164("+2904567"), "+2904567");
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
