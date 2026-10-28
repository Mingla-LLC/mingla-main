// #2829 W8 (AD-10) — a brand's own domain: name rules, the domain provider
// adapter, DNS lookups and the site-id probe.
//
// * `classifyCustomHostname` — shape, public-suffix apex detection, Mingla's
//   own and its providers' domains refused, reserved test names only locally.
// * `DomainProvider` — add / read (with a verification attempt) / remove a
//   domain and read its certificate. `VercelDomainProvider` talks to the
//   hosting provider's REST API for the `mingla-sites` project (production);
//   `LocalDomainProvider` is a deterministic fake driven by the local control
//   table `brand_site_local_domain_states`, which only the local seed creates.
// * `DnsResolver` — `DohDnsResolver` asks two DNS-over-HTTPS resolvers and
//   only answers when they agree; `LocalDnsResolver` reads the control table.
// * `SiteProbe` — `https://<host>/.well-known/mingla-site` must return this
//   site's id hash before a domain goes live, so a domain someone else points
//   at the provider can never be bound to a different site.
// * `checkDomain` — one check: the facts `brand_site_domain_record_check`
//   turns into state (that SQL owns the policy).
//
// Nothing here is shown to a customer verbatim except record values; the
// customer UI never names Mingla's infrastructure providers.

import {
  detectRegistrar,
  type DnsRecordRequest,
  type DnsRegistrar,
} from "./siteContracts/dnsGuides.ts";

// ── Names ───────────────────────────────────────────────────────────────────

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Mingla's own and its providers' domains: never a brand's address. */
export const REFUSED_DOMAIN_SUFFIXES = [
  "usemingla.com",
  "mingla.app",
  "sites.localhost",
  "localhost",
  "vercel.app",
  "vercel.com",
  "vercel-dns.com",
  "now.sh",
  "supabase.co",
  "supabase.in",
  "b-cdn.net",
  "bunny.net",
] as const;

/** Special-use names: refused in production; `.test` allowed in local mode. */
const RESERVED_TLDS = ["test", "local", "invalid", "example", "internal", "onion", "localhost"];

/**
 * Public suffixes with more than one label (a curated subset of the Public
 * Suffix List's ICANN section covering the registries brands use). Any other
 * name's public suffix is its last label. `<one label>.<suffix>` is an apex.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // United Kingdom
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk",
  // Ireland, Europe
  "gov.ie", "co.at", "or.at", "com.es", "org.es", "nom.es", "com.pt", "com.pl", "net.pl",
  "org.pl", "com.gr", "com.cy", "com.mt", "com.tr", "org.tr", "net.tr", "co.il", "org.il",
  "com.ua", "co.hu", "com.ro", "co.rs",
  // Africa
  "com.ng", "org.ng", "net.ng", "edu.ng", "gov.ng", "name.ng", "co.za", "org.za", "net.za",
  "web.za", "co.ke", "or.ke", "ne.ke", "com.gh", "org.gh", "co.tz", "or.tz", "co.ug",
  "or.ug", "com.eg", "co.zw", "co.zm", "com.et", "co.rw", "co.ma", "com.sn", "co.bw",
  "com.cm", "co.mz", "com.na",
  // Americas
  "com.br", "net.br", "org.br", "art.br", "com.mx", "org.mx", "com.ar", "com.co", "net.co",
  "com.pe", "com.ve", "com.ec", "com.uy", "com.py", "com.bo", "com.do", "com.jm", "co.cr",
  "com.gt", "com.pa", "com.sv", "co.ve", "qc.ca", "on.ca", "bc.ca",
  // Asia-Pacific
  "com.au", "net.au", "org.au", "id.au", "asn.au", "co.nz", "net.nz", "org.nz", "geek.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "co.kr", "or.kr", "com.cn", "net.cn", "org.cn",
  "com.hk", "org.hk", "net.hk", "com.tw", "org.tw", "com.sg", "org.sg", "net.sg",
  "com.my", "net.my", "org.my", "co.id", "or.id", "web.id", "co.th", "in.th", "or.th",
  "com.ph", "net.ph", "org.ph", "com.vn", "net.vn", "co.in", "net.in", "org.in", "firm.in",
  "gen.in", "ind.in", "com.pk", "org.pk", "com.bd", "com.lk", "com.np",
  // Middle East
  "com.sa", "net.sa", "org.sa", "co.ae", "com.qa", "com.kw", "com.bh", "com.om", "com.lb",
  "com.jo",
]);

export function publicSuffixOf(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length >= 2) {
    const two = labels.slice(-2).join(".");
    if (MULTI_LABEL_SUFFIXES.has(two)) return two;
  }
  return labels[labels.length - 1];
}

/** The part bought from a registrar (`www.shop.co.uk` -> `shop.co.uk`). */
export function registrableDomain(hostname: string): string | null {
  const suffix = publicSuffixOf(hostname);
  if (hostname === suffix) return null;
  const rest = hostname.slice(0, -(suffix.length + 1));
  const lastLabel = rest.split(".").pop() ?? "";
  return lastLabel ? `${lastLabel}.${suffix}` : null;
}

export type CustomHostnameRefusal =
  | "shape"
  | "ip_address"
  | "public_suffix"
  | "mingla_domain"
  | "reserved_name";

export type CustomHostnameClassification =
  | { ok: true; hostname: string; isApex: boolean; apex: string }
  | { ok: false; reason: CustomHostnameRefusal };

/**
 * What the owner typed -> a custom hostname, or a refusal. A pasted URL is
 * forgiven (`https://www.Example.com/about` -> `www.example.com`); a port,
 * user info, wildcard or IP address is not.
 */
export function classifyCustomHostname(
  raw: unknown,
  options: { local: boolean },
): CustomHostnameClassification {
  if (typeof raw !== "string") return { ok: false, reason: "shape" };
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/[/?#].*$/, "");
  value = value.replace(/\.$/, "");
  if (
    value.length < 4 || value.length > 253 || /[*:@\s]/.test(value) ||
    !HOST_RE.test(value)
  ) return { ok: false, reason: "shape" };
  if (/^[0-9.]+$/.test(value)) return { ok: false, reason: "ip_address" };
  if (
    REFUSED_DOMAIN_SUFFIXES.some((suffix) =>
      value === suffix || value.endsWith(`.${suffix}`)
    )
  ) return { ok: false, reason: "mingla_domain" };
  const tld = value.split(".").pop() ?? "";
  if (RESERVED_TLDS.includes(tld) && !(options.local && tld === "test")) {
    return { ok: false, reason: "reserved_name" };
  }
  if (!value.split(".").every((label) => LABEL_RE.test(label))) {
    return { ok: false, reason: "shape" };
  }
  const apex = registrableDomain(value);
  if (apex === null) return { ok: false, reason: "public_suffix" };
  return { ok: true, hostname: value, isApex: value === apex, apex };
}

// ── Provider adapter ───────────────────────────────────────────────────────

export interface ProviderDomainState {
  /** The provider accepts the domain as this project's (ownership proven). */
  verified: boolean;
  /** DNS does not (yet) point at the provider, or no certificate can be made. */
  misconfigured: boolean;
  /** Every record the owner must add (the routing record, plus TXT if asked). */
  records: DnsRecordRequest[];
  /** The ownership TXT challenge, when the provider requires one. */
  verification: DnsRecordRequest | null;
  providerRef: string | null;
}

export type DomainProviderErrorCode =
  | "domain_in_use"
  | "provider_refused"
  | "provider_unavailable";

export class DomainProviderError extends Error {
  constructor(readonly code: DomainProviderErrorCode) {
    super(code);
    this.name = "DomainProviderError";
  }
}

export interface DomainProvider {
  readonly kind: "vercel" | "local";
  add(hostname: string, isApex: boolean): Promise<ProviderDomainState>;
  /** Reads the domain, attempting verification when it is not yet verified. */
  get(hostname: string, isApex: boolean): Promise<ProviderDomainState>;
  remove(hostname: string): Promise<void>;
  certificate(hostname: string): Promise<{ expiresAt: string | null }>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Used only when the provider's API returns no recommendation. */
export const FALLBACK_APEX_IPV4 = "76.76.21.21";
export const FALLBACK_CNAME_TARGET = "cname.vercel-dns.com";

const VERCEL_API = "https://api.vercel.com";

/**
 * Production adapter: the hosting provider's REST API, project domains on the
 * `mingla-sites` project (endpoint paths per the provider's public REST docs,
 * read 2026-10-26): POST /v10/projects/{p}/domains, GET and DELETE
 * /v9/projects/{p}/domains/{d}, POST /v9/projects/{p}/domains/{d}/verify,
 * GET /v6/domains/{d}/config, GET /v8/certs. Tested with a mocked transport;
 * no test makes a real call.
 */
export class VercelDomainProvider implements DomainProvider {
  readonly kind = "vercel" as const;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      token: string;
      projectId: string;
      teamId: string;
      fetch?: FetchLike;
    },
  ) {
    if (!options.token || !options.projectId || !options.teamId) {
      throw new DomainProviderError("provider_unavailable");
    }
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${VERCEL_API}${path}${separator}teamId=${encodeURIComponent(this.options.teamId)}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DomainProviderError("provider_unavailable");
    }
    if (response.status >= 500 || response.status === 429 || response.status === 401) {
      await response.body?.cancel();
      throw new DomainProviderError("provider_unavailable");
    }
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, json };
  }

  private projectPath(suffix = ""): string {
    return `/v9/projects/${encodeURIComponent(this.options.projectId)}/domains${suffix}`;
  }

  async add(hostname: string, isApex: boolean): Promise<ProviderDomainState> {
    const added = await this.call(
      "POST",
      `/v10/projects/${encodeURIComponent(this.options.projectId)}/domains`,
      { name: hostname },
    );
    if (added.status === 409) throw new DomainProviderError("domain_in_use");
    if (added.status === 200) return await this.stateFrom(hostname, isApex, added.json);
    if (added.status === 400) {
      // Already on this project (a retried attach): read it instead.
      return await this.get(hostname, isApex);
    }
    throw new DomainProviderError("provider_refused");
  }

  async get(hostname: string, isApex: boolean): Promise<ProviderDomainState> {
    const read = await this.call("GET", this.projectPath(`/${encodeURIComponent(hostname)}`));
    if (read.status === 404) {
      return {
        verified: false,
        misconfigured: true,
        records: [routingRecord(hostname, isApex, null)],
        verification: null,
        providerRef: null,
      };
    }
    if (read.status !== 200 || !read.json) throw new DomainProviderError("provider_refused");
    let domain = read.json;
    if (domain.verified !== true) {
      const verified = await this.call(
        "POST",
        this.projectPath(`/${encodeURIComponent(hostname)}/verify`),
      );
      // 400 = the challenge is not satisfied yet; keep the unverified answer.
      if (verified.status === 200 && verified.json) domain = verified.json;
    }
    return await this.stateFrom(hostname, isApex, domain);
  }

  private async stateFrom(
    hostname: string,
    isApex: boolean,
    domain: Record<string, unknown> | null,
  ): Promise<ProviderDomainState> {
    const config = await this.call(
      "GET",
      `/v6/domains/${encodeURIComponent(hostname)}/config?projectIdOrName=${encodeURIComponent(this.options.projectId)}`,
    );
    const configJson = config.status === 200 ? config.json : null;
    const routing = routingRecord(hostname, isApex, configJson);
    const challenge = Array.isArray(domain?.verification)
      ? (domain!.verification as Array<Record<string, unknown>>).find((entry) =>
        entry?.type === "TXT" && typeof entry.domain === "string" &&
        typeof entry.value === "string"
      )
      : undefined;
    const verification: DnsRecordRequest | null = challenge
      ? {
        type: "TXT",
        name: String(challenge.domain).toLowerCase().replace(/\.$/, ""),
        value: String(challenge.value).slice(0, 512),
      }
      : null;
    return {
      verified: domain?.verified === true,
      // No config answer is treated as misconfigured: never activate blind.
      misconfigured: configJson ? configJson.misconfigured !== false : true,
      records: verification ? [routing, verification] : [routing],
      verification,
      providerRef: typeof domain?.name === "string" ? String(domain.name).slice(0, 200) : null,
    };
  }

  async remove(hostname: string): Promise<void> {
    const removed = await this.call("DELETE", this.projectPath(`/${encodeURIComponent(hostname)}`));
    if (removed.status !== 200 && removed.status !== 204 && removed.status !== 404) {
      throw new DomainProviderError("provider_refused");
    }
  }

  async certificate(hostname: string): Promise<{ expiresAt: string | null }> {
    try {
      const listed = await this.call("GET", "/v8/certs?limit=100");
      const certs = Array.isArray(listed.json?.certs)
        ? listed.json!.certs as Array<Record<string, unknown>>
        : [];
      const expiries = certs
        .filter((cert) => Array.isArray(cert.cns) && (cert.cns as unknown[]).includes(hostname))
        .map((cert) => Number(cert.expiresAt))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (expiries.length === 0) return { expiresAt: null };
      return { expiresAt: new Date(Math.max(...expiries)).toISOString() };
    } catch {
      return { expiresAt: null };
    }
  }
}

/** The A (apex) or CNAME (subdomain) record, from the provider's recommendation. */
export function routingRecord(
  hostname: string,
  isApex: boolean,
  config: Record<string, unknown> | null,
): DnsRecordRequest {
  const rankOne = (key: string): unknown => {
    const list = Array.isArray(config?.[key]) ? config![key] as Array<Record<string, unknown>> : [];
    const sorted = [...list].sort((left, right) => Number(left?.rank) - Number(right?.rank));
    return sorted[0]?.value;
  };
  if (isApex) {
    const values = rankOne("recommendedIPv4");
    const first = Array.isArray(values) ? values.find((value) => typeof value === "string" && /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(value)) : undefined;
    return { type: "A", name: hostname, value: typeof first === "string" ? first : FALLBACK_APEX_IPV4 };
  }
  const target = rankOne("recommendedCNAME");
  const cname = typeof target === "string" && HOST_RE.test(target.toLowerCase().replace(/\.$/, ""))
    ? target.toLowerCase().replace(/\.$/, "")
    : FALLBACK_CNAME_TARGET;
  return { type: "CNAME", name: hostname, value: cname };
}

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

interface LocalDomainStateRow {
  hostname: string;
  verified: boolean;
  misconfigured: boolean;
  require_txt: boolean;
  tls_expires_at: string | null;
  ns: string[] | null;
  mx: string[] | null;
}

/**
 * Local mode only (the edge function picks it only when the service config
 * row is `local` and the stack is local). Deterministic: whatever the local
 * control table says. A domain with no row is waiting for DNS.
 */
export class LocalDomainProvider implements DomainProvider {
  readonly kind = "local" as const;
  constructor(private readonly db: ServiceClient) {}

  private async row(hostname: string): Promise<LocalDomainStateRow | null> {
    const { data, error } = await this.db
      .from("brand_site_local_domain_states")
      .select("hostname,verified,misconfigured,require_txt,tls_expires_at,ns,mx")
      .eq("hostname", hostname)
      .maybeSingle();
    if (error) throw new DomainProviderError("provider_unavailable");
    return data as LocalDomainStateRow | null;
  }

  private state(hostname: string, isApex: boolean, row: LocalDomainStateRow | null): ProviderDomainState {
    const routing: DnsRecordRequest = isApex
      ? { type: "A", name: hostname, value: "127.0.0.1" }
      : { type: "CNAME", name: hostname, value: "local.sites.localhost" };
    const verification: DnsRecordRequest | null = row?.require_txt
      ? { type: "TXT", name: `_mingla-local.${hostname}`, value: `mingla-local-${hostname}` }
      : null;
    return {
      verified: row?.verified === true,
      misconfigured: row ? row.misconfigured !== false : true,
      records: verification ? [routing, verification] : [routing],
      verification,
      providerRef: row ? `local:${hostname}` : null,
    };
  }

  async add(hostname: string, isApex: boolean): Promise<ProviderDomainState> {
    return this.state(hostname, isApex, await this.row(hostname));
  }

  async get(hostname: string, isApex: boolean): Promise<ProviderDomainState> {
    return this.state(hostname, isApex, await this.row(hostname));
  }

  async remove(_hostname: string): Promise<void> {
    // The local control table is the seed's; removal changes nothing there.
  }

  async certificate(hostname: string): Promise<{ expiresAt: string | null }> {
    return { expiresAt: (await this.row(hostname))?.tls_expires_at ?? null };
  }
}

// ── DNS ─────────────────────────────────────────────────────────────────────

export type DnsQueryType = "NS" | "MX";

export interface DnsResolver {
  /** Names for the query, `[]` when none exist, null when unknown. */
  lookup(name: string, type: DnsQueryType): Promise<string[] | null>;
}

export const DOH_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

const TYPE_NUMBER: Record<DnsQueryType, number> = { NS: 2, MX: 15 };

function normalizeAnswer(type: DnsQueryType, data: unknown): string | null {
  if (typeof data !== "string") return null;
  let value = data.trim().toLowerCase();
  if (type === "MX") value = value.replace(/^[0-9]+\s+/, "");
  value = value.replace(/\.$/, "");
  return HOST_RE.test(value) ? value : null;
}

/**
 * DNS-over-HTTPS against two independent resolvers. An answer is used only
 * when both resolvers return the same set; anything else is "unknown" (null),
 * which never raises or clears a warning.
 */
export class DohDnsResolver implements DnsResolver {
  private readonly fetchImpl: FetchLike;
  constructor(
    fetchImpl?: FetchLike,
    private readonly endpoints: readonly string[] = DOH_ENDPOINTS,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  private async ask(endpoint: string, name: string, type: DnsQueryType): Promise<string[] | null> {
    try {
      const response = await this.fetchImpl(
        `${endpoint}?name=${encodeURIComponent(name)}&type=${type}`,
        {
          headers: { Accept: "application/dns-json" },
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const json = await response.json() as { Status?: unknown; Answer?: unknown };
      if (json.Status === 3) return [];
      if (json.Status !== 0) return null;
      const answers = Array.isArray(json.Answer) ? json.Answer as Array<Record<string, unknown>> : [];
      const names = answers
        .filter((answer) => answer?.type === TYPE_NUMBER[type])
        .map((answer) => normalizeAnswer(type, answer.data))
        .filter((value): value is string => value !== null);
      return [...new Set(names)].sort();
    } catch {
      return null;
    }
  }

  async lookup(name: string, type: DnsQueryType): Promise<string[] | null> {
    const answers = await Promise.all(this.endpoints.map((endpoint) => this.ask(endpoint, name, type)));
    if (answers.some((answer) => answer === null)) return null;
    const first = JSON.stringify(answers[0]);
    return answers.every((answer) => JSON.stringify(answer) === first) ? answers[0] : null;
  }
}

/** Local mode only: NS and MX from the local control table. */
export class LocalDnsResolver implements DnsResolver {
  constructor(private readonly db: ServiceClient) {}
  async lookup(name: string, type: DnsQueryType): Promise<string[] | null> {
    const { data, error } = await this.db
      .from("brand_site_local_domain_states")
      .select("ns,mx")
      .eq("hostname", name)
      .maybeSingle();
    if (error) return null;
    if (!data) return [];
    const list = type === "NS" ? data.ns : data.mx;
    return Array.isArray(list) ? [...list].map(String).sort() : [];
  }
}

// ── Site-id probe ───────────────────────────────────────────────────────────

/** First 16 hex characters of sha256(site id): what the runtime route returns. */
export async function siteIdHash(siteId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(siteId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export interface SiteProbe {
  probe(hostname: string, expectedHash: string): Promise<boolean>;
}

async function probeResponse(response: Response, expectedHash: string): Promise<boolean> {
  if (response.status !== 200) {
    await response.body?.cancel();
    return false;
  }
  const json = await response.json().catch(() => null) as { site?: unknown } | null;
  return json?.site === expectedHash;
}

/** Production: HTTPS on the domain itself, no redirects followed. */
export class HttpsSiteProbe implements SiteProbe {
  private readonly fetchImpl: FetchLike;
  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? fetch;
  }
  async probe(hostname: string, expectedHash: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`https://${hostname}/.well-known/mingla-site`, {
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      return await probeResponse(response, expectedHash);
    } catch {
      return false;
    }
  }
}

/**
 * Local mode only: the runtime on the developer's machine, asked for the
 * domain through the forwarding header it already trusts for host binding.
 */
export class LocalSiteProbe implements SiteProbe {
  private readonly fetchImpl: FetchLike;
  constructor(private readonly origin: string, fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? fetch;
  }
  async probe(hostname: string, expectedHash: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.origin}/.well-known/mingla-site`, {
        headers: { "x-forwarded-host": hostname },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      return await probeResponse(response, expectedHash);
    } catch {
      return false;
    }
  }
}

// ── One check ───────────────────────────────────────────────────────────────

export type TlsState = "unknown" | "pending" | "issued" | "expiring" | "failed";
export const TLS_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

export function tlsStateFrom(input: {
  dnsOk: boolean;
  probeOk: boolean;
  certExpiresAt: string | null;
  now: number;
}): TlsState {
  if (!input.dnsOk) return "pending";
  if (input.certExpiresAt) {
    const expires = Date.parse(input.certExpiresAt);
    if (Number.isFinite(expires) && expires - input.now < TLS_EXPIRY_WARNING_MS) return "expiring";
  }
  return input.probeOk ? "issued" : "pending";
}

export interface DomainCheckFacts {
  dnsState: "ok" | "misconfigured" | "pending";
  tlsState: TlsState;
  verification: {
    records: DnsRecordRequest[];
    txt: DnsRecordRequest | null;
    registrar?: DnsRegistrar;
    mx: string[] | null;
    probe_ok: boolean;
    tls_expires_at: string | null;
  };
  providerRef: string | null;
}

/** One check of one custom host. Provider errors propagate (no drift on outage). */
export async function checkDomain(
  deps: { provider: DomainProvider; dns: DnsResolver; probe: SiteProbe },
  host: { hostname: string; isApex: boolean; siteId: string },
  now = Date.now(),
  initial?: ProviderDomainState,
): Promise<DomainCheckFacts> {
  const state = initial ?? await deps.provider.get(host.hostname, host.isApex);
  const dnsState = state.verified && !state.misconfigured
    ? "ok"
    : state.verified
    ? "misconfigured"
    : "pending";
  const apex = registrableDomain(host.hostname) ?? host.hostname;
  const [nameservers, mx] = await Promise.all([
    deps.dns.lookup(apex, "NS"),
    deps.dns.lookup(apex, "MX"),
  ]);
  const probeOk = dnsState === "ok"
    ? await deps.probe.probe(host.hostname, await siteIdHash(host.siteId))
    : false;
  const certificate = dnsState === "ok"
    ? await deps.provider.certificate(host.hostname)
    : { expiresAt: null };
  return {
    dnsState,
    tlsState: tlsStateFrom({ dnsOk: dnsState === "ok", probeOk, certExpiresAt: certificate.expiresAt, now }),
    verification: {
      records: state.records.slice(0, 6),
      txt: state.verification,
      ...(nameservers === null ? {} : { registrar: detectRegistrar(nameservers) }),
      mx: mx === null ? null : mx.slice(0, 20),
      probe_ok: probeOk,
      tls_expires_at: certificate.expiresAt,
    },
    providerRef: state.providerRef,
  };
}
