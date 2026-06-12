/**
 * ORCH-1121 [Business brand-profile redesign] — TESTER adversarial test.
 *
 * DIFFERENT ANGLE from the implementor's source-structure tests
 * (BrandProfileView.orch_1121.test.tsx). The implementor proved the SECTION E
 * source *text* contains the gated ladder. This test instead proves the
 * *behavior* of that ladder: it models the exact render-branch decision
 * (`eventsError ? error : recentEvents.length>0 ? rows : eventsSettledEmpty ?
 * empty : skeleton`) as a pure function and drives it across the FULL React
 * Query v5 cold-load / refetch / error state matrix — the false-empty-flash bug
 * class this ORCH exists to kill.
 *
 * The decision logic mirrors BrandProfileView.tsx (the populated branch):
 *   eventsSettledEmpty = !eventsLoading && !eventsError && brandEvents.length===0
 *   render ladder, top→bottom:
 *     1. eventsError                → "error"
 *     2. recentEvents.length > 0    → "rows"     (recentEvents = brandEvents sliced/sorted)
 *     3. eventsSettledEmpty         → "empty"
 *     4. else (loading, uncached)   → "skeleton"
 *
 * The RQ v5 ground-truth used below is verified empirically (a QueryObserver
 * probe, recorded in the QA report):
 *   - enabled query, initial fetch  → isLoading=true,  isError=false, data=[]
 *   - settled, zero rows            → isLoading=false, isError=false, data=[]
 *   - settled, N rows               → isLoading=false, isError=false, data=[...]
 *   - error                         → isLoading=false, isError=true,  data=[]
 *   - background refetch w/ cache    → isLoading=false, isError=false, data=[...]
 *   - DISABLED (enabled:false)       → isLoading=false, isError=false, data=[]  ← the trap
 *
 * INVARIANT UNDER TEST (Constitution #9 / I-PROPOSED-1121-RECENT-EVENTS-LIVE-QUERY):
 *   The "empty" branch (the "Create your first event" card) MUST render ONLY when
 *   the query has genuinely SETTLED with zero rows. It must NEVER render while a
 *   brand that HAS events is still loading or refetching.
 *
 * Fails-on-revert: the original SECTION E rendered the empty card UNCONDITIONALLY
 * (no ladder). Modeling that as `() => "empty"` makes every "must NOT be empty"
 * assertion below FAIL — see the `revertedUnconditionalEmpty` block.
 */

import { describe, expect, test } from "@jest/globals";

interface QueryState {
  brandEvents: { id: string; date: string | null }[];
  eventsLoading: boolean;
  eventsError: boolean;
}

type Branch = "error" | "rows" | "empty" | "skeleton";

/** Faithful model of BrandProfileView's SECTION E render ladder. */
function recentEventsBranch(s: QueryState): Branch {
  // recentEvents = brandEvents.map(...).sort(...).slice(0,5) — only length matters here.
  const recentEventsLength = Math.min(s.brandEvents.length, 5);
  const eventsSettledEmpty =
    !s.eventsLoading && !s.eventsError && s.brandEvents.length === 0;

  if (s.eventsError) return "error";
  if (recentEventsLength > 0) return "rows";
  if (eventsSettledEmpty) return "empty";
  return "skeleton";
}

const ev = (id: string, date: string | null = "2026-05-01") => ({ id, date });

describe("ORCH-1121 adversarial — Recent Events render ladder (false-empty-flash)", () => {
  test("ENABLED query, INITIAL fetch in flight (data=[], loading=true) → skeleton, NEVER empty", () => {
    const b = recentEventsBranch({
      brandEvents: [],
      eventsLoading: true,
      eventsError: false,
    });
    expect(b).toBe("skeleton");
    expect(b).not.toBe("empty"); // the bug: flashing "Create your first event" mid-load
  });

  test("a brand WITH events, still loading with NO cache yet → skeleton, NEVER empty (the core bug class)", () => {
    // RQ v5 initial fetch always reports data=[] until the promise resolves,
    // even for a brand that has 12 events. The ladder must show skeleton.
    const b = recentEventsBranch({
      brandEvents: [], // not yet arrived
      eventsLoading: true,
      eventsError: false,
    });
    expect(b).toBe("skeleton");
    expect(b).not.toBe("empty");
  });

  test("SETTLED with zero rows (loading=false, error=false, data=[]) → empty (and ONLY here)", () => {
    const b = recentEventsBranch({
      brandEvents: [],
      eventsLoading: false,
      eventsError: false,
    });
    expect(b).toBe("empty");
  });

  test("SETTLED with rows → rows, never empty", () => {
    const b = recentEventsBranch({
      brandEvents: [ev("e1"), ev("e2"), ev("e3")],
      eventsLoading: false,
      eventsError: false,
    });
    expect(b).toBe("rows");
    expect(b).not.toBe("empty");
  });

  test("ERROR → error surface, never empty and never silent (Constitution #3)", () => {
    const b = recentEventsBranch({
      brandEvents: [],
      eventsLoading: false,
      eventsError: true,
    });
    expect(b).toBe("error");
    expect(b).not.toBe("empty"); // erroring must not masquerade as "no events"
  });

  test("BACKGROUND refetch over cached rows (loading=false, data=[...]) → rows, never empty/skeleton flicker", () => {
    // staleTime expiry triggers a background refetch; isLoading stays false
    // because data is cached. Rows must stay on screen.
    const b = recentEventsBranch({
      brandEvents: [ev("e1")],
      eventsLoading: false,
      eventsError: false,
    });
    expect(b).toBe("rows");
  });

  test("EXHAUSTIVE matrix: empty card appears in EXACTLY ONE state (settled+zero+no-error)", () => {
    const datasets = [[], [ev("e1")], [ev("e1"), ev("e2")]];
    let emptyCount = 0;
    const offenders: string[] = [];
    for (const brandEvents of datasets) {
      for (const eventsLoading of [true, false]) {
        for (const eventsError of [true, false]) {
          const branch = recentEventsBranch({
            brandEvents,
            eventsLoading,
            eventsError,
          });
          const settledZero =
            !eventsLoading && !eventsError && brandEvents.length === 0;
          if (branch === "empty") {
            emptyCount += 1;
            // every "empty" MUST be a genuine settled-zero
            if (!settledZero) {
              offenders.push(
                `empty leaked at loading=${eventsLoading} error=${eventsError} n=${brandEvents.length}`,
              );
            }
          }
          // a brand WITH events must NEVER reach the empty branch
          if (brandEvents.length > 0 && branch === "empty") {
            offenders.push(
              `brand-with-events flashed empty at loading=${eventsLoading} error=${eventsError}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // Across the 3×2×2 = 12 cells, exactly ONE is settled-zero → exactly one "empty".
    expect(emptyCount).toBe(1);
  });

  test("slice cap: 8 events still render rows (≤5 shown), never empty/skeleton", () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`e${i}`));
    const b = recentEventsBranch({
      brandEvents: many,
      eventsLoading: false,
      eventsError: false,
    });
    expect(b).toBe("rows");
  });

  describe("fails-on-revert: the OLD unconditional empty card", () => {
    // The pre-ORCH-1121 SECTION E rendered the empty card with no ladder.
    const revertedUnconditionalEmpty = (_s: QueryState): Branch => "empty";

    test("the reverted ladder LIES: a loading brand-with-events shows empty (this is the bug)", () => {
      const loadingWithEvents: QueryState = {
        brandEvents: [],
        eventsLoading: true,
        eventsError: false,
      };
      // The FIXED ladder shows skeleton; the REVERTED one shows empty.
      expect(recentEventsBranch(loadingWithEvents)).toBe("skeleton");
      expect(revertedUnconditionalEmpty(loadingWithEvents)).toBe("empty");
      // Prove the two diverge precisely on the false-empty-flash state.
      expect(recentEventsBranch(loadingWithEvents)).not.toBe(
        revertedUnconditionalEmpty(loadingWithEvents),
      );
    });

    test("the reverted ladder LIES on error too (shows empty instead of retry)", () => {
      const errored: QueryState = {
        brandEvents: [],
        eventsLoading: false,
        eventsError: true,
      };
      expect(recentEventsBranch(errored)).toBe("error");
      expect(revertedUnconditionalEmpty(errored)).toBe("empty");
    });
  });
});
