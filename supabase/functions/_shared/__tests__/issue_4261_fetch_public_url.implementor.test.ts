// Issue #4261 Wave D-back — fetchPublicUrl: the shared SSRF-safe fetch that
// Ari's research and the plan link preview both use.
//
// FAILS-ON-REVERT: without the fetchPublicUrl export the import fails;
// deleting the per-hop assertPublicDns call or the per-hop Location
// re-validation turns the redirect tests red.

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchPublicUrl, readPublicUrl } from "../agentWebResearch.ts";

interface Seen {
  url: string;
  method: string;
  redirect: string;
  ua: string | null;
  accept: string | null;
}

function recorder(route: (url: URL) => Response) {
  const seen: Seen[] = [];
  const dns: string[] = [];
  return {
    seen,
    dns,
    deps: {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const headers = new Headers(init?.headers);
        seen.push({
          url: url.toString(),
          method: init?.method ?? "GET",
          redirect: String(init?.redirect),
          ua: headers.get("user-agent"),
          accept: headers.get("accept"),
        });
        return Promise.resolve(route(url));
      },
      resolveDns: (host: string, type: "A" | "AAAA") => {
        dns.push(`${host}/${type}`);
        if (type === "AAAA") return Promise.resolve([] as string[]);
        return Promise.resolve(host.startsWith("internal.") ? ["10.1.2.3"] : ["93.184.216.34"]);
      },
    },
  };
}

const OPTS = { accept: "text/html", userAgent: "Test/1.0", timeoutMs: 2_000 };

Deno.test("fetchPublicUrl: follows redirects by hand and re-checks DNS on every hop", async () => {
  const r = recorder((url) => {
    if (url.hostname === "a.example.com") return new Response(null, { status: 302, headers: { location: "https://b.example.com/two" } });
    if (url.pathname === "/two") return new Response(null, { status: 307, headers: { location: "/three" } });
    return new Response("ok", { status: 200 });
  });
  const { url, response } = await fetchPublicUrl(new URL("https://a.example.com/one"), OPTS, r.deps);
  assertEquals(url.toString(), "https://b.example.com/three");
  assertEquals(await response.text(), "ok");
  assertEquals(r.seen.map((s) => s.url), ["https://a.example.com/one", "https://b.example.com/two", "https://b.example.com/three"]);
  assertEquals(r.seen.every((s) => s.redirect === "manual" && s.ua === "Test/1.0" && s.accept === "text/html"), true);
  assertEquals(r.dns.filter((d) => d.endsWith("/A")), ["a.example.com/A", "b.example.com/A", "b.example.com/A"]);
});

Deno.test("fetchPublicUrl: a hop whose DNS is private is refused before it is fetched", async () => {
  const r = recorder((url) =>
    url.hostname === "a.example.com"
      ? new Response(null, { status: 302, headers: { location: "https://internal.example.com/admin" } })
      : new Response("secret")
  );
  await assertRejects(() => fetchPublicUrl(new URL("https://a.example.com/"), OPTS, r.deps), Error, "PUBLIC_URL_PRIVATE_NETWORK");
  assertEquals(r.seen.length, 1);
});

Deno.test("fetchPublicUrl: a Location pointing at loopback or metadata is refused", async () => {
  for (const location of ["http://127.0.0.1:54321/", "http://localhost/", "http://169.254.169.254/latest/", "file:///etc/passwd"]) {
    const r = recorder(() => new Response(null, { status: 301, headers: { location } }));
    await assertRejects(() => fetchPublicUrl(new URL("https://a.example.com/"), OPTS, r.deps), Error, "PUBLIC_URL_");
    assertEquals(r.seen.length, 1, location);
  }
});

Deno.test("fetchPublicUrl: maxRedirects is honoured", async () => {
  const r = recorder(() => new Response(null, { status: 302, headers: { location: "https://a.example.com/again" } }));
  await assertRejects(
    () => fetchPublicUrl(new URL("https://a.example.com/"), { ...OPTS, maxRedirects: 1 }, r.deps),
    Error,
    "PUBLIC_URL_REDIRECT_BLOCKED",
  );
  assertEquals(r.seen.length, 2);
});

Deno.test("fetchPublicUrl: HEAD is honoured", async () => {
  const r = recorder(() => new Response(null, { status: 200, headers: { "content-type": "image/png" } }));
  await fetchPublicUrl(new URL("https://cdn.example.com/a.png"), { ...OPTS, method: "HEAD" }, r.deps);
  assertEquals(r.seen[0].method, "HEAD");
});

Deno.test("fetchPublicUrl: an external signal aborts (already aborted, and mid-request)", async () => {
  const r = recorder(() => new Response("never"));
  const aborted = new AbortController();
  aborted.abort();
  await assertRejects(() => fetchPublicUrl(new URL("https://a.example.com/"), { ...OPTS, signal: aborted.signal }, r.deps));
  assertEquals(r.seen.length, 0);

  const later = new AbortController();
  const hanging = {
    resolveDns: r.deps.resolveDns,
    fetch: (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Like fetch: an already-aborted signal rejects at once.
        if (init?.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  };
  const pending = fetchPublicUrl(new URL("https://a.example.com/"), { ...OPTS, signal: later.signal }, hanging);
  later.abort();
  await assertRejects(() => pending, DOMException, "aborted");
});

Deno.test("readPublicUrl (Ari) still sends Mingla-Ari-Research/1.0 and today's Accept", async () => {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: input.toString(),
      method: init?.method ?? "",
      redirect: String(init?.redirect),
      ua: headers.get("user-agent"),
      accept: headers.get("accept"),
    });
    return Promise.resolve(new Response("<title>Page</title><p>hello</p>", { headers: { "content-type": "text/html" } }));
  };
  try {
    // An IP literal skips DNS, so the test needs no network.
    const result = await readPublicUrl("https://93.184.216.34/page");
    assertEquals(result.source.title, "Page");
  } finally {
    globalThis.fetch = original;
  }
  assertEquals(seen, [{
    url: "https://93.184.216.34/page",
    method: "GET",
    redirect: "manual",
    ua: "Mingla-Ari-Research/1.0",
    accept: "text/html,text/plain,application/json,application/pdf;q=0.7",
  }]);

  const source = await Deno.readTextFile(new URL("../agentWebResearch.ts", import.meta.url));
  const bounded = source.slice(source.indexOf("async function boundedFetch("), source.indexOf("export async function readPublicUrl("));
  assertStringIncludes(bounded, `userAgent: "Mingla-Ari-Research/1.0"`);
  assertStringIncludes(bounded, `accept: "text/html,text/plain,application/json,application/pdf;q=0.7"`);
  assertStringIncludes(bounded, "timeoutMs: REQUEST_TIMEOUT_MS");
  assertStringIncludes(bounded, "maxRedirects: MAX_REDIRECTS");
});
