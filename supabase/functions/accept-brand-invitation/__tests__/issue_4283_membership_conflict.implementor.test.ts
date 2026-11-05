// Issue #4283 — a unique-key clash in the accept RPC is a named 409, never a
// generic 500 `server` (which the Business app showed as "Couldn't reach
// Mingla"). Fails if the 23505 case is removed from mapRpcError.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check \
//   supabase/functions/accept-brand-invitation/__tests__/issue_4283_membership_conflict.implementor.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapRpcError, mapRpcMessage } from "../index.ts";

Deno.test("#4283 mapRpcError — 23505 → 409 invite_membership_conflict", () => {
  assertEquals(
    mapRpcError(
      "23505",
      'duplicate key value violates unique constraint "idx_brand_team_members_brand_user_active"',
    ),
    { status: 409, error: "invite_membership_conflict" },
  );
  assertEquals(mapRpcError("23505"), {
    status: 409,
    error: "invite_membership_conflict",
  });
});

Deno.test("#4283 the duplicate-key message alone is not mistaken for an invite state", () => {
  assertEquals(
    mapRpcMessage(
      'duplicate key value violates unique constraint "idx_brand_team_members_brand_user_active"',
    ),
    null,
  );
});

Deno.test("#4283 never maps a serialization failure (40001) as the conflict", () => {
  assertEquals(mapRpcError("40001"), null);
});
