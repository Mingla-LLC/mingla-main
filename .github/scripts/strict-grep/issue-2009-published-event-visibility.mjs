#!/usr/bin/env node
// Issue #2009 — published ticketed-event visibility: shape gate.
//
// SCOPE OF THIS GATE, STATED HONESTLY.
//
// Per #2113 a check that can only read source text carries no information about
// behaviour. The BEHAVIOURAL proof for #2009 lives in two places and this gate
// is NOT a substitute for either:
//
//   supabase/migrations/__tests__/issue_2009_business_event_visibility.pg17.test.sql
//     — executes the RPC, the guard trigger and the effects coordinator against
//       real Postgres rows: authorization matrix, value/type/status matrix,
//       same-value no-op before stale rejection, audit cardinality, generation
//       increment, exact share-revocation cardinality, direct-update rejection,
//       Admin compatibility and rollback atomicity.
//   mingla-business/src/services/__tests__/businessEventVisibility.issue2009.test.ts
//     — executes the client mutation, its echo verification and its copy map.
//
// What this gate adds is the WIRING that a behavioural test cannot see from
// inside its own process: that the editor's save gate still admits the
// visibility key, that the RPC call still sits above the early-return that
// would skip it, that nobody reintroduced a direct `events.visibility` table
// write anywhere in the Business app, and that this pass did not quietly grow
// the abeyance surface Amendment 3 §2 removed.
//
// Contract: BINDING SPEC AMENDMENT 3 (#issuecomment-5317187049, CONTROLLING).

import fs from "node:fs";
import path from "node:path";

const MIGRATION = "supabase/migrations/20270418002009_issue_2009_business_event_visibility.sql";
const MIGRATION_FLOOR = "20270415002117";
const SCREEN = "mingla-business/src/components/event/EditPublishedScreen.tsx";
const SERVICE = "mingla-business/src/services/businessEvents.ts";
const ADMIN_SERVICE = "mingla-admin/src/services/offeringsService.js";
const BUSINESS_SRC = "mingla-business/src";

const PRIVATE_COPY =
  "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.";

const fail = (message) => {
  throw new Error(`issue-2009-published-event-visibility: ${message}`);
};

/** Strip `--` line and block comments, preserving line structure. */
const stripSqlComments = (sql) => {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? n : j;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i);
      out += sql.slice(i, j < 0 ? n : j + 2).replace(/[^\n]/g, " ");
      i = j < 0 ? n : j + 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
};

/** Strip `//` and `/* *\/` comments from TS/JS, preserving line structure. */
const stripJsComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const check = (s) => {
  // ---- 1. Exactly ONE forward #2009 migration, above the ordering floor -----
  const migName = path.basename(MIGRATION);
  const stamp = migName.slice(0, 14);
  if (!(stamp > MIGRATION_FLOOR)) {
    fail(`migration timestamp ${stamp} is not above the floor ${MIGRATION_FLOOR}`);
  }
  const mine = s.migrationList.filter((f) => /issue_2009/i.test(f));
  if (mine.length !== 1) fail(`there must be exactly ONE #2009 migration, found ${mine.length}`);
  const sameStamp = s.migrationList.filter((f) => f.startsWith(stamp));
  if (sameStamp.length !== 1) {
    fail(`migration timestamp ${stamp} collides with ${sameStamp.length - 1} other migration(s)`);
  }
  if (s.migration === "") fail("the #2009 migration is missing");

  // ---- 2. The authoritative objects exist (comment-stripped: a comment must
  //         never satisfy a presence assertion) -------------------------------
  const need = [
    [/CREATE OR REPLACE FUNCTION public\.business_set_event_visibility\b/, "the narrow Business RPC"],
    [/CREATE TRIGGER issue_2009_events_visibility_guard\b/, "the BEFORE visibility write guard"],
    [/CREATE TRIGGER issue_2009_events_visibility_effects\b/, "the AFTER visibility effects coordinator"],
    [/CREATE TABLE IF NOT EXISTS public\.event_visibility_transition_effects\b/, "the transition-effect ledger"],
    [/CREATE TABLE IF NOT EXISTS public\.event_discovery_generation\b/, "the discovery-generation singleton"],
    [/RAISE EXCEPTION 'private_visibility_unavailable'/, "the Private fail-closed refusal"],
    [/RAISE EXCEPTION 'event_visibility_direct_update_blocked'/, "the direct-update refusal"],
    [/RAISE EXCEPTION 'private_transition_requires_business'/, "the Admin Private-boundary refusal"],
    [/GET DIAGNOSTICS v_revoked = ROW_COUNT/, "the exact share-revocation cardinality capture"],
  ];
  for (const [re, what] of need) {
    if (!re.test(s.migrationNoComments)) fail(`the migration is missing ${what}`);
  }

  // ---- 3. Amendment 3 §2/§4 abeyance: this pass must not grow the two-phase
  //         surface, and must not call any frozen #1931 primitive -------------
  if (/issue_1931_/.test(s.migrationNoComments)) {
    fail("the #2009 migration references an issue_1931_* symbol — every one is a frozen refusal stub (Amendment 3 §4)");
  }
  if (/event_visibility_transition_effects[\s\S]{0,600}\bphase\b/.test(s.migrationNoComments)) {
    fail("the effects ledger declares a `phase` column — the two-phase coordinator is HELD IN ABEYANCE (Amendment 3 §2)");
  }
  for (const [file, text] of Object.entries(s.businessSources)) {
    if (/issue_1931_/.test(stripJsComments(text))) {
      fail(`${file} calls an issue_1931_* primitive — out of scope for this pass (Amendment 3 §4)`);
    }
  }

  // ---- 4. The editor's save gate admits visibility, and the RPC call sits
  //         ABOVE the early-return that would otherwise skip it ---------------
  const screen = s.screenNoComments;
  if (!/const ISSUE_2009_VISIBILITY_PATCH_KEYS\s*=\s*new Set<keyof EditableLiveEventFields>\(\[[^\]]*"visibility"/.test(screen)) {
    fail("ISSUE_2009_VISIBILITY_PATCH_KEYS does not declare the `visibility` key (SC-1)");
  }
  if (!/SERVER_EDITABLE_PATCH_KEYS[\s\S]{0,400}\.\.\.ISSUE_2009_VISIBILITY_PATCH_KEYS/.test(screen)) {
    fail("SERVER_EDITABLE_PATCH_KEYS no longer unions ISSUE_2009_VISIBILITY_PATCH_KEYS — Save would disable again (SC-1)");
  }
  const rpcIndex = screen.indexOf("await setPublishedEventVisibility({");
  if (rpcIndex < 0) fail("the editor no longer calls setPublishedEventVisibility (SC-3)");
  const earlyReturnIndex = screen.indexOf("isServerEditableOnlyPatch(patch)\n      ) {");
  if (earlyReturnIndex >= 0 && rpcIndex > earlyReturnIndex) {
    fail("the visibility RPC call sits BELOW the unified server-editable early-return, so it would never run (SC-3)");
  }
  if (!/Object\.keys\(currentPatch\)\.length === 0/.test(screen)) {
    fail("the Save dock no longer disables on an empty diff (SC-2)");
  }
  if (!/patch\.visibility === "private"/.test(screen)) {
    fail("the editor no longer refuses a Private selection before the RPC (SC-12)");
  }

  // ---- 5. The approved Private copy is verbatim ----------------------------
  if (!s.service.includes(PRIVATE_COPY)) {
    fail("the approved Private prerequisite copy is not present verbatim in businessEvents.ts (SC-12)");
  }

  // ---- 6. Nothing in the Business app writes events.visibility directly -----
  // Checked on comment-stripped sources so a commented-out example cannot trip
  // it and a real write cannot hide behind one.
  for (const [file, text] of Object.entries(s.businessSources)) {
    const src = stripJsComments(text);
    if (!/\.from\(\s*["'`]events["'`]\s*\)/.test(src)) continue;
    if (!/\bvisibility\s*:/.test(src)) continue;
    // An `.update({ ... visibility: ... })` against the events table is the
    // exact bypass the database now refuses; it must not exist in source either.
    const updateBlocks = src.match(/\.from\(\s*["'`]events["'`]\s*\)[\s\S]{0,400}?\.update\(\{[\s\S]{0,400}?\}\)/g) ?? [];
    for (const block of updateBlocks) {
      if (/\bvisibility\s*:/.test(block)) {
        fail(`${file} performs a direct events.visibility table update — the RPC is the only authority (SC-8)`);
      }
    }
  }

  // ---- 7. Admin compatibility copy already shipped with #1931 — verify, do
  //         not duplicate (Amendment 3 §3) ------------------------------------
  if (!s.adminService.includes("private_transition_requires_business")) {
    fail("mingla-admin/src/services/offeringsService.js lost the private_transition_requires_business mapping (SC-29)");
  }
};

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

const businessSources = {};
for (const f of walk(BUSINESS_SRC)) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  if (/__tests__|\.test\.tsx?$/.test(f)) continue;
  businessSources[f] = fs.readFileSync(f, "utf8");
}

const migrationRaw = readIf(MIGRATION);
const screenRaw = readIf(SCREEN);
const sources = {
  migration: migrationRaw,
  migrationNoComments: stripSqlComments(migrationRaw),
  migrationList: fs.existsSync("supabase/migrations")
    ? fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))
    : [],
  screen: screenRaw,
  screenNoComments: stripJsComments(screenRaw),
  service: readIf(SERVICE),
  adminService: readIf(ADMIN_SERVICE),
  businessSources,
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    {
      label: "M1 — the visibility key is dropped from the server-routable set (Save disables again)",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace("...ISSUE_2009_VISIBILITY_PATCH_KEYS,", ""),
      }),
    },
    {
      label: "M2 — ISSUE_2009_VISIBILITY_PATCH_KEYS no longer names `visibility`",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace(
          'const ISSUE_2009_VISIBILITY_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([\n  "visibility",\n]);',
          "const ISSUE_2009_VISIBILITY_PATCH_KEYS = new Set<keyof EditableLiveEventFields>([]);",
        ),
      }),
    },
    {
      label: "M3 — the RPC call is removed from the editor",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace("await setPublishedEventVisibility({", "await Promise.resolve({"),
      }),
    },
    {
      label: "M4 — the clean-state Save disable is reverted",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace("Object.keys(currentPatch).length === 0 ||", ""),
      }),
    },
    {
      label: "M5 — the client Private refusal is removed",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace('patch.visibility === "private"', "false"),
      }),
    },
    {
      label: "M6 — the approved Private copy is reworded",
      apply: (s) => ({ ...s, service: s.service.replace(PRIVATE_COPY, "Private is not available.") }),
    },
    {
      label: "M7 — the RPC is deleted from the migration",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "CREATE OR REPLACE FUNCTION public.business_set_event_visibility(",
          "CREATE OR REPLACE FUNCTION public.business_set_event_visibility_renamed_away(",
        ),
      }),
    },
    {
      label: "M8 — the direct-update guard trigger is removed",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace("CREATE TRIGGER issue_2009_events_visibility_guard", "-- removed"),
      }),
    },
    {
      label: "M9 — the effects coordinator trigger is removed",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace("CREATE TRIGGER issue_2009_events_visibility_effects", "-- removed"),
      }),
    },
    {
      label: "M10 — the Private fail-closed refusal is deleted from the SQL",
      apply: (s) => ({
        ...s,
        migration: s.migration.replaceAll("RAISE EXCEPTION 'private_visibility_unavailable'", "NULL"),
      }),
    },
    {
      label: "M11 — the Admin Private-boundary refusal is deleted",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace("RAISE EXCEPTION 'private_transition_requires_business'", "NULL"),
      }),
    },
    {
      label: "M12 — the exact revocation cardinality is replaced by a later scan",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace("GET DIAGNOSTICS v_revoked = ROW_COUNT", "v_revoked := 0"),
      }),
    },
    {
      label: "M13 — the abeyant `phase` column is smuggled onto the effects ledger",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "  transition_id                 uuid PRIMARY KEY,",
          "  transition_id                 uuid PRIMARY KEY,\n  phase                         text NOT NULL,",
        ),
      }),
    },
    {
      label: "M14 — the migration calls a frozen #1931 primitive",
      apply: (s) => ({
        ...s,
        migration: s.migration + "\nSELECT public.issue_1931_begin_enter_private(NULL,NULL,NULL);\n",
      }),
    },
    {
      label: "M15 — a Business source file calls a frozen #1931 primitive",
      apply: (s) => ({
        ...s,
        businessSources: {
          ...s.businessSources,
          "mingla-business/src/services/fake.ts": 'supabase.rpc("issue_1931_begin_enter_private", {});',
        },
      }),
    },
    {
      label: "M16 — a direct events.visibility table update is reintroduced",
      apply: (s) => ({
        ...s,
        businessSources: {
          ...s.businessSources,
          "mingla-business/src/services/fake.ts":
            'await supabase.from("events").update({ visibility: "hidden" }).eq("id", id);',
        },
      }),
    },
    {
      label: "M17 — the Admin copy mapping is removed",
      apply: (s) => ({
        ...s,
        adminService: s.adminService.replaceAll("private_transition_requires_business", "other_code"),
      }),
    },
    {
      label: "M18 — a second migration shares the #2009 timestamp prefix",
      apply: (s) => ({
        ...s,
        migrationList: [...s.migrationList, "20270418002009_issue_9999_other.sql"],
      }),
    },
    {
      label: "M19 — a second #2009 migration appears",
      apply: (s) => ({
        ...s,
        migrationList: [...s.migrationList, "20270419002009_issue_2009_extra.sql"],
      }),
    },
    {
      label: "COMMENT-FORGERY — the RPC call is deleted but a comment quotes it verbatim",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace(
          "await setPublishedEventVisibility({",
          "// await setPublishedEventVisibility({\n          await Promise.resolve({",
        ),
      }),
    },
    {
      label: "COMMENT-FORGERY — the SQL guard is deleted but a comment quotes its CREATE",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "CREATE TRIGGER issue_2009_events_visibility_guard",
          "-- CREATE TRIGGER issue_2009_events_visibility_guard\nCREATE TRIGGER issue_2009_renamed_away",
        ),
      }),
    },
  ];

  for (const mutation of mutations) {
    let mutated = mutation.apply(sources);
    // Derived views MUST be recomputed from the mutated raw source, or a
    // mutation would be graded against a stale normalisation.
    mutated = {
      ...mutated,
      migrationNoComments: stripSqlComments(mutated.migration),
      screenNoComments: stripJsComments(mutated.screen),
    };
    let rejected = false;
    try {
      check(mutated);
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`self-test mutation survived: ${mutation.label}`);
  }
  console.log(
    `issue-2009 published event visibility self-test: PASS — GOOD + ${mutations.length} BAD fixtures`,
  );
} else {
  check(sources);
  console.log("issue-2009 published event visibility: PASS");
}
