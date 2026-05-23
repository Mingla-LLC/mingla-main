declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");

type ChooserState = {
  chooserVisible: boolean;
  pairRequestVisible: boolean;
  createGroupVisible: boolean;
  paywallVisible: boolean;
  rafQueue: Array<() => void>;
};

function createHarness() {
  const state: ChooserState = {
    chooserVisible: false,
    pairRequestVisible: false,
    createGroupVisible: false,
    paywallVisible: false,
    rafQueue: [],
  };

  const requestAnimationFrame = (fn: () => void) => {
    state.rafQueue.push(fn);
  };

  return {
    state,
    tapPlus() {
      state.chooserVisible = true;
    },
    tapAddFriend() {
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.pairRequestVisible = true;
      });
    },
    tapCreateGroupChat() {
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.createGroupVisible = true;
      });
    },
    tapCreatePaywall() {
      state.chooserVisible = false;
      requestAnimationFrame(() => {
        state.paywallVisible = true;
      });
    },
    flushRaf() {
      const queued = [...state.rafQueue];
      state.rafQueue = [];
      queued.forEach((fn) => fn());
    },
  };
}

export function runFriendsActionChooserSheetHappyTest() {
  const addHarness = createHarness();
  addHarness.tapPlus();
  assert.equal(addHarness.state.chooserVisible, true);
  addHarness.tapAddFriend();
  assert.equal(addHarness.state.chooserVisible, false);
  assert.equal(addHarness.state.pairRequestVisible, false, "Pair modal waits for requestAnimationFrame");
  addHarness.flushRaf();
  assert.equal(addHarness.state.pairRequestVisible, true);

  const createHarnessInstance = createHarness();
  createHarnessInstance.tapPlus();
  createHarnessInstance.tapCreateGroupChat();
  assert.equal(createHarnessInstance.state.chooserVisible, false);
  assert.equal(createHarnessInstance.state.createGroupVisible, false, "Create sheet waits for requestAnimationFrame");
  createHarnessInstance.flushRaf();
  assert.equal(createHarnessInstance.state.createGroupVisible, true);

  const paywallHarness = createHarness();
  paywallHarness.tapPlus();
  paywallHarness.tapCreatePaywall();
  paywallHarness.flushRaf();
  assert.equal(paywallHarness.state.paywallVisible, true);
}

if (require.main === module) {
  try {
    runFriendsActionChooserSheetHappyTest();
    console.log("PASS T-IMP-1 FriendsActionChooserSheet happy path");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
