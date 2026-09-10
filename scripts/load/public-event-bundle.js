/**
 * #426 G1 — Load: Host `/api/event-checkout-bundle` (CDN-cached event data, #2879).
 */

import { check, sleep } from "k6";
import { vuScenario } from "./lib/scenario.js";
import {
  checkCacheable2xx,
  getHostJson,
  publicFixtures,
} from "./lib/public-read.js";

export const options = {
  ...vuScenario("public-event-bundle"),
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function publicEventBundle() {
  const { brandSlug, eventSlug } = publicFixtures();
  const path =
    `/api/event-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
    `&eventSlug=${encodeURIComponent(eventSlug)}`;
  const res = getHostJson(path, "event-checkout-bundle");
  check(res, checkCacheable2xx("event-checkout-bundle"));
  sleep(0.2);
}
