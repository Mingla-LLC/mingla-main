/**
 * #426 PR3 — Load: agent-chat (JWT required for full path).
 *
 * Without LOAD_TEST_USER_JWT: exercises auth gate (expects 401).
 * With JWT: full Ari turn — may return 2xx, 429 (rate limit), or 504 (timeout).
 *
 * Run:
 *   LOAD_BASE_URL=... SUPABASE_ANON_KEY=... \
 *   LOAD_TEST_USER_JWT=<access_token> \
 *   k6 run scripts/load/agent-chat.js
 */

import { check, sleep } from "k6";
import { optionalEnv, postJson, postJsonAuthed, checkNot5xx } from "./lib/supabase-edge.js";

export const options = {
  scenarios: {
    agent_chat: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 2),
      duration: __ENV.LOAD_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<10000"],
  },
};

export default function agentChat() {
  const jwt = optionalEnv("LOAD_TEST_USER_JWT");
  const brandId = optionalEnv("LOAD_TEST_BRAND_ID");
  const body = {
    conversation_id: null,
    message: "Load test ping — reply with one word.",
    ...(brandId ? { brand_id: brandId } : {}),
  };

  const res = jwt
    ? postJsonAuthed("agent-chat", body, jwt)
    : postJson("agent-chat", body);

  if (jwt) {
    check(res, {
      ...checkNot5xx("agent-chat"),
      "agent-chat authed (2xx or 429)": (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 429 || r.status === 504,
    });
  } else {
    check(res, {
      "agent-chat auth gate (401)": (r) => r.status === 401,
    });
  }

  sleep(1);
}
