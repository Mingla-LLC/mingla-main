// ISSUE-1734 — unit suite for the SINGLE shared app-lane module
// `_shared/growthToolsAuth.ts` (P-6): canonical JSON + input hash (P-22),
// quota caps + the ONE packed env override (P-21/P-23), the run-budget
// arithmetic (P-24, injected clock), and the P-3 auth chain against the
// harness stub (Bearer → getUser → brand UUID → membership; fail-closed on an
// unverifiable membership).
//
// fails-on-revert: unsorting canonicalJson turns the key-order test red;
// dropping the tool prefix from computeInputHash turns the tool-scoping test
// red; deleting the GROWTH_TOOLS_APP_LIMITS_JSON parse turns the override test
// red; flipping the membership-RPC-error branch to proceed turns the
// fail-closed test red.
//
// Run: deno test --allow-read --allow-env --allow-net \
//   supabase/functions/growth-tools-run/__tests__/issue_1734_shared_auth_unit.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appLaneCapForTool,
  authenticateAppLane,
  canonicalJson,
  computeInputHash,
  createRunBudget,
  RUN_BUDGET_MS,
} from "../../_shared/growthToolsAuth.ts";
import {
  BRAND_A,
  BRAND_B,
  installStub,
  STUB_URL,
  TOKEN_A,
  USER_A,
} from "./harness_1734.ts";

Deno.test("canonicalJson — key order never changes the string; nesting + arrays stable", () => {
  const a = canonicalJson({
    b: 2,
    a: 1,
    c: { z: [3, { y: 1, x: 2 }], w: null },
  });
  const b = canonicalJson({
    c: { w: null, z: [3, { x: 2, y: 1 }] },
    a: 1,
    b: 2,
  });
  assertEquals(a, b);
  assertEquals(canonicalJson({ k: undefined }), '{"k":null}');
  assertEquals(canonicalJson("x"), '"x"');
});

Deno.test("computeInputHash — stable per input, scoped per tool (P-22)", async () => {
  const input = { name: "A", city: "B", website: "https://a.b" };
  const h1 = await computeInputHash("venues", input);
  const h2 = await computeInputHash("venues", {
    website: "https://a.b",
    city: "B",
    name: "A",
  });
  assertEquals(h1, h2, "property order never changes the hash");
  assertEquals(h1.length, 64);
  const other = await computeInputHash("events", input);
  assert(h1 !== other, "the tool prefix scopes the hash");
});

Deno.test("appLaneCapForTool — defaults 10/25/15/15; ONE packed env overrides; malformed → defaults", () => {
  Deno.env.delete("GROWTH_TOOLS_APP_LIMITS_JSON");
  assertEquals(appLaneCapForTool("venues"), 10);
  assertEquals(appLaneCapForTool("events"), 25);
  assertEquals(appLaneCapForTool("trips"), 15);
  assertEquals(appLaneCapForTool("experiences"), 15);
  try {
    // The pricing engine's tool value is 'experiences'; its env key is "pricing" (P-23).
    Deno.env.set("GROWTH_TOOLS_APP_LIMITS_JSON", '{"venues":3,"pricing":7}');
    assertEquals(appLaneCapForTool("venues"), 3);
    assertEquals(appLaneCapForTool("experiences"), 7);
    assertEquals(
      appLaneCapForTool("events"),
      25,
      "unlisted tools keep defaults",
    );
    Deno.env.set("GROWTH_TOOLS_APP_LIMITS_JSON", "not-json{{");
    assertEquals(
      appLaneCapForTool("venues"),
      10,
      "malformed → defaults (+ console.error)",
    );
  } finally {
    Deno.env.delete("GROWTH_TOOLS_APP_LIMITS_JSON");
  }
});

Deno.test("createRunBudget — remaining/exhausted arithmetic with an injected clock (P-24)", () => {
  let now = 1_000_000;
  const budget = createRunBudget(120_000, () => now);
  assertEquals(budget.remainingMs(), 120_000);
  now += 100_000;
  assertEquals(budget.remainingMs(), 20_000);
  assertEquals(budget.exhausted(), false);
  now += 20_000;
  assertEquals(budget.remainingMs(), 0);
  assertEquals(budget.exhausted(), true);
  now += 5_000;
  assertEquals(budget.remainingMs(), 0, "never negative");
  // The four per-run budgets are the P-24 contract values.
  assertEquals(RUN_BUDGET_MS.venues, 120_000);
  assertEquals(RUN_BUDGET_MS.events, 100_000);
  assertEquals(RUN_BUDGET_MS.trips, 130_000);
  assertEquals(RUN_BUDGET_MS.experiences, 80_000);
});

function req(bearer?: string): Request {
  return new Request(`${STUB_URL}/functions/v1/stub`, {
    method: "POST",
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    body: "{}",
  });
}

function serviceClient() {
  return createClient(STUB_URL, "stub-service-role-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.test("authenticateAppLane — the P-3 chain: 401/400/403/500-fail-closed/OK", async () => {
  const stub = installStub({
    users: { [TOKEN_A]: USER_A },
    membership: (brandId, userId) => brandId === BRAND_A && userId === USER_A,
  });
  try {
    const supabase = serviceClient();
    // 1. No Bearer → 401.
    const noBearer = await authenticateAppLane(
      req(),
      { brand_id: BRAND_A },
      supabase,
    );
    assert(noBearer instanceof Response);
    assertEquals(noBearer.status, 401);
    // 2. Forged token → 401 (never downgraded, P-4).
    const forged = await authenticateAppLane(req("garbage"), {
      brand_id: BRAND_A,
    }, supabase);
    assert(forged instanceof Response);
    assertEquals(forged.status, 401);
    // 3. Bad brand_id → 400.
    const badBrand = await authenticateAppLane(req(TOKEN_A), {
      brand_id: "nope",
    }, supabase);
    assert(badBrand instanceof Response);
    assertEquals(badBrand.status, 400);
    // 4. Non-member → 403.
    const nonMember = await authenticateAppLane(req(TOKEN_A), {
      brand_id: BRAND_B,
    }, supabase);
    assert(nonMember instanceof Response);
    assertEquals(nonMember.status, 403);
    // Happy: verified ids.
    const ok = await authenticateAppLane(
      req(TOKEN_A),
      { brand_id: BRAND_A },
      supabase,
    );
    assert(!(ok instanceof Response));
    assertEquals(ok.userId, USER_A);
    assertEquals(ok.brandId, BRAND_A);
  } finally {
    stub.restore();
  }
  // Membership RPC error → 500 (FAIL CLOSED — P-3 step 4).
  const stub2 = installStub({
    users: { [TOKEN_A]: USER_A },
    membership: () => "error",
  });
  try {
    const failClosed = await authenticateAppLane(
      req(TOKEN_A),
      { brand_id: BRAND_A },
      serviceClient(),
    );
    assert(failClosed instanceof Response);
    assertEquals(failClosed.status, 500);
  } finally {
    stub2.restore();
  }
});
