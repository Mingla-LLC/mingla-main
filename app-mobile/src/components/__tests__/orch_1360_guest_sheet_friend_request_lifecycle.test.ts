// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1341_guest_list_sheet.test.ts / curatedStopsAvailability.adversarial).
// Deno typechecks it at run.
//
// ORCH-1360 [guest-sheet-friend-request-no-confirm-no-cancel] — implementor-owned
// happy-path guard suite (SPEC §7 T-1360-A..H; §9 structural safeguard).
//
// Deno-runnable source-structure suite in the 1157/1163/1341 house style
// (read the source → strip comments → assert). Enforces the three ORCH-1360
// behavioral changes, ALL inside EventGuestListSheet.tsx:
//   1. CONFIRM-BEFORE-ADD — handleAddFriendPress opens a native Alert.alert
//      naming the guest; the send body (doSendFriendRequest) fires ONLY on
//      confirm. The confirm wrapper never calls addFriend directly.
//   2. WITHDRAW-AFTER-SENT — the "Requested" chip is a sanctioned Pressable that
//      opens a native Alert.alert → useFriends().cancelFriendRequest(requestId)
//      (a REQUEST id derived from the outgoing pending friendRequests row) →
//      the optimistic addStates[row.key] AND the server hasPendingOutgoing both
//      clear, reverting the row to "Add friend".
//   3. NO success toast — the pre-action confirm IS the confirmation; the
//      passive "Requested" chip stays. No RN <Modal>, no overlay slot, no Toast.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - drop the Alert.alert confirm / call addFriend directly → T-1360-A FAILS.
//   - break the exact addFriend signature → T-1360-B FAILS (+ orch_1341 T-11b).
//   - restore the inert <View> "Requested" chip / drop the withdraw Pressable →
//     T-1360-C FAILS.
//   - unwire cancelFriendRequest / the requestId derivation → T-1360-D FAILS.
//   - drop the optimistic addStates clear on withdraw → T-1360-E FAILS.
//   - drop the anon guard from the withdraw handler → T-1360-F FAILS.
//   - re-introduce an RN <Modal> / overlay= / a Toast → T-1360-G FAILS.
//   - remove the ORCH-1360 clause from the orch_1341 T-10 whitelist → T-1360-H
//     FAILS.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Strip // line comments FIRST (the `[^:]` guard protects `https://` URLs),
// THEN /* */ block comments — line-first (identical to the 1341 house strip so
// doc comments that legitimately NAME forbidden things cannot satisfy/trip).
const strip = (src: string): string =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const SHEET_RAW = await read("../EventGuestListSheet.tsx");
const T1341_RAW = await read("./orch_1341_guest_list_sheet.test.ts");
const SHEET = strip(SHEET_RAW);

// ── T-1360-A — CONFIRM-BEFORE-ADD: Alert.alert gates the send ───────────────

Deno.test("T-1360-A add-friend is confirm-gated (Alert.alert; no direct addFriend in the wrapper)", () => {
  const addStart = SHEET.indexOf("const handleAddFriendPress");
  const msgStart = SHEET.indexOf("const handleMessagePress");
  assert(addStart >= 0, "handleAddFriendPress exists");
  assert(msgStart > addStart, "handleMessagePress follows handleAddFriendPress");
  const wrapper = SHEET.slice(addStart, msgStart);
  // The confirm wrapper opens a native Alert.alert…
  assert(
    /Alert\.alert\(/.test(wrapper),
    "handleAddFriendPress opens a native Alert.alert",
  );
  // …and never fires the request itself (the send moved to doSendFriendRequest).
  assert(
    !/addFriend\(/.test(wrapper),
    "the confirm wrapper must NOT call addFriend directly (fires only on confirm)",
  );
  // The dialog message names the guest (SC-1).
  assertStringIncludes(SHEET, "Send a friend request to ${name}?");
  // The anon guard survives in the first ~600 chars (A-3 parity).
  assertStringIncludes(
    SHEET.slice(addStart, addStart + 600),
    "if (profileId === null) return;",
  );
});

// ── T-1360-B — exact useFriends().addFriend signature preserved ─────────────

Deno.test("T-1360-B send body rides the exact addFriend signature (relocated, verbatim)", () => {
  assertStringIncludes(
    SHEET,
    'await addFriend(profileId, "", row.guest.username ?? undefined)',
  );
  // The send body lives in doSendFriendRequest, invoked only from the confirm.
  assertStringIncludes(SHEET, "const doSendFriendRequest");
  assertStringIncludes(SHEET, "void doSendFriendRequest(row)");
});

// ── T-1360-C — the "Requested" chip is a sanctioned withdraw Pressable ──────

Deno.test("T-1360-C the Requested chip is a Pressable wired to handleCancelRequestPress", () => {
  // The withdraw target is a <Pressable> segment carrying the ORCH-1360 testID
  // (mirrors the orch_1341 T-10 segment scan). If reverted to the inert <View>
  // dead end, no <Pressable> segment carries this testID → this FAILS.
  const segments = SHEET.split("<Pressable");
  const withdrawSeg = segments
    .slice(1)
    .find((seg) =>
      /testID=\{`orch-1360-guest-sheet-cancel-request-\$\{item\.key\}`\}/.test(
        seg.slice(0, 1200),
      ),
    );
  assert(
    withdrawSeg !== undefined,
    "a <Pressable> carries the orch-1360 withdraw testID (not the inert <View> dead end)",
  );
  assertStringIncludes(withdrawSeg, "void handleCancelRequestPress(item)");
  // The visible "Requested" label now lives inside the withdraw Pressable.
  assertStringIncludes(
    withdrawSeg,
    "<Text style={styles.requestedChipText}>Requested</Text>",
  );
});

// ── T-1360-D — withdraw wires cancelFriendRequest with a DERIVED request id ──

Deno.test("T-1360-D withdraw calls cancelFriendRequest(requestId) derived from friendRequests", () => {
  // cancelFriendRequest is pulled from useFriends and actually called.
  assertStringIncludes(SHEET, "addFriend, cancelFriendRequest } = useFriends");
  assertStringIncludes(SHEET, "await cancelFriendRequest(requestId)");
  // The requestId is derived via the SAME predicate as hasPendingOutgoing
  // (outgoing pending row whose receiver_id === the guest's profileId).
  assert(
    /friendRequests\.find\(/.test(SHEET),
    "the requestId is derived from friendRequests.find(...)",
  );
  assertStringIncludes(SHEET, "r.receiver_id === profileId");
  assertStringIncludes(SHEET, "r.sender_id === viewerId");
  assertStringIncludes(SHEET, 'r.status === "pending"');
  // cancelFriendRequest takes a REQUEST id, never a profileId.
  assertStringIncludes(SHEET, "doWithdrawRequest(row, pendingReq?.id)");
});

// ── T-1360-E — both state sources clear on withdraw ─────────────────────────

Deno.test("T-1360-E withdraw clears the optimistic addStates AND relies on the requests invalidation", () => {
  const wStart = SHEET.indexOf("const doWithdrawRequest");
  assert(wStart >= 0, "doWithdrawRequest exists");
  const wBody = SHEET.slice(wStart, wStart + 900);
  // Optimistic source clears: setAddStates deletes this row's key.
  assert(
    /setAddStates\(/.test(wBody) && /delete\s+next\[row\.key\]/.test(wBody),
    "doWithdrawRequest deletes the optimistic addStates[row.key]",
  );
  // Server source clears via cancelFriendRequest → friendsKeys.requests
  // invalidation (owned by the hook); the withdraw body invokes it.
  assert(
    /cancelFriendRequest\(/.test(wBody),
    "doWithdrawRequest invokes cancelFriendRequest (server source clears via invalidation)",
  );
  // The chip's visibility is the OR of both sources.
  assertStringIncludes(
    SHEET,
    'const showRequestedChip = addState === "requested" || hasPendingOutgoing;',
  );
});

// ── T-1360-F — anonymity seal: the withdraw handler hard-returns on null ─────

Deno.test("T-1360-F handleCancelRequestPress refuses anonymous rows (D8)", () => {
  const cStart = SHEET.indexOf("const handleCancelRequestPress");
  assert(cStart >= 0, "handleCancelRequestPress exists");
  assertStringIncludes(
    SHEET.slice(cStart, cStart + 600),
    "if (profileId === null) return;",
  );
  // Action-less rows stay action-less: the actions gate is unchanged.
  assertStringIncludes(
    SHEET,
    "const showActions = item.isNamed && !item.isYou;",
  );
});

// ── T-1360-G — native Alert only: no second RN Modal, no overlay, no toast ──

Deno.test("T-1360-G confirmation is native Alert.alert only (no <Modal>, no overlay, no Toast)", () => {
  assert(!/<Modal\b/.test(SHEET), "no raw RN <Modal> (COMMS-0084)");
  assert(!/\bRNModal\b/.test(SHEET), "no RN Modal alias");
  assert(!/\boverlay\s*=/.test(SHEET), "BaseBottomSheet overlay slot unused");
  assert(!/\bToast\b/.test(SHEET), "no Toast added (DESIGN §2.5 no-toasts)");
  // Alert is imported from react-native and used as the confirm primitive.
  assert(
    /import\s*\{[\s\S]*?\bAlert\b[\s\S]*?\}\s*from\s*"react-native"/.test(SHEET),
    "Alert is imported from react-native",
  );
  assertStringIncludes(SHEET, "Alert.alert(");
});

// ── T-1360-H — the orch_1341 T-10 whitelist carries the ORCH-1360 clause ────

Deno.test("T-1360-H orch_1341 T-10 whitelist is extended for the withdraw testID", () => {
  assertStringIncludes(T1341_RAW, "[TEST-MOD-APPROVED ORCH-1360]");
  assertStringIncludes(
    T1341_RAW,
    "orch-1360-guest-sheet-cancel-request-\\$\\{item\\.key\\}",
  );
});
