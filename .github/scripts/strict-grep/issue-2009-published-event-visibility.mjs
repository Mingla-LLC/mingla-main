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
// AMENDMENT 3A (#issuecomment-5317431821) — the two files the narrowed
// Amendment 3 §4 allowlist had omitted, restored for this pass only.
const AGENT_TOOLS = "supabase/functions/_shared/agentTools.ts";
const DISCOVER_CACHE = "supabase/functions/discover-merged-events/_cache.ts";
const DISCOVER_INDEX = "supabase/functions/discover-merged-events/index.ts";

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

  // ---- 8. AMENDMENT 3A Defect 1 — Ari's visibility write is ROUTED ---------
  // The behavioural proof is
  //   supabase/functions/_shared/__tests__/issue_2009_ari_visibility_via_rpc.test.ts
  //   supabase/migrations/__tests__/issue_2009_ari_visibility_rpc.pg17.test.sql
  // What this gate adds is the wiring those cannot see: that nobody reinstates
  // the direct column write that the database now refuses.
  const ari = s.agentToolsNoComments;
  if (ari === "") fail("supabase/functions/_shared/agentTools.ts is missing");
  if (!/\.rpc\(\s*["'`]business_set_event_visibility["'`]/.test(ari)) {
    fail("agentTools.ts no longer routes visibility through business_set_event_visibility — Ari's write returns event_visibility_direct_update_blocked (Defect 1)");
  }
  for (const block of ari.match(/\.from\(\s*["'`]events["'`]\s*\)[\s\S]{0,600}?\.update\(([\s\S]{0,400}?)\)/g) ?? []) {
    // The sparse non-visibility update passes an `updates` object by
    // reference; a literal `visibility:` inside an events update is the
    // regression. `updates.visibility = …` for a NON-'event' offering is
    // allowed and lives outside any `.update(` block.
    if (/\bvisibility\s*:/.test(block)) {
      fail("agentTools.ts performs a direct events.visibility table update — the RPC is the only authority (Defect 1)");
    }
  }
  if (!/VISIBILITY_CHANGE_MUST_BE_SEPARATE/.test(ari)) {
    fail("agentTools.ts lost the mixed-action refusal — a mixed call could partially execute (Amendment 1 §B.3)");
  }
  if (/SERVICE_ROLE|service_role/.test(ari)) {
    fail("agentTools.ts references a service-role credential — Ari is caller-JWT-only (I-ARI-USER-JWT-ONLY)");
  }
  if (/issue_1931_/.test(ari)) {
    fail("agentTools.ts calls an issue_1931_* primitive — out of scope for this pass (Amendment 3 §4)");
  }

  // ---- 9. AMENDMENT 3A Defect 2 — the discovery generation is threaded -----
  // Behavioural proof:
  //   supabase/functions/discover-merged-events/__tests__/issue_2009_discovery_generation_cache_key.test.ts
  const cache = s.discoverCacheNoComments;
  const index = s.discoverIndexNoComments;
  if (cache === "") fail("discover-merged-events/_cache.ts is missing");
  if (!/discoveryGeneration\??\s*:/.test(cache)) {
    fail("_cache.ts: DiscoverCacheParams no longer carries discoveryGeneration (SC-14/SC-15)");
  }
  if (!/gen:\s*p\.discoveryGeneration/.test(cache)) {
    fail("_cache.ts: buildDiscoverCacheKey no longer folds the generation into the key — an Unlisted event stays discoverable for the stale TTL (SC-14/SC-15)");
  }
  if (!/export function discoveryGenerationSlot/.test(cache)) {
    fail("_cache.ts lost discoveryGenerationSlot — the fail-closed rule has no single home (Amendment 3A)");
  }
  if (!/randomUUID/.test(cache)) {
    fail("_cache.ts: the unreadable-generation fallback is no longer per-call unique, so a failed read could be served a cached entry (fail-closed)");
  }
  // The TTLs are explicitly OUT of scope for this pass — a 'fix' that just
  // shortens the exposure window instead of keying on the generation is the
  // exact substitution Amendment 3A forbids.
  if (!/DISCOVER_MERGED_CACHE_TTL_MS["'`]\s*\)\s*\?\?\s*["'`]120000/.test(cache) ||
      !/DISCOVER_MERGED_STALE_MS["'`]\s*\)\s*\?\?\s*["'`]600000/.test(cache)) {
    fail("_cache.ts: a discover cache TTL default changed — TTLs are out of scope for this pass (Amendment 3A)");
  }
  // ---- 9b. AMENDMENT 3B Defect 3 — the generation read is BOUNDED -----------
  // Behavioural proof:
  //   supabase/functions/discover-merged-events/__tests__/issue_2009_generation_read_ceiling.test.ts
  //
  // Amendment 3A read the generation on EVERY request, above the L1 lookup, so
  // discovery — ORCH-426's hot path — took a database round-trip even on an L1
  // hit. 3B bounds the read to at most once per 5s per isolate. The ceiling is
  // a LITERAL CONSTANT on purpose: it must not be tunable into a large
  // staleness window, which is exactly how the 2-minute/10-minute hole existed.
  if (!/export const DISCOVER_GENERATION_TTL_MS\s*=\s*5000\s*;/.test(cache)) {
    fail(
      "_cache.ts: DISCOVER_GENERATION_TTL_MS is no longer the literal 5000 — the worst-case staleness after a visibility change changed with it (Amendment 3B Defect 3)",
    );
  }
  if (/DISCOVER_GENERATION_TTL_MS[^\n]*Deno\.env\.get/.test(cache)) {
    fail(
      "_cache.ts: the generation ceiling became environment-tunable — Amendment 3B forbids tuning it into a large staleness window",
    );
  }
  if (!/export async function resolveDiscoveryGenerationSlot/.test(cache)) {
    fail(
      "_cache.ts lost resolveDiscoveryGenerationSlot — the bounded read has no single home (Amendment 3B Defect 3)",
    );
  }
  // Fail closed: an unreadable generation must CLEAR the memo, never be
  // remembered. Remembering it would serve later requests an entry keyed on a
  // generation the isolate cannot confirm.
  if ((cache.match(/generationMemo\s*=\s*null\s*;/g) ?? []).length < 3) {
    fail(
      "_cache.ts: the generation memo is no longer cleared on every unreadable read — a failed read could be remembered and served (fail-closed, Amendment 3A/3B)",
    );
  }
  if (!/resolveDiscoveryGenerationSlot\(/.test(index)) {
    fail(
      "discover-merged-events/index.ts no longer resolves the generation through the bounded resolver — either the epoch is gone (Defect 2) or the read is unbounded again (Defect 3)",
    );
  }
  if (!/issue_2009_event_discovery_generation/.test(index)) {
    fail("discover-merged-events/index.ts no longer reads the discovery generation (Defect 2)");
  }
  const genReadIndex = index.indexOf("issue_2009_event_discovery_generation");
  const l1Index = index.indexOf("l1Get(cacheKey");
  if (l1Index >= 0 && genReadIndex > l1Index) {
    fail("discover-merged-events/index.ts reads the generation AFTER serving from L1 — the stale deck would go out first (Defect 2)");
  }
  if (!/discoveryGeneration,/.test(index)) {
    fail("discover-merged-events/index.ts no longer passes discoveryGeneration into DiscoverCacheParams (Defect 2)");
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
const agentToolsRaw = readIf(AGENT_TOOLS);
const discoverCacheRaw = readIf(DISCOVER_CACHE);
const discoverIndexRaw = readIf(DISCOVER_INDEX);
const sources = {
  agentTools: agentToolsRaw,
  agentToolsNoComments: stripJsComments(agentToolsRaw),
  discoverCache: discoverCacheRaw,
  discoverCacheNoComments: stripJsComments(discoverCacheRaw),
  discoverIndex: discoverIndexRaw,
  discoverIndexNoComments: stripJsComments(discoverIndexRaw),
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
    // ---- AMENDMENT 3A Defect 1 — Ari routing --------------------------------
    {
      label: "M20 — Ari stops routing through the RPC (the exact Defect 1 regression)",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools.replace(
          'client.rpc("business_set_event_visibility"',
          'client.rpc("some_other_rpc"',
        ),
      }),
    },
    {
      label: "M21 — a direct events.visibility table update is reintroduced into agentTools",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools +
          '\nawait client.from("events").update({ visibility: "hidden" }).eq("id", id);\n',
      }),
    },
    {
      label: "M22 — the mixed-action refusal is removed (a mixed call could partially execute)",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools.replaceAll("VISIBILITY_CHANGE_MUST_BE_SEPARATE", "SOMETHING_ELSE"),
      }),
    },
    {
      label: "M23 — Ari escalates to a service-role credential",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools + '\nconst k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");\n',
      }),
    },
    // ---- AMENDMENT 3A Defect 2 — discovery generation ----------------------
    {
      label: "M24 — the generation is dropped from the cache key (the exact Defect 2 regression)",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace("    gen: p.discoveryGeneration ?? null,\n", ""),
      }),
    },
    {
      label: "M25 — DiscoverCacheParams loses the generation field",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace("discoveryGeneration?: string;", ""),
      }),
    },
    {
      label: "M26 — the fail-closed fallback stops being per-call unique",
      apply: (s) => {
        const marker = "`${UNAVAILABLE_GENERATION_PREFIX}${crypto.randomUUID()}`";
        if (!s.discoverCache.includes(marker)) {
          throw new Error("M26 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverCache: s.discoverCache.replace(
            marker,
            '`${UNAVAILABLE_GENERATION_PREFIX}fixed`',
          ),
        };
      },
    },
    {
      label: "M27 — the exposure is 'fixed' by shortening a TTL instead of keying on the generation",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace('?? "600000"', '?? "5000"'),
      }),
    },
    {
      label: "M28 — the edge handler stops reading the generation",
      apply: (s) => ({
        ...s,
        discoverIndex: s.discoverIndex.replaceAll(
          "issue_2009_event_discovery_generation",
          "some_other_reader",
        ),
      }),
    },
    {
      label: "M29 — the generation is read AFTER the L1 serve, so the stale deck goes out first",
      apply: (s) => {
        const marker =
          '    async () => await supabase.rpc("issue_2009_event_discovery_generation"),';
        if (!s.discoverIndex.includes(marker)) {
          throw new Error("M29 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverIndex: s.discoverIndex.replace(marker, "    async () => await supabase.rpc(\"noop\"),") +
            "\n" + marker + "\n",
        };
      },
    },
    {
      label: "M30 — the slot is built but never threaded into DiscoverCacheParams",
      apply: (s) => ({
        ...s,
        discoverIndex: s.discoverIndex.replace("    discoveryGeneration,\n", ""),
      }),
    },
    // ---- AMENDMENT 3B Defect 3 — the bounded generation read ---------------
    {
      label: "M31 — the ceiling becomes environment-tunable (a large staleness window is reachable again)",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace(
          "export const DISCOVER_GENERATION_TTL_MS = 5000;",
          'export const DISCOVER_GENERATION_TTL_MS = Number(Deno.env.get("DISCOVER_GENERATION_TTL_MS") ?? "5000");',
        ),
      }),
    },
    {
      label: "M32 — the ceiling is quietly raised past 5s",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace(
          "export const DISCOVER_GENERATION_TTL_MS = 5000;",
          "export const DISCOVER_GENERATION_TTL_MS = 600000;",
        ),
      }),
    },
    {
      label: "M33 — a failed generation read is REMEMBERED instead of failing closed",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replaceAll("    generationMemo = null;\n", ""),
      }),
    },
    {
      label: "M34 — the bounded resolver is removed and the edge handler reads unbounded again (the exact Defect 3 regression)",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace(
          "export async function resolveDiscoveryGenerationSlot",
          "async function unboundedGenerationRead",
        ),
        discoverIndex: s.discoverIndex.replace(
          "await resolveDiscoveryGenerationSlot(",
          "await unboundedGenerationRead(",
        ),
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
      agentToolsNoComments: stripJsComments(mutated.agentTools),
      discoverCacheNoComments: stripJsComments(mutated.discoverCache),
      discoverIndexNoComments: stripJsComments(mutated.discoverIndex),
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
