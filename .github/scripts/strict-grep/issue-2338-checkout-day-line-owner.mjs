#!/usr/bin/env node
/**
 * issue #2338 strict-grep gate — EVERY CHECKOUT SURFACE THAT SHOWS A DATE MUST
 * ASK THE DISPLAY OWNER, AND MUST HAND IT THE DAYS.
 *
 * ══ THE BUG CLASS THIS EXISTS FOR ══════════════════════════════════════════
 * Three times now, the day data existed and the screen was not given it:
 *
 *   #2161  the days were fetched through an RLS-gated reader that could not see
 *          an unlisted event's `event_dates`; the page rendered, the days did not
 *   #2209  the days rode the payload and the only production route never passed
 *          them to `PublicEventPage`
 *   #2338  the days rode the payload AND sat in the cart, and the confirmation
 *          screen called `formatDraftDateLine(event)` — which reads `multiDates`,
 *          the ORGANISER'S DRAFT, which every public reader strips — so a guest
 *          who had just chosen 29 + 30 August read "Date TBD" over their own
 *          6-ticket order (production order b19a9609-…, 2026-08-19)
 *
 * Every one of those was SILENT. Nothing threw, nothing logged, and the string
 * that shipped was a truthful answer to the wrong question. The only visible
 * symptom was a sentence on a screen nobody re-read after launch.
 *
 * ══ WHAT THIS GATE ASSERTS ═════════════════════════════════════════════════
 * For each guarded checkout surface:
 *
 *   A. it calls `resolveChosenDaysLine(event, occurrences, …)` — with the
 *      OCCURRENCES named at the call site, so "wire it up but pass an empty
 *      array" fails here as loudly as not wiring it at all. That is precisely
 *      the shape #2209 shipped: a prop that existed, defaulted, and was never
 *      handed anything.
 *   B. it does NOT call the draft formatters (`formatDraftDateLine` and
 *      siblings) directly. On a PUBLISHED event those read a field the server
 *      strips; a checkout surface that calls one has, by construction, stopped
 *      being able to see a multi-date event's days.
 *   C. it does NOT build its own day label out of `formatOccurrenceDayLabel`.
 *      That is exactly how #2160's private `chosenDayLabel` useMemo came to
 *      exist inside `index.tsx`, and it is why the confirmation screen two
 *      steps later had nothing to reuse. I-14 makes `eventDateDisplay.ts` the
 *      single owner of event date display; a fifth formatter is the defect.
 *
 * And for the owner itself: it must still EXPORT both helpers, so gutting the
 * owner cannot quietly leave the call sites pointing at nothing.
 *
 * NOT A REPO-WIDE LINTER. Organiser surfaces read their own drafts, where
 * `multiDates` is present and authoritative, and must keep calling the draft
 * formatters. Only the checkout funnel — fed by
 * `pg_direct_event_checkout_bundle`, which strips the draft — is covered.
 *
 * `--self-test` proves fail-on-revert with THREE GOOD fixtures (one of which
 * names every banned symbol inside COMMENTS) and FIVE DISTINCT BAD fixtures —
 * one per rule, plus the "wired but starved" case.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

/**
 * The checkout surfaces fed by the STRIPPED reader. Each is a screen a guest
 * reads while buying, or immediately after.
 */
const GUARDED = [
  "mingla-business/app/checkout/[eventId]/index.tsx",
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
];

const OWNER = "mingla-business/src/utils/eventDateDisplay.ts";

/**
 * D. The PAID WEB leg. Stripe's / Paystack's success_url forces a full-page
 * reload that wipes the in-memory cart, so ORCH-0789/0790 re-hydrates /confirm
 * from a sessionStorage payload. If the chosen day set is not IN that payload,
 * the summary on the paid web leg has nothing to name — the same defect as
 * #2338, reached by a different door. Runtime-proved by S-7 in
 * `issue_2338_confirm_summary_names_the_days.test.tsx`; this line is what stops
 * the WRITE side from being quietly dropped, which no render test can see.
 */
const RESUME_WRITER = "mingla-business/app/checkout/[eventId]/payment.tsx";
const RESUME_CARRIES_DAYS =
  /writeCheckoutResumePayload\([\s\S]{0,800}?\beventDateIds\b/;

// A. the call, WITH the occurrences named. `[]` or `EMPTY` in that slot fails.
const RESOLVE_CALL =
  /resolveChosenDaysLine\(\s*[A-Za-z_$][\w$]*\s*,\s*occurrences\s*,/;
// B. the draft formatters — correct for an organiser draft, blind on a
// published multi-date event.
const DRAFT_FORMATTER =
  /\bformatDraft(DateLine|DateSubline|DatesList)\s*\(/;
// C. a hand-rolled day label — how the fourth formatter got built.
const RAW_DAY_LABEL = /\bformatOccurrenceDayLabel\s*\(/;

/**
 * Comments are PROSE, not calls. These files document the bug they fix by name,
 * so a scan that read `formatDraftDateLine` out of a comment would flag the
 * explanation instead of the defect — a gate that fires on its own docs gets
 * silenced, and a silenced gate is the sixth class of dark gate this repo has
 * produced. JSX `{/* … *\/}` braces leave a bare `{}` behind, which matches
 * nothing here.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function check(rawSource, relPath, failures) {
  const source = stripComments(rawSource);
  if (!RESOLVE_CALL.test(source)) {
    failures.push(
      `${relPath}: does not call resolveChosenDaysLine(event, occurrences, …). ` +
        "A checkout surface renders its date line through the display owner " +
        "AND names the occurrence list at the call site. Passing `[]` (or " +
        "omitting the argument) is the #2209 defect exactly: the prop exists, " +
        "it defaults, and nobody ever hands it the days — so a guest who chose " +
        "two days reads 'Date TBD' over a 6-ticket order and nothing throws.",
    );
  }
  if (DRAFT_FORMATTER.test(source)) {
    failures.push(
      `${relPath}: calls a formatDraft* date formatter directly. Those read ` +
        "`multiDates` — the ORGANISER'S DRAFT — which pg_direct_event_checkout_" +
        "bundle and pg_public_event_by_slug both STRIP. On a published " +
        "multi-date event they answer 'Date TBD' truthfully and uselessly. " +
        "Use resolveChosenDaysLine, which falls back to them itself for every " +
        "event where they are still the right answer.",
    );
  }
  if (RAW_DAY_LABEL.test(source)) {
    failures.push(
      `${relPath}: builds its own day label from formatOccurrenceDayLabel. ` +
        "That is how #2160's private `chosenDayLabel` useMemo came to live in " +
        "this folder instead of in eventDateDisplay.ts — and why the " +
        "confirmation screen could not reuse it and printed 'Date TBD'. I-14: " +
        "eventDateDisplay.ts is the SINGLE owner of event date display. Add the " +
        "wording there and call it from here.",
    );
  }
}

export function checkResumeWriter(rawSource, relPath, failures) {
  const source = stripComments(rawSource);
  if (!RESUME_CARRIES_DAYS.test(source)) {
    failures.push(
      `${relPath}: writeCheckoutResumePayload() does not carry \`eventDateIds\`. ` +
        "The provider redirect wipes the in-memory cart; whatever is not in " +
        "this payload does not exist when the guest lands back on /confirm. " +
        "Dropping the day set here silently restores a paid two-day order with " +
        "no days to name.",
    );
  }
}

export function checkOwner(rawSource, relPath, failures) {
  const source = stripComments(rawSource);
  for (const name of ["formatChosenDaysLabel", "resolveChosenDaysLine"]) {
    if (!new RegExp(`export const ${name}\\b`).test(source)) {
      failures.push(
        `${relPath}: no longer exports \`${name}\`. The checkout surfaces are ` +
          "required to route their date line through it; removing it here " +
          "silently strands them.",
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const GOOD = `
    const occurrences = publicEventQuery.data?.occurrences ?? EMPTY_OCCURRENCES;
    const line = resolveChosenDaysLine(event, occurrences, chosenDayIds);
  `;
  let f = [];
  check(GOOD, "good.tsx", f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 — the shape #2338 shipped: the draft formatter, straight into the UI.
  f = [];
  check(
    "<Text>{formatDraftDateLine(event)}</Text>",
    "bad1.tsx",
    f,
  );
  if (f.length < 2) {
    self.push(
      "BAD1 (draft formatter, no owner call) must trip BOTH rule A and rule B, " +
        `tripped ${f.length}`,
    );
  }

  // BAD2 — WIRED BUT STARVED. The #2209 shape: the call is there, the days are
  // not. A gate that only grepped for the function name would pass this.
  f = [];
  check(
    "const line = resolveChosenDaysLine(event, [], chosenDayIds);",
    "bad2.tsx",
    f,
  );
  if (f.length === 0) {
    self.push("BAD2 (resolveChosenDaysLine called with an EMPTY list) not flagged");
  }

  // BAD3 — a fifth private formatter, rebuilt in the screen.
  f = [];
  check(
    "const occurrences = data.occurrences;\n" +
      "const line = resolveChosenDaysLine(event, occurrences, ids);\n" +
      "const own = occ.map((o) => formatOccurrenceDayLabel(o.startAt, o.timezone));",
    "bad3.tsx",
    f,
  );
  if (f.length === 0) self.push("BAD3 (hand-rolled day label) not flagged");

  // GOOD2 — the SAME file, documenting the defect it fixed in prose. A gate
  // that flags its own explanation gets deleted; this proves it does not.
  f = [];
  check(
    "// The fallback stopped being formatDraftDateLine(event) alone.\n" +
      "/* formatOccurrenceDayLabel() used to be called right here. */\n" +
      "const line = resolveChosenDaysLine(event, occurrences, ids);",
    "good2.tsx",
    f,
  );
  if (f.length) self.push("GOOD2 (defect named in COMMENTS) wrongly flagged: " + f.join("; "));

  // BAD5 — the resume payload stops carrying the days across the redirect.
  f = [];
  checkResumeWriter(
    "writeCheckoutResumePayload(storage, eventId, {\n" +
      "  checkoutSessionId: handoff.checkoutSessionId,\n" +
      "  buyerStatusToken: handoff.buyerStatusToken,\n  lines,\n  buyer,\n});",
    "bad5.tsx",
    f,
  );
  if (f.length === 0) self.push("BAD5 (resume payload without the day set) not flagged");

  f = [];
  checkResumeWriter(
    "writeCheckoutResumePayload(storage, eventId, {\n  lines,\n  buyer,\n" +
      "  ...(eventDateIds.length > 0 ? { eventDateIds: [...eventDateIds] } : {}),\n});",
    "good3.tsx",
    f,
  );
  if (f.length) self.push("GOOD3 (resume payload WITH the day set) wrongly flagged: " + f.join("; "));

  // BAD4 — the owner gutted.
  f = [];
  checkOwner("export const formatDraftDateLine = () => {};", "bad4.ts", f);
  if (f.length !== 2) {
    self.push(`BAD4 (owner exports removed) must report 2 losses, got ${f.length}`);
  }

  // GOOD-owner inverse.
  f = [];
  checkOwner(
    "export const formatChosenDaysLabel = () => null;\n" +
      "export const resolveChosenDaysLine = () => '';",
    "goodowner.ts",
    f,
  );
  if (f.length) self.push("GOOD owner fixture wrongly flagged: " + f.join("; "));

  if (self.length) {
    console.error("issue-2338 checkout-day-line-owner self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "issue-2338 checkout-day-line-owner self-test PASS (9/9 cases).",
  );
  process.exit(0);
}

const failures = [];
let scanned = 0;
for (const rel of GUARDED) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(
      `${rel}: guarded checkout surface is missing. If it moved, update this ` +
        "gate's list in the SAME change — a silently unguarded checkout screen " +
        "is how #2338 reached a founder's own order.",
    );
    continue;
  }
  scanned += 1;
  check(fs.readFileSync(abs, "utf8"), rel, failures);
}

const writerAbs = path.join(root, RESUME_WRITER);
if (!fs.existsSync(writerAbs)) {
  failures.push(`${RESUME_WRITER}: the paid-leg resume writer is missing.`);
} else {
  scanned += 1;
  checkResumeWriter(fs.readFileSync(writerAbs, "utf8"), RESUME_WRITER, failures);
}

const ownerAbs = path.join(root, OWNER);
if (!fs.existsSync(ownerAbs)) {
  failures.push(`${OWNER}: the display owner is missing.`);
} else {
  scanned += 1;
  checkOwner(fs.readFileSync(ownerAbs, "utf8"), OWNER, failures);
}

if (failures.length > 0) {
  console.error("issue-2338 checkout-day-line-owner gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `issue-2338 checkout-day-line-owner gate passed (${scanned} files: ` +
    `${GUARDED.length} checkout surfaces + the paid-leg resume writer + the ` +
    "display owner).",
);
