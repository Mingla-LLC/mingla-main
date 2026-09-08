#!/usr/bin/env node
/**
 * Issue #3113 — a governed edge function changing must not red `main`, and the
 * fact that it needs the #2241 governed lane must reach a human who can act.
 *
 * BEFORE THIS FIX, `scripts/ci/select-changed-edge-functions.mjs` exited 1 the
 * moment its selection contained any function declaring `required_bundle_fields`.
 * The refusal to DEPLOY those functions through the normal lane was, and remains,
 * correct: `preflight-function-secret-readiness.mjs` supplies no bundle receipts
 * from the CLI entry, so the deploy would die on
 * `bundle_receipt_missing_or_ambiguous` AFTER reaching production. What was wrong
 * was killing the workflow for it. Those functions are deployed by the governed
 * lane by design, so the normal lane was never going to ship them — and a red
 * `main` blocks every merge in the repository, for a lane behaving exactly as
 * specified. On 2026-09-03 that red blocked two open pull requests.
 *
 * These assertions are the fence around the dangerous half of that fix. Turning a
 * failure into a non-failure is the exact shape of the #2113 "check that carries
 * no information" bug class, so every assertion below is about the two things
 * that must NOT have been traded away:
 *
 *   1. a governed function still never reaches this lane's `--function`
 *      arguments — proven by running the selector AND then feeding its real
 *      output through the deploy step's own shell, against a recorder;
 *   2. the skip is never silent — the "no governed functions selected" and
 *      "governed functions selected and skipped" verdicts are different text,
 *      both carry a denominator, and the second names every function.
 *
 * The selector's changed set is driven through a `git` shim on PATH rather than
 * through real history, because the lane that runs this file checks out at
 * depth 1 and could not resolve a historical range. Case 5 replays the COMPLETE
 * 80-path changed set of `d3e3457c016728f895245378bd25b20efc4c9dad` — the commit
 * whose run produced the red this issue exists to remove — so the regression is
 * pinned to the event, not to a paraphrase of it.
 */

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const selectorPath = join(repoRoot, "scripts/ci/select-changed-edge-functions.mjs");
const contract = JSON.parse(
  readFileSync(join(repoRoot, "supabase/function-env.contract.json"), "utf8"),
);
const governedInContract = Object.entries(contract.functions ?? {})
  .filter(([, value]) => Object.keys(value?.required_bundle_fields ?? {}).length > 0)
  .map(([name]) => name)
  .sort();

let failures = 0;
function check(label, run) {
  try {
    run();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}`);
    console.error(`       ${error?.message ?? error}`);
  }
}

/**
 * A `git` that answers `diff --name-only` from a file and refuses everything
 * else, so the selector's changed set is an input to this test rather than a
 * property of whatever depth CI checked out at.
 */
async function makeGitShim(changedPaths) {
  const dir = await mkdtemp(join(tmpdir(), "mingla-3113-"));
  const listPath = join(dir, "changed.txt");
  await writeFile(listPath, `${changedPaths.join("\n")}\n`, "utf8");
  const shim = join(dir, "git");
  await writeFile(
    shim,
    "#!/usr/bin/env bash\n" +
      'if [ "$1" = "diff" ]; then cat "$MINGLA_3113_CHANGED"; exit 0; fi\n' +
      'echo "git shim refuses: $*" >&2\nexit 1\n',
  );
  await chmod(shim, 0o755);
  return { dir, shim, listPath };
}

/** Run the real selector CLI end to end and capture everything it produced. */
async function runSelector(changedPaths, overrides = {}) {
  const { dir, listPath } = await makeGitShim(changedPaths);
  const selectionPath = join(dir, "edge-deploy-functions");
  const outputPath = join(dir, "github-output");
  const summaryPath = join(dir, "step-summary");
  await writeFile(outputPath, "", "utf8");
  await writeFile(summaryPath, "", "utf8");
  const result = spawnSync("node", [selectorPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      MINGLA_3113_CHANGED: listPath,
      MINGLA_DEPLOY_EVENT: "push",
      MINGLA_DEPLOY_BEFORE: "1".repeat(40),
      MINGLA_DEPLOY_SHA: "2".repeat(40),
      MINGLA_DEPLOY_SELECTION_PATH: selectionPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      ...overrides,
    },
  });
  const read = async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  };
  const outputs = Object.fromEntries(
    ((await read(outputPath)) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    selection: await read(selectionPath),
    summary: await read(summaryPath),
    outputs,
  };
}

/** The names the deploy step would actually be handed, from the file it reads. */
function selectedNames(selection) {
  return String(selection ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 1. A MIXED selection: the governed half is skipped and named, the ungoverned
//    half still deploys, and the run exits zero.
// ---------------------------------------------------------------------------

const mixed = await runSelector([
  "supabase/functions/brand-site-control/index.ts",
  "supabase/functions/weather/index.ts",
]);

check("a mixed selection exits zero instead of redding main", () => {
  assert.equal(mixed.status, 0, mixed.stderr || mixed.stdout);
});

check("a mixed selection still deploys the ungoverned function", () => {
  assert.deepEqual(selectedNames(mixed.selection), ["weather"]);
  assert.equal(mixed.outputs.count, "1");
  assert.equal(mixed.outputs.functions, "weather");
});

check("the governed function is absent from every value the deploy step reads", () => {
  assert.ok(!selectedNames(mixed.selection).includes("brand-site-control"));
  assert.ok(!mixed.outputs.functions.split(" ").includes("brand-site-control"));
  assert.equal(mixed.outputs.governed, "brand-site-control");
  assert.equal(mixed.outputs.governed_count, "1");
});

check("a mixed selection names the skipped function, loudly", () => {
  assert.match(mixed.stdout, /NOTICE select: governed_bundle_lane_required/);
  assert.match(mixed.stdout, /^- brand-site-control$/m);
  assert.match(mixed.stdout, /::warning title=[^\n]*brand-site-control/);
  assert.match(String(mixed.summary), /brand-site-control/);
});

// ---------------------------------------------------------------------------
// 2. A GOVERNED-ONLY selection: exit zero, notice emitted, nothing deployed.
// ---------------------------------------------------------------------------

const governedOnly = await runSelector([
  "supabase/functions/brand-site-cms-callback/index.ts",
  "supabase/functions/brand-site-control/index.ts",
]);

check("a governed-only selection exits zero", () => {
  assert.equal(governedOnly.status, 0, governedOnly.stderr || governedOnly.stdout);
});

check("a governed-only selection deploys nothing at all", () => {
  assert.deepEqual(selectedNames(governedOnly.selection), []);
  assert.equal(governedOnly.outputs.count, "0");
  assert.equal(governedOnly.outputs.functions, "");
});

check("a governed-only selection still names both functions", () => {
  assert.match(governedOnly.stdout, /NOTICE select: governed_bundle_lane_required/);
  assert.match(governedOnly.stdout, /^- brand-site-cms-callback$/m);
  assert.match(governedOnly.stdout, /^- brand-site-control$/m);
});

check("the notice carries a denominator on both halves", () => {
  assert.match(governedOnly.stdout, /2 of 2 selected function\(s\) are NOT deployed/);
  assert.match(governedOnly.stdout, /0 of 2 selected function\(s\) remain for this lane/);
});

check("the notice does not claim the skipped functions were deployed", () => {
  assert.match(governedOnly.stdout, /has NOT established whether they are already deployed/);
  assert.doesNotMatch(governedOnly.stdout, /already deployed by the governed lane/);
});

check("the notice names the lane that does own them", () => {
  assert.match(governedOnly.stdout, /--ad-input/);
  assert.match(governedOnly.stdout, /--delivery-input/);
  assert.match(governedOnly.stdout, /#2241/);
});

// ---------------------------------------------------------------------------
// 3. An UNGOVERNED-ONLY selection is unchanged, and a selection with NO governed
//    function is visibly different from one that skipped some.
// ---------------------------------------------------------------------------

const ungovernedOnly = await runSelector(["supabase/functions/weather/index.ts"]);
const nothingChanged = await runSelector(["docs/anything.md", "README.md"]);

check("an ungoverned-only selection is unchanged", () => {
  assert.equal(ungovernedOnly.status, 0, ungovernedOnly.stderr);
  assert.deepEqual(selectedNames(ungovernedOnly.selection), ["weather"]);
  assert.equal(ungovernedOnly.outputs.count, "1");
  assert.match(ungovernedOnly.stdout, /PASS select: 1 function\(s\) to deploy/);
});

check("no governed function selected is a DIFFERENT verdict from some skipped", () => {
  assert.match(
    ungovernedOnly.stdout,
    /PASS select: governed_bundle_lane_not_required — 0 of 1 selected function\(s\)/,
  );
  assert.doesNotMatch(ungovernedOnly.stdout, /governed_bundle_lane_required —/);
  assert.doesNotMatch(ungovernedOnly.stdout, /::warning/);
  assert.notEqual(ungovernedOnly.stdout, governedOnly.stdout);
});

check("the clear verdict is emitted even when nothing was selected at all", () => {
  assert.equal(nothingChanged.status, 0, nothingChanged.stderr);
  assert.match(
    nothingChanged.stdout,
    /PASS select: governed_bundle_lane_not_required — 0 of 0 selected function\(s\)/,
  );
  assert.doesNotMatch(nothingChanged.stdout, /::warning/);
});

check("the clear verdict raises no step summary, the skipped one does", () => {
  assert.equal(String(ungovernedOnly.summary), "");
  assert.equal(String(nothingChanged.summary), "");
  assert.ok(String(governedOnly.summary).length > 0);
});

// ---------------------------------------------------------------------------
// 4. The guarantee the old failure provided: no governed function in the real
//    contract can reach this lane, even when every one of them changes at once.
// ---------------------------------------------------------------------------

const everyGoverned = await runSelector([
  ...governedInContract.map((name) => `supabase/functions/${name}/index.ts`),
  "supabase/functions/weather/index.ts",
]);

check("the contract declares governed functions at all", () => {
  assert.ok(
    governedInContract.length > 0,
    "with no governed function this whole suite would assert nothing",
  );
});

check("not one governed function reaches the selection, all at once", () => {
  assert.equal(everyGoverned.status, 0, everyGoverned.stderr);
  const names = selectedNames(everyGoverned.selection);
  for (const name of governedInContract) {
    assert.ok(!names.includes(name), `${name} must never be deployed by this lane`);
    assert.ok(!everyGoverned.outputs.functions.split(" ").includes(name));
  }
  assert.ok(names.includes("weather"), "the ungoverned function must still deploy");
});

check("every skipped function is named, one per line", () => {
  for (const name of governedInContract) {
    assert.match(
      everyGoverned.stdout,
      new RegExp(`^- ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `${name} was skipped without being named`,
    );
  }
  assert.equal(
    everyGoverned.outputs.governed_count,
    String(governedInContract.length),
    "the denominator must match the contract, not a hand-kept list",
  );
});

// ---------------------------------------------------------------------------
// 5. The exact event that produced the red: the COMPLETE changed set of
//    d3e3457c016728f895245378bd25b20efc4c9dad, replayed.
// ---------------------------------------------------------------------------

const d3e3457c0Changed = [
  ".github/scripts/strict-grep/issue-2830-sites-foundation.mjs",
  "mingla-business/app/brand/[id]/website.tsx",
  "mingla-business/app/brand/[id]/website/ari.tsx",
  "mingla-business/src/components/sites/BrandWebsiteView.tsx",
  "mingla-business/src/components/sites/__tests__/BrandWebsiteProvisioning.issue2830.test.tsx",
  "mingla-business/src/components/sites/__tests__/BrandWebsitePublicationFailure.issue2830.test.tsx",
  "mingla-business/src/components/sites/__tests__/websiteDesktopLayout.issue2830.test.tsx",
  "mingla-business/src/screens/ari/AriChatScreen.tsx",
  "mingla-business/src/sites/__tests__/websiteExternalOpen.issue2830.happy.test.ts",
  "mingla-business/src/sites/__tests__/websiteExternalOpen.issue2830.tester_adversarial.test.ts",
  "mingla-business/src/sites/contracts.ts",
  "mingla-business/src/sites/websiteExternalOpen.ts",
  "mingla-site-cms/src/app/(payload)/studio.css",
  "mingla-site-cms/src/blocks/restaurantBlocks.ts",
  "mingla-site-cms/src/collections/Media.ts",
  "mingla-site-cms/src/collections/SiteSettings.ts",
  "mingla-site-cms/src/components/PreviewChrome.tsx",
  "mingla-site-cms/src/components/studioExperience.issue2830.test.ts",
  "mingla-site-cms/src/endpoints/oneRenderer.issue2830.test.ts",
  "mingla-site-cms/src/endpoints/sitesEndpoints.ts",
  "mingla-site-cms/src/lib/artifactBuilder.ts",
  "mingla-site-cms/src/lib/fontPairings.issue2830.test.ts",
  "mingla-site-cms/src/lib/fontPairings.ts",
  "mingla-site-cms/src/lib/gateway.ts",
  "mingla-site-cms/src/lib/importMapSynchronization.issue3026.test.ts",
  "mingla-site-cms/src/lib/mediaPipeline.ts",
  "mingla-site-cms/src/lib/menuAuthority.issue2830.test.ts",
  "mingla-site-cms/src/payload-types.ts",
  "mingla-sites/next.config.ts",
  "mingla-sites/public/fonts/OFL.txt",
  "mingla-sites/public/fonts/README.md",
  "mingla-sites/public/fonts/oswald-400-latin-ext.woff2",
  "mingla-sites/public/fonts/oswald-400-latin.woff2",
  "mingla-sites/public/fonts/oswald-600-latin-ext.woff2",
  "mingla-sites/public/fonts/oswald-600-latin.woff2",
  "mingla-sites/public/fonts/playfair-display-400-latin-ext.woff2",
  "mingla-sites/public/fonts/playfair-display-400-latin.woff2",
  "mingla-sites/public/fonts/playfair-display-700-latin-ext.woff2",
  "mingla-sites/public/fonts/playfair-display-700-latin.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-400-latin-ext.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-400-latin.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-600-latin-ext.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-600-latin.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-800-latin-ext.woff2",
  "mingla-sites/public/fonts/plus-jakarta-sans-800-latin.woff2",
  "mingla-sites/src/app/[slug]/page.tsx",
  "mingla-sites/src/app/api/order/route.ts",
  "mingla-sites/src/app/media/[mediaId]/[width]/route.ts",
  "mingla-sites/src/app/page.tsx",
  "mingla-sites/src/app/preview/page.tsx",
  "mingla-sites/src/app/serverPricedOrder.issue2830.test.ts",
  "mingla-sites/src/app/sitemap.ts",
  "mingla-sites/src/app/styles.css",
  "mingla-sites/src/components/HeroVideo.tsx",
  "mingla-sites/src/components/MenuCart.tsx",
  "mingla-sites/src/components/ReelVideo.tsx",
  "mingla-sites/src/components/RestaurantV1.tsx",
  "mingla-sites/src/components/RevealOnScroll.tsx",
  "mingla-sites/src/components/SiteTheme.tsx",
  "mingla-sites/src/components/gogiShapedRender.issue2830.test.tsx",
  "mingla-sites/src/components/heroVideo.issue2830.test.tsx",
  "mingla-sites/src/components/menuBoard.issue2830.test.tsx",
  "mingla-sites/src/components/onePagePerRoute.issue2830.test.ts",
  "mingla-sites/src/components/publicTemplateNameLeak.issue2830.test.ts",
  "mingla-sites/src/components/renderedPage.issue2830.test.tsx",
  "mingla-sites/src/components/restaurantVisualContract.issue2830.test.ts",
  "mingla-sites/src/components/siteTheme.issue2830.test.tsx",
  "mingla-sites/src/contracts/artifact.ts",
  "mingla-sites/src/contracts/fontPairings.ts",
  "mingla-sites/src/lib/origins.ts",
  "mingla-sites/src/lib/pageRouting.issue2830.test.ts",
  "mingla-sites/src/lib/pageRouting.ts",
  "mingla-sites/src/lib/previewArtifact.issue2830.test.ts",
  "mingla-sites/src/lib/previewArtifact.ts",
  "mingla-sites/src/previewFraming.issue2830.test.ts",
  "scripts/sites/gogi-pilot/__tests__/seed-gogi-pilot.issue2830-parity.test.mjs",
  "scripts/sites/gogi-pilot/seed-gogi-pilot.mjs",
  "supabase/functions/brand-site-cms-callback/index.ts",
  "supabase/functions/brand-site-control/index.ts",
  "supabase/migrations/20270617002830_issue_2830_brand_site_menu_projection.sql",
];

const replay = await runSelector(d3e3457c0Changed);

check("the commit that red main now exits zero", () => {
  assert.equal(replay.status, 0, replay.stderr || replay.stdout);
});

check("the commit that red main names both governed functions", () => {
  assert.match(replay.stdout, /^- brand-site-cms-callback$/m);
  assert.match(replay.stdout, /^- brand-site-control$/m);
  assert.match(replay.stdout, /2 of 2 selected function\(s\) are NOT deployed/);
});

check("the commit that red main deploys nothing through this lane", () => {
  assert.deepEqual(selectedNames(replay.selection), []);
  assert.equal(replay.outputs.count, "0");
});

// ---------------------------------------------------------------------------
// 6. An EXPLICIT dispatch naming a governed function still fails. A push is the
//    repository reporting what changed; a dispatch is a person asking for a
//    deploy, and the honest answer to "deploy this one" is a refusal they can
//    read, not a pass with a note attached.
// ---------------------------------------------------------------------------

const dispatch = await runSelector([], {
  MINGLA_DEPLOY_EVENT: "workflow_dispatch",
  MINGLA_DEPLOY_DISPATCH_FUNCTIONS: "brand-site-control weather",
});

check("an explicit dispatch naming a governed function is still refused", () => {
  assert.equal(dispatch.status, 1);
  assert.match(dispatch.stderr, /FAIL select: governed_bundle_lane_required/);
  assert.match(dispatch.stderr, /^- brand-site-control$/m);
  assert.equal(dispatch.selection, null, "a refused dispatch writes no selection file");
});

// ---------------------------------------------------------------------------
// 7. End to end: the selector's REAL output, fed through the deploy step's OWN
//    shell against a recorder. This is the load-bearing proof of requirement 2 —
//    not that the selection file looks right, but that the command the lane
//    builds from it cannot name a governed function.
// ---------------------------------------------------------------------------

/**
 * The deploy lane is located by the environment variable only it defines, never
 * by its filename: a workflow filename written into a tracked non-workflow file
 * is counted by `discoverWorkflowProviders()` as an external provider reference
 * and moves the frozen #2148 provider seal.
 */
function deployLaneSource() {
  const dir = join(repoRoot, ".github/workflows");
  const matches = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .filter((source) =>
      source.includes("MINGLA_DEPLOY_SELECTION_PATH") &&
      source.includes("- name: Deploy the selected edge functions")
    );
  assert.equal(matches.length, 1, "exactly one workflow is the edge deploy lane");
  return matches[0];
}

function deployRunBlock(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    line.includes("- name: Deploy the selected edge functions")
  );
  assert.notEqual(start, -1, "the deploy step must exist");
  let index = start + 1;
  while (index < lines.length && !/^\s*run:\s*\|\s*$/.test(lines[index])) index += 1;
  const indent = lines[index].match(/^\s*/)[0].length + 2;
  const body = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  while (body.length > 0 && body.at(-1) === "") body.pop();
  return body.join("\n");
}

async function executeDeployStepWith(selectionText) {
  const root = await mkdtemp(join(tmpdir(), "mingla-3113-deploy-"));
  const argvPath = join(root, "argv.txt");
  const wrapperDir = join(root, "scripts");
  await writeFile(join(root, "step.sh"), deployRunBlock(deployLaneSource()));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(wrapperDir, { recursive: true });
  const wrapper = join(wrapperDir, "deploy-supabase-functions.sh");
  await writeFile(
    wrapper,
    `#!/usr/bin/env bash\nset -u\nprintf '%s\\n' "$@" > "${argvPath}"\n`,
  );
  await chmod(wrapper, 0o755);
  const selectionPath = join(root, "edge-deploy-functions");
  await writeFile(selectionPath, selectionText ?? "");
  const result = spawnSync("bash", [join(root, "step.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      MINGLA_DEPLOY_SELECTION_PATH: selectionPath,
      GITHUB_SHA: "0".repeat(40),
      SUPABASE_PROJECT_ID: "gqnoajqerqhnvulmnyvv",
    },
  });
  let argv = [];
  try {
    argv = (await readFile(argvPath, "utf8")).split("\n").filter(Boolean);
  } catch {
    argv = [];
  }
  return { result, argv };
}

const mixedDeploy = await executeDeployStepWith(mixed.selection);
check("the deploy command built from a mixed selection names only the ungoverned function", () => {
  assert.deepEqual(mixedDeploy.argv, [
    "--merged-commit",
    "0".repeat(40),
    "--function",
    "weather",
  ]);
  assert.ok(!mixedDeploy.argv.includes("brand-site-control"));
});

const everyGovernedDeploy = await executeDeployStepWith(everyGoverned.selection);
check("no governed function can appear in the deploy command, ever", () => {
  for (const name of governedInContract) {
    assert.ok(
      !everyGovernedDeploy.argv.includes(name),
      `${name} reached the deploy command`,
    );
  }
  assert.ok(everyGovernedDeploy.argv.includes("weather"));
});

const governedOnlyDeploy = await executeDeployStepWith(governedOnly.selection);
check("a governed-only selection cannot reach the wrapper at all", () => {
  assert.deepEqual(governedOnlyDeploy.argv, [], "the wrapper must not be invoked");
  assert.notEqual(
    governedOnlyDeploy.result.status,
    0,
    "an empty selection reaching the deploy step is still a contradiction; the " +
      "lane's own count != '0' condition is what keeps it from getting there",
  );
});

check("the count output is what keeps the empty selection out of the deploy step", () => {
  assert.equal(
    governedOnly.outputs.count,
    "0",
    "count must be 0 so the deploy step's own condition skips it",
  );
});

// ---------------------------------------------------------------------------
// 8. The selector's own extended self-test still passes.
// ---------------------------------------------------------------------------

check("the selector self-test passes", () => {
  const result = spawnSync("node", [selectorPath, "--self-test"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test: PASS/);
});

if (failures > 0) {
  console.error(`\nissue #3113 governed lane notice: ${failures} FAILED`);
  process.exit(1);
}
console.log("\nissue #3113 governed lane notice: PASS");
