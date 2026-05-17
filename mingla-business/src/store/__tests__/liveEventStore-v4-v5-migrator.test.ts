/* eslint-disable import/first */
/**
 * ORCH-0862 / F-3 — implementor happy-path regression test (IM-3).
 *
 * Asserts that the liveEventStore v4 → v5 persist migrator drops the
 * stored server-snapshot events array, returning `{ events: [] }`. This
 * brings the store into I-PROPOSED-J compliance (ACTIVE post-ORCH-0742
 * [Zustand persist no server snapshots]) — server data lives in React
 * Query, not in AsyncStorage.
 *
 * Strategy: structural test against the source file. The migrate
 * function is a static configuration value passed to zustand's persist
 * middleware; importing the store module triggers AsyncStorage rehydration
 * (which jest doesn't have set up), so we instead extract the source of
 * the v4→v5 branch and assert its shape. The source-level assertion fails
 * if any of (a) the v4 branch returns persisted events, (b) the partialize
 * persists state.events, or (c) the version number drops below 5.
 *
 * Fails-on-revert verification: reverting any of the three changes
 * (version bump, partialize neutering, v4→v5 branch) flips the
 * corresponding assertion to fail.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const STORE_SOURCE_PATH = join(__dirname, "..", "liveEventStore.ts");

describe("ORCH-0862 F-3 — liveEventStore v4 → v5 migrator drops server snapshot", () => {
  const source = readFileSync(STORE_SOURCE_PATH, "utf8");

  test("source file loads + contains the persistOptions block", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("persistOptions");
    expect(source).toContain("partialize");
  });

  test("version is bumped to 5 (was 4 pre-F-3)", () => {
    // Match the version field inside persistOptions. There may be other
    // 'version:' references in comments; anchor on the persistOptions block.
    const persistBlock = source.match(/persistOptions[^=]*=\s*\{[\s\S]*?\n\};/);
    expect(persistBlock).not.toBeNull();
    const block = persistBlock![0];
    expect(block).toMatch(/version:\s*5\b/);
    // Defensive: ensure no `version: 4` survives inside the persistOptions.
    expect(block).not.toMatch(/version:\s*4\b/);
  });

  test("partialize returns events: [] (no server-snapshot persistence)", () => {
    // The fix's structural assertion: partialize body returns an empty
    // events array, NOT state.events.
    const partializeMatch = source.match(
      /partialize:\s*\([^)]*\)\s*:\s*PersistedState\s*=>\s*\(\s*\{[^}]*\}\s*\)/,
    );
    expect(partializeMatch).not.toBeNull();
    const partializeExpr = partializeMatch![0];
    expect(partializeExpr).toContain("events: []");
    // Defensive: must NOT return state.events directly anymore.
    expect(partializeExpr).not.toMatch(/events:\s*state\.events/);
    // Defensive: argument is named `_state` (underscore-prefixed to signal
    // unused) per spec §5 F-3.
    expect(partializeExpr).toMatch(/\(\s*_state[^)]*\)/);
  });

  test("v4 → v5 migrator branch exists and returns events: []", () => {
    // The migrate function must include a `version === 4` branch that
    // returns `{ events: [] }`.
    const v4BranchMatch = source.match(
      /if\s*\(\s*version\s*===\s*4\s*\)\s*\{[\s\S]*?return\s*\{\s*events:\s*\[\]\s*\}\s*;[\s\S]*?\}/,
    );
    expect(v4BranchMatch).not.toBeNull();
  });

  test("v4 branch is documented with ORCH-0862 reference", () => {
    // The v4 → v5 transition is non-obvious (it discards data); the
    // codified comment ensures future readers understand WHY.
    expect(source).toMatch(/ORCH-0862[\s\S]*v4\s*→\s*v5/);
  });

  test("storage key name is preserved (existing users hit the v4→v5 migrator)", () => {
    // Zustand keys persistence by `name`. If `name` changes, existing
    // users' caches are orphaned and the v4→v5 migrator never runs. The
    // fix MUST retain the original storage key.
    expect(source).toContain('name: "mingla-business.liveEvent.v1"');
  });

  test("legacy v1, v2, v3 migrator branches are preserved (audit trail)", () => {
    // F-3 must not delete the historical migrators; users on very old
    // builds still need the upgrade chain.
    expect(source).toMatch(/if\s*\(\s*version\s*===\s*1\s*\)/);
    expect(source).toMatch(/if\s*\(\s*version\s*===\s*2\s*\)/);
    expect(source).toMatch(/if\s*\(\s*version\s*===\s*3\s*\)/);
  });
});
