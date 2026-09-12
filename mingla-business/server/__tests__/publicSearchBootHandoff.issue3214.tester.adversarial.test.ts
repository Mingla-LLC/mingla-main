// #3214 — INDEPENDENT TESTER ADVERSARIAL suite. Different angle, on purpose.
//
// The implementor's suite proves the policy admits a RECORDED list of sources
// (`OBSERVED_SOURCES`, hard-coded from a Playwright recording of real flows) and
// that those flows produce zero violations. That design can only ever confirm
// what somebody already exercised, and #3234 is the proof: on a real cold load
// of /b/gogilagos the booted app makes three refused attempts to open
//
//     wss://<project>.supabase.co/realtime/v1/websocket?...
//
// while the implementor's policy test reported zero violations. The reason is
// structural, not an oversight of diligence:
//
//   1. The realtime endpoint has NO LITERAL ANYWHERE IN THE SHIPPED BUNDLE.
//      @supabase/supabase-js builds it at runtime from the HTTPS url — the
//      exported chunk contains exactly:
//          this.realtimeUrl = new URL("realtime/v1", <supabase url>);
//          this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace("http","ws")
//      so neither a recording that never subscribed, nor a grep of the export
//      for URL literals, can discover it.
//   2. The policy was reviewed as a STRING. `connect-src ... https://host` reads
//      as "the Supabase project is allowed", and the fact that it does not admit
//      `wss://host` is invisible unless you evaluate the policy as a DECISION
//      FUNCTION over a concrete request.
//
// So this suite does two things the implementor's cannot:
//
//   A. It implements CSP source-list matching (scheme / host / port + the CSP3
//      fallback chains) and pins its semantics with a known-answer table, so the
//      "https:// does not admit wss://" rule is asserted explicitly rather than
//      assumed. The browser is the oracle for that rule; the Playwright half of
//      this suite (issue3214-public-boot-order.tester.adversarial.spec.ts)
//      measures it against real Chromium so this table can never drift into
//      being a comfortable fiction.
//   B. It DERIVES the endpoints the app must reach from the same inputs the app
//      derives them from (the server's own SUPABASE_URL, plus the documented
//      client construction above) instead of remembering them, and requires each
//      derived endpoint to be either permitted by the policy or listed in
//      KNOWN_UNMET with the issue that owns the gap. KNOWN_UNMET is an EXACT-SET
//      ratchet: a new gap is red (nobody can quietly add one) and a FIXED gap is
//      also red (nobody can leave a stale exemption behind).
//
// Plus adversarial input attacks on the boot-outcome relay that target object
// shape rather than field values: prototype-borrowed keys, which is where a
// `REASONS[body.outcome]` lookup on an attacker-chosen string can go wrong.

/* eslint-disable @typescript-eslint/no-require-imports */
const doc = require("../publicSearchDocument") as {
  publicDocumentCsp: () => string;
  publicDocumentCspSources: () => Array<[string, string, string]>;
};
const { SUPABASE_URL } = require("../supabaseRpc") as { SUPABASE_URL: string };
const relay = require("../../api/public-boot-outcome.js") as ((req: unknown, res: unknown) => Promise<unknown>) & {
  createPublicBootOutcomeHandler: (send?: unknown) => (req: unknown, res: unknown) => Promise<unknown>;
};

const PUBLIC_ORIGIN = "https://host.usemingla.com";

// ---------------------------------------------------------------------------
// A. CSP source-list matching, as a decision function.
// ---------------------------------------------------------------------------

type Policy = Map<string, string[]>;

const parsePolicy = (csp: string): Policy =>
  new Map(
    csp
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name.toLowerCase(), sources] as [string, string[]];
      }),
  );

// CSP3 fallback chains. worker-src falls back through child-src AND script-src
// before default-src, which is why "the policy has no worker-src" is not the
// same question as "a worker is refused".
const FALLBACK: Record<string, string[]> = {
  "connect-src": ["connect-src", "default-src"],
  "script-src": ["script-src", "default-src"],
  "worker-src": ["worker-src", "child-src", "script-src", "default-src"],
  "frame-src": ["frame-src", "child-src", "default-src"],
  "font-src": ["font-src", "default-src"],
  "media-src": ["media-src", "default-src"],
  "img-src": ["img-src", "default-src"],
};

/** The source list that actually governs `directive`, after fallback. */
const governing = (policy: Policy, directive: string): { from: string; sources: string[] } => {
  for (const name of FALLBACK[directive] ?? [directive, "default-src"]) {
    const sources = policy.get(name);
    if (sources) return { from: name, sources };
  }
  return { from: "(absent)", sources: [] };
};

/**
 * Does `source` match `url`?
 *
 * Scheme handling is deliberately SCHEME-FOR-SCHEME for host-sources: an
 * expression of `https://h` matches an `https://h/...` request and does NOT
 * match `wss://h/...`. That is the measured behaviour of the browser this ships
 * to — proven live (#3234: Chrome refused the wss socket against a policy whose
 * connect-src listed that exact host as https) and re-measured against Chromium
 * by this suite's Playwright half. It is asserted below as a known-answer table
 * so that a future relaxation of this helper cannot silently make the audit
 * vacuous.
 */
// blob:, data: and filesystem: are opaque: CSP requires them BY NAME and 'self'
// never covers them. This is a trap worth stating, because a blob: URL carries
// its creating origin inside it — `new URL("blob:https://host/x").origin` is
// "https://host", so an origin comparison quietly says "same origin, allowed"
// while the browser refuses it. That is precisely the mistake this suite exists
// to catch, made one layer down.
const OPAQUE_SCHEMES = new Set(["blob:", "data:", "filesystem:"]);

const matchesSource = (source: string, url: URL, self: URL): boolean => {
  if (source === "'none'") return false;
  const scheme = url.protocol.toLowerCase();
  if (OPAQUE_SCHEMES.has(scheme)) return source.toLowerCase() === scheme;
  if (source === "'self'") return url.origin === self.origin;
  if (source.startsWith("'")) return false; // 'unsafe-inline' etc. never match a URL
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return scheme === source.toLowerCase();
  const expression = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i.exec(source);
  if (!expression) return false;
  const [, expressionScheme, rest] = expression;
  if (scheme !== `${expressionScheme.toLowerCase()}:`) return false;
  const [hostPart, portPart] = rest.split(":");
  const host = url.hostname.toLowerCase();
  const expected = hostPart.toLowerCase();
  const hostOk = expected.startsWith("*.") ? host.endsWith(expected.slice(1)) : host === expected;
  if (!hostOk) return false;
  if (portPart && portPart !== "*") return url.port === portPart;
  return true;
};

const permits = (policy: Policy, directive: string, target: string, self = new URL(PUBLIC_ORIGIN)): boolean => {
  const url = new URL(target);
  const { sources } = governing(policy, directive);
  return sources.some((source) => matchesSource(source, url, self));
};

// ---------------------------------------------------------------------------
// B. The endpoints the app must reach, DERIVED rather than recalled.
// ---------------------------------------------------------------------------

const supabaseHttp = new URL(SUPABASE_URL);

/**
 * Replicates @supabase/supabase-js's own realtime-endpoint construction, which
 * is what the shipped chunk does. Deriving it here is the whole point: there is
 * no `wss://` string in the export to find.
 */
const derivedRealtimeEndpoint = (): string => {
  const realtime = new URL("realtime/v1", supabaseHttp);
  realtime.protocol = realtime.protocol.replace("http", "ws");
  return `${realtime.origin}${realtime.pathname}/websocket`;
};

type Derived = { directive: string; url: string; what: string };

const DERIVED_ENDPOINTS: Derived[] = [
  { directive: "connect-src", url: `${supabaseHttp.origin}/rest/v1/business_public_brands_view`, what: "public page data (PostgREST)" },
  { directive: "connect-src", url: `${supabaseHttp.origin}/rest/v1/rpc/resolve_public_search_document`, what: "public RPCs" },
  { directive: "connect-src", url: `${supabaseHttp.origin}/functions/v1/static-map`, what: "edge functions (static map proxy, stripe-mode)" },
  { directive: "connect-src", url: `${supabaseHttp.origin}/storage/v1/object/public/covers/x.jpg`, what: "storage reads" },
  { directive: "connect-src", url: derivedRealtimeEndpoint(), what: "realtime socket (supabase-js swaps http->ws at runtime)" },
  { directive: "connect-src", url: `${PUBLIC_ORIGIN}/api/public-boot-outcome`, what: "this issue's own boot-outcome beacon" },
  { directive: "connect-src", url: `${PUBLIC_ORIGIN}/api/content-share-analytics`, what: "#3187's share-analytics relay" },
  { directive: "connect-src", url: `${PUBLIC_ORIGIN}/index.html`, what: "the handoff's own bootstrap fetch" },
  { directive: "script-src", url: `${PUBLIC_ORIGIN}/_expo/static/js/web/index-deadbeef.js`, what: "the injected Expo chunks" },
  { directive: "font-src", url: `${PUBLIC_ORIGIN}/assets/node_modules/@expo-google-fonts/inter/Inter_500Medium.ttf`, what: "theme fonts, loaded from the bundle by Font.loadAsync" },
  { directive: "media-src", url: "https://vz-a16fce08-6c6.b-cdn.net/guid/play_720p.mp4", what: "Bunny Stream cover video" },
  { directive: "img-src", url: `${supabaseHttp.origin}/storage/v1/object/public/covers/x.jpg`, what: "cover and gallery images" },
  { directive: "frame-src", url: "https://js.stripe.com/v3/", what: "Stripe controller / Element frames" },
  // PostHog session replay is ENABLED in source (`disable_session_recording:
  // false` with a `session_recording` block, webAnalytics.web.ts), and its
  // recorder compresses in a worker built from a Blob — the export carries
  // `new Worker(URL.createObjectURL(new Blob([...])))` and `importScripts(`.
  { directive: "worker-src", url: "blob:https://host.usemingla.com/replay-worker", what: "PostHog session-replay compression worker" },
];

/**
 * Gaps that exist on merged main, each owned by an issue. EXACT SET: adding an
 * entry without review turns this red, and so does leaving an entry behind once
 * the policy admits it.
 */
const KNOWN_UNMET: Array<{ url: string; issue: string; why: string }> = [
  // [TEST-MOD-APPROVED #3251] The #3234 realtime entry is REMOVED, not edited.
  // This list is an exact set and its own docblock requires an entry to leave
  // once the policy admits the URL — #3251 added the `wss://` connect-src
  // source (publicSearchDocument.js `supabaseRealtimeOrigin()`), so
  // `derivedRealtimeEndpoint()` is now permitted and must assert as MET by
  // DERIVED_ENDPOINTS above. Leaving the entry here would red this lane.
  //
  // Invalidated assertion, named per the pinned-contract rule: "the wss://
  // realtime socket is refused" is no longer true of merged main. What that
  // entry documented was not merely dead realtime — the refusal threw
  // synchronously in WebKit and white-screened every signed-in Safari visitor
  // to a public page (#3251).
  {
    url: "blob:https://host.usemingla.com/replay-worker",
    issue: "#3214",
    why: "No worker-src/child-src/script-src source admits blob:, so worker creation falls through to default-src 'none'. PostHog session replay is enabled and its recorder compresses in a Blob worker. Found by this tester suite; awaiting its own issue.",
  },
];

describe("#3214 tester adversarial — the policy is a decision function, not a string", () => {
  const csp = doc.publicDocumentCsp();
  const policy = parsePolicy(csp);

  it("the matcher can tell wss:// from https://, or this whole audit is vacuous", () => {
    const self = new URL(PUBLIC_ORIGIN);
    const host = "https://example.test";
    const one = parsePolicy(`default-src 'none'; connect-src 'self' ${host}; img-src https:`);

    // The exact rule #3234 turns on.
    expect(permits(one, "connect-src", `${host}/x`, self)).toBe(true);
    expect(permits(one, "connect-src", "wss://example.test/x", self)).toBe(false);
    expect(permits(one, "connect-src", "ws://example.test/x", self)).toBe(false);

    // 'self' is origin-scoped, and a scheme-source is scheme-scoped.
    expect(permits(one, "connect-src", `${PUBLIC_ORIGIN}/api/x`, self)).toBe(true);
    expect(permits(one, "connect-src", "https://elsewhere.test/x", self)).toBe(false);
    expect(permits(one, "img-src", "https://anything.test/x.png", self)).toBe(true);
    expect(permits(one, "img-src", "wss://anything.test/x", self)).toBe(false);

    // 'none' and keyword-only lists match no URL at all.
    expect(permits(one, "media-src", `${PUBLIC_ORIGIN}/a.mp4`, self)).toBe(false);
    expect(permits(parsePolicy("default-src 'none'; script-src 'unsafe-inline'"), "script-src", `${PUBLIC_ORIGIN}/a.js`, self)).toBe(false);

    // A host-source must not be satisfied by a suffix collision.
    const two = parsePolicy("default-src 'none'; connect-src https://safe.test");
    expect(permits(two, "connect-src", "https://notsafe.test/x", self)).toBe(false);
    expect(permits(two, "connect-src", "https://evil-safe.test/x", self)).toBe(false);

    // 'self' does not cover an opaque scheme, even though a blob: URL carries
    // the creating origin inside it and compares equal on .origin.
    const three = parsePolicy("default-src 'none'; script-src 'self'; img-src 'self' data:");
    expect(new URL(`blob:${PUBLIC_ORIGIN}/w`).origin).toBe(self.origin); // the trap itself
    expect(permits(three, "worker-src", `blob:${PUBLIC_ORIGIN}/w`, self)).toBe(false);
    expect(permits(three, "img-src", `blob:${PUBLIC_ORIGIN}/i`, self)).toBe(false);
    expect(permits(three, "img-src", "data:image/png;base64,AAAA", self)).toBe(true);
    expect(permits(parsePolicy("default-src 'none'; worker-src blob:"), "worker-src", `blob:${PUBLIC_ORIGIN}/w`, self)).toBe(true);
  });

  it("resolves each directive through the CSP3 fallback chain the browser uses", () => {
    // The shipped policy states these explicitly...
    expect(governing(policy, "connect-src").from).toBe("connect-src");
    expect(governing(policy, "font-src").from).toBe("font-src");
    expect(governing(policy, "media-src").from).toBe("media-src");
    // ...and says nothing about workers, so they are governed by default-src.
    expect(policy.has("worker-src")).toBe(false);
    expect(policy.has("child-src")).toBe(false);
    expect(governing(policy, "worker-src").from).toBe("script-src");
    // script-src is the worker fallback, and it admits no blob: source, so the
    // refusal is real rather than an artefact of reading only default-src.
    expect(governing(policy, "worker-src").sources).not.toContain("blob:");
  });

  it("every endpoint the app derives is permitted, or is a reviewed gap with an owning issue", () => {
    const unmet = DERIVED_ENDPOINTS.filter((endpoint) => !permits(policy, endpoint.directive, endpoint.url));
    const known = new Set(KNOWN_UNMET.map((gap) => gap.url));

    // An endpoint the app derives is refused and nobody has reviewed it.
    const surprises = unmet.filter((endpoint) => !known.has(endpoint.url));
    expect(surprises.map((endpoint) => `UNREVIEWED ${endpoint.directive} ${endpoint.url} (${endpoint.what})`)).toEqual([]);

    // ...and the ratchet in the other direction: no stale exemptions.
    const stale = KNOWN_UNMET.filter((gap) => !unmet.some((endpoint) => endpoint.url === gap.url));
    expect(stale.map((gap) => `STALE ${gap.url} is now permitted; drop its ${gap.issue} exemption`)).toEqual([]);

    // Every exemption names an issue and says why, so none can be a shrug.
    for (const gap of KNOWN_UNMET) {
      expect(gap.issue).toMatch(/^#[1-9][0-9]*$/);
      expect(gap.why.length).toBeGreaterThan(40);
    }
  });

  it("the realtime endpoint is derived from the server's own SUPABASE_URL, so it cannot drift", () => {
    const realtime = new URL(derivedRealtimeEndpoint());
    expect(realtime.protocol).toBe("wss:");
    expect(realtime.hostname).toBe(supabaseHttp.hostname);
    expect(realtime.pathname).toBe("/realtime/v1/websocket");
    // [TEST-MOD-APPROVED #3251] Second invalidated assertion, named: this line
    // asserted the realtime socket is REFUSED. #3251 added a `wss:` source, so
    // the same host is now admitted over BOTH schemes and it must assert true.
    //
    // The scheme-for-scheme rule this test exists to protect is NOT weakened —
    // it is still proven, on a host that is deliberately https-only, by the
    // "can tell wss:// from https://" case above (`wss://example.test`) and by
    // the live Chromium oracle in the playwright leg (`wss://api.stripe.com`).
    // Asserting refusal on the Supabase host specifically would now be
    // asserting the bug.
    expect(permits(policy, "connect-src", `${supabaseHttp.origin}/rest/v1/x`)).toBe(true);
    expect(permits(policy, "connect-src", derivedRealtimeEndpoint())).toBe(true);
    // ...and the ws:// downgrade of that same host is still refused, so the new
    // source is exactly one scheme wider, not a blanket relaxation.
    expect(permits(policy, "connect-src", derivedRealtimeEndpoint().replace(/^wss:/, "ws:"))).toBe(false);
  });

  it("keeps the protections that make the rest of the policy worth auditing", () => {
    // Re-derived independently of the implementor's assertions: if any of these
    // relaxes, a "zero violations" run stops meaning anything.
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp).not.toContain("unsafe-eval");
    for (const directive of ["script-src", "connect-src", "frame-src", "media-src", "font-src"]) {
      const { sources } = governing(policy, directive);
      expect(sources).not.toContain("https:");
      expect(sources).not.toContain("*");
      expect(sources.filter((source) => source.includes("*"))).toEqual([]);
    }
    // A wildcard host would make the derived-endpoint audit above pass trivially.
    expect(permits(policy, "connect-src", "https://attacker.test/x")).toBe(false);
    expect(permits(policy, "script-src", "https://attacker.test/x.js")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The boot-outcome relay: attacks on object SHAPE, not on field values.
// ---------------------------------------------------------------------------

const callRelay = async (
  body: unknown,
  options: { origin?: string; method?: string; raw?: string } = {},
) => {
  const sent: unknown[] = [];
  const handler = relay.createPublicBootOutcomeHandler((async (...args: unknown[]) => {
    sent.push(args);
    return new Response("ok", { status: 200 });
  }) as unknown);
  const response = { statusCode: 0, headers: {} as Record<string, string>, ended: false };
  const res = {
    get statusCode() { return response.statusCode; },
    set statusCode(value: number) { response.statusCode = value; },
    setHeader(key: string, value: string) { response.headers[key.toLowerCase()] = String(value); },
    end() { response.ended = true; return undefined; },
  };
  const req = {
    method: options.method ?? "POST",
    headers: { origin: options.origin ?? PUBLIC_ORIGIN },
    body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  };
  await handler(req, res);
  return { ...response, forwarded: sent.length };
};

const VALID = { outcome: "success", reason: "mounted", elapsed_ms: 42, path: "/b/gogilagos", load_id: "abc123def456" };

describe("#3214 tester adversarial — the boot-outcome relay refuses hostile shapes", () => {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  beforeAll(() => { process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_issue3214tester"; });
  afterAll(() => {
    if (key === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    else process.env.EXPO_PUBLIC_POSTHOG_KEY = key;
  });

  it("accepts the shape the shipped runtime actually sends", async () => {
    const result = await callRelay(VALID);
    expect(result.statusCode).toBe(204);
    expect(result.forwarded).toBe(1);
  });

  it("does not treat a prototype-borrowed outcome as a known outcome", async () => {
    // `REASONS[body.outcome]` is a plain-object lookup, so "constructor",
    // "toString" and "__proto__" all resolve to something truthy. If the guard
    // were `if (!reasons) return null` alone, `reasons.has` would throw — or
    // worse, a cleverer payload would pass. Each must be a clean 400.
    const borrowed = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"];
    const results = [];
    for (const outcome of borrowed) {
      const result = await callRelay({ ...VALID, outcome });
      results.push(`${outcome}=${result.statusCode}/${result.forwarded}`);
    }
    expect(results).toEqual(borrowed.map((outcome) => `${outcome}=400/0`));
  });

  it("refuses a reason borrowed from the other outcome's enum", async () => {
    // success/failure have disjoint reason enums; crossing them would let a
    // broken boot be counted as a healthy one.
    expect((await callRelay({ ...VALID, outcome: "success", reason: "mount_timeout" })).statusCode).toBe(400);
    expect((await callRelay({ ...VALID, outcome: "failure", reason: "mounted" })).statusCode).toBe(400);
    expect((await callRelay({ ...VALID, outcome: "failure", reason: "app_unmounted" })).statusCode).toBe(204);
  });

  it("refuses extra, missing and prototype-polluting keys rather than ignoring them", async () => {
    expect((await callRelay({ ...VALID, extra: 1 })).statusCode).toBe(400);
    expect((await callRelay({ ...VALID, page_type: "brand" })).statusCode).toBe(400);
    expect((await callRelay({ outcome: "success", reason: "mounted", elapsed_ms: 1, path: "/b/x" })).statusCode).toBe(400);
    expect((await callRelay(undefined, { raw: '{"__proto__":{"polluted":true},"outcome":"success","reason":"mounted","elapsed_ms":1,"path":"/b/x","load_id":"abc123def456"}' })).statusCode).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses a foreign origin, and a missing one, before it reads the body", async () => {
    // The look-alike host is the one that matters: a suffix check would pass it.
    const origins = ["https://host.usemingla.com.evil.example", "https://evil.example", "http://host.usemingla.com", "null", ""];
    const results = [];
    for (const origin of origins) {
      const result = await callRelay(VALID, { origin });
      results.push(`${origin || "(none)"}=${result.statusCode}/${result.forwarded}`);
    }
    expect(results).toEqual(origins.map((origin) => `${origin || "(none)"}=404/0`));
  });

  it("refuses a path that is not a public page kind, including near-misses", async () => {
    const refused = ["/checkout/abc", "/b/gogilagos/", "/b/gogilagos?x=1", "/b/gogilagos#x", "//evil.example", "/b/Gogi", "/b/a/b/c", "https://host.usemingla.com/b/gogilagos"];
    const accepted = ["/b/gogilagos", "/b/gogilagos/v/gogi", "/e/a/b", "/t/a/b", "/exp/a/b"];
    const seen = [];
    for (const path of [...refused, ...accepted]) {
      seen.push(`${path}=${(await callRelay({ ...VALID, path })).statusCode}`);
    }
    expect(seen).toEqual([
      ...refused.map((path) => `${path}=400`),
      ...accepted.map((path) => `${path}=204`),
    ]);
  });

  it("never forwards on a non-POST, and says so with allow", async () => {
    const methods = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];
    const results = [];
    for (const method of methods) {
      const result = await callRelay(VALID, { method });
      results.push(`${method}=${result.statusCode}/${result.headers.allow}/${result.forwarded}`);
    }
    expect(results).toEqual(methods.map((method) => `${method}=405/POST/0`));
  });

  it("keeps the outcome out of any cache", async () => {
    const result = await callRelay(VALID);
    expect(result.headers["cache-control"]).toContain("no-store");
  });
});
