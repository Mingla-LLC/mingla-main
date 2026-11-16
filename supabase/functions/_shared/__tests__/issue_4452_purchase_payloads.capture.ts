// #4452 T-4.2e helper (not a test): capture each sender's purchase request
// body. Run once against origin/main's _shared to write the golden fixture:
//   deno run --allow-read --allow-write --allow-env <this file> <path to _shared> <out.json>
// The labels test re-runs the same capture on the current senders and
// compares byte for byte.
export const PURCHASE_INPUT = {
  eventId: "order-4452-golden",
  eventName: "Purchase",
  valueCents: 2500,
  currency: "USD",
  contentId: "evt-4452",
  brandId: "brand-4452",
  eventSourceUrl: "https://usemingla.com/e/x/y",
  hashedEmail: "a".repeat(64),
  hashedPhone: "b".repeat(64),
  hashedPhoneE164: "c".repeat(64),
  fbc: "fb.1.1.GOLD",
  fbp: "fb.1.1.FBP",
  externalId: "d".repeat(64),
  ttp: "TTP-GOLD",
  scCookie1: "SC-GOLD",
  externalClickId: "CLICK-GOLD",
  clientIpAddress: "203.0.113.1",
  clientUserAgent: "UA/1.0",
  eventTimeMs: 1_763_000_000_000,
};

export async function capturePurchaseBodies(shared: string): Promise<Record<string, unknown>> {
  const bodies: Record<string, unknown> = {};
  const deps = (channel: string) => ({
    getToken: () => "token",
    fetchImpl: (_url: string | URL | Request, init?: RequestInit) => {
      bodies[channel] = JSON.parse(String(init?.body ?? "null"));
      return Promise.resolve(new Response('{"events_received":1,"code":0}', { status: 200 }));
    },
  });
  const conn = { pixelId: "PIXEL", tokenEnvVar: "TOKEN", lane: "consumer" };
  const meta = await import(`${shared}/metaCapi.ts`);
  const tiktok = await import(`${shared}/tiktokEvents.ts`);
  const snap = await import(`${shared}/snapCapi.ts`);
  const reddit = await import(`${shared}/redditCapi.ts`);
  await meta.sendMetaConversion({ ...PURCHASE_INPUT }, conn, deps("meta"));
  await tiktok.sendTikTokConversion({ ...PURCHASE_INPUT, eventName: "CompletePayment" }, conn, deps("tiktok"));
  await snap.sendSnapConversion({ ...PURCHASE_INPUT, eventName: "PURCHASE" }, conn, deps("snap"));
  bodies.reddit = reddit.buildRedditConversionBody({ ...PURCHASE_INPUT });
  return bodies;
}

if (import.meta.main) {
  const [shared, out] = Deno.args;
  const bodies = await capturePurchaseBodies(new URL(`file://${shared}`).href);
  await Deno.writeTextFile(out, JSON.stringify(bodies, null, 2) + "\n");
  console.log("wrote", out);
}
