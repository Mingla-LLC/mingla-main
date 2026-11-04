// Issue #4261 Wave D-back — plan link previews: parse, limits, SSRF, handler.
//
// FAILS-ON-REVERT: without supabase/functions/plan-link-preview/linkPreview.ts
// the import below fails and every test is red. Deleting the credentials
// refusal, the per-hop DNS check in fetchPublicUrl, the 5 MB declared-size
// refusal or the probe's image-type check turns its test red.

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanText,
  decodeEntities,
  fetchLinkPreview,
  handlePlanLinkPreview,
  HEAD_MAX_BYTES,
  type HandlerDeps,
  type LinkPreviewDeps,
  type LinkPreviewResult,
  parseLinkPreview,
  probeImage,
  readHead,
  safeImageUrl,
  USER_AGENT,
} from "../linkPreview.ts";

const PUBLIC_DNS = (_host: string, type: "A" | "AAAA") =>
  Promise.resolve(type === "A" ? ["93.184.216.34"] : []);

interface Call {
  url: string;
  method: string;
  redirect: string;
  headers: Record<string, string>;
}

type Route = (url: URL, method: string) => Response;

function stubDeps(route: Route, resolveDns = PUBLIC_DNS): { deps: LinkPreviewDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: LinkPreviewDeps = {
    resolveDns,
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const method = init?.method ?? "GET";
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => headers[k] = v);
      calls.push({ url: url.toString(), method, redirect: String(init?.redirect), headers });
      return Promise.resolve(route(url, method));
    },
  };
  return { deps, calls };
}

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

function image(type = "image/jpeg", length?: number): Response {
  const headers: Record<string, string> = { "content-type": type };
  if (length !== undefined) headers["content-length"] = String(length);
  return new Response(null, { status: 200, headers });
}

const PAGE = `<html><head>
  <title>Fallback &amp; title</title>
  <meta property="og:title" content="Afro Jazz Night &#8211; Tickets">
  <meta name="twitter:title" content="Twitter title">
  <meta property="og:site_name" content="Lagos Events">
  <meta property="og:image" content="/covers/jazz.jpg">
</head><body>ignored</body></html>`;

// ── parse ───────────────────────────────────────────────────────────────────
Deno.test("parse: og:title first, then twitter:title, then <title>", () => {
  const final = new URL("https://events.example.com/jazz");
  assertEquals(parseLinkPreview(PAGE, final).title, "Afro Jazz Night – Tickets");
  assertEquals(
    parseLinkPreview(`<head><meta name="twitter:title" content="Tw"><title>T</title></head>`, final).title,
    "Tw",
  );
  assertEquals(parseLinkPreview(`<head><title> Plain   <b>title</b> </title></head>`, final).title, "Plain title");
  assertEquals(parseLinkPreview(`<head></head>`, final), { title: null, siteName: null, imageUrl: null });
});

Deno.test("parse: a relative og:image resolves against the final URL; site name kept", () => {
  const p = parseLinkPreview(PAGE, new URL("https://events.example.com/jazz/night"));
  assertEquals(p.imageUrl, "https://events.example.com/covers/jazz.jpg");
  assertEquals(p.siteName, "Lagos Events");
});

Deno.test("parse: og:image:secure_url wins; http, javascript:, credentialed and private images are dropped", () => {
  const final = "https://events.example.com/";
  assertEquals(
    parseLinkPreview(
      `<meta property="og:image" content="https://cdn.example.com/a.jpg"><meta property="og:image:secure_url" content="https://cdn.example.com/b.jpg">`,
      final,
    ).imageUrl,
    "https://cdn.example.com/b.jpg",
  );
  assertStrictEquals(parseLinkPreview(`<meta property="og:image" content="http://cdn.example.com/a.jpg">`, final).imageUrl, null);
  assertStrictEquals(parseLinkPreview(`<meta property="og:image" content="javascript:alert(1)">`, final).imageUrl, null);
  assertStrictEquals(safeImageUrl("https://user:pw@cdn.example.com/a.jpg", final), null);
  assertStrictEquals(safeImageUrl("https://169.254.169.254/latest/meta-data", final), null);
  assertStrictEquals(safeImageUrl("https://localhost/a.jpg", final), null);
  assertStrictEquals(safeImageUrl("https://cdn.example.com/" + "a".repeat(1100), final), null);
  // An http og:image falls through to a valid twitter:image.
  assertEquals(
    parseLinkPreview(
      `<meta property="og:image" content="http://cdn.example.com/a.jpg"><meta name="twitter:image" content="https://cdn.example.com/t.jpg">`,
      final,
    ).imageUrl,
    "https://cdn.example.com/t.jpg",
  );
});

Deno.test("text: entities decoded, tags and control characters stripped, title cut to 200", () => {
  assertEquals(decodeEntities("Tom &amp; Jerry&#39;s &#x26; &quot;more&quot; &bogus;"), `Tom & Jerry's & "more" &bogus;`);
  assertEquals(cleanText("a\u0000b​\n\t c <i>d</i>", 50), "a b c d");
  const long = parseLinkPreview(`<meta property="og:title" content="${"x".repeat(500)}">`, "https://a.example.com/").title;
  assertEquals(long?.length, 200);
  const site = parseLinkPreview(`<meta property="og:site_name" content="${"s".repeat(120)}">`, "https://a.example.com/").siteName;
  assertEquals(site?.length, 80);
});

// ── stream limits ───────────────────────────────────────────────────────────
function streamOf(chunks: () => Uint8Array | null): { response: Response; pulled: () => number } {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks();
      pulled += 1;
      if (next === null) controller.close();
      else controller.enqueue(next);
    },
  });
  return { response: new Response(body, { headers: { "content-type": "text/html" } }), pulled: () => pulled };
}

Deno.test("limits: the head read stops at 512 KB when no </head> comes", async () => {
  const chunk = new TextEncoder().encode("a".repeat(100_000)); // not a divisor of 512 KB
  const { response, pulled } = streamOf(() => chunk); // never ends
  const text = await readHead(response);
  assertEquals(text.length, HEAD_MAX_BYTES);
  assertEquals(pulled() <= 7, true);
});

Deno.test("limits: the head read stops at the first </head>", async () => {
  const enc = new TextEncoder();
  let n = 0;
  const { response, pulled } = streamOf(() => {
    n += 1;
    if (n === 1) return enc.encode("<html><head><title>T</title></he");
    if (n === 2) return enc.encode("ad><body>" + "b".repeat(1000));
    return enc.encode("c".repeat(1000));
  });
  const text = await readHead(response);
  assertEquals(text, "<html><head><title>T</title></head>");
  assertEquals(pulled() <= 3, true);
});

// ── fetch orchestration ─────────────────────────────────────────────────────
Deno.test("fetch: an html page gives title, site and a probed picture; headers and manual redirects", async () => {
  const { deps, calls } = stubDeps((url, method) => {
    if (url.pathname === "/covers/jazz.jpg") return image("image/jpeg", 120_000);
    if (method !== "GET") return new Response(null, { status: 405 });
    return html(PAGE);
  });
  const r = await fetchLinkPreview("https://events.example.com/jazz", deps);
  assertEquals(r, {
    outcome: "ok",
    title: "Afro Jazz Night – Tickets",
    siteName: "Lagos Events",
    imageUrl: "https://events.example.com/covers/jazz.jpg",
    finalUrl: "https://events.example.com/jazz",
    reason: null,
  });
  assertEquals(calls[0].method, "GET");
  assertEquals(calls[0].redirect, "manual");
  assertEquals(calls[0].headers["user-agent"], USER_AGENT);
  assertEquals(calls[0].headers["accept"], "text/html,application/xhtml+xml");
  assertEquals(calls[1].method, "HEAD");
});

Deno.test("fetch: a picture that is not an image, or over 8 MB, is left out", async () => {
  for (const probe of [html("<p>not an image</p>"), image("image/svg+xml"), image("image/png", 9 * 1024 * 1024), new Response(null, { status: 404 })]) {
    const { deps } = stubDeps((url) => url.pathname === "/covers/jazz.jpg" ? probe : html(PAGE));
    const r = await fetchLinkPreview("https://events.example.com/jazz", deps);
    assertEquals(r.outcome, "ok");
    assertStrictEquals(r.imageUrl, null);
    assertEquals(r.title, "Afro Jazz Night – Tickets");
  }
  const { deps } = stubDeps(() => image("image/webp"));
  assertEquals(await probeImage("https://cdn.example.com/a.webp", deps), true);
});

Deno.test("fetch: a link that is itself an image becomes the cover", async () => {
  const { deps } = stubDeps(() => image("image/png", 50_000));
  const r = await fetchLinkPreview("https://cdn.example.com/flyer.png", deps);
  assertEquals(r.outcome, "ok");
  assertStrictEquals(r.title, null);
  assertEquals(r.imageUrl, "https://cdn.example.com/flyer.png");
});

Deno.test("limits: non-html content and a declared size over 5 MB fail", async () => {
  let r = await fetchLinkPreview("https://docs.example.com/a.pdf", stubDeps(() => new Response("%PDF", { headers: { "content-type": "application/pdf" } })).deps);
  assertEquals([r.outcome, r.reason], ["failed", "type_blocked"]);
  r = await fetchLinkPreview("https://docs.example.com/a.json", stubDeps(() => new Response("{}", { headers: { "content-type": "application/json" } })).deps);
  assertEquals(r.outcome, "failed");
  r = await fetchLinkPreview("https://big.example.com/", stubDeps(() => html(PAGE, { "content-length": String(6 * 1024 * 1024) })).deps);
  assertEquals([r.outcome, r.reason], ["failed", "too_large"]);
  r = await fetchLinkPreview("https://gone.example.com/", stubDeps(() => new Response("no", { status: 404, headers: { "content-type": "text/html" } })).deps);
  assertEquals([r.outcome, r.reason], ["failed", "http_404"]);
});

// ── SSRF ────────────────────────────────────────────────────────────────────
Deno.test("ssrf: a redirect to the metadata address fails", async () => {
  const { deps, calls } = stubDeps((url) =>
    url.hostname === "events.example.com"
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      : html(PAGE)
  );
  const r = await fetchLinkPreview("https://events.example.com/jazz", deps);
  assertEquals([r.outcome, r.reason], ["failed", "PUBLIC_URL_PRIVATE_NETWORK"]);
  assertEquals(calls.length, 1);
});

Deno.test("ssrf: a host whose DNS resolves to a private address fails before any fetch", async () => {
  const { deps, calls } = stubDeps(() => html(PAGE), (_h, type) => Promise.resolve(type === "A" ? ["10.0.0.5"] : []));
  const r = await fetchLinkPreview("https://intranet.example.com/", deps);
  assertEquals([r.outcome, r.reason], ["failed", "PUBLIC_URL_PRIVATE_NETWORK"]);
  assertEquals(calls.length, 0);
});

Deno.test("ssrf: loopback, private, localhost and credentialed URLs are refused before any fetch", async () => {
  for (const [raw, reason] of [
    ["http://127.0.0.1:54321/rest/v1/", "PUBLIC_URL_PRIVATE_NETWORK"],
    ["http://localhost/", "PUBLIC_URL_PRIVATE_NETWORK"],
    ["http://[::1]/", "PUBLIC_URL_PRIVATE_NETWORK"],
    ["https://192.168.1.1/", "PUBLIC_URL_PRIVATE_NETWORK"],
    ["https://user:secret@events.example.com/", "PUBLIC_URL_CREDENTIALS"],
    ["ftp://events.example.com/", "PUBLIC_URL_SCHEME_BLOCKED"],
    ["not a url", "PUBLIC_URL_INVALID"],
  ]) {
    const { deps, calls } = stubDeps(() => html(PAGE));
    const r = await fetchLinkPreview(raw, deps);
    assertEquals([r.outcome, r.reason], ["failed", reason], raw);
    assertEquals(calls.length, 0, raw);
  }
});

Deno.test("ssrf: more than 3 redirects fail", async () => {
  let hop = 0;
  const { deps } = stubDeps(() => {
    hop += 1;
    return new Response(null, { status: 301, headers: { location: `https://hop${hop}.example.com/` } });
  });
  const r = await fetchLinkPreview("https://start.example.com/", deps);
  assertEquals([r.outcome, r.reason], ["failed", "PUBLIC_URL_REDIRECT_BLOCKED"]);
  assertEquals(hop, 4);
});

// ── handler ─────────────────────────────────────────────────────────────────
const PLAN = "6e8e3fe8-6774-49de-8681-9d93faf1a342";

function handlerDeps(over: Partial<HandlerDeps> = {}): { deps: HandlerDeps; stored: unknown[]; asked: string[] } {
  const stored: unknown[] = [];
  const asked: string[] = [];
  const deps: HandlerDeps = {
    linkTargets: (_auth, planId) => {
      asked.push(planId);
      return Promise.resolve({ data: { planId, urls: ["https://a.example.com/", "https://b.example.com/"] }, error: null });
    },
    storePreview: (input) => {
      stored.push(input);
      return Promise.resolve({ error: null });
    },
    fetchPreview: (url): Promise<LinkPreviewResult> =>
      Promise.resolve(
        url.startsWith("https://a.")
          ? { outcome: "ok", title: "A", siteName: null, imageUrl: null, finalUrl: url, reason: null }
          : { outcome: "failed", title: null, siteName: null, imageUrl: null, finalUrl: null, reason: "http_500" },
      ),
    ...over,
  };
  return { deps, stored, asked };
}

function post(body: unknown, auth: string | null = "Bearer user.jwt.token"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("http://local/plan-link-preview", { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("handler: a missing or malformed planId is 400 and asks nothing", async () => {
  const { deps, asked } = handlerDeps();
  for (const body of [{}, { planId: "" }, { planId: "nope" }, { planId: 42 }, null]) {
    const res = await handlePlanLinkPreview(post(body), deps);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "invalid_input" });
  }
  assertEquals(asked.length, 0);
});

Deno.test("handler: no JWT is 401; not a member is 403; a database error is 500", async () => {
  assertEquals((await handlePlanLinkPreview(post({ planId: PLAN }, null), handlerDeps().deps)).status, 401);
  const notMember = handlerDeps({ linkTargets: () => Promise.resolve({ data: null, error: { code: "42501", message: "not_allowed" } }) });
  const res = await handlePlanLinkPreview(post({ planId: PLAN }), notMember.deps);
  assertEquals([res.status, await res.json()], [403, { error: "not_allowed" }]);
  assertEquals(notMember.stored.length, 0);
  const missing = handlerDeps({ linkTargets: () => Promise.resolve({ data: null, error: { code: "P0002", message: "not_found" } }) });
  assertEquals((await handlePlanLinkPreview(post({ planId: PLAN }), missing.deps)).status, 403);
  const broken = handlerDeps({ linkTargets: () => Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }) });
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    assertEquals((await handlePlanLinkPreview(post({ planId: PLAN }), broken.deps)).status, 500);
  } finally {
    console.error = original;
  }
  assertEquals(errors.length, 1);
  assertEquals((await handlePlanLinkPreview(new Request("http://local/", { method: "GET" }), handlerDeps().deps)).status, 405);
});

Deno.test("handler: stores every target (ok and failed) and reports counts", async () => {
  const { deps, stored, asked } = handlerDeps();
  const res = await handlePlanLinkPreview(post({ planId: PLAN }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { planId: PLAN, fetched: 2, skipped: 0 });
  assertEquals(asked, [PLAN]);
  assertEquals(stored, [
    { url: "https://a.example.com/", outcome: "ok", title: "A", siteName: null, imageUrl: null, finalUrl: "https://a.example.com/" },
    { url: "https://b.example.com/", outcome: "failed", title: null, siteName: null, imageUrl: null, finalUrl: null },
  ]);
});

Deno.test("handler: past the 15 s budget the rest is skipped", async () => {
  let t = 0;
  const { deps, stored } = handlerDeps({
    now: () => t,
    fetchPreview: (url) => {
      t += 16_000;
      return Promise.resolve({ outcome: "ok", title: null, siteName: null, imageUrl: null, finalUrl: url, reason: null });
    },
  });
  const res = await handlePlanLinkPreview(post({ planId: PLAN }), deps);
  const body = await res.json();
  assertEquals(body.fetched, 0);
  assertEquals(body.skipped, 2);
  assertEquals(stored.length, 0);
});
