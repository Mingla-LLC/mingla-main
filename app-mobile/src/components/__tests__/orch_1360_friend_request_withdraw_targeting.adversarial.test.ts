// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts / orch_1360_guest_sheet_friend_request_lifecycle).
// Deno typechecks it at run.
//
// ORCH-1360 [guest-sheet-friend-request-no-confirm-no-cancel] — TESTER adversarial
// suite (mingla-tester). DIFFERENT ANGLE than the implementor happy-path
// (orch_1360_guest_sheet_friend_request_lifecycle.test.ts T-1360-A..H, which are
// whole-file source-structure regex scans).
//
// THE GAP THIS ATTACKS:
//   The implementor's T-1360-D asserts the strings `r.sender_id === viewerId`,
//   `r.receiver_id === profileId`, `r.status === "pending"` exist SOMEWHERE in
//   the sheet source. But those EXACT strings also live in the row-render
//   `hasPendingOutgoing` scan (a SEPARATE predicate). So T-1360-D would STILL
//   PASS even if the WITHDRAW handler's OWN requestId-derivation predicate were
//   swapped, weakened, or keyed to the wrong field — a real "cancel targets the
//   WRONG requestId when multiple pending outgoing requests exist" bug that would
//   silently withdraw the wrong person's request (or an incoming request).
//
// WHAT THIS SUITE DOES (behavioral, not just structural):
//   1. Isolates the `handleCancelRequestPress` handler body ONLY (from its own
//      declaration to the next handler) — the row-render scan is excluded.
//   2. EXTRACTS the actual `.find(...)` requestId-derivation predicate FROM THAT
//      HANDLER and compiles it into a runnable function.
//   3. EXECUTES it against a fabricated friendRequests array carrying THREE
//      pending outgoing requests to DIFFERENT receivers, plus two decoys to the
//      SAME person (an incoming request, and an already-accepted request), and
//      asserts the predicate selects the request whose receiver_id === the target
//      row's profileId — the RIGHT requestId — and rejects both decoys.
//   4. Structurally guards that the withdraw hands the DERIVED request id
//      (`pendingReq?.id`) to doWithdrawRequest — never a profileId/viewerId
//      (the classic "passed a profileId where a requestId was expected" bug the
//      ORCH-1360 label warns against).
//
// FAILS-ON-REVERT: weaken the handler predicate (e.g. drop
// `&& r.receiver_id === profileId`, i.e. "pick the first pending outgoing
// regardless of receiver") → ADV-1 selects the wrong request (req-to-A instead
// of req-to-B) → FAILS. Remove the withdraw handler entirely (Part-2 dead-end
// revert) → the handler slice / predicate vanishes → extraction FAILS.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// House strip: // line comments first (the [^:] guard protects https:// URLs),
// then /* */ block comments.
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET = strip(await read("../EventGuestListSheet.tsx"));

// ── Isolate the WITHDRAW handler body ONLY (exclude the row-render scan) ──────
function withdrawHandlerBody(): string {
  const start = SHEET.indexOf("const handleCancelRequestPress");
  assert(start >= 0, "handleCancelRequestPress must exist (withdraw feature present)");
  // The next handler declared after it (handleOpenProfilePress) bounds the slice.
  const after = SHEET.indexOf("const handleOpenProfilePress", start);
  const end = after > start ? after : SHEET.indexOf("const renderAvatar", start);
  assert(end > start, "a following declaration must bound the withdraw handler slice");
  return SHEET.slice(start, end);
}

// ── Extract the .find(...) predicate FROM the withdraw handler and compile it ─
function extractWithdrawPredicate(): (r: unknown, viewerId: unknown, profileId: unknown) => boolean {
  const body = withdrawHandlerBody();
  // friendRequests.find( (r) => <condition> ) ;   (condition has no ')' in it)
  const m = body.match(/friendRequests\.find\(\s*\(?\s*r\s*\)?\s*=>\s*([\s\S]*?),?\s*\)\s*;/);
  assert(
    m !== null,
    "the WITHDRAW handler must derive its requestId via friendRequests.find(r => ...) INSIDE handleCancelRequestPress",
  );
  const condition = m![1].trim().replace(/,+$/, "");
  assert(condition.length > 0, "extracted predicate condition must be non-empty");
  // Compile with viewerId + profileId injected as free variables.
  // eslint-disable-next-line no-new-func
  return new Function("r", "viewerId", "profileId", `return (${condition});`) as (
    r: unknown,
    viewerId: unknown,
    profileId: unknown,
  ) => boolean;
}

// ── Fabricated friend-requests fixture (multiple pending outgoing) ───────────
const VIEWER = "viewer-1";
const GUEST_A = "guest-A";
const GUEST_B = "guest-B"; // the row we withdraw
const GUEST_C = "guest-C";
const FRIEND_REQUESTS = [
  { id: "req-to-A", status: "pending", sender_id: VIEWER, receiver_id: GUEST_A },
  { id: "req-to-B", status: "pending", sender_id: VIEWER, receiver_id: GUEST_B }, // RIGHT one
  { id: "req-to-C", status: "pending", sender_id: VIEWER, receiver_id: GUEST_C },
  // decoy 1 — an INCOMING request FROM guest-B (sender/receiver swapped): must NOT match.
  { id: "incoming-from-B", status: "pending", sender_id: GUEST_B, receiver_id: VIEWER },
  // decoy 2 — an already-ACCEPTED outgoing request to guest-B: must NOT match.
  { id: "accepted-to-B", status: "accepted", sender_id: VIEWER, receiver_id: GUEST_B },
];

// ── ADV-1 — cancel targets the RIGHT requestId among multiple pending ────────
Deno.test("ADV-1 withdraw predicate selects the request for THIS row's profileId (not the first pending outgoing)", () => {
  const predicate = extractWithdrawPredicate();
  const found = FRIEND_REQUESTS.find((r) => predicate(r, VIEWER, GUEST_B));
  assert(found !== undefined, "a pending outgoing request to guest-B must be found");
  assertEquals(
    (found as { id: string }).id,
    "req-to-B",
    "must select req-to-B (this row's receiver), NOT req-to-A/req-to-C — a wrong-requestId withdraw would cancel the wrong person",
  );
  // Same predicate, different row → must select THAT row's request (keyed to the row).
  const foundA = FRIEND_REQUESTS.find((r) => predicate(r, VIEWER, GUEST_A));
  assertEquals((foundA as { id: string }).id, "req-to-A", "predicate is keyed to the row's profileId in both directions");
});

// ── ADV-2 — decoys to the SAME person are rejected (no swap, no stale status) ─
Deno.test("ADV-2 withdraw predicate rejects an INCOMING request and a NON-pending request to the same person", () => {
  const predicate = extractWithdrawPredicate();
  // Incoming request from guest-B (sender/receiver swapped) must never be picked
  // for a withdraw keyed to guest-B — that would delete someone else's request TO you.
  assert(
    !predicate({ id: "incoming-from-B", status: "pending", sender_id: GUEST_B, receiver_id: VIEWER }, VIEWER, GUEST_B),
    "an incoming request (sender=guest, receiver=viewer) must NOT match the outgoing withdraw predicate",
  );
  // Already-accepted request must never be withdrawn as if still pending.
  assert(
    !predicate({ id: "accepted-to-B", status: "accepted", sender_id: VIEWER, receiver_id: GUEST_B }, VIEWER, GUEST_B),
    "a non-pending (accepted) request must NOT satisfy the withdraw predicate",
  );
});

// ── ADV-3 — no outgoing pending ⇒ nothing derived (no fabricated id) ─────────
Deno.test("ADV-3 withdraw predicate finds nothing when the viewer has no pending outgoing request to the row", () => {
  const predicate = extractWithdrawPredicate();
  const found = FRIEND_REQUESTS.find((r) => predicate(r, VIEWER, "guest-Z-no-request"));
  assertEquals(found, undefined, "no pending outgoing request ⇒ undefined (the handler then no-ops cancelFriendRequest — no data corruption)");
});

// ── ADV-4 — the withdraw hands the DERIVED request id, never a profileId ─────
Deno.test("ADV-4 doWithdrawRequest receives the derived pendingReq?.id — never a profileId/viewerId", () => {
  const body = withdrawHandlerBody();
  assert(
    /doWithdrawRequest\(\s*row\s*,\s*pendingReq\?\.id\s*\)/.test(body),
    "the withdraw must pass the DERIVED request row's id (pendingReq?.id) to doWithdrawRequest",
  );
  // Guard the classic id-confusion bug: the handler must not hand a profileId or
  // viewerId to the withdraw/cancel path (cancelFriendRequest takes a REQUEST id).
  assert(
    !/doWithdrawRequest\(\s*row\s*,\s*profileId\s*\)/.test(body),
    "must NOT pass a profileId where a requestId is expected",
  );
  assert(
    !/cancelFriendRequest\(\s*profileId\s*\)/.test(SHEET),
    "cancelFriendRequest must never be called with a profileId (it deletes friend_requests by request id)",
  );
});
