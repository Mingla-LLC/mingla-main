/**
 * #426 G1 — Load: `pg_public_trip_by_slug` (native/origin path) + Host CDN bundle when set.
 *
 * Prefer LOAD_HOST_WEB_ORIGIN + /api/trip-checkout-bundle when exercising the
 * edge-cached web path; set LOAD_PUBLIC_READ_MODE=rpc to hit PostgREST directly
 * (native-shaped traffic).
 */

import { check, sleep } from "k6";
import { optionalEnv } from "./lib/supabase-edge.js";
import { vuScenario } from "./lib/scenario.js";
import {
  checkCacheable2xx,
  getHostJson,
  postgrestRpc,
  publicFixtures,
} from "./lib/public-read.js";
import { check2xx } from "./lib/supabase-edge.js";

export const options = {
  ...vuScenario("public-trip-read"),
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function publicTripRead() {
  const { brandSlug, tripSlug } = publicFixtures();
  const mode = optionalEnv("LOAD_PUBLIC_READ_MODE", "cdn");

  if (mode === "rpc") {
    const res = postgrestRpc(
      "pg_public_trip_by_slug",
      { p_brand_slug: brandSlug, p_event_slug: tripSlug },
      "pg_public_trip_by_slug",
    );
    check(res, check2xx("pg_public_trip_by_slug"));
  } else {
    const path =
      `/api/trip-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
      `&tripSlug=${encodeURIComponent(tripSlug)}`;
    const res = getHostJson(path, "trip-checkout-bundle");
    check(res, checkCacheable2xx("trip-checkout-bundle"));
  }
  sleep(0.2);
}
