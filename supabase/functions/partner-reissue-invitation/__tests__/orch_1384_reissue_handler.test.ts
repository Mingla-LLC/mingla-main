// ORCH-1384 — T-4 / T-4b / T-4c handler-execution probes for the REAL
// partner-reissue-invitation handler, run against a scripted supabase-js
// double (import-map mock — investigation P1–P3 harness pattern).
//
// What executes is the SHIPPED handler control flow — auth, validation,
// 404/403/409 mapping BEFORE any write, the RPC call shape, the Resend send,
// and the T-4c DELETE-rollback compensation. DB-side behavior (expire-now,
// link update atomicity) is separately pinned by the migration-shape test.
//
// Run: deno test --allow-read --allow-env --no-check \
//   --import-map=supabase/functions/partner-reissue-invitation/__tests__/import_map.json \
//   supabase/functions/partner-reissue-invitation/__tests__/orch_1384_reissue_handler.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import type {
  CapturedOp,
  ReissueScenario,
} from "./mock_supabase.ts";

// Env BEFORE importing the handler (it reads env inside the request path,
// but set everything up-front for determinism).
Deno.env.set("SUPABASE_URL", "http://mock.local");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
Deno.env.set("RESEND_API_KEY", "re_test_key");
Deno.env.set("MINGLA_BUSINESS_WEB_URL", "https://business.usemingla.com");

const { handler } = await import("../index.ts");

const PARTNER_ID = "6c61590c-0000-0000-0000-000000000001";
const LINK_ID = "11111111-2222-3333-4444-555555555555";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const NEW_INVITATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function baseScenario(): ReissueScenario {
  return {
    user: { id: PARTNER_ID, email: "partner@example.com" },
    linkRow: {
      id: LINK_ID,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      invited_owner_email: "owner@example.com",
      personal_note: "Built this for you!",
      accepted_at: null,
      cancelled_at: null,
    },
    brandRow: {
      id: BRAND_ID,
      name: "Rockstar Vibes",
      cover_media_url: null,
      cover_media_type: null,
      partner_setup: true,
    },
    inviterRow: { display_name: "Seth", business_name: null },
    rpc: {
      data: { invitation_id: NEW_INVITATION_ID, invitee_name: "Owner" },
      error: null,
    },
    captured: [],
    rpcCalls: [],
  };
}

function installScenario(s: ReissueScenario): ReissueScenario {
  (globalThis as Record<string, unknown>).__ORCH1384_REISSUE_SCENARIO = s;
  return s;
}

interface FetchStub {
  calls: Array<{ url: string; body: unknown }>;
}

function stubResend(ok: boolean): FetchStub {
  const stub: FetchStub = { calls: [] };
  globalThis.fetch = ((
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    let body: unknown = null;
    try {
      body = init?.body !== undefined ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    stub.calls.push({ url, body });
    return Promise.resolve(
      ok
        ? new Response(JSON.stringify({ id: "email_1" }), { status: 200 })
        : new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
  }) as typeof fetch;
  return stub;
}

function post(body: unknown, withAuth = true): Request {
  return new Request("http://mock.local/partner-reissue-invitation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? { Authorization: "Bearer test-jwt" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function writesTo(captured: CapturedOp[], table: string): CapturedOp[] {
  return captured.filter(
    (op) => op.table === table && op.op !== "select",
  );
}

Deno.test("T-4: same-email resend → 201; RPC carries the link's email; NO link writes; NO rollback", async () => {
  const s = installScenario(baseScenario());
  const resend = stubResend(true);

  const res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 201);
  const json = (await res.json()) as { invitation_id?: string };
  assertEquals(json.invitation_id, NEW_INVITATION_ID);

  // Exactly one RPC call, correct shape.
  assertEquals(s.rpcCalls.length, 1);
  const call = s.rpcCalls[0];
  assertEquals(call.name, "partner_reissue_brand_invitation");
  assertEquals(call.args.p_link_id, LINK_ID);
  assertEquals(call.args.p_partner_account_id, PARTNER_ID);
  assertEquals(call.args.p_new_email, "owner@example.com");
  assert(
    /^[0-9a-f]{64}$/.test(String(call.args.p_token_hash)),
    "p_token_hash must be a sha256 hex",
  );
  const expiresMs = new Date(String(call.args.p_expires_at)).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert(
    Math.abs(expiresMs - (Date.now() + sevenDays)) < 60_000,
    "p_expires_at must be ~now + 7 days (EXPIRY_DAYS pin)",
  );

  // NO partner_brand_links write of ANY kind (the 23505-swallow class is
  // structurally unreachable — F-7 cure) and no invitation writes either
  // (the RPC owns them).
  assertEquals(writesTo(s.captured, "partner_brand_links").length, 0);
  assertEquals(writesTo(s.captured, "brand_invitations").length, 0);

  // The link read (mapping) happened BEFORE the RPC fired.
  const linkReadIdx = s.captured.findIndex(
    (op) => op.table === "partner_brand_links" && op.op === "select",
  );
  assert(linkReadIdx >= 0, "link must be read for 404/403/409 mapping");

  // One Resend send with the fresh token in the accept URL.
  assertEquals(resend.calls.length, 1);
  const emailBody = resend.calls[0].body as { html?: string; to?: string[] };
  assertEquals(emailBody.to, ["owner@example.com"]);
  assert(
    String(emailBody.html).includes("accept-brand-invitation?token="),
    "email must carry the accept URL",
  );
});

Deno.test("T-4b: corrected email → RPC carries the NEW address (lowercased); email goes to it", async () => {
  const s = installScenario(baseScenario());
  const resend = stubResend(true);

  const res = await handler(
    post({ link_id: LINK_ID, new_email: "Corrected-Owner@Example.com" }),
  );
  assertEquals(res.status, 201);
  assertEquals(s.rpcCalls.length, 1);
  assertEquals(
    s.rpcCalls[0].args.p_new_email,
    "corrected-owner@example.com",
  );
  const emailBody = resend.calls[0].body as { to?: string[] };
  assertEquals(emailBody.to, ["corrected-owner@example.com"]);
});

Deno.test("T-4c: send failure → 502; new invitation DELETEd (never revoked); link untouched", async () => {
  const s = installScenario(baseScenario());
  stubResend(false);

  const res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 502);
  const json = (await res.json()) as { error?: string };
  assertEquals(json.error, "email_send_failed");

  // Compensation is a DELETE on the fresh invitation id — a DELETE cannot
  // fire the AFTER UPDATE OF status invite-kill trigger.
  const invWrites = writesTo(s.captured, "brand_invitations");
  assertEquals(invWrites.length, 1);
  assertEquals(invWrites[0].op, "delete");
  assert(
    invWrites[0].filters.some(
      (f) => f.m === "eq" && f.a[0] === "id" && f.a[1] === NEW_INVITATION_ID,
    ),
    "rollback DELETE must target the fresh invitation id",
  );
  // NEVER an update (a status='revoked' write would terminally cancel the
  // link being reissued — I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES).
  assertEquals(
    s.captured.filter(
      (op) => op.table === "brand_invitations" && op.op === "update",
    ).length,
    0,
  );
  // The link is never written by the handler (un-cancelled after a 502 —
  // SC-16's retry-fully-cures state).
  assertEquals(writesTo(s.captured, "partner_brand_links").length, 0);
});

Deno.test("auth + mapping: 401 without bearer; 404/403/409 map BEFORE any write; 400 bad email", async () => {
  // 401 — no Authorization header.
  installScenario(baseScenario());
  stubResend(true);
  let res = await handler(post({ link_id: LINK_ID }, false));
  assertEquals(res.status, 401);

  // 400 — malformed corrected address (validated before any read).
  installScenario(baseScenario());
  res = await handler(post({ link_id: LINK_ID, new_email: "not-an-email" }));
  assertEquals(res.status, 400);

  // 404 — link not found; no RPC fired.
  let s = installScenario({ ...baseScenario(), linkRow: null });
  res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 404);
  assertEquals((await res.json() as { error?: string }).error, "link_not_found");
  assertEquals(s.rpcCalls.length, 0);

  // 403 — someone else's link; no RPC fired.
  s = installScenario(baseScenario());
  (s.linkRow as Record<string, unknown>).partner_account_id = "other-user";
  res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 403);
  assertEquals(s.rpcCalls.length, 0);

  // 409 — already accepted; no RPC fired.
  s = installScenario(baseScenario());
  (s.linkRow as Record<string, unknown>).accepted_at =
    "2026-07-01T00:00:00Z";
  res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 409);
  assertEquals(
    (await res.json() as { error?: string }).error,
    "link_not_pending",
  );
  assertEquals(s.rpcCalls.length, 0);

  // 404 — brand soft-deleted/gone (brand_not_found), still before the RPC.
  s = installScenario({ ...baseScenario(), brandRow: null });
  res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 404);
  assertEquals(
    (await res.json() as { error?: string }).error,
    "brand_not_found",
  );
  assertEquals(s.rpcCalls.length, 0);
});

Deno.test("RPC error mapping: link_not_pending → 409; forbidden → 403", async () => {
  let s = installScenario(baseScenario());
  s.rpc = { data: null, error: { message: "link_not_pending" } };
  stubResend(true);
  let res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 409);

  s = installScenario(baseScenario());
  s.rpc = { data: null, error: { message: "forbidden" } };
  res = await handler(post({ link_id: LINK_ID }));
  assertEquals(res.status, 403);
});
