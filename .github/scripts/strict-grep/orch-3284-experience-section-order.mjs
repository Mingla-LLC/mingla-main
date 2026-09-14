#!/usr/bin/env node
/**
 * Issue #3284 [refund terms on events and experiences] —
 * I-3284-CANONICAL-10-SECTION-ORDER, experience page.
 *
 * The shared `ExperienceOfferingBody` renders the public experience page in a
 * locked order, and until #3284 nothing pinned any of it: two sections had
 * already slipped in undocumented, and #3284 inserts the cancellation policy next
 * to the trailing children, which are the easiest place to break. This gate
 * asserts the body emits its section markers in order, anchored on stable
 * section comments and testIDs in packages/offering-rendering/ExperienceOfferingBody.tsx
 * (first occurrence in raw source):
 *
 *   (2)  N-stop eyebrow + title
 *   (3)  Meta chips
 *   (4)  Vibe chips
 *   (5)  Presented By
 *   (6)  Adaptive availability banner
 *   (7)  About
 *   (8)  The itinerary
 *   (9)  Where you'll start
 *   (10) Cancellation policy   → comment + testID "experience-body-cancellation"
 *   (11) Price card            → comment + testID "experience-body-price-card"
 *        All-in reassurance line (the price card's footnote — never separated
 *        from the price by the terms)
 *        dockedReserve         → always the LAST child
 *
 * Also REQUIRED: the body mounts OfferingRefundLadder with
 * offeringType="experience" (never trip or event copy).
 *
 * Why the cancellation policy sits immediately before the price card: the
 * experience page ends with its commitment block (price card + docked reserve),
 * so the policy is the last content section before payment — the same rule the
 * trip page follows (design part 1 §3.7–3.8).
 *
 * Fails if any anchor is missing, the anchors are out of order, or a required
 * token is absent. `--self-test` proves that swapping cancellation and the price
 * card, moving the reassurance line above the price card, and dropping the ladder
 * each trip the gate, and that a correctly ordered body passes.
 *
 * Exit codes: 0 — clean (or self-test proven) · 1 — violation.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const BODY = "packages/offering-rendering/ExperienceOfferingBody.tsx";

// Ordered anchors: [label, needle searched in raw source, first-occurrence index].
const ANCHORS = [
  ["(2) N-stop eyebrow + title", "(2) N-stop eyebrow"],
  ["(3) Meta chips", "(3) Meta chips"],
  ["(4) Vibe chips", "(4) Vibe chips"],
  ["(5) Presented By", "(5) Presented By"],
  ["(6) Adaptive availability", "(6) Adaptive availability"],
  ["(7) About", "(7) About"],
  ["(8) The itinerary", "(8) The itinerary"],
  ["(9) Where you'll start", "(9) Where you"],
  ["(10) Cancellation policy", "(10) Cancellation policy"],
  ["(10) cancellation anchor", 'testID="experience-body-cancellation"'],
  ["(11) Price card", "(11) Price card"],
  ["(11) price card anchor", 'testID="experience-body-price-card"'],
  ["all-in reassurance line", "All-in price — taxes"],
  ["docked reserve (last child)", "dockedReserve !== undefined ? dockedReserve"],
];

// Tokens that must appear in the body's active code (comments stripped).
const REQUIRED = [
  [/\bOfferingRefundLadder\b/, "the body must mount the shared OfferingRefundLadder (#3284)."],
  [/offeringType="experience"/, 'the ladder must receive offeringType="experience" (#3284).'],
];

const stripComments = (src) =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function check(src, label) {
  const failures = [];
  let prev = -1;
  let prevName = "<start>";
  for (const [name, needle] of ANCHORS) {
    const idx = src.indexOf(needle);
    if (idx === -1) {
      failures.push(`${label}: missing section anchor ${name} ("${needle}").`);
      continue;
    }
    if (idx < prev) {
      failures.push(
        `${label}: ${name} appears BEFORE ${prevName} — the canonical experience ` +
          "section order (I-3284-CANONICAL-10-SECTION-ORDER) was reordered.",
      );
    }
    prev = idx;
    prevName = name;
  }
  const code = stripComments(src);
  for (const [re, why] of REQUIRED) {
    if (!re.test(code)) failures.push(`${label}: REQUIRED — ${why}`);
  }
  return failures;
}

function runSelfTest() {
  const mount = '<OfferingRefundLadder offeringType="experience" />';
  const lines = (needles) => [...needles.map((n) => `// ${n}`), mount].join("\n");
  const ordered = ANCHORS.map(([, needle]) => needle);

  const swap = (list, a, b) => {
    const copy = [...list];
    const i = copy.indexOf(a);
    const j = copy.indexOf(b);
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  };

  const cases = [
    { name: "correctly ordered body", src: lines(ordered), expectFail: false },
    {
      name: "cancellation swapped with the price card",
      src: lines(
        swap(
          swap(ordered, 'testID="experience-body-cancellation"', 'testID="experience-body-price-card"'),
          "(10) Cancellation policy",
          "(11) Price card",
        ),
      ),
      expectFail: true,
    },
    {
      name: "reassurance line moved above the price card",
      src: lines(swap(ordered, "All-in price — taxes", 'testID="experience-body-price-card"')),
      expectFail: true,
    },
    {
      name: "docked reserve no longer last",
      src: lines(swap(ordered, "dockedReserve !== undefined ? dockedReserve", "All-in price — taxes")),
      expectFail: true,
    },
    {
      name: "cancellation anchor missing",
      src: lines(ordered.filter((n) => n !== 'testID="experience-body-cancellation"')),
      expectFail: true,
    },
    {
      name: "ladder not mounted",
      src: ordered.map((n) => `// ${n}`).join("\n"),
      expectFail: true,
    },
    {
      name: "ladder mounted with trip copy",
      src: [...ordered.map((n) => `// ${n}`), "<OfferingRefundLadder />"].join("\n"),
      expectFail: true,
    },
  ];

  const broken = [];
  for (const { name, src, expectFail } of cases) {
    const failed = check(src, `synthetic: ${name}`).length > 0;
    if (failed !== expectFail) {
      broken.push(
        expectFail
          ? `"${name}" did NOT trip the gate.`
          : `"${name}" wrongly tripped the gate.`,
      );
    }
  }
  if (broken.length > 0) {
    console.error("\n#3284 experience-section-order gate SELF-TEST FAILED:\n");
    for (const b of broken) console.error(`  ✗ ${b}`);
    process.exit(1);
  }
  console.log(
    `#3284 experience-section-order gate SELF-TEST PASS (${cases.length} cases).`,
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const path = join(ROOT, BODY);
  if (!existsSync(path)) {
    console.error(`#3284 experience-section-order gate FAILED: ${BODY} missing.`);
    process.exit(1);
  }
  const failures = check(readFileSync(path, "utf8"), BODY);
  if (failures.length > 0) {
    console.error("\n#3284 experience-section-order gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("#3284 experience-section-order gate PASS.");
}
