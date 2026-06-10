/**
 * #426 PR7 bundle — Load: marketing-send (JWT required for direct path).
 *
 * Without LOAD_TEST_USER_JWT: exercises auth gate (expects 403 — campaign_id
 * required + ownership check).
 * With JWT + LOAD_TEST_CAMPAIGN_ID: full dispatch path (2xx preview_skipped or
 * 403 if campaign not owned).
 *
 * Run:
 *   LOAD_BASE_URL=... SUPABASE_ANON_KEY=... \
 *   LOAD_TEST_USER_JWT=<access_token> \
 *   LOAD_TEST_CAMPAIGN_ID=<draft_or_scheduled_campaign_uuid> \
 *   k6 run scripts/load/marketing-send.js
 */

import { check, sleep } from "k6";
import { optionalEnv, postJson, postJsonAuthed, checkNot5xx } from "./lib/supabase-edge.js";

export const options = {
  scenarios: {
    marketing_send: {
      executor: "constant-vus",
      vus: Number(__ENV.LOAD_VUS || 2),
      duration: __ENV.LOAD_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<5000"],
  },
};

export default function marketingSend() {
  const jwt = optionalEnv("LOAD_TEST_USER_JWT");
  const campaignId = optionalEnv(
    "LOAD_TEST_CAMPAIGN_ID",
    "00000000-0000-4000-8000-000000000099",
  );
  const body = { campaign_id: campaignId };

  const res = jwt
    ? postJsonAuthed("marketing-send", body, jwt)
    : postJson("marketing-send", body);

  if (jwt) {
    check(res, {
      ...checkNot5xx("marketing-send"),
      "marketing-send authed (2xx or 403)": (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 403,
    });
  } else {
    check(res, {
      "marketing-send auth gate (403)": (r) => r.status === 403,
    });
  }

  sleep(1);
}
