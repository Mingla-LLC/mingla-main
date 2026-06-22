/**
 * ORCH-1211 [business notifications inbox crashes on mobile web] — WEB render
 * proof (implementor happy-path regression test).
 *
 * THE BUG (Seth, business web on mobile): tapping the bell → `/notifications`
 * crashed the WHOLE page into the global "Something broke." fallback. Root cause
 * (forensics via live Chromium): `BusinessNotificationsScreen.tsx:145` called the
 * `react-native-reanimated` builder `LinearTransition.duration(...)` at MODULE TOP
 * LEVEL. `LinearTransition` is `undefined` on web at module-eval, so reading
 * `.duration` threw "Cannot read properties of undefined (reading 'duration')" the
 * instant the route imported the screen — before any render guard — bubbling to
 * the global ErrorBoundary. The fix guards the builder call to native:
 *   const EXPAND_TRANSITION = isWeb ? undefined : LinearTransition.duration(...);
 *
 * WHY THIS RENDER IS A TRUE FAILS-ON-REVERT PROOF: jest's node resolver normally
 * mis-resolves reanimated to a build where LinearTransition IS defined (spec §7),
 * which would NOT reproduce the crash. So this config pins reanimated to the
 * PROVEN web condition via `jest.orch1211.reanimated-web-stub.cjs`
 * (`LinearTransition === undefined`), and aliases `react-native → react-native-web`
 * so `Platform.OS === "web"`. Then:
 *   - FIXED file: the `isWeb ? undefined : …` guard short-circuits → the undefined
 *     builder is never touched → the screen IMPORTS + renders the inbox states.
 *   - REVERTED file (line 145 unguarded): `LinearTransition.duration(...)` reads
 *     `.duration` on `undefined` at import → THROWS → these tests FAIL (the import
 *     itself throws, so even rendering the empty state fails).
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   revert line 145 to `const EXPAND_TRANSITION = LinearTransition.duration(...)`
 *   → the module import throws → all three tests below fail.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1211.notifweb.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

// ── Controllable inbox-hook mock (the screen's only data source) ──────────────
// The hook itself (useBusinessNotifications) + its deleted_at filter + soft-delete
// semantics are DO-NOT-TOUCH; here we only stand in for its return so we can drive
// the populated / empty / error render branches deterministically on web.
type RowState = "populated" | "empty" | "error" | "loading";
// `mock`-prefixed so jest's `jest.mock` factory-hoisting allows the reference.
let mockRowState: RowState = "populated";

const mockPopulatedRow = {
  id: "n1",
  user_id: "u1",
  brand_id: "b1",
  type: "stripe.payout.paid",
  title: "Payout sent to your bank",
  body: "Your weekly payout of $420.00 is on the way.",
  deep_link: null,
  read_at: null,
  deleted_at: null,
  created_at: new Date().toISOString(),
  data: null,
};

// Icon pulls in react-native-svg, whose native `src/` build needs `__DEV__` +
// TurboModule registry (absent under the node web render). It is NOT the element
// under assertion (the inbox state TEXT is) — stub it to a no-op.
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

// Fully replace the hook module (do NOT requireActual — its real impl imports
// services/supabase → expo-constants → expo-modules-core, which need `__DEV__` +
// native modules absent under the node web render). The screen only consumes the
// inbox hook + the `BusinessNotification` TYPE (erased at compile time).
jest.mock("../../../hooks/useBusinessNotifications", () => {
  return {
    useBusinessNotificationsInbox: () => {
      const notifications =
        mockRowState === "populated" ? [mockPopulatedRow] : [];
      return {
        query: {
          isLoading: mockRowState === "loading",
          isError: mockRowState === "error",
          isFetching: false,
          refetch: () => Promise.resolve(),
        },
        notifications,
        unreadCount: mockRowState === "populated" ? 1 : 0,
        markAsRead: () => Promise.resolve(),
        markAllAsRead: () => Promise.resolve(),
        softDelete: () => Promise.resolve(),
        clearRead: () => Promise.resolve(),
        hasRead: false,
      };
    },
  };
});

import { BusinessNotificationsScreen } from "../BusinessNotificationsScreen";

function renderHtml(): string {
  return ReactDOMServer.renderToStaticMarkup(
    <BusinessNotificationsScreen userId="u1" />,
  );
}

describe("ORCH-1211 — /notifications renders on WEB without the reanimated module-eval crash", () => {
  it("T-1: populated inbox renders the row title (no throw, no 'Something broke')", () => {
    mockRowState = "populated";
    const html = renderHtml();
    expect(html).toContain("Payout sent to your bank");
    expect(html).not.toContain("Something broke");
  });

  it("T-2: empty inbox renders the caught-up empty state (no throw)", () => {
    mockRowState = "empty";
    const html = renderHtml();
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).not.toContain("Something broke");
  });

  it("T-6: error path renders the error state + Retry (no throw)", () => {
    mockRowState = "error";
    const html = renderHtml();
    expect(html).toContain("Couldn&#x27;t load your notifications");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Something broke");
  });
});
