/**
 * #426 — Load: discover-merged-events (anon, business-event discover path).
 */

import { check, sleep } from "k6";
import { postJson, check2xx } from "./lib/supabase-edge.js";

export const options = {
  scenarios: {
    discover: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 5),
      duration: __ENV.LOAD_DURATION || "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

const BODY = {
  city: {
    name: "Austin",
    stateCode: "TX",
    countryCode: "US",
    fallbackLat: 30.2672,
    fallbackLng: -97.7431,
    fallbackRadiusKm: 50,
  },
  page: 0,
  size: 20,
};

export default function discoverMergedEvents() {
  const res = postJson("discover-merged-events", BODY);
  check(res, check2xx("discover-merged-events"));
  sleep(0.3);
}
