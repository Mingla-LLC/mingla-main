/**
 * #426 — Load: ticket-checkout-status (buyer anon path).
 *
 * Uses a synthetic token; expects 4xx for unknown session — still exercises
 * the edge fn cold path without creating real checkouts.
 */

import { check, sleep } from "k6";
import { postJson } from "./lib/supabase-edge.js";

export const options = {
  scenarios: {
    checkout_status: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 3),
      duration: __ENV.LOAD_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function ticketCheckoutStatus() {
  const res = postJson("ticket-checkout-status", {
    buyerStatusToken: `load-test-${__VU}-${__ITER}`,
  });
  check(res, {
    "checkout-status responds (not 5xx)": (r) => r.status < 500,
  });
  sleep(0.5);
}
