#!/usr/bin/env node
// MINGLA-INVARIANT: I-4339-LINKS-ADMIN-STRIPS-ONLY | issue #4339 | /links renders only the Admin Links strips (in Admin order, opened and tracked as strips); no filter chips, no city listings, and the old tab switcher never comes back.
/**
 * ORCH-1327 [links tab switcher swing] → #4318 [links city week] → #4339.
 *
 * HISTORY. ORCH-1327 pinned the Explorer / For Hosts tab switcher on /links.
 * #4318 replaced it with a city week and filter chips (I-4318-LINKS-FILTER-CHIPS).
 * #4339 removed the whole city section: /links now shows only the strips added
 * on the Links page in Mingla Admin, the two banners and the socials (Seth's
 * decision, 14 Nov 2026). The file keeps its name and MANIFEST row so the gate
 * count and self-test ratchets do not move; its invariant is re-pointed again.
 *
 * Invariant: I-4339-LINKS-ADMIN-STRIPS-ONLY. Over
 * mingla-marketing/components/marketing/links-experience.tsx (comment-stripped):
 *
 * REQUIRE
 *   1. the strips render straight from the Admin list: `pins.map(` inside the
 *      list labelled aria-label="From Mingla" (no re-sort, no filter).
 *   2. opening a strip is tracked: captureMarketing('links_strip_opened'.
 *
 * BAN
 *   - the #4318 city section: aria-label="Filter", aria-pressed={filter,
 *     'links_filter_changed', week.listings.
 *   - the retired tab model: role="tablist" / role="tab" / layoutId.
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

function checkLinks(rawSrc, failures) {
  const src = stripComments(rawSrc);

  if (!/aria-label="From Mingla"/.test(src) || !/\bpins\.map\(/.test(src)) {
    failures.push(`${TARGET}: the Admin strips must render with pins.map( inside the list labelled aria-label="From Mingla".`);
  }
  if (/\bpins\.(filter|sort)\(/.test(src)) {
    failures.push(`${TARGET}: the Admin strips must keep Admin order and never be filtered or re-sorted.`);
  }
  if (!/captureMarketing\('links_strip_opened'/.test(src)) {
    failures.push(`${TARGET}: opening a strip must fire links_strip_opened.`);
  }
  for (const [re, why] of [
    [/aria-label="Filter"/, 'aria-label="Filter" (the removed #4318 filter chips)'],
    [/aria-pressed=\{filter/, "aria-pressed={filter (the removed #4318 filter chips)"],
    [/links_filter_changed/, "links_filter_changed (the removed #4318 filter chips)"],
    [/week\.listings/, "week.listings (the removed #4318 city listings)"],
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
  const run = (s) => { const f = []; checkLinks(s, f); return f; };

  const good = `
<ul aria-label="From Mingla" ref={pinsRef}>
  {pins.map((pin) => strip({ type: 'pin', pin }, pin.id, 'pin'))}
</ul>
const open = () => captureMarketing('links_strip_opened', { kind: 'event' })
`;
  if (run(good).length !== 0) selfFailures.push("compliant page wrongly flagged: " + JSON.stringify(run(good)));

  const cases = [
    ["strips not rendered from pins", good.replace("pins.map(", "items.map(")],
    ["strips filtered", good.replace("pins.map(", "pins.filter((p) => p.live).map(")],
    ["strips re-sorted", good + "\nconst sorted = pins.sort(byDate)"],
    ["strip analytics dropped", good.replace("captureMarketing('links_strip_opened', { kind: 'event' })", "null")],
    ["filter chips back", good + '\n<div role="group" aria-label="Filter"></div>'],
    ["toggle chips back", good + "\n<button aria-pressed={filter === f.id} />"],
    ["filter analytics back", good + "\ncaptureMarketing('links_filter_changed', {})"],
    ["city listings back", good + "\n{week.listings.map((l) => row(l))}"],
    ["tablist re-added", good + '\n<div role="tablist"></div>'],
    ["layoutId pill", good + '\n<motion.span layoutId="pill" />'],
  ];
  for (const [name, src] of cases) {
    if (run(src).length === 0) selfFailures.push(`${name} not flagged`);
  }
  const commented = good + '\n// the old role="tablist", aria-label="Filter" chips and week.listings are gone\n';
  if (run(commented).length !== 0) selfFailures.push("commented tokens wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1327/#4339 links admin strips self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(`ORCH-1327/#4339 links admin strips self-test PASS (${cases.length + 2}/${cases.length + 2} cases).`);
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1327/#4339 FAIL — target not found at ${TARGET}.`);
  process.exit(1);
}
const failures = [];
checkLinks(fs.readFileSync(abs, "utf8"), failures);
if (failures.length > 0) {
  console.error(
    "ORCH-1327/#4339 (I-4339-LINKS-ADMIN-STRIPS-ONLY) FAIL — /links must render only the\n" +
      "Admin Links strips in Admin order, with no filter chips, no city listings and no tabs.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log("ORCH-1327/#4339 PASS — /links renders only the Admin strips in Admin order; no filter chips, city listings or tabs.");
