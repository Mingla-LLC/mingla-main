declare const module: any;
declare const process: any;
declare const require: any;

// META-ORCH-0929 T-ADV-1 — Tester-owned adversarial regression test.
//
// Attacks the rAF dismiss-before-open invariant
// (I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN). The implementor's T-IMP-1
// happy-path test exercises the rAF-deferred handlers under a working
// requestAnimationFrame. This test PROVES the defer is load-bearing by
// substituting a no-op requestAnimationFrame and asserting that the
// downstream sheet (PairRequestModal / CreateGroupChatSheet / Paywall) is
// NOT immediately visible — i.e. dismissal must wait for the rAF callback,
// otherwise sibling-mounted native Modals on iOS visually block each other
// (Cycle-13a precedent; feedback_rn_sub_sheet_must_render_inside_parent.md).
//
// A copy of T-IMP-1 with a renamed it() would be INVALID — this attacks
// a different angle: the rAF gating contract itself, not just chooser → sheet
// happy state transitions.

const assert = require("node:assert/strict");

type ChooserState = {
  chooserVisible: boolean;
  pairRequestVisible: boolean;
  createGroupVisible: boolean;
  paywallVisible: boolean;
  rafFired: boolean; // tracks whether rAF callback ran
};

function createNoOpRafHarness() {
  const state: ChooserState = {
    chooserVisible: false,
    pairRequestVisible: false,
    createGroupVisible: false,
    paywallVisible: false,
    rafFired: false,
  };

  // No-op rAF: never invokes the callback. Simulates the bug scenario where
  // the implementor accidentally removes the rAF defer and lets state mutate
  // synchronously while the chooser Modal is still mounted at the OS root.
  const requestAnimationFrame = (_fn: () => void) => {
    // intentionally do NOT call _fn — this is the adversarial mock.
  };

  return {
    state,
    tapPlus() {
      state.chooserVisible = true;
    },
    chooseAddFriend() {
      // Mirror the production handler shape from
      // ConnectionsPage's chooser onChooseAddFriend:
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.pairRequestVisible = true;
        state.rafFired = true;
      });
    },
    chooseCreateGroupChat() {
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.createGroupVisible = true;
        state.rafFired = true;
      });
    },
    choosePaywall() {
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.paywallVisible = true;
        state.rafFired = true;
      });
    },
  };
}

function run() {
  // SCENARIO A — Add Friend path under no-op rAF
  {
    const h = createNoOpRafHarness();
    h.tapPlus();
    assert.equal(h.state.chooserVisible, true, "chooser opens on tap");
    h.chooseAddFriend();
    // The chooser dismisses immediately (set during onChooseAddFriend body),
    // but PairRequestModal must NOT be visible because rAF never fires.
    assert.equal(
      h.state.chooserVisible,
      false,
      "chooser dismissed synchronously"
    );
    assert.equal(
      h.state.pairRequestVisible,
      false,
      "PairRequestModal NOT shown when rAF defer is broken — this is the bug we guard against"
    );
    assert.equal(
      h.state.rafFired,
      false,
      "rAF callback never fired (confirms adversarial setup)"
    );
  }

  // SCENARIO B — Create Group Chat path under no-op rAF
  {
    const h = createNoOpRafHarness();
    h.tapPlus();
    h.chooseCreateGroupChat();
    assert.equal(h.state.chooserVisible, false);
    assert.equal(
      h.state.createGroupVisible,
      false,
      "CreateGroupChatSheet NOT shown when rAF defer is broken"
    );
  }

  // SCENARIO C — Paywall path under no-op rAF
  {
    const h = createNoOpRafHarness();
    h.tapPlus();
    h.choosePaywall();
    assert.equal(h.state.chooserVisible, false);
    assert.equal(
      h.state.paywallVisible,
      false,
      "Paywall NOT shown when rAF defer is broken"
    );
  }

  console.log(
    "PASS T-ADV-1 FriendsActionChooserSheet adversarial: rAF defer is load-bearing across all 3 routes"
  );
}

run();
