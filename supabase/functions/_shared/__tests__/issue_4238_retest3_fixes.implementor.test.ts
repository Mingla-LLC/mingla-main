/**
 * #4238 retest 3 — one money formatter for Host ad money.
 *
 * The canonical formatter lives in _shared/adMoneyFormat.ts (edge code can
 * bundle it). The Business Ari card reads a mirror; this test fails if the
 * two ever print different text, or if either side formats money another way.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatHostAdMoneyCents } from "../adMoneyFormat.ts";
import { formatHostAdMoneyCents as mirror } from "../../../../mingla-business/src/components/marketing/ads/hostAdMoney.ts";

const CASES: Array<[unknown, unknown]> = [
  [150_000_000, "NGN"],
  [150_000_000, "ngn"],
  [25_000, "GBP"],
  [0, "USD"],
  [5, "USD"],
  [99, "EUR"],
  [100_000_000_000, "NGN"],
  [123_456, null],
  [123_456, ""],
  [123_456, "NAIRA"],
  [-1, "NGN"],
  [1.5, "NGN"],
  [Number.NaN, "NGN"],
  ["2500", "GBP"],
];

Deno.test("#4238 retest 3 Host ad money is written one way", () => {
  assertEquals(formatHostAdMoneyCents(150_000_000, "NGN"), "NGN 1,500,000.00");
  assertEquals(formatHostAdMoneyCents(25_000, "GBP"), "GBP 250.00");
  assertEquals(formatHostAdMoneyCents(5, "USD"), "USD 0.05");
  assertEquals(formatHostAdMoneyCents(123_456, null), "1,234.56");
  assertEquals(formatHostAdMoneyCents(-1, "NGN"), null);
});

Deno.test("#4238 retest 3 the Business mirror prints exactly the same text", async () => {
  for (const [value, currency] of CASES) {
    assertEquals(
      mirror(value, currency),
      formatHostAdMoneyCents(value, currency),
      `${String(value)} ${String(currency)}`,
    );
  }
  const canonical = await Deno.readTextFile(
    new URL("../adMoneyFormat.ts", import.meta.url),
  );
  const copy = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/marketing/ads/hostAdMoney.ts",
      import.meta.url,
    ),
  );
  const body = (source: string) =>
    source.slice(source.indexOf("export function"));
  assertEquals(body(copy), body(canonical));
});

Deno.test("#4238 retest 3 Ari and its card use the one formatter", async () => {
  const ari = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  assert(
    ari.includes(
      'import { formatHostAdMoneyCents } from "./adMoneyFormat.ts";',
    ),
  );
  assert(!ari.includes("toFixed(2)} ${code}"));
  const card = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/ari/ToolProposalCard.tsx",
      import.meta.url,
    ),
  );
  assert(card.includes("return formatHostAdMoneyCents(cents, currency);"));
  assert(!card.includes("`${amount} ${code}`"));
});
