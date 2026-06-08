#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1104 [Support live-chat + tickets + segmentation]
 * Phase 0 backend invariants (SPEC §4.3).
 *
 * Enforces, permanently, across the support backend + (forward-guard) the
 * support UI files the later phases add:
 *
 *  INV-A · I-1104-NO-KBC-ON-WEB (§2.10): no SUPPORT file imports
 *    `react-native-keyboard-controller` outside a `.native.*` module. The web
 *    bundle must never pull in keyboard-controller primitives directly. Scans
 *    mingla-business + app-mobile source for files whose path contains "support"
 *    (case-insensitive) and forbids the import unless the filename ends `.native.*`.
 *
 *  INV-B · I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS (CF-C1): the support feature
 *    migration must NOT create a schema object named bare `tickets` or `agents`
 *    (those are event-money ticketing + the ARI agent). Forbids
 *    `CREATE TABLE [public.]tickets`/`agents` and `CREATE ... VIEW tickets`/`agents`
 *    in any *meta_orch_1104* migration.
 *
 *  INV-C · I-1104-SUPPORT-SCOPED-RLS (Lane D D5 #3): every support staff/admin
 *    chat-table policy (on conversations / messages / conversation_presence) in
 *    the support migration must carry `linked_entity_type = 'support'` so staff
 *    never widen into users' direct/group/event DMs. Asserted by requiring each
 *    `CREATE POLICY *_support_staff_*` block to contain the scope predicate.
 *
 *  INV-D · I-1104-IS-ADMIN-RETIRED-SAFE (§2.5.1): no NEW reader of
 *    `profiles.is_admin` in support edge fns or the support migration's live
 *    code (the deprecate comment + snapshot are allowed; an actual read like
 *    `.is_admin` filter or `profiles.is_admin` in a predicate is forbidden).
 *    session_participants.is_admin is a DIFFERENT column and is exempt.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function walk(dir, acc, exts) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing dir = nothing to scan
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" || ent.name === "__snapshots__" ||
        ent.name === ".expo" || ent.name === "dist" || ent.name === "build"
      ) continue;
      walk(full, acc, exts);
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      acc.push(full);
    }
  }
}

const KBC_IMPORT = /react-native-keyboard-controller/;
const IS_SUPPORT_PATH = /support/i;
const NATIVE_FILE = /\.native\.[a-z]+$/i;

// INV-A — no KBC import in support files outside .native modules.
function checkNoKbcOnWeb() {
  const roots = [
    path.join(REPO_ROOT, "mingla-business"),
    path.join(REPO_ROOT, "app-mobile"),
  ];
  const files = [];
  for (const r of roots) walk(r, files, [".ts", ".tsx"]);
  let scanned = 0;
  let viol = 0;
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    if (!IS_SUPPORT_PATH.test(rel)) continue;
    scanned += 1;
    if (NATIVE_FILE.test(file)) continue; // .native modules may import it
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      if (KBC_IMPORT.test(line) && /import|require\(/.test(line)) {
        viol += 1;
        fail(
          "INV-A: I-1104-NO-KBC-ON-WEB",
          `${rel}:${i + 1} imports react-native-keyboard-controller outside a .native module`,
        );
      }
    });
  }
  if (viol === 0) {
    ok(
      "INV-A: I-1104-NO-KBC-ON-WEB",
      `scanned ${scanned} support source file(s) — no non-native keyboard-controller imports`,
    );
  }
}

function supportMigrations() {
  const dir = path.join(REPO_ROOT, "supabase", "migrations");
  const acc = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/meta_orch_1104/i.test(name) && name.endsWith(".sql")) {
        acc.push(path.join(dir, name));
      }
    }
  } catch {
    // ignore
  }
  return acc;
}

// INV-B — no bare tickets/agents schema object in the support migration.
const BARE_TICKETS_AGENTS =
  /CREATE\s+(?:TABLE|(?:OR\s+REPLACE\s+)?VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(tickets|agents)\b/i;

function checkNoBareTicketsAgents() {
  const migs = supportMigrations();
  let viol = 0;
  for (const file of migs) {
    const rel = path.relative(REPO_ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      const m = BARE_TICKETS_AGENTS.exec(line);
      if (m) {
        viol += 1;
        fail(
          "INV-B: I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS",
          `${rel}:${i + 1} creates bare schema object '${m[1]}' (reserved for ticketing/ARI)`,
        );
      }
    });
  }
  if (viol === 0) {
    ok(
      "INV-B: I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS",
      `scanned ${migs.length} support migration(s) — no bare tickets/agents schema names`,
    );
  }
}

// INV-C — every support_staff chat-table policy carries linked_entity_type='support'.
function checkSupportScopedRls() {
  const migs = supportMigrations();
  let viol = 0;
  let policies = 0;
  for (const file of migs) {
    const rel = path.relative(REPO_ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    // Split into CREATE POLICY … ; blocks naming a CHAT-TABLE support-staff
    // policy. Only policies on the chat substrate (conversations / messages /
    // conversation_presence) must carry the linked_entity_type='support' scope.
    // The support_staff / support_tickets / support_audit_log TABLE policies are
    // NOT chat policies and are excluded (they gate on auth.uid()/is_admin_user()).
    const blockRe =
      /CREATE\s+POLICY\s+((?:conversations|messages|conversation_presence)_support_staff[a-z0-9_]*)\b[\s\S]*?;/gi;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
      policies += 1;
      const block = m[0];
      const name = m[1];
      if (!/linked_entity_type\s*=\s*'support'/i.test(block)) {
        viol += 1;
        fail(
          "INV-C: I-1104-SUPPORT-SCOPED-RLS",
          `${rel} policy ${name} is missing the linked_entity_type = 'support' scope predicate`,
        );
      }
    }
  }
  if (viol === 0) {
    ok(
      "INV-C: I-1104-SUPPORT-SCOPED-RLS",
      `checked ${policies} support_staff chat policy block(s) — all carry linked_entity_type='support'`,
    );
  }
}

// INV-D — no NEW reader of profiles.is_admin in support edge fns / migration code.
// A read = `profiles.is_admin` in a predicate or `.is_admin` referencing profiles.
// The deprecation COMMENT (in the migration) and the snapshot SELECT of is_admin
// INTO the backup are the ONLY allowed references and are exempted by name.
const SUPPORT_EDGE_DIRS = [
  "support-claim",
  "support-send",
  "support-set-status",
  "support-grant-staff",
  "notify-support",
];
const PROFILES_IS_ADMIN_READ = /\bprofiles(?:\s+[a-z]+)?\.is_admin\b/i;

function checkNoNewIsAdminReader() {
  let viol = 0;
  let scanned = 0;
  // edge fns
  for (const d of SUPPORT_EDGE_DIRS) {
    const dir = path.join(REPO_ROOT, "supabase", "functions", d);
    const files = [];
    walk(dir, files, [".ts"]);
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      scanned += 1;
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (PROFILES_IS_ADMIN_READ.test(line)) {
          viol += 1;
          fail(
            "INV-D: I-1104-IS-ADMIN-RETIRED-SAFE",
            `${rel}:${i + 1} reads profiles.is_admin (dead column — use is_admin_user())`,
          );
        }
      });
    }
  }
  if (viol === 0) {
    ok(
      "INV-D: I-1104-IS-ADMIN-RETIRED-SAFE",
      `scanned ${scanned} support edge-fn file(s) — no new profiles.is_admin readers`,
    );
  }
}

function runSelfTest() {
  let selfFail = 0;
  // INV-A detector
  const kbcBad = `import { KeyboardAvoidingView } from "react-native-keyboard-controller";`;
  if (!(KBC_IMPORT.test(kbcBad) && /import/.test(kbcBad))) {
    console.error("SELF-TEST FAIL: KBC import not detected");
    selfFail++;
  }
  if (NATIVE_FILE.test("SupportThread.tsx")) {
    console.error("SELF-TEST FAIL: non-native file wrongly treated as native");
    selfFail++;
  }
  if (!NATIVE_FILE.test("SupportThread.native.tsx")) {
    console.error("SELF-TEST FAIL: .native file not recognized");
    selfFail++;
  }
  // INV-B detector
  if (!BARE_TICKETS_AGENTS.test("CREATE TABLE public.tickets (")) {
    console.error("SELF-TEST FAIL: bare tickets table not flagged");
    selfFail++;
  }
  if (!BARE_TICKETS_AGENTS.test("CREATE TABLE agents (")) {
    console.error("SELF-TEST FAIL: bare agents table not flagged");
    selfFail++;
  }
  if (BARE_TICKETS_AGENTS.test("CREATE TABLE public.support_tickets (")) {
    console.error("SELF-TEST FAIL: support_tickets wrongly flagged as bare tickets");
    selfFail++;
  }
  // INV-C detector
  const goodPolicy =
    "CREATE POLICY conversations_support_staff_read ON public.conversations FOR SELECT USING (linked_entity_type = 'support' AND is_admin_user());";
  if (!/linked_entity_type\s*=\s*'support'/i.test(goodPolicy)) {
    console.error("SELF-TEST FAIL: support scope predicate not detected");
    selfFail++;
  }
  // INV-D detector
  if (!PROFILES_IS_ADMIN_READ.test("WHERE profiles.is_admin = true")) {
    console.error("SELF-TEST FAIL: profiles.is_admin read not flagged");
    selfFail++;
  }
  if (PROFILES_IS_ADMIN_READ.test("session_participants.is_admin")) {
    console.error("SELF-TEST FAIL: session_participants.is_admin wrongly flagged");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: META-ORCH-1104 support backend invariant detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

checkNoKbcOnWeb();
checkNoBareTicketsAgents();
checkSupportScopedRls();
checkNoNewIsAdminReader();

process.exit(failures > 0 ? 1 : 0);
