/**
 * #426 G1 — k6 helpers for public offering read paths (Host web + PostgREST).
 *
 * Env:
 *   LOAD_HOST_WEB_ORIGIN — e.g. https://host.usemingla.com (or staging Host deploy)
 *   LOAD_BASE_URL        — …/functions/v1 (used to derive PostgREST origin)
 *   SUPABASE_ANON_KEY    — anon key
 *   LOAD_TEST_BRAND_SLUG / LOAD_TEST_EVENT_SLUG / LOAD_TEST_TRIP_SLUG /
 *   LOAD_TEST_EXPERIENCE_SLUG — staging published offerings
 */

import http from "k6/http";
import { optionalEnv, requireEnv } from "./supabase-edge.js";

export function hostWebOrigin() {
  return requireEnv("LOAD_HOST_WEB_ORIGIN").replace(/\/$/, "");
}

/** Derive https://<ref>.supabase.co from LOAD_BASE_URL (…/functions/v1). */
export function supabaseRestOrigin() {
  const base = requireEnv("LOAD_BASE_URL").replace(/\/$/, "");
  return base.replace(/\/functions\/v1$/i, "");
}

export function publicFixtures() {
  return {
    brandSlug: optionalEnv("LOAD_TEST_BRAND_SLUG", "gogi"),
    eventSlug: optionalEnv("LOAD_TEST_EVENT_SLUG", "we-go-again"),
    tripSlug: optionalEnv("LOAD_TEST_TRIP_SLUG", "weekend-away"),
    experienceSlug: optionalEnv("LOAD_TEST_EXPERIENCE_SLUG", "wine-crawl"),
  };
}

export function getHostJson(pathWithQuery, tagName) {
  const url = `${hostWebOrigin()}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  return http.get(url, {
    tags: { name: tagName },
    timeout: "30s",
  });
}

export function postgrestRpc(functionName, body, tagName) {
  const url = `${supabaseRestOrigin()}/rest/v1/rpc/${functionName}`;
  return http.post(url, JSON.stringify(body), {
    headers: {
      apikey: requireEnv("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${requireEnv("SUPABASE_ANON_KEY")}`,
      "Content-Type": "application/json",
    },
    tags: { name: tagName || functionName },
    timeout: "30s",
  });
}

export function checkCacheable2xx(label) {
  return {
    [`${label} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label} has cache-control`]: (r) =>
      typeof r.headers["Cache-Control"] === "string" ||
      typeof r.headers["cache-control"] === "string",
  };
}
