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
const DISCOVER_MEMORY = "supabase/functions/discover-merged-events/_memory-cache.ts";
// AMENDMENT 3C (#issuecomment-5318285509) — the one-file allowlist delta, for
// the build-lock and L2-write identity only.
const DISCOVER_RESOLVE = "supabase/functions/discover-merged-events/_resolve-entry.ts";

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
  // The memo SHORT-CIRCUIT is the bound. Without it the resolver still exists,
  // still fails closed and still returns the right slot — it just reads the
  // database every single time again, which is Defect 3 exactly. Deleting it is
  // the one revert the behavioural suite catches and every other pin here
  // misses, so it gets its own pin (fixture M35).
  if (
    !/now\s*-\s*memo\.readAt\s*<\s*DISCOVER_GENERATION_TTL_MS/.test(cache) ||
    !/return memo\.slot;/.test(cache)
  ) {
    fail(
      "_cache.ts: the generation memo short-circuit is gone — every discover request pays a database round-trip again, in front of L1 (Amendment 3B Defect 3)",
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

  // ---- 10. PASS-1 TEST REPORT P1-1 — the guard's ENABLING CONDITIONS -------
  // Behavioural proof:
  //   supabase/migrations/__tests__/issue_2009_visibility_scope_rework.pg17.test.sql
  //   supabase/migrations/__tests__/issue_2009_visibility_guard_bypass.tester_adversarial.pg17.test.sql
  //
  // The pass-1 guard was `BEFORE UPDATE OF visibility` scoped to
  // `event_type='event'`, and BOTH conditions were steppable: a statement that
  // did not NAME visibility never fired the trigger, and a row retyped out of
  // 'event' fell out of scope entirely. Three ordinary PostgREST PATCHes walked
  // a standard event into Private with no audit row, no effect row and the
  // discovery generation unmoved. Every pin below is a condition the bypass
  // needed; none of them is satisfiable by a comment (the migration is
  // comment-stripped before it gets here).
  const mig = s.migrationNoComments;
  if (
    !/CREATE TRIGGER issue_2009_events_visibility_guard\s+BEFORE UPDATE OF visibility,\s*event_type ON public\.events/
      .test(mig)
  ) {
    fail(
      "the write guard's column list no longer names `event_type` — a PATCH that retypes the row never fires it, and the whole laundering bypass reopens (P1-1)",
    );
  }
  if (
    !/CREATE TRIGGER issue_2009_events_visibility_effects\s+AFTER UPDATE OF visibility,\s*event_type ON public\.events/
      .test(mig)
  ) {
    fail(
      "the effects coordinator's column list no longer names `event_type` — the discoverable set could move with the discovery generation standing still (P1-1, SC-14/SC-15)",
    );
  }
  // The guard must still be able to tell "this row crossed the standard-event
  // class boundary" apart from "this row's visibility changed". If it collapses
  // back to a plain visibility diff, an arrival leg is invisible again.
  // BOTH trigger functions must do it — the guard AND the effects coordinator.
  // If only one does, the two disagree about what a transition is, which is how
  // a change can land with the generation standing still.
  const oldSideChecks =
    (mig.match(/v_was_standard\s+boolean\s*:=\s*\(OLD\.event_type IS NOT DISTINCT FROM 'event'\)/g) ??
      []).length;
  const newSideChecks =
    (mig.match(/v_is_standard\s+boolean\s*:=\s*\(NEW\.event_type IS NOT DISTINCT FROM 'event'\)/g) ??
      []).length;
  if (oldSideChecks < 2 || newSideChecks < 2) {
    fail(
      "the write guard and the effects coordinator no longer BOTH evaluate the standard-event class on both sides of the row — the scope becomes steppable by retyping again, or the two triggers disagree about what a transition is (P1-1)",
    );
  }
  if (
    !/NEW\.visibility = 'private'\s*AND \(OLD\.visibility IS DISTINCT FROM 'private' OR v_class_moved\)/
      .test(mig)
  ) {
    fail(
      "the Private ENTRY test no longer treats a class crossing as an entry — `rsvp`+`private` retyped to `event` would land in Private again (P1-1 / P2-3)",
    );
  }
  // P2-3: the pass-1 clause refused BOTH directions, which stranded any row
  // already at Private. That exact predicate must not come back.
  if (/'private' IN \(OLD\.visibility, NEW\.visibility\)/.test(mig)) {
    fail(
      "the write guard refuses BOTH Private directions again — a standard event already at Private would have no supported exit (P2-3)",
    );
  }
  // ---- 10b. P2-1 — the same boundary on the INSERT path --------------------
  if (
    !/CREATE TRIGGER issue_2009_events_visibility_insert_guard\s+BEFORE INSERT ON public\.events/
      .test(mig)
  ) {
    fail(
      "the BEFORE INSERT Private guard is gone — an authenticated INSERT can create a standard ticketed event straight at Private (P2-1)",
    );
  }
  if (
    !/CREATE OR REPLACE FUNCTION public\.issue_2009_event_visibility_insert_guard\b/.test(mig)
  ) {
    fail("the INSERT guard function is missing (P2-1)");
  }
  // ---- 10c. P2-3 — Admin refuses ENTRY only, so the exit stays open --------
  if (
    !/\(v_before->>'event_type'\) = 'event'\s*AND p_visibility = 'private'\s*AND \(v_before->>'visibility'\) IS DISTINCT FROM 'private'/
      .test(mig)
  ) {
    fail(
      "admin_set_offering_visibility no longer refuses ENTRY-only — either Private became enterable, or the exit was closed again and a Private standard event is stranded (P2-3)",
    );
  }
  if (/p_visibility = 'private' OR \(v_before->>'visibility'\) = 'private'/.test(mig)) {
    fail(
      "admin_set_offering_visibility refuses BOTH Private directions again — the stranded-row defect returns (P2-3)",
    );
  }

  // ---- 11. PASS-1 TEST REPORT P1-2 — fail-closed must not dissolve ---------
  //         request coalescing.
  // Behavioural proof:
  //   supabase/functions/discover-merged-events/__tests__/issue_2009_failclosed_coalescing.rework.test.ts
  //   supabase/functions/discover-merged-events/__tests__/issue_2009_generation_failclosed_herd.tester_adversarial.test.ts
  //
  // `cacheKey` was doing two jobs: the SERVE namespace (which must be unique
  // when the generation is unreadable, so nothing stale is servable) and the
  // COALESCING namespace (which must be shared, or every request builds). The
  // fix separates them. What this gate adds is that nobody quietly re-merges
  // them — in EITHER direction.
  const memory = s.discoverMemoryNoComments;
  if (memory === "") fail("discover-merged-events/_memory-cache.ts is missing");
  if (!/export function discoverBuildCoalesceKey/.test(cache)) {
    fail(
      "_cache.ts lost discoverBuildCoalesceKey — the fail-closed coalescing namespace has no single home (P1-2)",
    );
  }
  if (!/UNAVAILABLE_GENERATION_COALESCE_SLOT/.test(cache)) {
    fail("_cache.ts lost the shared fail-closed coalescing slot (P1-2)");
  }
  if (!/discoverBuildCoalesceKey/.test(memory)) {
    fail(
      "_memory-cache.ts no longer collapses the fail-closed namespace — an unreadable generation turns one build per key into one build per REQUEST, and ORCH-426's overload protection is gone at the moment it is needed most (P1-2)",
    );
  }
  if (
    !/const flightKey = discoverBuildCoalesceKey\(key\);/.test(memory) ||
    !/inflight\.get\(flightKey\)/.test(memory) ||
    !/inflight\.delete\(flightKey\)/.test(memory) ||
    !/inflight\.set\(flightKey, promise\)/.test(memory)
  ) {
    fail(
      "coalesceDiscoverBuild no longer single-flights on the collapsed namespace — the herd stops coalescing, or the slot is never released (P1-2)",
    );
  }
  if (!/inflight\.has\(discoverBuildCoalesceKey\(key\)\)/.test(memory)) {
    fail(
      "refreshDiscoverInBackground no longer checks the collapsed namespace — the stampede simply moves to the stale-while-revalidate path (P1-2)",
    );
  }
  // ...and the SERVE side must stay unique. `l1SetBytes` storing under the
  // collapsed namespace would make a fail-closed response servable, which is the
  // privacy trade the amendment forbids.
  if (
    /\bl1\.(set|get|delete)\(\s*discoverBuildCoalesceKey/.test(memory) ||
    /\bl1(Set|Get)[A-Za-z]*\(\s*discoverBuildCoalesceKey/.test(memory)
  ) {
    fail(
      "the L1 store/lookup is keyed on the COLLAPSED namespace — a response built while the generation was unreadable would become servable to later requests (fail-closed, P1-2)",
    );
  }

  // ---- 11b. AMENDMENT 3C Defect 5 — the SAME separation, one layer down ----
  // Behavioural proof:
  //   supabase/functions/discover-merged-events/__tests__/issue_2009_failclosed_cross_isolate.rework.test.ts
  //     — 12 requests in 12 REAL Deno Worker isolates against one modelled
  //       database: 1 build and 0 cache rows with the fix, 12 and 12 without.
  //
  // 3B collapsed the ISOLATE-LOCAL single-flight map (section 11 above).
  // `_resolve-entry.ts` still handed the per-call-unique cache key to the
  // CROSS-ISOLATE build lock and to the L2 write, so N isolates still ran N
  // builds and wrote N rows nothing could ever read. What this gate adds is
  // that the two identities do not silently re-merge in EITHER direction: the
  // lock must stay on the coalescing key, and the SERVE side (L1, the L2 read,
  // the L2 write) must stay on the cache key.
  const resolve = s.discoverResolveNoComments;
  if (resolve === "") fail("discover-merged-events/_resolve-entry.ts is missing");
  if (!/import \{[^}]*discoverBuildCoalesceKey[^}]*\} from "\.\/_cache\.ts";/.test(resolve)) {
    fail(
      "_resolve-entry.ts no longer imports discoverBuildCoalesceKey — the distributed build lock has no coalescing namespace and every fail-closed isolate builds its own deck (Amendment 3C Defect 5)",
    );
  }
  // The identity must be DERIVED from the one shared normaliser, not re-tested
  // against a second copy of the fail-closed rule (which could drift, or be
  // pinned true/false and make the guards below vacuous — #2113).
  if (
    !/const buildKey = discoverBuildCoalesceKey\(cacheKey\);/.test(resolve) ||
    !/uncacheable: buildKey !== cacheKey/.test(resolve)
  ) {
    fail(
      "_resolve-entry.ts no longer derives `uncacheable` from discoverBuildCoalesceKey — either the fail-closed rule now has two definitions that can drift apart, or the flag is pinned and every guard below it is vacuous (Amendment 3C Defect 5)",
    );
  }
  // BOTH lock attempts, and the release, on the COALESCING key.
  //
  // ORDER MATTERS HERE (#2113). The RAW-key check runs BEFORE the count check,
  // because the raw-key check is the one that names the actual Defect 5
  // regression. With the cheaper count check first it would fire on every
  // realistic mutation and the raw-key branch would be a line no fixture ever
  // reaches — a check carrying no information. The self-test asserts the
  // attribution: M55/M56 must reach this branch, M56b must reach the count.
  if (/tryDistributedBuildLock\(\s*supabase,\s*cacheKey/.test(resolve)) {
    fail(
      "_resolve-entry.ts takes the distributed build lock on the RAW per-call-unique cache key — every fail-closed isolate wins its own lock, so N concurrent requests are N independent database builds on the consumer app's hottest path (Amendment 3C Defect 5)",
    );
  }
  const lockOnBuildKey = (resolve.match(/tryDistributedBuildLock\(supabase, buildKey\)/g) ?? []).length;
  if (lockOnBuildKey < 2) {
    fail(
      `_resolve-entry.ts takes the distributed build lock on the coalescing key only ${lockOnBuildKey} time(s) — both attempts must, or a fail-closed herd re-splits at the retry (Amendment 3C Defect 5)`,
    );
  }
  if (!/releaseDistributedBuildLock\(supabase, buildKey\)/.test(resolve)) {
    fail(
      "_resolve-entry.ts no longer releases the distributed build lock on the coalescing key — the lock it took is never freed and discovery stays unavailable for the whole lock TTL (Amendment 3C Defect 5)",
    );
  }
  const writeCalls = (resolve.match(/await writeDbDiscoverCache\(/g) ?? []).length;
  if (writeCalls !== 1) {
    fail(
      `_resolve-entry.ts calls writeDbDiscoverCache ${writeCalls} time(s); exactly one guarded call is expected (Amendment 3C Defect 5)`,
    );
  }
  // The SERVE side must stay on the CACHE key. Any of these would make a
  // response built while the generation was unreadable servable to a later
  // request, which is the privacy trade every amendment in this chain forbids.
  // Checked BEFORE the guard shape below, so a redirect to the collapsed
  // namespace is reported as what it is rather than as a missing guard.
  for (
    const [re, what] of [
      [/readDbDiscoverCacheGzip\(\s*supabase,\s*buildKey/, "the L2 read"],
      [/waitForDbDiscoverCacheGzip\(\s*supabase,\s*buildKey/, "the L2 poll"],
      [/writeDbDiscoverCache\(\s*supabase,\s*buildKey/, "the L2 write"],
      [/l1SetBytes\(\s*buildKey/, "the L1 store"],
      [/entryFromDbGzip\(\s*buildKey/, "the L1 store"],
    ]
  ) {
    if (re.test(resolve)) {
      fail(
        `_resolve-entry.ts points ${what} at the COLLAPSED namespace — a deck built while the generation was unreadable becomes servable to later requests, which is exactly the stale-privacy read #2009 exists to close (Amendment 3C)`,
      );
    }
  }
  // The L2 write is GUARDED, and still writes on the healthy path.
  if (
    !/if \(!uncacheable\) \{\s*await writeDbDiscoverCache\(supabase, cacheKey, built, discoverStaleExpiresAt, bytes\);\s*\}/
      .test(resolve)
  ) {
    fail(
      "_resolve-entry.ts writes the L2 cache row unconditionally — a fail-closed build upserts a row keyed on a per-call uuid that nothing can ever read, so discover_merged_events_cache accumulates permanent garbage exactly when the database can least absorb it (Amendment 3C Defect 5)",
    );
  }
  // The fail-closed loser sheds IMMEDIATELY: before any poll for a row that,
  // by the guard above, will never be published.
  const shedIndex = resolve.indexOf("if (uncacheable) {");
  const firstWaitIndex = resolve.indexOf("waitForDbDiscoverCacheGzip(supabase, cacheKey)");
  if (shedIndex < 0) {
    fail(
      "_resolve-entry.ts no longer sheds a fail-closed lock loser — it falls through to the wait path and polls the database 250 more times for a row that cannot exist (Amendment 3C Defect 5)",
    );
  }
  if (firstWaitIndex >= 0 && shedIndex > firstWaitIndex) {
    fail(
      "_resolve-entry.ts sheds the fail-closed lock loser only AFTER the 20s poll — the amplification moves from builds to polls instead of degrading (Amendment 3C Defect 5)",
    );
  }

  // ---- 12. PASS-1 TEST REPORT P2-2 — one code, two directions --------------
  // Behavioural proof:
  //   mingla-business/src/services/__tests__/businessEventVisibilityExitCopy.issue2009.rework.test.ts
  //   supabase/functions/_shared/__tests__/issue_2009_private_exit_copy.rework.test.ts
  if (!/export const issue2009VisibilityErrorCopyForLeg/.test(s.service)) {
    fail(
      "businessEvents.ts lost the leg-aware copy map — an organiser LEAVING Private is told to 'Choose Public or Unlisted', which is what they just tried (P2-2)",
    );
  }
  if (!/ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY/.test(s.service)) {
    fail("businessEvents.ts lost the exit-leg Private copy (P2-2)");
  }
  // The two sentences must actually differ. A "split" that maps both legs to
  // the same string is the vacuous shape this whole rework exists to reject.
  const exitCopy = /export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY\s*=\s*\n?\s*"([^"]+)"/
    .exec(s.service)?.[1];
  if (!exitCopy) fail("could not read the exit-leg Private copy out of businessEvents.ts (P2-2)");
  if (exitCopy === PRIVATE_COPY) {
    fail("the exit-leg Private copy is identical to the entering copy — the split is vacuous (P2-2)");
  }
  if (/Choose Public or Unlisted/i.test(exitCopy)) {
    fail(
      "the exit-leg Private copy still tells the organiser to choose Public or Unlisted — that is the sentence P2-2 reported as wrong (P2-2)",
    );
  }
  if (!/issue2009VisibilityErrorCopyForLeg\(\s*code,\s*liveEvent\.visibility\s*\)/.test(screen)) {
    fail(
      "EditPublishedScreen no longer tells the copy map which leg the refusal came from, so both legs read the same again (P2-2)",
    );
  }
  // Ari's half: the same direction must reach its copy mapper.
  if (!/issue2009VisibilityToolError\(error, target\.visibility\)/.test(ari)) {
    fail(
      "agentTools.ts no longer passes the event's current visibility to the #2009 copy mapper — Ari says the entering sentence on the exit leg (P2-2)",
    );
  }
  if (!ari.includes(PRIVATE_COPY)) {
    fail(
      "agentTools.ts lost the approved entering-Private copy verbatim — the P2-2 split may only ADD the exit sentence, never reword the approved one (P2-2)",
    );
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
const discoverMemoryRaw = readIf(DISCOVER_MEMORY);
const discoverResolveRaw = readIf(DISCOVER_RESOLVE);
const sources = {
  discoverResolve: discoverResolveRaw,
  discoverResolveNoComments: stripJsComments(discoverResolveRaw),
  agentTools: agentToolsRaw,
  agentToolsNoComments: stripJsComments(agentToolsRaw),
  discoverCache: discoverCacheRaw,
  discoverCacheNoComments: stripJsComments(discoverCacheRaw),
  discoverIndex: discoverIndexRaw,
  discoverIndexNoComments: stripJsComments(discoverIndexRaw),
  discoverMemory: discoverMemoryRaw,
  discoverMemoryNoComments: stripJsComments(discoverMemoryRaw),
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
      label:
        "M35 — the memo short-circuit is deleted, so the generation is read on EVERY request again (the exact Defect 3 regression, and the fails-on-revert this pass performed)",
      apply: (s) => {
        const block = `  const memo = generationMemo;
  if (
    memo !== null && now >= memo.readAt &&
    now - memo.readAt < DISCOVER_GENERATION_TTL_MS
  ) {
    return memo.slot;
  }

`;
        if (!s.discoverCache.includes(block)) {
          throw new Error("M35 fixture marker drifted — update it, do not let it no-op");
        }
        return { ...s, discoverCache: s.discoverCache.replace(block, "") };
      },
    },
    // ---- PASS-1 TEST REPORT P1-1 — the guard's enabling conditions --------
    {
      label:
        "M36 — the write guard's column list drops `event_type` (the EXACT P1-1 bypass: a PATCH that retypes the row never fires the trigger)",
      apply: (s) => {
        const marker = "  BEFORE UPDATE OF visibility, event_type ON public.events\n" +
          "  FOR EACH ROW EXECUTE FUNCTION public.issue_2009_event_visibility_write_guard();";
        if (!s.migration.includes(marker)) {
          throw new Error("M36 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          migration: s.migration.replace(
            marker,
            "  BEFORE UPDATE OF visibility ON public.events\n" +
              "  FOR EACH ROW EXECUTE FUNCTION public.issue_2009_event_visibility_write_guard();",
          ),
        };
      },
    },
    {
      label:
        "M37 — the effects coordinator's column list drops `event_type` (the discoverable set moves with the generation standing still)",
      apply: (s) => {
        const marker = "  AFTER UPDATE OF visibility, event_type ON public.events";
        if (!s.migration.includes(marker)) {
          throw new Error("M37 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          migration: s.migration.replace(marker, "  AFTER UPDATE OF visibility ON public.events"),
        };
      },
    },
    {
      label: "M38 — the guard stops evaluating the standard-event class on both sides of the row",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "  v_was_standard boolean := (OLD.event_type IS NOT DISTINCT FROM 'event');",
          "  v_was_standard boolean := true;",
        ),
      }),
    },
    {
      label:
        "M39 — a class crossing stops counting as a Private ENTRY, so `rsvp`+`private` retyped to `event` lands in Private again",
      apply: (s) => {
        const marker =
          "  IF NEW.visibility = 'private'\n     AND (OLD.visibility IS DISTINCT FROM 'private' OR v_class_moved) THEN";
        if (!s.migration.includes(marker)) {
          throw new Error("M39 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          migration: s.migration.replace(
            marker,
            "  IF NEW.visibility = 'private'\n     AND OLD.visibility IS DISTINCT FROM 'private' THEN",
          ),
        };
      },
    },
    {
      label: "M40 — the pass-1 both-directions Private refusal is restored (P2-3 strands the row again)",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "  IF NEW.visibility = 'private'\n     AND (OLD.visibility IS DISTINCT FROM 'private' OR v_class_moved) THEN",
          "  IF 'private' IN (OLD.visibility, NEW.visibility) THEN",
        ),
      }),
    },
    // ---- PASS-1 TEST REPORT P2-1 — the INSERT path ------------------------
    {
      label: "M41 — the BEFORE INSERT Private guard trigger is removed (the exact P2-1 defect)",
      apply: (s) => ({
        ...s,
        migration: s.migration.replace(
          "CREATE TRIGGER issue_2009_events_visibility_insert_guard",
          "-- removed",
        ),
      }),
    },
    {
      label: "M42 — the INSERT guard function is renamed away, leaving the trigger dangling",
      apply: (s) => ({
        ...s,
        migration: s.migration.replaceAll(
          "public.issue_2009_event_visibility_insert_guard",
          "public.issue_2009_event_visibility_insert_guard_renamed",
        ),
      }),
    },
    // ---- PASS-1 TEST REPORT P2-3 — Admin keeps the exit open ---------------
    {
      label: "M43 — Admin refuses BOTH Private directions again, stranding an already-private event",
      apply: (s) => {
        const marker = "     AND p_visibility = 'private'\n" +
          "     AND (v_before->>'visibility') IS DISTINCT FROM 'private' THEN";
        if (!s.migration.includes(marker)) {
          throw new Error("M43 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          migration: s.migration.replace(
            marker,
            "     AND (p_visibility = 'private' OR (v_before->>'visibility') = 'private')\n" +
              "     AND p_visibility IS DISTINCT FROM (v_before->>'visibility') THEN",
          ),
        };
      },
    },
    // ---- PASS-1 TEST REPORT P1-2 — fail-closed coalescing ------------------
    {
      label:
        "M44 — the single-flight map goes back to the raw cache key (the EXACT P1-2 defect: 12 concurrent requests, 12 builds)",
      apply: (s) => ({
        ...s,
        discoverMemory: s.discoverMemory.replace(
          "  const flightKey = discoverBuildCoalesceKey(key);",
          "  const flightKey = key;",
        ),
      }),
    },
    {
      label: "M45 — the collapsed in-flight slot is never released, wedging every later fail-closed request",
      apply: (s) => ({
        ...s,
        discoverMemory: s.discoverMemory.replace("    inflight.delete(flightKey);", ""),
      }),
    },
    {
      label: "M46 — the SWR refresh path stops honouring the collapsed namespace, so the stampede moves there",
      apply: (s) => ({
        ...s,
        discoverMemory: s.discoverMemory.replace(
          "  if (inflight.has(discoverBuildCoalesceKey(key))) return;",
          "  if (inflight.has(key)) return;",
        ),
      }),
    },
    {
      label: "M47 — the coalescing normaliser is removed from _cache.ts entirely",
      apply: (s) => ({
        ...s,
        discoverCache: s.discoverCache.replace(
          "export function discoverBuildCoalesceKey",
          "function unexportedCoalesceKey",
        ),
      }),
    },
    {
      label:
        "M48 — L1 is keyed on the COLLAPSED namespace, making a fail-closed response servable (the privacy trade the amendment forbids)",
      apply: (s) => ({
        ...s,
        discoverMemory: s.discoverMemory.replace(
          "  l1.set(key, entry);",
          "  l1.set(discoverBuildCoalesceKey(key), entry);",
        ),
      }),
    },
    // ---- AMENDMENT 3C Defect 5 — the cross-isolate half of the separation --
    {
      label:
        "M55 — the DISTRIBUTED build lock goes back to the raw cache key (the EXACT Defect 5 regression: 12 isolates, 12 builds)",
      apply: (s) => {
        const marker = "  let holdsLock = await tryDistributedBuildLock(supabase, buildKey);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M55 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "  let holdsLock = await tryDistributedBuildLock(supabase, cacheKey);",
          ),
        };
      },
    },
    {
      label:
        "M56 — only the FIRST lock attempt is collapsed; the retry re-splits the fail-closed herd",
      apply: (s) => {
        const marker = "    holdsLock = await tryDistributedBuildLock(supabase, buildKey);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M56 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "    holdsLock = await tryDistributedBuildLock(supabase, cacheKey);",
          ),
        };
      },
    },
    {
      label:
        "M56b — the retry lock attempt is DELETED outright, so only one of the two is collapsed (exercises the count pin, which M55/M56 reach the raw-key pin before)",
      apply: (s) => {
        const marker = "    holdsLock = await tryDistributedBuildLock(supabase, buildKey);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M56b fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(marker, "    holdsLock = false;"),
        };
      },
    },
    {
      label: "M57 — the lock is taken on the coalescing key but never released, wedging discovery",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "await releaseDistributedBuildLock(supabase, buildKey);",
          "void 0;",
        ),
      }),
    },
    {
      label:
        "M58 — the L2 write guard is deleted, so every fail-closed build upserts a row nothing can ever read",
      apply: (s) => {
        const marker = `    if (!uncacheable) {
      await writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt, bytes);
    }`;
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M58 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "    await writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt, bytes);",
          ),
        };
      },
    },
    {
      label:
        "M59 — the L2 write is redirected to the COLLAPSED namespace, making a fail-closed deck servable (the privacy trade)",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "await writeDbDiscoverCache(supabase, cacheKey, built, discoverStaleExpiresAt, bytes);",
          "await writeDbDiscoverCache(supabase, buildKey, built, discoverStaleExpiresAt, bytes);",
        ),
      }),
    },
    {
      label:
        "M60 — L1 in the resolver is keyed on the COLLAPSED namespace, so a later fail-closed request reads a deck built under an unconfirmed generation",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "    return l1SetBytes(cacheKey, bytes, cached, now);",
          "    return l1SetBytes(buildKey, bytes, cached, now);",
        ),
      }),
    },
    {
      label:
        "M61 — the fail-closed lock loser stops shedding and falls through to a 20s poll for a row that cannot exist",
      apply: (s) => {
        const marker = `    if (uncacheable) {
      throw new DiscoverOverloadedError();
    }`;
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M61 fixture marker drifted — update it, do not let it no-op");
        }
        return { ...s, discoverResolve: s.discoverResolve.replace(marker, "") };
      },
    },
    {
      label:
        "M62 — `uncacheable` is pinned false: both guards survive as SOURCE TEXT but neither can ever fire (#2113)",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "return { buildKey, uncacheable: buildKey !== cacheKey };",
          "return { buildKey, uncacheable: false };",
        ),
      }),
    },
    {
      label:
        "M63 — `uncacheable` is pinned true: over-broad, the HEALTHY path stops publishing an L2 row at all",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "return { buildKey, uncacheable: buildKey !== cacheKey };",
          "return { buildKey, uncacheable: true };",
        ),
      }),
    },
    {
      label:
        "M65 — the L2 READ is redirected to the COLLAPSED namespace, so a fail-closed request is served a deck built under a generation nobody confirmed",
      apply: (s) => {
        const marker = "  const dbBytes = await readDbDiscoverCacheGzip(supabase, cacheKey);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M65 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "  const dbBytes = await readDbDiscoverCacheGzip(supabase, buildKey);",
          ),
        };
      },
    },
    {
      label: "M66 — the 20s L2 POLL is redirected to the COLLAPSED namespace (the same read, one branch over)",
      apply: (s) => {
        const marker = "await waitForDbDiscoverCacheGzip(supabase, cacheKey);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M66 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "await waitForDbDiscoverCacheGzip(supabase, buildKey);",
          ),
        };
      },
    },
    {
      label: "M67 — the L1 entry built from an L2 hit is stored under the COLLAPSED namespace",
      apply: (s) => {
        const marker = "    return entryFromDbGzip(cacheKey, dbBytes, now);";
        if (!s.discoverResolve.includes(marker)) {
          throw new Error("M67 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(
            marker,
            "    return entryFromDbGzip(buildKey, dbBytes, now);",
          ),
        };
      },
    },
    {
      label:
        "M68 — the fail-closed shed is MOVED BELOW the 20s poll: still present as source text, but the amplification has merely moved from builds to polls",
      apply: (s) => {
        const shed = `    if (uncacheable) {
      throw new DiscoverOverloadedError();
    }

`;
        const retry = "    holdsLock = await tryDistributedBuildLock(supabase, buildKey);";
        if (!s.discoverResolve.includes(shed) || !s.discoverResolve.includes(retry)) {
          throw new Error("M68 fixture marker drifted — update it, do not let it no-op");
        }
        return {
          ...s,
          discoverResolve: s.discoverResolve.replace(shed, "").replace(retry, shed + retry),
        };
      },
    },
    {
      label: "M64 — the coalescing normaliser is no longer imported into the resolver at all",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          'import { discoverBuildCoalesceKey, discoverStaleExpiresAt } from "./_cache.ts";',
          'import { discoverStaleExpiresAt } from "./_cache.ts";',
        ),
      }),
    },
    {
      label:
        "COMMENT-FORGERY — the distributed lock reverts to the raw cache key while a comment quotes the buildKey call verbatim",
      apply: (s) => ({
        ...s,
        discoverResolve: s.discoverResolve.replace(
          "  let holdsLock = await tryDistributedBuildLock(supabase, buildKey);",
          "  // let holdsLock = await tryDistributedBuildLock(supabase, buildKey);\n" +
            "  let holdsLock = await tryDistributedBuildLock(supabase, cacheKey);",
        ),
      }),
    },
    // ---- PASS-1 TEST REPORT P2-2 — one code, two directions ----------------
    {
      label: "M49 — the leg-aware copy map is removed, so both Private directions read the same again",
      apply: (s) => ({
        ...s,
        service: s.service.replace(
          "export const issue2009VisibilityErrorCopyForLeg",
          "const unexportedLegCopy",
        ),
      }),
    },
    {
      label: "M50 — the 'split' maps the exit leg to the entering sentence (a vacuous fix)",
      apply: (s) => ({
        ...s,
        service: s.service.replace(
          /export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY\s*=\s*\n?\s*"[^"]+";/,
          `export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY =\n  "${PRIVATE_COPY}";`,
        ),
      }),
    },
    {
      label: "M51 — the exit sentence still says 'Choose Public or Unlisted', the exact reported wrongness",
      apply: (s) => ({
        ...s,
        service: s.service.replace(
          /export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY\s*=\s*\n?\s*"[^"]+";/,
          'export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY =\n  "This event is Private. Choose Public or Unlisted for now.";',
        ),
      }),
    },
    {
      label: "M52 — the editor stops telling the copy map which leg the refusal came from",
      apply: (s) => ({
        ...s,
        screen: s.screen.replace(
          "issue2009VisibilityErrorCopyForLeg(code, liveEvent.visibility)",
          "issue2009VisibilityErrorCopyForLeg(code, null)",
        ),
      }),
    },
    {
      label: "M53 — Ari stops passing the event's current visibility to the copy mapper",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools.replace(
          "issue2009VisibilityToolError(error, target.visibility)",
          "issue2009VisibilityToolError(error)",
        ),
      }),
    },
    {
      label: "M54 — the split reworded Ari's APPROVED entering copy instead of only adding the exit one",
      apply: (s) => ({
        ...s,
        agentTools: s.agentTools.replace(PRIVATE_COPY, "Private is not available yet."),
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
      discoverMemoryNoComments: stripJsComments(mutated.discoverMemory),
      discoverResolveNoComments: stripJsComments(mutated.discoverResolve),
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
