// @ts-nocheck — Deno-runtime behavioural suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4381 — TESTER ADVERSARIAL. "Been here" did nothing on an expanded card.
//
// The first fix lowered the expanded card while a review request was open. It
// passed every source test and FAILED on the iOS simulator: the prompt was told
// to present in the SAME commit the sheet was told to dismiss, UIKit logged
// "Attempt to present <RCTFabricModalHostViewController> ... which is already
// presenting <RCTFabricModalHostViewController>", the prompt never appeared,
// the request stayed open, and the sheet stayed suspended until a restart.
//
// This suite RUNS the real decision code against a model of the native layer
// that has the property the device has and the old tests lacked:
//
//   * the real placeReviewRequestStore.ts, with zustand's React binding replaced
//     by a plain selector over the same vanilla store semantics;
//   * the real ExpandedCardModal.tsx statements from `rootSuspendedForShare`
//     through `handleRootSheetClose`, its real `handleRootNativeShow` /
//     `handleRootNativeDismiss`, and the real `visible=` / `onClose=` handed to
//     the root <BaseBottomSheet wrapInRNModal>;
//   * the real app/index.tsx wiring of the single <PostExperienceModal>: which
//     store hook feeds `voluntaryPlaceReview`, its `visible=` expression, and
//     which store actions it hands to `onNativeShow` / `onNativeDismiss`;
//
// and a NATIVE MODEL of iOS: ONE presentation slot. A present while another
// host still holds it (its dismiss has not completed) is REFUSED and logged,
// and onShow never fires. Dismissal completes asynchronously and only then
// fires onDismiss. Android is modelled as stacking dialogs with a post-commit
// dismiss acknowledgement (BaseBottomSheet's NativeModalLifecycleAdapter).
//
// FAILS-ON-REVERT: on fe43221285 (the first fix) A1/A2/A3/B1/B2/C1 fail on the
// "already presenting" refusal or on a prompt that is presentable while the
// sheet still holds the slot, and D1/D2/D4 fail because there is no safety net.
// On cb94f0d368 G1 fails: closing the card the way the deck does unmounts the
// sheet with no native dismiss, the slot stays held, and the next Been here on
// the collapsed card is cancelled by the safety net with the failure toast.

const root = new URL("../../", import.meta.url);
const appRoot = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const readApp = (path: string) => Deno.readTextFile(new URL(path, appRoot));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const importTs = (code: string) =>
  import(`data:application/typescript;base64,${btoa(unescape(encodeURIComponent(code)))}`);

/** zustand's vanilla store semantics, bound without React: the hook is a selector over getState(). */
const ZUSTAND_SHIM = `
const create = (initializer) => {
  let state;
  const listeners = new Set();
  const setState = (partial, replace) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(next, state)) {
      const previous = state;
      state = replace ?? (typeof next !== "object" || next === null) ? next : Object.assign({}, state, next);
      listeners.forEach((listener) => listener(state, previous));
    }
  };
  const getState = () => state;
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const api = { setState, getState, subscribe };
  state = initializer(setState, getState, api);
  const useBoundStore = (selector = (s) => s) => selector(getState());
  return Object.assign(useBoundStore, api);
};
`;

let storeCounter = 0;
async function loadStore() {
  const source = await read("store/placeReviewRequestStore.ts");
  const importLine = "import { create } from 'zustand';";
  assert(source.split(importLine).length === 2, "the store still creates itself with zustand's create");
  // A unique suffix gives every test its own module instance (and its own store).
  storeCounter += 1;
  return await importTs(`${source.replace(importLine, ZUSTAND_SHIM)}\n// instance ${storeCounter}\n`);
}

function extractCallback(source: string, name: string): string {
  const re = new RegExp(`const ${name} = useCallback\\(\\(\\): void => \\{[\\s\\S]*?\\n  \\}, \\[[^\\]]*\\]\\);`);
  const match = re.exec(source);
  assert(match, `found ${name} in ExpandedCardModal`);
  return match[0];
}

async function loadSheet(storeExports: string[]) {
  const sheet = await read("components/ExpandedCardModal.tsx");
  const start = sheet.indexOf("const rootSuspendedForShare =");
  const end = sheet.indexOf("const focusShareControl = useCallback(");
  assert(start > 0 && end > start, "found the child-surface block in ExpandedCardModal");
  const block = sheet.slice(start, end);
  const nativeShow = extractCallback(sheet, "handleRootNativeShow");
  const nativeDismiss = extractCallback(sheet, "handleRootNativeDismiss");

  // The release that runs when this component can no longer present its root
  // sheet (the card closed the way the deck does). Optional on purpose: on a
  // revert it is absent and G1 fails on behaviour, not on a missing string.
  const releaseOnClose = /const rootSheetMounted =[\s\S]*?\}, \[rootSheetMounted\]\);/.exec(sheet)?.[0] ?? "";

  const rootSheet = /<BaseBottomSheet\s+visible=\{([^}]*)\}\s+onClose=\{([^}]*)\}[\s\S]*?\bwrapInRNModal\b/.exec(sheet);
  assert(rootSheet, "found the root <BaseBottomSheet wrapInRNModal> and its visible/onClose props");

  const module = await importTs(`
export function render(env) {
  const { ${storeExports.join(", ")} } = env.store;
  const {
    visible, onClose, useCallback, useRef, useEffect, card, businessEvent,
    browserUrl, ticketBrowserUrl, isSchedulePickerOpen, curatedLightbox,
    selectedVenueExperience, isReserveSheetOpen, shareHandoffPhase, shareHandoffPhaseRef,
    rootDismissedAcknowledgement, rootShownAcknowledgement,
  } = env;
  ${block}
  ${nativeShow}
  ${nativeDismiss}
  ${releaseOnClose}
  return {
    sheetVisible: (${rootSheet[1]}),
    sheetOnClose: ${rootSheet[2]},
    onNativeShow: handleRootNativeShow,
    onNativeDismiss: handleRootNativeDismiss,
  };
}
`);
  return module.render;
}

/** The single <PostExperienceModal> mount in app/index.tsx, as wired today. */
async function loadPromptWiring() {
  const index = await readApp("app/index.tsx");
  const feed = /const voluntaryPlaceReview = (\w+)\(\);/.exec(index);
  assert(feed, "index.tsx derives voluntaryPlaceReview from a store hook");
  const presentable = /const voluntaryPromptPresentable = (\w+)\(\);/.exec(index);
  const mount = index.indexOf("<PostExperienceModal");
  assert(mount > 0, "index.tsx mounts PostExperienceModal");
  const element = index.slice(mount, index.indexOf("/>", index.indexOf("onCancel=", mount)));
  const visible = /visible=\{([^}]*)\}/.exec(element);
  assert(visible, "the mount has a visible= expression");
  const shown = /onNativeShow=\{(\w+)\}/.exec(element);
  const dismissed = /onNativeDismiss=\{(\w+)\}/.exec(element);
  const visibleOf = new Function(
    "voluntaryPlaceReview",
    "voluntaryPromptPresentable",
    "showReviewModal",
    `return (${visible[1]});`,
  );
  return {
    feed: feed[1],
    presentable: presentable?.[1] ?? null,
    visibleOf,
    onShow: shown?.[1] ?? null,
    onDismiss: dismissed?.[1] ?? null,
  };
}

/**
 * The native presentation layer.
 *  iOS: ONE slot. A present while another host holds it (including while that
 *       host's dismiss is still in flight) is refused, logged, and never shown.
 *  Android: dialogs stack; dismiss is acknowledged post-commit.
 */
function createNative(platform: "ios" | "android") {
  const tasks: Array<() => void> = [];
  const refusals: string[] = [];
  const hosts = new Map();
  let slot: string | null = null;

  const host = (name: string) => {
    if (!hosts.has(name)) hosts.set(name, { intent: false, presented: false, attempted: false, dropDismiss: false });
    return hosts.get(name);
  };

  return {
    refusals,
    get slot() { return slot; },
    isPresented: (name: string) => host(name).presented,
    occupy(name: string) { slot = name; host(name).presented = true; host(name).intent = true; },
    dropDismissFor(name: string) { host(name).dropDismiss = true; },
    /** The host's RN Modal unmounts while presented: the view goes away, onDismiss never fires. */
    unmount(name: string) {
      const h = host(name);
      h.intent = false;
      h.attempted = false;
      h.presented = false;
      if (slot === name) slot = null;
    },
    /** One host's committed `visible`, with the callbacks of that render. */
    commit(name: string, visible: boolean, callbacks: { onShow?: () => void; onDismiss?: () => void }) {
      const h = host(name);
      h.callbacks = callbacks;
      if (visible === h.intent) return;
      h.intent = visible;
      if (visible) {
        if (platform === "ios" && slot !== null && slot !== name) {
          refusals.push(`Attempt to present ${name} which is already presenting ${slot}`);
          h.attempted = false;
          return;
        }
        h.attempted = true;
        if (platform === "ios") slot = name;
        tasks.push(() => {
          h.presented = true;
          h.callbacks.onShow?.();
        });
        return;
      }
      if (!h.attempted && !h.presented) return;
      h.attempted = false;
      const finish = () => {
        h.presented = false;
        if (slot === name) slot = null;
        if (!h.dropDismiss) h.callbacks.onDismiss?.();
      };
      if (platform === "android") tasks.unshift(finish);
      else tasks.push(finish);
    },
    flush() {
      let guard = 0;
      while (tasks.length > 0) {
        guard += 1;
        assert(guard < 500, "native task queue did not settle");
        tasks.shift()();
      }
    },
  };
}

function createClock() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    timers: {
      set: (callback: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, callback });
        return id;
      },
      clear: (id: number) => { timers.delete(id); },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id);
          t.callback();
        }
      }
    },
  };
}

/**
 * The app: one expanded card (optional) and the single prompt mount, committed
 * together on every store change, in tree order (the card's sheet first).
 */
async function mountApp({ platform = "ios", withExpandedCard = true } = {}) {
  const store = await loadStore();
  const exportNames = Object.keys(store);
  const renderSheet = await loadSheet(exportNames);
  const wiring = await loadPromptWiring();
  const native = createNative(platform);
  const clock = createClock();
  const calls = { onClose: 0, toasts: 0 };
  const refSlots: Array<{ current: unknown }> = [];
  let props = { visible: true, card: SINGLE };
  let sheetMounted = false;
  const effectSlots: Array<{ deps: unknown[] | undefined }> = [];
  let pendingEffects: Array<() => void> = [];
  let lastSheetVisible = false;
  let current;
  let promptMounted = false;
  let promptVisible = false;

  const env = () => {
    let refIndex = 0;
    let effectIndex = 0;
    return {
      store,
      visible: props.visible,
      card: props.card,
      businessEvent: null,
      useEffect: (fn, deps) => {
        const i = effectIndex++;
        const previous = effectSlots[i];
        const changed = !previous || !deps || deps.some((d, k) => !Object.is(d, previous.deps?.[k]));
        effectSlots[i] = { deps };
        if (changed) pendingEffects.push(fn);
      },
      onClose: () => { calls.onClose += 1; },
      useCallback: (fn) => fn,
      useRef: (initial) => {
        const i = refIndex++;
        if (!refSlots[i]) refSlots[i] = { current: initial };
        return refSlots[i];
      },
      browserUrl: null,
      ticketBrowserUrl: null,
      isSchedulePickerOpen: false,
      curatedLightbox: { visible: false },
      selectedVenueExperience: null,
      isReserveSheetOpen: false,
      shareHandoffPhase: "idle",
      shareHandoffPhaseRef: { current: "idle" },
      rootDismissedAcknowledgement: { current: null },
      rootShownAcknowledgement: { current: null },
    };
  };

  const commit = () => {
    if (withExpandedCard) {
      current = renderSheet(env());
      // ExpandedCardModal stays mounted; with no card it returns null, so the
      // root <BaseBottomSheet> and its RN Modal unmount (no onClose, no onDismiss).
      const nowMounted = props.card !== null;
      if (sheetMounted && !nowMounted) {
        native.unmount("sheet");
        lastSheetVisible = false;
      }
      sheetMounted = nowMounted;
      if (nowMounted) {
        if (lastSheetVisible && !current.sheetVisible) current.sheetOnClose();
        lastSheetVisible = current.sheetVisible;
        native.commit("sheet", current.sheetVisible, {
          onShow: current.onNativeShow,
          onDismiss: current.onNativeDismiss,
        });
      }
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    }
    const voluntary = store[wiring.feed]();
    const presentable = wiring.presentable ? store[wiring.presentable]() : undefined;
    promptMounted = voluntary !== null;
    promptVisible = promptMounted && wiring.visibleOf(voluntary, presentable, false) === true;
    native.commit("prompt", promptVisible, {
      onShow: wiring.onShow ? store[wiring.onShow] : undefined,
      onDismiss: wiring.onDismiss ? store[wiring.onDismiss] : undefined,
    });
  };

  store.usePlaceReviewRequestStore.subscribe(commit);
  const stopWatch = typeof store.watchPlaceReviewPresentation === "function"
    ? store.watchPlaceReviewPresentation(() => { calls.toasts += 1; }, 1500, clock.timers)
    : () => {};
  commit();
  native.flush();

  return {
    store,
    native,
    clock,
    calls,
    get sheetVisible() { return current?.sheetVisible ?? false; },
    get promptVisible() { return promptVisible; },
    get promptMounted() { return promptMounted; },
    get request() { return store.usePlaceReviewRequestStore.getState().request; },
    setVisible(next: boolean) { props = { ...props, visible: next }; commit(); native.flush(); },
    /** SwipeableCards.handleCloseExpandedModal / SavedTab.handleCloseModal: both cleared in one commit. */
    closeLikeTheDeck() { props = { visible: false, card: null }; commit(); native.flush(); },
    unmount: stopWatch,
  };
}

const SINGLE = {
  id: "cc3213ba-2491-4bdb-8488-f5e0c3e2b03e",
  title: "Dram & Draught",
  category: "Drinks",
  cardType: "place",
};
const CURATED = {
  id: "curated_first-date_1785970643499_hqmpf9",
  title: "Regal Crossroads to Rey's Restaurant",
  category: "First Date",
  cardType: "curated",
};

/** The prompt's own close: the user taps X (cancel) or Done after submit (confirm). */
function closePrompt(app, how: "cancel" | "confirm") {
  if (how === "cancel") app.store.cancelPlaceReviewRequest();
  else app.store.confirmPlaceReviewRequest();
}

Deno.test("#4381 A1: the device bug — Been here on an expanded card presents the prompt on iOS", async () => {
  const app = await mountApp();
  assert(app.native.isPresented("sheet"), "the expanded card is natively up before the tap");

  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();

  assertEquals(app.native.refusals.length, 0, `no "already presenting" refusal (${app.native.refusals.join("; ")})`);
  assert(app.native.isPresented("prompt"), "the rating prompt is natively on screen");
  assert(!app.native.isPresented("sheet"), "the expanded card stepped aside");
  assertEquals(app.calls.onClose, 0, "stepping aside is not the user closing the card");
  app.unmount();
});

Deno.test("#4381 A2: the prompt is NOT presentable while the sheet still holds the slot, and is after its native dismiss", async () => {
  const app = await mountApp();

  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  // The commit that lowered the sheet has happened; its native dismiss has not landed.
  assert(!app.sheetVisible, "the sheet was told to dismiss");
  assert(app.native.isPresented("sheet"), "natively the sheet still holds the slot");
  assert(!app.promptVisible, "the prompt must not be told to present in the same commit");

  app.native.flush();
  assert(app.promptVisible, "after the sheet's native dismiss the prompt is told to present");
  assert(app.native.isPresented("prompt"), "and it presents");
  app.unmount();
});

Deno.test("#4381 A3: reverse — the sheet re-presents only after the prompt natively dismissed", async () => {
  for (const how of ["cancel", "confirm"] as const) {
    const app = await mountApp();
    app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(how === "cancel" ? SINGLE : CURATED));
    app.native.flush();
    assert(app.native.isPresented("prompt"), `${how}: prompt up`);

    closePrompt(app, how);
    assertEquals(app.request, null, `${how}: the request is closed at once`);
    assert(!app.promptVisible, `${how}: the prompt is told to dismiss`);
    assert(app.promptMounted, `${how}: and stays mounted until its native dismiss (ORCH-1063)`);
    assert(app.native.isPresented("prompt"), `${how}: natively it is still on screen`);
    assert(!app.sheetVisible, `${how}: the sheet must not re-present while the prompt holds the slot`);

    app.native.flush();
    assertEquals(app.native.refusals.length, 0, `${how}: no refusal on the way back (${app.native.refusals.join("; ")})`);
    assert(app.sheetVisible && app.native.isPresented("sheet"), `${how}: the same expanded card is back`);
    assert(!app.promptMounted, `${how}: the prompt unmounts only after it is gone`);
    assertEquals(app.calls.onClose, 0, `${how}: the card was never torn down`);
    const s = app.store.usePlaceReviewRequestStore.getState();
    assertEquals(s.confirmToken, how === "confirm" ? 1 : 0, `${how}: thank-you flash armed only on confirm`);
    app.unmount();
  }
});

Deno.test("#4381 B1: four cycles in a row (the third try failed on device) never wedge the app", async () => {
  const app = await mountApp();
  for (const how of ["cancel", "confirm", "cancel", "confirm"] as const) {
    app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
    app.native.flush();
    assert(app.native.isPresented("prompt"), `prompt presented (${how} cycle)`);
    closePrompt(app, how);
    app.native.flush();
    assert(app.native.isPresented("sheet"), `sheet back (${how} cycle)`);
    assertEquals(app.request, null, `no request left open (${how} cycle)`);
  }
  assertEquals(app.native.refusals.length, 0, `zero refusals (${app.native.refusals.join("; ")})`);
  assertEquals(app.calls.onClose, 0, "four cycles, zero closes");
  assertEquals(app.calls.toasts, 0, "and no failure toast");
  assertEquals(app.store.usePlaceReviewRequestStore.getState().confirmToken, 2, "two submits, two flashes");
  app.unmount();
});

Deno.test("#4381 B2: Android — stacking dialogs, post-commit dismiss: the full cycle still works", async () => {
  const app = await mountApp({ platform: "android" });
  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  assert(app.native.isPresented("prompt"), "prompt up on Android");
  app.store.cancelPlaceReviewRequest();
  app.native.flush();
  assert(app.native.isPresented("sheet"), "sheet back on Android");
  assertEquals(app.calls.onClose, 0, "never closed");
  assertEquals(app.calls.toasts, 0, "no failure toast");
  app.unmount();
});

Deno.test("#4381 C1: the deck path (no host modal) presents in the same commit as the tap", async () => {
  for (const platform of ["ios", "android"] as const) {
    const app = await mountApp({ platform, withExpandedCard: false });
    app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
    assert(app.promptVisible, `${platform}: no host holds the slot, so the prompt is presentable at once`);
    app.native.flush();
    assert(app.native.isPresented("prompt"), `${platform}: and presents`);
    app.unmount();
  }
});

Deno.test("#4381 D1: safety net — an outer sheet holds the slot, onShow never fires: cancel + toast", async () => {
  const app = await mountApp({ withExpandedCard: false });
  // e.g. SessionViewModal / PlansSheet: a full-screen RN Modal the store does not know about.
  app.native.occupy("outer");

  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  assertEquals(app.native.refusals.length, 1, "iOS refused the present");
  assert(app.request !== null, "the request is still open before the bound");

  app.clock.advance(1499);
  assert(app.request !== null, "not cancelled before the bound");
  app.clock.advance(1);
  app.native.flush();
  assertEquals(app.request, null, "the request is cancelled at the bound");
  assertEquals(app.calls.toasts, 1, "exactly one failure toast");
  assert(!app.promptMounted, "the prompt mount is released");
  app.unmount();
});

Deno.test("#4381 D2: safety net — the host's native dismiss never lands: cancel + toast, the card comes back", async () => {
  const app = await mountApp();
  app.native.dropDismissFor("sheet");

  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  assert(!app.promptVisible, "the prompt waits for the slot");
  app.clock.advance(1500);
  app.native.flush();
  assertEquals(app.request, null, "a request that can never present is cancelled");
  assertEquals(app.calls.toasts, 1, "and the user is told");
  assert(app.sheetVisible, "the expanded card is no longer suspended");
  assertEquals(app.calls.onClose, 0, "and was never torn down");
  app.unmount();
});

Deno.test("#4381 D4: safety net — the prompt's native dismiss never lands: the card still comes back", async () => {
  const app = await mountApp();
  app.native.dropDismissFor("prompt");
  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  app.store.cancelPlaceReviewRequest();
  app.native.flush();
  assert(!app.sheetVisible, "before the bound the sheet waits for the prompt's dismiss");
  app.clock.advance(1500);
  app.native.flush();
  assert(app.sheetVisible && app.native.isPresented("sheet"), "after the bound the expanded card is back");
  assert(!app.promptMounted, "and the prompt mount is released");
  assertEquals(app.calls.toasts, 0, "a cancel that worked is not reported as a failure");
  app.unmount();
});

Deno.test("#4381 D3: a prompt that presents in time is never cancelled by the net", async () => {
  const app = await mountApp();
  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  app.clock.advance(10_000);
  assert(app.request !== null, "the open, presented request survives the bound");
  assertEquals(app.calls.toasts, 0, "no toast");
  app.unmount();
});

Deno.test("#4381 E: negative control — a real close still calls onClose, before and after a review cycle", async () => {
  const first = await mountApp();
  first.setVisible(false);
  assertEquals(first.calls.onClose, 1, "the user closing the card with no review open closes it");
  first.unmount();

  const second = await mountApp();
  second.store.openPlaceReviewRequest(second.store.placeReviewRequestFromCard(SINGLE));
  second.native.flush();
  second.store.cancelPlaceReviewRequest();
  second.native.flush();
  assertEquals(second.calls.onClose, 0, "the review cycle itself did not close");
  second.setVisible(false);
  assertEquals(second.calls.onClose, 1, "the guard does not stick once the prompt has gone");
  assertEquals(second.store.usePlaceReviewRequestStore.getState().slotHolds, 0, "and the slot is released");
  second.unmount();
});

Deno.test("#4381 F: the scheduled prompt's show and dismiss never suspend a host", async () => {
  const store = await loadStore();
  store.markPlaceReviewPromptShown();
  const s = store.usePlaceReviewRequestStore.getState();
  assertEquals(s.promptOnScreen, false, "no voluntary display request, so nothing is tracked");
  assertEquals(store.isHostSuspendedForPrompt(s), false, "the expanded card is not held down");
  store.confirmPlaceReviewRequest();
  assertEquals(store.usePlaceReviewRequestStore.getState().confirmToken, 0, "confirm with nothing open is a no-op");
});

Deno.test("#4381 G1: the live regression — close the expanded card the way the deck does, then Been here on the collapsed card presents", async () => {
  for (const platform of ["ios", "android"] as const) {
    const app = await mountApp({ platform });
    assert(app.native.isPresented("sheet"), `${platform}: the expanded card is natively up`);
    assertEquals(app.store.usePlaceReviewRequestStore.getState().slotHolds, 1, `${platform}: and holds the slot`);

    // Card cleared and visible false in one commit: the sheet unmounts, no native dismiss.
    app.closeLikeTheDeck();
    assert(!app.native.isPresented("sheet"), `${platform}: the sheet is gone`);
    assertEquals(app.store.usePlaceReviewRequestStore.getState().slotHolds, 0, `${platform}: the slot is given back`);

    // The collapsed deck card's compact Been here.
    app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
    assert(app.promptVisible, `${platform}: the prompt is presentable at once`);
    app.native.flush();
    app.clock.advance(1500);
    app.native.flush();
    assert(app.native.isPresented("prompt"), `${platform}: the rating prompt is on screen`);
    assert(app.request !== null, `${platform}: the request was not cancelled by the safety net`);
    assertEquals(app.calls.toasts, 0, `${platform}: no "Couldn't open the rating" toast`);
    assertEquals(app.native.refusals.length, 0, `${platform}: no refusal (${app.native.refusals.join("; ")})`);
    app.unmount();
  }
});

Deno.test("#4381 G2: closing while suspended for the prompt, and closing twice, never double-releases", async () => {
  const app = await mountApp();
  app.store.openPlaceReviewRequest(app.store.placeReviewRequestFromCard(SINGLE));
  app.native.flush();
  assert(app.native.isPresented("prompt"), "prompt up; the sheet released on its native dismiss");
  assertEquals(app.store.usePlaceReviewRequestStore.getState().slotHolds, 0, "slot free while suspended");
  // Another host takes the slot meanwhile; a stale second release must not steal it.
  app.store.holdPlaceReviewSlot();
  app.closeLikeTheDeck();
  app.closeLikeTheDeck();
  assertEquals(app.store.usePlaceReviewRequestStore.getState().slotHolds, 1, "the other host's hold is untouched");
  app.unmount();
});
