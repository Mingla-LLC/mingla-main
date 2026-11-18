// #4453 milestone 9 — brand-site-runtime-resolve's detail answer: every Core
// read is bound to the signed site and re-validated before it leaves Core.
import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { answerOfferingDetail, type DetailRpc, detailPagesEnabled, parseDetailRequest } from "./detail.ts";

const SITE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const TRIP = "aaaaaaaa-bbbb-4ccc-8ddd-000000000009";

function rpcOf(answers: Record<string, unknown>, calls: Array<{ fn: string; args: Record<string, unknown> }> = [], error: unknown = null): DetailRpc {
  return (fn, args) => {
    calls.push({ fn, args });
    return Promise.resolve({ data: answers[fn] ?? null, error });
  };
}

const trip = {
  offering_id: TRIP, kind: "trip",
  days: [{ day: 1, title: "Leknes to Hamnøy", summary: "Transfer and kit check" }],
  included: ["Guides"], stay: null, photos: [],
};

Deno.test("#4453 M9 — a valid detail passes through, bound to the signed site", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const detail = await answerOfferingDetail(rpcOf({ brand_site_offering_detail: trip }, calls), SITE, { kind: "trip", slug: "lofoten" });
  assertEquals(detail?.days[0]?.title, "Leknes to Hamnøy");
  assertEquals(calls, [{ fn: "brand_site_offering_detail", args: { p_site_id: SITE, p_kind: "trip", p_slug: "lofoten" } }]);
});

Deno.test("#4453 M9 — adversarial: another kind, unknown keys, a price or a foreign photo are refused", async () => {
  const run = (data: unknown) => answerOfferingDetail(rpcOf({ brand_site_offering_detail: data }), SITE, { kind: "trip", slug: "lofoten" });
  assertEquals(await run({ ...trip, kind: "event" }), null);
  assertEquals(await run({ ...trip, price_minor: 100 }), null);
  assertEquals(await run({ ...trip, photos: [{ path: "https://evil.example/x.jpg", alt: null }] }), null);
  assertEquals(await run({ ...trip, days: Array.from({ length: 15 }, (_, i) => ({ day: i + 1, title: "d", summary: null })) }), null);
  assertEquals(await run(null), null);
  await assertRejects(() => answerOfferingDetail(rpcOf({}, [], { message: "boom" }), SITE, { kind: "trip", slug: "x" }));
});

Deno.test("#4453 M9 — the request names a kind and a feed slug only", () => {
  assertEquals(parseDetailRequest({ kind: "stay", slug: "0f0e5f1e-1111-4222-8333-444455556666" })?.kind, "stay");
  assertEquals(parseDetailRequest({ kind: "venue", slug: "x" }), null);
  assertEquals(parseDetailRequest({ kind: "trip", slug: "../etc" }), null);
  assertEquals(parseDetailRequest({ kind: "trip" }), null);
});

Deno.test("#4453 M9 — the flag reads off on any failure", async () => {
  assertEquals(await detailPagesEnabled(rpcOf({ brand_site_detail_pages_enabled: true })), true);
  assertEquals(await detailPagesEnabled(rpcOf({ brand_site_detail_pages_enabled: false })), false);
  assertEquals(await detailPagesEnabled(rpcOf({ brand_site_detail_pages_enabled: true }, [], { message: "x" })), false);
  assertEquals(await detailPagesEnabled(() => Promise.reject(new Error("down"))), false);
});
