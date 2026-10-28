// deno-lint-ignore-file require-await -- fakes mirror async APIs
/*
 * #2829 W8 (AD-10, T-W8) — custom domain building blocks (no network).
 *
 * Proves: name rules (public-suffix apex detection, Mingla and provider
 * domains refused, reserved test names only locally, pasted URLs forgiven);
 * the production provider adapter against a RECORDED-SHAPE mock of the
 * provider's REST API (paths, auth, team scoping, verification attempt,
 * recommended records, TXT challenge, 409 in use, outage); the local provider
 * contract; DNS-over-HTTPS needs two agreeing resolvers; the site-id probe
 * (exact hash, no redirect); TLS expiry; one full check; and the DNS guides
 * (registrar detection, exact values, never naming Mingla's providers, never
 * asking for MX/NS changes).
 *
 * Per the repo lesson that a mocked external API can hide a rejected query,
 * the recorded shapes are from the provider's public REST docs; ONE manual
 * read-only call is made after merge with Seth's go-ahead and recorded on
 * #2829 (spec §10 T-W8).
 */
import {
  checkDomain,
  classifyCustomHostname,
  DohDnsResolver,
  DomainProviderError,
  FALLBACK_APEX_IPV4,
  HttpsSiteProbe,
  LocalDomainProvider,
  LocalSiteProbe,
  publicSuffixOf,
  registrableDomain,
  routingRecord,
  siteIdHash,
  tlsStateFrom,
  VercelDomainProvider,
} from "../siteDomains.ts";
import { detectRegistrar, dnsGuide, recordHostLabel } from "../siteContracts/dnsGuides.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";

Deno.test("#2829 W8 public suffix and apex detection", () => {
  eq(publicSuffixOf("www.shop.co.uk"), "co.uk", "co.uk suffix");
  eq(publicSuffixOf("brand.com"), "com", "com suffix");
  eq(registrableDomain("www.shop.co.uk"), "shop.co.uk", "registrable co.uk");
  eq(registrableDomain("a.b.brand.com.ng"), "brand.com.ng", "registrable com.ng");
  eq(registrableDomain("co.uk"), null, "a public suffix is not registrable");
  const apex = classifyCustomHostname("youngandstamped.com", { local: false });
  assert(apex.ok && apex.isApex && apex.apex === "youngandstamped.com", "apex");
  const www = classifyCustomHostname("www.youngandstamped.com", { local: false });
  assert(www.ok && !www.isApex && www.apex === "youngandstamped.com", "www is a subdomain");
  const uk = classifyCustomHostname("shop.co.uk", { local: false });
  assert(uk.ok && uk.isApex, "shop.co.uk is an apex");
  const ukSub = classifyCustomHostname("www.shop.co.uk", { local: false });
  assert(ukSub.ok && !ukSub.isApex, "www.shop.co.uk is a subdomain");
});

Deno.test("#2829 W8 name refusals: shape, Mingla and provider domains, reserved names", () => {
  const refused: Array<[string, string]> = [
    ["co.uk", "public_suffix"],
    ["com", "shape"],
    ["10.0.0.1", "ip_address"],
    ["brand.com:8443", "shape"],
    ["user@brand.com", "shape"],
    ["*.brand.com", "shape"],
    ["under_score.com", "shape"],
    ["shop.usemingla.com", "mingla_domain"],
    ["gogi.sites.usemingla.com", "mingla_domain"],
    ["mingla.app", "mingla_domain"],
    ["brand.vercel.app", "mingla_domain"],
    ["x.supabase.co", "mingla_domain"],
    ["vz-1.b-cdn.net", "mingla_domain"],
    ["youngandstamped.sites.localhost", "mingla_domain"],
    ["youngandstamped.test", "reserved_name"],
    ["brand.local", "reserved_name"],
    ["brand.example", "reserved_name"],
  ];
  for (const [name, reason] of refused) {
    const result = classifyCustomHostname(name, { local: false });
    assert(!result.ok && result.reason === reason, `${name} -> ${JSON.stringify(result)}`);
  }
  // A developer's local stack may attach a .test name (and only .test).
  const local = classifyCustomHostname("youngandstamped.test", { local: true });
  assert(local.ok && local.isApex, "local .test apex");
  assert(!classifyCustomHostname("brand.local", { local: true }).ok, ".local refused locally too");
  // A pasted URL is forgiven; case and trailing dot normalised.
  const pasted = classifyCustomHostname(" https://WWW.Brand.com/about?x=1 ", { local: false });
  assert(pasted.ok && pasted.hostname === "www.brand.com", "pasted URL");
  const dotted = classifyCustomHostname("brand.com.", { local: false });
  assert(dotted.ok && dotted.hostname === "brand.com", "trailing dot");
});

type Call = { method: string; url: string; auth: string | null; body: unknown; redirect: string | undefined };

function recordedProviderApi(options: {
  addStatus?: number;
  verified?: boolean;
  verifyStatus?: number;
  misconfigured?: boolean;
  status5xx?: boolean;
  getStatus?: number;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    calls.push({
      method: init.method ?? "GET",
      url: input,
      auth: new Headers(init.headers).get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : null,
      redirect: init.redirect,
    });
    if (options.status5xx) return new Response("{}", { status: 502 });
    const domainShape = (name: string, verified: boolean) => ({
      apexName: "brand.com",
      name,
      projectId: "prj_fixture",
      verified,
      createdAt: 1,
      updatedAt: 1,
      verification: verified ? [] : [{
        type: "TXT", domain: `_vercel.${name}`, value: "vc-domain-verify=fixture", reason: "pending_domain_verification",
      }],
    });
    if (url.pathname === "/v10/projects/prj_fixture/domains" && init.method === "POST") {
      const status = options.addStatus ?? 200;
      if (status !== 200) return Response.json({ error: { code: "x", message: "x" } }, { status });
      return Response.json(domainShape((init.body && JSON.parse(String(init.body)).name) as string, options.verified ?? false));
    }
    if (url.pathname.startsWith("/v9/projects/prj_fixture/domains/") && url.pathname.endsWith("/verify")) {
      const status = options.verifyStatus ?? 400;
      if (status !== 200) return Response.json({ error: { code: "missing_txt_record" } }, { status });
      return Response.json(domainShape(decodeURIComponent(url.pathname.split("/")[5]), true));
    }
    if (url.pathname.startsWith("/v9/projects/prj_fixture/domains/") && init.method === "DELETE") {
      return Response.json({});
    }
    if (url.pathname.startsWith("/v9/projects/prj_fixture/domains/")) {
      const status = options.getStatus ?? 200;
      if (status !== 200) return Response.json({ error: { code: "not_found" } }, { status });
      return Response.json(domainShape(decodeURIComponent(url.pathname.split("/")[5]), options.verified ?? false));
    }
    if (url.pathname.startsWith("/v6/domains/") && url.pathname.endsWith("/config")) {
      return Response.json({
        acceptedChallenges: ["http-01"],
        configuredBy: options.misconfigured === false ? "A" : null,
        misconfigured: options.misconfigured ?? true,
        recommendedIPv4: [{ rank: 2, value: ["198.51.100.9"] }, { rank: 1, value: ["203.0.113.7"] }],
        recommendedCNAME: [{ rank: 1, value: "fixture-target.example-provider.net." }],
      });
    }
    if (url.pathname === "/v8/certs") {
      return Response.json({
        certs: [
          { id: "cert_a", cns: ["brand.com", "www.brand.com"], expiresAt: Date.parse("2027-02-01T00:00:00Z"), createdAt: 1, autoRenew: true },
          { id: "cert_b", cns: ["other.com"], expiresAt: Date.parse("2026-11-01T00:00:00Z"), createdAt: 1, autoRenew: true },
        ],
        pagination: { count: 2, next: null, prev: null },
      });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, fetchImpl };
}

function provider(api: ReturnType<typeof recordedProviderApi>) {
  return new VercelDomainProvider({ token: "tok_fixture", projectId: "prj_fixture", teamId: "team_fixture", fetch: api.fetchImpl });
}

Deno.test("#2829 W8 provider adapter: add returns exact records and the TXT challenge", async () => {
  const api = recordedProviderApi();
  const state = await provider(api).add("brand.com", true);
  eq(state.verified, false, "not verified yet");
  eq(state.misconfigured, true, "not configured yet");
  eq(state.records, [
    { type: "A", name: "brand.com", value: "203.0.113.7" },
    { type: "TXT", name: "_vercel.brand.com", value: "vc-domain-verify=fixture" },
  ], "records from the rank-1 recommendation");
  eq(state.verification?.type, "TXT", "challenge kept");
  for (const call of api.calls) {
    assert(call.url.startsWith("https://api.vercel.com/"), `fixed API origin: ${call.url}`);
    assert(new URL(call.url).searchParams.get("teamId") === "team_fixture", `team scoped: ${call.url}`);
    eq(call.auth, "Bearer tok_fixture", "bearer token");
    eq(call.redirect, "manual", "redirects never followed");
  }
  eq(api.calls[0].method, "POST", "add is a POST");
  eq(new URL(api.calls[0].url).pathname, "/v10/projects/prj_fixture/domains", "add path");
  eq(api.calls[0].body, { name: "brand.com" }, "add body");
  assert(api.calls.some((call) => new URL(call.url).pathname === "/v6/domains/brand.com/config" &&
    new URL(call.url).searchParams.get("projectIdOrName") === "prj_fixture"), "config read for the project");
});

Deno.test("#2829 W8 provider adapter: a subdomain gets a CNAME; no recommendation -> fallback", async () => {
  const state = await provider(recordedProviderApi()).add("www.brand.com", false);
  eq(state.records[0], { type: "CNAME", name: "www.brand.com", value: "fixture-target.example-provider.net" }, "CNAME target");
  eq(routingRecord("brand.com", true, null), { type: "A", name: "brand.com", value: FALLBACK_APEX_IPV4 }, "apex fallback");
});

Deno.test("#2829 W8 provider adapter: get attempts verification; in use, refused and outage are typed", async () => {
  const unverified = recordedProviderApi({ verified: false, verifyStatus: 200, misconfigured: false });
  const state = await provider(unverified).get("brand.com", true);
  assert(unverified.calls.some((call) => call.method === "POST" && call.url.includes("/v9/projects/prj_fixture/domains/brand.com/verify")), "verify attempted");
  eq(state.verified, true, "verified after the attempt");
  eq(state.misconfigured, false, "configured");
  const missing = await provider(recordedProviderApi({ getStatus: 404 })).get("brand.com", true);
  eq([missing.verified, missing.misconfigured], [false, true], "a domain the provider lost is waiting");
  for (const [options, code] of [
    [{ addStatus: 409 }, "domain_in_use"],
    [{ addStatus: 403 }, "provider_refused"],
    [{ status5xx: true }, "provider_unavailable"],
  ] as const) {
    let thrown: unknown = null;
    try {
      await provider(recordedProviderApi(options)).add("brand.com", true);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof DomainProviderError && thrown.code === code, `${JSON.stringify(options)} -> ${code}`);
  }
  let missingCredentials = false;
  try {
    new VercelDomainProvider({ token: "", projectId: "p", teamId: "t" });
  } catch (error) {
    missingCredentials = error instanceof DomainProviderError && error.code === "provider_unavailable";
  }
  assert(missingCredentials, "no credentials -> unavailable");
});

Deno.test("#2829 W8 provider adapter: certificate expiry for exactly this host; removal", async () => {
  const api = recordedProviderApi();
  eq(await provider(api).certificate("www.brand.com"), { expiresAt: "2027-02-01T00:00:00.000Z" }, "cert for host");
  eq(await provider(api).certificate("nobody.com"), { expiresAt: null }, "no cert");
  await provider(api).remove("brand.com");
  assert(api.calls.some((call) => call.method === "DELETE" && new URL(call.url).pathname === "/v9/projects/prj_fixture/domains/brand.com"), "remove path");
});

function localDb(rows: Record<string, Record<string, unknown>>) {
  return {
    from: (table: string) => {
      assert(table === "brand_site_local_domain_states", `only the local control table: ${table}`);
      let host = "";
      const chain = {
        select: () => chain,
        eq: (_column: string, value: string) => {
          host = value;
          return chain;
        },
        maybeSingle: async () => ({ data: rows[host] ?? null, error: null }),
      };
      return chain;
    },
  };
}

Deno.test("#2829 W8 local provider contract: deterministic from the control table", async () => {
  const db = localDb({
    "youngandstamped.test": { hostname: "youngandstamped.test", verified: true, misconfigured: false, require_txt: false, tls_expires_at: null, ns: ["dns1.registrar-servers.com"], mx: ["mx.mail.test"] },
  });
  const local = new LocalDomainProvider(db);
  const live = await local.get("youngandstamped.test", true);
  eq([live.verified, live.misconfigured, live.records[0].type], [true, false, "A"], "live row");
  const waiting = await local.add("other.test", true);
  eq([waiting.verified, waiting.misconfigured], [false, true], "no row = waiting for DNS");
});

Deno.test("#2829 W8 DNS over HTTPS needs two agreeing resolvers", async () => {
  const answers: Record<string, unknown> = {
    "https://a.test/dns": { Status: 0, Answer: [{ type: 15, data: "10 MX1.Mail.Example." }, { type: 15, data: "20 mx2.mail.example." }] },
    "https://b.test/dns": { Status: 0, Answer: [{ type: 15, data: "20 mx2.mail.example." }, { type: 15, data: "10 mx1.mail.example" }] },
  };
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    eq(new Headers(init.headers).get("accept"), "application/dns-json", "DoH JSON");
    return Response.json(answers[input.split("?")[0]]);
  };
  const agreeing = new DohDnsResolver(fetchImpl, ["https://a.test/dns", "https://b.test/dns"]);
  eq(await agreeing.lookup("brand.com", "MX"), ["mx1.mail.example", "mx2.mail.example"], "agreeing MX");
  answers["https://b.test/dns"] = { Status: 0, Answer: [{ type: 15, data: "10 evil.example." }] };
  eq(await agreeing.lookup("brand.com", "MX"), null, "disagreement is unknown");
  answers["https://a.test/dns"] = { Status: 3 };
  answers["https://b.test/dns"] = { Status: 3 };
  eq(await agreeing.lookup("brand.com", "MX"), [], "NXDOMAIN on both = none");
  const failing = new DohDnsResolver(async () => new Response("x", { status: 500 }), ["https://a.test/dns", "https://b.test/dns"]);
  eq(await failing.lookup("brand.com", "NS"), null, "a failing resolver is unknown");
});

Deno.test("#2829 W8 site-id probe: exact hash, no redirects, local forwarding header", async () => {
  const hash = await siteIdHash(SITE);
  assert(/^[0-9a-f]{16}$/.test(hash), "16 hex");
  const seen: Array<{ url: string; host: string | null; redirect?: string }> = [];
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    seen.push({ url: input, host: new Headers(init.headers).get("x-forwarded-host"), redirect: init.redirect });
    return input.includes("good") || new Headers(init.headers).get("x-forwarded-host") === "good.test"
      ? Response.json({ site: hash })
      : Response.json({ site: "0000000000000000" });
  };
  const https = new HttpsSiteProbe(fetchImpl);
  eq(await https.probe("good.com", hash), true, "matching hash");
  eq(await https.probe("other.com", hash), false, "other site's hash");
  eq(seen[0].url, "https://good.com/.well-known/mingla-site", "https probe URL");
  eq(seen[0].redirect, "manual", "no redirect followed");
  const redirecting = new HttpsSiteProbe(async () => new Response(null, { status: 308, headers: { location: "https://good.com/" } }));
  eq(await redirecting.probe("good.com", hash), false, "a redirect never passes");
  const local = new LocalSiteProbe("http://host.docker.internal:3100", fetchImpl);
  eq(await local.probe("good.test", hash), true, "local probe");
  eq(seen.at(-1), { url: "http://host.docker.internal:3100/.well-known/mingla-site", host: "good.test", redirect: "manual" }, "local probe target");
});

Deno.test("#2829 W8 TLS state", () => {
  const now = Date.parse("2026-10-26T00:00:00Z");
  eq(tlsStateFrom({ dnsOk: false, probeOk: false, certExpiresAt: null, now }), "pending", "no DNS");
  eq(tlsStateFrom({ dnsOk: true, probeOk: true, certExpiresAt: "2027-01-01T00:00:00Z", now }), "issued", "issued");
  eq(tlsStateFrom({ dnsOk: true, probeOk: true, certExpiresAt: "2026-11-05T00:00:00Z", now }), "expiring", "expiring within 14 days");
  eq(tlsStateFrom({ dnsOk: true, probeOk: false, certExpiresAt: null, now }), "pending", "securing");
});

Deno.test("#2829 W8 one check composes the facts the SQL records", async () => {
  const hash = await siteIdHash(SITE);
  const facts = await checkDomain({
    provider: {
      kind: "local",
      add: () => Promise.reject(new Error("unused")),
      get: () => Promise.resolve({ verified: true, misconfigured: false, records: [{ type: "A", name: "www.brand.com", value: "203.0.113.7" }], verification: null, providerRef: "www.brand.com" }),
      remove: () => Promise.resolve(),
      certificate: () => Promise.resolve({ expiresAt: "2027-06-01T00:00:00.000Z" }),
    },
    dns: { lookup: (name, type) => Promise.resolve(name === "brand.com" ? (type === "NS" ? ["ns1.domaincontrol.com"] : ["mx.mail.example"]) : null) },
    probe: { probe: (_host, expected) => Promise.resolve(expected === hash) },
  }, { hostname: "www.brand.com", isApex: false, siteId: SITE }, Date.parse("2026-10-26T00:00:00Z"));
  eq(facts.dnsState, "ok", "dns ok");
  eq(facts.tlsState, "issued", "tls issued");
  eq(facts.verification.registrar, "godaddy", "registrar from the apex NS");
  eq(facts.verification.mx, ["mx.mail.example"], "MX of the apex");
  eq(facts.verification.probe_ok, true, "probe");
  // Unknown DNS: no registrar key, mx null (never raises or clears a warning).
  const unknown = await checkDomain({
    provider: { kind: "local", add: () => Promise.reject(new Error("x")), get: () => Promise.resolve({ verified: false, misconfigured: true, records: [], verification: null, providerRef: null }), remove: () => Promise.resolve(), certificate: () => Promise.reject(new Error("must not read a cert before DNS")) },
    dns: { lookup: () => Promise.resolve(null) },
    probe: { probe: () => Promise.reject(new Error("must not probe before DNS")) },
  }, { hostname: "brand.com", isApex: true, siteId: SITE });
  eq([unknown.dnsState, unknown.verification.mx, "registrar" in unknown.verification], ["pending", null, false], "unknown DNS");
});

Deno.test("#2829 W8 DNS guides: registrar detection, exact values, provider-neutral, never MX/NS", () => {
  eq(detectRegistrar(["anna.ns.cloudflare.com.", "bob.ns.cloudflare.com"]), "cloudflare", "cloudflare");
  eq(detectRegistrar(["ns09.domaincontrol.com"]), "godaddy", "godaddy");
  eq(detectRegistrar(["ns-cloud-a1.googledomains.com"]), "squarespace", "former Google Domains");
  eq(detectRegistrar(["ns1.wixdns.net"]), "wix", "wix");
  eq(detectRegistrar(["ns1045.ui-dns.de"]), "ionos", "ionos");
  eq(detectRegistrar(["dns1.registrar-servers.com"]), "namecheap", "namecheap");
  eq(detectRegistrar(["ns1.someother.net"]), "unknown", "unknown");
  eq(detectRegistrar([]), "unknown", "none");
  eq(recordHostLabel("brand.com", "brand.com"), "@", "apex label");
  eq(recordHostLabel("www.brand.com", "brand.com"), "www", "www label");
  eq(recordHostLabel("_vercel.brand.com", "brand.com"), "_vercel", "txt label");
  for (const registrar of ["cloudflare", "godaddy", "squarespace", "wix", "ionos", "namecheap", "unknown"] as const) {
    const guide = dnsGuide({
      registrar,
      apexDomain: "brand.com",
      records: [
        { type: "A", name: "brand.com", value: "203.0.113.7" },
        { type: "CNAME", name: "www.brand.com", value: "fixture-target.example.net" },
      ],
    });
    const text = [...guide.steps, ...guide.notes].join("\n");
    assert(text.includes("203.0.113.7") && text.includes("fixture-target.example.net"), `${registrar}: exact values`);
    assert(text.includes("Type: A") && text.includes("Type: CNAME"), `${registrar}: record types`);
    assert(!/vercel|supabase|bunny|payload/i.test(text), `${registrar}: names an infrastructure provider`);
    assert(!/change (your )?(mx|nameserver)/i.test(text) && /Leave your email \(MX\)/.test(text), `${registrar}: MX/NS left alone`);
  }
  assert(dnsGuide({ registrar: "cloudflare", apexDomain: "brand.com", records: [] }).steps.some((step) => step.includes("DNS only")), "cloudflare proxy step");
});
