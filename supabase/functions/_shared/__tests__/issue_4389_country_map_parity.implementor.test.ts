// Issue #4389 — one country map. The SQL rail (payout_country_rail in the
// #4389 migration) and the edge lists agree on every country and currency.
// MINGLA-INVARIANT: I-4389-COUNTRY-MAP-PARITY | issue #4389 | payout_country_rail, _shared/stripeSupportedCountries.ts, _shared/payoutCountries.ts and mingla-business/src/constants/stripeSupportedCountries.ts list the same 35 countries with the same currencies (BG -> EUR).
// FAILS-ON-REVERT: putting BG back to BGN in any list fails this test.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { STRIPE_SUPPORTED_COUNTRIES } from "../stripeSupportedCountries.ts";
import { PAYOUT_COUNTRIES } from "../payoutCountries.ts";

async function sqlRail(): Promise<Record<string, string>> {
  const src = await Deno.readTextFile(
    new URL("../../../migrations/20280621004389_issue_4389_brand_setup.sql", import.meta.url),
  );
  const fn = src.slice(src.indexOf("FUNCTION public.payout_country_rail"), src.indexOf("AS m(country, provider, currency, tap_to_pay)"));
  const out: Record<string, string> = {};
  for (const m of fn.matchAll(/\('([A-Z]{2})','(stripe|paystack)','([A-Z]{3})',(true|false)\)/g)) out[m[1]] = m[3];
  return out;
}

async function appList(): Promise<Record<string, string>> {
  const src = await Deno.readTextFile(
    new URL("../../../../mingla-business/src/constants/stripeSupportedCountries.ts", import.meta.url),
  );
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/country: "([A-Z]{2})"[^}]*defaultCurrency: "([A-Z]{3})"/g)) out[m[1]] = m[2];
  return out;
}

Deno.test("#4389 — the SQL rail and every TS list agree (BG -> EUR)", async () => {
  const sql = await sqlRail();
  assertEquals(Object.keys(sql).length, 35);
  assertEquals(sql.BG, "EUR");
  const edge = Object.fromEntries(STRIPE_SUPPORTED_COUNTRIES.map((c) => [c.country, c.defaultCurrency]));
  assertEquals({ ...edge, NG: "NGN" }, sql);
  assertEquals(Object.fromEntries(PAYOUT_COUNTRIES.map((c) => [c.country, c.currency])), sql);
  assertEquals({ ...(await appList()), NG: "NGN" }, sql);
});
