import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ClaimLinkDeps, createClaimLinkHandler } from "../index.ts";

const FUNCTION_URL = "https://project.supabase.co/functions/v1/claim-link";
const MARKETING_ORIGIN = "https://usemingla.com";
const HOST_ORIGIN = "https://host.usemingla.com";
const PEPPER = {
  bytes: new Uint8Array(32).fill(7),
  format: "hex" as const,
  fingerprint: "test",
};

function request(input: {
  method?: "OPTIONS" | "POST";
  origin?: string;
  body?: Record<string, unknown>;
}): Request {
  const headers = new Headers();
  if (input.origin !== undefined) headers.set("origin", input.origin);
  if (input.method !== "OPTIONS") {
    headers.set("content-type", "application/json");
  }
  return new Request(FUNCTION_URL, {
    method: input.method ?? "POST",
    headers,
    body: input.method === "OPTIONS" ? undefined : JSON.stringify(input.body),
  });
}

function deps(): ClaimLinkDeps {
  return {
    rpc: (name) => {
      if (name === "pg_venue_order_rate_limit_hit") {
        return Promise.resolve({ data: { allowed: true }, error: null });
      }
      if (name === "resolve_claim_link") {
        return Promise.resolve({ data: { status: "not_found" }, error: null });
      }
      if (name === "mint_claim_link_handoff") {
        return Promise.resolve({
          data: {
            outcome: "ok",
            code: "ZX12CV34BN",
            expiresAt: "2026-10-27T16:00:00Z",
          },
          error: null,
        });
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    pepper: () => Promise.resolve(PEPPER),
    userId: () => Promise.resolve(null),
    sendEmail: () => Promise.resolve(true),
    createEmailUser: () => Promise.resolve(true),
    magicLinkToken: () => Promise.resolve("one-time-token-hash"),
  };
}

function assertCors(response: Response, origin: string): void {
  assertEquals(response.headers.get("access-control-allow-origin"), origin);
  assertEquals(
    response.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
  assertEquals(response.headers.get("vary"), "Origin");
}

Deno.test("#3902 Host buyer web preflight echoes its exact allowed origin", async () => {
  const response = await createClaimLinkHandler(deps())(
    request({ method: "OPTIONS", origin: HOST_ORIGIN }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
  assertCors(response, HOST_ORIGIN);
});

Deno.test("#3902 Host buyer web can resolve and mint a handoff with browser CORS", async () => {
  const handler = createClaimLinkHandler(deps());
  const resolveResponse = await handler(request({
    origin: HOST_ORIGIN,
    body: { op: "resolve", code: "AB12CD34EF" },
  }));
  assertEquals(resolveResponse.status, 200);
  assertEquals(await resolveResponse.json(), { ok: true, status: "not_found" });
  assertCors(resolveResponse, HOST_ORIGIN);

  const handoffResponse = await handler(request({
    origin: HOST_ORIGIN,
    body: { op: "handoff", code: "AB12CD34EF" },
  }));
  assertEquals(handoffResponse.status, 200);
  assertEquals(await handoffResponse.json(), {
    ok: true,
    handoffUrl: "https://usemingla.com/c/ZX12CV34BN",
    expiresAt: "2026-10-27T16:00:00Z",
  });
  assertCors(handoffResponse, HOST_ORIGIN);
});

Deno.test("#3902 unlisted and lookalike origins remain denied", async () => {
  const handler = createClaimLinkHandler(deps());
  for (
    const origin of [
      "https://evil.example",
      "https://host.usemingla.com.evil.example",
      "http://host.usemingla.com",
      "https://host.usemingla.com:443",
      "null",
    ]
  ) {
    for (const method of ["OPTIONS", "POST"] as const) {
      const response = await handler(request({
        method,
        origin,
        body: { op: "resolve", code: "AB12CD34EF" },
      }));
      assertEquals(response.status, 403);
      assertEquals(await response.json(), {
        ok: false,
        error: "origin_denied",
      });
      assertNotEquals(
        response.headers.get("access-control-allow-origin"),
        origin,
      );
    }
  }
});

Deno.test("#3902 native requests and the marketing web origin keep working", async () => {
  const handler = createClaimLinkHandler(deps());
  for (const origin of [undefined, MARKETING_ORIGIN]) {
    const response = await handler(request({
      origin,
      body: { op: "resolve", code: "AB12CD34EF" },
    }));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, status: "not_found" });
    assertCors(response, MARKETING_ORIGIN);
  }
});
