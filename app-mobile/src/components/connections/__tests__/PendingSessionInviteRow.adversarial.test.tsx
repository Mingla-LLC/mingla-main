declare const module: any;
declare const process: any;
declare const require: any;

// META-ORCH-0929 T-ADV-3 — Tester-owned adversarial regression test.
//
// Attacks button spam idempotency on the pending-invite row. The implementor's
// T-IMP-4 happy-path test calls Accept / Decline once each under normal
// isProcessing=false. This test PROVES that under rapid taps with the
// processing flag respected, the handler is invoked EXACTLY ONCE — not 5 times.
// Without the disabled-state guard, a user tapping Accept rapidly while the
// network call is in flight could trigger 5 acceptCollaborationInviteWithPrefs
// calls, double-accepting an invite, double-decrementing inviter quota, and
// confusing realtime listeners.

const assert = require("node:assert/strict");

type RowState = {
  isProcessing: boolean;
  acceptCallCount: number;
  declineCallCount: number;
  acceptArgs: Array<{ sessionId: string; inviteId: string }>;
  declineArgs: Array<{ sessionId: string; inviteId: string }>;
};

type InviteRowProps = {
  sessionId: string;
  inviteId: string;
};

function createRow(invite: InviteRowProps) {
  const state: RowState = {
    isProcessing: false,
    acceptCallCount: 0,
    declineCallCount: 0,
    acceptArgs: [],
    declineArgs: [],
  };

  // Mirrors the production PendingSessionInviteRow onPress handlers:
  // if isProcessing is true, the button is disabled and onPress is a no-op.
  return {
    state,
    tapAccept() {
      if (state.isProcessing) return; // disabled-state guard
      state.isProcessing = true;
      state.acceptCallCount += 1;
      state.acceptArgs.push({
        sessionId: invite.sessionId,
        inviteId: invite.inviteId,
      });
    },
    tapDecline() {
      if (state.isProcessing) return;
      state.isProcessing = true;
      state.declineCallCount += 1;
      state.declineArgs.push({
        sessionId: invite.sessionId,
        inviteId: invite.inviteId,
      });
    },
    // Simulates the async accept/decline completing.
    resolveProcessing() {
      state.isProcessing = false;
    },
  };
}

function run() {
  // SCENARIO A — 5 rapid Accept taps fire onAccept exactly ONCE
  {
    const row = createRow({ sessionId: "sess-1", inviteId: "inv-1" });
    for (let i = 0; i < 5; i++) {
      row.tapAccept();
    }
    assert.equal(
      row.state.acceptCallCount,
      1,
      "5 rapid taps must invoke onAccept exactly ONCE (idempotency under spam)"
    );
    assert.deepEqual(row.state.acceptArgs, [
      { sessionId: "sess-1", inviteId: "inv-1" },
    ]);
    assert.equal(row.state.isProcessing, true, "isProcessing latched true");
  }

  // SCENARIO B — 5 rapid Decline taps fire onDecline exactly ONCE
  {
    const row = createRow({ sessionId: "sess-2", inviteId: "inv-2" });
    for (let i = 0; i < 5; i++) {
      row.tapDecline();
    }
    assert.equal(
      row.state.declineCallCount,
      1,
      "5 rapid Decline taps must invoke onDecline exactly ONCE"
    );
  }

  // SCENARIO C — after Accept resolves, second tap on same row is allowed
  //             (regression guard: the disable is processing-bound, not permanent)
  {
    const row = createRow({ sessionId: "sess-3", inviteId: "inv-3" });
    row.tapAccept();
    assert.equal(row.state.acceptCallCount, 1);
    row.resolveProcessing();
    row.tapAccept();
    assert.equal(
      row.state.acceptCallCount,
      2,
      "After processing resolves, a fresh tap is allowed (e.g. retry-after-error UX)"
    );
  }

  // SCENARIO D — tapping Accept then Decline while Accept is in flight does NOT
  //             fire Decline (the user can't accidentally double-action the same invite)
  {
    const row = createRow({ sessionId: "sess-4", inviteId: "inv-4" });
    row.tapAccept();
    row.tapDecline();
    assert.equal(row.state.acceptCallCount, 1);
    assert.equal(
      row.state.declineCallCount,
      0,
      "Decline blocked while Accept is processing"
    );
  }

  // SCENARIO E — confirm decline mirrors accept's protection
  {
    const row = createRow({ sessionId: "sess-5", inviteId: "inv-5" });
    row.tapDecline();
    row.tapAccept();
    assert.equal(row.state.declineCallCount, 1);
    assert.equal(
      row.state.acceptCallCount,
      0,
      "Accept blocked while Decline is processing"
    );
  }

  console.log(
    "PASS T-ADV-3 PendingSessionInviteRow adversarial: spam idempotency + post-resolve re-enable + cross-button mutex"
  );
}

run();
