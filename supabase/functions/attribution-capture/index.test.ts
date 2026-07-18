// ISSUE-865 WP-A — runtime tests for attribution-capture.
//
// Exercises the exported handler (NOT source-grep — COMMS-0106) with an
// injected mock client:
//   • FAIL-OPEN: malformed body, missing storage, and a THROWING client all
//     return HTTP 200 soft — never a 5xx, never an unhandled throw (RT-1). This
//     is the runtime fails-on-revert for the fail-open wrapper: remove the
//     try/catch in handleCapture and the throwing-client case surfaces the throw
//     and this test fails.
//   • IDEMPOTENT: the handler reports deduped=true when the upsert returns no
//     inserted row (ON CONFLICT DO NOTHING) and deduped=false when it inserts
//     (RT-2). The DB UNIQUE(event_id) is proven separately in the SQL suite.
//   • PII HASHING: sha256Hex matches the pgcrypto encode(digest(x,'sha256'),'hex')
//     hex vector (SC-9).
//
// Run: deno test --allow-none supabase/functions/attribution-capture/index.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleCapture, sha256Hex, type CaptureDeps } from "./index.ts";

// ── Chainable mock Supabase client ───────────────────────────────────────────
interface MockOpts {
  connectionId?: string | null;
  // conversion upsert result: rows inserted (deduped=false) or [] (deduped=true)
  conversionInserted?: boolean;
  throwOnWrite?: boolean;
  errorOnWrite?: boolean;
}

// deno-lint-ignore no-explicit-any
function mockClient(opts: MockOpts): any {
  return {
    from(table: string) {
      if (table === "ad_connections") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () =>
            Promise.resolve(
              opts.connectionId
                ? { data: { id: opts.connectionId }, error: null }
                : { data: null, error: null },
            ),
        };
        return builder;
      }
      if (table === "ad_conversions") {
        return {
          upsert: () => ({
            select: () => {
              if (opts.throwOnWrite) throw new Error("boom-conversion");
              if (opts.errorOnWrite) return Promise.resolve({ data: null, error: { message: "db down" } });
              return Promise.resolve({
                data: opts.conversionInserted ? [{ id: "row-1" }] : [],
                error: null,
              });
            },
          }),
        };
      }
      // ad_attribution_touches
      return {
        insert: () => {
          if (opts.throwOnWrite) throw new Error("boom-touch");
          if (opts.errorOnWrite) return Promise.resolve({ error: { message: "db down" } });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function deps(opts: MockOpts = {}): CaptureDeps {
  return { getClient: () => mockClient(opts) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ── FAIL-OPEN ────────────────────────────────────────────────────────────────

Deno.test("fail-open: malformed JSON -> 200 soft, never 5xx", async () => {
  const res = await handleCapture(post("{not json", {}), deps());
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, false);
});

Deno.test("fail-open: storage unavailable -> 200 soft, never 5xx", async () => {
  const res = await handleCapture(post({ event_id: "e1" }), { getClient: () => null });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).soft_error, "storage_unavailable");
});

Deno.test("fail-open: a THROWING client is absorbed -> 200, never throws/5xx (RT-1 revert anchor)", async () => {
  // conversion path
  const c = await handleCapture(post({ event_id: "e1", value_cents: 500 }), deps({ throwOnWrite: true }));
  assertEquals(c.status, 200);
  assertEquals((await c.json()).ok, false);
  // touch path
  const t = await handleCapture(post({ network: "meta", surface: "web" }), deps({ throwOnWrite: true }));
  assertEquals(t.status, 200);
  assertEquals((await t.json()).ok, false);
});

Deno.test("fail-open: a DB error is absorbed -> 200 soft", async () => {
  const res = await handleCapture(post({ event_id: "e2" }), deps({ errorOnWrite: true }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).soft_error, "conversion_not_recorded");
});

// ── IDEMPOTENCY (handler-level dedup reporting; DB UNIQUE proven in SQL suite) ─

Deno.test("idempotent: no inserted row -> deduped=true", async () => {
  const res = await handleCapture(
    post({ kind: "conversion", event_id: "dup", event_name: "Purchase" }),
    deps({ conversionInserted: false }),
  );
  const j = await res.json();
  assertEquals(res.status, 200);
  assertEquals(j.ok, true);
  assertEquals(j.deduped, true);
});

Deno.test("idempotent: fresh insert -> deduped=false", async () => {
  const res = await handleCapture(
    post({ kind: "conversion", event_id: "fresh", event_name: "Purchase" }),
    deps({ conversionInserted: true }),
  );
  assertEquals((await res.json()).deduped, false);
});

Deno.test("conversion missing event_id -> soft error, never 5xx", async () => {
  const res = await handleCapture(post({ kind: "conversion" }), deps({}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).soft_error, "event_id_required");
});

// ── TOUCH ────────────────────────────────────────────────────────────────────

Deno.test("touch: returns a click_id", async () => {
  const res = await handleCapture(
    post({ network: "meta", surface: "web", external_click_id: "fbclid123" }),
    deps({ connectionId: "conn-1" }),
  );
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(j.kind, "touch");
  assert(typeof j.click_id === "string" && j.click_id.length > 0);
});

Deno.test("touch: honors a caller-supplied click_id", async () => {
  const res = await handleCapture(
    post({ network: "tiktok", surface: "ios", click_id: "my-click" }),
    deps({}),
  );
  assertEquals((await res.json()).click_id, "my-click");
});

// ── METHOD / CORS ────────────────────────────────────────────────────────────

Deno.test("OPTIONS preflight -> ok with CORS", async () => {
  const res = await handleCapture(
    new Request("https://x", { method: "OPTIONS" }),
    deps(),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Headers")?.includes("x-client-info"));
});

Deno.test("non-POST -> 405 (a purchase caller always POSTs)", async () => {
  const res = await handleCapture(new Request("https://x", { method: "GET" }), deps());
  assertEquals(res.status, 405);
});

// ── PII HASHING (SC-9) ───────────────────────────────────────────────────────

Deno.test("sha256Hex matches the pgcrypto sha256 hex vector", async () => {
  // echo -n "abc" | sha256sum  == pgcrypto encode(digest('abc','sha256'),'hex')
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
