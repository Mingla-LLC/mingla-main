// ORCH-1051 — happy-path regression for accept-scanner-invitation.
//
// Exercises the pure-logic contract the handler ships:
//   * SHA-256 token-hash mint stability (the RPC consumes the digest, not
//     the raw token)
//   * mapRpcError covers every documented ERRCODE in the RPC contract
//
// CLOSE Step 0.5: this test PASSES on the shipped contract at the head
// commit and MUST FAIL on revert (e.g. if mapRpcError loses a branch or
// the SHA-256 hash size changes).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/accept-scanner-invitation/__tests__/orch-1051-accept-happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { mapRpcError, sha256Hex } from "../index.ts";

Deno.test("sha256Hex — stable + 64 hex chars", async () => {
  const a = await sha256Hex("a-token-value");
  const b = await sha256Hex("a-token-value");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]+$/.test(a));
});

Deno.test("sha256Hex — distinct tokens produce distinct digests", async () => {
  const a = await sha256Hex("token-A");
  const b = await sha256Hex("token-B");
  assert(a !== b);
});

Deno.test("mapRpcError — P0001 → 404 invite_not_found", () => {
  const r = mapRpcError("P0001");
  assert(r !== null);
  if (r === null) return;
  assertEquals(r.status, 404);
  assertEquals(r.error, "invite_not_found");
});

Deno.test("mapRpcError — P0002 → 410 invite_already_used", () => {
  const r = mapRpcError("P0002");
  assert(r !== null);
  if (r === null) return;
  assertEquals(r.status, 410);
  assertEquals(r.error, "invite_already_used");
});

Deno.test("mapRpcError — P0003 → 410 invite_expired", () => {
  const r = mapRpcError("P0003");
  assert(r !== null);
  if (r === null) return;
  assertEquals(r.status, 410);
  assertEquals(r.error, "invite_expired");
});

Deno.test("mapRpcError — P0004 → 403 invite_email_mismatch", () => {
  const r = mapRpcError("P0004");
  assert(r !== null);
  if (r === null) return;
  assertEquals(r.status, 403);
  assertEquals(r.error, "invite_email_mismatch");
});

Deno.test("mapRpcError — P0005 → 410 invite_revoked", () => {
  const r = mapRpcError("P0005");
  assert(r !== null);
  if (r === null) return;
  assertEquals(r.status, 410);
  assertEquals(r.error, "invite_revoked");
});

Deno.test("mapRpcError — unknown ERRCODE returns null (handler falls through to 500)", () => {
  assertEquals(mapRpcError("FOOBAR"), null);
  assertEquals(mapRpcError(undefined), null);
});
