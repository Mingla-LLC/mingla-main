#!/usr/bin/env node
/**
 * Issue #1607 — Explorer deck guard-integrity catalog and executable-wiring gate.
 *
 * Each catalog row states the guard's honest protection model and boundary. The
 * checker fails closed when disk/catalog differ, when YAML prose is the only
 * reference, when a workflow merely checks existence, when #1481's two sets are
 * not the same exact eight, or when the release-hotpath guard loses its
 * structural current-card window. `--self-test` attacks each failure separately.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const DECK_DIR = "app-mobile/src/components/swipeDeck/__tests__";
const RELEASE_GUARD = `${DECK_DIR}/issue_1481_release_hotpath.test.mjs`;

const row = (file, model, boundary) => ({ file: `${DECK_DIR}/${file}`, model, boundary });

// Machine-readable, complete inventory. Protection claims are deliberately
// bounded: structural tests claim source topology, independent oracles claim
// their measured domain, and harnesses claim only their replayed transition.
export const DECK_GUARD_CATALOG = Object.freeze([
  row("issue_1481_native_admission.adversarial.test.mjs", "real-source mutation", "native admission seams and rejected bypass mutants"),
  row("issue_1481_native_admission.test.mjs", "real-source structure plus harness", "admission cardinality and native gesture ownership"),
  row("issue_1481_performance_hotpath.adversarial.test.mjs", "real-source mutation", "bounded hot-path work and rejected reintroduction mutants"),
  row("issue_1481_performance_hotpath.test.mjs", "real-source structure plus synthetic cadence", "swipe hot-path allocations, persistence, and cadence bounds"),
  row("issue_1481_release_hotpath.adversarial.test.mjs", "real-source mutation", "release settlement ordering and poster-ownership counterexamples"),
  row("issue_1481_release_hotpath.test.mjs", "real-source structure plus independent harness", "release settlement and structurally bounded current-card poster ownership"),
  row("issue_1481_swipe_lifecycle.adversarial.test.mjs", "real-source mutation", "lifecycle transition bypass and duplicate-work mutants"),
  row("issue_1481_swipe_lifecycle.test.mjs", "real-source structure plus state harness", "single-owner swipe lifecycle and exact settlement work"),
  row("issue_1576_promoted_card_opacity.adversarial.test.mjs", "transplanted real-body mutation", "promoted-card opacity bridge and known broken bodies"),
  row("issue_1576_promoted_card_opacity.test.mjs", "real-source extraction plus harness", "promoted-card opacity reset and transition boundary"),
  row("issue_1579_tap_expand_admission.adversarial.test.mjs", "transplanted real-body mutation", "tap-expand admission bridge and cancellation mutants"),
  row("issue_1579_tap_expand_admission.test.mjs", "real-source extraction plus transition harness", "tap-expand admission ordering and one-shot expansion"),
  row("issue_1593_poster_hole_geometry.adversarial.test.mjs", "independent geometry oracle", "poster-hole geometry counterexamples across card states"),
  row("issue_1593_poster_hole_geometry.test.mjs", "real-source structure plus geometry oracle", "poster coverage and layer geometry"),
  row("issue_1609_collapsed_card_scrim_and_geometry.test.mjs", "independent contrast and geometry oracle", "collapsed-card scrim, plate, and title silhouettes"),
  row("issue_1609_direction_c_plate.test.mjs", "comment-stripped real-source structure", "Direction-C plate content, ordering, and ownership"),
  row("issue_1609_liquid_glass_and_scrim_presence.test.mjs", "comment-stripped source plus oracle", "liquid-glass presence and measured scrim contract"),
  row("issue_1609_plate_anchor_wiring.test.mjs", "comment-stripped real-source structure", "plate anchors and shared descriptor wiring"),
  row("issue_1609_short_plate_keeps_chevron.test.mjs", "comment-stripped real-source structure", "short-plate chevron and no-meta silhouette"),
  row("issue_1609_silhouette_anchor_drift.adversarial.test.mjs", "independent geometry mutation", "silhouette anchor drift counterexamples"),
  row("issue_1609_top_scrim_chrome_contrast.test.mjs", "independent contrast oracle", "top-scrim chrome contrast against worst-case imagery"),
  row("issue_1700_wrapping_law.adversarial.test.mjs", "comment-stripped render wiring", "span wrapping, measurement ownership, and render clamps"),
  row("issue_1700_wrapping_law.test.mjs", "independent geometry and color oracle", "two-line wrapping silhouettes under current #1615/#1714 boundaries"),
  row("issue_1701_dark_card_edges.test.mjs", "comment-stripped real-source structure", "transparent shadow host and clipped rounded child"),
  row("issue_1701_details_and_travel_time.adversarial.test.mjs", "independent geometry and contrast oracle", "details-control fit/contrast and non-fabricated travel time"),
  row("issue_1701_details_and_travel_time.test.mjs", "comment-stripped render wiring", "details affordance routing and travel-time span order"),
]);

export function stripYamlComments(source) {
  return source.split("\n").map((line) => {
    let single = false;
    let double = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === "'" && !double) single = !single;
      else if (char === '"' && !single && line[index - 1] !== "\\") double = !double;
      else if (char === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

function runBlocks(source) {
  const lines = stripYamlComments(source).split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const marker = match[2].trim();
    if (!/^[|>][+-]?$/.test(marker)) { blocks.push(marker); continue; }
    const body = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (next.trim() && next.match(/^\s*/)[0].length <= indent) break;
      body.push(next.slice(Math.min(next.length, indent + 2)));
      index += 1;
    }
    blocks.push(marker.startsWith(">") ? body.map((line) => line.trim()).join(" ") : body.join("\n"));
  }
  return blocks;
}

function referencedSets(workflows) {
  const required = new Set();
  const tested = new Set();
  const byWorkflow = {};
  for (const [name, source] of Object.entries(workflows)) {
    const workflowRequired = new Set();
    const workflowTested = new Set();
    for (const block of runBlocks(source)) {
      const shell = block.replace(/\\\s*\n/g, " ");
      for (const match of shell.matchAll(/(?:^|[;&|\n]\s*)test\s+-f\s+([^\s;&|]+)/g)) {
        required.add(match[1]);
        workflowRequired.add(match[1]);
      }
      for (const command of shell.split(/\n|&&|\|\||;/)) {
        if (!/(?:^|\s)node\s+--test(?:\s|$)/.test(command)) continue;
        for (const token of command.trim().split(/\s+/)) {
          if (token.endsWith(".test.mjs")) { tested.add(token); workflowTested.add(token); }
        }
      }
    }
    byWorkflow[name] = { required: workflowRequired, tested: workflowTested };
  }
  return { required, tested, byWorkflow };
}

function count(source, token) {
  return source.split(token).length - 1;
}

export function checkExplorerGuardIntegrity({ diskFiles, catalog = DECK_GUARD_CATALOG, workflows, releaseHotpathSource }) {
  const failures = [];
  const catalogFiles = catalog.map(({ file }) => file);
  if (catalog.length !== 26) failures.push(`catalog: expected 26 rows, found ${catalog.length}`);
  if (new Set(catalogFiles).size !== catalogFiles.length) failures.push("catalog: duplicate file entry");
  for (const entry of catalog) {
    if (!entry.model?.trim() || !entry.boundary?.trim()) failures.push(`catalog: ${entry.file} lacks model/boundary`);
  }
  const disk = [...diskFiles].sort();
  const declared = [...catalogFiles].sort();
  if (JSON.stringify(disk) !== JSON.stringify(declared)) failures.push("inventory: disk/catalog mismatch");

  const refs = referencedSets(workflows);
  for (const file of declared) {
    if (!refs.required.has(file)) failures.push(`wiring: ${file} lacks executable test -f`);
    if (!refs.tested.has(file)) failures.push(`wiring: ${file} is not passed to node --test`);
  }

  const exact = new Set(declared.filter((file) => /\/issue_1481_/.test(file)));
  const workflow1481 = refs.byWorkflow["ci-batch:issue-1481-explorer-deck-tests"] ?? { required: new Set(), tested: new Set() };
  const only1481 = (set) => new Set([...set].filter((file) => /\/issue_1481_/.test(file)));
  for (const [label, actual] of [["require", only1481(workflow1481.required)], ["run", only1481(workflow1481.tested)]]) {
    if (actual.size !== 8 || [...actual].some((file) => !exact.has(file)) || [...exact].some((file) => !actual.has(file))) {
      failures.push(`#1481 exact-eight ${label} set drifted`);
    }
  }

  const executableGuard = stripYamlComments(releaseHotpathSource ?? "");
  const structuralTokens = [
    "const currentStartToken = '<GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>';",
    "const currentEndToken = '</GestureDetector>';",
    "currentStart >= 0 && currentEnd > currentStart",
    "current.length > 5000 && current.length < 30000",
  ];
  if (structuralTokens.some((token) => !executableGuard.includes(token)) || count(executableGuard, "swipeableSource.indexOf(currentEndToken") !== 1) {
    failures.push("release-hotpath: structural current-card anchor/anti-vacuity contract missing");
  }
  return failures;
}

function fixture() {
  const catalog = DECK_GUARD_CATALOG.map((entry) => ({ ...entry }));
  const first = catalog.filter(({ file }) => file.includes("/issue_1481_"));
  const rest = catalog.filter(({ file }) => !file.includes("/issue_1481_"));
  const workflow = (rows) => `jobs:\n  test:\n    steps:\n      - name: require\n        run: |\n${rows.map(({ file }) => `          test -f ${file}`).join("\n")}\n      - name: execute\n        run: >-\n          node --test ${rows.map(({ file }) => file).join(" ")}\n`;
  return {
    diskFiles: catalog.map(({ file }) => file),
    catalog,
    workflows: {
      "ci-batch:issue-1481-explorer-deck-tests": workflow(first),
      "deck-others.yml": workflow(rest),
    },
    releaseHotpathSource: `
      const currentStartToken = '<GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>';
      const currentEndToken = '</GestureDetector>';
      const currentStart = swipeableSource.indexOf(currentStartToken);
      const currentEnd = swipeableSource.indexOf(currentEndToken, currentStart + currentStartToken.length);
      assert.ok(currentStart >= 0 && currentEnd > currentStart);
      assert.ok(current.length > 5000 && current.length < 30000);
    `,
  };
}

function selfTest() {
  const good = fixture();
  const goodFailures = checkExplorerGuardIntegrity(good);
  if (goodFailures.length) throw new Error(`GOOD fixture rejected: ${goodFailures.join("; ")}`);
  const expect = (name, value, pattern) => {
    const failures = checkExplorerGuardIntegrity(value);
    if (!failures.some((failure) => pattern.test(failure))) throw new Error(`${name} BAD fixture accepted: ${failures.join("; ")}`);
  };
  const orphan = fixture();
  const victim = orphan.catalog.at(-1).file;
  orphan.workflows["deck-others.yml"] = orphan.workflows["deck-others.yml"].split(victim).join("orphan.test.mjs");
  expect("orphan", orphan, /wiring:/);
  const commentOnly = fixture();
  commentOnly.workflows["deck-others.yml"] = `# ${commentOnly.catalog[8].file}\n`;
  expect("comment-only", commentOnly, /wiring:/);
  const existenceOnly = fixture();
  existenceOnly.workflows["deck-others.yml"] = existenceOnly.workflows["deck-others.yml"].replace(/node --test[^\n]*/, "node --test unrelated.test.mjs");
  expect("existence-only", existenceOnly, /not passed to node --test/);
  const inventory = fixture();
  inventory.diskFiles.push(`${DECK_DIR}/inventory-drift.test.mjs`);
  expect("inventory drift", inventory, /disk\/catalog mismatch/);
  const exactEight = fixture();
  exactEight.workflows["ci-batch:issue-1481-explorer-deck-tests"] += `\n      - name: ninth\n        run: |\n          test -f ${DECK_DIR}/issue_1481_ninth.test.mjs\n          node --test ${DECK_DIR}/issue_1481_ninth.test.mjs\n`;
  expect("exact-eight drift", exactEight, /exact-eight/);
  const structural = fixture();
  structural.releaseHotpathSource = structural.releaseHotpathSource.replace("'<GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>'", "'{/* Current Card */}'");
  expect("bad structural anchor", structural, /structural current-card/);
  console.log("issue-1607 self-test PASS (GOOD + 6 distinct BAD fixtures)");
}

function realInputs() {
  const diskFiles = fs.readdirSync(path.join(ROOT, DECK_DIR))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `${DECK_DIR}/${name}`);
  const workflows = Object.fromEntries(fs.readdirSync(path.join(ROOT, ".github/workflows"))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8")]));
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
  for (const suite of registry.suites.filter((item) => item.lifecycle === "batched-historical")) {
    workflows[`ci-batch:${suite.id}`] = suite.steps.map((step) => `run: |\n  ${step.run.replaceAll("\n", "\n  ")}`).join("\n");
  }
  return { diskFiles, workflows, releaseHotpathSource: fs.readFileSync(path.join(ROOT, RELEASE_GUARD), "utf8") };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
    const failures = checkExplorerGuardIntegrity(realInputs());
    if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
    console.log(`issue-1607 Explorer guard integrity PASS (${DECK_GUARD_CATALOG.length} catalogued, executable require+run wiring)`);
  }
}
