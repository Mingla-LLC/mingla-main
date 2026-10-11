/**
 * toward #3697 Wave 0d / #3702 (public AC): anon attribution-capture must not
 * write conversion rows; touch + consent remain available. Append-only.
 *
 * Run: deno test --allow-none supabase/functions/attribution-capture/issue_3697_wave0_trusted_conversion.test.ts
 */
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleCapture, type CaptureDeps } from "./index.ts";

// deno-lint-ignore no-explicit-any
function mockClient(cap: { conversion?: unknown; touch?: unknown; consent?: unknown }): any {
  return {
    from(table: string) {
      if (table === "ad_connections") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return b;
      }
      if (table === "ad_conversions") {
        return {
          upsert: (row: unknown) => {
            cap.conversion = row;
            return {
              select: () => Promise.resolve({ data: [{ id: "x" }], error: null }),
            };
          },
        };
      }
      if (table === "ad_attribution_touches") {
        return {
          insert: (row: unknown) => {
            cap.touch = row;
            return Promise.resolve({ error: null });
          },
          update: (row: unknown) => {
            cap.consent = row;
            const b = {
              eq: () => b,
              select: () => b,
              maybeSingle: () =>
                Promise.resolve({ data: { id: "touch-1" }, error: null }),
            };
            return b;
          },
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  };
}

function deps(cap: {
  conversion?: unknown;
  touch?: unknown;
  consent?: unknown;
}): CaptureDeps {
  return { getClient: () => mockClient(cap) };
}

function post(body: unknown): Request {
  return new Request("https://x/attribution-capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("F-3702: kind:conversion is refused and never upserts", async () => {
  const cap: { conversion?: unknown } = {};
  const res = await handleCapture(
    post({ kind: "conversion", event_id: "forged", value_cents: 999 }),
    deps(cap),
  );
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, false);
  assertEquals(j.soft_error, "conversion_requires_trusted_path");
  assertEquals(cap.conversion, undefined);
});

Deno.test("F-3702: event_id alone (legacy) is refused as conversion", async () => {
  const cap: { conversion?: unknown } = {};
  const res = await handleCapture(
    post({ event_id: "legacy-forge", event_name: "Purchase" }),
    deps(cap),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).soft_error, "conversion_requires_trusted_path");
  assertEquals(cap.conversion, undefined);
});

Deno.test("F-1: touch with consent_state=pending is recorded", async () => {
  const cap: { touch?: Record<string, unknown> } = {};
  const res = await handleCapture(
    post({
      kind: "touch",
      network: "meta",
      external_click_id: "fbclid-pre",
      consent_state: "pending",
      mc_id: "camp-ext-1",
    }),
    deps(cap),
  );
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(typeof j.click_id, "string");
  assertEquals(cap.touch?.consent_state, "pending");
});

Deno.test("F-3: consent kind stamps rejected on click_id", async () => {
  const cap: { consent?: Record<string, unknown> } = {};
  const res = await handleCapture(
    post({
      kind: "consent",
      click_id: "click-abc",
      consent_state: "rejected",
    }),
    deps(cap),
  );
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.ok, true);
  assertEquals(j.consent_state, "rejected");
  assertEquals(cap.consent?.consent_state, "rejected");
});
