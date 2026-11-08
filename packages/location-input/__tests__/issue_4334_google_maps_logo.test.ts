// #4334 — Google Maps attribution follows Google's rules on every list of
// Google place results: the shared address field (Explorer + Host, native and
// web) and the website growth-tool pickers. (The render proof that the shared
// field actually draws the logo is mingla-business
// src/components/location/__tests__/issue_4334_host_address_google.implementor.test.tsx F-3.)
//
// L-1 the files are Google's own, unmodified (sha256 pinned to the approved
//     Google_Maps_Attribution_Assets.zip), only the variants in use.
// L-2 drawn at 98×18 (native aspect, 16–19 height rule) with 10/10/10/5 clear
//     space, labelled "Google Maps"; DarkGray on light, White on dark.
// L-3 the old text stand-in and its TRANSITIONAL marker are gone.
// L-4 every website picker that lists Google results draws the White logo.
//
// Fails-on-revert: swap a file, change the size or padding, restore the text
// row, or drop <GoogleMapsAttribution /> from a picker → red.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));
async function sha256(rel: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(rel, ROOT));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function pngSize(rel: string): Promise<[number, number]> {
  const b = await Deno.readFile(new URL(rel, ROOT));
  const v = new DataView(b.buffer);
  return [v.getUint32(16), v.getUint32(20)];
}

const GOOGLE_FILES: Record<string, string> = {
  "packages/location-input/assets/google-maps-logo-dark-gray.png": "2096067a07a7fd7a6116a11544c7d9f311cb8c0f5e3b80ace4bcb96185b97d6a",
  "packages/location-input/assets/google-maps-logo-dark-gray@2x.png": "f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c",
  "packages/location-input/assets/google-maps-logo-dark-gray@3x.png": "cdf2643b8f5b616793e770aedfd093ab62078af16274e02e5307d762cb0577ec",
  "packages/location-input/assets/google-maps-logo-white.png": "d8fd47d6ec22f888049fdb57bea1157455dc2a331b06bcfe78a05c76ee103a23",
  "packages/location-input/assets/google-maps-logo-white@2x.png": "396eb4957abfd62a693e26e0311dad6c1f75a70d29041b9108f0096088825977",
  "packages/location-input/assets/google-maps-logo-white@3x.png": "4f78f55a6caf0abd8bb68c68dd89cb506c8651af160ec36798b4c5ab97a9230d",
  "mingla-marketing/public/brand/google-maps-logo-white.png": "d8fd47d6ec22f888049fdb57bea1157455dc2a331b06bcfe78a05c76ee103a23",
  "mingla-marketing/public/brand/google-maps-logo-white@2x.png": "396eb4957abfd62a693e26e0311dad6c1f75a70d29041b9108f0096088825977",
  "mingla-marketing/public/brand/google-maps-logo-white@4x.png": "4f78f55a6caf0abd8bb68c68dd89cb506c8651af160ec36798b4c5ab97a9230d",
};

Deno.test("L-1 the logo files are Google's own, byte for byte, at Google's aspect ratio", async () => {
  for (const [rel, want] of Object.entries(GOOGLE_FILES)) {
    assertEquals(await sha256(rel), want, `${rel} was modified`);
    const [w, h] = await pngSize(rel);
    assertEquals(w * 18, h * 98, `${rel} aspect ratio`);
  }
  const shipped = [...Deno.readDirSync(new URL("packages/location-input/assets/", ROOT))].map((e) => e.name).sort();
  assertEquals(shipped, Object.keys(GOOGLE_FILES).filter((k) => k.startsWith("packages/")).map((k) => k.split("/").pop()!).sort());
});

Deno.test("L-2 the shared field draws the logo at 98×18 with Google's clear space, labelled Google Maps", async () => {
  const src = await read("packages/location-input/src/AddressInput.tsx");
  assert(src.includes('light: require("../assets/google-maps-logo-dark-gray.png")'));
  assert(src.includes('dark: require("../assets/google-maps-logo-white.png")'));
  assert(src.includes("GOOGLE_MAPS_LOGO_SIZE = { width: 98, height: 18 }"));
  assert(/attributionRow: \{\s*paddingTop: 10,\s*paddingBottom: 5,\s*paddingHorizontal: 10,/.test(src));
  assert(src.includes('accessibilityLabel="Google Maps"'));
  assert(src.includes("source={GOOGLE_MAPS_LOGO[variant]}"));
  // both hosts choose the variant that contrasts with their surface
  const host = await read("mingla-business/src/components/location/AddressInput.tsx");
  assert(host.includes('attribution: { variant: "dark" }'), "Host sheets are dark → White logo");
  const explorer = await read("app-mobile/src/components/location/AddressInput.tsx");
  assert(explorer.includes('attribution: { variant: "light" }') && explorer.includes('attribution: { variant: "dark" }'));
});

Deno.test("L-3 the text stand-in and its TRANSITIONAL marker are gone", async () => {
  const src = await read("packages/location-input/src/AddressInput.tsx");
  assertEquals(src.includes(">\n        Powered by Google\n"), false);
  assertEquals(/\[TRANSITIONAL\][^\n]*attribution/i.test(src), false);
  assertEquals(src.includes("Powered by Google</Text>"), false);
});

Deno.test("L-4 every website picker of Google results draws the White logo", async () => {
  const comp = await read("mingla-marketing/components/ui/google-maps-attribution.tsx");
  assert(comp.includes('src="/brand/google-maps-logo-white.png"'));
  assert(comp.includes("width={98}") && comp.includes("height={18}") && comp.includes('alt="Google Maps"'));
  assert(comp.includes("px-[10px] pt-[10px] pb-[5px]"));
  for (const page of [
    "mingla-marketing/app/tools/events/EventPredictorExperience.tsx",
    "mingla-marketing/app/tools/pricing/PricingAuditExperience.tsx",
    "mingla-marketing/app/tools/trips/TripQuoterExperience.tsx",
  ]) {
    const src = await read(page);
    assert(src.includes("<GoogleMapsAttribution />"), `${page} lists Google results without the logo`);
  }
});
