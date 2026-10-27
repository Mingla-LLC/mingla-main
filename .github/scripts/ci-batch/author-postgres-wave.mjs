#!/usr/bin/env node
// Mechanical authoring helper for #3643 Phase 3E. Every origin run step is
// retained by default. The reviewed tables below name the only service/replay
// steps the shared PostgreSQL host supersedes, plus the exact assertion tails
// retained from combined replay-and-test steps.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverExpectedFilesForSuite, phase3eContractDigest } from "./validate-manifest-v2.mjs";
import { POSTGRES_WAVE, postgresAdditionalDatabaseName, postgresDatabaseName } from "./postgres-batch-contract.mjs";
import { compileOriginPattern } from "./select-phase3b-suites.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MANIFEST = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const BATCH_PROVIDER = path.posix.join(".github", "workflows", ["ci", "batch.yml"].join("-"));
const DENO_ACTIONS = Object.freeze({
  "1.46.x": "denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d",
  "v2.x": "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
  "v2.7.14": "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
  "v2.9.5": "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
});
const SHARED_ORIGIN_PATHS = Object.freeze([
  ".github/scripts/ci-batch/postgres-batch-contract.mjs",
  ".github/scripts/ci-batch/postgres-batch.mjs",
]);
const TRACKED_FILES = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);

const PLAIN = Object.freeze([
  "issue-1406-customer-patterns-performance-tests", "issue-1447-rsvp-admission-tests",
  "issue-1529-notification-country-code-tests", "issue-1719-unified-sharing",
  "issue-1773-reservation-stay-ingest-tests", "issue-1774-people-page-tests",
  "issue-1775-csv-contact-import-tests", "issue-1857-phone-country-authority-tests",
  "issue-1858-explicit-brand-export-tests", "issue-1902-rsvp-backend-safety-tests",
  "issue-1929-hidden-direct-checkout-tests", "issue-1931-private-event-access",
  "issue-1972-ari-event-lifecycle", "issue-1973-ari-experience-lifecycle",
  "issue-1974-ari-ticket-pricing", "issue-1985-ari-task-state",
  "issue-1995-contact-book-blast", "issue-2009-published-event-visibility",
  "issue-2015-app-network-bindings", "issue-2060-ari-reliability",
  "issue-2063-ari-brand-management", "issue-2117-offering-visibility-gate-tests",
  "issue-2150-free-resubmit-idempotent-tests", "issue-2160-multiday-multiselect-tests",
  "issue-2160-tester-adversarial-tests", "issue-2168-revocation-refund-handoff-tests",
  "issue-2217-confirmation-app-cta-tests", "issue-2267-marketing-tenancy",
  "issue-2269-verified-phone-claim-tests", "issue-2323-free-order-claim-and-cta-tests",
  "issue-2333-online-event-publish", "issue-2353-format-truth-and-edit-grant",
  "issue-871-attendance-entitlement-tests", "issue-875-customer-patterns-tests",
]);
const MIGRATED = Object.freeze([
  "issue-1020-discover-geo-fallback-tests", "issue-1175-paystack-refunds-tests",
  "issue-1179-cancel-refund-fanout-tests", "issue-1403-listing-insights-tests",
  "issue-1421-venue-organic-insights-tests", "issue-1463-permitted-staff-venue-submit-tests",
  "issue-1469-stay-authoring-permissions", "issue-1614-onconflict-arbiter-audit",
  "issue-1810-guest-roster-export-compat-tests", "issue-1812-brand-people-export-search-tests",
  "issue-2101-named-buyer-checkout-tests", "issue-2136-free-checkout-contract-tests",
  "issue-2393-valid-marketing-test-fixtures", "issue-873-guest-status-roster-tests",
]);
const WAVE = Object.freeze([...PLAIN, ...MIGRATED]);

const OMIT_STEPS = Object.freeze({
  "issue-1447-rsvp-admission-tests": ["Wait for PostgreSQL 17", "Apply every migration in timestamp order"],
  "issue-1529-notification-country-code-tests": ["Wait for PostgreSQL 17", "Apply all migrations"],
  "issue-1719-unified-sharing": ["Apply full migration history"],
  "issue-1773-reservation-stay-ingest-tests": ["Wait for PostgreSQL 17 and apply every migration"],
  "issue-1774-people-page-tests": ["Wait for PostgreSQL 17 and apply every migration"],
  "issue-1857-phone-country-authority-tests": ["Wait for PostgreSQL 17"],
  "issue-1902-rsvp-backend-safety-tests": ["Wait for PostgreSQL 17", "Apply every migration in timestamp order"],
  "issue-1972-ari-event-lifecycle": ["Apply the full migration chain"],
  "issue-2009-published-event-visibility": ["Canonical migration replay (whole chain, timestamp order)"],
  "issue-2150-free-resubmit-idempotent-tests": ["Wait for PostgreSQL 17 bootstrap to complete", "Apply migrations in timestamp order"],
  "issue-2160-multiday-multiselect-tests": ["Wait for PostgreSQL 17 bootstrap to complete", "Apply migrations in timestamp order"],
  "issue-2217-confirmation-app-cta-tests": ["Wait for PostgreSQL 17 bootstrap to complete", "Apply migrations in timestamp order"],
  "issue-2323-free-order-claim-and-cta-tests": ["Wait for PostgreSQL 17 bootstrap to complete", "Apply migrations in timestamp order"],
  "issue-2333-online-event-publish": ["Wait for postgres", "Apply migrations in timestamp order"],
  "issue-2353-format-truth-and-edit-grant": ["Canonical migration replay (whole chain, timestamp order)"],
  "issue-871-attendance-entitlement-tests": ["Wait for PostgreSQL 17", "Apply full migration history"],
});

const ASSERTION_TAILS = Object.freeze({
  "issue-1775-csv-contact-import-tests": Object.freeze({
    "Apply migrations and prove PG17 contract": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_1775_csv_contact_import.happy.pg17.test.sql",
  }),
  "issue-1929-hidden-direct-checkout-tests": Object.freeze({
    "Canonical full migration replay and": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_1929_hidden_direct_checkout.test.sql",
  }),
  "issue-1973-ari-experience-lifecycle": Object.freeze({
    "Apply full migration chain and run both": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\\n  -f supabase/migrations/__tests__/issue_1973_ari_experience_lifecycle.pg17.test.sql",
  }),
  "issue-1974-ari-ticket-pricing": Object.freeze({
    "Apply all migrations and execute behavioral proof": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_1974_ticket_pricing.behavior.pg17.test.sql",
  }),
  "issue-1995-contact-book-blast": Object.freeze({
    "Apply full migration chain and prove PG17 contract": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_1995_contact_book_blast.happy.pg17.test.sql",
  }),
  "issue-2015-app-network-bindings": Object.freeze({
    "Apply full migration chain and prove PG17 contract": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_2015_app_network_appsflyer_bindings.happy.pg17.test.sql",
  }),
  "issue-2063-ari-brand-management": Object.freeze({
    "Full migration replay and executable brand matrix": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\\n  -f supabase/migrations/__tests__/issue_2063_ari_brand_management.pg17.test.sql",
  }),
  "issue-2267-marketing-tenancy": Object.freeze({
    "Apply the full migration chain, then prove the UPDATE contract": "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\\n  -f supabase/migrations/__tests__/issue_2267_marketing_brand_tenancy_update.happy.pg17.test.sql",
  }),
});

const CUSTOM_TEMPLATE_STEPS = Object.freeze({
  "issue-1857-phone-country-authority-tests": "Apply every migration in timestamp order",
  "issue-1931-private-event-access": "SC-47 baseline capture (pre-#1931)",
  "issue-2117-offering-visibility-gate-tests": "Canonical migration replay — phase 1 (chain except #2117)",
});
const SPECIAL_CLASSES = Object.freeze({
  "issue-1773-reservation-stay-ingest-tests": "postgres17-deno295-node20-cli2982",
  "issue-1857-phone-country-authority-tests": "postgres17-deno295-node20-pre1857",
  "issue-1931-private-event-access": "postgres17-deno2-node22-pre1931",
  "issue-1985-ari-task-state": "postgres17-deno146-node20-dualdb",
  "issue-2117-offering-visibility-gate-tests": "postgres17-deno2-node20-pre2117",
});

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function workflowPath(id) { return path.join(WORKFLOW_DIR, `${id}.yml`); }
function yaml(file) {
  return JSON.parse(execFileSync("ruby", ["-rjson", "-ryaml", "-e", "puts JSON.generate(YAML.load_file(ARGV.fetch(0)))", file], { encoding: "utf8" }));
}
function payloadSha(capability) {
  return sha(JSON.stringify({ cwd: capability.cwd, executable: capability.executable, argv: capability.argv, env: capability.env, compound: capability.compound }));
}
function exactTail(run, marker, id, name) {
  const first = run.indexOf(marker);
  if (first < 0 || run.indexOf(marker, first + 1) >= 0) throw new Error(`${id}: ${name} assertion-tail marker drifted`);
  return `set -euo pipefail\n${run.slice(first)}`;
}
function transform1985(name, run) {
  const migration = "supabase/migrations/20270712003429_issue_3429_ari_chat_context.sql";
  if (name === "Full migration replay and server-owned state authority") {
    const secretStart = run.indexOf("        psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\");
    const secretEndNeedle = "          >/dev/null\n";
    const secretEnd = run.indexOf(secretEndNeedle, secretStart) + secretEndNeedle.length;
    const tests = run.indexOf("psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \\\n  -f supabase/migrations/__tests__/issue_1985_task_state_authority.implementor.pg17.test.sql");
    if (secretStart < 0 || secretEnd < secretEndNeedle.length || tests < 0) throw new Error("#1985 primary replay transform drifted");
    const secret = run.slice(secretStart, secretEnd).replace(/^ {8}/gm, "");
    return `set -euo pipefail\n${secret}psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f ${migration} >/dev/null\n${run.slice(tests)}`;
  }
  if (name === "Vault-less full replay applies the #3429 migration with advisories only") {
    const assertions = run.indexOf('cat "$advisories"');
    if (assertions < 0) throw new Error("#1985 vaultless replay transform drifted");
    return `set -euo pipefail\nadvisories="$(mktemp)"\npsql -h localhost -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -f ${migration} >/dev/null 2>"$advisories"\n${run.slice(assertions)}`;
  }
  return run;
}
function runtimeFor(document) {
  const setupSteps = Object.values(document.jobs || {}).flatMap((job) => job.steps || []);
  const nodeVersions = [...new Set(setupSteps.filter((step) => String(step.uses || "").startsWith("actions/setup-node@"))
    .map((step) => String(step.with?.["node-version"] || "20")))];
  const denoVersions = [...new Set(setupSteps.filter((step) => String(step.uses || "").startsWith("denoland/setup-deno@"))
    .map((step) => String(step.with?.["deno-version"] || "v2.x")))];
  if (nodeVersions.length > 1 || denoVersions.length > 1) throw new Error(`workflow runtime split is not batchable: node=${nodeVersions} deno=${denoVersions}`);
  const node = nodeVersions[0] || "20";
  const deno = denoVersions[0] || null;
  if (!deno) return { runtime: { name: "node", version: node }, tag: `postgres17-node${node}-noinstall`, primaryDeno: "" };
  if (!DENO_ACTIONS[deno]) throw new Error(`unreviewed Deno selector ${deno}`);
  const denoTag = { "1.46.x": "deno146", "v2.x": "deno2", "v2.7.14": "deno2714", "v2.9.5": "deno295" }[deno];
  return {
    runtime: { name: "node+deno", nodeVersion: node, deno: { version: deno, action: DENO_ACTIONS[deno] } },
    tag: `postgres17-${denoTag}-node${node}-noinstall`, primaryDeno: deno,
  };
}
function classFor(id, runtime) { return SPECIAL_CLASSES[id] || runtime.tag; }
function hostTimeoutMinutes(klass) { return klass.includes("pre1931") || klass.includes("pre2117") ? 120 : 180; }
function normalizeOriginPath(pattern) {
  if (pattern.startsWith("!")) return null;
  const candidates = [];
  if (pattern.includes("*")) {
    const star = pattern.indexOf("*");
    candidates.push(`${pattern.slice(0, star)}*`);
    const parent = pattern.slice(0, pattern.lastIndexOf("/", star));
    if (parent) candidates.push(`${parent}/**`);
  } else {
    candidates.push(pattern);
  }
  return candidates.find((candidate) => {
    try {
      const matches = compileOriginPattern(candidate);
      return TRACKED_FILES.some(matches);
    } catch {
      return false;
    }
  }) || null;
}
function cleanOriginPaths(patterns) {
  return [...new Set(patterns.map(normalizeOriginPath).filter(Boolean))];
}
function orderPostgresCapabilities(value) {
  const waveIds = new Set(value.suites.filter((suite) => suite.migrationWave === POSTGRES_WAVE).map((suite) => suite.id));
  const ordered = value.commandCapabilities.commands
    .filter((command) => waveIds.has(command.suiteId))
    .sort((left, right) => left.suiteId.localeCompare(right.suiteId) || left.stepIndex - right.stepIndex);
  let cursor = 0;
  value.commandCapabilities.commands = value.commandCapabilities.commands.map((command) =>
    waveIds.has(command.suiteId) ? ordered[cursor++] : command);
  value.commandCapabilities.registrySha256 = sha(JSON.stringify(value.commandCapabilities.commands));
  return value;
}
function preserveBootstrapOrdering(value) {
  const base = JSON.parse(execFileSync("git", ["show", "HEAD:.github/ci-batch/MANIFEST.json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }));
  const orderedObjects = (baseObject, nextObject) => Object.fromEntries([
    ...Object.keys(baseObject || {}).filter((key) => Object.hasOwn(nextObject || {}, key)).map((key) => [key, nextObject[key]]),
    ...Object.keys(nextObject || {}).filter((key) => !Object.hasOwn(baseObject || {}, key)).map((key) => [key, nextObject[key]]),
  ]);
  const orderedRows = (baseRows, nextRows, identity) => {
    const byId = new Map(nextRows.map((row) => [identity(row), row]));
    return [...baseRows.map((row) => byId.get(identity(row))).filter(Boolean),
      ...nextRows.filter((row) => !baseRows.some((baseRow) => identity(baseRow) === identity(row)))];
  };
  value.setupProfiles = orderedObjects(base.setupProfiles, value.setupProfiles);
  value.classes = [...base.classes.filter((item) => value.classes.includes(item)), ...value.classes.filter((item) => !base.classes.includes(item))];
  value.executionClasses = [...base.executionClasses.filter((item) => value.executionClasses.includes(item)), ...value.executionClasses.filter((item) => !base.executionClasses.includes(item))];
  value.suites = orderedRows(base.suites, value.suites, (row) => row.id);
  value.legacyOrigins = orderedRows(base.legacyOrigins, value.legacyOrigins, (row) => `${row.stem}.${row.extension}`);
  value.workflowProviders = orderedRows(base.workflowProviders, value.workflowProviders, (row) => row.workflow);
  value.commandCapabilities.commands = orderedRows(base.commandCapabilities.commands, value.commandCapabilities.commands, (row) => row.id);
  return value;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const existingWaveIds = new Set(manifest.suites.filter((suite) => suite.migrationWave === POSTGRES_WAVE).map((suite) => suite.id));
const hostDeclarations = new Map();
const filesToDelete = [];
for (const id of WAVE) {
  const existing = manifest.suites.find((suite) => suite.id === id);
  if (existing) {
    if (!existingWaveIds.has(id)) throw new Error(`${id}: suite already exists outside Phase 3E`);
    const profile = manifest.setupProfiles[existing.setupProfile];
    hostDeclarations.set(existing.class, { class: existing.class, runtime: profile.runtime,
      primaryDeno: profile.runtime.name === "node+deno" ? profile.runtime.deno.version : "", hostTimeoutMinutes: hostTimeoutMinutes(existing.class) });
    continue;
  }
  const file = workflowPath(id);
  if (!fs.existsSync(file)) throw new Error(`${id}: live workflow is missing before authoring`);
  const runtime = runtimeFor(yaml(file));
  const klass = classFor(id, runtime);
  hostDeclarations.set(klass, { class: klass, runtime: runtime.runtime, primaryDeno: runtime.primaryDeno, hostTimeoutMinutes: hostTimeoutMinutes(klass),
    primarySupabase: id === "issue-1773-reservation-stay-ingest-tests" ? "2.98.2" : "" });
}
for (const host of hostDeclarations.values()) {
  manifest.setupProfiles[host.class] = { runtime: host.runtime, install: null, classes: [host.class] };
  for (const key of ["classes", "executionClasses"]) if (!manifest[key].includes(host.class)) manifest[key].push(host.class);
}

for (const id of WAVE) {
  const current = manifest.suites.find((suite) => suite.id === id);
  if (current) {
    const origin = manifest.legacyOrigins.find((item) => item.stem === id && item.extension === "yml");
    current.originPaths = cleanOriginPaths([
      ...origin.workflowMetadata.pathScope.filter((entry) => !entry.startsWith(".github/workflows/")),
      ...current.originPaths,
      ...SHARED_ORIGIN_PATHS,
    ]);
    current.timeoutSeconds = Math.max(...Object.values(origin.workflowMetadata.jobTimeouts || { default: 20 }).map((value) => (value || 20) * 60));
    current.timingSeconds.evidence = id === "issue-1406-customer-patterns-performance-tests" ? "wave-1-run-40493344280" : current.timingSeconds.evidence;
    continue;
  }
  const file = workflowPath(id);
  const source = fs.readFileSync(file);
  const document = yaml(file);
  const runtime = runtimeFor(document);
  const klass = classFor(id, runtime);
  const origin = manifest.legacyOrigins.find((item) => item.stem === id && item.extension === "yml");
  if (!origin || origin.disposition !== "database-special") throw new Error(`${id}: live database-special origin is missing`);
  const omitted = new Set(OMIT_STEPS[id] || []);
  const seenOmitted = new Set();
  let templateReplay = null;
  const selected = [];
  const inheritedEnvNames = new Set();
  for (const [jobKey, job] of Object.entries(document.jobs || {})) {
    if (jobKey === "route") continue;
    const defaultCwd = job.defaults?.run?.["working-directory"] || ".";
    for (const step of job.steps || []) {
      if (!Object.hasOwn(step, "run")) continue;
      const name = step.name || "Assertion";
      if (name === CUSTOM_TEMPLATE_STEPS[id]) {
        if (templateReplay) throw new Error(`${id}: duplicate custom template replay`);
        templateReplay = { name: `${jobKey}: ${name}`, cwd: step["working-directory"] || defaultCwd, run: step.run, originJob: jobKey };
        continue;
      }
      if (omitted.has(name)) { seenOmitted.add(name); continue; }
      let run = step.run;
      const marker = ASSERTION_TAILS[id]?.[name];
      if (marker) run = exactTail(run, marker, id, name);
      if (id === "issue-1985-ari-task-state") run = transform1985(name, run);
      const env = { ...(job.env || {}), ...(step.env || {}) };
      delete env.PGPASSWORD;
      for (const [key, value] of Object.entries(env)) {
        if (String(value).includes("${{")) { inheritedEnvNames.add(key); delete env[key]; }
      }
      selected.push({ jobKey, name, cwd: step["working-directory"] || defaultCwd, run, env: Object.keys(env).length ? env : null });
    }
  }
  const missingOmissions = [...omitted].filter((name) => !seenOmitted.has(name));
  if (missingOmissions.length) throw new Error(`${id}: reviewed omission drifted (${missingOmissions.join(", ")})`);
  if (CUSTOM_TEMPLATE_STEPS[id] && !templateReplay) throw new Error(`${id}: custom template replay step drifted`);
  if (!selected.length) throw new Error(`${id}: selected zero retained commands`);
  const steps = selected.map((item, index) => {
    const commandId = `assert:${id}:${String(index + 1).padStart(2, "0")}`;
    const step = {
      name: `${item.jobKey}: ${item.name}`, cwd: item.cwd, run: item.run,
      invocation: { kind: "raw-shell", command: "bash", argv: ["-c", item.run] },
      exceptionRationale: "Raw shell retained to preserve the exact legacy workflow assertion command byte-for-byte.",
      commandId, originJob: item.jobKey,
    };
    if (item.env) step.env = item.env;
    return step;
  });
  const suite = {
    id, class: klass, origin: `.github/workflows/${id}.yml`,
    originPaths: cleanOriginPaths([
      ...origin.workflowMetadata.pathScope.filter((entry) => !entry.startsWith(".github/workflows/")), ...SHARED_ORIGIN_PATHS,
    ]),
    steps, lifecycle: "batched-historical", ownerIssue: origin.ownerIssue,
    runtime: manifest.setupProfiles[klass].runtime, setupProfile: klass, cwd: ".",
    envNames: [...inheritedEnvNames].sort(), isolation: "clean-worktree", expectedFiles: [], externalReferenceFiles: [],
    requiredContext: `CI batch: ${klass}`, timingSeconds: { p50: null, p95: null, evidence: "phase3e-full-wave-not-yet-measured" },
    generatedPaths: ["suite-results.json"],
    exceptionRationale: "Raw shell retained to preserve every exact legacy workflow assertion command; Phase 3E replaces only PostgreSQL readiness and the shared full-history migration replay.",
    timeoutSeconds: Math.max(...Object.values(origin.workflowMetadata.jobTimeouts || { default: 20 }).map((value) => (value || 20) * 60)),
    migrationWave: POSTGRES_WAVE, databaseName: postgresDatabaseName(id),
  };
  if (templateReplay) suite.templateReplay = templateReplay;
  if (id === "issue-1985-ari-task-state") {
    suite.additionalDatabases = { vaultless: postgresAdditionalDatabaseName(id, "vaultless") };
    suite.portDatabaseAliases = { "5433": "vaultless" };
  }
  const expectedFileCarrier = templateReplay ? { ...suite, steps: [{ run: templateReplay.run, cwd: templateReplay.cwd }, ...suite.steps] } : suite;
  suite.expectedFiles = discoverExpectedFilesForSuite(expectedFileCarrier, ROOT);
  manifest.suites.push(suite);
  origin.disposition = "batched-historical";
  origin.providerWorkflow = BATCH_PROVIDER;
  origin.rationale = "Folded into the #3643 Phase 3E PostgreSQL batch. The shared host replays the reviewed migration plan once, clones an isolated database for this suite, and executes every retained origin command.";
  origin.workflowMetadata.sourceSha256 = sha(source);
  origin.replacementSuites = [id];
  origin.migrationWave = POSTGRES_WAVE;
  delete origin.replacementSuite;
  const provider = manifest.workflowProviders.find((item) => item.workflow === `${id}.yml`);
  if (provider) {
    provider.transition = "batched-provider";
    provider.providerWorkflow = BATCH_PROVIDER;
    provider.rationale = "The historical wrapper was folded into the #3643 Phase 3E PostgreSQL batch; existing references route through its exact replacement suite.";
  }
  filesToDelete.push(file);
}

const waveIds = new Set(WAVE);
manifest.commandCapabilities.commands = manifest.commandCapabilities.commands.filter((item) => !waveIds.has(item.suiteId));
for (const suite of manifest.suites.filter((item) => item.migrationWave === POSTGRES_WAVE)) {
  suite.expectedFiles = discoverExpectedFilesForSuite(suite.templateReplay
    ? { ...suite, steps: [{ run: suite.templateReplay.run, cwd: suite.templateReplay.cwd }, ...suite.steps] } : suite, ROOT);
  suite.steps.forEach((step, stepIndex) => {
    const capability = { id: step.commandId, suiteId: suite.id, stepIndex, cwd: step.cwd, executable: "bash",
      argv: ["-c", step.run], env: step.env || null, compound: false };
    capability.payloadSha256 = payloadSha(capability);
    manifest.commandCapabilities.commands.push(capability);
  });
}
manifest.commandCapabilities.expectedCommands = manifest.commandCapabilities.commands.length;
manifest.commandCapabilities.registrySha256 = sha(JSON.stringify(manifest.commandCapabilities.commands));
manifest.expectedExecutableSuites = manifest.suites.length;
manifest.expectedSuites = manifest.suites.length;
const phase3eSuites = manifest.suites.filter((suite) => suite.migrationWave === POSTGRES_WAVE);
manifest.migrationWaves[POSTGRES_WAVE] = {
  suiteCount: phase3eSuites.length,
  outerCommandCount: phase3eSuites.reduce((sum, suite) => sum + suite.steps.length, 0),
  hostCount: hostDeclarations.size,
  migrationReplayCountPerHost: 1,
  lifecycle: "batched-historical",
};
preserveBootstrapOrdering(manifest);
orderPostgresCapabilities(manifest);
manifest.phase3eContractSha256 = phase3eContractDigest(manifest);
for (const file of filesToDelete) fs.rmSync(file);
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`authored ${phase3eSuites.length} Phase 3E suites on ${hostDeclarations.size} hosts with ${manifest.migrationWaves[POSTGRES_WAVE].outerCommandCount} exact commands`);
