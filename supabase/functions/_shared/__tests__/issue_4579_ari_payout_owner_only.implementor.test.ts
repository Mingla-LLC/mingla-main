// Issue #4579 — Ari gives a non-owner the same reason as the screen.
// FAILS-ON-REVERT: dropping `payout_settings_owner_only` from
// PAYOUT_COUNTRY_MESSAGES (or restoring the old "owner or a brand admin" copy)
// turns Ari's answer back into "The bank country didn't save" and fails both tests.
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { executeSetBrandPayoutCountry } from "../agentBrandSetupTools.ts";

const BRAND = "45790000-0000-4000-b000-0000000000a1";
const OWNER_ONLY = "Only the brand owner can change payout settings. Nothing was changed.";

function refusing(message: string) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      rpc: (name: string) => {
        calls.push(name);
        return Promise.resolve({ data: null, error: { message } });
      },
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
}

Deno.test("#4579 P2-1 — a Brand admin is told only the owner can change payout settings", async () => {
  // The database's real refusal (trigger and RPC both raise this code).
  const f = refusing("payout_settings_owner_only");
  const err = await assertRejects(
    () => executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "GB" }, f.client as never),
    Error,
  );
  assertEquals(err.message, OWNER_ONLY);
  assertEquals((err as Error & { code?: string }).code, "PAYOUT_SETTINGS_OWNER_ONLY");
  assertEquals(f.calls, ["biz_set_brand_payout_country"]);
});

Deno.test("#4579 P2-1 — the older `forbidden` refusal gives the same owner-only reason", async () => {
  const f = refusing("forbidden");
  const err = await assertRejects(
    () => executeSetBrandPayoutCountry({ brand_id: BRAND, country_code: "Germany" }, f.client as never),
    Error,
  );
  assertEquals(err.message, OWNER_ONLY);
});
