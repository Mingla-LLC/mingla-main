import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  newSaleHostBody,
  storedHostNetCents,
} from "../businessNotifyTriggers.ts";

Deno.test("#3645 new-sale copy uses stored host net without inventing a rate", () => {
  assertEquals(
    storedHostNetCents(62_700, { connected_account_payout_cents: 61_800 }, 900),
    61_800,
  );
  assertEquals(storedHostNetCents(62_700, null, 900), 61_800);
  assertEquals(
    storedHostNetCents(62_700, { connected_account_payout_cents: 60_000 }, 900),
    61_800,
  );
  assertEquals(storedHostNetCents(62_700, {}, null), null);
  assertEquals(
    storedHostNetCents(
      62_700,
      { connected_account_payout_cents: "bad" },
      undefined,
    ),
    null,
  );
});

Deno.test("#3645 adversarial: missing stored net never labels gross as what the host gets", () => {
  const body = newSaleHostBody("Jazz night", null, "ngn");
  assertStringIncludes(body, "sale paid");
  assertFalse(body.includes("₦627"));
  assertFalse(body.includes("you'll get"));
});

Deno.test("#3645 happy: stored net is the only amount in the new-sale promise", () => {
  const body = newSaleHostBody("Jazz night", 61_800, "ngn");
  assertStringIncludes(body, "you'll get");
  assertStringIncludes(body, "618.00");
  assertStringIncludes(body, "paid out about a day from now");
  assertFalse(body.includes("627"));
});
