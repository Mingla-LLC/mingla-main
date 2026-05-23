#!/usr/bin/env node
/**
 * I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME strict-grep gate.
 *
 * Realtime postgres_changes filters MUST NOT use primary-key id=eq.* filters
 * on RLS-gated client subscriptions. Supabase realtime silently drops that
 * binding shape; use a non-PK filter or a Postgres-triggered broadcast.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const DEFAULT_SCAN_DIRS = [
  "app-mobile/src",
  "mingla-business/src",
  "mingla-admin/src",
];

function argValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
      i += 1;
    }
  }
  return values;
}

const requestedScanDirs = argValues("--scan-dir");
const scanDirs = (requestedScanDirs.length ? requestedScanDirs : DEFAULT_SCAN_DIRS).map((dir) =>
  isAbsolute(dir) ? dir : resolve(process.cwd(), dir),
);

const POSTGRES_CHANGES_RE = /\.on\(\s*["']postgres_changes["']/g;
const PK_FILTER_RE = /filter\s*:\s*(?:`[^`]*\bid=eq\.|["'][^"']*\bid=eq\.)/;
const CALL_CONTEXT_LINES = 16;

const BASELINED_NON_GOAL_CONTEXTS = [
  {
    rel: "app-mobile/src/services/realtimeService.ts",
    table: "collaboration_sessions",
    event: "UPDATE",
    owner: "subscribeToSession",
  },
  {
    rel: "app-mobile/src/services/realtimeService.ts",
    table: "boards",
    event: "UPDATE",
    owner: "subscribeToBoard",
  },
  {
    rel: "app-mobile/src/services/realtimeService.ts",
    table: "collaboration_sessions",
    event: "DELETE",
    owner: "subscribeToBoardSession",
  },
  {
    rel: "mingla-business/src/hooks/useOrderRealtimeSubscription.ts",
    table: "ticket_checkout_sessions",
    event: "UPDATE",
  },
];

let filesScanned = 0;
let listenersScanned = 0;
let violations = 0;

function* walkSource(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (requestedScanDirs.length === 0) return;
    console.error(`[I-PROPOSED-ORCH-0931] cannot read ${dir}: ${err.message}`);
    process.exit(2);
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "__tests__") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.error(`[I-PROPOSED-ORCH-0931] cannot stat ${full}: ${err.message}`);
      process.exit(2);
    }

    if (st.isDirectory()) {
      yield* walkSource(full);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\.(ts|tsx|js|jsx)$/.test(entry)) {
      yield full;
    }
  }
}

function nearestSubscriptionOwner(source, matchIndex) {
  const prefix = source.slice(0, matchIndex);
  const owners = ["subscribeToBoardSession", "subscribeToSession", "subscribeToBoard"];
  return owners
    .map((owner) => ({ owner, idx: prefix.lastIndexOf(`${owner}(`) }))
    .sort((a, b) => b.idx - a.idx)[0]?.owner;
}

function isBaselinedNonGoal(file, source, matchIndex, callContext) {
  const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
  const owner = nearestSubscriptionOwner(source, matchIndex);

  return BASELINED_NON_GOAL_CONTEXTS.some((entry) => {
    return (
      rel === entry.rel &&
      (callContext.includes(`table: "${entry.table}"`) || callContext.includes(`table: '${entry.table}'`))
    ) &&
      (callContext.includes(`event: "${entry.event}"`) || callContext.includes(`event: '${entry.event}'`)) &&
      (!entry.owner || owner === entry.owner);
  });
}

for (const dir of scanDirs) {
  for (const file of walkSource(dir)) {
    filesScanned += 1;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      console.error(`[I-PROPOSED-ORCH-0931] cannot read ${file}: ${err.message}`);
      process.exit(2);
    }

    const lines = source.split("\n");
    for (const match of source.matchAll(POSTGRES_CHANGES_RE)) {
      listenersScanned += 1;
      const lineIdx = source.slice(0, match.index ?? 0).split("\n").length - 1;
      const callContext = lines.slice(lineIdx, Math.min(lines.length, lineIdx + CALL_CONTEXT_LINES)).join("\n");

      if (!PK_FILTER_RE.test(callContext)) continue;
      if (isBaselinedNonGoal(file, source, match.index ?? 0, callContext)) continue;

      violations += 1;
      console.error(
        `x ${relative(REPO_ROOT, file)}:${lineIdx + 1} - postgres_changes listener uses a primary-key id=eq.* filter; use a non-PK filter or broadcast.`,
      );
    }
  }
}

console.log(
  [
    "I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME:",
    `scanned ${filesScanned} files,`,
    `${listenersScanned} postgres_changes listeners,`,
    `${violations} violations`,
  ].join(" "),
);
process.exit(violations === 0 ? 0 : 1);
