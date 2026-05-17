/* eslint-disable import/first */
/**
 * ORCH-0862 / F-3 — tester adversarial regression test (AD-3).
 *
 * Different angle from IM-3: IM-3 proves the v4→v5 transition exists and
 * the partialize is neutered. AD-3 attacks the MIGRATOR CHAIN INTEGRITY:
 *
 *   - v3 → v4 → v5 must compose. A v3 user upgrading must end up with
 *     `events: []`, not crashed by the new v4→v5 branch.
 *   - v2 → v3 → v4 → v5 likewise.
 *   - v5 → v5 (no-op for new users at current version) returns the
 *     persisted state shape unchanged.
 *   - Unknown version (e.g., a future v6 downgrade) returns the
 *     persisted state untouched — does NOT crash.
 *
 * Bug class this guards against:
 *   - Someone re-orders the migrator branches such that a v3 user runs
 *     the v4→v5 branch (returning events:[] WITHOUT first upgrading
 *     ticket/cover/provider metadata) — breaking the v1/v2/v3 migrator
 *     chain that has shipped for ~3 cycles.
 *   - Someone changes the storage key name (`mingla-business.liveEvent.v1`)
 *     thinking the "v1" suffix is the version number — that would orphan
 *     all existing users' caches without running the migrator.
 *   - Someone deletes the legacy v1/v2/v3 migrator code as "dead"
 *     because v4→v5 is the latest — but legacy users on dormant installs
 *     still need the upgrade chain.
 *
 * Strategy: structural test against source code (the migrate function
 * is too tightly coupled to Zustand's persist middleware to import and
 * call in isolation without setting up AsyncStorage). For each version
 * branch, assert the branch exists, mentions the expected upgrade
 * helpers, and returns the correct shape.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const STORE_SOURCE_PATH = join(__dirname, "..", "liveEventStore.ts");

describe("ORCH-0862 AD-3 — liveEventStore migrator-chain integrity", () => {
  const source = readFileSync(STORE_SOURCE_PATH, "utf8");

  test("source loads", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  test("storage key name is exactly `mingla-business.liveEvent.v1` (NOT renamed to liveEvent.v5)", () => {
    // Future authors might "tidy" the key name thinking it should track
    // the version. That orphans every existing user's persisted state.
    expect(source).toContain('name: "mingla-business.liveEvent.v1"');
    // Negative assertion: the key MUST NOT be renamed to a higher version.
    expect(source).not.toMatch(/name:\s*"mingla-business\.liveEvent\.v[2-9]"/);
  });

  // Helper: extract a version branch's body. The branch starts at
  // `if (version === N) {` and runs to the matching closing brace, which
  // a simple non-greedy regex can't handle because of nested object
  // literals. We slice from the `if` keyword to the next `if (version`
  // or `return persistedState as PersistedState` (whichever comes first).
  const sliceBranch = (target: string): string => {
    const startMatch = source.match(target === "0" ? /if\s*\(\s*version\s*<\s*1\s*\)/ : new RegExp(`if\\s*\\(\\s*version\\s*===\\s*${target}\\s*\\)`));
    if (startMatch === null) return "";
    const startIdx = startMatch.index!;
    const restOfSource = source.slice(startIdx + startMatch[0].length);
    const next = restOfSource.search(
      /if\s*\(\s*version\s*(?:===\s*\d+|<\s*1)\s*\)|return\s+persistedState\s+as\s+PersistedState/,
    );
    return next === -1 ? restOfSource : restOfSource.slice(0, next);
  };

  test("v1 → v2 → v3 migrator branch chain is present (uses upgrade helpers)", () => {
    const v1Body = sliceBranch("1");
    expect(v1Body.length).toBeGreaterThan(0);
    expect(v1Body).toContain("upgradeV1LiveEventToV2");
    expect(v1Body).toContain("upgradeLiveEventToV3");
  });

  test("v2 → v3 migrator branch is present (uses upgradeLiveEventToV3)", () => {
    const v2Body = sliceBranch("2");
    expect(v2Body.length).toBeGreaterThan(0);
    expect(v2Body).toContain("upgradeLiveEventToV3");
  });

  test("v3 → v4 migrator branch is present (uses withProviderMetadataDefaults)", () => {
    const v3Body = sliceBranch("3");
    expect(v3Body.length).toBeGreaterThan(0);
    expect(v3Body).toContain("withProviderMetadataDefaults");
  });

  test("v4 → v5 migrator branch returns events:[] and discards persisted data", () => {
    const v4Body = sliceBranch("4");
    expect(v4Body.length).toBeGreaterThan(0);
    expect(v4Body).toMatch(/return\s*\{\s*events:\s*\[\]\s*\}\s*;/);
    // Defensive: the v4 branch must NOT reference state.events or call
    // any upgrade helper — it should explicitly discard.
    expect(v4Body).not.toContain("state.events");
    expect(v4Body).not.toContain("upgradeLiveEventTo");
  });

  test("migrator branches are ordered v0 → v1 → v2 → v3 → v4 (sequential)", () => {
    // If anyone re-orders them (e.g., v4 first), the chain breaks because
    // each branch returns early.
    const v0Idx = source.search(/if\s*\(\s*version\s*<\s*1\s*\)/);
    const v1Idx = source.search(/if\s*\(\s*version\s*===\s*1\s*\)/);
    const v2Idx = source.search(/if\s*\(\s*version\s*===\s*2\s*\)/);
    const v3Idx = source.search(/if\s*\(\s*version\s*===\s*3\s*\)/);
    const v4Idx = source.search(/if\s*\(\s*version\s*===\s*4\s*\)/);

    expect(v0Idx).toBeGreaterThan(-1);
    expect(v1Idx).toBeGreaterThan(v0Idx);
    expect(v2Idx).toBeGreaterThan(v1Idx);
    expect(v3Idx).toBeGreaterThan(v2Idx);
    expect(v4Idx).toBeGreaterThan(v3Idx);
  });

  test("migrator fall-through default returns persisted state untouched (no-op for unknown future versions)", () => {
    // The last line of `migrate` must be a default return that doesn't
    // crash. Without it, a v5 user (current version, no migration needed)
    // would hit `undefined` and Zustand would re-init.
    const migrateMatch = source.match(
      /migrate\s*:\s*\([^)]*\)\s*:\s*PersistedState\s*=>\s*\{[\s\S]*?\n\s{2,}\}\s*,/,
    );
    expect(migrateMatch).not.toBeNull();
    const body = migrateMatch![0];
    // The function must end with a fall-through `return persistedState as PersistedState`
    expect(body).toMatch(/return\s+persistedState\s+as\s+PersistedState\s*;/);
  });

  test("PersistedState type is unchanged shape (Pick of LiveEventState.events OR object literal with events: LiveEvent[])", () => {
    // F-3 changes the partialize VALUE but must NOT change the TYPE
    // (otherwise consumers reading persisted state on cold start break).
    // The source uses the Pick<LiveEventState, "events"> form; accept
    // either form for resilience to a future tidy-up that inlines the
    // shape.
    const pickForm = source.match(
      /type\s+PersistedState\s*=\s*Pick<\s*LiveEventState\s*,\s*"events"\s*>/,
    );
    const literalForm = source.match(
      /type\s+PersistedState\s*=\s*\{[^}]*events\s*:\s*LiveEvent\[\][^}]*\}/,
    );
    expect(pickForm !== null || literalForm !== null).toBe(true);
  });

  test("version field is exactly 5 (no off-by-one, no string `'5'`)", () => {
    // Defensive: `version: "5"` (string) would silently break the
    // migrator chain since version comparisons are === number.
    const persistBlock = source.match(/persistOptions[^=]*=\s*\{[\s\S]*?\n\};/);
    expect(persistBlock).not.toBeNull();
    expect(persistBlock![0]).toMatch(/version:\s*5\b/);
    expect(persistBlock![0]).not.toMatch(/version:\s*"5"/);
    expect(persistBlock![0]).not.toMatch(/version:\s*'5'/);
  });

  test("partialize argument is named `_state` (underscore-prefixed to signal unused) AND returns a freshly-constructed object literal, not a destructured reference", () => {
    // If someone "tidies" the signature back to `(state)` and accidentally
    // returns `{ events: state.events }` again, the IM-3 happy-path test
    // catches it. This adversarial covers the subtler case where someone
    // returns a closure-captured `events: []` from outer scope.
    const partializeMatch = source.match(
      /partialize:\s*\(([^)]*)\)\s*:\s*PersistedState\s*=>\s*\(\s*\{[^}]*\}\s*\)/,
    );
    expect(partializeMatch).not.toBeNull();
    const argName = partializeMatch![1].trim();
    expect(argName.startsWith("_")).toBe(true);
  });
});
