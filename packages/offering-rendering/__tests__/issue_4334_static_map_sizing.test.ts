// #4334 F-1 — Google's logo (bottom-left) and "Map data ©Google" (bottom-right)
// must survive on every static map at every phone width.
//
// S-1 the request is re-sized to the measured box: the requested aspect equals
//     the box aspect, and the proxy's Google request (fitGoogleSize, scale 2)
//     keeps it — so `cover` crops nothing at 320 / 375 / 430 pt and on desktop.
// S-2 the old request (600 wide, fixed height) DID crop the corners — the
//     check is not vacuous.
// S-3 every static-map caller renders through StaticMapImage (no raw
//     cover <Image> of a map URL), and no overlay sits in a bottom corner.
//
// Fails-on-revert: render a caller's map as a plain <Image resizeMode="cover">,
// drop the w/h rewrite in staticMapUriForBox, or put a pill back at bottom: 12.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coverCropFraction, staticMapUriForBox } from "../staticMapSizing.ts";
import { fitGoogleSize } from "../../../supabase/functions/static-map/index.ts";

const URI = "https://x.supabase.co/functions/v1/static-map?lat=6.43&lng=3.42&accent=eb7825&zoom=14&h=180";
const PHONES = [320, 375, 430];
// Box widths as laid out: full phone width minus the page gutters (16–24 pt),
// plus a desktop column, against every box height a caller uses.
const GUTTERS = [0, 32, 40, 48];
const HEIGHTS = [160, 180, 220, 300];

function requested(uri: string): { w: number; h: number } {
  const q = new URL(uri).searchParams;
  return { w: Number(q.get("w")), h: Number(q.get("h")) };
}

Deno.test("S-1 the requested image has the box's aspect, so cover crops neither bottom corner", () => {
  const boxes: Array<[number, number]> = [];
  for (const phone of PHONES) for (const g of GUTTERS) for (const h of HEIGHTS) boxes.push([phone - g, h]);
  boxes.push([1120, 300], [720, 300]);
  for (const [bw, bh] of boxes) {
    const uri = staticMapUriForBox(URI, bw, bh)!;
    const { w, h } = requested(uri);
    assert(Math.abs(w / h - bw / bh) / (bw / bh) < 0.02, `request ${w}x${h} vs box ${bw}x${bh}`);
    const g = fitGoogleSize(w, h); // what the proxy asks Google for (scale 2)
    assert(Math.abs(g.w / g.h - bw / bh) / (bw / bh) < 0.02, `google ${g.w}x${g.h} vs box ${bw}x${bh}`);
    const crop = coverCropFraction(g.w, g.h, bw, bh);
    assert(crop.x < 0.02 && crop.y < 0.02, `cover crops ${JSON.stringify(crop)} at ${bw}x${bh}`);
  }
  // the other query params are kept byte for byte
  const kept = new URL(staticMapUriForBox(URI, 343, 180)!).searchParams;
  assertEquals([kept.get("lat"), kept.get("lng"), kept.get("accent"), kept.get("zoom")], ["6.43", "3.42", "eb7825", "14"]);
  assertEquals(staticMapUriForBox(URI, 0, 180), null);
});

Deno.test("S-2 the old fixed 600-wide request cropped the corners (the check is real)", () => {
  for (const phone of PHONES) {
    const g = fitGoogleSize(600, 180);
    assert(coverCropFraction(g.w, g.h, phone - 32, 180).x > 0.1, `${phone}`);
  }
});

const CALLERS = [
  "packages/offering-rendering/EventOfferingBody.tsx",
  "packages/offering-rendering/RsvpOfferingBody.tsx",
  "packages/offering-rendering/TripOfferingBody.tsx",
  "packages/offering-rendering/ExperienceOfferingBody.tsx",
  "packages/offering-rendering/PublicEventPage.tsx",
  "packages/brand-rendering/PublicVenueScreen.tsx",
  "mingla-business/src/components/location/AddressMapPreview.tsx",
];
const ROOT = new URL("../../../", import.meta.url);

Deno.test("S-3 every static-map caller renders through StaticMapImage; no overlay in a bottom corner", async () => {
  for (const rel of CALLERS) {
    const src = await Deno.readTextFile(new URL(rel, ROOT));
    assert(src.includes("<StaticMapImage"), `${rel} does not use StaticMapImage`);
    // no map URL fed straight to a cover <Image>
    assertEquals(/<Image\s+source=\{\{\s*uri:\s*(mapUrl|staticMapUrl)\s*\}\}/.test(src), false, `${rel} renders a raw map Image`);
    // overlays on the map: none anchored to the bottom
    for (const name of ["mapCapPill", "whereMapPill", "mapPill", "approxBadge"]) {
      const m = new RegExp(`\\b${name}: \\{([^}]*)\\}`).exec(src);
      if (m) assertEquals(/\bbottom:/.test(m[1]), false, `${rel} ${name} sits on a bottom corner`);
    }
  }
  // F-10: the Host preview draws one pin (Google's marker), not its own as well.
  const preview = await Deno.readTextFile(new URL("mingla-business/src/components/location/AddressMapPreview.tsx", ROOT));
  assertEquals(preview.includes("styles.mapPin"), false);
});
