// deno-lint-ignore-file no-explicit-any require-await
//
// issue #2009 — BINDING SPEC AMENDMENT 3A, Defect 1.
// IMPLEMENTOR-owned happy-path regression test.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT.
//
// It EXECUTES the real `update_event` executor out of the real AGENT_TOOLS
// registry. Nothing here reads source text, and nothing here asserts that a
// string appears in a file — every case drives the executor and inspects the
// resulting row state and the recorded call log.
//
// The Supabase client it drives is a double that encodes the SHIPPED database
// contract from
//   supabase/migrations/20270418002009_issue_2009_business_event_visibility.sql
// over a REAL mutable row:
//
//   * `.from("events").update({ visibility })` reproduces the BEFORE trigger
//     `issue_2009_event_visibility_write_guard` exactly — no-op returns early,
//     `event_type <> 'event'` passes through, a Private boundary raises
//     `private_visibility_unavailable`, and a caller whose `current_user` is
//     `authenticated` raises `event_visibility_direct_update_blocked`. This is
//     the guard the revert test fails against.
//   * `.rpc("business_set_event_visibility", …)` reproduces the narrow RPC —
//     value set, `unlisted -> hidden` mapping, bounded reason, type/status,
//     same-value no-op BEFORE stale rejection, Private refusal, optimistic
//     concurrency, and the bounded echo.
//
// That real Postgres genuinely behaves this way is proven separately and
// executably by the 97-assertion suite
//   supabase/migrations/__tests__/issue_2009_business_event_visibility.pg17.test.sql
// and, for the exact values and the exact fixed reason string Ari sends, by
//   supabase/migrations/__tests__/issue_2009_ari_visibility_rpc.pg17.test.sql
// Those two run against supabase/postgres:17.4.1.075. What THIS file owns is
// the piece neither of them can see: Ari's routing.
//
// Run with:
//   deno test --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/issue_2009_ari_visibility_via_rpc.test.ts

import { AGENT_TOOLS } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

function updateEventTool() {
  const found = AGENT_TOOLS.find((candidate) =>
    candidate.name === "update_event"
  );
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
  description?: string;
}

interface CallLog {
  directUpdates: Record<string, unknown>[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  reads: number;
}

interface DoubleOptions {
  /** `current_user` as PostgREST would present it. */
  role?: "authenticated" | "anon" | "postgres";
  /** Fires once, after the executor's authoritative read — a concurrent edit. */
  driftUpdatedAtAfterRead?: boolean;
  /** Return an echo naming a different event, to exercise echo verification. */
  forgeEchoEventId?: string;
}

/**
 * A Supabase client double over ONE real mutable row. Its `update` and `rpc`
 * paths are the shipped SQL contract, transcribed.
 */
function dbDouble(row: Row, options: DoubleOptions = {}) {
  const role = options.role ?? "authenticated";
  const log: CallLog = { directUpdates: [], rpcCalls: [], reads: 0 };
  let driftArmed = options.driftUpdatedAtAfterRead === true;

  /** BEFORE UPDATE OF visibility — issue_2009_event_visibility_write_guard. */
  const writeGuard = (nextVisibility: string): string | null => {
    if (nextVisibility === row.visibility) return null; // IS NOT DISTINCT FROM
    if (row.event_type !== "event") return null; // #2009 owns 'event' only
    if (nextVisibility === "private" || row.visibility === "private") {
      return "private_visibility_unavailable";
    }
    if (role === "authenticated" || role === "anon") {
      return "event_visibility_direct_update_blocked";
    }
    return null;
  };

  /** public.business_set_event_visibility(uuid, text, text, timestamptz). */
  const businessSetEventVisibility = (args: Record<string, unknown>) => {
    const requested = String(args.p_requested_visibility ?? "").trim()
      .toLowerCase();
    if (!["public", "unlisted", "private"].includes(requested)) {
      return { data: null, error: { message: "invalid_visibility" } };
    }
    const target = requested === "unlisted" ? "hidden" : requested;

    const reason = String(args.p_reason ?? "").trim();
    if (reason.length < 10 || reason.length > 200) {
      return { data: null, error: { message: "invalid_edit_reason" } };
    }
    if (args.p_event_id !== row.id || row.deleted_at !== null) {
      return { data: null, error: { message: "event_not_found" } };
    }
    if (
      row.event_type !== "event" || !["scheduled", "live"].includes(row.status)
    ) {
      return { data: null, error: { message: "event_not_editable" } };
    }

    const previous = row.visibility;
    // Same-value no-op is evaluated BEFORE stale rejection (SPEC §2.7).
    if (previous === target) {
      return {
        data: {
          eventId: row.id,
          requestedVisibility: requested,
          storedVisibility: target,
          previousStoredVisibility: previous,
          updatedAt: row.updated_at,
          changed: false,
          revokedShareCount: 0,
        },
        error: null,
      };
    }
    if (target === "private" || previous === "private") {
      return {
        data: null,
        error: { message: "private_visibility_unavailable" },
      };
    }
    if (
      args.p_expected_updated_at == null ||
      args.p_expected_updated_at !== row.updated_at
    ) {
      return { data: null, error: { message: "stale_event_visibility" } };
    }

    row.visibility = target;
    row.updated_at = new Date(Date.parse(row.updated_at) + 1000).toISOString();
    return {
      data: {
        eventId: options.forgeEchoEventId ?? row.id,
        requestedVisibility: requested,
        storedVisibility: target,
        previousStoredVisibility: previous,
        updatedAt: row.updated_at,
        changed: true,
        revokedShareCount: 0,
      },
      error: null,
    };
  };

  const client: any = {
    __log: log,
    __role: role,
    rpc(name: string, args: Record<string, unknown>) {
      log.rpcCalls.push({ name, args });
      if (name === "business_set_event_visibility") {
        return Promise.resolve(businessSetEventVisibility(args));
      }
      // biz_role_rank / biz_brand_effective_rank_for_caller etc.
      return Promise.resolve({ data: 50, error: null });
    },
    from(table: string) {
      const q: any = {};
      let pending: Record<string, unknown> | null = null;
      q.select = (cols?: string) => {
        q.__cols = cols ?? "";
        return q;
      };
      q.eq = () => q;
      q.is = () => q;
      q.update = (values: Record<string, unknown>) => {
        pending = values;
        return q;
      };
      const settleRead = () => {
        log.reads += 1;
        const snapshot = { ...row };
        // Drift AFTER the authoritative read that supplies the concurrency pin
        // — i.e. a concurrent editor lands between Ari's read and its write.
        if (driftArmed && String(q.__cols ?? "").includes("updated_at")) {
          driftArmed = false;
          row.updated_at = new Date(Date.parse(row.updated_at) + 5000)
            .toISOString();
        }
        return { data: snapshot, error: null };
      };
      const settleWrite = () => {
        const values = pending as Record<string, unknown>;
        log.directUpdates.push({ table, ...values });
        if (typeof values.visibility === "string") {
          const refusal = writeGuard(values.visibility);
          if (refusal) return { data: null, error: { message: refusal } };
        }
        Object.assign(row, values);
        return { data: { ...row }, error: null };
      };
      q.maybeSingle = () =>
        Promise.resolve(pending ? settleWrite() : settleRead());
      q.single = () => Promise.resolve(pending ? settleWrite() : settleRead());
      return q;
    },
  };
  return { client, log, row };
}

function liveEvent(overrides: Partial<Row> = {}): Row {
  return {
    id: EVENT_ID,
    brand_id: BRAND_ID,
    title: "Rooftop Session",
    event_type: "event",
    status: "live",
    visibility: "public",
    updated_at: "2026-08-17T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

async function expectToolError(fn: () => Promise<unknown>): Promise<ToolError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw new Error(`expected a ToolError, got: ${String(err)}`);
  }
  throw new Error("expected a ToolError, but the call succeeded");
}

// ---------------------------------------------------------------------------
// A1 — SENTINEL. Public -> Unlisted succeeds THROUGH THE RPC.
// Delete the routing and restore `updates.visibility = args.visibility`, and
// this fails against the guard with event_visibility_direct_update_blocked.
// ---------------------------------------------------------------------------
Deno.test("#2009 A1 — Ari takes a published event Public -> Unlisted through the RPC (SENTINEL)", async () => {
  const { client, log, row } = dbDouble(liveEvent({ visibility: "public" }));

  const result = await updateEventTool().executor(
    { event_id: EVENT_ID, visibility: "unlisted" },
    client,
    USER_ID,
  ) as any;

  assert(
    row.visibility === "hidden",
    `row should be stored 'hidden', got ${row.visibility}`,
  );
  assert(
    log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "the narrow RPC was never called — Ari is still writing the column directly",
  );
  assert(
    log.directUpdates.every((u) => !("visibility" in u)),
    "a direct events.visibility table update was attempted; the guard is the only thing standing between that and a regression",
  );
  assert(
    result.event.visibility === "hidden",
    "the returned event does not carry the stored value",
  );
  assert(
    result.visibility.requested === "unlisted",
    "the bounded echo lost the Business label",
  );
  assert(
    result.visibility.changed === true,
    "the echo did not report a real change",
  );
  assert(
    result.visibility.revokedShareCount === 0,
    "revokedShareCount is missing from the echo",
  );
});

// ---------------------------------------------------------------------------
// A2 — the return leg. Unlisted -> Public.
// ---------------------------------------------------------------------------
Deno.test("#2009 A2 — Ari takes a published event Unlisted -> Public through the RPC", async () => {
  const { client, log, row } = dbDouble(liveEvent({ visibility: "hidden" }));

  const result = await updateEventTool().executor(
    { event_id: EVENT_ID, visibility: "public" },
    client,
    USER_ID,
  ) as any;

  assert(
    row.visibility === "public",
    `row should be 'public', got ${row.visibility}`,
  );
  assert(
    log.directUpdates.every((u) => !("visibility" in u)),
    "direct visibility write attempted",
  );
  assert(
    result.visibility.previousStored === "hidden",
    "the echo lost the previous stored value",
  );
});

// ---------------------------------------------------------------------------
// A3 — a Private target fails closed with the RPC's own stable code, honestly,
// and writes NOTHING.
//
// The Private BOUNDARY is exercised on its exit leg (a Private row asked to go
// Public). That is deliberate and it is the only leg reachable today: Ari's
// `update_event` schema advertises `["draft","public","unlisted"]`, so the
// literal `private` is refused by the shared arg validator before the executor
// runs — a pre-existing schema/CHECK-constraint mismatch that AMENDMENT 3A
// explicitly places OUT OF SCOPE and files separately. A3b below executes that
// upstream refusal so it is recorded rather than assumed. Both legs of the
// boundary are refused identically by the RPC (migration §7:
// `IF v_target = 'private' OR v_previous = 'private'`), and the entry leg is
// proven against real Postgres rows in
// issue_2009_business_event_visibility.pg17.test.sql.
// ---------------------------------------------------------------------------
Deno.test("#2009 A3a — a Private target returns private_visibility_unavailable and writes nothing", async () => {
  const { client, log, row } = dbDouble(liveEvent({ visibility: "private" }));
  const before = { ...row };

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "public" },
      client,
      USER_ID,
    )
  );

  assert(
    err.code === "PRIVATE_VISIBILITY_UNAVAILABLE",
    `expected the RPC's stable code to be surfaced, got ${err.code}`,
  );
  // [TEST-MOD-APPROVED #2009] — pass-1 TEST REPORT P2-2. This fixture is
  // `visibility: "private"` moving to `public`, i.e. the EXIT leg, and it
  // originally asserted the ENTERING sentence ("...Choose Public or Unlisted
  // for now"). That is the defect: it told an organiser who had just chosen
  // Public to choose Public. The approved ENTERING copy is unchanged and is
  // still asserted verbatim — on the entering leg — in
  // mingla-business/src/services/__tests__/businessEventVisibilityExitCopy.issue2009.rework.test.ts.
  assert(
    err.message ===
      "This event is Private, and it can't be moved out of Private yet. Nothing was changed. Contact support and they'll switch it to Public or Unlisted.",
    "the operator did not receive the exit-leg Private copy",
  );
  assert(
    !err.message.includes("Choose Public or Unlisted for now"),
    "the exit leg still repeats back the thing the organiser just asked for (P2-2)",
  );
  assert(
    row.visibility === before.visibility,
    "the stored visibility changed on a refused Private call",
  );
  assert(
    row.updated_at === before.updated_at,
    "updated_at moved on a refused Private call",
  );
  assert(
    log.directUpdates.length === 0,
    "a refused Private call still attempted a table write",
  );
  assert(
    log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "the refusal did not come from the RPC — it must be the authoritative layer talking",
  );
});

Deno.test("#2009 A3b — the literal `private` is refused upstream by the advertised enum, writing nothing", async () => {
  const { client, log, row } = dbDouble(liveEvent({ visibility: "public" }));

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "private" },
      client,
      USER_ID,
    )
  );

  // Recorded, not endorsed: this is the pre-existing schema mismatch #2009
  // deliberately does not touch. What matters for THIS pass is that it is a
  // refusal with zero writes, not a silent success.
  assert(
    err.code === "INVALID_ARGS",
    `expected the upstream arg refusal, got ${err.code}`,
  );
  assert(
    row.visibility === "public",
    "the upstream refusal still changed the row",
  );
  assert(
    log.directUpdates.length === 0,
    "the upstream refusal still wrote to the table",
  );
  assert(
    log.rpcCalls.every((c) => c.name !== "business_set_event_visibility"),
    "the RPC was reached",
  );
});

// ---------------------------------------------------------------------------
// A4 — a mixed call is refused BEFORE every write. No partial execution.
// ---------------------------------------------------------------------------
Deno.test("#2009 A4 — visibility plus another field is refused before any write", async () => {
  const { client, log, row } = dbDouble(liveEvent({ visibility: "public" }));
  const before = { ...row };

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "unlisted", title: "Renamed" },
      client,
      USER_ID,
    )
  );

  assert(
    err.code === "VISIBILITY_CHANGE_MUST_BE_SEPARATE",
    `expected VISIBILITY_CHANGE_MUST_BE_SEPARATE, got ${err.code}`,
  );
  assert(
    err.message ===
      "Ask Ari to change visibility separately from other event edits. Nothing was changed.",
    "the mixed-action copy is not the approved sentence",
  );
  assert(
    row.visibility === before.visibility,
    "the mixed call still changed visibility",
  );
  assert(
    row.title === before.title,
    "the mixed call PARTIALLY executed — the title was written",
  );
  assert(
    log.directUpdates.length === 0,
    "the mixed call reached a table write",
  );
  assert(
    !log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "the mixed call still reached the RPC",
  );
});

// ---------------------------------------------------------------------------
// A5 — non-visibility fields no longer have a sparse DIRECT path.
//
// SUPERSEDED BY issue #1972 [canonical Ari event lifecycle]. This case used to
// assert `log.directUpdates.length === 1` — that a plain title/description edit
// reached `events` through a direct PostgREST update. #1972's Pass-4 finding 2
// proved that path is the defect: it wrote raw lifecycle columns, carried no
// optimistic concurrency, and had no exactly-once receipt, so a lost response
// could replay the write. Every standard-event field edit now dispatches
// through `ari_execute_event_operation` under the caller's JWT, keyed by the
// confirmed pending-action id.
//
// What #2009 actually owns here is UNCHANGED and still asserted: a
// non-visibility edit must never be routed through the visibility RPC, and a
// refusal must write nothing. Both legs below prove the request is refused
// BEFORE any table write, which is strictly stronger than the direct write this
// replaced.
// ---------------------------------------------------------------------------
Deno.test("#2009 A5 — a non-visibility update never touches the visibility RPC and never writes directly", async () => {
  // Leg 1 — #1972 requires the exact next server revision.
  const bare = dbDouble(liveEvent());
  const missingRevision = await expectToolError(() =>
    bare.client && updateEventTool().executor(
      { event_id: EVENT_ID, title: "Renamed", description: "New copy" },
      bare.client,
      USER_ID,
    )
  );
  assert(
    missingRevision.code === "INVALID_ARGS",
    `expected INVALID_ARGS without client_revision, got ${missingRevision.code}`,
  );
  assert(
    bare.row.title !== "Renamed",
    "the refused edit still wrote the title",
  );
  assert(
    bare.log.directUpdates.length === 0,
    "the refused edit reached a direct table write",
  );
  assert(
    !bare.log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "a non-visibility edit was routed through the visibility RPC",
  );

  // Leg 2 — with a revision, the write still demands its confirmed proposal id,
  // and it is the canonical dispatcher — never a direct update — that runs.
  const revised = dbDouble(liveEvent());
  const missingOperation = await expectToolError(() =>
    updateEventTool().executor(
      {
        event_id: EVENT_ID,
        title: "Renamed",
        description: "New copy",
        client_revision: 2,
      },
      revised.client,
      USER_ID,
    )
  );
  assert(
    missingOperation.code === "OPERATION_ID_REQUIRED",
    `expected OPERATION_ID_REQUIRED, got ${missingOperation.code}`,
  );
  assert(
    revised.row.title !== "Renamed",
    "the unconfirmed edit still wrote the title",
  );
  assert(
    revised.log.directUpdates.length === 0,
    "the unconfirmed edit reached a direct table write",
  );
  assert(
    !revised.log.rpcCalls.some((c) =>
      c.name === "business_set_event_visibility"
    ),
    "a non-visibility edit was routed through the visibility RPC",
  );
});

// ---------------------------------------------------------------------------
// A6 — caller JWT only. The executor never builds another client, and the RPC
// is invoked on the SAME caller-scoped client it was handed.
// ---------------------------------------------------------------------------
Deno.test("#2009 A6 — the RPC runs on the caller's own client, never a service-role escalation", async () => {
  const { client, log } = dbDouble(liveEvent({ visibility: "public" }), {
    role: "authenticated",
  });

  await updateEventTool().executor(
    { event_id: EVENT_ID, visibility: "unlisted" },
    client,
    USER_ID,
  );

  assert(
    client.__role === "authenticated",
    "the caller client's role was mutated",
  );
  assert(
    log.rpcCalls.filter((c) => c.name === "business_set_event_visibility")
      .length === 1,
    "the RPC was not invoked exactly once on the caller client",
  );
  const call = log.rpcCalls.find((c) =>
    c.name === "business_set_event_visibility"
  )!;
  assert(
    call.args.p_event_id === EVENT_ID,
    "the RPC was called for the wrong event",
  );
  assert(
    typeof call.args.p_reason === "string" &&
      (call.args.p_reason as string).length >= 10 &&
      (call.args.p_reason as string).length <= 200,
    "the fixed Ari reason is outside the RPC's bounded 10..200 range",
  );
  assert(
    call.args.p_expected_updated_at != null,
    "no optimistic-concurrency pin was sent",
  );
});

// ---------------------------------------------------------------------------
// A7 — a concurrent edit between the read and the write surfaces stale,
// honestly, and writes nothing.
// ---------------------------------------------------------------------------
Deno.test("#2009 A7 — a concurrent edit produces stale_event_visibility and no write", async () => {
  const { client, row } = dbDouble(liveEvent({ visibility: "public" }), {
    driftUpdatedAtAfterRead: true,
  });

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "unlisted" },
      client,
      USER_ID,
    )
  );

  assert(
    err.code === "STALE_EVENT_VISIBILITY",
    `expected STALE_EVENT_VISIBILITY, got ${err.code}`,
  );
  assert(
    row.visibility === "public",
    "a stale rejection still wrote the value",
  );
});

// ---------------------------------------------------------------------------
// A8 — RSVP is still outside #2009 (SC-22), but is now DENIED rather than
// written directly.
//
// SUPERSEDED BY issue #1972 [canonical Ari event lifecycle]. This case used to
// assert the RSVP row was written through `update_event`'s direct path. #1972
// bound `update_event` to `event_type = 'event'` in `EVENT_TYPE_BY_TOOL`
// (Pass-4 finding 2: the tool had no event-type, deleted or status guard at
// all), so `authorizeAgentTool` now denies a non-'event' offering before the
// executor runs. RSVP visibility keeps its own owners — `biz_update_live_rsvp`
// and the rsvp-bound Ari tools — and this tool is not one of them.
//
// #2009's SC-22 claim is unchanged and still asserted: an RSVP row must never
// reach the ticketed-event visibility RPC. It is now additionally proven that
// the refusal writes nothing.
// ---------------------------------------------------------------------------
Deno.test("#2009 A8 — an RSVP row never reaches the ticketed-event RPC and is denied with no write", async () => {
  const { client, log, row } = dbDouble(
    liveEvent({ event_type: "rsvp", visibility: "public" }),
  );
  const before = { ...row };

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "unlisted" },
      client,
      USER_ID,
    )
  );

  assert(
    err.code === "BRAND_ACCESS_DENIED",
    `expected the event-type resource binding to deny, got ${err.code}`,
  );
  assert(
    row.visibility === before.visibility,
    "the denied RSVP call still wrote visibility",
  );
  assert(
    log.directUpdates.length === 0,
    "the denied RSVP call reached a direct table write",
  );
  assert(
    !log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "an RSVP row was routed through the ticketed-event RPC",
  );
});

// ---------------------------------------------------------------------------
// A9 — an echo for a different event is never believed.
// ---------------------------------------------------------------------------
Deno.test("#2009 A9 — a forged echo is refused rather than reported as a save", async () => {
  const { client } = dbDouble(liveEvent({ visibility: "public" }), {
    forgeEchoEventId: "99999999-9999-4999-8999-999999999999",
  });

  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "unlisted" },
      client,
      USER_ID,
    )
  );

  assert(
    err.code === "VISIBILITY_ECHO_MISMATCH",
    `expected VISIBILITY_ECHO_MISMATCH, got ${err.code}`,
  );
});

// ---------------------------------------------------------------------------
// A10 — `draft` stays an idempotent no-op on an already-draft event, and can
// never be used to unpublish a live one.
// ---------------------------------------------------------------------------
Deno.test("#2009 A10 — draft is idempotent on a draft, and refused on a published event", async () => {
  const draft = dbDouble(
    liveEvent({ visibility: "draft", status: "scheduled" }),
  );
  await updateEventTool().executor(
    { event_id: EVENT_ID, visibility: "draft" },
    draft.client,
    USER_ID,
  );
  assert(
    draft.row.visibility === "draft",
    "the draft no-op changed the stored value",
  );
  assert(
    draft.log.directUpdates.length === 0,
    "the draft no-op wrote to the table",
  );
  assert(
    !draft.log.rpcCalls.some((c) => c.name === "business_set_event_visibility"),
    "the draft no-op reached the RPC",
  );

  const live = dbDouble(liveEvent({ visibility: "public" }));
  const err = await expectToolError(() =>
    updateEventTool().executor(
      { event_id: EVENT_ID, visibility: "draft" },
      live.client,
      USER_ID,
    )
  );
  assert(
    err.code === "VISIBILITY_DRAFT_REQUIRES_UNPUBLISH",
    `expected VISIBILITY_DRAFT_REQUIRES_UNPUBLISH, got ${err.code}`,
  );
  assert(
    live.row.visibility === "public",
    "a refused draft request still wrote",
  );
});
