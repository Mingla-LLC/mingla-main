#!/usr/bin/env node
/**
 * #1486 — EVERY JEST CONFIG MUST BE INVOKED BY A WORKFLOW, AND EVERY
 * `testPathIgnorePatterns` HAND-OFF MUST NAME A CONFIG THAT ACTUALLY RUNS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO PREVENT
 *
 * `mingla-business/jest.config.cjs` does not merely omit render-proof suites.
 * Its `testPathIgnorePatterns` block DELIBERATELY EXCLUDES them, each with a
 * comment naming the config that is supposed to run them instead:
 *
 *     // ORCH-1143 tester runtime render-proof — runs under jest.orch1143.render.cjs
 *     // … MUST NOT run under this default …
 *
 * The exclusion is real and enforced by jest on every run. The promise is not
 * enforced by anything. At the time #1486 was filed, 26 of 41 real jest configs
 * in `mingla-business` were invoked by NO workflow — so 26 suites' worth of
 * tests were excluded from the run that happens, on the written promise of runs
 * that never happen.
 *
 * That comment is precisely what made it invisible. A reviewer reading
 * `jest.config.cjs` sees a responsible hand-off, not a hole. A suite that never
 * executes is the limit case of the bug class this repo keeps shipping: it
 * costs the same to write, reads identically in a PR, and provides exactly
 * nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS ENFORCED
 *
 *   R1  Every non-helper `jest.*.cjs` in mingla-business is invoked by at least
 *       one workflow — directly (`--config X`), or through an npm script that a
 *       workflow runs, or by being `require()`d from a config that is itself
 *       invoked.
 *   R2  Every helper (`*-stub.cjs`, `*.babel.cjs`) is referenced by at least one
 *       config or workflow. A helper nobody loads is dead too.
 *   R3  Every config named anywhere in `jest.config.cjs` — which in practice
 *       means every "runs under X" hand-off in `testPathIgnorePatterns` — must
 *       EXIST and must be invoked.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT FAILS. IT NEVER SKIPS.  (the standard #1559 set and #1560 matched)
 *
 * A hand-off naming a config that cannot be resolved on disk is exit 2, not a
 * `continue`. #1559 rewrote `orch-1255-public-venue-anon-safe.mjs` for exactly
 * this reason: its `if (f.code === null) continue;` meant a file MOVE silently
 * dropped a target and the gate still printed green. Green CI while the rule
 * stops being enforced is the worst failure mode available, because nothing
 * looks wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE VACUITY GUARD IS THE POINT
 *
 * A gate that enumerates ZERO configs must go RED, not green. That is this
 * exact bug class, occurring inside the gate that polices it: an empty
 * enumeration makes "every config is invoked" trivially true, and a vacuous
 * pass here would recreate #1486 while claiming to have fixed it. So:
 *
 *   V-CONFIGS    fewer than MIN_CONFIGS configs observed  → exit 2
 *   V-WORKFLOWS  fewer than MIN_WORKFLOWS workflows read  → exit 2
 *   V-READABLE   any config or workflow that read as null → exit 2
 *   V-DEFAULT    `jest.config.cjs` absent from the sweep  → exit 2
 *
 * Both floors are sweep-observed-a-real-tree floors in the #1560 sense: they
 * are set far below today's true counts (42 configs, 103 workflows) so ordinary
 * churn never trips them, and far above zero so a broken sweep always does.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const BUSINESS_DIR = "mingla-business";
const WORKFLOW_DIR = join(".github", "workflows");

/** Any jest config filename, wherever it is mentioned. */
const CONFIG_NAME = /jest\.[A-Za-z0-9][A-Za-z0-9._-]*\.cjs/g;

/**
 * Helpers are LOADED BY a config (babel presets, module stubs); jest is never
 * pointed at them with --config, so R1 cannot apply. R2 applies instead.
 */
const HELPER = /(?:-stub\.cjs|\.babel\.cjs)$/;

/** jest's implicit default when a command runs jest with no --config. */
const DEFAULT_CONFIG = "jest.config.cjs";

/**
 * Comments are stripped before a config's references are read.
 *
 * This is not cosmetic — it is the same defect the gate exists to catch, and
 * the first live run caught it here. `jest.orch1118.babel.cjs` carries the line
 *
 *     // Used ONLY by jest.orch1118.render.cjs to transform the RN .tsx screen
 *
 * and the babel helper IS loaded by wired configs. Reading references from raw
 * source therefore let that COMMENT confer "invoked" on
 * `jest.orch1118.render.cjs` — a config no workflow runs — and the gate printed
 * no failure for it. A sentence in a comment must never make a suite look run.
 * Hand-off claims in jest.config.cjs are read from RAW source on purpose (R3):
 * there, the comment IS the claim under test.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** A bare jest invocation (no --config/-c) resolves to jest.config.cjs. */
const BARE_JEST =
  /(?:^|[\s&|;"'`])(?:npm\s+(?:run\s+)?test\b|npx\s+jest\b|(?<!\.)\bjest\s)/;
const HAS_EXPLICIT_CONFIG = /--config[=\s]|(?:^|\s)-c[=\s]/;

/** `npm run <script>` — how a workflow reaches package.json. */
const NPM_RUN = /npm\s+run\s+([A-Za-z0-9:_.-]+)/g;

/**
 * Sweep-observed-a-real-tree floors. Today: 42 configs, 103 workflows.
 * Set well below both so churn never trips them, well above zero so a broken
 * sweep always does.
 */
const MIN_CONFIGS = 20;
const MIN_WORKFLOWS = 40;

const matchAll = (text, re) => {
  const out = new Set();
  for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
    out.add(m[1] ?? m[0]);
  }
  return out;
};

/**
 * Resolve every jest config a command line reaches, following `npm run` into
 * package.json (transitively — scripts chain into other scripts).
 *
 * @param {string} command
 * @param {Record<string,string>} npmScripts
 * @param {Set<string>} seen  cycle guard for script→script recursion
 * @returns {Set<string>}
 */
const configsReachedBy = (command, npmScripts, seen = new Set()) => {
  const found = new Set(matchAll(command, CONFIG_NAME));

  // A jest run with no --config uses jest's default config. This is the ONLY
  // reason jest.config.cjs itself counts as invoked, and it is why the default
  // suite's own workflow does not need to name a file.
  if (BARE_JEST.test(command) && !HAS_EXPLICIT_CONFIG.test(command)) {
    found.add(DEFAULT_CONFIG);
  }

  for (const script of matchAll(command, NPM_RUN)) {
    if (seen.has(script)) continue;
    seen.add(script);
    const body = npmScripts[script];
    if (typeof body !== "string") continue;
    for (const c of configsReachedBy(body, npmScripts, seen)) found.add(c);
  }
  return found;
};

/**
 * @param {{configs:{name:string,code:string|null}[],
 *          workflows:{name:string,text:string|null}[],
 *          npmScripts:Record<string,string>}} input
 * @returns {{code:number, failures:string[]}} 0 pass · 1 violation · 2 vacuous
 */
export const run = (
  { configs, workflows, npmScripts },
  { minConfigs = MIN_CONFIGS, minWorkflows = MIN_WORKFLOWS } = {},
) => {
  // ---- V-CONFIGS / V-WORKFLOWS -----------------------------------------
  // The whole bug class, in the gate that polices it: with zero configs
  // enumerated, "every config is invoked" is vacuously true and this gate
  // would print green over the exact hole it exists to find.
  if (configs.length < minConfigs) {
    return {
      code: 2,
      failures: [
        `VACUOUS: enumerated ${configs.length} jest configs, floor is ${minConfigs}. ` +
          "A gate that enumerates nothing proves nothing — this is #1486 itself, " +
          "reoccurring inside the gate written to prevent it.",
      ],
    };
  }
  if (workflows.length < minWorkflows) {
    return {
      code: 2,
      failures: [
        `VACUOUS: read ${workflows.length} workflows, floor is ${minWorkflows}. ` +
          "With no workflows observed every config would look uninvoked (or, with " +
          "an inverted check, every config would look invoked). Either way the " +
          "scan did not observe the tree it claims to enforce.",
      ],
    };
  }

  // ---- V-READABLE -------------------------------------------------------
  for (const c of configs) {
    if (typeof c.code !== "string") {
      return {
        code: 2,
        failures: [
          `${c.name}: MISSING or unreadable. A gate that SKIPS an unreadable target ` +
            "is not a gate (#1559). Repoint or remove it in the same PR that moves it.",
        ],
      };
    }
  }
  for (const w of workflows) {
    if (typeof w.text !== "string") {
      return {
        code: 2,
        failures: [
          `${w.name}: workflow MISSING or unreadable — the invocation set cannot be ` +
            "computed, so no verdict below it is trustworthy.",
        ],
      };
    }
  }

  // ---- V-DEFAULT --------------------------------------------------------
  const byName = new Map(configs.map((c) => [c.name, c]));
  if (!byName.has(DEFAULT_CONFIG)) {
    return {
      code: 2,
      failures: [
        `VACUOUS: ${DEFAULT_CONFIG} was not among the ${configs.length} configs swept. ` +
          "It is the file that carries the testPathIgnorePatterns hand-offs; without " +
          "it R3 checks nothing.",
      ],
    };
  }

  // ---- invocation closure ------------------------------------------------
  const invoked = new Set();
  for (const w of workflows) {
    for (const c of configsReachedBy(w.text, npmScripts)) invoked.add(c);
  }

  // A config LOADED BY an invoked config is itself loaded, so it runs. Fixed
  // point, because configs chain (cfg → base → babel sibling → stub).
  // Comment-stripped: a mention in prose is not a load (see stripComments).
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of [...invoked]) {
      const cfg = byName.get(name);
      if (!cfg) continue;
      // jest.config.cjs names its hand-off targets in COMMENTS, not requires.
      // Treating those as invocations is exactly the false hand-off #1486 is
      // about, so the default config never confers invocation on anything.
      if (name === DEFAULT_CONFIG) continue;
      for (const ref of matchAll(stripComments(cfg.code), CONFIG_NAME)) {
        if (ref !== name && !invoked.has(ref)) {
          invoked.add(ref);
          changed = true;
        }
      }
    }
  }

  const failures = [];

  // ---- R1 / R2 -----------------------------------------------------------
  for (const c of configs) {
    if (HELPER.test(c.name)) {
      const referenced = configs.some(
        (o) => o.name !== c.name && stripComments(o.code).includes(c.name),
      );
      if (!referenced) {
        failures.push(
          `${BUSINESS_DIR}/${c.name}: helper config referenced by no jest config. ` +
            "Delete it, or point the config that needs it at it.",
        );
      }
      continue;
    }
    if (!invoked.has(c.name)) {
      failures.push(
        `${BUSINESS_DIR}/${c.name}: invoked by NO workflow. Every jest config must be ` +
          "run by CI or deleted — an unrun suite reads identically to a running one in " +
          "a PR and guards nothing (#1486). Add it to a workflow, or delete the config " +
          "AND the tests it was the only runner for.",
      );
    }
  }

  // ---- R3 — the hand-off promise -----------------------------------------
  const defaultConfig = byName.get(DEFAULT_CONFIG);
  for (const claimed of matchAll(defaultConfig.code, CONFIG_NAME)) {
    if (claimed === DEFAULT_CONFIG) continue;
    if (!byName.has(claimed)) {
      // HARD FAIL, never a skip: a hand-off pointing at a file that does not
      // exist means the excluded tests have no runner at all.
      return {
        code: 2,
        failures: [
          `${BUSINESS_DIR}/${DEFAULT_CONFIG} names "${claimed}", which does NOT EXIST. ` +
            "testPathIgnorePatterns excludes those tests from the default run on the " +
            "promise that this config runs them; the config is gone, so nothing runs " +
            "them. Resolve the hand-off or drop the exclusion — do not leave the comment.",
        ],
      };
    }
    if (!invoked.has(claimed)) {
      failures.push(
        `${BUSINESS_DIR}/${DEFAULT_CONFIG} hands off to "${claimed}", but no workflow ` +
          "invokes it. The exclusion is enforced; the promise is not. Those tests run nowhere.",
      );
    }
  }

  return { code: failures.length > 0 ? 1 : 0, failures };
};

// ───────────────────────────── self-test ──────────────────────────────────
if (SELF_TEST) {
  const filler = "const filler = 1;\n".repeat(4);
  const mkConfigs = () => [
    {
      name: "jest.config.cjs",
      code: `${filler}// runs under jest.alpha.render.cjs\nmodule.exports = { testPathIgnorePatterns: ["a"] };`,
    },
    { name: "jest.alpha.render.cjs", code: `${filler}module.exports = {};` },
    { name: "jest.beta.cfg.cjs", code: `${filler}module.exports = {};` },
    {
      name: "jest.gamma.render.cjs",
      code: `${filler}require("./jest.gamma.babel.cjs");`,
    },
    { name: "jest.gamma.babel.cjs", code: `${filler}module.exports = {};` },
    { name: "jest.shared-stub.cjs", code: `${filler}module.exports = {};` },
  ];
  // Pad to the floor with configs a workflow runs, so fixtures exercise the
  // RULES rather than tripping the vacuity guard.
  const pad = (list, n = MIN_CONFIGS) => {
    const out = [...list];
    for (let i = out.length; i < n; i += 1) {
      out.push({ name: `jest.pad${i}.cjs`, code: `${filler}module.exports = {};` });
    }
    return out;
  };
  const padWorkflows = (list, n = MIN_WORKFLOWS) => {
    const out = [...list];
    for (let i = out.length; i < n; i += 1) {
      out.push({ name: `wf-pad-${i}.yml`, text: "run: echo noop" });
    }
    return out;
  };

  const configsWithPadStub = () => {
    const base = pad(mkConfigs());
    // the stub must be referenced by SOME config for R2
    base[1] = {
      ...base[1],
      code: `${base[1].code}\nrequire("./jest.shared-stub.cjs");`,
    };
    return base;
  };

  const padRunner = pad(mkConfigs())
    .filter((c) => c.name.startsWith("jest.pad"))
    .map((c) => `npx jest --config ${c.name}`)
    .join("\n");

  const cleanWorkflows = () =>
    padWorkflows([
      {
        name: "alpha.yml",
        text: `run: npx jest --config jest.alpha.render.cjs\nrun: npx jest --config jest.gamma.render.cjs\n${padRunner}`,
      },
      { name: "beta.yml", text: "run: npm run test:beta" },
      { name: "default.yml", text: "run: npm test -- --ci" },
    ]);

  const npmScripts = { "test:beta": "npx jest --config jest.beta.cfg.cjs" };

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — a fully wired tree passes (and `npm run` reaches jest.beta.cfg.cjs
  //     transitively, and `npm test` confers invocation on jest.config.cjs).
  {
    const r = run({ configs: configsWithPadStub(), workflows: cleanWorkflows(), npmScripts });
    if (r.code !== 0) problems.push(`clean fixture: exit ${r.code} — ${r.failures.join(" | ")}`);
  }

  // 2 — THE #1486 DEFECT ITSELF. A config no workflow invokes fails.
  {
    const workflows = padWorkflows([
      {
        name: "alpha.yml",
        text: `run: npx jest --config jest.alpha.render.cjs\nrun: npx jest --config jest.gamma.render.cjs\n${padRunner}`,
      },
      { name: "default.yml", text: "run: npm test -- --ci" },
    ]);
    const r = run({ configs: configsWithPadStub(), workflows, npmScripts });
    expect("uninvoked config", r.code, 1);
    if (!r.failures.some((m) => m.includes("jest.beta.cfg.cjs"))) {
      problems.push("uninvoked-config failure did not name jest.beta.cfg.cjs");
    }
  }

  // 3 — THE HAND-OFF PROMISE. jest.config.cjs names a config that EXISTS but
  //     that no workflow runs: the exclusion is enforced, the promise is not.
  {
    const configs = configsWithPadStub().map((c) =>
      c.name === "jest.config.cjs"
        ? { ...c, code: `${filler}// runs under jest.beta.cfg.cjs\nmodule.exports = {};` }
        : c,
    );
    const workflows = padWorkflows([
      {
        name: "alpha.yml",
        text: `run: npx jest --config jest.alpha.render.cjs\nrun: npx jest --config jest.gamma.render.cjs\n${padRunner}`,
      },
      { name: "default.yml", text: "run: npm test -- --ci" },
    ]);
    const r = run({ configs, workflows, npmScripts });
    expect("hand-off to uninvoked config", r.code, 1);
    if (!r.failures.some((m) => m.includes("hands off"))) {
      problems.push("hand-off failure did not name the broken promise");
    }
  }

  // 4 — MISSING TARGET IS A HARD FAILURE, NEVER A SKIP (#1559's standard).
  //     jest.config.cjs promises a runner that is not on disk at all.
  {
    const configs = configsWithPadStub().map((c) =>
      c.name === "jest.config.cjs"
        ? { ...c, code: `${filler}// runs under jest.deleted.render.cjs\nmodule.exports = {};` }
        : c,
    );
    const r = run({ configs, workflows: cleanWorkflows(), npmScripts });
    expect("hand-off to NON-EXISTENT config", r.code, 2);
    if (!r.failures.some((m) => m.includes("does NOT EXIST"))) {
      problems.push("missing-target failure did not say the target does not exist");
    }
  }

  // 5 — THE VACUITY GUARD. An empty enumeration must go RED, not green.
  {
    const r = run({ configs: [], workflows: cleanWorkflows(), npmScripts });
    expect("ZERO configs enumerated", r.code, 2);
    if (!r.failures.some((m) => m.startsWith("VACUOUS"))) {
      problems.push("empty enumeration did not report VACUOUS");
    }
  }

  // 6 — a short config sweep (targets silently dropped) is vacuous too.
  expect(
    "truncated config sweep",
    run({ configs: configsWithPadStub().slice(0, 6), workflows: cleanWorkflows(), npmScripts }).code,
    2,
  );

  // 7 — zero workflows observed is vacuous: nothing could be proven invoked.
  expect(
    "ZERO workflows read",
    run({ configs: configsWithPadStub(), workflows: [], npmScripts }).code,
    2,
  );

  // 8 — an unreadable config is a hard failure, not a skip.
  {
    const configs = configsWithPadStub().map((c) =>
      c.name === "jest.alpha.render.cjs" ? { ...c, code: null } : c,
    );
    expect("unreadable config", run({ configs, workflows: cleanWorkflows(), npmScripts }).code, 2);
  }

  // 9 — losing jest.config.cjs from the sweep is vacuous: R3 would check nothing.
  {
    const configs = configsWithPadStub().filter((c) => c.name !== "jest.config.cjs");
    expect("default config absent from sweep", run({ configs, workflows: cleanWorkflows(), npmScripts }).code, 2);
  }

  // 10 — an orphan helper stub nobody loads fails (R2).
  {
    const configs = pad(mkConfigs()); // stub deliberately unreferenced
    const r = run({ configs, workflows: cleanWorkflows(), npmScripts });
    expect("orphan helper stub", r.code, 1);
    if (!r.failures.some((m) => m.includes("jest.shared-stub.cjs"))) {
      problems.push("orphan-helper failure did not name the stub");
    }
  }

  // 11 — a workflow that runs jest with an EXPLICIT --config must NOT be read
  //      as also invoking the default config. Otherwise jest.config.cjs would
  //      look invoked even if the real default suite job were deleted.
  {
    const workflows = padWorkflows([
      {
        name: "alpha.yml",
        text: `run: npx jest --config jest.alpha.render.cjs\nrun: npx jest --config jest.gamma.render.cjs\nrun: npx jest --config jest.beta.cfg.cjs\n${padRunner}`,
      },
    ]);
    const r = run({ configs: configsWithPadStub(), workflows, npmScripts });
    expect("explicit --config does not confer default invocation", r.code, 1);
    if (!r.failures.some((m) => m.includes("jest.config.cjs: invoked by NO workflow"))) {
      problems.push("explicit-config fixture did not flag jest.config.cjs as uninvoked");
    }
  }

  // 12 — A COMMENT MUST NEVER CONFER INVOCATION. This is the defect the FIRST
  //      live run of this gate exposed in the gate itself: a wired babel helper
  //      whose header prose read "Used ONLY by jest.orch1118.render.cjs" made
  //      that uninvoked render config look invoked, and the gate stayed silent
  //      about it. Prose about a suite is not a suite running.
  {
    const configs = configsWithPadStub().map((c) =>
      c.name === "jest.gamma.babel.cjs"
        ? { ...c, code: `${filler}// Used ONLY by jest.beta.cfg.cjs to transform .tsx\nmodule.exports = {};` }
        : c,
    );
    const workflows = padWorkflows([
      {
        name: "alpha.yml",
        text: `run: npx jest --config jest.alpha.render.cjs\nrun: npx jest --config jest.gamma.render.cjs\n${padRunner}`,
      },
      { name: "default.yml", text: "run: npm test -- --ci" },
    ]);
    const r = run({ configs, workflows, npmScripts });
    expect("comment mention does not confer invocation", r.code, 1);
    if (!r.failures.some((m) => m.includes("jest.beta.cfg.cjs: invoked by NO workflow"))) {
      problems.push(
        "a comment naming jest.beta.cfg.cjs made it look invoked — the exact #1486 defect, inside the gate",
      );
    }
  }

  if (problems.length > 0) {
    console.error("SELF-TEST FAIL:");
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    "#1486 jest-config-invoked-by-workflow gate self-test passed (12 fixtures: " +
      "uninvoked config, broken hand-off, NON-EXISTENT hand-off target, ZERO-config " +
      "enumeration, truncated sweep, ZERO workflows, unreadable config, missing default " +
      "config, orphan helper, explicit-config isolation, comment-is-not-invocation " +
      "— every one RED, none skipped).",
  );
  process.exit(0);
}

// ───────────────────────────── live scan ──────────────────────────────────
const businessPath = join(root, BUSINESS_DIR);
const configs = (existsSync(businessPath) ? readdirSync(businessPath) : [])
  .filter((f) => /^jest\..*\.cjs$/.test(f))
  .sort()
  .map((name) => {
    const p = join(businessPath, name);
    return { name, code: existsSync(p) ? readFileSync(p, "utf8") : null };
  });

const workflowPath = join(root, WORKFLOW_DIR);
const workflows = (existsSync(workflowPath) ? readdirSync(workflowPath) : [])
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((name) => {
    const p = join(workflowPath, name);
    return { name, text: existsSync(p) ? readFileSync(p, "utf8") : null };
  });

let npmScripts = {};
const pkgPath = join(businessPath, "package.json");
if (existsSync(pkgPath)) {
  npmScripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
}

const { code, failures } = run({ configs, workflows, npmScripts });
if (code !== 0) {
  console.error(
    code === 2
      ? "#1486 jest-config-invoked-by-workflow gate VACUOUS — it could not evaluate its own invariant:"
      : "#1486 jest-config-invoked-by-workflow gate failed:",
  );
  for (const f of failures) console.error(`- ${f}`);
  process.exit(code);
}
console.log(
  `#1486 jest-config-invoked-by-workflow gate passed (${configs.length} configs, ` +
    `${workflows.length} workflows, ${Object.keys(npmScripts).length} npm scripts; ` +
    "every config invoked, every testPathIgnorePatterns hand-off resolves to a config CI runs).",
);
