// ORCH-1384 INVESTIGATE — Q-d probe: execute the REAL invite-brand-member
// handler (imported from the worktree) under an import-map that swaps
// @supabase/supabase-js for a scripted mock (mock_supabase.ts). Proves the
// handler's control flow for:
//   P1  2nd invite for a DIFFERENT brand (partner already has a link)
//       → expect 201, brand_invitations INSERT + partner_brand_links INSERT.
//   P2  re-send for SAME brand + SAME email while a pending unexpired
//       brand_invitations row exists → expect 409 already_invited, NO insert.
//   P3  SAME brand, DIFFERENT (corrected) email — duplicate guard passes;
//       partner_brand_links INSERT hits 23505 (partial unique index
//       (partner_account_id, brand_id) WHERE cancelled_at IS NULL) → expect
//       201, invitation row carries the NEW email while the link INSERT was
//       conflicted-and-swallowed (link keeps the OLD email → stale row).
//
// Run:
//   deno test --allow-env --allow-net --allow-read \
//     --import-map=/tmp/orch-1384/import_map.json \
//     /tmp/orch-1384/qd_invite_handler_probe.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handler } from "file:///Users/sethogieva/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/supabase/functions/invite-brand-member/index.ts";
import type { CapturedOp, Scenario } from "./mock_supabase.ts";

const PARTNER_ID = "6c61590c-4e8e-4040-bd7c-29870ba6d736";
const BRAND_A = "277edcdf-38b0-4f33-a48b-dc2c6061075f"; // existing link (Rockstar Vibes shape)
const BRAND_B = "99999999-9999-4999-8999-999999999999"; // NEW 2nd client brand

Deno.env.set("SUPABASE_URL", "http://mock.local");
Deno.env.set("SUPABASE_ANON_KEY", "ANON_KEY_FAKE");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_KEY_FAKE");
Deno.env.set("RESEND_API_KEY", "re_fake_key");

// Intercept the Resend call; refuse anything else that isn't a module fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.resend.com/")) {
    return Promise.resolve(
      new Response(JSON.stringify({ id: "email_mock_1" }), { status: 200 }),
    );
  }
  return realFetch(input as never, init);
}) as typeof fetch;

function freshScenario(over: Partial<Scenario> = {}): Scenario {
  const s: Scenario = {
    user: { id: PARTNER_ID, email: "seth@usemingla.com" },
    rank: 60, // brand_owner of the (pre-accept) client brand
    brandRow: {
      id: BRAND_B,
      name: "Second Client Brand",
      cover_media_url: null,
      cover_media_type: null,
      partner_setup: true,
    },
    duplicateInviteRow: null,
    invitationInsert: { data: { id: "inv-new-1" }, error: null },
    linkInsert: { error: null },
    captured: [],
    ...over,
  };
  (globalThis as Record<string, unknown>).__ORCH1384_SCENARIO = s;
  return s;
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://mock.local/invite-brand-member", {
    method: "POST",
    headers: {
      "Authorization": "Bearer fake.jwt.token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function ops(s: Scenario, table: string, op: string): CapturedOp[] {
  return s.captured.filter((c) => c.table === table && c.op === op);
}

Deno.test("P1 — 2nd invite, DIFFERENT brand → 201; invitation + link INSERTs fire", async () => {
  const s = freshScenario();
  const res = await handler(post({
    brand_id: BRAND_B,
    invitee_email: "newowner@example.com",
    invitee_name: "New Owner",
    role: "brand_owner",
    partner_setup: true,
    personal_note: "Built this for you",
  }));
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.invitation_id, "inv-new-1");
  // brand_invitations INSERT carried the new brand + email
  const invIns = ops(s, "brand_invitations", "insert");
  assertEquals(invIns.length, 1);
  const invPayload = invIns[0].args as Record<string, unknown>;
  assertEquals(invPayload.brand_id, BRAND_B);
  assertEquals(invPayload.email, "newowner@example.com");
  // partner_brand_links INSERT fired for (partner, BRAND_B)
  const linkIns = ops(s, "partner_brand_links", "insert");
  assertEquals(linkIns.length, 1);
  const linkPayload = linkIns[0].args as Record<string, unknown>;
  assertEquals(linkPayload.partner_account_id, PARTNER_ID);
  assertEquals(linkPayload.brand_id, BRAND_B);
  assertEquals(linkPayload.invited_owner_email, "newowner@example.com");
  console.log("P1 PROOF: 201 +", JSON.stringify({ invPayload, linkPayload }));
});

Deno.test("P2 — re-send SAME brand+email while pending+unexpired → 409 already_invited, no INSERT", async () => {
  const s = freshScenario({
    brandRow: {
      id: BRAND_A,
      name: "Rockstar Vibes",
      cover_media_url: null,
      cover_media_type: null,
      partner_setup: true,
    },
    duplicateInviteRow: { id: "inv-existing-1" }, // guard finds the live pending row
  });
  const res = await handler(post({
    brand_id: BRAND_A,
    invitee_email: "debranyakundi@gmail.com",
    invitee_name: "Debra",
    role: "brand_owner",
    partner_setup: true,
  }));
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "already_invited");
  assertEquals(ops(s, "brand_invitations", "insert").length, 0);
  assertEquals(ops(s, "partner_brand_links", "insert").length, 0);
  console.log("P2 PROOF: 409 already_invited; zero inserts");
});

Deno.test("P3 — SAME brand, DIFFERENT email; link INSERT 23505 swallowed → 201, invitation has NEW email, link row untouched (stale)", async () => {
  const s = freshScenario({
    brandRow: {
      id: BRAND_A,
      name: "Rockstar Vibes",
      cover_media_url: null,
      cover_media_type: null,
      partner_setup: true,
    },
    duplicateInviteRow: null, // different email → guard passes
    linkInsert: {
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "partner_brand_links_partner_brand_active_idx"',
      },
    },
  });
  const res = await handler(post({
    brand_id: BRAND_A,
    invitee_email: "corrected-owner@example.com",
    invitee_name: "Debra",
    role: "brand_owner",
    partner_setup: true,
  }));
  assertEquals(res.status, 201); // 23505 swallowed non-fatally
  const invIns = ops(s, "brand_invitations", "insert");
  assertEquals(invIns.length, 1);
  assertEquals(
    (invIns[0].args as Record<string, unknown>).email,
    "corrected-owner@example.com",
  );
  const linkIns = ops(s, "partner_brand_links", "insert");
  assertEquals(linkIns.length, 1); // attempted…
  // …but conflicted: the handler swallowed 23505, meaning the EXISTING active
  // link row (old email) is what survives. New invitation email ≠ link email:
  // the accept-RPC stamp (matched on lower(invited_owner_email)) can never fire.
  console.log(
    "P3 PROOF: 201 with link INSERT conflicted+swallowed — invitation email is corrected-owner@example.com while the active link keeps the ORIGINAL email",
  );
});
