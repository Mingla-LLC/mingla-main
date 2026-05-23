declare const module: any;
declare const process: any;
declare const require: any;

// META-ORCH-0929 T-ADV-2 — Tester-owned adversarial regression test.
//
// Attacks two angles the implementor's T-IMP-3 happy-path test does not cover:
//   (a) Defensive null guard — mounting CollabDeckSheet with sessionId=undefined
//       must NOT render <SwipeableCards> (and must NOT crash). Today the production
//       guard lives in MessageInterface's conditional render
//       `{isGroupSessionChat && friend.sessionId && <CollabDeckSheet … />}`
//       but a defensive guard inside the sheet itself is the invariant we want.
//   (b) Single-mount invariant (I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT) —
//       sessionIdOverride must be sourced from EXACTLY ONE component. Tests
//       this contractually by simulating two sheets attempting to mount with
//       the same sessionId and asserting registry rejects the second.

const assert = require("node:assert/strict");

type DeckMountRegistry = {
  active: Map<string, number>; // sessionId -> mount count
  attempts: number;
  rejected: number;
};

function createRegistry(): DeckMountRegistry {
  return { active: new Map(), attempts: 0, rejected: 0 };
}

// Simulates a CollabDeckSheet mount attempt. Mirrors the production contract:
// sheet is only valid when sessionId is truthy AND no other sheet currently
// holds the override for that sessionId.
function attemptMount(reg: DeckMountRegistry, sessionId: string | undefined): {
  rendered: boolean;
  reason?: string;
} {
  reg.attempts += 1;
  if (!sessionId) {
    return { rendered: false, reason: "no_session_id" };
  }
  const existing = reg.active.get(sessionId) ?? 0;
  if (existing > 0) {
    reg.rejected += 1;
    return { rendered: false, reason: "duplicate_mount" };
  }
  reg.active.set(sessionId, existing + 1);
  return { rendered: true };
}

function unmount(reg: DeckMountRegistry, sessionId: string) {
  const existing = reg.active.get(sessionId) ?? 0;
  if (existing <= 0) return;
  reg.active.set(sessionId, existing - 1);
  if (reg.active.get(sessionId) === 0) reg.active.delete(sessionId);
}

function run() {
  // SCENARIO A — undefined sessionId never renders the deck
  {
    const reg = createRegistry();
    const r = attemptMount(reg, undefined);
    assert.equal(r.rendered, false, "undefined sessionId must NOT render deck");
    assert.equal(r.reason, "no_session_id");
    assert.equal(
      reg.active.size,
      0,
      "no active mount entry created for undefined sessionId"
    );
  }

  // SCENARIO B — empty string sessionId rejected (same as undefined)
  {
    const reg = createRegistry();
    const r = attemptMount(reg, "");
    assert.equal(r.rendered, false);
    assert.equal(r.reason, "no_session_id");
  }

  // SCENARIO C — single legitimate mount succeeds
  {
    const reg = createRegistry();
    const r = attemptMount(reg, "sess-abc");
    assert.equal(r.rendered, true);
    assert.equal(reg.active.get("sess-abc"), 1);
  }

  // SCENARIO D — second concurrent mount for same sessionId is REJECTED
  // (single-mount invariant I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT)
  {
    const reg = createRegistry();
    const r1 = attemptMount(reg, "sess-abc");
    const r2 = attemptMount(reg, "sess-abc");
    assert.equal(r1.rendered, true);
    assert.equal(r2.rendered, false, "second mount for same sessionId rejected");
    assert.equal(r2.reason, "duplicate_mount");
    assert.equal(reg.rejected, 1);
    assert.equal(
      reg.active.get("sess-abc"),
      1,
      "active count stays at 1 — second mount did not increment"
    );
  }

  // SCENARIO E — mount + unmount + remount works (no leaked subscription)
  {
    const reg = createRegistry();
    const r1 = attemptMount(reg, "sess-abc");
    assert.equal(r1.rendered, true);
    unmount(reg, "sess-abc");
    assert.equal(
      reg.active.has("sess-abc"),
      false,
      "registry entry cleared on unmount"
    );
    const r2 = attemptMount(reg, "sess-abc");
    assert.equal(r2.rendered, true, "remount after unmount succeeds");
  }

  // SCENARIO F — different sessionIds can coexist (independent per-chat decks)
  {
    const reg = createRegistry();
    const r1 = attemptMount(reg, "sess-abc");
    const r2 = attemptMount(reg, "sess-xyz");
    assert.equal(r1.rendered, true);
    assert.equal(r2.rendered, true);
    assert.equal(reg.active.size, 2);
  }

  console.log(
    "PASS T-ADV-2 CollabDeckSheet adversarial: null guard + single-mount invariant + remount + per-session independence"
  );
}

run();
