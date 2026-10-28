/**
 * #2829 — safe local mode for the public Sites runtime.
 *
 * Local mode lets the runtime talk to a Supabase stack on this machine
 * (loopback http origins, `*.sites.localhost` hosts). It is a security
 * control: a production build that accepted loopback origins, or a Vercel
 * deployment that ran in local mode, would weaken every check below it. So:
 *
 *  - local mode is ON only when every signal agrees: `SITES_LOCAL_MODE=1`,
 *    no `VERCEL` / `VERCEL_ENV`, every backend origin loopback, and the public
 *    host suffix `sites.localhost`;
 *  - ANY partial signal (the flag with a Vercel marker, the flag with a
 *    remote origin, an extra-hosts list without the flag, a flag value other
 *    than "1") throws instead of quietly picking a mode;
 *  - with no local signal at all, production validation runs unchanged.
 *
 * The build-time half lives in next.config.ts (`assertNoLocalModeOnVercelBuild`).
 */

export const LOCAL_HOST_SUFFIX = "sites.localhost";

const LOCAL_SIGNAL_NAMES = ["SITES_LOCAL_MODE", "SITES_LOCAL_EXTRA_HOSTS"] as const;
const VERCEL_MARKERS = ["VERCEL", "VERCEL_ENV"] as const;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

function present(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] !== undefined && env[name] !== "";
}

/**
 * Build-time guard: a Vercel build with any local-mode variable fails, so a
 * mis-set project variable stops the deploy instead of shipping a weakened
 * build. Called from next.config.ts.
 */
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

/**
 * Runtime decision. Returns true only when local mode is fully and
 * consistently requested; throws on any partial or contradictory signal;
 * returns false when no local signal exists (production rules apply).
 */
export function localModeEnabled(env: NodeJS.ProcessEnv): boolean {
  const requested = LOCAL_SIGNAL_NAMES.some((name) => present(env, name));
  if (!requested) return false;
  if (env.SITES_LOCAL_MODE !== "1") throw new Error("SITES_LOCAL_MODE_INVALID");
  if (VERCEL_MARKERS.some((name) => present(env, name))) {
    throw new Error("SITES_LOCAL_MODE_INVALID");
  }
  return true;
}

/** `http://127.0.0.1:<port>` or `http://localhost:<port>`, nothing else. */
export function loopbackOrigin(value: string | undefined): string {
  if (!value) throw new Error("SERVICE_CONFIGURATION_UNAVAILABLE");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SERVICE_CONFIGURATION_INVALID");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !/^[0-9]{2,5}$/.test(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) throw new Error("SERVICE_CONFIGURATION_INVALID");
  return url.origin;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MINGLA_OR_PROVIDER_SUFFIXES = [
  "usemingla.com",
  "mingla.app",
  "vercel.app",
  "supabase.co",
];

/**
 * Extra hostnames a developer may serve locally (custom-domain tests). Each
 * must be a plain lowercase hostname and must not be a Mingla or provider
 * domain, so local mode can never answer for a production name.
 */
export function localExtraHosts(value: string | undefined): readonly string[] {
  if (!value) return [];
  const hosts = value.split(",").map((host) => host.trim()).filter(Boolean);
  if (hosts.length > 10) throw new Error("SERVICE_CONFIGURATION_INVALID");
  for (const host of hosts) {
    const labels = host.split(".");
    if (
      host.length > 253 ||
      labels.length < 2 ||
      !labels.every((label) => HOST_LABEL.test(label)) ||
      MINGLA_OR_PROVIDER_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      )
    ) throw new Error("SERVICE_CONFIGURATION_INVALID");
  }
  return hosts;
}
