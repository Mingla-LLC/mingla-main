/**
 * #426 G1 — Load: experience public read (CDN bundle or PostgREST RPC).
 */

import { check, sleep } from "k6";
import { optionalEnv, check2xx } from "./lib/supabase-edge.js";
import { vuScenario } from "./lib/scenario.js";
import {
  checkCacheable2xx,
  getHostJson,
  postgrestRpc,
  publicFixtures,
} from "./lib/public-read.js";

export const options = {
  ...vuScenario("public-experience-read"),
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function publicExperienceRead() {
  const { brandSlug, experienceSlug } = publicFixtures();
  const mode = optionalEnv("LOAD_PUBLIC_READ_MODE", "cdn");

  if (mode === "rpc") {
    const res = postgrestRpc(
      "pg_public_experience_by_slug",
      { p_brand_slug: brandSlug, p_experience_slug: experienceSlug },
      "pg_public_experience_by_slug",
    );
    check(res, check2xx("pg_public_experience_by_slug"));
  } else {
    const path =
      `/api/experience-checkout-bundle?brandSlug=${encodeURIComponent(brandSlug)}` +
      `&experienceSlug=${encodeURIComponent(experienceSlug)}`;
    const res = getHostJson(path, "experience-checkout-bundle");
    check(res, checkCacheable2xx("experience-checkout-bundle"));
  }
  sleep(0.2);
}
