#!/usr/bin/env node
// MINGLA-INVARIANT: I-4238-HOST-ADS-WIRING | issue #4238 | The Host ads screens' structural wiring (the phone builder's keyboard dock and Leave sheet, the rejected-ad dock, the Promote list's floating-button clearance, the inline age error) stays in place.
/**
 * issue #4238 — Host ads screens: structural wiring rules.
 * Invariant: I-4238-HOST-ADS-WIRING.
 *
 * WHY. These rules were jest files asserting on source text.
 * I-PROPOSED-1047-NO-SOLE-SOURCE-PIN forbids new jest source pins and names an additive
 * strict-grep gate as the replacement for a genuine structural rule. Behaviour
 * (pure helpers, rendered components) stays in jest; this is the structural half.
 *
 * RULE. Every entry in RULES names one file (relative to mingla-business/),
 * optionally a slice (first `from` marker to the next `to` marker after it),
 * and `has` (must contain / match) and/or `lacks` (must not). A missing file
 * or slice marker FAILS, so a rename cannot make a rule go dark.
 *
 * DOES NOT CATCH: behaviour. A rule proves the wiring text is present, not
 * that it runs; the jest suites named in each rule's `why` own that.
 *
 * `--self-test` drives the pure checker with fixtures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUSINESS = path.join(ROOT, "mingla-business");

/** @typedef {{ file: string, why: string, from?: string, to?: string, has?: Array<string|RegExp>, lacks?: Array<string|RegExp> }} Rule */

/** @type {Rule[]} */
export const RULES = [
  {
    file: "src/screens/hostAds/HostAdCreateScreen.tsx",
    why: "the phone builder's dock steps aside on Android through shouldHideHostAdDock (behaviour: issue_4238_rework6), and hardware back / iOS swipe go through the Leave sheet",
    has: [
      "shouldHideHostAdDock(Platform.OS, keyboardOpen)",
      "{dockHiddenForKeyboard ? null : (",
      'from "../../wrappers/useKeyboardIsVisible"',
      'navigation.addListener("beforeRemove"',
      'setSheet("leave")',
      "sanctionedExitRef.current = true;",
    ],
  },
  {
    file: "src/screens/hostAds/HostAdDetailScreen.tsx",
    from: 'testID="ads-detail-rejected-dock"',
    to: 'testID="ads-detail-rejected-change"',
    why: "the rejected-ad dock stacks full-width buttons",
    has: ["fullWidth"],
    lacks: ["styles.flex"],
  },
  {
    file: "src/screens/hostAds/HostAdListScreen.tsx",
    why: "the Promote list keeps its floating-button clearance",
    has: ["hostAdScrollBottomPadding(useStickyFooterOffset())"],
  },
  {
    file: "src/screens/hostAds/HostAdCreateScreen.tsx",
    why: "P3-1 (iOS and Android): the age error shows inline and the scroll gets the Done-bar offset (behaviour: issue_4238_ios_age_error_offset)",
    has: [/hostAdErrorLineBottomOffset\(\s*Platform\.OS,\s*DONE_BAR_OCCUPIED/, 'testID="host-ad-age-error"', "{...scrollOffsetProps}"],
  },
];

const label = (p) => (p instanceof RegExp ? String(p) : JSON.stringify(p));
const hit = (text, p) => (p instanceof RegExp ? p.test(text) : text.includes(p));

/** Pure checker: problem strings for one rule against `read(file)` (null = missing). */
export function checkRule(rule, read) {
  const problems = [];
  const src = read(rule.file);
  if (src === null) return [`${rule.file}: file is missing (${rule.why})`];
  let text = src;
  if (rule.from !== undefined) {
    const start = src.indexOf(rule.from);
    const end = start === -1 ? -1 : src.indexOf(rule.to ?? "", start + rule.from.length);
    if (start === -1 || end === -1) return [`${rule.file}: slice marker ${JSON.stringify(start === -1 ? rule.from : rule.to)} not found (${rule.why})`];
    text = src.slice(start, end);
  }
  for (const p of rule.has ?? []) if (!hit(text, p)) problems.push(`${rule.file}: missing ${label(p)} — ${rule.why}`);
  for (const p of rule.lacks ?? []) if (hit(text, p)) problems.push(`${rule.file}: forbidden ${label(p)} — ${rule.why}`);
  return problems;
}

if (process.argv.includes("--self-test")) {
  const files = { "a.ts": "const x = 1;\nexport const dock = { bg: color.canvas };\nfoo();", "b.ts": "accent here" };
  const read = (f) => (f in files ? files[f] : null);
  const cases = [
    ["present string passes", { file: "a.ts", why: "w", has: ["const x = 1;"] }, 0],
    ["matching regex passes", { file: "a.ts", why: "w", has: [/foo\(\)/] }, 0],
    ["absent string fails", { file: "a.ts", why: "w", has: ["const y"] }, 1],
    ["forbidden regex fails", { file: "b.ts", why: "w", lacks: [/\baccent\b/] }, 1],
    ["missing file fails", { file: "gone.ts", why: "w", has: ["x"] }, 1],
    ["slice scopes the check", { file: "a.ts", why: "w", from: "export const dock", to: "};", has: ["color.canvas"], lacks: ["foo()"] }, 0],
    ["missing slice marker fails", { file: "a.ts", why: "w", from: "export const nope", to: "};", has: ["x"] }, 1],
  ];
  const failures = cases.filter(([, rule, want]) => (checkRule(rule, read).length > 0 ? 1 : 0) !== want).map(([name]) => name);
  if (failures.length) {
    console.error(`#4238 host-ads-wiring self-test FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`#4238 host-ads-wiring self-test PASS (${cases.length} cases)`);
  process.exit(0);
}

const readBiz = (rel) => {
  const abs = path.join(BUSINESS, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
};
const problems = RULES.flatMap((rule) => checkRule(rule, readBiz));
if (problems.length) {
  console.error(`FAIL [I-4238-HOST-ADS-WIRING]: ${problems.length} wiring rule(s) broken:`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}
console.log(`OK [I-4238-HOST-ADS-WIRING]: ${RULES.length} wiring rules hold.`);
