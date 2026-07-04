#!/usr/bin/env node
/**
 * META-ORCH-1290 [venue authoring: consumer-facing pitch] —
 * I-PROPOSED-1290-PITCH-CONSUMER-FACING.
 *
 * RULE (D-6): the owner-authored pitch (place_pool.generative_summary) is
 * surfaced to consumers via BOTH deck + public surfaces:
 *   (a) discover-cards maps generative_summary → the card `description` blurb.
 *   (b) the M2 migration adds `pp.generative_summary` to BOTH servable RPCs
 *       (query_servable_places_by_signal + ..._intersection).
 *   (c) the venue_public_view migration exposes generative_summary (as `pitch`).
 * Reverting D-6 (restoring `description: ''`, or dropping the column from a RPC
 * or the view) hides the pitch from consumers.
 *
 * META-ORCH-1290 D-6: the pitch is consumer-facing on the swipe card + public
 * page — reverting hides the owner-authored pitch.
 *
 * `--self-test`: GOOD/BAD fixtures for each of (a)/(b)/(c). Reverting any arm FAILS.
 *
 * DRAFT until CLOSE (orchestrator flips I-PROPOSED-1290-PITCH-CONSUMER-FACING ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const DISCOVER_FILE = path.join(process.cwd(), "supabase/functions/discover-cards/index.ts");
const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

// (a) discover-cards maps generative_summary into the card description.
const DESCRIPTION_MAP_RE = /description:\s*[^,\n]*generative_summary/;

function stripComments(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
}

// (a)
function checkDiscover(discoverSrc, failures) {
  const src = stripComments(discoverSrc);
  if (!DESCRIPTION_MAP_RE.test(src)) {
    failures.push(
      "discover-cards does not map generative_summary into the card `description` — " +
        "restore `description: (row.generative_summary as string | null) ?? ''` in " +
        "transformServablePlaceToCard (D-6 swipe-card blurb).",
    );
  }
}

// (b) the servable-RPC migration adds pp.generative_summary to BOTH RPCs.
function checkServableRpcMigration(rpcMigrationSrc, failures) {
  if (rpcMigrationSrc === null) {
    failures.push(
      "no migration adds generative_summary to the servable RPCs — the M2 migration " +
        "(query_servable_places_by_signal[_intersection] + pp.generative_summary) is missing.",
    );
    return;
  }
  const count = (rpcMigrationSrc.match(/pp\.generative_summary/g) || []).length;
  if (count < 2) {
    failures.push(
      `the servable-RPC migration references pp.generative_summary ${count} time(s); ` +
        "BOTH servable RPCs (solo + intersection) must select it (≥2).",
    );
  }
}

// (c) the venue_public_view migration exposes generative_summary (pitch).
function checkPublicViewMigration(viewMigrationSrc, failures) {
  if (viewMigrationSrc === null) {
    failures.push(
      "no migration exposes generative_summary on venue_public_view — the M1 migration " +
        "(venue_public_view + pp.generative_summary AS pitch) is missing.",
    );
    return;
  }
  if (!/generative_summary/.test(viewMigrationSrc)) {
    failures.push(
      "the venue_public_view migration does not expose generative_summary (pitch).",
    );
  }
}

// Locate the two 1290 migrations by content (robust to a filename shift).
function findMigrations() {
  let rpcMig = null;
  let viewMig = null;
  let files = [];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  } catch {
    return { rpcMig, viewMig };
  }
  for (const f of files) {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    if (
      src.includes("query_servable_places_by_signal_intersection") &&
      src.includes("generative_summary")
    ) {
      rpcMig = src;
    }
    if (src.includes("venue_public_view") && src.includes("generative_summary")) {
      viewMig = src;
    }
  }
  return { rpcMig, viewMig };
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // (a) GOOD/BAD
  let f = [];
  checkDiscover("description: (row.generative_summary as string | null) ?? '',\noneLiner: x,", f);
  if (f.length) self.push("(a) good discover fixture wrongly flagged: " + f.join("; "));
  f = [];
  checkDiscover("description: '',\noneLiner: null,", f);
  if (f.length === 0) self.push("(a) reverted description: '' not flagged");

  // (b) GOOD/BAD
  f = [];
  checkServableRpcMigration(
    "CREATE FUNCTION query_servable_places_by_signal() ... pp.generative_summary ...\n" +
      "CREATE FUNCTION query_servable_places_by_signal_intersection() ... pp.generative_summary ...",
    f,
  );
  if (f.length) self.push("(b) good RPC migration wrongly flagged: " + f.join("; "));
  f = [];
  checkServableRpcMigration("only one pp.generative_summary here", f);
  if (f.length === 0) self.push("(b) single-RPC generative_summary not flagged");
  f = [];
  checkServableRpcMigration(null, f);
  if (f.length === 0) self.push("(b) missing RPC migration not flagged");

  // (c) GOOD/BAD
  f = [];
  checkPublicViewMigration("CREATE VIEW venue_public_view ... pp.generative_summary AS pitch ...", f);
  if (f.length) self.push("(c) good view migration wrongly flagged: " + f.join("; "));
  f = [];
  checkPublicViewMigration("CREATE VIEW venue_public_view ... (no pitch column)", f);
  if (f.length === 0) self.push("(c) view without generative_summary not flagged");
  f = [];
  checkPublicViewMigration(null, f);
  if (f.length === 0) self.push("(c) missing view migration not flagged");

  if (self.length) {
    console.error("I-PROPOSED-1290-PITCH-CONSUMER-FACING self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-1290-PITCH-CONSUMER-FACING self-test PASS (8/8 cases).");
  process.exit(0);
}

const failures = [];
if (!fs.existsSync(DISCOVER_FILE)) {
  failures.push(`discover-cards not found at ${DISCOVER_FILE}.`);
} else {
  checkDiscover(fs.readFileSync(DISCOVER_FILE, "utf8"), failures);
}
const { rpcMig, viewMig } = findMigrations();
checkServableRpcMigration(rpcMig, failures);
checkPublicViewMigration(viewMig, failures);

if (failures.length > 0) {
  console.error("I-PROPOSED-1290-PITCH-CONSUMER-FACING FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1290-PITCH-CONSUMER-FACING PASS — pitch (generative_summary) is on the " +
    "card description, both servable RPCs, and venue_public_view.",
);
