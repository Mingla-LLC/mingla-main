#!/usr/bin/env node
/**
 * ORCH-1256 [brand profile completion to-dos] — strict-grep gate.
 *
 * Invariant I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE: a filled
 * brand-profile field NEVER shows its profile to-do row, and the whole
 * feature chain stays wired end-to-end.
 *
 * #3355 P5 rewrote leg (a)/(b): "filled" is now the SERVER's answer
 * (brand_readiness, I-BRAND-READINESS-SINGLE-SOURCE). The Host no longer
 * derives profile completeness itself, so the old trim-predicate file is
 * gone and must stay gone. Guards:
 *   (a) brandProfileCompleteness.ts does NOT exist and no Host source
 *       derives profile rows client-side (deriveBrandProfileTodoInput);
 *   (b) businessTodos.ts emits the 8 ORCH-1256 profile_add_* ids from the
 *       HOME_READINESS_ROWS map, shows a row only while its readiness item
 *       is not done (isReadinessDone), and is gated behind the OPTIONAL
 *       input.brandReadiness (absent must mean zero rows);
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
  // #3355 P5 — must NOT exist (client-side derivation retired).
  completeness: "mingla-business/src/utils/brandProfileCompleteness.ts",
  hook: "mingla-business/src/hooks/useBusinessTodos.ts",
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


const SECTIONS = ["photo", "about", "cover", "address", "contact", "social"];

/** @param {Record<keyof typeof FILES, string | null>} src */
function evaluate(src) {
  const violations = [];

  // (a) no client-side profile derivation (#3355 P5)
  if (src.completeness !== null) {
    violations.push(
      `${FILES.completeness} must not exist — profile completeness is the server's ` +
        "brand_readiness answer (I-BRAND-READINESS-SINGLE-SOURCE).",
    );
  }
  if (src.hook === null) {
    violations.push(`${FILES.hook} is MISSING.`);
  } else {
    if (src.hook.includes("deriveBrandProfileTodoInput")) {
      violations.push("useBusinessTodos must not derive profile rows client-side.");
    }
    if (!src.hook.includes("useBrandReadiness(")) {
      violations.push("useBusinessTodos must read the canonical useBrandReadiness.");
    }
  }

  // (b) band 6 in businessTodos.ts — all 8 ids, from readiness, gated
  if (src.todos === null) {
    violations.push(`${FILES.todos} is MISSING.`);
  } else {
    const t = src.todos;
    for (const id of PROFILE_IDS) {
      if (!t.includes(`id: "${id}"`)) {
        violations.push(`businessTodos.ts HOME_READINESS_ROWS must map id "${id}".`);
      }
    }
    if (!t.includes("isReadinessDone(item.state)")) {
      violations.push(
        "businessTodos.ts band 6 must skip items the server reports done " +
          "(isReadinessDone(item.state)) — a filled field must never show its row.",
      );
    }
    if (!t.includes('readiness?.status === "ready"')) {
      violations.push(
        "businessTodos.ts band 6 must be gated behind a ready `input.brandReadiness`.",
      );
    }
    if (!/brandReadiness\?:\s*BusinessTodoBrandReadiness/.test(t)) {
      violations.push(
        "BusinessTodoInput.brandReadiness must stay OPTIONAL (`brandReadiness?: BusinessTodoBrandReadiness`).",
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
    completeness: null,
    hook: "const readinessQuery = useBrandReadiness(readinessBrandId);",
    todos:
      "brandReadiness?: BusinessTodoBrandReadiness;\n" +
      PROFILE_IDS.map((id) => `  { key: "k", id: "${id}" },`).join("\n") +
      '\n} else if (readiness?.status === "ready" && !readiness.hideBrandRows) {\n' +
      "  if (item === undefined || isReadinessDone(item.state)) continue;\n}",
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
      "client-side completeness file back fails",
      evaluate({ ...good, completeness: "export function isBlank() {}" }).length > 0,
    ],
    [
      "hook deriving profile rows fails",
      evaluate({
        ...good,
        hook: good.hook + "\nderiveBrandProfileTodoInput(currentBrand)",
      }).length > 0,
    ],
    [
      "hook not reading readiness fails",
      evaluate({ ...good, hook: "const x = 1;" }).length > 0,
    ],
    [
      "done items not skipped fails",
      evaluate({
        ...good,
        todos: good.todos.replace("isReadinessDone(item.state)", "false"),
      }).length > 0,
    ],
    [
      "band-6 id removed fails",
      evaluate({
        ...good,
        todos: good.todos.replace('  { key: "k", id: "profile_add_socials" },', ""),
      }).length > 0,
    ],
    [
      "required readiness input fails",
      evaluate({
        ...good,
        todos: good.todos.replace(
          "brandReadiness?: BusinessTodoBrandReadiness",
          "brandReadiness: BusinessTodoBrandReadiness",
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
    ["missing file fails", evaluate({ ...good, todos: null }).length > 0],
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
  hook: readOrNull(FILES.hook),
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
      "must never show its to-do row, and the profile-todo chain (server " +
      "readiness → band 6 → deep-link anchors → bounded list) must stay wired.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1256 — orch-1256-profile-todos-no-false-positive] PASS — server " +
    "readiness rows, band-6 ids, section anchors, param validation and the " +
    "bounded list are all in place.",
);
process.exit(0);
