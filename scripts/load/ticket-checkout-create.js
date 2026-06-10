/**
 * #426 PR3 — Load: ticket-checkout-create (buyer anon path).
 *
 * Default: synthetic event/ticket IDs → 422 event_no_active_dates (exercises DB).
 * With LOAD_TEST_EVENT_ID + LOAD_TEST_TICKET_TYPE_ID: may return 2xx preview.
 *
 * Run:
 *   LOAD_BASE_URL=... SUPABASE_ANON_KEY=... k6 run scripts/load/ticket-checkout-create.js
 */

import { check, sleep } from "k6";
import { optionalEnv, postJson, checkNot5xx } from "./lib/supabase-edge.js";

const DEFAULT_EVENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_TICKET_TYPE_ID = "00000000-0000-4000-8000-000000000002";

export const options = {
  scenarios: {
    checkout_create: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 3),
      duration: __ENV.LOAD_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2500"],
  },
};

export default function ticketCheckoutCreate() {
  const eventId = optionalEnv("LOAD_TEST_EVENT_ID", DEFAULT_EVENT_ID);
  const ticketTypeId = optionalEnv("LOAD_TEST_TICKET_TYPE_ID", DEFAULT_TICKET_TYPE_ID);

  const res = postJson("ticket-checkout-create", {
    eventId,
    surface: "web",
    mode: "preview",
    buyer: {
      name: "Load Test",
      email: `loadtest+${__VU}-${__ITER}@example.com`,
      phone: "+12025550100",
      marketingOptIn: false,
    },
    lines: [{ ticketTypeId, quantity: 1 }],
  });

  check(res, checkNot5xx("checkout-create"));
  sleep(0.5);
}
