#!/usr/bin/env node
/**
 * ORCH-1256 [brand profile completion to-dos] — strict-grep gate.
 *
 * Invariant I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE: a filled
 * (non-blank after trim) brand-profile field NEVER shows its profile to-do
 * row, and the whole feature chain stays wired end-to-end. Guards (per
 * SPEC §9):
 *   (a) brandProfileCompleteness.ts exists; every predicate routes through
 *       the single isBlank, whose implementation contains .trim() (drop the
 *       trim → whitespace-only fields read as "filled" → false completeness
 *       signal, investigation F-2);
 *   (b) businessTodos.ts emits all 8 profile_add_* ids, gated behind
 *       input.profile (optional input — absent must mean zero rows);
 *   (c) BrandEditView.tsx carries the six section onLayout anchors + the
 *       initialSection prop (and NO anchor inside the META-ORCH-1255-owned
 *       PHYSICAL LOCATION block);
 *   (d) app/brand/[id]/edit.tsx reads + validates the ?section= param;
 *   (e) BusinessTodoToggle.tsx retains the bounded-list capacity marker
 *       (listBounded / maxHeight) so 11 rows can't bury the dashboard (F-4).
 *
 * Any revert of any leg fails the PR. Exit 0 clean, 1 on violation.
 * Supports --self-test.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const FILES = {
  completeness: "mingla-business/src/utils/brandProfileCompleteness.ts",
  todos: "mingla-business/src/utils/businessTodos.ts",
  view: "mingla-business/src/components/brand/BrandEditView.tsx",
  route: "mingla-business/app/brand/[id]/edit.tsx",
  toggle: "mingla-business/src/components/home/BusinessTodoToggle.tsx",
};

const PROFILE_IDS = [
  "profile_add_cover",
  "profile_add_photo",
  "profile_add_tagline",
  "profile_add_description",
  "profile_add_address",
  "profile_add_email",
  "profile_add_phone",
  "profile_add_socials",
];

const PREDICATES = [
  "needsCover",
  "needsPhoto",
  "needsTagline",
  "needsDescription",
  "needsAddress",
  "needsEmail",
  "needsPhone",
  "needsSocials",
];

const SECTIONS = ["photo", "about", "cover", "address", "contact", "social"];

/** @param {Record<keyof typeof FILES, string | null>} src */
function evaluate(src) {
  const violations = [];

  // (a) completeness util — single trim-based isBlank, all 8 predicates via it
  if (src.completeness === null) {
    violations.push(`${FILES.completeness} is MISSING (feature reverted?).`);
  } else {
    const c = src.completeness;
    if (!/export function isBlank\([\s\S]*?\.trim\(\)\.length === 0/.test(c)) {
      violations.push(
        "isBlank in brandProfileCompleteness.ts must trim (value.trim().length === 0) — " +
          "whitespace-only fields must count as EMPTY (F-2: address maps untrimmed).",
      );
    }
    for (const p of PREDICATES) {
      const re = new RegExp(`${p}:\\s*(?:isBlank\\(|SOCIAL_TODO_KEYS\\.every\\()`);
      if (!re.test(c)) {
        violations.push(
          `predicate ${p} must route through isBlank (or SOCIAL_TODO_KEYS.every(...isBlank) for needsSocials).`,
        );
      }
    }
    if (!c.includes('"threads",')) {
      violations.push(
        "SOCIAL_TODO_KEYS must enumerate all 8 named networks (threads missing).",
      );
    }
  }

  // (b) band 6 in businessTodos.ts — all 8 ids, gated behind input.profile
  if (src.todos === null) {
    violations.push(`${FILES.todos} is MISSING.`);
  } else {
    const t = src.todos;
    for (const id of PROFILE_IDS) {
      if (!t.includes(`"${id}"`)) {
        violations.push(`businessTodos.ts band 6 must emit id "${id}".`);
      }
    }
    if (!t.includes("input.profile !== undefined")) {
      violations.push(
        "businessTodos.ts band 6 must be gated behind `input.profile !== undefined` " +
          "(optional input — absent means zero profile rows, protecting legacy callers/tests).",
      );
    }
    if (!/profile\?:\s*BusinessTodoProfileInput/.test(t)) {
      violations.push(
        "BusinessTodoInput.profile must stay OPTIONAL (`profile?: BusinessTodoProfileInput & { editRoute: string }`).",
      );
    }
  }

  // (c) BrandEditView anchors + initialSection, none in the 1255 block
  if (src.view === null) {
    violations.push(`${FILES.view} is MISSING.`);
  } else {
    const v = src.view;
    if (!v.includes("initialSection?: BrandEditSection")) {
      violations.push("BrandEditView must declare `initialSection?: BrandEditSection`.");
    }
    for (const s of SECTIONS) {
      if (!v.includes(`onLayout={handleSectionLayout("${s}")}`)) {
        violations.push(
          `BrandEditView must anchor section "${s}" via onLayout={handleSectionLayout("${s}")}.`,
        );
      }
    }
    const labelMarker = "<Text style={styles.sectionLabel}>PHYSICAL LOCATION</Text>";
    const start = v.indexOf(labelMarker);
    const end = v.indexOf("SECTION B — About");
    if (start !== -1 && end > start) {
      const block = v.slice(start, end);
      if (block.includes("onLayout") || block.includes("handleSectionLayout")) {
        violations.push(
          "The PHYSICAL LOCATION block is META-ORCH-1255 territory — it must carry NO ORCH-1256 anchor.",
        );
      }
    }
  }

  // (d) route wrapper reads + validates ?section=
  if (src.route === null) {
    violations.push(`${FILES.route} is MISSING.`);
  } else {
    const r = src.route;
    if (!r.includes("section?: string | string[]")) {
      violations.push("edit.tsx must read the `section` search param (string | string[]).");
    }
    if (!r.includes("isBrandEditSection(")) {
      violations.push(
        "edit.tsx must validate the section param against the closed BrandEditSection set.",
      );
    }
    if (!r.includes("initialSection={initialSection}")) {
      violations.push("edit.tsx must pass initialSection into <BrandEditView>.");
    }
  }

  // (e) bounded toggle list
  if (src.toggle === null) {
    violations.push(`${FILES.toggle} is MISSING.`);
  } else {
    const g = src.toggle;
    if (!g.includes("styles.listBounded") || !/listBounded:\s*\{\s*maxHeight:\s*\d+/.test(g)) {
      violations.push(
        "BusinessTodoToggle must keep the bounded-list capacity fix " +
          "(styles.listBounded with a numeric maxHeight) — the toggle mounts above the " +
          "screen scroll area and 11 rows would bury the dashboard (F-4).",
      );
    }
  }

  return violations;
}

function selfTest() {
  const good = {
    completeness:
      'export function isBlank(value) {\n  return value == null || value.trim().length === 0;\n}\n' +
      'export const SOCIAL_TODO_KEYS = ["website","instagram","tiktok","x","facebook","youtube","linkedin",\n  "threads",\n];\n' +
      PREDICATES.filter((p) => p !== "needsSocials")
        .map((p) => `    ${p}: isBlank(x),`)
        .join("\n") +
      "\n    needsSocials: SOCIAL_TODO_KEYS.every((key) => isBlank(y)),",
    todos:
      "profile?: BusinessTodoProfileInput & { editRoute: string };\n" +
      "if (input.profile !== undefined) {\n" +
      PROFILE_IDS.map((id) => `  todos.push({ id: "${id}" });`).join("\n") +
      "\n}",
    view:
      "initialSection?: BrandEditSection;\n" +
      SECTIONS.map((s) => `<X onLayout={handleSectionLayout("${s}")} />`).join("\n") +
      "\n<Text style={styles.sectionLabel}>PHYSICAL LOCATION</Text>\n<InlineToggle />\n{/* SECTION B — About */}",
    route:
      "section?: string | string[];\nisBrandEditSection(sectionParam)\ninitialSection={initialSection}",
    toggle: "style={[styles.list, styles.listBounded]}\nlistBounded: {\n    maxHeight: 320,\n  },",
  };

  const cases = [
    ["good passes", evaluate(good).length === 0],
    [
      "missing trim fails",
      evaluate({
        ...good,
        completeness: good.completeness.replace(
          "value.trim().length === 0",
          "value.length === 0",
        ),
      }).length > 0,
    ],
    [
      "predicate bypassing isBlank fails",
      evaluate({
        ...good,
        completeness: good.completeness.replace(
          "needsAddress: isBlank(x),",
          "needsAddress: x == null,",
        ),
      }).length > 0,
    ],
    [
      "band-6 id removed fails",
      evaluate({
        ...good,
        todos: good.todos.replace('  todos.push({ id: "profile_add_socials" });', ""),
      }).length > 0,
    ],
    [
      "required profile input fails",
      evaluate({
        ...good,
        todos: good.todos.replace(
          "profile?: BusinessTodoProfileInput",
          "profile: BusinessTodoProfileInput",
        ),
      }).length > 0,
    ],
    [
      "missing anchor fails",
      evaluate({
        ...good,
        view: good.view.replace('<X onLayout={handleSectionLayout("cover")} />', ""),
      }).length > 0,
    ],
    [
      "anchor inside 1255 block fails",
      evaluate({
        ...good,
        view: good.view.replace(
          "<InlineToggle />",
          '<InlineToggle onLayout={handleSectionLayout("about")} />',
        ),
      }).length > 0,
    ],
    [
      "route not validating fails",
      evaluate({
        ...good,
        route: good.route.replace("isBrandEditSection(sectionParam)", "sectionParam"),
      }).length > 0,
    ],
    [
      "unbounded toggle list fails",
      evaluate({ ...good, toggle: "style={styles.list}" }).length > 0,
    ],
    ["missing file fails", evaluate({ ...good, completeness: null }).length > 0],
  ];

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error(
      `[ORCH-1256 — orch-1256-profile-todos-no-false-positive] SELF-TEST FAIL: ${failed
        .map(([name]) => name)
        .join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `[ORCH-1256 — orch-1256-profile-todos-no-false-positive] SELF-TEST PASS (${cases.length}/${cases.length})`,
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

/** @returns {string | null} */
function readOrNull(rel) {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

const violations = evaluate({
  completeness: readOrNull(FILES.completeness),
  todos: readOrNull(FILES.todos),
  view: readOrNull(FILES.view),
  route: readOrNull(FILES.route),
  toggle: readOrNull(FILES.toggle),
});

if (violations.length > 0) {
  console.error(
    "\n[ORCH-1256 — orch-1256-profile-todos-no-false-positive] VIOLATIONS:\n",
  );
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    "\nI-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE: a filled profile field " +
      "must never show its to-do row, and the profile-todo chain (predicates → " +
      "band 6 → deep-link anchors → bounded list) must stay wired.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1256 — orch-1256-profile-todos-no-false-positive] PASS — trim-blank " +
    "predicates, band-6 rows, section anchors, param validation and the bounded " +
    "list are all in place.",
);
process.exit(0);
