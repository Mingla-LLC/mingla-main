// #4238 AC 5: the best video so far (lowest spend per tap) against the worst.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostAdBestVideo, type HostAdCreativeMetricRow } from "../hostAdOverview.ts";

const r = (creative_id: string | null, spend: number, taps: number, platform = "meta", currency = "NGN"): HostAdCreativeMetricRow => ({
  creative_id,
  platform,
  spend_cents: spend,
  link_clicks: taps,
  currency,
});
const names = new Map([["a", "Video A"], ["b", "Video B"], ["c", "Video C"]]);
const same = () => Promise.resolve(null);

Deno.test("#4238 best video: Tinoe-like three videos name the lowest and highest per tap", async () => {
  const out = await hostAdBestVideo({
    rows: [r("a", 409, 210, "snapchat", "USD"), r("b", 309, 84, "snapchat", "USD"), r("c", 100, 40, "meta", "USD"), r("a", 0, 0)],
    hostCurrency: "NGN",
    convert: ({ amount }) => Promise.resolve(amount * 1400),
    names,
  });
  assertEquals(out?.best.creative_id, "a");
  assertEquals(out?.best.spend_per_tap_credit_cents, Math.round((409 * 1400) / 210));
  assertEquals(out?.worst.creative_id, "b");
  assertEquals(out?.worst.name, "Video B");
});

Deno.test("#4238 best video: fewer than two with taps is null", async () => {
  assertEquals(await hostAdBestVideo({ rows: [r("a", 100, 10), r("b", 100, 0)], hostCurrency: "NGN", convert: same, names }), null);
});

Deno.test("#4238 best video: ties go to more taps, then id", async () => {
  const out = await hostAdBestVideo({
    rows: [r("b", 100, 10), r("a", 200, 20), r("c", 900, 30)],
    hostCurrency: "NGN",
    convert: same,
    names,
  });
  assertEquals(out?.best.creative_id, "a"); // 10 a tap each, a has more taps
  const byId = await hostAdBestVideo({
    rows: [r("b", 100, 10), r("a", 100, 10), r("c", 900, 30)],
    hostCurrency: "NGN",
    convert: same,
    names,
  });
  assertEquals(byId?.best.creative_id, "a");
});

Deno.test("#4238 best video: best equal to worst is null", async () => {
  assertEquals(await hostAdBestVideo({ rows: [r("a", 100, 10), r("b", 200, 20)], hostCurrency: "NGN", convert: same, names }), null);
});

Deno.test("#4238 best video: an FX failure is null; a null creative is skipped; no name hides", async () => {
  assertEquals(
    await hostAdBestVideo({ rows: [r("a", 100, 10, "meta", "USD"), r("b", 300, 10)], hostCurrency: "NGN", convert: same, names }),
    null,
  );
  const skipped = await hostAdBestVideo({ rows: [r(null, 1, 1000), r("a", 100, 10), r("b", 300, 10)], hostCurrency: "NGN", convert: same, names });
  assertEquals([skipped?.best.creative_id, skipped?.worst.creative_id], ["a", "b"]);
  assertEquals(
    await hostAdBestVideo({ rows: [r("a", 100, 10), r("z", 300, 10)], hostCurrency: "NGN", convert: same, names }),
    null,
  );
});
