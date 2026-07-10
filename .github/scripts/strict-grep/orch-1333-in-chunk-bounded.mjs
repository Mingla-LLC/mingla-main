#!/usr/bin/env node
/**
 * ORCH-1333 (RETEST) — I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED (DRAFT until CLOSE).
 *
 * Rule: run-signal-scorer must NEVER put a large id list into a single PostgREST
 * `.in('place_id', …)` / `.in('id', …)` URL. A 500-UUID `.in()` GET/DELETE URL
 * (~18KB) tripped the HTTP/2 "unspecific protocol error" request-URL limit in
 * prod → the whole page failed → the sticky pre-read fail-safe returned 500 →
 * 0 rows written. The three id-list URL call sites (per-place SELECT, sticky
 * pre-read, veto-delete) MUST chunk their id list by `IN_CHUNK` (≤ 100), NOT by
 * `BATCH_SIZE` (= the 500-row page/upsert size, which is fine — upsert is a POST
 * body, not a URL).
 *
 * Unit tests mock the network and CANNOT catch a URL-size failure, so this
 * static gate is the only regression protection (I-CLOSE regression HARD MUST).
 *
 * FAILS if `run-signal-scorer/index.ts` (comments stripped):
 *   1. does not declare `const IN_CHUNK = N` with 1 ≤ N ≤ 100, OR
 *   2. steps any loop by `BATCH_SIZE` (`+= BATCH_SIZE`) — id/URL chunks must
 *      step by IN_CHUNK, OR
 *   3. slices a chunk by `BATCH_SIZE` (`.slice(i, i + BATCH_SIZE)`) — the
 *      URL-chunk slices must use IN_CHUNK, OR
 *   4. has a `.in('id'|'place_id', …)` call site with no matching IN_CHUNK-sized
 *      slice feeding it.
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * i-proposed-1270-no-empty-sent.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = "supabase/functions/run-signal-scorer/index.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluate = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];

  // 1. IN_CHUNK declared and bounded ≤ 100.
  const m = code.match(/const\s+IN_CHUNK\s*=\s*(\d+)/);
  if (!m) {
    failures.push(
      `${TARGET}: const IN_CHUNK is missing — the id-list URL chunk size must be a named, bounded const. I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
    );
  } else {
    const val = Number.parseInt(m[1], 10);
    if (val <= 0 || val > 100) {
      failures.push(
        `${TARGET}: IN_CHUNK must be 1..100 (a 500-UUID .in() URL blew the HTTP/2 limit), got ${val}. I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
      );
    }
  }

  // 2. No loop may step by BATCH_SIZE — that is exactly the 500-wide URL chunk
  //    bug (BATCH_SIZE is the page/upsert size only, used as `pageSize: BATCH_SIZE`).
  if (/\+=\s*BATCH_SIZE/.test(code)) {
    failures.push(
      `${TARGET}: a loop increments by BATCH_SIZE — .in() id-list URL chunks must step by IN_CHUNK. I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
    );
  }

  // 3. No chunk may be sliced by BATCH_SIZE.
  if (/\.slice\(\s*\w+\s*,\s*\w+\s*\+\s*BATCH_SIZE\s*\)/.test(code)) {
    failures.push(
      `${TARGET}: a .slice(i, i + BATCH_SIZE) chunk feeds an .in() URL — URL chunks must be sliced by IN_CHUNK. I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
    );
  }

  // 4. Every .in('id'|'place_id', …) call site must be fed an IN_CHUNK-sized slice.
  const inCalls = (code.match(/\.in\(\s*['"](?:id|place_id)['"]/g) || []).length;
  const inChunkSlices =
    (code.match(/\.slice\(\s*\w+\s*,\s*\w+\s*\+\s*IN_CHUNK\s*\)/g) || []).length;
  if (inCalls === 0) {
    failures.push(
      `${TARGET}: expected at least one .in('id'|'place_id', …) URL call site, found none — did the scorer change shape? I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
    );
  }
  if (inChunkSlices < inCalls) {
    failures.push(
      `${TARGET}: found ${inCalls} .in('id'|'place_id', …) call site(s) but only ${inChunkSlices} IN_CHUNK-sized slice(s) — every id-list URL must be chunked by IN_CHUNK. I-PROPOSED-1333-SCORER-IN-CHUNK-BOUNDED.`,
    );
  }

  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  // GOOD — mirrors the fixed shape: IN_CHUNK const + 3 IN_CHUNK-chunked .in() calls,
  // BATCH_SIZE only as the page-size prop.
  const GOOD = `
    const BATCH_SIZE = 500;
    const IN_CHUNK = 100;
    for (let i = 0; i < placeIds.length; i += IN_CHUNK) {
      const idSlice = placeIds.slice(i, i + IN_CHUNK);
      const { data } = await buildBase().in('id', idSlice);
    }
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const idChunk = ids.slice(i, i + IN_CHUNK);
      await c.from('place_scores').select('place_id, contributions').in('place_id', idChunk);
    }
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const idChunk = ids.slice(i, i + IN_CHUNK);
      await c.from('place_scores').delete().in('place_id', idChunk);
    }
    runSignalScorerBatch(deps, { pageSize: BATCH_SIZE });
  `;
  // BAD-1 — the original bug: chunks stepped + sliced by BATCH_SIZE (500-wide URL).
  const BAD_STEP = `
    const BATCH_SIZE = 500;
    const IN_CHUNK = 100;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const idChunk = ids.slice(i, i + BATCH_SIZE);
      await c.from('place_scores').select('place_id').in('place_id', idChunk);
    }
  `;
  // BAD-2 — IN_CHUNK absent entirely.
  const BAD_NO_CONST = `
    const BATCH_SIZE = 500;
    const idChunk = ids.slice(0, 100);
    await c.from('place_scores').in('place_id', idChunk);
  `;
  // BAD-3 — IN_CHUNK present but > 100.
  const BAD_TOO_BIG = `
    const IN_CHUNK = 500;
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const idChunk = ids.slice(i, i + IN_CHUNK);
      await c.from('place_scores').in('place_id', idChunk);
    }
  `;
  const g = evaluate(GOOD);
  const bStep = evaluate(BAD_STEP);
  const bNoConst = evaluate(BAD_NO_CONST);
  const bTooBig = evaluate(BAD_TOO_BIG);
  const ok =
    g.length === 0 &&
    bStep.length >= 1 &&
    bNoConst.length >= 1 &&
    bTooBig.length >= 1;
  if (!ok) {
    console.error("ORCH-1333 in-chunk-bounded SELF-TEST failed:", {
      g,
      bStep,
      bNoConst,
      bTooBig,
    });
    process.exit(1);
  }
  console.log("ORCH-1333 in-chunk-bounded gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const abs = join(root, TARGET);
const failures = [];
if (!existsSync(abs)) failures.push(`${TARGET}: not found.`);
else failures.push(...evaluate(readFileSync(abs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1333 in-chunk-bounded gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1333 in-chunk-bounded gate passed.");
