// #4276: seeding and photo downloads spend GOOGLE_SEEDING_API_KEY when it is set,
// and fall back to GOOGLE_MAPS_API_KEY when it is not.
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seedingGoogleApiKey } from "../../_shared/seedingGoogleKey.ts";


Deno.test("the seeding key wins when it is set", () => {
  assertEquals(seedingGoogleApiKey({ seeding: "seed", maps: "maps" }), "seed");
});

Deno.test("with no seeding key, the shared maps key is used", () => {
  assertEquals(seedingGoogleApiKey({ maps: "maps" }), "maps");
});

Deno.test("a blank seeding key falls back instead of sending an empty key", () => {
  assertEquals(seedingGoogleApiKey({ seeding: "  ", maps: "maps" }), "maps");
});

Deno.test("no key at all returns empty, so callers can refuse", () => {
  assertEquals(seedingGoogleApiKey({}), "");
});

Deno.test("by default the helper reads exactly the two named secrets", async () => {
  const src = await Deno.readTextFile(new URL("../../_shared/seedingGoogleKey.ts", import.meta.url));
  assertMatch(src, /Deno\.env\.get\("GOOGLE_SEEDING_API_KEY"\)/);
  assertMatch(src, /Deno\.env\.get\("GOOGLE_MAPS_API_KEY"\)/);
});

Deno.test("seeding and photo downloads read the seeding key, not the maps key directly", async () => {
  for (const path of ["../index.ts", "../../backfill-place-photos/index.ts"]) {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    assertMatch(src, /seedingGoogleApiKey\(\)/, `${path} must use seedingGoogleApiKey()`);
    assertEquals(/Deno\.env\.get\(["']GOOGLE_MAPS_API_KEY["']\)/.test(src), false, `${path} reads GOOGLE_MAPS_API_KEY directly`);
  }
});
