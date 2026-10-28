// deno-lint-ignore-file require-await -- fakes mirror async APIs
/*
 * #2829 W8 — brand-site-domains routes (the real handler, Core and the
 * provider faked; no network).
 *
 * Proves: no signed-in user -> 403 before anything; attach validates the name
 * in the function and passes is_apex to the rank-checked RPC, adds the domain
 * at the provider and records the first check through the service role; a
 * domain the provider says is in use elsewhere is given back (released, 409);
 * an unconfigured provider refuses BEFORE creating anything; Core refusals
 * map to plain customer codes that never name a provider; "Check now" needs
 * manage rights or a Mingla admin; detach of a never-live address removes it
 * at the provider and releases it; the sweep needs the exact service-role
 * bearer, checks live addresses, releases ones whose window ended, and keeps
 * going when one fails (an outage is never recorded as drift).
 */
import {
  DOMAIN_FAILURE_MESSAGES,
  type DomainDeps,
  handleBrandSiteDomainsRequest,
} from "../../brand-site-domains/index.ts";
import { DomainProviderError, type ProviderDomainState } from "../siteDomains.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const HOST = "bbbbbbbb-2222-4222-8222-222222222222";
const OP = "cccccccc-3333-4333-8333-333333333333";
const SERVICE_KEY = "service-role-fixture-key";
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

type RpcCall = { client: "user" | "service"; name: string; args: Record<string, unknown> };

function fakeCore(options: {
  user?: boolean;
  rpc?: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null }>;
  hosts?: Record<string, Record<string, unknown>>;
}) {
  const calls: RpcCall[] = [];
  const rpc = (client: "user" | "service") => async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ client, name, args });
    const handler = options.rpc?.[name];
    if (!handler) return { data: null, error: { message: `unexpected rpc ${name}` } };
    const result = handler(args);
    return { data: result.data ?? null, error: result.error ?? null };
  };
  const from = (table: string) => {
    assert(table === "brand_site_hosts", `unexpected table ${table}`);
    const filters: Record<string, string> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: async () => {
        const row = options.hosts?.[filters.id];
        return { data: row && row.site_id === filters.site_id ? row : null, error: null };
      },
    };
    return chain;
  };
  return {
    calls,
    clients: {
      user: {
        auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "user-1" } } }) },
        rpc: rpc("user"),
      },
      service: { rpc: rpc("service"), from },
    },
  };
}

function fakeProvider(overrides: Partial<{
  add: () => Promise<ProviderDomainState>;
  get: () => Promise<ProviderDomainState>;
}> = {}) {
  const removed: string[] = [];
  const state: ProviderDomainState = {
    verified: true,
    misconfigured: false,
    records: [{ type: "A", name: "brand.com", value: "203.0.113.7" }],
    verification: null,
    providerRef: "brand.com",
  };
  const deps: DomainDeps = {
    mode: "production",
    provider: {
      kind: "vercel",
      add: overrides.add ?? (() => Promise.resolve(state)),
      get: overrides.get ?? (() => Promise.resolve(state)),
      remove: (hostname) => {
        removed.push(hostname);
        return Promise.resolve();
      },
      certificate: () => Promise.resolve({ expiresAt: null }),
    },
    dns: { lookup: () => Promise.resolve([]) },
    probe: { probe: () => Promise.resolve(true) },
  };
  return { deps, removed };
}

function request(route: string, method: string, body: Record<string, unknown> = {}, bearer = "user-jwt") {
  return new Request("http://localhost/functions/v1/brand-site-domains", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ route, method, ...body }),
  });
}

const PENDING_HOST = {
  id: HOST, site_id: SITE, hostname: "brand.com", kind: "custom_domain", status: "pending",
  is_apex: true, provider_ref: null, redirect_until: null,
};

Deno.test("#2829 W8 routes refuse a request with no signed-in user", async () => {
  const core = fakeCore({ user: false });
  const response = await handleBrandSiteDomainsRequest(request(`/v1/sites/${SITE}/domains`, "GET"), { clients: core.clients, deps: null });
  assert(response.status === 403, `status ${response.status}`);
  assert(core.calls.length === 0, "nothing read");
});

Deno.test("#2829 W8 attach: name checked in the function, is_apex passed in, provider add, first check recorded", async () => {
  const core = fakeCore({
    hosts: { [HOST]: PENDING_HOST },
    rpc: {
      brand_site_domain_attach: () => ({ data: { host_id: HOST, status: "pending" } }),
      brand_site_domain_record_check: () => ({ data: { status: "active" } }),
      brand_site_domains_list: () => ({ data: { can_manage: true, hosts: [] } }),
    },
  });
  const { deps } = fakeProvider();
  const response = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains`, "POST", { hostname: "https://Brand.com/", operation_id: OP }),
    { clients: core.clients, deps },
  );
  assert(response.status === 201, `status ${response.status}`);
  const attach = core.calls.find((call) => call.name === "brand_site_domain_attach")!;
  assert(attach.client === "user", "attach runs as the user (rank-checked)");
  assert(attach.args.p_hostname === "brand.com" && attach.args.p_is_apex === true, JSON.stringify(attach.args));
  const check = core.calls.find((call) => call.name === "brand_site_domain_record_check")!;
  assert(check.client === "service" && check.args.p_dns_state === "ok", JSON.stringify(check));
  const verification = check.args.p_verification as Record<string, unknown>;
  assert(verification.probe_ok === true && Array.isArray(verification.records), "facts recorded");
});

Deno.test("#2829 W8 attach refuses a Mingla or malformed name before Core", async () => {
  const core = fakeCore({});
  for (const hostname of ["shop.usemingla.com", "brand.vercel.app", "co.uk", "not a domain"]) {
    const response = await handleBrandSiteDomainsRequest(
      request(`/v1/sites/${SITE}/domains`, "POST", { hostname, operation_id: OP }),
      { clients: core.clients, deps: fakeProvider().deps },
    );
    const body = await response.json();
    assert(response.status === 400 && body.error.code === "DOMAIN_INVALID", `${hostname}: ${JSON.stringify(body)}`);
  }
  assert(core.calls.length === 0, "nothing reached Core");
});

Deno.test("#2829 W8 attach with no provider configured creates nothing", async () => {
  const core = fakeCore({});
  const response = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains`, "POST", { hostname: "brand.com", operation_id: OP }),
    { clients: core.clients, deps: { ...fakeProvider().deps, provider: null } },
  );
  assert(response.status === 503, `status ${response.status}`);
  assert(core.calls.length === 0, "no host was created");
});

Deno.test("#2829 W8 a domain in use at another provider project is given back", async () => {
  const core = fakeCore({
    hosts: { [HOST]: PENDING_HOST },
    rpc: {
      brand_site_domain_attach: () => ({ data: { host_id: HOST } }),
      brand_site_domain_release: () => ({ data: { status: "retired" } }),
    },
  });
  const { deps } = fakeProvider({ add: () => Promise.reject(new DomainProviderError("domain_in_use")) });
  const response = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains`, "POST", { hostname: "brand.com", operation_id: OP }),
    { clients: core.clients, deps },
  );
  const body = await response.json();
  assert(response.status === 409 && body.error.code === "DOMAIN_IN_USE", JSON.stringify(body));
  const release = core.calls.find((call) => call.name === "brand_site_domain_release")!;
  assert(release.args.p_reason_code === "NEVER_LIVE" && release.args.p_host_id === HOST, "released as never live");
});

Deno.test("#2829 W8 Core refusals map to plain codes that never name a provider", async () => {
  for (const [message, code, status] of [
    ["sites_forbidden", "FORBIDDEN", 403],
    ["sites_domain_taken", "DOMAIN_TAKEN", 409],
    ["sites_domain_limit", "DOMAIN_LIMIT", 409],
    ["sites_domain_invalid", "DOMAIN_INVALID", 400],
    ["sites_invalid_state", "INVALID_STATE", 409],
  ] as const) {
    const core = fakeCore({ rpc: { brand_site_domain_attach: () => ({ error: { message } }) } });
    const response = await handleBrandSiteDomainsRequest(
      request(`/v1/sites/${SITE}/domains`, "POST", { hostname: "brand.com", operation_id: OP }),
      { clients: core.clients, deps: fakeProvider().deps },
    );
    const body = await response.json();
    assert(response.status === status && body.error.code === code, `${message}: ${JSON.stringify(body)}`);
  }
  for (const text of Object.values(DOMAIN_FAILURE_MESSAGES)) {
    assert(!/vercel|supabase|bunny|payload/i.test(text), `message names a provider: ${text}`);
  }
});

Deno.test("#2829 W8 Check now needs manage rights or a Mingla admin", async () => {
  const readOnly = fakeCore({
    hosts: { [HOST]: { ...PENDING_HOST, provider_ref: "brand.com" } },
    rpc: {
      brand_site_domains_list: () => ({ data: { can_manage: false } }),
      is_admin_user: () => ({ data: false }),
    },
  });
  const refused = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains/${HOST}/check`, "POST"),
    { clients: readOnly.clients, deps: fakeProvider().deps },
  );
  assert(refused.status === 403, `read-only check status ${refused.status}`);
  assert(!readOnly.calls.some((call) => call.name === "brand_site_domain_record_check"), "nothing recorded");
  const admin = fakeCore({
    hosts: { [HOST]: { ...PENDING_HOST, provider_ref: "brand.com" } },
    rpc: {
      brand_site_domains_list: () => ({ error: { message: "sites_forbidden" } }),
      is_admin_user: () => ({ data: true }),
      brand_site_domain_record_check: () => ({ data: { status: "active" } }),
    },
  });
  const allowed = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains/${HOST}/check`, "POST"),
    { clients: admin.clients, deps: fakeProvider().deps },
  );
  assert(allowed.status === 200, `admin recheck status ${allowed.status}`);
  // Another site's host id is not found through this site.
  const otherSite = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/dddddddd-4444-4444-8444-444444444444/domains/${HOST}/check`, "POST"),
    { clients: admin.clients, deps: fakeProvider().deps },
  );
  assert(otherSite.status === 404, `cross-site host status ${otherSite.status}`);
});

Deno.test("#2829 W8 a provider outage during Check now is not recorded", async () => {
  const core = fakeCore({
    hosts: { [HOST]: { ...PENDING_HOST, status: "active", provider_ref: "brand.com" } },
    rpc: { brand_site_domains_list: () => ({ data: { can_manage: true } }) },
  });
  const { deps } = fakeProvider({ get: () => Promise.reject(new DomainProviderError("provider_unavailable")) });
  const response = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains/${HOST}/check`, "POST"),
    { clients: core.clients, deps },
  );
  const body = await response.json();
  assert(response.status === 503 && body.error.code === "CHECK_UNAVAILABLE", JSON.stringify(body));
  assert(!core.calls.some((call) => call.name === "brand_site_domain_record_check"), "no drift recorded on outage");
});

Deno.test("#2829 W8 detach of a never-live address removes and releases it", async () => {
  const core = fakeCore({
    hosts: { [HOST]: { ...PENDING_HOST, provider_ref: "brand.com" } },
    rpc: {
      brand_site_domain_detach: () => ({ data: { status: "pending", release_now: true } }),
      brand_site_domain_release: () => ({ data: { status: "retired" } }),
    },
  });
  const { deps, removed } = fakeProvider();
  const response = await handleBrandSiteDomainsRequest(
    request(`/v1/sites/${SITE}/domains/${HOST}`, "DELETE", { operation_id: OP }),
    { clients: core.clients, deps },
  );
  assert(response.status === 200, `status ${response.status}`);
  assert(core.calls.find((call) => call.name === "brand_site_domain_detach")?.client === "user", "detach is rank-checked");
  assert(removed.includes("brand.com"), "removed at the provider");
  assert(core.calls.find((call) => call.name === "brand_site_domain_release")?.args.p_reason_code === "NEVER_LIVE", "released");
});

Deno.test("#2829 W8 the sweep needs the exact service-role bearer", async () => {
  for (const bearer of ["user-jwt", `${SERVICE_KEY}x`, ""]) {
    const core = fakeCore({});
    const response = await handleBrandSiteDomainsRequest(
      new Request("http://localhost/functions/v1/brand-site-domains/internal/v1/domains/sweep", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}` },
        body: "{}",
      }),
      { clients: core.clients, deps: fakeProvider().deps },
    );
    assert(response.status === 403, `bearer ${bearer}: ${response.status}`);
  }
  // Nor can a user reach it through the routed body.
  const core = fakeCore({});
  const routed = await handleBrandSiteDomainsRequest(
    request("/internal/v1/domains/sweep", "POST"),
    { clients: core.clients, deps: fakeProvider().deps },
  );
  assert(routed.status === 403, `routed sweep ${routed.status}`);
});

Deno.test("#2829 W8 the sweep checks live addresses, releases ended windows, survives one failure", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const core = fakeCore({
    rpc: {
      brand_site_domains_due: () => ({
        data: [
          { host_id: HOST, site_id: SITE, hostname: "brand.com", status: "active", is_apex: true, redirect_until: null, provider_ref: "brand.com" },
          { host_id: "eeeeeeee-5555-4555-8555-555555555555", site_id: SITE, hostname: "gone.com", status: "detaching", is_apex: true, redirect_until: past, provider_ref: "gone.com" },
          { host_id: "ffffffff-6666-4666-8666-666666666666", site_id: SITE, hostname: "later.com", status: "detaching", is_apex: true, redirect_until: future, provider_ref: "later.com" },
          { host_id: "99999999-7777-4777-8777-777777777777", site_id: SITE, hostname: "broken.com", status: "active", is_apex: true, redirect_until: null, provider_ref: "broken.com" },
        ],
      }),
      brand_site_domain_record_check: () => ({ data: { status: "active" } }),
      brand_site_domain_release: () => ({ data: { status: "retired" } }),
    },
  });
  const { deps, removed } = fakeProvider({
    get: () => Promise.resolve({ verified: true, misconfigured: false, records: [], verification: null, providerRef: "x" }),
  });
  const originalGet = deps.provider!.get;
  deps.provider!.get = (hostname, isApex) =>
    hostname === "broken.com" ? Promise.reject(new DomainProviderError("provider_unavailable")) : originalGet(hostname, isApex);
  const response = await handleBrandSiteDomainsRequest(
    new Request("http://localhost/functions/v1/brand-site-domains/internal/v1/domains/sweep", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }),
    { clients: core.clients, deps },
  );
  const body = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  assert(JSON.stringify(body.data) === JSON.stringify({ checked: 1, released: 1, failed: 1, skipped: 1 }), JSON.stringify(body.data));
  assert(removed.length === 1 && removed[0] === "gone.com", `removed ${removed}`);
  const recorded = core.calls.filter((call) => call.name === "brand_site_domain_record_check").map((call) => call.args.p_host_id);
  assert(recorded.length === 1 && recorded[0] === HOST, "only the healthy check recorded; the outage was not");
});
