/**
 * orch_0893a_hydration_gate.test — ORCH-0893 REWORK
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave —
 *  rework Part A: hydration gate + Part B: live-state merge].
 *
 * Regression test for Part A — Zustand persist hydration gate in
 * `app/event/create.tsx`.
 *
 * Closes the operator-reported bug 2026-05-20: "wizard shows up and
 * immediately closes, until I try it multiple times then it stops."
 * Root cause: post-ORCH-0893 the create route minted the d_<ts36>
 * client draft synchronously and `router.replace`d in the same tick,
 * before Zustand persist had finished hydrating from AsyncStorage /
 * localStorage. Hydration's `setState(persisted, true)` then REPLACED
 * the in-memory drafts array, wiping the just-minted d_*. The edit
 * route's existing bounce-home guard fired because `draft === null`.
 *
 * Pre-ORCH-0893 was masked because the ~600ms-1.5s server-mutation
 * round-trip gave hydration time to settle.
 *
 * The rework adds an explicit hydration gate via
 * `useDraftEventStore.persist.hasHydrated()` + `onFinishHydration`.
 *
 * This test is a SOURCE-CONTRACT assertion (mirrors the pattern in
 * `orch_0893_creator_entry_routes.test.ts`). It asserts the rework
 * lines are present so a future regression that removes the gate
 * surfaces here, in addition to surfacing as the runtime bug.
 *
 * Fails-on-revert: stash the rework changes in `app/event/create.tsx`
 * — every assertion below fails. Verified by implementor at the
 * commit captured in the implementation report's Regression Test
 * section.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const EVENT_CREATE = join(REPO_ROOT, "mingla-business", "app", "event", "create.tsx");
const EVENT_EDIT = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "event",
  "[id]",
  "edit.tsx",
);

describe("ORCH-0893 REWORK Part A — Zustand persist hydration gate in /event/create", () => {
  test("event/create.tsx subscribes to Zustand persist hydration via hasHydrated + onFinishHydration", () => {
    const source = readFileSync(EVENT_CREATE, "utf8");

    // Imports the Zustand store (needed to access .persist API).
    expect(source).toMatch(/from\s+["']\.\.\/\.\.\/src\/store\/draftEventStore["']/);
    // Reads synchronous hasHydrated() in useState initializer (avoids
    // initial-paint race when hydration is already complete before mount).
    expect(source).toMatch(/useDraftEventStore\.persist\.hasHydrated\(\)/);
    // Subscribes to onFinishHydration to flip the gate when hydration
    // completes after mount.
    expect(source).toMatch(/useDraftEventStore\.persist\.onFinishHydration/);
    // The gate name MUST be `hydrated` (consistent with skill convention).
    expect(source).toMatch(/const\s+\[hydrated,\s*setHydrated\]/);
  });

  test("event/create.tsx's mint useEffect short-circuits when not hydrated", () => {
    const source = readFileSync(EVENT_CREATE, "utf8");

    // The mint useEffect must check `!hydrated` and early-return BEFORE
    // calling createDraft. Without this gate the bug returns.
    expect(source).toMatch(/if\s*\(\s*!hydrated\s*\)\s*return/);
  });

  test("event/create.tsx uses getState().createDraft (not subscribed selector) for the mint call", () => {
    const source = readFileSync(EVENT_CREATE, "utf8");

    // Reading via `useDraftEventStore.getState().createDraft(...)` avoids
    // any subscription staleness in the moment of the mint. Combined with
    // the hydration gate, this guarantees the d_<ts36> draft persists
    // through the router.replace handoff.
    expect(source).toMatch(
      /useDraftEventStore\.getState\(\)\.createDraft\(\s*currentBrandId\s*\)/,
    );
    // The previous "subscribed selector" pattern must NOT remain in the
    // useEffect closure as a stale duplicate. The selector form was:
    //   const createClientDraft = useDraftEventStore((s) => s.createDraft);
    //   ... createClientDraft(currentBrandId)
    // The rework removes that pattern in favor of getState() — confirm.
    const code = source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(code).not.toMatch(/createClientDraft\s*\(/);
  });

  test("event/create.tsx renders the hydration-pending label distinctly from auth-pending", () => {
    const source = readFileSync(EVENT_CREATE, "utf8");

    // The label JSX must differentiate auth-pending vs hydration-pending
    // states so the placeholder is honest about WHY it's waiting.
    expect(source).toMatch(/Finishing sign-in/);
    expect(source).toMatch(/Getting things ready/);
  });
});

describe("ORCH-0893 REWORK Part B — live-state merge in /event/[id]/edit autosave wrapper", () => {
  test("edit.tsx merges live Zustand state into serverDraft before replaceDraft", () => {
    const source = readFileSync(EVENT_EDIT, "utf8");

    // The autosave wrapper's .then((serverDraft) => ...) callback must
    // re-read the live draft via useDraftEventStore.getState().getDraft
    // AND merge user-meaningful fields from the live state into the
    // serverDraft payload before replaceDraft. Without this merge, typed
    // characters during the in-flight migration window are overwritten
    // by the queue-time snapshot the server echoes back.
    expect(source).toMatch(
      /useDraftEventStore\s*\.\s*getState\(\)\s*\.\s*getDraft\(\s*incoming\.id\s*\)/,
    );
    // The merged payload variable name MUST be `mergedServerDraft`
    // (consistent with the implementor's pattern).
    expect(source).toMatch(/const\s+mergedServerDraft\s*=/);
    // replaceDraft must be called with the merged payload, not the raw
    // serverDraft.
    expect(source).toMatch(/replaceDraft\(\s*incoming\.id\s*,\s*mergedServerDraft\s*\)/);
    // router.replace must navigate using mergedServerDraft.id (which
    // equals serverDraft.id; this is the safety belt that ensures
    // we never accidentally navigate to the old d_* id).
    expect(source).toMatch(/router\.replace\(\s*`\/event\/\$\{mergedServerDraft\.id\}/);
  });

  test("edit.tsx merge preserves at minimum the typed user-meaningful fields", () => {
    const source = readFileSync(EVENT_EDIT, "utf8");

    // The merge must include the user-meaningful fields whose loss was
    // the original race symptom. Verify a representative sample is in
    // the merge object. Future field additions to DraftEvent will need
    // to be reflected here too (catch via I-PROPOSED-CREATOR-ENTRY-IS-INSTANT
    // tester adversarial follow-up if applicable).
    const mergeBlock = source.slice(
      source.indexOf("const mergedServerDraft"),
      source.indexOf("replaceDraft(incoming.id, mergedServerDraft)"),
    );
    expect(mergeBlock).toMatch(/name:\s*liveDraft\.name/);
    expect(mergeBlock).toMatch(/description:\s*liveDraft\.description/);
    expect(mergeBlock).toMatch(/tickets:\s*liveDraft\.tickets/);
    expect(mergeBlock).toMatch(/coverMediaUrl:\s*liveDraft\.coverMediaUrl/);
    expect(mergeBlock).toMatch(/lastStepReached:\s*Math\.max\(/);
  });

  test("edit.tsx merge handles the already-replaced edge case (liveDraft === null) by using serverDraft as-is", () => {
    const source = readFileSync(EVENT_EDIT, "utf8");

    // If `useDraftEventStore.getState().getDraft(incoming.id)` returns
    // null (e.g., a concurrent replaceDraft happened, or the draft was
    // discarded mid-flight), fall back to the raw serverDraft. This
    // matches the implementor's ternary pattern.
    expect(source).toMatch(/liveDraft\s*\?\s*\{[\s\S]+\}\s*:\s*serverDraft/);
  });
});
