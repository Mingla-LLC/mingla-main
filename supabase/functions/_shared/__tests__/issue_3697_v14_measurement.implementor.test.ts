import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAdMeasurementManifest } from "../adMeasurement.ts";

Deno.test("v1.4 measurement: ticket results prefer trusted finalization over clicks", () => {
  const manifest = buildAdMeasurementManifest({ result_kind: "tickets" });
  assertEquals(manifest.result_hierarchy, [
    "ticket_purchase",
    "checkout_started",
    "landing_page_view",
    "click",
  ]);
  assertEquals(manifest.quality, "trusted");
  assertEquals(manifest.capture_authority, "mingla_server_finalization");
});

Deno.test("v1.4 measurement: installs and clicks are not presented as trusted Mingla sales", () => {
  assertEquals(
    buildAdMeasurementManifest({ result_kind: "installs" }).quality,
    "provider_reported",
  );
  assertEquals(
    buildAdMeasurementManifest({ result_kind: "unknown" }).quality,
    "directional",
  );
});

Deno.test("v1.4 measurement: privacy and consent contract is explicit", () => {
  const manifest = buildAdMeasurementManifest({ result_kind: "signups" });
  assertEquals(manifest.consent.browser_pixels, "granted_only");
  assertEquals(
    manifest.consent.platform_conversion_sharing,
    "granted_only",
  );
  assertFalse(manifest.privacy.pii_in_plan);
  assertFalse(manifest.privacy.cross_currency_value_sum);
});
