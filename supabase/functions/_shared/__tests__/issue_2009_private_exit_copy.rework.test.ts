// deno-lint-ignore-file no-explicit-any require-await
//
// issue #2009 — IMPLEMENTOR REWORK COVERAGE for pass-1 TEST REPORT P2-2,
// Ari's half.
//
// THE DEFECT. `business_set_event_visibility` raises the SAME stable code,
// `private_visibility_unavailable`, on BOTH legs of the Private boundary:
//   * entering  — the organiser asked for Private, which #2144 has not enabled;
//   * leaving   — the event IS already Private and cannot be moved out yet.
// Ari's `ISSUE_2009_VISIBILITY_COPY` mapped that one code to one sentence,
// "Private events are not ready to accept invited guests yet. Choose Public or
// Unlisted for now." On the exit leg that tells someone who has just asked for
// Public to choose Public.
//
// WHAT THIS FILE PROVES. It EXECUTES the real `update_event` executor out of
// the real AGENT_TOOLS registry against a client double that reproduces the
// shipped RPC's refusal on each leg, and reads the sentence the caller actually
// receives. Nothing here asserts on source text (#2113).
//
// It also pins the two ways this fix could be vacuous:
//   * the entering copy must be UNCHANGED and verbatim — a "fix" that reworded
//     both legs would satisfy a naive difference check while breaking the
//     approved copy;
//   * the ToolError CODE must stay the same on both legs, because the code is
//     the machine-readable contract and only the human sentence was wrong.
//     (`agentTools.ts` upper-cases the code — the trap that nearly made the
//     pass-1 status fix vacuous — so the expectation is spelled out literally.)
//
// Run with:
//   deno test --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/issue_2009_private_exit_copy.rework.test.ts

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_ID = "66666666-6666-4666-8666-666666666666";
const USER_ID = "77777777-7777-4777-8777-777777777777";

/** The approved entering-Private sentence, verbatim (BINDING SPEC §6). */
const APPROVED_ENTERING_COPY =
  "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.";

interface Row {
  id: string;
  brand_id: string;
  title: string;
  event_type: string;
  status: string;
  visibility: string;
  updated_at: string;
  deleted_at: string | null;
}

function updateEventTool() {
  const found = AGENT_TOOLS.find((candidate) => candidate.name === "update_event");
  if (!found) throw new Error("missing tool fixture: update_event");
  return found;
}

/**
 * A client double over one row whose `business_set_event_visibility` refuses
 * BOTH legs of the Private boundary with the shipped code — exactly as the
 * migration's step (7) does.
 */
function dbDouble(row: Row) {
  const client: any = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "business_set_event_visibility") {
        return Promise.resolve({ data: 50, error: null });
      }
      const requested = String(args.p_requested_visibility ?? "").trim().toLowerCase();
      const target = requested === "unlisted" ? "hidden" : requested;
      if (target === "private" || row.visibility === "private") {
        return Promise.resolve({
          data: null,
          error: { message: "private_visibility_unavailable" },
        });
      }
      return Promise.resolve({
        data: {
          eventId: row.id,
          requestedVisibility: requested,
          storedVisibility: target,
          previousStoredVisibility: row.visibility,
          updatedAt: row.updated_at,
          changed: true,
          revokedShareCount: 0,
        },
        error: null,
      });
    },
    from(_table: string) {
      const q: any = {};
      q.select = () => q;
      q.eq = () => q;
      q.is = () => q;
      q.update = () => q;
      q.maybeSingle = () => Promise.resolve({ data: { ...row }, error: null });
      q.single = () => Promise.resolve({ data: { ...row }, error: null });
      return q;
    },
  };
  return client;
}

function liveEvent(overrides: Partial<Row> = {}): Row {
  return {
    id: EVENT_ID,
    brand_id: BRAND_ID,
    title: "Warehouse Set",
    event_type: "event",
    status: "live",
    visibility: "public",
    updated_at: "2026-08-17T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

async function refusal(row: Row, visibility: string): Promise<ToolError> {
  const client = dbDouble(row);
  try {
    await updateEventTool().executor(
      { event_id: row.id, visibility },
      client,
      USER_ID,
    );
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error(`expected a refusal for visibility=${visibility}, got success`);
}

// ---------------------------------------------------------------------------
// The ENTERING leg is unreachable through Ari, and that is a KNOWN, ACCEPTED
// condition — not something this rework introduced. `update_event`'s advertised
// schema declares `visibility` as `["draft","public","unlisted"]`, and
// `secureAgentTools` validates against that enum before the executor runs, so
// the literal `private` is refused as INVALID_ARGS upstream. That mismatch is
// #2149 and AMENDMENT 3B explicitly places it out of scope.
//
// Asserted here rather than assumed, because it is the reason the entering-copy
// pin below cannot be an executed one on this surface — and because if #2149 is
// ever fixed, this assertion flips and whoever fixes it is told, in this file,
// that the entering leg now needs its own executed copy test.
Deno.test("#2009 P2-2 (Ari) — RECORDED: the ENTERING leg is refused upstream by the advertised enum (#2149)", async () => {
  const error = await refusal(liveEvent({ visibility: "public" }), "private");
  assertEquals(
    error.code,
    "INVALID_ARGS",
    "if this is no longer INVALID_ARGS then #2149 was fixed, the entering leg became " +
      "reachable through Ari, and it needs an executed copy assertion here",
  );
});

// ---------------------------------------------------------------------------
Deno.test("#2009 P2-2 (Ari) — LEAVING Private gets copy that is true of the exit leg", async () => {
  const error = await refusal(liveEvent({ visibility: "private" }), "public");

  assertEquals(
    error.code,
    "PRIVATE_VISIBILITY_UNAVAILABLE",
    "the machine-readable code is the contract and must NOT change — only the sentence was wrong",
  );
  assertEquals(
    error.message === APPROVED_ENTERING_COPY,
    false,
    "an organiser leaving Private must not be told to 'Choose Public or Unlisted for now' — " +
      "that is precisely what they just asked for",
  );
  assertStringIncludes(
    error.message.toLowerCase(),
    "private",
    "the exit sentence still has to name the state the event is stuck in",
  );
  assertStringIncludes(
    error.message.toLowerCase(),
    "nothing was changed",
    "Ari never leaves a failed write ambiguous about whether anything landed",
  );
  assertStringIncludes(
    error.message.toLowerCase(),
    "support",
    "and it has to name the route that actually exists today (the Admin console, via support)",
  );
});

// ---------------------------------------------------------------------------
Deno.test("#2009 P2-2 (Ari) — the same exit leg also fires for Unlisted, not just Public", async () => {
  const error = await refusal(liveEvent({ visibility: "private" }), "unlisted");
  assertEquals(error.code, "PRIVATE_VISIBILITY_UNAVAILABLE");
  assertEquals(
    error.message === APPROVED_ENTERING_COPY,
    false,
    "the direction is decided by the event's CURRENT visibility, not by the requested one",
  );
});

// ---------------------------------------------------------------------------
Deno.test("#2009 P2-2 (Ari) — every other stable code is untouched by the split", async () => {
  // A non-Private refusal must still map to its own sentence: the split may not
  // have leaked into the rest of the map.
  const row = liveEvent({ visibility: "public", status: "ended" });
  const client: any = dbDouble(row);
  const originalRpc = client.rpc.bind(client);
  client.rpc = (name: string, args: Record<string, unknown>) =>
    name === "business_set_event_visibility"
      ? Promise.resolve({ data: null, error: { message: "event_not_editable" } })
      : originalRpc(name, args);

  let caught: ToolError | null = null;
  try {
    await updateEventTool().executor(
      { event_id: row.id, visibility: "unlisted" },
      client,
      USER_ID,
    );
  } catch (error) {
    caught = error as ToolError;
  }
  assertEquals(caught?.code, "EVENT_NOT_EDITABLE");
  assertEquals(
    caught?.message,
    "This event's visibility cannot be changed right now. Nothing was changed.",
  );
});
