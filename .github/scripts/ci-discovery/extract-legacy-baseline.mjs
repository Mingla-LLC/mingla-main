#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`ci-discovery:extract:${message}`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) fail("invalid_arguments");
    values[key.slice(2)] = value;
  }
  for (const required of ["source", "source-sha", "root", "output"]) {
    if (!values[required]) fail(`missing_${required}`);
  }
  return values;
}

function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  const entries = fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function extractArray(source, jobName, nextJobName) {
  const jobStart = source.indexOf(`\n  ${jobName}:\n`);
  const jobEnd = source.indexOf(`\n  ${nextJobName}:\n`, jobStart + 1);
  if (jobStart < 0 || jobEnd < 0) fail(`job_boundary_${jobName}`);
  const job = source.slice(jobStart, jobEnd);
  const arrayStart = job.indexOf("DENO_TEST_FILES=(");
  const arrayEnd = job.indexOf("\n          )", arrayStart);
  if (arrayStart < 0 || arrayEnd < 0) fail(`array_boundary_${jobName}`);
  return job.slice(arrayStart, arrayEnd)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "DENO_TEST_FILES=(")
    .map((line) => line.replace(/^['\"]|['\"]$/g, ""));
}

export function extractLegacyBaseline({ source, sourceSha, root }) {
  const migrationJobStart = source.indexOf("\n  migrations:\n");
  const migrationStepStart = source.indexOf("      - name: Apply migrations in timestamp order", migrationJobStart);
  const migrationStepEnd = source.indexOf("\n      - name:", migrationStepStart + 1);
  if (migrationJobStart < 0 || migrationStepStart < 0 || migrationStepEnd < 0) {
    fail("migration_step_boundary");
  }
  const migrationStep = source.slice(migrationStepStart, migrationStepEnd);
  const sqlRows = [...migrationStep.matchAll(
    /psql -h localhost -U (postgres|supabase_admin) -d postgres -v ON_ERROR_STOP=1 \\\n\s+-f (supabase\/migrations\/__tests__\/[^\s]+\.sql)/g,
  )].map((match, index) => ({
    orderKey: `legacy-${String(index + 1).padStart(4, "0")}`,
    path: match[2],
    profile: "psql-pg17-post-replay",
    database: { database: "postgres", user: match[1], reset: "suite-owned" },
  }));
  const stripe = extractArray(source, "deno-tests", "notification-deno-tests");
  const notification = extractArray(source, "notification-deno-tests", "orch-1270-strict-grep");
  if (sqlRows.length !== 166 || stripe.length !== 95 || notification.length !== 51) {
    fail(`unexpected_counts:${sqlRows.length}:${stripe.length}:${notification.length}`);
  }

  const allFiles = walk(root);
  const sqlCandidates = allFiles.filter((file) =>
    /^supabase\/migrations\/__tests__\/.*\.test\.sql$/.test(file)
  );
  const denoCandidates = allFiles.filter((file) =>
    (/^supabase\/.*\.test\.ts$/.test(file) ||
      /^packages\/.*\.test\.ts$/.test(file) ||
      /^mingla-business\/.*\.deno\.test\.ts$/.test(file))
  );
  for (const selected of [...stripe, ...notification]) {
    if (!selected.includes("*") && !denoCandidates.includes(selected)) denoCandidates.push(selected);
  }

  const denoRows = (files, lane, profile) => files.map((file, index) => ({
    orderKey: `legacy-${String(index + 1).padStart(4, "0")}`,
    path: file,
    profile,
  }));

  return {
    schemaVersion: 1,
    immutable: true,
    sourceSha,
    profiles: {
      "psql-pg17-post-replay": {
        command: "psql",
        argv: ["-h", "localhost", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f"],
        postgresWaitSeconds: 90,
      },
      "deno-1.46-stripe": {
        command: "deno",
        argv: ["test", "--allow-env", "--allow-net", "--allow-read", "--no-check"],
        runtime: "1.46.x",
        attempts: 3,
        retryDelaySeconds: 10,
        finalDiagnostic: "Stripe Deno tests failed after 3 attempts (esm.sh flake?)",
      },
      "deno-1.46-notification": {
        command: "deno",
        argv: ["test", "--allow-env", "--allow-net", "--allow-read", "--no-check"],
        runtime: "1.46.x",
        attempts: 3,
        retryDelaySeconds: 10,
        finalDiagnostic: "Notification Deno tests failed after 3 attempts (esm.sh flake?)",
      },
      "deno-2-unit": {
        command: "deno",
        argv: ["test", "--allow-env", "--allow-net", "--allow-read", "--no-check"],
        runtime: "2.x",
        attempts: 1,
      },
    },
    lanes: {
      migrations: sqlRows,
      "stripe-deno": denoRows(stripe, "stripe-deno", "deno-1.46-stripe"),
      "notification-deno": denoRows(notification, "notification-deno", "deno-1.46-notification"),
    },
    candidateSnapshot: {
      sql: [...new Set(sqlCandidates)].sort(),
      deno: [...new Set(denoCandidates)].sort(),
    },
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const source = fs.readFileSync(path.resolve(args.source), "utf8");
  const baseline = extractLegacyBaseline({
    source,
    sourceSha: args["source-sha"],
    root: path.resolve(args.root),
  });
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`ci-discovery:extract:PASS sql=${baseline.lanes.migrations.length} stripe=${baseline.lanes["stripe-deno"].length} notification=${baseline.lanes["notification-deno"].length}`);
}
