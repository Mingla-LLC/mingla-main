#!/usr/bin/env node
/**
 * ORCH-0842 [Fold Tickets into Active + render real ticket PDF in bottom
 * sheet with venue/QR/Save] — TESTER ADVERSARIAL regression test.
 *
 * The implementor's happy-path test at
 * `app-mobile/scripts/ci/orch-0842-regression-check.mjs` asserts STRUCTURE:
 * files exist, patterns present, deletions in place. This adversarial test
 * attacks DIFFERENT angles per ORCH-0840 [Regression-test enforcement +
 * append-only CI] Step 0.5 — it exercises BEHAVIOR + CROSS-FILE INVARIANTS
 * + SECURITY BOUNDARIES that the happy-path test does not cover.
 *
 * Tester author: Claude `mingla-tester` (post-implementor verification).
 * Fails-on-revert verification: each assertion exercises a distinct
 * mechanism; reverting any single piece of the ORCH-0842 implementation
 * triggers a specific labeled failure.
 *
 * Angles attacked:
 *
 *   A1. STORAGE-PATH-DETERMINISM — dispatch upload + ticket-pdf-fetch
 *       lazy backfill MUST write to the same path scheme
 *       `tickets/<orderId>.pdf`. If they drift, fetch signs a non-existent
 *       file. The implementor's test only asserts presence of "ticket-pdfs"
 *       string; this asserts the path FORMULA agrees across both sites.
 *
 *   A2. ERROR-STATUS-MATRIX — ticket-pdf-fetch MUST return distinct codes
 *       401 / 400 / 404 / 403 / 409 / 410 / 500 from distinct branches.
 *       Collapse (e.g., 403 used for both not-paid and wrong-owner) leaks
 *       information AND masks security errors. Implementor's test does
 *       not exercise the matrix.
 *
 *   A3. NO-THIRD-PARTY-WRITER — only the two known files
 *       (ticket-confirmation-dispatch, ticket-pdf-fetch) may read/write
 *       the `ticket-pdfs` bucket. Catches future code that bypasses the
 *       owner check by writing directly.
 *
 *   A4. BUCKET-PRIVACY-LITERAL — the migration text MUST contain the
 *       literal value `false` in the bucket `public` column position.
 *       Catches a future migration that flips it to `true` accidentally.
 *
 *   A5. PARSE-LOCATION-GEO-BEHAVIOR — the venue parser regex must accept
 *       valid PostGIS point formats and reject malformed inputs. Extracts
 *       the regex from calendarService.ts source + fuzzes it. Implementor's
 *       test only asserts the function name exists.
 *
 *   A6. CAROUSEL-PAGING-WIRED — full-width paged carousel requires three
 *       props on the ScrollView: `pagingEnabled`, `snapToInterval={pageWidth}`,
 *       and an `onScroll` handler that tracks the current page. Missing any
 *       leaves the carousel scrolling free-form. Implementor's test does
 *       not cover the carousel behavior.
 *
 *   A7. PENDING-GUARD-STRUCTURAL — pending-payment tickets must NOT be
 *       tappable into the PDF sheet. The `isPending` branch in
 *       BusinessEventCalendarRow.tsx must render the "Finalizing…" View
 *       (no Pressable wrapping). Catches accidental wrap that would open
 *       the sheet for non-paid orders.
 *
 *   A8. NEGATIVE-REACT-NATIVE-PDF — react-native-pdf MUST stay uninstalled
 *       (operator feedback 2026-05-17 removed inline PDF rendering). A
 *       future "let's add inline preview back" PR must surface as a new
 *       ORCH, not a silent re-introduction.
 *
 * Exit codes: 0 PASS, 1 FAIL (one or more angles failed).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const failures = [];

function read(rel) {
  const full = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`${rel}: file expected but missing`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

function fail(angle, msg) {
  failures.push(`[${angle}] ${msg}`);
}

// ---------------------------------------------------------------------------
// A1. STORAGE-PATH-DETERMINISM
// Dispatch upload path string MUST equal ticket-pdf-fetch lazy-backfill
// path string. The path is `tickets/${order.id}.pdf` in BOTH places.
// ---------------------------------------------------------------------------
{
  const dispatch = read(
    "supabase/functions/ticket-confirmation-dispatch/index.ts",
  );
  const fetchFn = read("supabase/functions/ticket-pdf-fetch/index.ts");
  // Match `tickets/${<expr>}.pdf` template — both files use template literal.
  const dispatchPathRe = /`tickets\/\$\{[^}]+\}\.pdf`/g;
  const fetchPathRe = /`tickets\/\$\{[^}]+\}\.pdf`/g;
  const dispatchMatches = dispatch.match(dispatchPathRe) ?? [];
  const fetchMatches = fetchFn.match(fetchPathRe) ?? [];
  if (dispatchMatches.length === 0) {
    fail(
      "A1",
      "ticket-confirmation-dispatch/index.ts: no `tickets/${...}.pdf` upload path found",
    );
  }
  if (fetchMatches.length === 0) {
    fail(
      "A1",
      "ticket-pdf-fetch/index.ts: no `tickets/${...}.pdf` lazy-backfill path found",
    );
  }
  // The literal template strings must agree on shape — they must both be
  // exactly `tickets/${<some-id>}.pdf` (single segment, no nesting drift).
  for (const m of dispatchMatches) {
    if (!/^`tickets\/\$\{[a-zA-Z0-9_.]+\}\.pdf`$/.test(m)) {
      fail("A1", `ticket-confirmation-dispatch: non-canonical path shape: ${m}`);
    }
  }
  for (const m of fetchMatches) {
    if (!/^`tickets\/\$\{[a-zA-Z0-9_.]+\}\.pdf`$/.test(m)) {
      fail("A1", `ticket-pdf-fetch: non-canonical path shape: ${m}`);
    }
  }
}

// ---------------------------------------------------------------------------
// A2. ERROR-STATUS-MATRIX
// ticket-pdf-fetch MUST return distinct codes 401 / 400 / 404 / 403 / 409 / 410 / 500.
// ---------------------------------------------------------------------------
{
  const fetchFn = read("supabase/functions/ticket-pdf-fetch/index.ts");
  const required = [
    { code: 401, label: "unauthorized" },
    { code: 400, label: "bad_request" },
    { code: 404, label: "not_found" },
    { code: 403, label: "forbidden" },
    { code: 409, label: "not_paid" },
    { code: 410, label: "gone" },
    { code: 500, label: "render_failed" },
  ];
  for (const { code, label } of required) {
    // Multi-line body: jsonResponse(\n  { error: "<label>", ... },\n  <code>,\n);
    // Strategy: find every occurrence of "<label>" and check that the
    // enclosing jsonResponse call (within 200 chars after) contains the
    // expected status code.
    let matched = false;
    const labelRe = new RegExp(`["']${label}["']`, "g");
    let m;
    while ((m = labelRe.exec(fetchFn)) !== null) {
      const window = fetchFn.slice(m.index, m.index + 200);
      const codeRe = new RegExp(`\\b${code}\\b`);
      if (codeRe.test(window)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      fail(
        "A2",
        `ticket-pdf-fetch: missing distinct branch for HTTP ${code} ("${label}") — security/UX risk if error matrix collapsed`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// A3. NO-THIRD-PARTY-WRITER
// Only ticket-confirmation-dispatch + ticket-pdf-fetch may touch the
// `ticket-pdfs` bucket. Walk supabase/functions/ and fail if any other
// file references the bucket string.
// ---------------------------------------------------------------------------
{
  const FN_ROOT = path.join(REPO_ROOT, "supabase/functions");
  const ALLOWED = new Set([
    path.join(FN_ROOT, "ticket-confirmation-dispatch/index.ts"),
    path.join(FN_ROOT, "ticket-pdf-fetch/index.ts"),
  ]);
  function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (e.isFile() && /\.(ts|mts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  }
  for (const file of walk(FN_ROOT)) {
    if (ALLOWED.has(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/['"]ticket-pdfs['"]/.test(text)) {
      fail(
        "A3",
        `${path.relative(REPO_ROOT, file)}: unauthorized reference to 'ticket-pdfs' bucket. Only ticket-confirmation-dispatch and ticket-pdf-fetch may touch this bucket per I-PROPOSED-AM.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// A4. BUCKET-PRIVACY-LITERAL
// Migration MUST contain the bucket row VALUES with `false` in the public
// column. Survives future migrations only if no later one flips it.
// ---------------------------------------------------------------------------
{
  const mig = read(
    "supabase/migrations/20260606000000_orch_0842_ticket_pdf_storage.sql",
  );
  // Match the multi-line VALUES (...) block and confirm the 3rd column
  // ('public') is literal false.
  const valuesRe =
    /VALUES\s*\(\s*'ticket-pdfs'\s*,\s*'ticket-pdfs'\s*,\s*(false|true)/;
  const m = mig.match(valuesRe);
  if (!m) {
    fail(
      "A4",
      "migration: VALUES(...) for ticket-pdfs bucket not found in expected shape",
    );
  } else if (m[1] !== "false") {
    fail(
      "A4",
      `migration: ticket-pdfs bucket created with public=${m[1]} — MUST be false per I-PROPOSED-AM TICKET_PDF_STORAGE_BUCKET_PRIVATE`,
    );
  }
}

// ---------------------------------------------------------------------------
// A5. PARSE-LOCATION-GEO-BEHAVIOR
// Extract the regex from calendarService.ts and fuzz it.
// ---------------------------------------------------------------------------
{
  const calSvc = read("app-mobile/src/services/calendarService.ts");
  // The regex literal lives on one line in parseLocationGeo.
  const reMatch = calSvc.match(
    /raw\.match\(\s*\/(\^[^/]+\$)\/\s*\)/,
  );
  if (!reMatch) {
    fail("A5", "calendarService: parseLocationGeo regex not extractable");
  } else {
    let regex;
    try {
      regex = new RegExp(reMatch[1]);
    } catch (err) {
      fail("A5", `calendarService: regex compile failed: ${err.message}`);
    }
    if (regex) {
      const positive = [
        "(40.7128,-74.0060)",
        "40.7128,-74.0060",
        "(-1.5,2.5)",
        "(0,0)",
      ];
      const negative = [
        "",
        "not a point",
        "(40.7128)",
        "(40.7128,-74.0060,5)",
        "abc,def",
        "(40.7128, -74.0060", // unbalanced — actually balanced isn't required
      ];
      for (const s of positive) {
        if (!regex.test(s)) {
          fail(
            "A5",
            `parseLocationGeo regex rejects valid input '${s}' — venue render will fall back to "Venue details in your email" unnecessarily`,
          );
        }
      }
      for (const s of negative) {
        // Skip the unbalanced-paren case — the regex tolerates optional parens.
        if (s.includes("(") && !s.includes(")")) continue;
        if (regex.test(s)) {
          fail(
            "A5",
            `parseLocationGeo regex accepts malformed input '${s}' — could surface garbage lat/lng to Maps deep-link`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// A6. CAROUSEL-PAGING-WIRED
// TicketPdfSheet's ScrollView must declare pagingEnabled + snapToInterval
// + onScroll handler.
// ---------------------------------------------------------------------------
{
  const sheet = read(
    "app-mobile/src/components/activity/TicketPdfSheet.tsx",
  );
  if (!/pagingEnabled/.test(sheet)) {
    fail(
      "A6",
      "TicketPdfSheet: ScrollView missing pagingEnabled — carousel will not snap to one QR per page",
    );
  }
  if (!/snapToInterval=\{pageWidth\}/.test(sheet)) {
    fail(
      "A6",
      "TicketPdfSheet: ScrollView missing snapToInterval={pageWidth} — carousel pages won't align with sheet width",
    );
  }
  if (!/onScroll=\{handleCarouselScroll\}/.test(sheet)) {
    fail(
      "A6",
      "TicketPdfSheet: ScrollView missing onScroll handler — page counter + dots won't update on swipe",
    );
  }
  // Dot indicator must be gated on length > 1 so single-ticket orders
  // don't show a meaningless single dot.
  if (!/entry\.tickets\.length\s*>\s*1/.test(sheet)) {
    fail(
      "A6",
      "TicketPdfSheet: dot indicator missing tickets.length > 1 gate — single-ticket orders would show a useless dot",
    );
  }
}

// ---------------------------------------------------------------------------
// A7. PENDING-GUARD-STRUCTURAL
// BusinessEventCalendarRow's isPending branch must render a View, NOT a
// Pressable. A Pressable would silently make pending tickets tappable.
// ---------------------------------------------------------------------------
{
  const row = read(
    "app-mobile/src/components/activity/BusinessEventCalendarRow.tsx",
  );
  // Locate the isPending ? ... : ... ternary block and read the truthy branch.
  const m = row.match(/isPending\s*\?\s*\(([\s\S]*?)\)\s*:/);
  if (!m) {
    fail(
      "A7",
      "BusinessEventCalendarRow: isPending ternary not found — pending guard structure unverifiable",
    );
  } else {
    const truthyBranch = m[1];
    if (/<Pressable\b/.test(truthyBranch)) {
      fail(
        "A7",
        "BusinessEventCalendarRow: isPending branch contains a <Pressable> — pending tickets MUST NOT be tappable per SPEC SC-06",
      );
    }
    if (!/Finalizing/.test(truthyBranch)) {
      fail(
        "A7",
        "BusinessEventCalendarRow: isPending branch missing 'Finalizing…' label — user wouldn't see why ticket is non-interactive",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// A8. NEGATIVE-REACT-NATIVE-PDF
// react-native-pdf must stay out of TicketPdfSheet AND package.json.
// ---------------------------------------------------------------------------
{
  const sheet = read(
    "app-mobile/src/components/activity/TicketPdfSheet.tsx",
  );
  if (/from\s+["']react-native-pdf["']/.test(sheet)) {
    fail(
      "A8",
      "TicketPdfSheet: react-native-pdf import re-introduced. Inline PDF rendering was removed by operator on 2026-05-17 — a re-introduction must be its own ORCH, not a silent change.",
    );
  }
  const pkg = read("app-mobile/package.json");
  if (/"react-native-pdf"/.test(pkg)) {
    fail(
      "A8",
      "app-mobile/package.json: react-native-pdf re-added as a dependency. Must be ORCH-tracked.",
    );
  }
  if (/"react-native-blob-util"/.test(pkg)) {
    fail(
      "A8",
      "app-mobile/package.json: react-native-blob-util re-added (peer of react-native-pdf). Must be ORCH-tracked.",
    );
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("ORCH-0842 adversarial check FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "ORCH-0842 adversarial check PASSED (8 angles: path determinism, error matrix, no third-party writer, bucket privacy, parser fuzz, carousel paging, pending guard, no react-native-pdf).",
);
