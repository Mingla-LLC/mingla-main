/**
 * #426 — Load: ticket-checkout-status (buyer anon path).
 *
 * Uses a synthetic token; expects 4xx for unknown session — still exercises
 * the edge fn cold path without creating real checkouts.
 */

import { check, sleep } from "k6";
import { postJson } from "./lib/supabase-edge.js";
import { vuScenario } from "./lib/scenario.js";

export const options = {
  ...vuScenario("checkout_status"),
  thresholds: {
    // Synthetic tokens return 4xx — k6 counts those as http_req_failed; use checks for 5xx gate.
    checks: ["rate>0.995"],
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
