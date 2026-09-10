/**
 * #426 G1 — Fan-out mirroring a public page mount: event bundle + trip + experience.
 */

import { check, sleep } from "k6";
import { vuScenario } from "./lib/scenario.js";
import {
  checkCacheable2xx,
  getHostJson,
  publicFixtures,
} from "./lib/public-read.js";

export const options = {
  ...vuScenario("public-offering-fanout"),
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function publicOfferingFanout() {
  const { brandSlug, eventSlug, tripSlug, experienceSlug } = publicFixtures();

  const eventPath =
    `/api/event-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
    `&eventSlug=${encodeURIComponent(eventSlug)}`;
  const tripPath =
    `/api/trip-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
    `&tripSlug=${encodeURIComponent(tripSlug)}`;
  const expPath =
    `/api/experience-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
    `&experienceSlug=${encodeURIComponent(experienceSlug)}`;

  const eventRes = getHostJson(eventPath, "fanout-event-bundle");
  const tripRes = getHostJson(tripPath, "fanout-trip-bundle");
  const expRes = getHostJson(expPath, "fanout-experience-bundle");

  check(eventRes, checkCacheable2xx("fanout-event"));
  check(tripRes, checkCacheable2xx("fanout-trip"));
  check(expRes, checkCacheable2xx("fanout-experience"));
  sleep(0.3);
}
