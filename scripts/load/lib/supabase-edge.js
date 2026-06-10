/**
 * k6 helpers for Supabase edge function load tests (#426).
 *
 * Env (required at runtime):
 *   LOAD_BASE_URL      — e.g. https://<ref>.supabase.co/functions/v1
 *   SUPABASE_ANON_KEY  — anon key for apikey header
 */

import http from "k6/http";

export function requireEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name, fallback = "") {
  const value = __ENV[name];
  return value && String(value).length > 0 ? value : fallback;
}

export function edgeUrl(functionName) {
  const base = requireEnv("LOAD_BASE_URL").replace(/\/$/, "");
  return `${base}/${functionName}`;
}

export function edgeHeaders(extra = {}) {
  return {
    apikey: requireEnv("SUPABASE_ANON_KEY"),
    "Content-Type": "application/json",
    ...extra,
  };
}

export function postJson(functionName, body, params = {}) {
  return http.post(edgeUrl(functionName), JSON.stringify(body), {
    headers: edgeHeaders(params.headers),
    tags: { name: functionName, ...params.tags },
    timeout: params.timeout ?? "30s",
  });
}

/** Headers for JWT-authenticated edge calls (agent-chat, marketing-send, …). */
export function edgeHeadersWithJwt(jwt, extra = {}) {
  return edgeHeaders({
    Authorization: `Bearer ${jwt}`,
    ...extra,
  });
}

export function postJsonAuthed(functionName, body, jwt, params = {}) {
  return http.post(edgeUrl(functionName), JSON.stringify(body), {
    headers: edgeHeadersWithJwt(jwt, params.headers),
    tags: { name: functionName, ...params.tags },
    timeout: params.timeout ?? "60s",
  });
}

export function check2xx(label) {
  return {
    [`${label} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  };
}

/** Smoke/load pass when the edge fn did not throw (4xx/429 acceptable). */
export function checkNot5xx(label) {
  return {
    [`${label} not 5xx`]: (r) => r.status < 500,
  };
}
