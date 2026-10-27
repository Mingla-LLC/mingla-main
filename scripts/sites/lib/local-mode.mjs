// #2829 — local-mode rules for the Sites ops scripts.
//
// The bootstrap and Payload-migration scripts normally accept only a hosted
// Sites CMS project. With SITES_LOCAL_MODE=1 (and no Vercel / CI deploy
// marker) they accept the LOCAL Sites CMS stack instead, and then ONLY a
// loopback target. Any partial signal fails closed, exactly like the runtime
// and Studio config loaders (mingla-sites/src/lib/localMode.ts).

import { fail } from "./sites-ops.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEPLOY_MARKERS = ["VERCEL", "VERCEL_ENV", "GITHUB_ACTIONS"];

function present(env, name) {
  return env[name] !== undefined && env[name] !== "";
}

/** True only for SITES_LOCAL_MODE=1 with no deploy marker; throws on partial. */
export function sitesLocalMode(env = process.env) {
  if (!present(env, "SITES_LOCAL_MODE")) return false;
  if (env.SITES_LOCAL_MODE !== "1") fail("LOCAL_MODE_INVALID");
  if (DEPLOY_MARKERS.some((name) => present(env, name))) {
    fail("LOCAL_MODE_FORBIDDEN_IN_DEPLOY");
  }
  return true;
}

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname);
}

/** The local Sites CMS stack's S3 endpoint: http://<loopback>:<port>/storage/v1/s3 */
export function localStorageEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("S3_PROJECT_MISMATCH");
  }
  if (
    url.protocol !== "http:" || !isLoopbackHost(url.hostname) ||
    !/^[0-9]{2,5}$/.test(url.port) || url.username || url.password ||
    url.pathname !== "/storage/v1/s3" || url.search || url.hash
  ) fail("S3_PROJECT_MISMATCH");
  return url;
}

/**
 * A loopback Postgres URL for the given role on the local Sites CMS stack.
 * Supabase lays a stack out as API = N, database = N + 1; requiring that
 * pairing is the local twin of production's same-project-ref rule.
 */
export function localDatabaseUrl(raw, { user, storagePort, code }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(code);
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.username) !== user ||
    !isLoopbackHost(url.hostname) ||
    Number(url.port) !== Number(storagePort) + 1 ||
    url.pathname !== "/postgres" || url.hash ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    (url.searchParams.has("sslmode") && url.searchParams.get("sslmode") !== "disable")
  ) fail(code);
  return raw;
}
