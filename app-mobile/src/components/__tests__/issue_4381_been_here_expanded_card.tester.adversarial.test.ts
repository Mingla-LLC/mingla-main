// @ts-nocheck — Deno-runtime behavioural suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4381 — TESTER ADVERSARIAL. "Been here" did nothing on an expanded card.
//
// The implementor's suite reads the source and checks that the right names sit
// in the right statements. This one does not grep for names. It RUNS the real
// decision code:
//
//   * the real placeReviewRequestStore.ts (its own openRequest / cancelRequest /
//     confirmRequest, and its own usePlaceReviewRequest selector), with zustand's
//     React binding replaced by a plain selector over the same vanilla store
//     semantics zustand uses (shallow merge, function updaters, subscribers);
//   * the real ExpandedCardModal.tsx statements, from `rootSuspendedForShare`
//     through `handleRootSheetClose`, plus the real `visible=` and `onClose=`
//     expressions handed to the root <BaseBottomSheet wrapInRNModal>;
//
// and drives them the way BaseBottomSheet does: when the `visible` it is given
// flips true -> false, it calls the `onClose` it was given (onChange(-1),
// BaseBottomSheet.tsx). That synthetic close is exactly what must be swallowed.
//
// Angles the implementor's test cannot see:
//   A. open -> cancel brings the SAME card back, and onClose never fires;
//   B. open -> confirm brings it back, arms the thank-you token, onClose never fires;
//   C. a request for a DIFFERENT card id still lowers this sheet (it is the one
//      native presentation slot, whoever asked for it);
//   D. confirmRequest with no open request is a no-op for the store AND the sheet;
//   E. negative control: a real user close (visible prop -> false) with no request
//      DOES call onClose, before and after a review cycle — so the zero counts in
//      A-D are zeros-because-guarded, not zeros-because-the-spy-is-broken.
//
// FAILS-ON-REVERT: on dda822635a (before the fix) the sheet stays up when a
// review request opens, so A, B, C and F fail on "sheet steps aside".

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

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

async function loadStore() {
  const source = await read("store/placeReviewRequestStore.ts");
  const importLine = "import { create } from 'zustand';";
  assert(source.split(importLine).length === 2, "the store still creates itself with zustand's create");
  return await importTs(source.replace(importLine, ZUSTAND_SHIM));
}

async function loadSheetDecision() {
  const sheet = await read("components/ExpandedCardModal.tsx");
  const start = sheet.indexOf("const rootSuspendedForShare =");
  const end = sheet.indexOf("const focusShareControl = useCallback(");
  assert(start > 0 && end > start, "found the child-surface block in ExpandedCardModal");
  const block = sheet.slice(start, end);

  const rootSheet = /<BaseBottomSheet\s+visible=\{([^}]*)\}\s+onClose=\{([^}]*)\}[\s\S]*?\bwrapInRNModal\b/.exec(sheet);
  assert(rootSheet, "found the root <BaseBottomSheet wrapInRNModal> and its visible/onClose props");

  const module = await importTs(`
export function render(env) {
  const {
    visible, onClose, useCallback, usePlaceReviewRequest,
    browserUrl, ticketBrowserUrl, isSchedulePickerOpen, curatedLightbox,
    selectedVenueExperience, isReserveSheetOpen, shareHandoffPhase, shareHandoffPhaseRef,
  } = env;
  ${block}
  return { sheetVisible: (${rootSheet[1]}), sheetOnClose: ${rootSheet[2]} };
}
`);
  return module.render;
}

/**
 * One expanded card, mounted. Re-renders on every store change (as the hook
 * subscription would) and on prop changes, and plays BaseBottomSheet's part:
 * a visible true -> false edge calls the onClose prop of that render.
 */
async function mountExpandedCard(store, cardId: string) {
  const render = await loadSheetDecision();
  const calls = { onClose: 0 };
  let props = { visible: true };
  let lastVisible = false;
  let current;

  const commit = () => {
    current = render({
      visible: props.visible,
      onClose: () => { calls.onClose += 1; },
      useCallback: (fn) => fn,
      usePlaceReviewRequest: store.usePlaceReviewRequest,
      browserUrl: null,
      ticketBrowserUrl: null,
      isSchedulePickerOpen: false,
      curatedLightbox: { visible: false },
      selectedVenueExperience: null,
      isReserveSheetOpen: false,
      shareHandoffPhase: "idle",
      shareHandoffPhaseRef: { current: "idle" },
    });
    if (lastVisible && !current.sheetVisible) current.sheetOnClose();
    lastVisible = current.sheetVisible;
  };

  const unsubscribe = store.usePlaceReviewRequestStore.subscribe(commit);
  commit();
  return {
    cardId,
    calls,
    get sheetVisible() { return current.sheetVisible; },
    setVisible(next: boolean) { props = { visible: next }; commit(); },
    unmount: unsubscribe,
  };
}

function freshStore(store) {
  store.usePlaceReviewRequestStore.setState({ request: null, confirmedCardId: null, confirmToken: 0 });
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

Deno.test("#4381 A: Been here then cancel brings the same card back and never closes it", async () => {
  const store = await loadStore();
  freshStore(store);
  const card = await mountExpandedCard(store, SINGLE.id);
  assert(card.sheetVisible, "the expanded card is up before the tap");

  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE));
  assert(!card.sheetVisible, "sheet steps aside while the review prompt is open");
  assertEquals(card.calls.onClose, 0, "stepping aside is not the user closing the card");

  store.cancelPlaceReviewRequest();
  assert(card.sheetVisible, "the same expanded card comes back after cancel");
  assertEquals(card.calls.onClose, 0, "cancel never tears the card down");
  const s = store.usePlaceReviewRequestStore.getState();
  assertEquals(s.confirmToken, 0, "cancel leaves no thank-you flash");
  assertEquals(s.confirmedCardId, null, "cancel records no confirmation");
  card.unmount();
});

Deno.test("#4381 B: Been here then submit on a curated plan brings the card back and never closes it", async () => {
  const store = await loadStore();
  freshStore(store);
  const card = await mountExpandedCard(store, CURATED.id);

  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(CURATED));
  assert(!card.sheetVisible, "sheet steps aside while the review prompt is open");

  store.confirmPlaceReviewRequest();
  assert(card.sheetVisible, "the expanded card comes back after submit");
  assertEquals(card.calls.onClose, 0, "submit never tears the card down");
  const s = store.usePlaceReviewRequestStore.getState();
  assertEquals(s.request, null, "the request is cleared");
  assertEquals(s.confirmedCardId, CURATED.id, "the confirmed card is the curated plan");
  assertEquals(s.confirmToken, 1, "exactly one thank-you flash is armed");
  card.unmount();
});

Deno.test("#4381 C: a review request for a DIFFERENT card still frees the presentation slot", async () => {
  const store = await loadStore();
  freshStore(store);
  const card = await mountExpandedCard(store, SINGLE.id);

  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(CURATED));
  assert(!card.sheetVisible, "sheet steps aside for any open review request, not only its own card");
  assertEquals(card.calls.onClose, 0, "and still does not close");

  store.cancelPlaceReviewRequest();
  assert(card.sheetVisible, "and comes back when that request is cancelled");
  assertEquals(card.calls.onClose, 0, "no close across the whole cycle");
  card.unmount();
});

Deno.test("#4381 D: confirmRequest with no open request is a no-op for the store and the sheet", async () => {
  const store = await loadStore();
  freshStore(store);
  const card = await mountExpandedCard(store, SINGLE.id);
  const before = store.usePlaceReviewRequestStore.getState();

  store.confirmPlaceReviewRequest();
  const after = store.usePlaceReviewRequestStore.getState();
  assertEquals(after.request, null, "no request appears");
  assertEquals(after.confirmedCardId, before.confirmedCardId, "no card is marked confirmed");
  assertEquals(after.confirmToken, before.confirmToken, "no thank-you flash is armed");
  assert(card.sheetVisible, "the sheet does not flicker away");
  assertEquals(card.calls.onClose, 0, "and is not closed");

  store.cancelPlaceReviewRequest();
  assert(card.sheetVisible, "a stray cancel is equally harmless");
  assertEquals(card.calls.onClose, 0, "stray cancel does not close");
  card.unmount();
});

Deno.test("#4381 E: negative control — a real close still calls onClose, before and after a review cycle", async () => {
  const store = await loadStore();
  freshStore(store);

  const first = await mountExpandedCard(store, SINGLE.id);
  first.setVisible(false);
  assertEquals(first.calls.onClose, 1, "the user closing the card with no review open closes it");
  first.unmount();

  const second = await mountExpandedCard(store, SINGLE.id);
  store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE));
  store.cancelPlaceReviewRequest();
  assertEquals(second.calls.onClose, 0, "the review cycle itself did not close");
  second.setVisible(false);
  assertEquals(second.calls.onClose, 1, "the guard does not stick once the prompt has gone");
  second.unmount();
});

Deno.test("#4381 F: repeated cycles (cancel then submit) never close the card", async () => {
  const store = await loadStore();
  freshStore(store);
  const card = await mountExpandedCard(store, SINGLE.id);

  for (const finish of ["cancel", "confirm", "cancel", "confirm"]) {
    store.openPlaceReviewRequest(store.placeReviewRequestFromCard(SINGLE));
    assert(!card.sheetVisible, `sheet steps aside (${finish} cycle)`);
    if (finish === "cancel") store.cancelPlaceReviewRequest();
    else store.confirmPlaceReviewRequest();
    assert(card.sheetVisible, `sheet comes back (${finish} cycle)`);
  }
  assertEquals(card.calls.onClose, 0, "four cycles, zero closes");
  assertEquals(store.usePlaceReviewRequestStore.getState().confirmToken, 2, "two submits, two flashes");
  card.unmount();
});
