#!/usr/bin/env node
/*
 * #2829 W8 — drive the LOCAL domain provider (developer stack only).
 *
 * The brand-site-domains edge function, in local mode, reads a brand's own
 * domain's provider verdict, DNS (nameservers, email records) and certificate
 * expiry from `public.brand_site_local_domain_states`. That table exists ONLY
 * in a local stack: this script (and the local seed) create it, after
 * refusing any database whose Sites service row is not 'local' or whose
 * address is not loopback. No migration ever creates it.
 *
 *   node scripts/sites/local/domain-state.mjs --host youngandstamped.test \
 *     [--verified] [--configured | --misconfigured] [--require-txt] \
 *     [--ns dns1.registrar-servers.com,dns2.registrar-servers.com] \
 *     [--mx mx1.mail.test] [--no-mx] [--tls-expires 2026-11-01T00:00:00Z] \
 *     [--age-misconfigured-days 8]    # simulate time for drift fallback
 *     [--show]
 *
 * Defaults for a new row: not verified, misconfigured, no TXT, no NS, no MX.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertLoopbackUrl, parseEnvFile, STATE_DIR } from "./lib/local-state.mjs";

export const LOCAL_DOMAIN_STATES_DDL = `
CREATE TABLE IF NOT EXISTS public.brand_site_local_domain_states (
  hostname text PRIMARY KEY CHECK (hostname = lower(hostname) AND length(hostname) BETWEEN 4 AND 253),
  verified boolean NOT NULL DEFAULT false,
  misconfigured boolean NOT NULL DEFAULT true,
  require_txt boolean NOT NULL DEFAULT false,
  tls_expires_at timestamptz,
  ns text[] NOT NULL DEFAULT '{}',
  mx text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_site_local_domain_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_local_domain_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_local_domain_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_local_domain_states TO service_role;
COMMENT ON TABLE public.brand_site_local_domain_states IS
  '#2829 W8 LOCAL STACK ONLY — the local domain provider''s answers. Created by scripts/sites/local, never by a migration.';
NOTIFY pgrst, 'reload schema';
`;

/** Refuses anything but a local stack (AD-12). */
export const LOCAL_ONLY_GUARD = `
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_service_config
      WHERE config_key = 'sites_v1' AND environment = 'local')
    OR EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE environment <> 'local') THEN
    RAISE EXCEPTION 'DOMAIN_STATE_REFUSED: not a local Sites stack';
  END IF;
END
$guard$;
`;

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function parseArgs(argv) {
  const out = { host: null, verified: null, misconfigured: null, requireTxt: null, ns: null, mx: null, tlsExpires: undefined, ageDays: null, show: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`MISSING_VALUE:${arg}`);
      index += 1;
      return value;
    };
    if (arg === "--host") out.host = next().toLowerCase();
    else if (arg === "--verified") out.verified = true;
    else if (arg === "--unverified") out.verified = false;
    else if (arg === "--configured") out.misconfigured = false;
    else if (arg === "--misconfigured") out.misconfigured = true;
    else if (arg === "--require-txt") out.requireTxt = true;
    else if (arg === "--ns") out.ns = next().split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    else if (arg === "--mx") out.mx = next().split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    else if (arg === "--no-mx") out.mx = [];
    else if (arg === "--tls-expires") out.tlsExpires = next();
    else if (arg === "--age-misconfigured-days") out.ageDays = Number(next());
    else if (arg === "--show") out.show = true;
    else throw new Error(`UNSUPPORTED_ARGUMENT:${arg}`);
  }
  if (!out.host || !HOST_RE.test(out.host)) throw new Error("HOST_REQUIRED");
  for (const name of [...(out.ns ?? []), ...(out.mx ?? [])]) {
    if (!HOST_RE.test(name)) throw new Error(`BAD_NAME:${name}`);
  }
  if (out.tlsExpires !== undefined && !Number.isFinite(Date.parse(out.tlsExpires))) throw new Error("BAD_TLS_EXPIRES");
  if (out.ageDays !== null && !(out.ageDays >= 0 && out.ageDays <= 60)) throw new Error("BAD_AGE");
  return out;
}

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;
const textArray = (values) => `ARRAY[${values.map(literal).join(",")}]::text[]`;

/** The SQL for one invocation (exported for the node test). */
export function buildSql(options) {
  const sets = [];
  if (options.verified !== null) sets.push(`verified = ${options.verified}`);
  if (options.misconfigured !== null) sets.push(`misconfigured = ${options.misconfigured}`);
  if (options.requireTxt !== null) sets.push(`require_txt = ${options.requireTxt}`);
  if (options.ns !== null) sets.push(`ns = ${textArray(options.ns)}`);
  if (options.mx !== null) sets.push(`mx = ${textArray(options.mx)}`);
  if (options.tlsExpires !== undefined) sets.push(`tls_expires_at = ${literal(new Date(options.tlsExpires).toISOString())}::timestamptz`);
  const host = literal(options.host);
  const statements = [
    "BEGIN;",
    LOCAL_ONLY_GUARD,
    LOCAL_DOMAIN_STATES_DDL,
    `INSERT INTO public.brand_site_local_domain_states(hostname) VALUES (${host}) ON CONFLICT (hostname) DO NOTHING;`,
  ];
  if (sets.length) {
    statements.push(`UPDATE public.brand_site_local_domain_states SET ${sets.join(", ")}, updated_at = now() WHERE hostname = ${host};`);
  }
  if (options.ageDays !== null) {
    // Simulated time for the 7-day drift rule: move the incident start back.
    statements.push(`UPDATE public.brand_site_hosts SET misconfigured_since = clock_timestamp() - make_interval(days => ${Math.trunc(options.ageDays)}) WHERE hostname = ${host} AND kind = 'custom_domain' AND misconfigured_since IS NOT NULL;`);
  }
  statements.push("COMMIT;");
  statements.push(`SELECT 'DOMAIN_STATE ' || row_to_json(state)::text FROM public.brand_site_local_domain_states state WHERE hostname = ${host};`);
  statements.push(`SELECT 'DOMAIN_HOST ' || json_build_object('hostname', h.hostname, 'status', h.status, 'is_primary', h.is_primary, 'dns_state', h.dns_state, 'tls_state', h.tls_state, 'misconfigured_checks', h.misconfigured_checks, 'misconfigured_since', h.misconfigured_since, 'mx_missing', h.mx_missing_since IS NOT NULL, 'redirect_until', h.redirect_until)::text FROM public.brand_site_hosts h WHERE h.hostname = ${host};`);
  return statements.join("\n");
}

function coreDbUrl() {
  const override = process.env.SITES_LOCAL_CORE_DB_URL;
  if (override) return assertLoopbackUrl(override, "core").toString();
  const path = resolve(STATE_DIR, "core.status.env");
  if (!existsSync(path)) throw new Error("STATUS_FILE_MISSING:core");
  const url = parseEnvFile(readFileSync(path, "utf8")).DB_URL;
  if (!url) throw new Error("STATUS_VALUE_MISSING:core:DB_URL");
  return assertLoopbackUrl(url, "core").toString();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = new URL(coreDbUrl());
  const result = spawnSync("psql", ["-X", "--no-psqlrc", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: buildSql(options),
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1) || "postgres",
      PGAPPNAME: "mingla-sites-local-domain-state",
    },
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr).split("\n").filter(Boolean).slice(-2).join(" | "));
  }
  process.stdout.write(result.stdout.split("\n").filter((line) => line.startsWith("DOMAIN_")).join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL domain-state: ${error instanceof Error ? error.message : "unknown"}\n`);
    process.exit(1);
  }
}
