// Issue #3645 — the currencies a Host can end up with must be exactly the
// currencies the database says are supported.
//
// A brand's currency is decided by where its bank is:
//   - a Stripe country gives that country's `defaultCurrency` (the Host app's
//     STRIPE_SUPPORTED_COUNTRIES and its edge-function mirror);
//   - a Nigerian (Paystack) bank gives NGN.
//
// public.supported_brand_currencies is the one list the database checks
// offerings against (is_supported_offering_currency, and the foreign key on
// events.currency). If the two sides drift, neither failure shows up until a
// real organiser hits it:
//   - a country is added whose currency the table does not list, so that
//     organiser can connect a bank and then cannot create anything;
//   - a currency is listed in the table that no bank country can produce.
//
// This is a structural parity rule over three source files, so it lives here
// as a gate-folder test rather than as a Host-app jest test: the Host suite
// refuses new tests that only read source text (#1047), and names this folder
// as the place for a genuine structural rule.
//
// FAILS WHEN:
//   - a defaultCurrency is added to either country list without a seeded row;
//   - a row is seeded without a matching bank country;
//   - the two country lists stop agreeing with each other;
//   - a migration changes the table in a way this parser does not read
//     (UPDATE / DELETE / TRUNCATE), so the pin cannot go quietly stale.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const CLIENT_LIST = path.join(REPO_ROOT, "mingla-business", "src", "constants", "stripeSupportedCountries.ts");
const EDGE_MIRROR = path.join(REPO_ROOT, "supabase", "functions", "_shared", "stripeSupportedCountries.ts");

/** The Paystack rail's currency. Nigeria is not a Stripe country. */
const PAYSTACK_CURRENCY = "NGN";

const sorted = (values) => [...new Set(values)].sort();

/** Remove comments so commented-out code is never read as real. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(--|\/\/)[^\n]*/g, "");
}

/** Every `defaultCurrency: "XXX"` written in a country-list source file. */
export function readDefaultCurrencies(source) {
  return [...stripComments(source).matchAll(/defaultCurrency:\s*["']([A-Za-z]{3})["']/g)].map((m) => m[1]);
}

const TABLE = String.raw`(?:"?public"?\s*\.\s*)?"?supported_brand_currencies"?`;

/**
 * Every row a set of { name, sql } migrations inserts into
 * supported_brand_currencies, plus any write this parser cannot follow.
 */
export function readSeededCurrencies(files) {
  const rows = [];
  const unreadWrites = [];
  for (const file of files) {
    const sql = stripComments(file.sql);
    if (!sql.includes("supported_brand_currencies")) continue;

    const insert = new RegExp(String.raw`INSERT\s+INTO\s+${TABLE}\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);`, "gi");
    for (const match of sql.matchAll(insert)) {
      const columns = match[1].split(",").map((column) => column.trim().replace(/"/g, ""));
      const codeAt = columns.indexOf("code");
      const activeAt = columns.indexOf("active");
      if (codeAt === -1) {
        unreadWrites.push(`${file.name}: INSERT without a code column`);
        continue;
      }
      const tuples = [...match[2].matchAll(/\(([^()]*)\)/g)];
      if (tuples.length === 0) unreadWrites.push(`${file.name}: INSERT whose VALUES this parser cannot read`);
      for (const tuple of tuples) {
        const cells = tuple[1].split(",").map((cell) => cell.trim());
        const code = /^'([A-Z]{3})'/.exec(cells[codeAt] ?? "");
        if (!code) {
          unreadWrites.push(`${file.name}: seed row with an unreadable code: (${tuple[1]})`);
          continue;
        }
        // The column defaults to true when the INSERT does not name it.
        rows.push({ code: code[1], active: activeAt === -1 ? true : cells[activeAt] === "true", file: file.name });
      }
    }
    // An INSERT ... SELECT is a write the tuple reader above never sees.
    const insertSelect = new RegExp(String.raw`INSERT\s+INTO\s+${TABLE}[^;]*?\bSELECT\b`, "gi");
    for (const _ of sql.matchAll(insertSelect)) unreadWrites.push(`${file.name}: INSERT ... SELECT`);

    const otherWrite = new RegExp(
      String.raw`\b(UPDATE\s+(?:ONLY\s+)?${TABLE}|DELETE\s+FROM\s+(?:ONLY\s+)?${TABLE}|TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?${TABLE})(?![\w"])`,
      "gi",
    );
    for (const match of sql.matchAll(otherWrite)) {
      unreadWrites.push(`${file.name}: ${match[1].replace(/\s+/g, " ")}`);
    }
  }
  return { rows, unreadWrites };
}

function realMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
}

const migrations = realMigrations();
const seed = readSeededCurrencies(migrations);
const seededActive = sorted(seed.rows.filter((row) => row.active).map((row) => row.code));
const clientRaw = readDefaultCurrencies(fs.readFileSync(CLIENT_LIST, "utf8"));
const edgeRaw = readDefaultCurrencies(fs.readFileSync(EDGE_MIRROR, "utf8"));

test("the three sources were actually found and read (the pin is not vacuous)", () => {
  assert.ok(migrations.length > 100, `only ${migrations.length} migrations read`);
  assert.ok(seed.rows.length > 0, "no seed rows were read");
  assert.ok(clientRaw.length > 0, "no defaultCurrency read from the Host app list");
  assert.equal(edgeRaw.length, clientRaw.length, "the two country lists have different lengths");
  console.log(`seeded active codes (${seededActive.length}): ${seededActive.join(", ")}`);
  console.log(`Host app default currencies (${sorted(clientRaw).length}): ${sorted(clientRaw).join(", ")}`);
  console.log(`edge mirror default currencies (${sorted(edgeRaw).length}): ${sorted(edgeRaw).join(", ")}`);
});

test("no migration writes the table in a way this pin cannot read", () => {
  // If this fails, a migration updated or deleted a currency row. Teach
  // readSeededCurrencies() about it, then re-check the sets below.
  assert.deepEqual(seed.unreadWrites, []);
});

test("every seeded code is seeded once", () => {
  const codes = seed.rows.map((row) => row.code);
  assert.deepEqual(codes, [...new Set(codes)]);
});

test("the Host app's country list and its edge mirror give the same currencies", () => {
  assert.deepEqual(sorted(edgeRaw), sorted(clientRaw));
});

test("Stripe default currencies plus the Paystack currency equal the seeded active codes", () => {
  const bankDerived = sorted([...clientRaw, PAYSTACK_CURRENCY]);
  // Reported separately so a failure says WHICH side drifted.
  assert.deepEqual(
    {
      missingFromTable: bankDerived.filter((code) => !seededActive.includes(code)),
      noBankCountry: seededActive.filter((code) => !bankDerived.includes(code)),
    },
    { missingFromTable: [], noBankCountry: [] },
  );
  assert.deepEqual(bankDerived, seededActive);
});

test("the Paystack currency is seeded and is not also a Stripe default", () => {
  assert.ok(!clientRaw.includes(PAYSTACK_CURRENCY));
  assert.ok(seededActive.includes(PAYSTACK_CURRENCY));
});

// ── the readers themselves, on fixtures: a parity pin is only as good as them ──
test("reader: a new bank country without a seeded row is reported as missing from the table", () => {
  const client = readDefaultCurrencies('{ country: "AU", defaultCurrency: "AUD" }, { country: "GB", defaultCurrency: "GBP" }');
  const fixture = readSeededCurrencies([
    { name: "1.sql", sql: "INSERT INTO public.supported_brand_currencies (code, active) VALUES ('GBP', true), ('NGN', true);" },
  ]);
  const active = fixture.rows.filter((row) => row.active).map((row) => row.code);
  assert.deepEqual(sorted([...client, "NGN"]).filter((code) => !active.includes(code)), ["AUD"]);
});

test("reader: inactive rows, commented-out rows and commented-out countries are not counted", () => {
  const fixture = readSeededCurrencies([
    {
      name: "1.sql",
      sql: "INSERT INTO public.supported_brand_currencies (code, minor_unit_exponent, active) VALUES\n  ('GBP', 2, true),\n  -- ('JPY', 0, true),\n  ('SEK', 2, false);",
    },
  ]);
  assert.deepEqual(fixture.rows.map((row) => `${row.code}:${row.active}`), ["GBP:true", "SEK:false"]);
  assert.deepEqual(readDefaultCurrencies('// { defaultCurrency: "JPY" }\n{ defaultCurrency: "GBP" }'), ["GBP"]);
});

test("reader: UPDATE, DELETE, TRUNCATE and INSERT ... SELECT on the table are flagged, reads are not", () => {
  const fixture = readSeededCurrencies([
    { name: "a.sql", sql: "UPDATE public.supported_brand_currencies SET active = false WHERE code = 'ISK';" },
    { name: "b.sql", sql: 'DELETE FROM "public"."supported_brand_currencies" WHERE code = \'HUF\';' },
    { name: "c.sql", sql: "TRUNCATE TABLE supported_brand_currencies;" },
    { name: "d.sql", sql: "INSERT INTO public.supported_brand_currencies (code) SELECT 'JPY';" },
    { name: "e.sql", sql: "SELECT 1 FROM public.supported_brand_currencies c WHERE c.active; -- UPDATE public.supported_brand_currencies" },
  ]);
  assert.deepEqual(fixture.unreadWrites.map((entry) => entry.split(":")[0]), ["a.sql", "b.sql", "c.sql", "d.sql"]);
});
