// #4490 spec 08 O5 fix 3 — the edge side of "a fresh PIN, used once":
// - the guest refund decision on a Till device login needs a PIN session and
//   a fresh refund PIN for that order (refundDecisionGate);
// - a sold-out swap on a Till device that carries a PIN asks for the
//   swap_refund approval; the database's pin_step_up_required and
//   sold_out_key_reused keep their codes;
// - with no PIN gate function a Till device login never acts as itself
//   (resolveTillActor fails closed);
// - venue-till and the daily close answer pin_step_up_required with 403 and
//   know day_close_request_stale.
// FAILS-ON-REVERT: drop the gate in refundDecisionGate and F3E-1 fails; ask
// for "refund" on a swap and F3E-4 fails; let a missing gate act as itself and
// F3E-6 fails; drop the 403 mapping and F3E-8 fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refundDecisionStepUp } from "../refundDecisionGate.ts";
import { handleStockAction, STOCK_STATUS } from "../stockActions.ts";
import { resolveTillActor } from "../../_shared/venueTillStaffSession.ts";
import { tillFailure } from "../../venue-till/index.ts";
import {
  DAY_CLOSE_SAFE_CODES,
  dayCloseFailure,
} from "../../venue-till/dayClose.ts";

const VENUE = "44906180-0000-4000-9000-0000000000a1";
const ORDER = "44906180-0000-4000-e000-0000000000AA";
const LINE = "44906180-0000-4000-f000-000000000001";
const SWAP = "44906180-0000-4000-b000-000000000013";
const DEVICE = "44906180-0000-4000-8000-000000000005";
const MEMBER = "44906180-0000-4000-8000-000000000002";
const MANAGER = "44906180-0000-4000-8000-000000000003";
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) =>
  b.toString(16).padStart(2, "0")
).join("");

type Call = { name: string; params: Record<string, unknown> };
type Answer = {
  data?: unknown;
  error?: { code?: string; message?: string; details?: string } | null;
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status });

function fake(opts: {
  gated?: boolean;
  gateMissing?: boolean;
  grants?: unknown[] | "error";
  answers?: Record<string, Answer>;
} = {}) {
  const calls: Call[] = [];
  const rpc = (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    if (name === "issue_4490_pin_gate") {
      return Promise.resolve(
        opts.gateMissing
          ? {
            data: null,
            error: { code: "PGRST202", message: "Could not find the function" },
          }
          : { data: opts.gated === true, error: null },
      );
    }
    if (name === "issue_4490_pin_session_resolve") {
      return Promise.resolve({
        data: { sessionId: "s1", memberId: "m1", memberUserId: MEMBER },
        error: null,
      });
    }
    if (name === "issue_4490_pin_approve" && !opts.answers?.[name]) {
      return Promise.resolve({
        data: { ok: true, approverUserId: MANAGER, approvalId: "a1" },
        error: null,
      });
    }
    const a = opts.answers?.[name] ?? {};
    return Promise.resolve({ data: a.data ?? {}, error: a.error ?? null });
  };
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      contains: () => builder,
      limit: () =>
        Promise.resolve(
          opts.grants === "error"
            ? { data: null, error: { code: "57014" } }
            : { data: opts.grants ?? [], error: null },
        ),
      maybeSingle: () =>
        Promise.resolve({
          data: table === "venue_orders"
            ? { id: ORDER.toLowerCase(), venue_id: VENUE }
            : null,
          error: null,
        }),
    };
    return builder;
  };
  return { calls, rpc, from };
}

Deno.test("F3E-1 a Till device login approving a guest refund with no PIN is asked for one; nothing is decided", async () => {
  const c = fake({ gated: true });
  const res = await refundDecisionStepUp(c, {
    orderId: ORDER,
    userId: DEVICE,
    jwt: "jwt",
    body: { staffSession: TOKEN },
  }, respond);
  assert(res !== null);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "pin_step_up_required");
  assert(!c.calls.some((x) => x.name === "issue_4490_pin_approve"));
});

Deno.test("F3E-2 with no PIN session at all it is refused (401)", async () => {
  const c = fake({ gated: true });
  const res = await refundDecisionStepUp(c, {
    orderId: ORDER,
    userId: DEVICE,
    jwt: "jwt",
    body: {},
  }, respond);
  assert(res !== null);
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "pin_session_required");
});

Deno.test("F3E-3 with a fresh PIN the refund approval is for THIS order (purpose refund); a normal login is never asked", async () => {
  const c = fake({ gated: true });
  const res = await refundDecisionStepUp(c, {
    orderId: ORDER,
    userId: DEVICE,
    jwt: "jwt",
    body: { staffSession: TOKEN, stepUp: { pin: "4826" } },
  }, respond);
  assertEquals(res, null);
  const approve = c.calls.find((x) => x.name === "issue_4490_pin_approve")!;
  assertEquals(approve.params.p_purpose, "refund");
  assertEquals(approve.params.p_target, ORDER.toLowerCase());
  assertEquals(approve.params.p_device_user, DEVICE);
  const n = fake({ gated: false });
  assertEquals(
    await refundDecisionStepUp(n, {
      orderId: ORDER,
      userId: MANAGER,
      jwt: "jwt",
      body: {},
    }, respond),
    null,
  );
  assert(!n.calls.some((x) => x.name === "issue_4490_pin_approve"));
});

Deno.test("F3E-4 a swap on a Till device with a PIN asks for the swap_refund approval and runs as the approver", async () => {
  const c = fake({ gated: true, answers: { issue_4490_order_sold_out_resolve: { data: { resolution: "swap" } } } });
  const res = await handleStockAction(c, "sold_out_resolve", {
    venueId: VENUE,
    orderId: ORDER,
    orderItemIds: [LINE],
    resolution: "swap",
    swapMenuItemId: SWAP,
    requestId: "req-swap-0001",
    staffSession: TOKEN,
    stepUp: { pin: "4826" },
  }, { userId: DEVICE, jwt: "jwt" }, respond);
  assertEquals(res.status, 200);
  const approve = c.calls.find((x) => x.name === "issue_4490_pin_approve")!;
  assertEquals(approve.params.p_purpose, "swap_refund");
  assertEquals(approve.params.p_target, ORDER.toLowerCase());
  const call = c.calls.find((x) => x.name === "issue_4490_order_sold_out_resolve")!;
  assertEquals(call.params.p_actor, MANAGER);
  assertEquals(call.params.p_device_user, DEVICE);
});

Deno.test("F3E-5 a swap with no PIN goes straight to the database; its pin_step_up_required (403) and sold_out_key_reused (409) keep their codes", async () => {
  for (
    const [message, code, status] of [
      ["pin_step_up_required", "P0001", 403],
      ["sold_out_key_reused", "PT409", 409],
    ] as const
  ) {
    const c = fake({
      gated: true,
      answers: { issue_4490_order_sold_out_resolve: { error: { code, message } } },
    });
    const res = await handleStockAction(c, "sold_out_resolve", {
      venueId: VENUE,
      orderId: ORDER,
      orderItemIds: [LINE],
      resolution: "swap",
      swapMenuItemId: SWAP,
      requestId: "req-swap-0002",
      staffSession: TOKEN,
    }, { userId: DEVICE, jwt: "jwt" }, respond);
    assertEquals(res.status, status, message);
    assertEquals((await res.json()).error, message);
    assert(!c.calls.some((x) => x.name === "issue_4490_pin_approve"));
  }
  assertEquals(STOCK_STATUS.pin_step_up_required, 403);
});

Deno.test("F3E-6 no PIN gate function: a Till device login (or an unreadable grant) is refused, never acts as itself", async () => {
  for (const grants of [[{ venue_id: VENUE }], "error"] as const) {
    const c = fake({ gateMissing: true, grants: grants as unknown[] | "error" });
    const who = await resolveTillActor(c, {
      venueId: VENUE,
      userId: DEVICE,
      jwt: "jwt",
      staffSession: null,
    });
    assertEquals(who.ok, false);
    if (!who.ok) assertEquals(who.status, 503);
  }
});

Deno.test("F3E-7 no PIN gate function: an account that is not a Till device runs as itself (deploy order)", async () => {
  const c = fake({ gateMissing: true, grants: [] });
  const who = await resolveTillActor(c, {
    venueId: VENUE,
    userId: MANAGER,
    jwt: "jwt",
    staffSession: null,
  });
  assert(who.ok);
  if (who.ok) {
    assertEquals(who.actor.actorUserId, MANAGER);
    assertEquals(who.actor.isDevice, false);
  }
});

Deno.test("F3E-8 venue-till and the daily close answer the database's pin_step_up_required with 403; a stale close request is a 409", async () => {
  const till = tillFailure({ code: "P0001", message: "pin_step_up_required" });
  assertEquals(till.status, 403);
  assertEquals((await till.json()).code, "pin_step_up_required");
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });
  const day = dayCloseFailure({ code: "P0001", message: "pin_step_up_required" }, json);
  assertEquals(day.status, 403);
  assertEquals((await day.json()).code, "pin_step_up_required");
  const stale = dayCloseFailure({ code: "PT409", message: "day_close_request_stale" }, json);
  assertEquals(stale.status, 409);
  assertEquals((await stale.json()).code, "day_close_request_stale");
  assert((DAY_CLOSE_SAFE_CODES as readonly string[]).includes("day_close_request_stale"));
});
