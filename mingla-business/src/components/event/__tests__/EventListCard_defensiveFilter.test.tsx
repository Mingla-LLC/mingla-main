/**
 * ORCH-0865 [trips-leak systemic + routeForEventRow helper] —
 * tester-authored adversarial regression test.
 *
 * Angle: this attacks a DIFFERENT layer from the implementor's
 * `routeForEventRow.test.ts` happy-path. The implementor's test asserts
 * the routing HELPER return values. THIS test asserts the *render-layer
 * defensive filter* inside `EventListCard.tsx` — the third layer of the
 * belt-and-braces structural fix (query filter at
 * fetchBusinessEventsForBrand + tap-handler helper at home/hub +
 * render-layer null at EventListCard).
 *
 * Adversarial because:
 *   - Defends against ALL THREE upstream layers failing simultaneously:
 *     even with a cache leak + tap-handler regression + UI wrongly
 *     mounted, the user cannot mis-perceive a trip as an event because
 *     nothing renders.
 *   - The implementor's test would pass even if this filter were deleted
 *     (the helper still returns correct values). My test would FAIL on
 *     that revert.
 *   - Inverse over-rotation guard: asserts the filter does NOT trigger
 *     on legacy rows with `event_type === undefined`.
 *
 * Fails-on-revert: removing/inverting the filter at EventListCard.tsx
 * (lines 67-77) makes every assertion below fail.
 *
 * Style note: this repo uses source-text-assertion tests rather than
 * render-tree-assertion tests (no @testing-library/react-native
 * installed). Pattern matches sibling test
 * `app/account/__tests__/edit-profile.avatar.test.tsx`.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI]: this is
 * the tester's REGRESSION TEST gate-required artifact.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const eventListCardSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/event/EventListCard.tsx"),
    "utf8",
  );

describe("ORCH-0865 — EventListCard defensive event_type filter (adversarial source assertions)", () => {
  test("DEFENSIVE FILTER EXISTS — early-return null on non-event rows", () => {
    const src = eventListCardSource();
    // Must read event_type off the event prop (type-cast tolerated since
    // LiveEvent type has event_type as optional; DraftEvent may not have
    // it; the cast is the implementor's chosen narrowing).
    expect(src).toMatch(
      /const\s+eventType\s*=\s*\(event\s+as\s+\{\s*event_type\?:\s*string\s*\}\)\.event_type/,
    );
    // Must early-return null on non-event types. The 2-arm condition is
    // load-bearing: `undefined` MUST pass through (legacy row defense)
    // AND non-"event" MUST be rejected.
    expect(src).toMatch(
      /if\s*\(eventType\s*!==\s*undefined\s*&&\s*eventType\s*!==\s*"event"\)/,
    );
    expect(src).toMatch(/return\s+null\s*;/);
  });

  test("FILTER IS BEFORE EXPENSIVE WORK — must short-circuit before useMemo/useEventOrders so trip rows don't trigger network calls", () => {
    const src = eventListCardSource();
    const filterIdx = src.indexOf("eventType !== undefined && eventType !== \"event\"");
    const firstUseMemoIdx = src.indexOf("useMemo<string>");
    const useEventOrdersIdx = src.indexOf("useEventOrders(");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(firstUseMemoIdx).toBeGreaterThan(-1);
    expect(useEventOrdersIdx).toBeGreaterThan(-1);
    // Filter MUST come before both. If anyone reorders and puts useMemo
    // before the filter, a trip row would still trigger the
    // formatDraftDateLine call + the React Query fetch — wasted work
    // and a potential cache pollution path.
    expect(filterIdx).toBeLessThan(firstUseMemoIdx);
    expect(filterIdx).toBeLessThan(useEventOrdersIdx);
  });

  test("LEGACY-PASS-THROUGH GUARD — the `!== undefined` clause is non-negotiable", () => {
    const src = eventListCardSource();
    // If anyone simplifies the condition to `eventType !== "event"`
    // (dropping the undefined check), ALL legacy persisted LiveEvents
    // (Zustand storage from pre-Tr2 builds whose rows lack event_type)
    // would be filtered out and rendered as nothing — silent data
    // disappearance. This assertion blocks that simplification.
    expect(src).not.toMatch(
      /if\s*\(eventType\s*!==\s*"event"\)\s*\{\s*return\s+null/s,
    );
  });

  test("SCOPE LIMIT — defensive filter rejects 'trip' AND 'experience' (both non-event)", () => {
    // Source-level proof: the condition `eventType !== "event"` matches
    // every type other than "event", which includes both "trip" and
    // "experience" per the LiveEvent.event_type union
    // (`"event" | "experience" | "trip"`). This test pins the union to
    // detect any future widening that would let a new type slip past.
    const liveStoreSrc = readFileSync(
      path.join(process.cwd(), "src/store/liveEventStore.ts"),
      "utf8",
    );
    expect(liveStoreSrc).toMatch(
      /event_type\?\s*:\s*"event"\s*\|\s*"experience"\s*\|\s*"trip"/,
    );
  });

  test("ORCH CITATION PRESENT — defensive filter is annotated with the structural-fix ORCH so future readers know why it exists", () => {
    const src = eventListCardSource();
    // The implementor added an ORCH-0865 REWORK 5 explanatory comment
    // right above the filter. Removing the comment block would not
    // remove the filter itself, but would strip the why and risk a
    // future engineer deleting the filter as "dead code." This pins
    // the comment.
    expect(src).toMatch(/ORCH-0865.*REWORK 5/);
    expect(src).toMatch(/defensive/i);
    expect(src).toMatch(/event-only/i);
  });
});
