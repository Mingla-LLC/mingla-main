// issue #962 [pre-bank-currency-degbp] — TESTER ADVERSARIAL (different angle
// from the implementor's R2). R2 asserted the discover feed emits "USD" for
// null / missing currency and pinned the /e/ seed via a SOURCE-TEXT grep
// (`assertStringIncludes(seed, 'currency: row.currency ?? "USD"')`). This suite
// attacks a different seam: BEHAVIOURAL parity, not source text. It replicates
// the /e/ cold-seed coalescing rule as a reference function and asserts the REAL
// `mapRpcRowToCard` emits the byte-identical currency across a full edge matrix
// — INCLUDING the empty-string input R2 never exercises — and that GBP is never
// fabricated, while a brand that genuinely chose GBP still passes through.
//
// Why behavioural-parity matters beyond the grep: a future edit could keep the
// seed's source string intact yet change discover's coalescing (e.g. drop the
// `?? "USD"` or re-wrap), and R2's grep would stay green. This test compares the
// two runtime behaviours directly, input by input.
//
// FAILS-ON-REVERT: revert `_business-query.ts:133` to `String(row.currency ??
// "GBP")` → the null / missing / whitespace rows diverge from the USD reference
// and the "never GBP" assertion trips. Append-only; new file.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { mapRpcRowToCard } from "../_business-query.ts";

// The EXACT /e/ cold-seed rule, verbatim from
// app-mobile/src/services/publicEventSeedService.ts:175 (`row.currency ?? "USD"`).
// Kept as a runtime reference so we compare BEHAVIOUR, not source text.
function seedCurrency(rowCurrency: unknown): string {
  return (rowCurrency ?? "USD") as string;
}

function discoverRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "adv-962-parity-0001",
    brand_id: "adv-962-brand-0001",
    brand_slug: "prebank-brand",
    brand_name: "Pre-Bank Brand",
    slug: "the-parity-test",
    title: "The Parity Test",
    theme: { coverHue: 25, business_event: { format: "in_person" } },
    location_text: "The Venue",
    city: "London",
    timezone: "Europe/London",
    is_online: false,
    master_start_at: "2026-09-17T17:00:00+00:00",
    master_end_at: "2026-09-18T08:00:00+00:00",
    event_type: "event",
    ...overrides,
  };
}

// Edge matrix — [label, the raw row.currency value]. `MISSING` is modelled by
// omitting the key entirely (below), not by this table.
const matrix: Array<[string, unknown]> = [
  ["null (pre-bank, the reachable case)", null],
  ["empty string (R2 never tests this)", ""],
  ["whitespace-only", "   "],
  ["lower-case real code", "usd"],
  ["real NGN", "NGN"],
  ["genuine GBP brand (must pass through)", "GBP"],
];

for (const [label, value] of matrix) {
  Deno.test(`issue #962 adv — discover matches the /e/ seed for: ${label}`, () => {
    const card = mapRpcRowToCard(discoverRow({ currency: value }));
    // Behavioural byte-match against the seed's coalescing rule.
    assertEquals(card.currency, String(seedCurrency(value)));
  });
}

Deno.test("issue #962 adv — a MISSING currency key matches the seed (both USD)", () => {
  const card = mapRpcRowToCard(discoverRow()); // no `currency` key at all
  assertEquals(card.currency, String(seedCurrency(undefined)));
  assertEquals(card.currency, "USD");
});

Deno.test("issue #962 adv — GBP is NEVER fabricated for an UNSET currency", () => {
  // The reachable pre-bank states (null / missing) — the DB write path now
  // persists NULL, so these are the states a consumer deck actually sees. Neither
  // may resolve to GBP.
  assert(mapRpcRowToCard(discoverRow({ currency: null })).currency !== "GBP");
  assert(mapRpcRowToCard(discoverRow()).currency !== "GBP");
});

Deno.test("issue #962 adv — a genuine GBP brand is NOT over-corrected to USD", () => {
  // De-GBP means 'never MANUFACTURE gbp', not 'never ALLOW gbp'. A brand that
  // truly chose GBP keeps it — proving the fix does not clobber real currencies.
  assertEquals(mapRpcRowToCard(discoverRow({ currency: "GBP" })).currency, "GBP");
});
