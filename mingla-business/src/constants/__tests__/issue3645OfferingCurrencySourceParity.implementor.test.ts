/**
 * issue #3645 — the currencies a Host can end up with must be exactly the
 * currencies the database says are supported.
 *
 * A brand's currency is decided by where its bank is:
 *   - a Stripe country gives that country's `defaultCurrency`
 *     (this app's `STRIPE_SUPPORTED_COUNTRIES` and its edge-function mirror);
 *   - a Nigerian (Paystack) bank gives NGN.
 *
 * `public.supported_brand_currencies` is the one list the database checks
 * offerings against (`is_supported_offering_currency`, and the foreign key on
 * `events.currency`). If the two sides drift, one of two things happens and
 * neither shows up until a real organiser hits it:
 *   - a country is added here whose currency the table does not list, so that
 *     organiser can connect a bank and then cannot create anything;
 *   - a currency is listed in the table that no bank country can produce.
 *
 * So this is a PARITY PIN, not a behaviour test: it reads the seed out of the
 * migration SQL and compares sets. It lives under mingla-business because this
 * suite runs on every pull request; the migration files and the edge mirror
 * have no jest runner of their own.
 *
 * FAILS WHEN:
 *   - a `defaultCurrency` is added to either country list without a seeded row;
 *   - a row is seeded (or removed) without a matching bank country;
 *   - the two country lists stop agreeing with each other;
 *   - a migration changes the table in a way this parser does not read
 *     (UPDATE / DELETE), so the pin cannot go quietly stale.
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import { STRIPE_SUPPORTED_COUNTRIES } from "../stripeSupportedCountries";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const EDGE_MIRROR = path.join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "stripeSupportedCountries.ts",
);

/** The Paystack rail's currency. Nigeria is not a Stripe country. */
const PAYSTACK_CURRENCY = "NGN";

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Remove `--` and block comments so commented-out SQL is never read as real. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

interface SeedRow {
  readonly code: string;
  readonly active: boolean;
  readonly file: string;
}

interface SeedRead {
  readonly rows: SeedRow[];
  readonly unreadWrites: string[];
  readonly filesRead: number;
}

/**
 * Every row any migration inserts into supported_brand_currencies, plus any
 * write to that table this parser cannot follow.
 */
function readSeededCurrencies(): SeedRead {
  const rows: SeedRow[] = [];
  const unreadWrites: string[] = [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    if (!sql.includes("supported_brand_currencies")) continue;

    const insert =
      /INSERT\s+INTO\s+(?:"?public"?\s*\.\s*)?"?supported_brand_currencies"?\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);/gi;
    for (const match of sql.matchAll(insert)) {
      const columns = match[1].split(",").map((column) => column.trim().replace(/"/g, ""));
      const codeAt = columns.indexOf("code");
      const activeAt = columns.indexOf("active");
      if (codeAt === -1) {
        unreadWrites.push(`${file}: INSERT without a code column`);
        continue;
      }
      const tuples = [...match[2].matchAll(/\(([^()]*)\)/g)];
      if (tuples.length === 0) {
        unreadWrites.push(`${file}: INSERT whose VALUES this parser cannot read`);
      }
      for (const tuple of tuples) {
        const cells = tuple[1].split(",").map((cell) => cell.trim());
        const code = /^'([A-Z]{3})'/.exec(cells[codeAt] ?? "");
        if (!code) {
          unreadWrites.push(`${file}: seed row with an unreadable code: (${tuple[1]})`);
          continue;
        }
        // The column defaults to true when the INSERT does not name it.
        const active = activeAt === -1 ? true : cells[activeAt] === "true";
        rows.push({ code: code[1], active, file });
      }
    }

    // Any other write to the table would make the rows above a stale picture.
    const otherWrite =
      /\b(UPDATE\s+(?:ONLY\s+)?(?:"?public"?\s*\.\s*)?"?supported_brand_currencies"?\b|DELETE\s+FROM\s+(?:"?public"?\s*\.\s*)?"?supported_brand_currencies"?\b|TRUNCATE\s+(?:TABLE\s+)?(?:"?public"?\s*\.\s*)?"?supported_brand_currencies"?\b)/gi;
    for (const match of sql.matchAll(otherWrite)) {
      unreadWrites.push(`${file}: ${match[1].replace(/\s+/g, " ")}`);
    }
  }
  return { rows, unreadWrites, filesRead: files.length };
}

/** `defaultCurrency` values written in the edge-function mirror (read as text). */
function readEdgeMirrorCurrencies(): string[] {
  const source = fs.readFileSync(EDGE_MIRROR, "utf8");
  return [...source.matchAll(/defaultCurrency:\s*["']([A-Za-z]{3})["']/g)].map((match) => match[1]);
}

describe("issue #3645 — bank-derived currencies equal the database's supported list", () => {
  const seed = readSeededCurrencies();
  const seededActive = sorted(seed.rows.filter((row) => row.active).map((row) => row.code));
  const clientCurrencies = sorted(STRIPE_SUPPORTED_COUNTRIES.map((country) => country.defaultCurrency));
  const edgeCurrencies = sorted(readEdgeMirrorCurrencies());

  test("the seed was actually found and read (the pin is not vacuous)", () => {
    expect(seed.filesRead).toBeGreaterThan(100);
    expect(seed.rows.length).toBeGreaterThan(0);
    expect(STRIPE_SUPPORTED_COUNTRIES.length).toBeGreaterThan(0);
    expect(readEdgeMirrorCurrencies().length).toBe(STRIPE_SUPPORTED_COUNTRIES.length);
  });

  test("no migration writes the table in a way this pin cannot read", () => {
    // If this fails, a migration updated or deleted a currency row. Teach
    // readSeededCurrencies() about it, then re-check the sets below.
    expect(seed.unreadWrites).toEqual([]);
  });

  test("every seeded code is seeded once and is three capitals", () => {
    const codes = seed.rows.map((row) => row.code);
    expect(codes).toEqual([...new Set(codes)]);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  test("the app's country list and its edge-function mirror give the same currencies", () => {
    expect(edgeCurrencies).toEqual(clientCurrencies);
  });

  test("Stripe default currencies plus the Paystack currency equal the seeded active codes", () => {
    const bankDerived = sorted([...clientCurrencies, PAYSTACK_CURRENCY]);
    const missingFromTable = bankDerived.filter((code) => !seededActive.includes(code));
    const noBankCountry = seededActive.filter((code) => !bankDerived.includes(code));
    // Reported separately so a failure says WHICH side drifted.
    expect({ missingFromTable, noBankCountry }).toEqual({ missingFromTable: [], noBankCountry: [] });
    expect(bankDerived).toEqual(seededActive);
  });

  test("the Paystack currency is not also a Stripe default (it must be added exactly once)", () => {
    expect(clientCurrencies).not.toContain(PAYSTACK_CURRENCY);
    expect(seededActive).toContain(PAYSTACK_CURRENCY);
  });
});
