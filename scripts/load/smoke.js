/**
 * #426 — Combined load smoke (critical business-adjacent paths).
 *
 * Run:
 *   LOAD_BASE_URL=https://<ref>.supabase.co/functions/v1 \
 *   SUPABASE_ANON_KEY=<anon> \
 *   k6 run scripts/load/smoke.js
 */

import { check, sleep } from "k6";
import {
  optionalEnv,
  postJson,
  postJsonAuthed,
  check2xx,
  checkNot5xx,
} from "./lib/supabase-edge.js";

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
  check(status, checkNot5xx("checkout-status"));

  const checkoutCreate = postJson("ticket-checkout-create", {
    eventId: optionalEnv(
      "LOAD_TEST_EVENT_ID",
      "00000000-0000-4000-8000-000000000001",
    ),
    surface: "web",
    mode: "preview",
    buyer: {
      name: "Smoke Test",
      email: `smoke-${__VU}-${Date.now()}@example.com`,
      phone: "+12025550100",
    },
    lines: [
      {
        ticketTypeId: optionalEnv(
          "LOAD_TEST_TICKET_TYPE_ID",
          "00000000-0000-4000-8000-000000000002",
        ),
        quantity: 1,
      },
    ],
  });
  check(checkoutCreate, checkNot5xx("checkout-create"));

  const jwt = optionalEnv("LOAD_TEST_USER_JWT");
  const agentBody = {
    conversation_id: null,
    message: "smoke ping",
  };
  const agent = jwt
    ? postJsonAuthed("agent-chat", agentBody, jwt)
    : postJson("agent-chat", agentBody);
  if (jwt) {
    check(agent, checkNot5xx("agent-chat"));
  } else {
    check(agent, { "agent-chat auth gate": (r) => r.status === 401 });
  }

  const marketingBody = {
    campaign_id: optionalEnv(
      "LOAD_TEST_CAMPAIGN_ID",
      "00000000-0000-4000-8000-000000000099",
    ),
  };
  const marketing = jwt
    ? postJsonAuthed("marketing-send", marketingBody, jwt)
    : postJson("marketing-send", marketingBody);
  if (jwt) {
    check(marketing, checkNot5xx("marketing-send"));
  } else {
    check(marketing, { "marketing-send auth gate": (r) => r.status === 403 });
  }

  sleep(0.5);
}
