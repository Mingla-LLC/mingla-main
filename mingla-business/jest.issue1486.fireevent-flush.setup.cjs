// issue #1486 [dead-jest-suites] — RTL `fireEvent` work-drain shim (HARNESS ONLY).
//
// WHY THIS EXISTS
// ---------------
// `PartnerPaystackOnboardForm.orch1331.render.test.tsx` drives an ASYNC handler
// and then asserts on the tree the update produced:
//
//     await fireEvent.press(screen.getByTestId("partner-paystack-verify-cta"));
//     expect(screen.getByTestId("partner-paystack-confirm-name")).toBeTruthy();
//
// The press reaches `Button.handlePress` -> `PartnerPaystackOnboardForm
// .handleVerify`, which `await`s `resolveMutation.mutateAsync(...)` and only
// THEN calls `setResolvedName(res.account_name)`. Every `fireEvent` call site in
// that suite is `await`ed precisely so that continuation runs before the
// assertion — and it does: the mock resolver IS called with the right args, and
// `setResolvedName` IS reached (react logs its "not wrapped in act(...)" notice
// from exactly that line). What does NOT happen is the COMMIT.
//
// RTL's `fireEvent` wraps the handler in a SYNCHRONOUS `act()`, which closes
// before the `await` inside the handler resumes. The resulting `setState`
// therefore lands OUTSIDE any act scope. Under React 18 that still committed
// synchronously: `react-test-renderer` honoured `IS_REACT_NATIVE_TEST_ENVIRONMENT`
// by creating a LEGACY root, whose updates take `SyncLane` and flush on the spot.
// React 19 deleted legacy mode — `createFiberRoot` gives every root
// `ConcurrentMode` regardless of the tag react-test-renderer passes, so the
// update takes `DefaultLane` and is handed to the Scheduler, which flushes on a
// MACROTASK. `await`ing a promise only drains MICROtasks, so the assertion runs
// against the pre-update tree. Measured, on this exact suite:
//
//     mutateAsync called:                       1
//     immediately after `await fireEvent.press` → confirm-name absent
//     after one extra microtask                 → confirm-name absent
//     after one macrotask                       → confirm-name PRESENT
//     after `await act(async () => {})`         → confirm-name PRESENT
//
// (RTL's own `concurrentRoot: false` config option does NOT help — it only
// changes the tag react-test-renderer passes, which React 19 ignores.)
//
// R-5 is the same fault wearing a different mask: the still-pending
// `setResolvedName("ADAOBI…")` gets flushed by the NEXT `fireEvent`'s sync
// `act()`, i.e. AFTER `onAccountChange` has already read `resolvedName === null`
// and skipped its invalidation — so the confirm block appears when the test
// asserts it is gone. Nothing about the product's state machine is wrong; the
// updates are simply landing one flush late.
//
// WHAT THIS DOES
// --------------
// Restores the semantics the suite was written against: an AWAITED `fireEvent`
// resolves only once React has no pending work. The handler's own return value
// is awaited first (so an async `onPress` finishes), then `act()` drains the
// scheduler, then the handler's value is returned unchanged. Nothing is stubbed,
// faked or short-circuited — the REAL component, the REAL handlers and the REAL
// reconciler do all of the work; this only stops the assertion from reading the
// tree one commit early.
//
// Scope: referenced by jest.orch1331.render.cjs ONLY, so no other suite's
// `fireEvent` semantics change.

const path = require("path");

// Resolve RTL through the SAME moduleNameMapper the suite uses (build/ on v13,
// dist/ on older builds) rather than hard-coding a layout.
const rtlEntry = require.resolve("@testing-library/react-native");
const rtlDir = path.dirname(rtlEntry);

const fireEventModule = require(path.join(rtlDir, "fire-event.js"));
const actModule = require(path.join(rtlDir, "act.js"));

const act = actModule.default;
const originalFireEvent = fireEventModule.default;

if (
  typeof originalFireEvent === "function" &&
  originalFireEvent.__issue1486DrainsWork !== true
) {
  const drain = async (returnValue) => {
    // 1. let the handler's own promise settle (async onPress -> setState).
    const value = await returnValue;
    // 2. drain everything React has queued, including the update that landed
    //    outside the synchronous act() RTL opened around the handler.
    await act(async () => {});
    return value;
  };

  const fireEventWithDrain = function fireEvent(element, eventName, ...data) {
    return drain(originalFireEvent(element, eventName, ...data));
  };

  // Preserve the shorthand surface (`fireEvent.press` etc.) exactly.
  for (const eventName of ["press", "changeText", "scroll"]) {
    fireEventWithDrain[eventName] = (element, ...data) =>
      fireEventWithDrain(element, eventName, ...data);
  }
  // Carry over anything else RTL hung off the function object.
  for (const key of Object.keys(originalFireEvent)) {
    if (fireEventWithDrain[key] === undefined) {
      fireEventWithDrain[key] = originalFireEvent[key];
    }
  }

  fireEventWithDrain.__issue1486DrainsWork = true;

  // `pure.js` re-exports `fireEvent` through a getter that reads
  // `_fireEvent.default` at ACCESS time, so replacing it here reaches every
  // import form the suite could use.
  fireEventModule.default = fireEventWithDrain;
}
