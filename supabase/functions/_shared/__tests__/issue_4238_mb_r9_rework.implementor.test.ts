// MINGLA-INVARIANT: I-4238-ESTIMATE-RATE-DURABLE | issue #4238 | Host reach estimates are limited per brand and per user in the database (ad_host_estimate_rate_hit), never only in edge memory, and a limiter that cannot answer refuses the estimate.
/**
 * #4238 media-buyer, rework after tester round 8 (implementor), Deno side:
 *
 *   C1  P2-5: each of the Host's four buttons reaches TikTok as its real
 *       CallToAction enum code in the ad body (GET_TICKETS_NOW, BOOK_NOW,
 *       SIGN_UP, LEARN_MORE); the old display labels from Admin and saved
 *       drafts map to the same codes; an unknown button is refused.
 *   G1  P2-4: a failed geocode is "failed", not "not found", and is not
 *       cached; a real no-result is "not_found".
 *   G2  P2-4: the compiler says "Couldn't check … Try again." for a failed
 *       lookup and keeps "couldn't find" only for a real miss.
 *   L1  P2-3: the reach-estimate limit is asked of the database per brand
 *       and per user, refuses over the limit, and fails closed.
 */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdApiError } from "../adChannel.ts";
import { TIKTOK_CTA_MAP, tiktokCallToActionCode } from "../adChannelCore.ts";
import { HOST_AD_CTAS, hostCtaForPlatform } from "../adHostCreative.ts";
import { buildTikTokAdBody } from "../tiktok.ts";
import {
  __clearForwardGeocodeCacheForTests,
  forwardGeocodeLookup,
} from "../mapboxGeocode.ts";
import { compileProviderTargeting } from "../adTargetingCompiler.ts";
import { checkHostEstimateRate } from "../adHostEstimateRate.ts";

const spec = (callToAction?: string) =>
  ({
    adName: "issue4238 r9 ad",
    identityType: "TT_USER",
    identityId: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
    adFormat: "SINGLE_IMAGE",
    imageIds: ["img-1"],
    adText: "Sunday rooftop",
    landingPageUrl: "https://host.usemingla.com/e/brand/event",
    callToAction,
    // deno-lint-ignore no-explicit-any
  }) as any;
const ctaOf = (body: Record<string, unknown>) =>
  (body.creatives as Record<string, unknown>[])[0].call_to_action;

Deno.test("C1 each Host button reaches TikTok as its enum code", () => {
  const expected: Record<string, string> = {
    tickets: "GET_TICKETS_NOW",
    book: "BOOK_NOW",
    signup: "SIGN_UP",
    learn: "LEARN_MORE",
  };
  for (const cta of HOST_AD_CTAS) {
    const value = hostCtaForPlatform("tiktok", cta);
    assertEquals(value, expected[cta], cta);
    const body = buildTikTokAdBody("7627974536397766673", "1234567890123456789", spec(value!));
    assertEquals(ctaOf(body), expected[cta], `${cta} in the ad body`);
  }
  assertEquals(ctaOf(buildTikTokAdBody("7627974536397766673", "1234567890123456789", spec())), "LEARN_MORE");
  for (const value of Object.values(TIKTOK_CTA_MAP)) assert(/^[A-Z_]+$/.test(value), value);
});

Deno.test("C1 older display labels map to the same codes; unknown buttons are refused", () => {
  assertEquals(tiktokCallToActionCode("Get ticket now"), "GET_TICKETS_NOW");
  assertEquals(tiktokCallToActionCode("Get tickets now"), "GET_TICKETS_NOW");
  assertEquals(tiktokCallToActionCode("Book now"), "BOOK_NOW");
  assertEquals(tiktokCallToActionCode("Sign up"), "SIGN_UP");
  assertEquals(tiktokCallToActionCode("Learn more"), "LEARN_MORE");
  assertEquals(tiktokCallToActionCode("Get showtimes"), "GET_SHOWTIMES");
  assertEquals(tiktokCallToActionCode("Dance now"), null);
  const body = buildTikTokAdBody("7627974536397766673", "1234567890123456789", spec("Get ticket now"));
  assertEquals(ctaOf(body), "GET_TICKETS_NOW");
  const error = assertThrows(
    () => buildTikTokAdBody("7627974536397766673", "1234567890123456789", spec("Dance now")),
    AdApiError,
  );
  assertEquals((error as AdApiError).code, "call_to_action_invalid");
});

Deno.test("G1 a failed geocode is 'failed', not cached; a real miss is 'not_found'", async () => {
  const realFetch = globalThis.fetch;
  const realToken = Deno.env.get("MAPBOX_ACCESS_TOKEN");
  Deno.env.set("MAPBOX_ACCESS_TOKEN", "pk.test-not-real");
  let calls = 0;
  let mode: "error" | "empty" = "error";
  globalThis.fetch = ((_input: unknown) => {
    calls += 1;
    return Promise.resolve(
      mode === "error"
        ? new Response("upstream", { status: 503 })
        : new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    __clearForwardGeocodeCacheForTests();
    assertEquals(await forwardGeocodeLookup("Lagos, NG"), { status: "failed" });
    mode = "empty";
    assertEquals(await forwardGeocodeLookup("Lagos, NG"), { status: "not_found" });
    assertEquals(calls, 2, "the failure was not cached");
    assertEquals(await forwardGeocodeLookup("Lagos, NG"), { status: "not_found" });
    assertEquals(calls, 2, "the real miss was cached");
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) Deno.env.delete("MAPBOX_ACCESS_TOKEN");
    else Deno.env.set("MAPBOX_ACCESS_TOKEN", realToken);
    __clearForwardGeocodeCacheForTests();
  }
});

Deno.test("G2 a failed lookup says Couldn't check; a real miss keeps couldn't find", () => {
  const intent = {
    countries: ["NG"],
    cities: [
      { name: "Lagos", countryCode: "NG" },
      { name: "Landmark Beach, Oniru, Lekki", countryCode: "NG", kind: "pin", radiusKm: 17 },
    ],
  };
  const failed = {
    locationCoordinates: { "NG:lagos": null, "pin:NG:landmark beach, oniru, lekki": null },
    locationCoordinateFailures: ["NG:lagos", "pin:NG:landmark beach, oniru, lekki"],
  };
  // deno-lint-ignore no-explicit-any
  const snap = compileProviderTargeting("snapchat", intent as any, failed);
  assert(
    snap.checksRequired.includes("Couldn't check Lagos and Landmark Beach, Oniru, Lekki on Snapchat. Try again."),
    JSON.stringify(snap.checksRequired),
  );
  assert(!snap.checksRequired.some((line) => /couldn't find|^Resolve/i.test(line)));
  // deno-lint-ignore no-explicit-any
  const meta = compileProviderTargeting("meta", intent as any, { ...failed, locationIds: { "NG:lagos": "123" } });
  assert(
    meta.checksRequired.includes("Couldn't check Landmark Beach, Oniru, Lekki on Facebook & Instagram. Try again."),
    JSON.stringify(meta.checksRequired),
  );
  // A real miss (no failure recorded) still reads as not found.
  const missing = { locationCoordinates: { "NG:lagos": null, "pin:NG:landmark beach, oniru, lekki": null } };
  // deno-lint-ignore no-explicit-any
  const metaMissing = compileProviderTargeting("meta", intent as any, { ...missing, locationIds: { "NG:lagos": "123" } });
  assert(metaMissing.checksRequired.includes("We couldn't find the address for your pin."));
  // deno-lint-ignore no-explicit-any
  const snapMissing = compileProviderTargeting("snapchat", intent as any, missing);
  assert(snapMissing.checksRequired.some((line) => line.startsWith("Resolve Snapchat coordinates for:")));
});

Deno.test("L1 reach estimates are limited in the database per brand and per user", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const db = (answers: Array<{ data: unknown; error: { message: string } | null }>) => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "ad_host_estimate_rate_hit");
      seen.push(args);
      return Promise.resolve(answers.shift() ?? { data: false, error: null });
    },
  });
  assertEquals(await checkHostEstimateRate(db([]), "b1", "u1"), { allowed: true });
  assertEquals(seen.map((args) => args.p_bucket_key), ["host_estimate:brand:b1", "host_estimate:user:u1"]);
  const brandOver = await checkHostEstimateRate(db([{ data: true, error: null }]), "b1", "u1");
  assertEquals(brandOver.allowed ? null : [brandOver.status, brandOver.error], [429, "rate_limited"]);
  const userOver = await checkHostEstimateRate(db([{ data: false, error: null }, { data: true, error: null }]), "b1", "u1");
  assertEquals(userOver.allowed ? null : userOver.status, 429);
  const down = await checkHostEstimateRate(db([{ data: null, error: { message: "timeout" } }]), "b1", "u1");
  assertEquals(down.allowed ? null : [down.status, down.error], [503, "estimate_unavailable"]);
  // ad-plan asks the database, not edge memory.
  const source = await Deno.readTextFile(new URL("../../ad-plan/index.ts", import.meta.url));
  assert(source.includes("checkHostEstimateRate(db, brandId, actor.id)"));
  assert(!source.includes("HOST_ESTIMATE_LAST_CALL"));
});

import { matchPlace } from "../adTargetingMatch.ts";

Deno.test("M1 a city returned for a region is never offered as a wider area", () => {
  const city = { id: "c1", name: "Ikeja", meta: { type: "city" } };
  const state = { id: "s1", name: "Lagos", meta: { type: "region" } };
  assertEquals(matchPlace("Lagos State", "region", [city]), { state: "none" });
  assertEquals(matchPlace("Lagos State", "region", [city, state]).state, "match");
  // A city the app only knows as a state still offers the state.
  assertEquals(matchPlace("Lagos", "city", [state]), { state: "wider", wider: state });
});
