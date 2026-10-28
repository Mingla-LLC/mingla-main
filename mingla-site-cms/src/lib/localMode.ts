/**
 * #2829 — safe local mode for Mingla Studio (the Sites CMS).
 *
 * Twin of `mingla-sites/src/lib/localMode.ts` (the two apps deploy
 * separately, so each carries its own copy; both are pinned by tests).
 *
 * Local mode lets Studio run against the local Sites CMS Supabase stack
 * (loopback Postgres without TLS, loopback S3, loopback Core). It is ON only
 * when every signal agrees: `SITES_LOCAL_MODE=1`, no `VERCEL` / `VERCEL_ENV`,
 * and every origin loopback. ANY partial signal throws. With no local signal
 * the production rules in config.ts run unchanged.
 */

const LOCAL_SIGNAL_NAMES = ["SITES_LOCAL_MODE", "SITES_LOCAL_EXTRA_HOSTS"] as const;
const VERCEL_MARKERS = ["VERCEL", "VERCEL_ENV"] as const;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const LOCAL_HOST_SUFFIX = "sites.localhost";

function present(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] !== undefined && env[name] !== "";
}

/** Build-time guard, called from next.config.mjs. */
export function assertNoLocalModeOnVercelBuild(env: NodeJS.ProcessEnv): void {
  if (
    VERCEL_MARKERS.some((name) => present(env, name)) &&
    LOCAL_SIGNAL_NAMES.some((name) => present(env, name))
  ) {
    throw new Error(
      "SITES_LOCAL_MODE_FORBIDDEN_ON_VERCEL: remove SITES_LOCAL_MODE / SITES_LOCAL_EXTRA_HOSTS from this Vercel project",
    );
  }
}

/** True only for a complete, consistent local signal; throws on a partial one. */
export function localModeEnabled(env: NodeJS.ProcessEnv): boolean {
  const requested = LOCAL_SIGNAL_NAMES.some((name) => present(env, name));
  if (!requested) return false;
  if (env.SITES_LOCAL_MODE !== "1") throw new Error("SITES_LOCAL_MODE_INVALID");
  if (VERCEL_MARKERS.some((name) => present(env, name))) {
    throw new Error("SITES_LOCAL_MODE_INVALID");
  }
  return true;
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

/** `http://127.0.0.1:<port>` or `http://localhost:<port>`, nothing else. */
export function loopbackOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid local origin: ${name}`);
  }
  if (
    url.protocol !== "http:" ||
    !isLoopbackHost(url.hostname) ||
    !/^[0-9]{2,5}$/.test(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) throw new Error(`Invalid local origin: ${name}`);
  return url.origin;
}

/**
 * The public runtime origin locally is a loopback origin or a
 * `http://<label>.sites.localhost:<port>` site origin (browsers resolve
 * `*.localhost` to loopback, RFC 6761).
 */
export function localRuntimeOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid local origin: ${name}`);
  }
  const label = url.hostname.endsWith(`.${LOCAL_HOST_SUFFIX}`)
    ? url.hostname.slice(0, -(LOCAL_HOST_SUFFIX.length + 1))
    : null;
  if (
    label !== null &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) &&
    url.protocol === "http:" &&
    /^[0-9]{2,5}$/.test(url.port) &&
    !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash
  ) return url.origin;
  return loopbackOrigin(value, name);
}
