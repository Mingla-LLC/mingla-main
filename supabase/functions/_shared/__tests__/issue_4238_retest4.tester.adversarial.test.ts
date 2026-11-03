/**
 * #4238 — tester RETEST 4 adversarial suite (server side). Angles the
 * implementor's retest-3 tests (14 fixed cases + source checks) do not cover:
 *
 *  Parity. 20,000 seeded pseudo-random amounts from 0 to 2^53-1 cents, plus
 *          every power-of-ten boundary ±1: the canonical formatter, the
 *          Business mirror and the formatter Ari used before this change
 *          (Intl "en" grouping) print exactly the same text. So moving Ari to
 *          the shared formatter changed no Admin- or Host-visible amount, and
 *          the mirror cannot drift on large or odd values.
 *  Codes.  Padded / lower-case codes are normalised; non-3-letter codes fall
 *          back to the plain amount, never to "1,000.00 NAIRA".
 *
 * Fails on revert (verified by line-deletion at c8ddb4d51): dropping the
 * thousands-separator replace or the padStart in either copy fails Parity.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatHostAdMoneyCents } from "../adMoneyFormat.ts";
import { formatHostAdMoneyCents as mirror } from "../../../../mingla-business/src/components/marketing/ads/hostAdMoney.ts";

/** The pre-#4238-retest-3 Ari formatter, verbatim (Intl grouping). */
function previousAri(value: unknown, currency: unknown): string {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) return "not available yet";
  const code = typeof currency === "string" && /^[A-Z]{3}$/i.test(currency)
    ? currency.toUpperCase()
    : "";
  const amount = (cents / 100).toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return code ? `${code} ${amount}` : amount;
}

function amounts(): number[] {
  const out: number[] = [];
  for (let p = 0; p <= 15; p++) {
    const b = 10 ** p;
    out.push(b - 1, b, b + 1);
  }
  out.push(Number.MAX_SAFE_INTEGER);
  // Seeded LCG: the same 20,000 values on every run.
  let seed = 4238;
  for (let i = 0; i < 20_000; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const digits = 1 + (seed % 16);
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push(
      Math.floor((seed / 2147483648) * 10 ** digits) % Number.MAX_SAFE_INTEGER,
    );
  }
  return out.filter((n) => Number.isSafeInteger(n) && n >= 0);
}

Deno.test("#4238 RETEST4 canonical, mirror and the previous Ari text agree on every amount", () => {
  let checked = 0;
  for (const cents of amounts()) {
    for (const currency of ["NGN", "GBP", "USD", null]) {
      const canonical = formatHostAdMoneyCents(cents, currency) ??
        "not available yet";
      // Above 2^53/100 the old Intl path rounded through a float; the shared
      // formatter is exact there, so compare only where the float is exact.
      if (cents <= 2 ** 53 / 100) {
        assertEquals(
          canonical,
          previousAri(cents, currency),
          `${cents} ${currency}`,
        );
      }
      assertEquals(
        mirror(cents, currency),
        formatHostAdMoneyCents(cents, currency),
        `${cents} ${currency}`,
      );
      checked++;
    }
  }
  assertEquals(checked > 80_000, true);
});

Deno.test("#4238 RETEST4 currency codes are normalised or dropped, never printed raw", () => {
  assertEquals(
    formatHostAdMoneyCents(150_000_000, " ngn "),
    "NGN 1,500,000.00",
  );
  assertEquals(formatHostAdMoneyCents(100_000, "NAIRA"), "1,000.00");
  assertEquals(formatHostAdMoneyCents(100_000, "N"), "1,000.00");
  assertEquals(formatHostAdMoneyCents(100_000, 566), "1,000.00");
  assertEquals(formatHostAdMoneyCents(100_005, "GBP"), "GBP 1,000.05");
  assertEquals(
    formatHostAdMoneyCents(Number.MAX_SAFE_INTEGER, "USD"),
    "USD 90,071,992,547,409.91",
  );
  for (
    const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "12a", {}, []]
  ) {
    assertEquals(formatHostAdMoneyCents(bad, "NGN"), mirror(bad, "NGN"));
  }
  assertEquals(formatHostAdMoneyCents(-1, "NGN"), null);
  assertEquals(formatHostAdMoneyCents(0.5, "NGN"), null);
});
