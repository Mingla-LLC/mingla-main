import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

test("issue #1431 native attribution is first-touch, 28-day, bounded, no-PII, and logout-cleared", () => {
  const helper = fs.readFileSync(path.join(root, "src/services/nativeAdAttributionService.ts"), "utf8");
  const cleanup = fs.readFileSync(path.join(root, "src/utils/authCleanup.ts"), "utf8");
  // [TEST-MOD-APPROVED #1560] — `src/screens/ConsumerPublicVenueScreen.tsx`
  // was DELETED (the consumer venue page is now an adapter over the shared
  // `PublicVenueScreen`). The attribution capture moved with it, to the route.
  // Same contract, asserted where it now lives.
  const screen = fs.readFileSync(path.join(root, "app/b/[brandSlug]/v/[venueSlug].tsx"), "utf8");
  assert.match(helper, /28 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(helper, /CAPTURE_TIMEOUT_MS = 2500/);
  assert.match(helper, /if \(await readStored\(\)\) return/);
  assert.doesNotMatch(helper, /guest_snapshot|email:|phone:/);
  assert.match(cleanup, /clearNativeAdAttribution\(\)/);
  assert.match(screen, /captureNativeStayRouteAttribution/);
});
