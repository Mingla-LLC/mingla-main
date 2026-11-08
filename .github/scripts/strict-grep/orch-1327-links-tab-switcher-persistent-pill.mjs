#!/usr/bin/env node
// MINGLA-INVARIANT: I-4318-LINKS-FILTER-CHIPS | issue #4318 | The /links filter chips are labelled toggle buttons (All, Events, Trips, Experiences) that never filter the admin strips, and the old tab switcher never comes back.
/**
 * ORCH-1327 [links tab switcher swing] → #4318 [links city week calendar].
 *
 * HISTORY. ORCH-1327 pinned the Explorer / For Hosts tab switcher on /links
 * (one persistent x-animated bg-warm pill, roving-tabindex tablist). #4318
 * replaced that page: there are no tabs any more (Seth's design reviews,
 * 7 Nov 2026). The file keeps its name and MANIFEST row so the gate count and
 * self-test ratchets do not move; its invariant is re-pointed to what replaced
 * the switcher.
 *
 * Invariant: I-4318-LINKS-FILTER-CHIPS. Over
 * mingla-marketing/components/marketing/links-experience.tsx (comment-stripped):
 *
 * REQUIRE
 *   1. the chips sit in ONE labelled group: role="group" AND aria-label="Filter".
 *   2. each chip is a toggle button: aria-pressed={filter === f.id}.
 *   3. the four filters, in order: All, Events, Trips, Experiences.
 *   4. a filter change is tracked: captureMarketing('links_filter_changed'.
 *   5. the admin strips are never filtered: the pinned group renders
 *      `week.pins.map(` and the chips filter only `week.listings`.
 *
 * BAN (the retired tab model must not come back)
 *   - role="tablist" / role="tab" / layoutId.
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire; a banned
 * token inside a COMMENT is stripped and still passes).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = "mingla-marketing/components/marketing/links-experience.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function checkChips(rawSrc, failures) {
  const src = stripComments(rawSrc);

  if (!/role="group"/.test(src) || !/aria-label="Filter"/.test(src)) {
    failures.push(`${TARGET}: the filter chips must sit in one role="group" labelled aria-label="Filter".`);
  }
  if (!/aria-pressed=\{filter === f\.id\}/.test(src)) {
    failures.push(`${TARGET}: each chip must be a toggle button with aria-pressed={filter === f.id}.`);
  }
  const order = ["'All'", "'Events'", "'Trips'", "'Experiences'"].map((label) => src.indexOf(`label: ${label}`));
  if (order.some((i) => i === -1) || order.some((i, n) => n > 0 && i < order[n - 1])) {
    failures.push(`${TARGET}: the four filters must be All, Events, Trips, Experiences, in that order.`);
  }
  if (!/captureMarketing\('links_filter_changed'/.test(src)) {
    failures.push(`${TARGET}: a filter change must fire links_filter_changed.`);
  }
  if (!/week\.pins\.map\(/.test(src) || !/week\.listings\.filter\(/.test(src)) {
    failures.push(`${TARGET}: admin strips render from week.pins and only week.listings are filtered (admin strips stay out of the filters).`);
  }
  for (const [re, why] of [
    [/role="tablist"/, 'role="tablist" (the retired tab model)'],
    [/role="tab"/, 'role="tab" (the retired tab model)'],
    [/layoutId/, "layoutId (the retired swinging pill)"],
  ]) {
    if (re.test(src)) failures.push(`${TARGET}: contains ${why}.`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkChips(s, f); return f; };

  const good = `
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'event', label: 'Events' },
  { id: 'trip', label: 'Trips' },
  { id: 'experience', label: 'Experiences' },
]
const shown = filter === 'all' ? week.listings : week.listings.filter((l) => l.kind === filter)
{week.pins.map((pin) => strip(pin))}
<div role="group" aria-label="Filter">
  {FILTERS.map((f) => (
    <button aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); captureMarketing('links_filter_changed', {}) }}>x</button>
  ))}
</div>
`;
  if (run(good).length !== 0) selfFailures.push("compliant chips wrongly flagged: " + JSON.stringify(run(good)));

  const cases = [
    ["tablist re-added", good.replace('role="group"', 'role="tablist"')],
    ["toggle state dropped", good.replace("aria-pressed={filter === f.id}", "")],
    ["order changed", good.replace("label: 'Events'", "label: 'Tmp'").replace("label: 'Trips'", "label: 'Events'").replace("label: 'Tmp'", "label: 'Trips'")],
    ["analytics dropped", good.replace("captureMarketing('links_filter_changed', {})", "")],
    ["admin strips filtered", good.replace("week.pins.map(", "shown.map(")],
    ["layoutId pill", good + "\n<motion.span layoutId=\"pill\" />"],
  ];
  for (const [name, src] of cases) {
    if (run(src).length === 0) selfFailures.push(`${name} not flagged`);
  }
  const commented = good + '\n// the old role="tablist" and layoutId pill are gone\n';
  if (run(commented).length !== 0) selfFailures.push("commented tokens wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1327/#4318 links filter chips self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(`ORCH-1327/#4318 links filter chips self-test PASS (${cases.length + 2}/${cases.length + 2} cases).`);
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1327/#4318 FAIL — target not found at ${TARGET}.`);
  process.exit(1);
}
const failures = [];
checkChips(fs.readFileSync(abs, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1327/#4318 (I-4318-LINKS-FILTER-CHIPS) FAIL — the /links filter chips must be\n" +
      "labelled toggle buttons (All, Events, Trips, Experiences) that never filter the admin\n" +
      "strips, and the retired tab model must not return.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log("ORCH-1327/#4318 PASS — /links filter chips are labelled toggle buttons; admin strips stay out of the filters; no tablist.");
