#!/usr/bin/env node
/**
 * I-1047-BIZ-LIVEEVENTSTORE-V5-DROPS-SERVER-SNAPSHOT  (issue #1047)
 *
 * Re-homes the load-bearing invariant previously pinned by the jest source-text
 * test `mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts`
 * (ORCH-0862 F-3). That pin rotted (it hard-coded `version: 5`; the store has
 * since ratcheted to a higher version) and is now quarantined. This additive gate
 * keeps the real rule enforced.
 *
 * THE RULE (I-PROPOSED-J — Zustand persist no server snapshots, Constitution #5):
 * the liveEventStore persist layer must NEVER re-persist the server-snapshot
 * events array. Server data lives in React Query, not AsyncStorage.
 *   - partialize returns `events: []` (persists no events), AND
 *   - a `version === 4` migrator branch drops the stored events (returns events: []), AND
 *   - the persist `version` is monotonic >= 5 (never reverted below the F-3 bump), AND
 *   - the storage `name` key is preserved so existing users hit the migrator.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fs.readFileSync(path.join(REPO, "mingla-business/src/store/liveEventStore.ts"), "utf8");

const violations = [];

// partialize must neuter the events array (no server-snapshot persistence).
if (!/partialize:\s*\([^)]*\)\s*:\s*PersistedState\s*=>\s*\(\s*\{\s*events:\s*\[\]\s*\}\s*\)/.test(src)) {
  violations.push(
    "partialize no longer returns `{ events: [] }` — persisting state.events re-stores the server " +
      "snapshot (violates I-PROPOSED-J / Constitution #5: server state lives in React Query, not AsyncStorage).",
  );
}
// v4 -> v5 migrator branch drops the stored events.
if (!/if\s*\(\s*version\s*===\s*4\s*\)\s*\{[\s\S]*?return\s*\{\s*events:\s*\[\]\s*\}/.test(src)) {
  violations.push("the `version === 4` migrator branch that drops the persisted events array is missing.");
}
// version is monotonic >= 5 (F-3 bump never reverted).
const vm = src.match(/\n\s*version:\s*(\d+)\s*,/);
if (!vm) {
  violations.push("no `version: <n>` field found in the persist options.");
} else if (Number(vm[1]) < 5) {
  violations.push(`persist version is ${vm[1]} — it must stay >= 5 (the F-3 snapshot-drop bump must never be reverted).`);
}
// storage key preserved (else existing caches orphan and the migrator never runs).
if (!src.includes('name: "mingla-business.liveEvent.v1"')) {
  violations.push('the storage key `name: "mingla-business.liveEvent.v1"` changed — existing users would skip the migrator.');
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-LIVEEVENTSTORE-V5-DROPS-SERVER-SNAPSHOT]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-LIVEEVENTSTORE-V5-DROPS-SERVER-SNAPSHOT]: partialize drops events, v4 migrator + key preserved.");
