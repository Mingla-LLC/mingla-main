// #4339 §5 — the public website-description draft endpoint (implementor happy
// path + refusals). The store is injected, so these run with no database.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedOrigin,
  type CreateDraft,
  handler,
  hashIp,
  MAX_BODY_BYTES,
  normalizeDescription,
} from "../index.ts";

const DESCRIPTION =
  "A rooftop cafe in Lekki with live acoustic sets on Fridays.";
const DRAFT_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";

function post(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/functions/v1/site-prompt-draft", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://usemingla.com",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function recorder(
  answer: Awaited<ReturnType<CreateDraft>>,
): { calls: Array<[string, string | null]>; create: CreateDraft } {
  const calls: Array<[string, string | null]> = [];
  return {
    calls,
    create: (body, ipHash) => {
      calls.push([body, ipHash]);
      return Promise.resolve(answer);
    },
  };
}

Deno.test("#4339 a description is stored and only its id comes back", async () => {
  const store = recorder({ status: "created", id: DRAFT_ID });
  const res = await handler(
    post({ description: `  ${DESCRIPTION}  ` }),
    store.create,
  );
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { draft_id: DRAFT_ID });
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "https://usemingla.com",
  );
  assertEquals(res.headers.get("cache-control"), "no-store");
  // Trimmed text, and the salted hash of the FIRST forwarded hop (raw IP never sent).
  assertEquals(store.calls, [[DESCRIPTION, await hashIp("203.0.113.7")]]);
  assert(!JSON.stringify(store.calls).includes("203.0.113.7"));
});

Deno.test("#4339 the response never echoes the description", async () => {
  const store = recorder({ status: "created", id: DRAFT_ID });
  const res = await handler(post({ description: DESCRIPTION }), store.create);
  const text = await res.text();
  assert(!text.includes("rooftop"), text);
});

Deno.test("#4339 origins: usemingla.com, subdomains, previews and localhost only", () => {
  assertEquals(allowedOrigin("https://usemingla.com"), "https://usemingla.com");
  assertEquals(
    allowedOrigin("https://www.usemingla.com"),
    "https://www.usemingla.com",
  );
  assertEquals(
    allowedOrigin("https://mingla-marketing-git-x.vercel.app"),
    "https://mingla-marketing-git-x.vercel.app",
  );
  assertEquals(allowedOrigin("http://localhost:3000"), "http://localhost:3000");
  assertEquals(allowedOrigin("http://127.0.0.1:3100"), "http://127.0.0.1:3100");
  for (
    const bad of [
      null,
      "",
      "http://usemingla.com",
      "https://evilusemingla.com",
      "https://usemingla.com.evil.test",
      "https://usemingla.com/path",
      "null",
      "file://localhost",
    ]
  ) {
    assertEquals(allowedOrigin(bad), null, String(bad));
  }
});

Deno.test("#4339 a foreign or missing origin is refused before anything is stored", async () => {
  for (const origin of ["https://evil.test", ""]) {
    const store = recorder({ status: "created", id: DRAFT_ID });
    const res = await handler(
      post({ description: DESCRIPTION }, { origin }),
      store.create,
    );
    assertEquals(res.status, 403);
    assertEquals(res.headers.get("access-control-allow-origin"), null);
    assertEquals(store.calls.length, 0);
  }
});

Deno.test("#4339 preflight answers an allowed origin only", async () => {
  const ok = await handler(
    new Request("http://localhost/x", {
      method: "OPTIONS",
      headers: { origin: "https://usemingla.com" },
    }),
  );
  assertEquals(ok.status, 204);
  assertEquals(
    ok.headers.get("access-control-allow-origin"),
    "https://usemingla.com",
  );
  const no = await handler(
    new Request("http://localhost/x", {
      method: "OPTIONS",
      headers: { origin: "https://evil.test" },
    }),
  );
  assertEquals(no.status, 403);
});

Deno.test("#4339 the description must be 12 to 1,000 characters", async () => {
  assertEquals(normalizeDescription("too short"), null);
  assertEquals(normalizeDescription("            "), null);
  assertEquals(normalizeDescription(42), null);
  assertEquals(normalizeDescription("x".repeat(1001)), null);
  assertEquals(normalizeDescription("x".repeat(1000)), "x".repeat(1000));
  for (
    const body of [{ description: "short" }, { other: DESCRIPTION }, [
      DESCRIPTION,
    ], "not json"]
  ) {
    const store = recorder({ status: "created", id: DRAFT_ID });
    const res = await handler(post(body), store.create);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(store.calls.length, 0);
  }
});

Deno.test("#4339 an oversized body is refused", async () => {
  const store = recorder({ status: "created", id: DRAFT_ID });
  const res = await handler(
    post({ description: DESCRIPTION, pad: "x".repeat(MAX_BODY_BYTES) }),
    store.create,
  );
  assertEquals(res.status, 413);
  assertEquals(store.calls.length, 0);
});

Deno.test("#4339 store answers map to honest statuses", async () => {
  const cases: Array<[Awaited<ReturnType<CreateDraft>>, number, string]> = [
    [{ status: "rate_limited" }, 429, "rate_limited"],
    [{ status: "busy" }, 503, "busy"],
    [{ status: "invalid" }, 400, "validation"],
    [null, 503, "unavailable"],
    [{ status: "created" }, 503, "unavailable"],
    [{ status: "created", id: "not-a-uuid" }, 503, "unavailable"],
  ];
  for (const [answer, status, error] of cases) {
    const res = await handler(
      post({ description: DESCRIPTION }),
      recorder(answer).create,
    );
    assertEquals(res.status, status, JSON.stringify(answer));
    assertEquals((await res.json()).error, error);
  }
});

Deno.test("#4339 only POST stores a draft", async () => {
  const res = await handler(
    new Request("http://localhost/x", {
      method: "GET",
      headers: { origin: "https://usemingla.com" },
    }),
  );
  assertEquals(res.status, 405);
});

Deno.test("#4339 no client address still stores (hash is null)", async () => {
  const store = recorder({ status: "created", id: DRAFT_ID });
  const res = await handler(
    post({ description: DESCRIPTION }, { "x-forwarded-for": "" }),
    store.create,
  );
  assertEquals(res.status, 201);
  assertEquals(store.calls, [[DESCRIPTION, null]]);
});

// #4339 round B — the server funnel event: a created draft logs exactly one
// `ari_draft_created` line, with a length band and nothing identifying.
Deno.test("round B: a created draft logs ari_draft_created without the description", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const { create } = recorder({ status: "created", id: DRAFT_ID });
    const res = await handler(post({ description: DESCRIPTION }), create);
    assertEquals(res.status, 201);
  } finally {
    console.log = original;
  }
  const events = lines.filter((line) => line.includes("ari_draft_created"));
  assertEquals(events.length, 1);
  const parsed = JSON.parse(events[0]);
  assertEquals(parsed, { event: "ari_draft_created", length_bucket: "short" });
  assert(!events[0].includes("rooftop"), "the description is never logged");
  assert(!events[0].includes(DRAFT_ID), "the draft id is never logged");
});

Deno.test("round B: a refused draft logs no funnel event", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const { create } = recorder({ status: "rate_limited" });
    const res = await handler(post({ description: DESCRIPTION }), create);
    assertEquals(res.status, 429);
  } finally {
    console.log = original;
  }
  assertEquals(
    lines.filter((line) => line.includes("ari_draft_created")).length,
    0,
  );
});
