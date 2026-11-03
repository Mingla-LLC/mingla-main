// Issue #4238 wave 2 retest — TESTER adversarial. Seth's rule: an audience of
// 1-9 people reads "Fewer than 10 people" and an empty one "No people yet".
// host_ad_audiences encodes 1-9 as approx_size 1 (the Host app turns that into
// "Fewer than 10 people"). Ari's list_ad_audiences passes the raw number to
// the model under a tool description that says "rough sizes", so Ari can tell
// a Host "about 1 person" for a list of 6. The tool result must carry the
// words, never a bare size below 10. Fakes only: no provider, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";

const BRAND = "b4238000-0000-4000-8000-000000000001";
const rows = [
  { audience_key: `brand:${BRAND}:contacts`, display_name: "Your contacts", kind: "list", approx_size: 1, lookalike_country: null, platforms: [] },
  { audience_key: `brand:${BRAND}:guests`, display_name: "Your past guests", kind: "list", approx_size: 0, lookalike_country: null, platforms: [] },
  { audience_key: `brand:${BRAND}:vips`, display_name: "Your past guests", kind: "list", approx_size: 150, lookalike_country: null, platforms: [] },
];
const client = {
  rpc: (name: string) =>
    Promise.resolve(name === "host_ad_audiences" ? { data: rows, error: null } : { data: null, error: { message: "unexpected" } }),
};

Deno.test("#4238 Ari never states a 1-9 or empty audience as a bare number", async () => {
  const tool = DOMAIN_TOOLS.find((item) => item.name === "list_ad_audiences");
  assert(tool, "list_ad_audiences exists");
  const out = await tool.executor({ brand_id: BRAND }, client, "u1", {} as never) as {
    audiences: Record<string, unknown>[];
  };
  const byKey = new Map(out.audiences.map((row) => [String(row.key), row]));
  const small = JSON.stringify(byKey.get(`brand:${BRAND}:contacts`));
  const empty = JSON.stringify(byKey.get(`brand:${BRAND}:guests`));
  const large = JSON.stringify(byKey.get(`brand:${BRAND}:vips`));
  // Expected-vs-actual in one place so a failure names every gap.
  assertEquals(
    {
      smallSaysWords: small.includes("Fewer than 10 people"),
      smallHasNoBareOne: !/"approx_size":\s*[1-9]\b(?!\d)/.test(small),
      emptySaysWords: empty.includes("No people yet"),
      largeKeepsItsSize: /150/.test(large),
    },
    { smallSaysWords: true, smallHasNoBareOne: true, emptySaysWords: true, largeKeepsItsSize: true },
  );
});
