// #4490 Explorer W1 — claim-link accepts a loopback buyer web only on a local stack.
// FAILS-ON-REVERT: drop the local branch in webOriginAllowed and O-2 fails;
// drop the isLocalSupabaseUrl gate and O-3 fails.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { webOriginAllowed } from "../index.ts";

Deno.test("O-1 production origins always pass", () => {
  assertEquals(
    webOriginAllowed("https://host.usemingla.com", "https://abc.supabase.co"),
    true,
  );
  assertEquals(
    webOriginAllowed("https://usemingla.com", "https://abc.supabase.co"),
    true,
  );
});
Deno.test("O-2 a loopback web origin passes only on a local stack", () => {
  assertEquals(
    webOriginAllowed("http://127.0.0.1:8491", "http://kong:8000"),
    true,
  );
  assertEquals(
    webOriginAllowed("http://localhost:8491", "http://127.0.0.1:54321"),
    true,
  );
});
Deno.test("O-3 a deployed function never accepts loopback or other origins", () => {
  assertEquals(
    webOriginAllowed("http://127.0.0.1:8491", "https://abc.supabase.co"),
    false,
  );
  assertEquals(
    webOriginAllowed("https://evil.example", "http://kong:8000"),
    false,
  );
  assertEquals(
    webOriginAllowed("http://evil.localhost:8491", "http://kong:8000"),
    false,
  );
});
