import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { corsHeaders as sharedCorsHeaders } from "../_shared/cors.ts";
import { handler } from "./index.ts";

Deno.test("#1993 happy: contact import extends the shared browser CORS contract", async () => {
  const response = await handler(
    new Request("http://localhost", { method: "OPTIONS" }),
  );
  const allowed = new Set(
    (response.headers.get("access-control-allow-headers") ?? "")
      .split(",")
      .map((header) => header.trim().toLowerCase()),
  );
  const shared = new Set(
    sharedCorsHeaders["Access-Control-Allow-Headers"]
      .split(",")
      .map((header) => header.trim().toLowerCase()),
  );

  for (
    const header of [
      "authorization",
      "x-client-info",
      "apikey",
      "content-type",
      "accept-language",
      "x-mingla-import-action",
      "x-mingla-brand-id",
    ]
  ) {
    assert(allowed.has(header), `preflight omitted ${header}`);
  }
  for (const header of shared) {
    assert(
      allowed.has(header),
      `contact import narrowed shared CORS: ${header}`,
    );
  }
  assertEquals(allowed.size, shared.size + 2);
});
