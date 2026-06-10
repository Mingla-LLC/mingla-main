/**
 * #426 — Combined load smoke (critical business-adjacent paths).
 *
 * Run:
 *   LOAD_BASE_URL=https://<ref>.supabase.co/functions/v1 \
 *   SUPABASE_ANON_KEY=<anon> \
 *   k6 run scripts/load/smoke.js
 */

import { check, sleep } from "k6";
import { postJson, check2xx } from "./lib/supabase-edge.js";

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 2),
      duration: __ENV.LOAD_DURATION || "15s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.10"],
    http_req_duration: ["p(95)<3000"],
  },
};

export default function smoke() {
  const discover = postJson("discover-merged-events", {
    city: {
      name: "London",
      countryCode: "GB",
      fallbackLat: 51.5074,
      fallbackLng: -0.1278,
      fallbackRadiusKm: 40,
    },
    page: 0,
    size: 10,
  });
  check(discover, check2xx("discover"));

  const status = postJson("ticket-checkout-status", {
    buyerStatusToken: `smoke-${__VU}-${Date.now()}`,
  });
  check(status, {
    "checkout-status not 5xx": (r) => r.status < 500,
  });

  sleep(0.5);
}
