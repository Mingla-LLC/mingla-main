// ORCH-1050 — happy-path regression for accept-brand-invitation.
//
// Exercises the pure-logic contract: SHA-256 token hashing + RPC error
// code → HTTP status mapping. The atomic accept + transfer logic lives
// inside the SECURITY DEFINER RPC and is covered by Postgres-level
// invariants (FOR UPDATE lock + ERRCODE map) + the adversarial test.
//
// CLOSE Step 0.5: this test PASSES on commit 67f24b776 and MUST FAIL on
// revert (e.g. if mapRpcError loses the ERRCODE → HTTP mapping, or if
// the SHA-256 hash size shifts).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/accept-brand-invitation/__tests__/orch-1050-accept-happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { mapRpcError, sha256Hex } from "../index.ts";

Deno.test("sha256Hex — produces a 64-char lowercase hex digest", async () => {
  const hex = await sha256Hex("test-token-value");
  assertEquals(hex.length, 64);
  assert(/^[0-9a-f]+$/.test(hex));
});

Deno.test("mapRpcError — P0001 → 404 invite_not_found", () => {
  const mapped = mapRpcError("P0001");
  assert(mapped);
  if (!mapped) return;
  assertEquals(mapped.status, 404);
  assertEquals(mapped.error, "invite_not_found");
});

Deno.test("mapRpcError — P0002 → 410 invite_already_used", () => {
  const mapped = mapRpcError("P0002");
  assert(mapped);
  if (!mapped) return;
  assertEquals(mapped.status, 410);
  assertEquals(mapped.error, "invite_already_used");
});

Deno.test("mapRpcError — P0003 → 410 invite_expired", () => {
  const mapped = mapRpcError("P0003");
  assert(mapped);
  if (!mapped) return;
  assertEquals(mapped.status, 410);
  assertEquals(mapped.error, "invite_expired");
});

Deno.test("mapRpcError — P0004 → 403 invite_email_mismatch", () => {
  const mapped = mapRpcError("P0004");
  assert(mapped);
  if (!mapped) return;
  assertEquals(mapped.status, 403);
  assertEquals(mapped.error, "invite_email_mismatch");
});

Deno.test("mapRpcError — P0005 → 410 invite_revoked", () => {
  const mapped = mapRpcError("P0005");
  assert(mapped);
  if (!mapped) return;
  assertEquals(mapped.status, 410);
  assertEquals(mapped.error, "invite_revoked");
});

Deno.test("mapRpcError — unknown ERRCODE → null", () => {
  assertEquals(mapRpcError("23505"), null);
  assertEquals(mapRpcError(undefined), null);
});
