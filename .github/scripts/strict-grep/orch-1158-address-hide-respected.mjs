#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — I-PROPOSED-1158-ADDRESS-HIDE-RESPECTED
 * (authored as ORCH-1158, RE-POINTED + salvaged under ORCH-1186 onto the
 * post-ORCH-1167 standardized public-page architecture.)
 *
 * CONTRACT: every public event-render surface that draws the venue's EXACT
 * street address MUST gate that render on the host's `hideAddressUntilTicket`
 * flag, so a logged-out viewer of a share link never sees the exact address
 * when the host chose to hide it. (Root cause: ORCH-1157 F-2 — the live RSVP
 * public body rendered `event.address` unconditionally → a real privacy leak.)
 *
 * RULE per target file: IF the file references `event.address` (i.e. it renders
 * the exact address), THEN it MUST also reference `hideAddressUntilTicket`
 * (i.e. it gates that render on the flag). A file that renders the address
 * without ever mentioning the hide flag is the leak shape and FAILS.
 *
 * --- ORCH-1186 RE-POINT (why the targets changed) -------------------------
 * ORCH-1167 (event) + ORCH-1163 (rsvp) STANDARDIZED the public pages into the
 * shared bodies under `@mingla/offering-rendering` and added SERVER-SIDE
 * privacy: the read RPC `pg_public_event_by_slug` returns `address: NULL` +
 * `locationGeo: NULL` when `hide_address_until_ticket` is set, so an anon
 * viewer never even receives the street from the server. The OLD targets the
 * 1158 branch named — FoundationEventPreview.tsx (now renders 0 `event.address`),
 * RsvpPublicBody.tsx (DELETED), ConsumerEventDetailScreen.tsx (no `event.address`)
 * — are retired pre-standardization surfaces; pointing at them asserts nothing.
 *
 * This gate is RE-POINTED to the surfaces that are LIVE on `main` today and
 * actually render the exact address as the CLIENT belt-and-suspenders guard on
 * top of the server-side RPC privacy:
 *   - packages/offering-rendering/EventOfferingBody.tsx  (standard event page)
 *   - packages/offering-rendering/RsvpOfferingBody.tsx   (RSVP page — ex-F-2 leak)
 * Both render `event.address` AND gate on `hideAddressUntilTicket`, so the rule
 * holds today and the leak shape (render address with no hide gate) can never be
 * reintroduced on either live body.
 *
 * Pass condition: for every target file present, the IF/THEN rule holds.
 * Exit codes: 0 pass · 1 fail · 2 fs error
 * Self-test mode (--self-test) validates the detectors against fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Files that publicly render an event's venue address on `main` TODAY (the
// post-ORCH-1167/1163 shared bodies). Each is held to the
// IF-renders-address-THEN-gates-on-hide-flag rule below.
const TARGETS = [
  "packages/offering-rendering/EventOfferingBody.tsx",
  "packages/offering-rendering/RsvpOfferingBody.tsx",
];

// "renders the exact address" — references the address field on the event model.
const RENDERS_ADDRESS_RE = /\bevent\.address\b/;
// "gates on the hide flag" — references the hide flag anywhere in the file.
const GATES_ON_HIDE_RE = /\bhideAddressUntilTicket\b/;

let failures = 0;
function fail(check, msg) {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
}
function ok(check, msg) {
  console.log(`OK   [${check}] ${msg}`);
}

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`fs error reading ${filePath}: ${e.message}`);
    process.exit(2);
  }
}

function evaluate(rel, src) {
  const rendersAddress = RENDERS_ADDRESS_RE.test(src);
  const gatesOnHide = GATES_ON_HIDE_RE.test(src);
  if (!rendersAddress) {
    ok("ADDRESS-HIDE", `${rel} does not render event.address (rule N/A)`);
    return;
  }
  if (gatesOnHide) {
    ok(
      "ADDRESS-HIDE",
      `${rel} renders event.address AND gates on hideAddressUntilTicket`,
    );
  } else {
    fail(
      "ADDRESS-HIDE",
      `${rel} renders event.address but NEVER references hideAddressUntilTicket — ` +
        `public address-hide leak shape (ORCH-1157 F-2). Gate the exact address ` +
        `on the hide flag like EventOfferingBody/RsvpOfferingBody.`,
    );
  }
}

function runSelfTest() {
  let selfFail = 0;
  const leaks = `const label = event.address ?? "Location";`;
  const gated = `const label = event.hideAddressUntilTicket ? "hidden" : (event.address ?? "");`;
  const noAddress = `const x = event.venueName ?? "";`;

  // leak shape → must be flagged
  if (!(RENDERS_ADDRESS_RE.test(leaks) && !GATES_ON_HIDE_RE.test(leaks))) {
    console.error("SELF-TEST FAIL: leak fixture not detected as leak");
    selfFail++;
  }
  // gated shape → must pass
  if (!(RENDERS_ADDRESS_RE.test(gated) && GATES_ON_HIDE_RE.test(gated))) {
    console.error("SELF-TEST FAIL: gated fixture not detected as gated");
    selfFail++;
  }
  // no-address shape → rule N/A (renders-address false)
  if (RENDERS_ADDRESS_RE.test(noAddress)) {
    console.error("SELF-TEST FAIL: no-address fixture false-positive on address");
    selfFail++;
  }
  if (selfFail > 0) {
    console.error(`SELF-TEST: ${selfFail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1158-ADDRESS-HIDE-RESPECTED detectors behave");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

// Guard against the re-point going stale: at least one live target must exist
// AND actually render event.address, else the gate has silently gone inert.
let anyLiveAddressTarget = false;

for (const relTarget of TARGETS) {
  const file = path.join(REPO_ROOT, relTarget);
  const rel = path.relative(REPO_ROOT, file);
  if (!fs.existsSync(file)) {
    // A missing target is not a leak; skip (files may not exist on every branch).
    ok("ADDRESS-HIDE", `${rel} absent (skipped)`);
    continue;
  }
  const src = readSource(file);
  if (RENDERS_ADDRESS_RE.test(src)) anyLiveAddressTarget = true;
  evaluate(rel, src);
}

if (!anyLiveAddressTarget) {
  fail(
    "ADDRESS-HIDE",
    "no TARGET renders event.address — the gate has gone inert (the public " +
      "render surface moved). Re-point TARGETS to the live body that renders " +
      "the exact address (ORCH-1186 re-point).",
  );
}

process.exit(failures > 0 ? 1 : 0);
