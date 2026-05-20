/**
 * orch_0893_adversarial_edit_route_wrapper.test — ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave].
 *
 * TESTER-AUTHORED adversarial regression test (Step 0.5 gate, tester angle).
 *
 * DIFFERENT ANGLE FROM IMPLEMENTOR TESTS:
 *   - Implementor's `draftDirtyCheck.test.ts` attacks the GATE PRIMITIVE's
 *     field-flip semantics.
 *   - Implementor's `orch_0893_creator_entry_routes.test.ts` attacks the
 *     SOURCE-LEVEL CONTRACT of `app/event/create.tsx` and
 *     `app/trip/create.tsx` — what tokens may not appear.
 *   - This adversarial attacks the EDIT ROUTE's wrapper STRUCTURE — that
 *     the eager-on-mount migration block is fully REMOVED, that the new
 *     `handleAutosaveDraft` wrapper exists with its three branches in the
 *     correct ORDER, that the migration ref is set BEFORE the async
 *     `createServerDraft` call (race-guard), and that the migration ref
 *     is RESET on every failure path (not stranded).
 *
 * Why this matters: the implementor's tests prove the create routes do
 * not contain entry-blocking mutations, but say nothing about WHERE the
 * mutation moved to or whether the new home is correctly structured. A
 * subtle bug in the wrapper's branch order (e.g., dirty-check after
 * migration-ref-check) would let ghost-draft rows escape into `events`
 * even though the gate primitive is correct in isolation.
 *
 * Fails-on-revert verified: when `app/event/[id]/edit.tsx` is reverted
 * to the pre-ORCH-0893 shape (eager migration useEffect at lines
 * 144-169 + ternary autosave wiring), this adversarial fails at the
 * "eager migration block REMOVED" assertion (pattern resurfaces) and
 * the "handleAutosaveDraft" assertion (no longer present).
 *
 * Per SPEC §11.2 + Step 0.5 close gate.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const EDIT_ROUTE = join(REPO_ROOT, "mingla-business", "app", "event", "[id]", "edit.tsx");
const TRIP_EDIT_ROUTE = join(REPO_ROOT, "mingla-business", "app", "trip", "[id]", "edit.tsx");
const INVARIANT_REGISTRY = join(REPO_ROOT, "Mingla_Artifacts", "INVARIANT_REGISTRY.md");

const stripComments = (source: string): string =>
  source
    // Remove block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Remove line comments
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const indexOf = (haystack: string, needle: string | RegExp): number => {
  if (typeof needle === "string") return haystack.indexOf(needle);
  const m = haystack.match(needle);
  return m?.index ?? -1;
};

describe("ORCH-0893 adversarial — event/[id]/edit.tsx wrapper structural contract", () => {
  test("eager-on-mount migration block is fully REMOVED from the top-of-component useEffect", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");
    const code = stripComments(source);

    // The pre-ORCH-0893 eager migration block contained the canonical
    // signature: a top-of-useEffect `if (... draft.id.startsWith("d_") ...
    // migratingLegacyIdRef.current !== draft.id)` followed by an immediate
    // `void createServerDraft(draft.brandId, draft).then(...)` inside the
    // same conditional. Catching ANY of these signatures in non-comment
    // code outside the `handleAutosaveDraft` callback proves the migration
    // is still on-mount.

    // Verify createServerDraft is referenced AT MOST inside handleAutosaveDraft.
    const handleAutosaveStart = code.indexOf("handleAutosaveDraft");
    expect(handleAutosaveStart).toBeGreaterThan(-1);

    // Find ALL non-comment occurrences of `createServerDraft(`.
    const callRe = /\bcreateServerDraft\s*\(/g;
    const callIndexes: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(code)) !== null) {
      callIndexes.push(m.index);
    }

    // Every call site MUST appear after `handleAutosaveDraft` declaration —
    // i.e., inside the route-owned wrapper, not in a separate top-of-component
    // useEffect or any pre-wrapper code path.
    for (const idx of callIndexes) {
      expect(idx).toBeGreaterThan(handleAutosaveStart);
    }
  });

  test("handleAutosaveDraft branch ORDER prevents ghost-draft escape and stranded migration ref", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    const wrapperStart = source.indexOf("handleAutosaveDraft");
    expect(wrapperStart).toBeGreaterThan(-1);
    // Slice from wrapper start to a reasonable upper bound (find the next
    // `const ` declaration at module scope OR end-of-file).
    const wrapperEnd = source.indexOf("\n  // Cycle 9b-2", wrapperStart);
    const wrapperEffective = wrapperEnd > 0 ? wrapperEnd : source.length;
    const wrapperBody = source.slice(wrapperStart, wrapperEffective);

    const serverIdShortCircuit = indexOf(wrapperBody, /if\s*\(\s*!\s*incoming\.id\.startsWith\(\s*["']d_["']\s*\)\s*\)/);
    const dirtyCheck = indexOf(wrapperBody, /if\s*\(\s*!\s*isDraftDirty\s*\(\s*incoming\s*\)\s*\)/);
    const migratingRefCheck = indexOf(wrapperBody, /migratingLegacyIdRef\.current\s*===\s*incoming\.id/);
    const authCheck = indexOf(wrapperBody, /if\s*\(\s*!\s*isAuthReady\s*\)/);
    const refSet = indexOf(wrapperBody, /migratingLegacyIdRef\.current\s*=\s*incoming\.id/);
    const createCall = indexOf(wrapperBody, /\bcreateServerDraft\s*\(/);

    // All six landmarks must exist in the wrapper.
    expect(serverIdShortCircuit).toBeGreaterThan(-1);
    expect(dirtyCheck).toBeGreaterThan(-1);
    expect(migratingRefCheck).toBeGreaterThan(-1);
    expect(authCheck).toBeGreaterThan(-1);
    expect(refSet).toBeGreaterThan(-1);
    expect(createCall).toBeGreaterThan(-1);

    // Ordering invariants:
    // 1. Server-id short-circuit FIRST (server-id drafts must NOT be gated on
    //    `isDraftDirty` — they use the existing autosave.saveDraft path).
    expect(serverIdShortCircuit).toBeLessThan(dirtyCheck);
    // 2. Dirty check BEFORE migration-ref check (so non-dirty drafts don't
    //    pollute the ref or trigger an unnecessary ref-set later).
    expect(dirtyCheck).toBeLessThan(migratingRefCheck);
    // 3. Migration-ref check BEFORE auth-ready (so auth-lapse doesn't strand
    //    a stale ref — auth-lapse short-circuits but ref is already set
    //    if we reach the auth check, which is wrong; therefore auth-check
    //    must come BEFORE the ref-set).
    expect(migratingRefCheck).toBeLessThan(authCheck);
    // 4. Auth check BEFORE ref-set (so we don't strand the ref under auth lapse).
    expect(authCheck).toBeLessThan(refSet);
    // 5. Ref-set BEFORE createServerDraft call (race-guard: prevents double-fire
    //    when two debounced autosaves arrive during the migration in-flight window).
    expect(refSet).toBeLessThan(createCall);
  });

  test("error catch resets migrationRef AND handles BusinessAuthNotReadyError silently", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    const wrapperStart = source.indexOf("handleAutosaveDraft");
    const wrapperEnd = source.indexOf("\n  // Cycle 9b-2", wrapperStart);
    const wrapperBody = source.slice(wrapperStart, wrapperEnd > 0 ? wrapperEnd : source.length);

    // The catch block MUST:
    //  (a) reset migratingLegacyIdRef.current to null (so subsequent saves retry);
    //  (b) early-return on BusinessAuthNotReadyError (no user-facing toast for
    //      transient auth state — will retry on next dirty save);
    //  (c) fire a user-facing toast for any other error.
    const catchStart = wrapperBody.indexOf(".catch(");
    expect(catchStart).toBeGreaterThan(-1);
    const catchBody = wrapperBody.slice(catchStart);

    // (a) Ref reset MUST appear FIRST in the catch (before the auth-error
    // discrimination) — otherwise auth-lapse short-circuits before the ref
    // is reset, stranding the lock.
    const refResetInCatch = indexOf(catchBody, /migratingLegacyIdRef\.current\s*=\s*null/);
    const authErrorCheck = indexOf(catchBody, /isBusinessAuthNotReadyError/);
    const toastSet = indexOf(catchBody, /setToast/);

    expect(refResetInCatch).toBeGreaterThan(-1);
    expect(authErrorCheck).toBeGreaterThan(-1);
    expect(toastSet).toBeGreaterThan(-1);

    // Order: ref reset FIRST, then auth-error discrimination, then toast.
    expect(refResetInCatch).toBeLessThan(authErrorCheck);
    expect(authErrorCheck).toBeLessThan(toastSet);
  });

  test("wizard prop wiring uses the route-owned wrapper (not the ternary or undefined)", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    // The wizard render block MUST use `onAutosaveDraft={handleAutosaveDraft}`.
    // The pre-ORCH-0893 ternary `draft.id.startsWith("d_") ? undefined : autosave.saveDraft`
    // is FORBIDDEN — it would skip the lazy-insert path entirely for client drafts.
    expect(source).toMatch(/onAutosaveDraft=\{handleAutosaveDraft\}/);
    // The old ternary must not appear in non-comment code.
    const code = stripComments(source);
    expect(code).not.toMatch(/onAutosaveDraft=\{[^}]*\.startsWith\(\s*["']d_["']\s*\)\s*\?\s*undefined\s*:[^}]*\}/);
  });

  test("isDraftDirty is imported from the dedicated draftDirtyCheck util (not inlined or duplicated)", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    // The route MUST import isDraftDirty from the single source of truth.
    // An inline duplicate of the dirty-check logic would create a drift
    // surface where future field additions to DraftEvent get reflected in
    // draftDirtyCheck.ts but not in the route's local copy.
    expect(source).toMatch(
      /from\s+["']\.\.\/\.\.\/\.\.\/src\/utils\/draftDirtyCheck["']/,
    );
    expect(source).toMatch(/import\s+\{[^}]*\bisDraftDirty\b[^}]*\}/);
  });
});

describe("ORCH-0893 adversarial — trip/[id]/edit.tsx narrowed-scope contract", () => {
  test("trip route detects d_* via .startsWith('d_') AND gates useTrip query on !isClientOnlyId", () => {
    const source = readFileSync(TRIP_EDIT_ROUTE, "utf8");

    // The narrowed-scope trip behaviour: detect d_* at the top of the
    // component, run createTripDraft eagerly on mount, render placeholder
    // while migration is in flight. The route MUST NOT call useTrip(d_*)
    // because that would 404 against the server and surface a spurious
    // "Trip not found" empty state.
    expect(source).toMatch(/eventId\.startsWith\(\s*["']d_["']\s*\)/);
    expect(source).toMatch(/!isClientOnlyId/);

    // useCreateTripDraft must be imported (it's the trigger for the
    // eager migration) — exemption to the strict-grep gate's forbidden-token
    // list because this is the RESUME route, not the create route. The
    // strict-grep gate at .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs
    // scopes itself to `app/**/create.tsx` only, which is correct.
    expect(source).toMatch(/useCreateTripDraft/);
    expect(source).toMatch(/createTripDraftMutation\s*\.\s*mutateAsync/);
  });

  test("trip migration ref guards against double-fire on re-render", () => {
    const source = readFileSync(TRIP_EDIT_ROUTE, "utf8");

    expect(source).toMatch(/tripMigratingIdRef/);
    expect(source).toMatch(/tripMigratingIdRef\.current\s*===\s*eventId/);
    expect(source).toMatch(/tripMigratingIdRef\.current\s*=\s*eventId/);
    expect(source).toMatch(/tripMigratingIdRef\.current\s*=\s*null/);
  });
});

describe("ORCH-0893 adversarial — invariant registry entry present", () => {
  test("I-PROPOSED-CREATOR-ENTRY-IS-INSTANT is registered as DRAFT in INVARIANT_REGISTRY.md", () => {
    const source = readFileSync(INVARIANT_REGISTRY, "utf8");

    // The invariant entry must exist and be in DRAFT status pending close.
    expect(source).toMatch(/I-PROPOSED-CREATOR-ENTRY-IS-INSTANT/);
    expect(source).toMatch(
      /I-PROPOSED-CREATOR-ENTRY-IS-INSTANT.*\n.*DRAFT.*ORCH-0893/s,
    );
    // The enforcement triple must be cited:
    expect(source).toMatch(/i-proposed-creator-entry-is-instant\.mjs/);
    expect(source).toMatch(/draftDirtyCheck/);
  });
});
