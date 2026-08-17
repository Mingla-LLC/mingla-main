// issue #2009 — BINDING SPEC AMENDMENT 3B, Defect 4.
// IMPLEMENTOR-owned happy-path regression test.
//
// THE DEFECT. `business_set_event_visibility` refuses every transition entering
// or leaving Private while #1931's private-access release stays frozen. That is
// a known, expected, correctly-refused request. But agent-confirm-action's
// ToolError status map had no branch for it, so it fell through to
// `else status = 500` and a correct refusal was reported to the client as a
// server fault.
//
// THE TRAP THIS TEST EXISTS TO CATCH. Amendment 3B names the RPC's stable code
// `private_visibility_unavailable`. The code that actually ARRIVES at the status
// map is the UPPERCASED one — agentTools.ts's `issue2009VisibilityToolError`
// constructs `new ToolError(code.toUpperCase(), copy)`. A status branch written
// against the lowercase literal would read correctly, survive any source-text
// check, and never fire once: the exact unfalsifiable-check bug class #2113
// exists to stop. So this test does NOT hand `toolErrorHttpStatus` a string a
// human typed. It drives the REAL `update_event` executor against a client
// double encoding the shipped RPC's Private refusal, takes the code off the
// REAL ToolError that comes back, and feeds THAT into the REAL
// `toolErrorHttpStatus` exported by the shipped handler.
//
// Nothing here asserts on source text. That real Postgres genuinely refuses both
// legs of the Private boundary with this code is proven against real rows by
//   supabase/migrations/__tests__/issue_2009_business_event_visibility.pg17.test.sql
//   supabase/migrations/__tests__/issue_2009_ari_visibility_rpc.pg17.test.sql (R4)
//
// Run with:
//   deno test --no-check --allow-env --allow-net --allow-read \
//     supabase/functions/agent-confirm-action/__tests__/issue_2009_private_visibility_status.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { toolErrorHttpStatus } from "../index.ts";
import { AGENT_TOOLS } from "../../_shared/agentTools.ts";
import { ToolError } from "../../_shared/agentToolHelpers.ts";

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

function updateEventTool() {
  const found = AGENT_TOOLS.find((candidate) => candidate.name === "update_event");
  if (!found) throw new Error("missing tool fixture: update_event");
  return found;
}

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

function privateEvent(): Row {
  return {
    id: EVENT_ID,
    brand_id: BRAND_ID,
    title: "Rooftop Session",
    event_type: "event",
    status: "live",
    visibility: "private",
    updated_at: "2026-08-17T12:00:00.000Z",
    deleted_at: null,
  };
}

/**
 * A Supabase client double over one real row. Only the two behaviours this test
 * depends on are modelled, and both are the shipped SQL contract transcribed:
 * migration §7 `IF v_target = 'private' OR v_previous = 'private'` refuses with
 * `private_visibility_unavailable`, and the BEFORE guard refuses a direct
 * `authenticated` visibility write.
 */
function dbDouble(row: Row) {
  const directUpdates: Record<string, unknown>[] = [];

  const businessSetEventVisibility = (args: Record<string, unknown>) => {
    const requested = String(args.p_requested_visibility ?? "").trim().toLowerCase();
    const target = requested === "unlisted" ? "hidden" : requested;
    if (target === "private" || row.visibility === "private") {
      return { data: null, error: { message: "private_visibility_unavailable" } };
    }
    return {
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
    };
  };

  // deno-lint-ignore no-explicit-any
  const client: any = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "business_set_event_visibility") {
        return Promise.resolve(businessSetEventVisibility(args));
      }
      return Promise.resolve({ data: 50, error: null });
    },
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      let pending: Record<string, unknown> | null = null;
      q.select = () => q;
      q.eq = () => q;
      q.is = () => q;
      q.update = (values: Record<string, unknown>) => {
        pending = values;
        return q;
      };
      const settle = () => {
        if (pending === null) return { data: { ...row }, error: null };
        directUpdates.push({ table, ...pending });
        return { data: { ...row }, error: null };
      };
      q.maybeSingle = () => Promise.resolve(settle());
      q.single = () => Promise.resolve(settle());
      return q;
    },
  };
  return { client, directUpdates };
}

/**
 * Produce the REAL ToolError the shipped Ari path raises when the RPC refuses a
 * Private transition. The Private BOUNDARY is exercised on its exit leg (a
 * Private row asked to go Public) because `update_event`'s advertised enum
 * refuses the literal `private` upstream — the pre-existing schema mismatch
 * filed as #2149 and explicitly out of scope here. Both legs return the same
 * code from the same `IF` in the migration.
 */
async function realPrivateRefusal(): Promise<ToolError> {
  const { client, directUpdates } = dbDouble(privateEvent());
  try {
    await updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "public" },
      client,
      USER_ID,
    );
  } catch (err) {
    if (!(err instanceof ToolError)) {
      throw new Error(`expected a ToolError from the shipped executor, got: ${String(err)}`);
    }
    assertEquals(
      directUpdates.length,
      0,
      "fixture invalid: the refused call still attempted a direct table write",
    );
    return err;
  }
  throw new Error("expected the shipped executor to refuse a Private transition, but it succeeded");
}

// ---------------------------------------------------------------------------
// S1 — SENTINEL. The Private refusal returns a 4xx, not 500.
//
// Delete the `private_visibility_unavailable` branch from toolErrorHttpStatus
// and this FAILS with 500 — a correctly-refused request reported as a server
// fault, which is exactly Defect 4.
// ---------------------------------------------------------------------------
Deno.test("#2009 S1 — private_visibility_unavailable maps to 4xx, not 500 (SENTINEL)", async () => {
  const err = await realPrivateRefusal();

  // The code is taken off the REAL error, never typed by hand — see the header.
  const status = toolErrorHttpStatus(err.code);

  assert(
    status >= 400 && status < 500,
    `the Private refusal returned HTTP ${status}; a known, expected, correctly-refused request must not be reported as a server fault (Defect 4)`,
  );
  assertEquals(
    status,
    400,
    `expected 400 — the organiser resolves this by adjusting the requested value ("Choose Public or Unlisted for now"), which is this map's 400 shape — got ${status}`,
  );
});

// ---------------------------------------------------------------------------
// S2 — non-vacuity. The branch fires on the code that really arrives.
// ---------------------------------------------------------------------------
Deno.test("#2009 S2 — the branch matches the code the shipped executor actually raises", async () => {
  const err = await realPrivateRefusal();

  assertEquals(
    err.code,
    "PRIVATE_VISIBILITY_UNAVAILABLE",
    "the shipped executor no longer raises the uppercased stable code; re-check the status branch's casing",
  );
  assertEquals(
    err.message,
    "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.",
    "the caller no longer receives the approved Private copy",
  );
  // Both spellings resolve to the same branch, so neither a rename in
  // agentTools.ts nor a literal reading of the amendment can make it vacuous.
  assertEquals(toolErrorHttpStatus("private_visibility_unavailable"), 400);
  assertEquals(toolErrorHttpStatus("PRIVATE_VISIBILITY_UNAVAILABLE"), 400);
});

// ---------------------------------------------------------------------------
// S3 — "Add nothing else to that map" (Amendment 3B). Every pre-existing branch
// still returns exactly what it returned before, and an unknown code still
// falls through to 500 — the fix must not have turned the map permissive.
// ---------------------------------------------------------------------------
Deno.test("#2009 S3 — the rest of the status map is unchanged and unknown codes still 500", () => {
  assertEquals(toolErrorHttpStatus("OWNERSHIP_DENIED"), 403);
  assertEquals(toolErrorHttpStatus("ROLE_DENIED"), 403);
  assertEquals(toolErrorHttpStatus("BRAND_ACCESS_DENIED"), 403);
  assertEquals(toolErrorHttpStatus("ROLE_CHECK_UNAVAILABLE"), 503);
  assertEquals(toolErrorHttpStatus("INVALID_ARGS"), 400);
  assertEquals(toolErrorHttpStatus("SLUG_TAKEN"), 400);
  assertEquals(toolErrorHttpStatus("DELETE_BLOCKED_BY_EVENTS"), 409);

  // Genuine server-side failures stay 5xx. If this ever returns 4xx the fix has
  // stopped being a fix and started being a blanket downgrade.
  for (const serverSide of ["WRITE_FAILED", "READ_FAILED", "EXECUTION_FAILED", "SOMETHING_NEW"]) {
    assertEquals(
      toolErrorHttpStatus(serverSide),
      500,
      `${serverSide} is no longer reported as a server error`,
    );
  }
  // Other #2009 codes were deliberately NOT added to the map this pass
  // (Amendment 3B: "Add nothing else to that map"). Recorded, not fixed.
  assertEquals(toolErrorHttpStatus("STALE_EVENT_VISIBILITY"), 500);
});
