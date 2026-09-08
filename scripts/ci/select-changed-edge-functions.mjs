#!/usr/bin/env node
/**
 * Issue #2948 — choose the EXACT edge functions one event must deploy.
 *
 * `scripts/deploy-supabase-functions.sh` refuses a deploy-all: every deploy has
 * to name its functions. Before #2886 the same script defaulted to
 * `supabase/functions` and walked every directory, so the workflow could invoke
 * it bare and mean "all of them". #2886 replaced that contract and left the only
 * caller behind, which is why `Deploy Supabase Edge Functions` has failed on
 * every run since `d7eabd82c` with:
 *
 *   FAIL deploy: explicit --function selection required; deploy-all is forbidden
 *
 * This module produces the selection the script demands. It NEVER falls back to
 * "everything" and it NEVER falls back to "nothing" on an error it cannot
 * explain: an unresolvable push range exits non-zero and says what to do,
 * because a deploy that quietly does nothing is exactly the #2113 bug class this
 * issue exists to close.
 *
 * Selection rules
 *   push             — the functions whose deployed BUNDLE changed in
 *                      `before..sha`. A change under `supabase/functions/<name>/`
 *                      selects `<name>`; a change under `supabase/functions/_shared/`
 *                      selects every function that transitively imports it,
 *                      because that is what the bundler puts in the eszip.
 *   workflow_dispatch — the explicit list the operator typed, validated against
 *                      the deployable set.
 *
 * Test sources are excluded on purpose. `supabase functions deploy` bundles the
 * entrypoint's import graph, so a `*.test.ts` / `__tests__/` file is never in
 * the artifact — including them would fan a `_shared` test edit out to ~90
 * functions and turn a no-op into a mass deploy.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const FUNCTIONS_PREFIX = "supabase/functions/";
export const SHARED_DIR = "_shared";
export const CONTRACT_PATH = "supabase/function-env.contract.json";

/** A function name Supabase will accept, and that no shell can reinterpret. */
export const FUNCTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class SelectionError extends Error {
  constructor(code, details = []) {
    super(code);
    this.name = "SelectionError";
    this.code = code;
    this.details = [...new Set(details)].sort();
  }
}

export function isTestSource(path) {
  return /(?:^|\/)__tests__\//.test(path) ||
    /\.(?:test|adversarial|bench)\.[cm]?tsx?$/.test(path) ||
    /\.test\.[cm]?js$/.test(path);
}

/**
 * Every directory Supabase can actually deploy. A directory without an
 * `index.ts` entrypoint is a test-only folder — `places-autocomplete` and
 * `explorer-app-lead-submit` are both in that shape today — and the pre-#2886
 * loop skipped them for the same reason.
 */
export function deployableFunctions(root = REPO_ROOT) {
  const base = join(root, "supabase", "functions");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(join(base, name)).isDirectory() &&
          existsSync(join(base, name, "index.ts"));
      } catch {
        return false;
      }
    })
    .sort();
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

function walkSources(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      walkSources(full, out);
    } else if (/\.[cm]?tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `module -> the modules that import it`, over non-test sources only. This is
 * the same graph the bundler walks, so reverse-reachability from a changed
 * `_shared` module is exactly the set of functions whose artifact changed.
 */
export function buildReverseImportGraph(root = REPO_ROOT) {
  const base = join(root, "supabase", "functions");
  const reverse = new Map();
  for (const file of walkSources(base, [])) {
    const relPath = relative(root, file).split("\\").join("/");
    if (isTestSource(relPath)) continue;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const target = normalize(join(dirname(file), match[1]));
      if (!existsSync(target)) continue;
      const targetRel = relative(root, target).split("\\").join("/");
      if (!reverse.has(targetRel)) reverse.set(targetRel, new Set());
      reverse.get(targetRel).add(relPath);
    }
  }
  return reverse;
}

function functionOf(relPath) {
  if (!relPath.startsWith(FUNCTIONS_PREFIX)) return null;
  const name = relPath.slice(FUNCTIONS_PREFIX.length).split("/")[0];
  if (!name || name === SHARED_DIR || name.startsWith("_")) return null;
  return name;
}

/**
 * Map changed repository paths to the functions whose deployed bundle changed.
 * `deployable` is passed in so the caller can prove the mapping without a
 * working tree.
 */
export function functionsForChangedPaths(changedPaths, {
  root = REPO_ROOT,
  deployable = null,
  reverse = null,
} = {}) {
  const allowed = new Set(deployable ?? deployableFunctions(root));
  const graph = reverse ?? buildReverseImportGraph(root);
  const selected = new Set();
  const skipped = new Set();

  const sharedSeeds = [];
  for (const raw of changedPaths) {
    const path = String(raw ?? "").trim();
    if (!path.startsWith(FUNCTIONS_PREFIX)) continue;
    if (isTestSource(path)) continue;
    const name = functionOf(path);
    if (name === null) {
      // `_shared/**` (and anything else directly under supabase/functions/)
      if (path.startsWith(`${FUNCTIONS_PREFIX}${SHARED_DIR}/`)) sharedSeeds.push(path);
      continue;
    }
    if (allowed.has(name)) selected.add(name);
    else skipped.add(name);
  }

  // Reverse-reachability from every changed shared module.
  const seen = new Set(sharedSeeds);
  const stack = [...sharedSeeds];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const importer of graph.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      stack.push(importer);
      const name = functionOf(importer);
      if (name === null) continue;
      if (allowed.has(name)) selected.add(name);
      else skipped.add(name);
    }
  }

  return { functions: [...selected].sort(), skipped: [...skipped].sort() };
}

/** Parse the `workflow_dispatch` input. Explicit means explicit. */
export function parseDispatchSelection(raw, { deployable } = {}) {
  const names = String(raw ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new SelectionError("dispatch_requires_explicit_functions");
  }
  const invalid = names.filter((name) => !FUNCTION_NAME_RE.test(name));
  if (invalid.length > 0) throw new SelectionError("function_name_invalid", invalid);
  const allowed = new Set(deployable ?? deployableFunctions());
  const unknown = names.filter((name) => !allowed.has(name));
  if (unknown.length > 0) throw new SelectionError("function_not_deployable", unknown);
  return [...new Set(names)].sort();
}

/**
 * Functions the normal deploy lane structurally cannot ship.
 *
 * `scripts/deploy-supabase-functions.sh` runs
 * `preflight-function-secret-readiness.mjs`, whose CLI entry supplies NO
 * receipts, so any selected function carrying `required_bundle_fields` dies on
 * `bundle_receipt_missing_or_ambiguous` — after the preflight has already
 * reached production to list secrets. Naming them here keeps them out of the
 * selection BEFORE it touches production and says which lane owns them.
 *
 * #3113 changed WHERE that refusal lands, never how strict it is. Until #3113 a
 * governed function in the selection killed the workflow, which red `main` every
 * time a governed function changed and blocked every merge in the repository for
 * a lane behaving exactly as designed — the governed lane (#2241) deploys these,
 * so this lane was never going to. Now `partitionGovernedSelection` subtracts
 * them from the deploy set and `governedLaneNotice` reports it loudly. They are
 * still never deployed here.
 */
export function governedBundleFunctions(selected, { root = REPO_ROOT, contract = null } = {}) {
  const source = contract ??
    JSON.parse(readFileSync(join(root, CONTRACT_PATH), "utf8"));
  const functions = source.functions ?? {};
  return selected
    .filter((name) => Object.keys(functions[name]?.required_bundle_fields ?? {}).length > 0)
    .sort();
}

/**
 * Issue #3113 — split a selection into what this lane may deploy and what it
 * structurally may not.
 *
 * `governedBundleFunctions` above answers "which of these are governed". This
 * answers "so what does this lane actually deploy", and it is the ONLY place
 * that decides. The governed half is REMOVED from the deploy set here and is
 * never written to the selection file or the step outputs, so the guarantee the
 * pre-#3113 hard failure provided — a governed function is never deployed by the
 * normal lane — is unchanged in strength and merely enforced by subtraction
 * instead of by killing the run.
 */
export function partitionGovernedSelection(selected, { root = REPO_ROOT, contract = null } = {}) {
  const governed = governedBundleFunctions(selected, { root, contract });
  const blocked = new Set(governed);
  return { deploy: selected.filter((name) => !blocked.has(name)), governed };
}

export const GOVERNED_NOTICE_CODE = "governed_bundle_lane_required";
export const GOVERNED_CLEAR_CODE = "governed_bundle_lane_not_required";

/** GitHub's workflow-command escaping. A raw newline would truncate the annotation. */
function escapeAnnotation(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Issue #3113 — the lane's verdict on governed functions, as text.
 *
 * This is emitted on EVERY run, governed or not, because the failure mode this
 * function exists to prevent is not a wrong answer, it is NO answer. #2113's
 * bug class is a check that reports success without checking, and turning the
 * pre-#3113 red into a pass is exactly the shape that produces one. So:
 *
 *   - the clear case and the skipped case are DIFFERENT codes, not the same
 *     line with a different number, and both carry the denominator
 *     `<governed> of <selected>`;
 *   - the skipped case names every function, one per line, and repeats the
 *     names inside a `::warning::` annotation so the run page shows it without
 *     anyone opening the log;
 *   - the skipped case states, in the notice itself, that this run has NOT
 *     established whether those functions are already deployed. It cannot:
 *     the only source of a live function version is a production read behind a
 *     credential this step deliberately does not carry. Saying "deployed by the
 *     governed lane" here would be an assumption printed as a fact.
 *
 * Throws `governed_notice_incomplete` if the text it produced fails to name a
 * governed function. The caller treats that as the pre-#3113 hard failure, so
 * the notice cannot degrade into silence — the worst case is the red we started
 * with, never a quiet skip.
 */
export function formatGovernedNotice({ selected = [], governed = [], deploy = [], reason = "" } = {}) {
  const total = selected.length;
  const lines = [];
  let annotation = null;
  let summary = null;

  if (governed.length === 0) {
    lines.push(
      `PASS select: ${GOVERNED_CLEAR_CODE} — 0 of ${total} selected function(s) ` +
        "declare required_bundle_fields; this lane deploys all of them",
    );
    return { code: GOVERNED_CLEAR_CODE, lines, annotation, summary };
  }

  lines.push(
    `NOTICE select: ${GOVERNED_NOTICE_CODE} — ${governed.length} of ${total} ` +
      `selected function(s) are NOT deployed by this lane (${reason})`,
  );
  for (const name of governed) lines.push(`- ${name}`);
  lines.push(
    "- these functions declare required_bundle_fields, and the normal deploy lane " +
      "supplies no bundle receipts, so preflight-function-secret-readiness.mjs would " +
      "fail with bundle_receipt_missing_or_ambiguous AFTER reaching production. They " +
      "are deployed by the governed lane instead: scripts/deploy-supabase-functions.sh " +
      "with the governed bundle inputs (--ad-input / --delivery-input) per #2241.",
  );
  lines.push(
    "- this run has NOT established whether they are already deployed, and does not " +
      "assume it. The only source of a live function version is a production read " +
      "behind a credential this step does not carry. Read it before assuming: " +
      "GET https://api.supabase.com/v1/projects/<ref>/functions",
  );
  lines.push(
    `NOTICE select: ${deploy.length} of ${total} selected function(s) remain for this ` +
      "lane to deploy",
  );

  annotation =
    `::warning title=Governed edge functions were not deployed by this lane::` +
    escapeAnnotation(
      `${governed.length} of ${total} selected function(s) need the #2241 governed ` +
        `bundle lane and were skipped here: ${governed.join(", ")}. ` +
        "Deployment of these is NOT verified by this run.",
    );

  summary = [
    "### Governed edge functions were not deployed by this lane",
    "",
    `${governed.length} of ${total} selected function(s) declare ` +
      "`required_bundle_fields` and are deployed by the #2241 governed lane " +
      "(`--ad-input` / `--delivery-input`), not here:",
    "",
    ...governed.map((name) => `- \`${name}\``),
    "",
    `${deploy.length} of ${total} selected function(s) remain for this lane to deploy.`,
    "",
    "This run has NOT established whether the skipped functions are already " +
      "deployed. Read the live versions before assuming: " +
      "`GET https://api.supabase.com/v1/projects/<ref>/functions`",
    "",
  ].join("\n");

  return { code: GOVERNED_NOTICE_CODE, lines, annotation, summary };
}

/**
 * `formatGovernedNotice` with its own output CHECKED before anyone can print it.
 *
 * The formatter is injectable for exactly one reason: without it this guard is
 * unfalsifiable. The real formatter names every governed function by
 * construction, so no input can make the check fire, and a check no input can
 * fail is the #2113 bug class wearing the uniform of a safety net. Passing a
 * formatter that drops the names is how the throwing branch is proven to exist.
 */
export function governedLaneNotice(input = {}, { format = formatGovernedNotice } = {}) {
  const governed = input.governed ?? [];
  const notice = format(input);
  if (governed.length === 0) return notice;
  const text = [...(notice.lines ?? []), notice.annotation ?? "", notice.summary ?? ""].join("\n");
  const unnamed = governed.filter((name) => !text.includes(name));
  if (unnamed.length > 0) throw new SelectionError("governed_notice_incomplete", unnamed);
  if ((notice.lines ?? []).length === 0) {
    throw new SelectionError("governed_notice_incomplete", ["(empty notice)"]);
  }
  return notice;
}

function gitChangedPaths(base, head, { root = REPO_ROOT, spawn = spawnSync } = {}) {
  const result = spawn(
    "git",
    ["diff", "--name-only", `${base}..${head}`],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new SelectionError("push_range_unresolvable", [
      `${base}..${head}`,
      String(result.stderr ?? "").trim().split("\n")[0] || "git diff failed",
    ]);
  }
  return String(result.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

const ZERO_SHA = /^0{40}$/;

export function selectForEvent(env, {
  root = REPO_ROOT,
  spawn = spawnSync,
  deployable = null,
  reverse = null,
} = {}) {
  const allowed = deployable ?? deployableFunctions(root);
  const event = env.MINGLA_DEPLOY_EVENT ?? "";
  if (event === "workflow_dispatch") {
    return {
      event,
      reason: "explicit dispatch selection",
      functions: parseDispatchSelection(env.MINGLA_DEPLOY_DISPATCH_FUNCTIONS, {
        deployable: allowed,
      }),
      skipped: [],
    };
  }
  if (event !== "push") throw new SelectionError("unsupported_event", [event || "(empty)"]);
  const head = String(env.MINGLA_DEPLOY_SHA ?? "").trim();
  const base = String(env.MINGLA_DEPLOY_BEFORE ?? "").trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new SelectionError("head_sha_invalid", [head || "(empty)"]);
  if (!/^[0-9a-f]{40}$/.test(base) || ZERO_SHA.test(base)) {
    throw new SelectionError("push_base_unavailable", [base || "(empty)"]);
  }
  const changed = gitChangedPaths(base, head, { root, spawn });
  const mapped = functionsForChangedPaths(changed, { root, deployable: allowed, reverse });
  return { event, reason: `push ${base.slice(0, 9)}..${head.slice(0, 9)}`, ...mapped };
}

// ---------------------------------------------------------------------------
// self-test
// ---------------------------------------------------------------------------

function assertOk(condition, label) {
  if (!condition) throw new Error(`self-test failed: ${label}`);
  return true;
}

export function runSelfTest() {
  let checks = 0;
  const deployable = ["alpha", "beta", "gamma"];
  const reverse = new Map([
    ["supabase/functions/_shared/secretBundle.ts", new Set([
      "supabase/functions/_shared/stripeMode.ts",
      "supabase/functions/beta/index.ts",
    ])],
    ["supabase/functions/_shared/stripeMode.ts", new Set([
      "supabase/functions/gamma/index.ts",
    ])],
  ]);
  const opts = { deployable, reverse, root: REPO_ROOT };

  // A direct entrypoint change selects exactly that function.
  let out = functionsForChangedPaths(["supabase/functions/alpha/index.ts"], opts);
  checks += assertOk(JSON.stringify(out.functions) === '["alpha"]', "direct change selects one");

  // A shared change fans out THROUGH an intermediate shared module.
  out = functionsForChangedPaths(["supabase/functions/_shared/secretBundle.ts"], opts);
  checks += assertOk(
    JSON.stringify(out.functions) === '["beta","gamma"]',
    "shared change reaches transitive importers",
  );

  // Test sources are never in the bundle, so they never select anything.
  for (
    const path of [
      "supabase/functions/_shared/secretBundle.test.ts",
      "supabase/functions/_shared/__tests__/thing.ts",
      "supabase/functions/alpha/index.test.ts",
      "supabase/functions/alpha/__tests__/index.ts",
    ]
  ) {
    out = functionsForChangedPaths([path], opts);
    checks += assertOk(out.functions.length === 0, `test source selects nothing: ${path}`);
  }

  // Paths outside supabase/functions never select anything.
  out = functionsForChangedPaths(
    ["scripts/ops/verify-production-supabase-authority.mjs", "docs/anything.md"],
    opts,
  );
  checks += assertOk(out.functions.length === 0, "unrelated paths select nothing");

  // A directory with no entrypoint is reported, never deployed.
  out = functionsForChangedPaths(["supabase/functions/places-autocomplete/index.test.ts"], opts);
  checks += assertOk(out.functions.length === 0, "test-only directory is not deployable");
  out = functionsForChangedPaths(["supabase/functions/places-autocomplete/index.ts"], opts);
  checks += assertOk(
    out.functions.length === 0 && out.skipped.includes("places-autocomplete"),
    "non-deployable directory is skipped and reported",
  );

  // Dispatch selection is validated, deduplicated and sorted.
  checks += assertOk(
    JSON.stringify(parseDispatchSelection("gamma alpha, alpha", { deployable })) ===
      '["alpha","gamma"]',
    "dispatch parses, dedupes and sorts",
  );
  for (
    const [raw, code] of [
      ["", "dispatch_requires_explicit_functions"],
      ["   ", "dispatch_requires_explicit_functions"],
      ["alpha; rm -rf /", "function_name_invalid"],
      ["../etc", "function_name_invalid"],
      ["Alpha", "function_name_invalid"],
      ["delta", "function_not_deployable"],
    ]
  ) {
    let code_ = null;
    try {
      parseDispatchSelection(raw, { deployable });
    } catch (error) {
      code_ = error.code;
    }
    checks += assertOk(code_ === code, `dispatch rejects ${JSON.stringify(raw)} as ${code}`);
  }

  // A push with no usable base fails CLOSED — it must never mean "deploy nothing".
  for (
    const [base, code] of [
      ["", "push_base_unavailable"],
      ["0".repeat(40), "push_base_unavailable"],
      ["not-a-sha", "push_base_unavailable"],
    ]
  ) {
    let code_ = null;
    try {
      selectForEvent({
        MINGLA_DEPLOY_EVENT: "push",
        MINGLA_DEPLOY_SHA: "a".repeat(40),
        MINGLA_DEPLOY_BEFORE: base,
      }, { deployable, reverse });
    } catch (error) {
      code_ = error.code;
    }
    checks += assertOk(code_ === code, `push base ${JSON.stringify(base)} fails closed`);
  }

  // A git failure is an error, not an empty selection.
  let failedCode = null;
  try {
    selectForEvent({
      MINGLA_DEPLOY_EVENT: "push",
      MINGLA_DEPLOY_SHA: "a".repeat(40),
      MINGLA_DEPLOY_BEFORE: "b".repeat(40),
    }, {
      deployable,
      reverse,
      spawn: () => ({ status: 128, stdout: "", stderr: "fatal: bad object" }),
    });
  } catch (error) {
    failedCode = error.code;
  }
  checks += assertOk(failedCode === "push_range_unresolvable", "git failure is not an empty selection");

  // The governed lane is named from the real contract, not a literal list.
  const contract = {
    functions: {
      alpha: { required_bundle_fields: {} },
      beta: { required_bundle_fields: { AD_CONVERSION_TOKENS: ["X"] } },
    },
  };
  checks += assertOk(
    JSON.stringify(governedBundleFunctions(["alpha", "beta"], { contract })) === '["beta"]',
    "governed functions are detected from required_bundle_fields",
  );

  // The real repository must agree with the real contract: every function the
  // contract marks governed is a directory that exists.
  const realContract = JSON.parse(readFileSync(join(REPO_ROOT, CONTRACT_PATH), "utf8"));
  const realDeployable = new Set(deployableFunctions(REPO_ROOT));
  const realGoverned = governedBundleFunctions([...realDeployable].sort(), {
    contract: realContract,
  });
  checks += assertOk(realGoverned.length > 0, "the repository has at least one governed function");
  checks += assertOk(
    realGoverned.every((name) => realDeployable.has(name)),
    "every governed function is a deployable directory",
  );

  // ---- #3113: a governed function is subtracted, never deployed, never silent.
  const mixed = {
    functions: {
      alpha: { required_bundle_fields: {} },
      beta: { required_bundle_fields: { AD_CONVERSION_TOKENS: ["X"] } },
      gamma: { required_bundle_fields: {} },
    },
  };

  const mixedSplit = partitionGovernedSelection(["alpha", "beta", "gamma"], { contract: mixed });
  checks += assertOk(
    JSON.stringify(mixedSplit.deploy) === '["alpha","gamma"]',
    "a mixed selection still deploys the ungoverned functions",
  );
  checks += assertOk(
    JSON.stringify(mixedSplit.governed) === '["beta"]' &&
      !mixedSplit.deploy.includes("beta"),
    "the governed function is subtracted from the deploy set",
  );

  const onlySplit = partitionGovernedSelection(["beta"], { contract: mixed });
  checks += assertOk(
    onlySplit.deploy.length === 0 && JSON.stringify(onlySplit.governed) === '["beta"]',
    "a governed-only selection leaves this lane nothing to deploy",
  );

  // Every governed function in the real contract is subtracted from a selection
  // of the real deployable set. This is the guarantee the pre-#3113 hard failure
  // provided, asserted against the repository rather than a fixture.
  const everySplit = partitionGovernedSelection([...realDeployable].sort(), {
    contract: realContract,
  });
  checks += assertOk(
    realGoverned.every((name) => !everySplit.deploy.includes(name)),
    "no governed function in the real contract can reach this lane's deploy set",
  );
  checks += assertOk(
    everySplit.deploy.length + everySplit.governed.length === realDeployable.size,
    "the partition is total: nothing is invented and nothing is lost",
  );

  // The two verdicts are DIFFERENT text, both carry a denominator, and the
  // skipped one names its functions. A notice that cannot be told apart from
  // "all clear" is the silence #3113 exists to prevent.
  const clear = governedLaneNotice({ selected: ["alpha", "gamma"], governed: [], deploy: ["alpha", "gamma"] });
  const skipped = governedLaneNotice({
    selected: ["alpha", "beta", "gamma"],
    governed: ["beta"],
    deploy: ["alpha", "gamma"],
    reason: "push aaaaaaaaa..bbbbbbbbb",
  });
  checks += assertOk(clear.code === GOVERNED_CLEAR_CODE, "the clear verdict has its own code");
  checks += assertOk(skipped.code === GOVERNED_NOTICE_CODE, "the skipped verdict has its own code");
  checks += assertOk(
    clear.lines.join("\n") !== skipped.lines.join("\n"),
    "the two verdicts are distinguishable in the output",
  );
  checks += assertOk(
    clear.lines.join("\n").includes("0 of 2"),
    "the clear verdict carries a denominator",
  );
  checks += assertOk(
    skipped.lines.join("\n").includes("1 of 3") &&
      skipped.lines.join("\n").includes("2 of 3"),
    "the skipped verdict carries both denominators",
  );
  checks += assertOk(
    skipped.lines.some((line) => line.includes("beta")),
    "the skipped verdict names the function it skipped",
  );
  checks += assertOk(
    skipped.lines.length > 0 && skipped.annotation !== null && skipped.summary !== null,
    "the skipped verdict is never empty and reaches the run page, not only the log",
  );
  checks += assertOk(
    skipped.annotation.startsWith("::warning") && skipped.annotation.includes("beta"),
    "the annotation names the skipped function",
  );
  checks += assertOk(
    !skipped.annotation.includes("\n"),
    "a raw newline would truncate the annotation",
  );
  checks += assertOk(
    /NOT established/.test(skipped.lines.join("\n")),
    "the notice states that deployment is not established rather than implying coverage",
  );
  checks += assertOk(
    clear.annotation === null && clear.summary === null,
    "the clear verdict raises no annotation",
  );

  // The anti-silence guard, proven by EXECUTING its throwing branch. A formatter
  // that drops the names is the exact regression a future edit could introduce;
  // the guard must refuse it rather than print an unnamed skip.
  let noticeCode = null;
  try {
    governedLaneNotice({ selected: ["alpha", "beta"], governed: ["beta"], deploy: ["alpha"] }, {
      format: () => ({ code: GOVERNED_NOTICE_CODE, lines: ["NOTICE select: 1 of 2"], annotation: null, summary: null }),
    });
  } catch (error) {
    noticeCode = error.code;
  }
  checks += assertOk(
    noticeCode === "governed_notice_incomplete",
    "a notice that does not name a skipped function is refused",
  );

  let emptyCode = null;
  try {
    governedLaneNotice({ selected: ["beta"], governed: ["beta"], deploy: [] }, {
      format: () => ({ code: GOVERNED_NOTICE_CODE, lines: [], annotation: "beta", summary: "beta" }),
    });
  } catch (error) {
    emptyCode = error.code;
  }
  checks += assertOk(
    emptyCode === "governed_notice_incomplete",
    "an empty notice is refused even when the names appear elsewhere",
  );

  // The real formatter passes its own guard — the guard is not merely throwable,
  // it is satisfied by production output.
  checks += assertOk(
    governedLaneNotice({ selected: ["alpha", "beta"], governed: ["beta"], deploy: ["alpha"] })
      .code === GOVERNED_NOTICE_CODE,
    "the real notice satisfies the anti-silence guard",
  );

  console.log(`select-changed-edge-functions self-test: PASS (${checks} assertions)`);
  return checks;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  let selection;
  try {
    selection = selectForEvent(process.env);
  } catch (error) {
    const code = error instanceof SelectionError ? error.code : "selection_failed";
    console.error(`FAIL select: ${code}`);
    for (const detail of error?.details ?? []) console.error(`- ${detail}`);
    if (code === "push_base_unavailable" || code === "push_range_unresolvable") {
      console.error(
        "- the pushed range could not be read, so the changed set is unknown. " +
          "Re-run this workflow with workflow_dispatch and an explicit function list " +
          "rather than assuming nothing changed.",
      );
    }
    process.exitCode = 1;
    return;
  }

  for (const name of selection.skipped) {
    console.log(`NOTE select: ${name} changed but has no index.ts entrypoint; not deployable`);
  }

  // #3113 — the governed half is SUBTRACTED from the deploy set here. Everything
  // downstream (the selection file, the step outputs, the deploy step) reads
  // `deploy`, never `selection.functions`, so a governed function has no path to
  // this lane's `--function` arguments at all.
  const { deploy, governed } = partitionGovernedSelection(selection.functions);

  // An explicit `workflow_dispatch` list is NOT converted to a notice. A push is
  // the repository telling the lane what changed, and the lane skipping what it
  // structurally cannot ship carries no action for anyone — that is the whole of
  // #3113. A dispatch is a HUMAN naming a function they want deployed, and the
  // honest answer to "deploy this one" is a refusal they can read, not a pass
  // with a note. "Explicit means explicit" cuts both ways.
  if (governed.length > 0 && selection.event === "workflow_dispatch") {
    console.error(`FAIL select: ${GOVERNED_NOTICE_CODE}`);
    for (const name of governed) console.error(`- ${name}`);
    console.error(
      "- these functions declare required_bundle_fields, and the normal deploy lane " +
        "supplies no bundle receipts, so preflight-function-secret-readiness.mjs would " +
        "fail with bundle_receipt_missing_or_ambiguous AFTER reaching production. " +
        "Deploy them through scripts/deploy-supabase-functions.sh with the governed " +
        "bundle inputs (--ad-input / --delivery-input) per #2241.",
    );
    process.exitCode = 1;
    return;
  }

  // The notice is emitted on EVERY run, with a denominator, and the two verdicts
  // carry different codes. If it cannot be built, or it fails to name a function
  // it is skipping, we fall back to the pre-#3113 hard failure rather than let a
  // skipped deploy pass quietly — a red is recoverable, silence is not.
  let notice;
  try {
    notice = governedLaneNotice({
      selected: selection.functions,
      governed,
      deploy,
      reason: selection.reason,
    });
  } catch (error) {
    console.error(`FAIL select: ${error?.code ?? "governed_notice_unavailable"}`);
    for (const name of governed) console.error(`- ${name}`);
    console.error(
      "- the governed-lane notice could not be produced, so this run cannot report " +
        "which functions it is skipping. Failing rather than skipping silently.",
    );
    process.exitCode = 1;
    return;
  }
  for (const line of notice.lines) console.log(line);
  if (notice.annotation) console.log(notice.annotation);
  if (notice.summary && process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, notice.summary, {
      encoding: "utf8",
      flag: "a",
    });
  }

  const listPath = process.env.MINGLA_DEPLOY_SELECTION_PATH ??
    (process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, "edge-deploy-functions") : null);
  if (listPath) {
    writeFileSync(listPath, `${deploy.join("\n")}\n`, "utf8");
  }
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${deploy.length}\nfunctions=${deploy.join(" ")}\n` +
        `governed_count=${governed.length}\ngoverned=${governed.join(" ")}\n`,
      { encoding: "utf8", flag: "a" },
    );
  }
  if (deploy.length === 0) {
    console.log(
      governed.length > 0
        ? `PASS select: nothing for this lane to deploy (${selection.reason}); ` +
          `${governed.length} governed function(s) named above need the #2241 governed lane`
        : `PASS select: no edge-function bundle changed (${selection.reason}); nothing to deploy`,
    );
    return;
  }
  console.log(
    `PASS select: ${deploy.length} function(s) to deploy (${selection.reason})`,
  );
  for (const name of deploy) console.log(`- ${name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
