// ISSUE-865 WP-A — TESTER adversarial suite for attribution-capture.
//
// DIFFERENT ANGLE than the implementor's 12 (index.test.ts). The implementor's
// mock DISCARDS the row handed to the DB; this suite CAPTURES it and asserts the
// bytes that actually reach Postgres — the pre-insert sanitization the happy-path
// suite never inspects:
//   • value_cents SANITIZATION (index.ts:230) — a NEGATIVE value_cents is nulled
//     BEFORE insert (so the row is still recorded instead of being rejected by the
//     DB CHECK and dropped). <-- fails-on-revert anchor at a DIFFERENT line than the
//     implementor's outer try/catch anchor: delete "&& body.value_cents >= 0" from
//     line 230 and the captured row carries -5, failing T-ADV-1.
//   • PII is HASHED, never raw, never echoed (index.ts:219-224, SC-9) — the row
//     carries sha256(normalized) and NO raw email/phone key; the response body
//     never contains the raw PII.
//   • RATE LIMIT on the anon touch path (index.ts:96-100/271-273) — a line the
//     implementor never exercised: the 61st touch from one IP is soft-limited.
//   • isConversion ROUTING (index.ts:193) — event_id + kind:"touch" routes to the
//     touch path, not the conversion path.
//   • array/null bodies are absorbed (never 5xx).
//
// Runtime (COMMS-0106): exercises the exported handleCapture with an injected
// capturing mock — no source-grep. Append-only: NEW file, zero existing-test edits.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleCapture, sha256Hex, type CaptureDeps } from "./index.ts";

interface Captured {
  conversion?: Record<string, unknown>;
  touch?: Record<string, unknown>;
}

// Capturing mock: records the exact row object handed to upsert()/insert().
// deno-lint-ignore no-explicit-any
function capturingClient(cap: Captured, connectionId: string | null = null): any {
  return {
    from(table: string) {
      if (table === "ad_connections") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve(connectionId ? { data: { id: connectionId }, error: null } : { data: null, error: null }),
        };
        return b;
      }
      if (table === "ad_conversions") {
        return {
          upsert: (row: Record<string, unknown>) => {
            cap.conversion = row;
            return { select: () => Promise.resolve({ data: [{ id: "row-1" }], error: null }) };
          },
        };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          cap.touch = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function deps(cap: Captured, connectionId: string | null = null): CaptureDeps {
  return { getClient: () => capturingClient(cap, connectionId) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ── T-ADV-1 · value_cents sanitization (fails-on-revert anchor, index.ts:230) ──
Deno.test("adv: NEGATIVE value_cents is nulled before insert (row still recorded)", async () => {
  const cap: Captured = {};
  const res = await handleCapture(post({ kind: "conversion", event_id: "adv-neg", value_cents: -5 }), deps(cap));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  assert(cap.conversion, "a conversion row must have been handed to the DB");
  assertEquals(cap.conversion!.value_cents, null); // -5 must NOT reach the CHECK(value_cents>=0) column
});

Deno.test("adv: valid value_cents passes through unchanged", async () => {
  const cap: Captured = {};
  await handleCapture(post({ kind: "conversion", event_id: "adv-pos", value_cents: 2500 }), deps(cap));
  assertEquals(cap.conversion!.value_cents, 2500);
});

// ── T-ADV-2 · PII is hashed, never raw, never echoed (SC-9, index.ts:219-224) ──
Deno.test("adv: email/phone are SHA-256 hashed (normalized), raw never stored/echoed", async () => {
  const cap: Captured = {};
  const res = await handleCapture(
    post({ kind: "conversion", event_id: "adv-pii", email: "  Test@Example.COM ", phone: "+1 (555) 000-1234" }),
    deps(cap),
  );
  const row = cap.conversion!;
  assertEquals(row.hashed_email, await sha256Hex("test@example.com")); // trimmed + lowercased
  assertEquals(row.hashed_phone, await sha256Hex("15550001234")); // digits only
  assert(!("email" in row), "raw email must never be a column on the row");
  assert(!("phone" in row), "raw phone must never be a column on the row");
  const bodyText = await res.text();
  assert(!bodyText.includes("Test@Example"), "raw email must never be echoed in the response");
  assert(!bodyText.includes("555"), "raw phone must never be echoed in the response");
});

// ── T-ADV-3 · rate limit on the anon touch path (index.ts:96-100/271-273) ──────
Deno.test("adv: 61st touch from one IP is soft rate-limited (never an error)", async () => {
  const cap: Captured = {};
  const ip = "203.0.113.77"; // unique IP so the module bucket is not cross-contaminated
  let last: Response | null = null;
  for (let i = 0; i < 61; i++) {
    last = await handleCapture(post({ network: "meta", surface: "web" }, { "x-forwarded-for": ip }), deps(cap));
  }
  assertEquals(last!.status, 200); // soft, never 5xx
  assertEquals((await last!.json()).rate_limited, true);
});

Deno.test("adv: a single touch from a fresh IP is NOT rate-limited", async () => {
  const cap: Captured = {};
  const res = await handleCapture(post({ network: "meta", surface: "web" }, { "x-forwarded-for": "198.51.100.9" }), deps(cap));
  assertEquals((await res.json()).ok, true);
});

// ── T-ADV-4 · isConversion routing (index.ts:193) ──────────────────────────────
Deno.test("adv: event_id + kind:'touch' routes to the TOUCH path, not conversion", async () => {
  const cap: Captured = {};
  const res = await handleCapture(post({ event_id: "should-be-ignored", kind: "touch", network: "tiktok", surface: "ios" }), deps(cap));
  const j = await res.json();
  assertEquals(j.kind, "touch");
  assert(cap.touch, "must have written a touch row");
  assert(!cap.conversion, "must NOT have written a conversion row");
});

// ── T-ADV-5 · non-object bodies are absorbed (never 5xx) ───────────────────────
Deno.test("adv: JSON array body is absorbed with 200 (never 5xx)", async () => {
  const res = await handleCapture(post([1, 2, 3]), deps({}));
  assertEquals(res.status, 200);
});

Deno.test("adv: JSON null body -> 200 soft invalid_body (never 5xx)", async () => {
  const res = await handleCapture(post(null), deps({}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).soft_error, "invalid_body");
});
