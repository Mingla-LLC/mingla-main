#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const fail = (message) => {
  console.error(`[orch-0776d] ${message}`);
  process.exit(1);
};

const walk = (dir, predicate, results = []) => {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path, predicate, results);
    } else if (predicate(path)) {
      results.push(path);
    }
  }
  return results;
};

const read = (path) => readFileSync(path, "utf8");
const relativeToRoot = (path) => relative(root, path);

const functionFiles = walk(
  join(root, "supabase/functions"),
  (path) => path.endsWith(".ts"),
);
const cancelledAtWriters = functionFiles.filter((path) =>
  read(path).includes("cancelled_at:"),
);

if (cancelledAtWriters.length === 0) {
  console.log("[orch-0776d] cancelled_at schema/code parity passed");
  process.exit(0);
}

const migrationFiles = walk(
  join(root, "supabase/migrations"),
  (path) => path.endsWith(".sql"),
);
const hasEventCoverCancelledAtMigration = migrationFiles.some((path) => {
  const sql = read(path);
  return (
    /event_cover_video_jobs/i.test(sql) &&
    /cancelled_at/i.test(sql) &&
    (
      /ALTER\s+TABLE\s+(?:public\.)?event_cover_video_jobs[\s\S]*ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+cancelled_at/i.test(sql) ||
      /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?event_cover_video_jobs[\s\S]*cancelled_at/i.test(sql)
    )
  );
});

if (!hasEventCoverCancelledAtMigration) {
  fail(
    [
      "supabase/functions writes cancelled_at on event_cover_video_jobs, but no migration declares that column.",
      "writers:",
      ...cancelledAtWriters.map((path) => `- ${relativeToRoot(path)}`),
    ].join("\n"),
  );
}

console.log("[orch-0776d] cancelled_at schema/code parity passed");
