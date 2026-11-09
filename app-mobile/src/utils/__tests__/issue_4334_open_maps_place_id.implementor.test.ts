// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4334 R3-1 — Explorer's LAST hop: the URL `openMapsTarget` actually hands to
// `Linking.openURL` carries the picked Google place id, and so does the chat
// plan's in-app map link.
//
// The real `openMapsTarget.ts` source runs with ONLY `react-native` swapped for a
// fake `Linking` / `Platform` (recording every URL opened); the builders are the
// real `packages/offering-rendering/mapsDeepLink.ts`, and the gate is the real
// `selectVenueMapsTarget`. The plan link runs the real `planModel.placeLinkTarget`
// with the real `inAppLink.mapsWebUrl`.
//
//   X-1 web (nothing asked): opened URL = `query=<lat>,<lng>&query_place_id=<id>`
//   X-2 iOS, Google chosen in the chooser: the opened https URL carries the id;
//       Apple chosen: Apple's link, no Google id
//   X-3 Android (nothing asked): `geo:` intent unchanged; when it fails, the
//       https fallback that opens carries the id
//   X-4 hidden address: no target, nothing opens
//   X-5 a row with no id opens the old coordinate link byte for byte
//   X-6 chat plan: a Google-sourced place opens the map with its id
//
// FAILS-ON-REVERT: drop `googlePlaceId` from either builder call in
// src/utils/openMapsTarget.ts (X-1/X-2/X-3), or from `placeLinkTarget` /
// `mapsWebUrl` (X-6).

const ID = "ChIJS9Q72lL0OxARKJ3cGrQfM0c";
const PIN = { lat: 6.4478093, lng: 3.4723495 };
const MAPS = new URL("../../../../packages/offering-rendering/mapsDeepLink.ts", import.meta.url).href;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}
const toModule = (source: string) =>
  import(`data:application/typescript;base64,${btoa(unescape(encodeURIComponent(source)))}`);

// The fake react-native: every openURL is recorded; `rejectNext` makes the next
// one fail (no maps app installed).
const rn = { opened: [] as string[], os: "web", rejectNext: 0 };
(globalThis as Record<string, unknown>).__rn4334 = rn;
const FAKE_RN = `
const rn = globalThis.__rn4334;
export const Platform = { get OS() { return rn.os; } };
export const Linking = {
  openURL(url) { rn.opened.push(url); if (rn.rejectNext > 0) { rn.rejectNext -= 1; return Promise.reject(new Error("no app")); } return Promise.resolve(true); },
  canOpenURL() { return Promise.resolve(true); },
};`;

async function loadOpener() {
  let source = await Deno.readTextFile(new URL("../openMapsTarget.ts", import.meta.url));
  source = source
    .replace(`"react-native"`, JSON.stringify(`data:application/javascript;base64,${btoa(FAKE_RN)}`))
    .replace(`"@mingla/offering-rendering"`, JSON.stringify(MAPS));
  assert(!/from "\.\.?\//.test(source), "every relative import was pointed at a real file");
  return await toModule(source);
}
async function loadPlanLink() {
  let link = await Deno.readTextFile(new URL("../inAppLink.ts", import.meta.url));
  link = link
    .replace(`"@mingla/offering-rendering"`, JSON.stringify(MAPS))
    .replace(`"./normalizeWebsiteUrl"`, JSON.stringify(new URL("../normalizeWebsiteUrl.ts", import.meta.url).href));
  const plan = await Deno.readTextFile(new URL("../../components/chat/planModel.ts", import.meta.url));
  return { link: await toModule(link), plan: await toModule(plan) };
}

const { openMapsTarget } = await loadOpener();
const { selectVenueMapsTarget } = await import(MAPS);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const target = (patch = {}) =>
  selectVenueMapsTarget({
    venueName: "Didi Museum",
    address: "175 Akin Adesola St",
    addressHidden: false,
    locationGeo: PIN,
    googlePlaceId: ID,
    ...patch,
  });
const reset = (os: string) => {
  rn.opened.length = 0;
  rn.os = os;
  rn.rejectNext = 0;
};

Deno.test("X-1 web, nothing asked: the opened URL is the coordinate plus the place id", async () => {
  reset("web");
  openMapsTarget(target());
  await flush();
  assertEquals(rn.opened, [`https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495&query_place_id=${ID}`], "web link");
});

Deno.test("X-2 iOS: Google chosen opens the https link with the id; Apple chosen carries no Google id", async () => {
  reset("ios");
  openMapsTarget(target(), { app: "google" });
  await flush();
  assertEquals(rn.opened, [`https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495&query_place_id=${ID}`], "iOS Google link");
  reset("ios");
  openMapsTarget(target(), { app: "apple" });
  await flush();
  assert(rn.opened.length === 1 && rn.opened[0].startsWith("maps://?ll=6.4478093,3.4723495"), `Apple link: ${rn.opened[0]}`);
  assert(!rn.opened[0].includes(ID), "Apple link holds no Google id");
});

Deno.test("X-3 Android: geo: intent unchanged; its https fallback carries the id", async () => {
  reset("android");
  rn.rejectNext = 1;
  openMapsTarget(target());
  await flush();
  await flush();
  assertEquals(rn.opened[0], "geo:6.4478093,3.4723495?q=6.4478093,3.4723495(Didi%20Museum%2C%20175%20Akin%20Adesola%20St)", "geo intent");
  assert(rn.opened[1]?.includes(`query_place_id=${ID}`), `fallback: ${rn.opened[1]}`);
});

Deno.test("X-4 hidden address: no target and nothing opens", async () => {
  reset("web");
  const hidden = target({ addressHidden: true });
  assert(hidden === null, "a hidden address yields no target");
  let unavailable = 0;
  openMapsTarget(hidden, { onUnavailable: () => { unavailable += 1; } });
  await flush();
  assertEquals(rn.opened, [], "nothing opened");
  assertEquals(unavailable, 1, "onUnavailable fired once");
});

Deno.test("X-5 a row with no Google id opens the old coordinate link byte for byte", async () => {
  reset("web");
  openMapsTarget(target({ googlePlaceId: null }));
  await flush();
  assertEquals(rn.opened, ["https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495"], "old link");
});

Deno.test("X-6 chat plan: a Google-sourced place opens the map with its id", async () => {
  const { link, plan } = await loadPlanLink();
  const place = { poolId: null, name: "Didi Museum", address: null, lat: PIN.lat, lng: PIN.lng, link: null };
  const withId = plan.placeLinkTarget({ ...place, providerPlaceId: ID }, link.mapsWebUrl);
  assertEquals(withId, { kind: "maps", url: `https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495&query_place_id=${ID}` }, "plan link with id");
  const without = plan.placeLinkTarget({ ...place, providerPlaceId: null }, link.mapsWebUrl);
  assertEquals(without, { kind: "maps", url: "https://www.google.com/maps/search/?api=1&query=6.4478093,3.4723495" }, "plan link without id");
});
