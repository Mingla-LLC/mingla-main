#!/usr/bin/env node
// #994 WP5b — WHY THIS GATE EXISTS.
//
// The #994 post-publish check reads a handful of `EXPO_PUBLIC_*` values out of
// the SERVED manifest and decides from them whether `--environment production`
// took effect. That only works while those values still DIFFER between a blind
// publish and a correct one. The day one of them acquires a committed literal
// fallback, the post-publish check keeps printing OK forever and detects
// nothing — and nothing else in the repo would notice.
//
// So this gate does not check the guard. It checks that the guard can still
// FAIL. It is Seth's own 2026-08-06 two-command experiment promoted to CI and
// EXECUTED rather than grepped: resolve each app's config twice — once with the
// environment stripped, once with obviously-fake sentinels applied — and diff
// the resolved `extra`.
//
// A source-shape assertion (the #994 strict-grep gate's Rule 4) cannot do this:
// it proves the SOURCE still says `?? null`, not that the config RESOLVES that
// way. Both exist on purpose; this one is the executable half.
/**
 * #994 [ota-publish-guardrails] — I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND
 * (DRAFT; flips ACTIVE at CLOSE). SPEC §6.3.
 *
 * WHAT IT ENFORCES, per app
 *   S-1 FALSIFIABILITY. In the BLIND run, every tripwire resolves to the UNSET
 *       SIGNATURE (`{}`, `null`, or absent). A tripwire that resolves to a real
 *       value in the blind run can no longer distinguish a blind publish from a
 *       correct one.
 *   S-2 PLUMBING. In the APPLIED run, every tripwire resolves to its sentinel
 *       VERBATIM. This proves env -> `extra` still works at all; without it S-1
 *       could pass because the config stopped reading the environment entirely.
 *   S-3 NON-DEGENERACY. The two runs' `extra` must differ on at least one key.
 *       Two identical runs mean the harness varied nothing.
 *   S-4 THE #990 HAZARD, PINNED. For mingla-business the blind run must exit 0
 *       and resolve `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` to a `pk_test_` value —
 *       the committed sandbox literal. That is the residual #990 hole (the
 *       config's local branch accepts pk_test_ under a live backend). It is
 *       deliberately NOT fixed here; it is PINNED, so a future refactor that
 *       changes it shows up in a diff instead of in production. Closing that
 *       hole is a separate issue and changes this assertion on purpose.
 *
 *   S-4 is why S-1 does not apply to that one key: an expectation carrying an
 *   explicit `blindPrefix` is governed by S-4 instead. Every other tripwire is
 *   governed by S-1.
 *
 * DETERMINISM: both runs set `EXPO_NO_DOTENV=1`. Without it Expo re-injects the
 * operator's local `mingla-business/.env` into the child AFTER the sanitiser has
 * cleared the process env, and the blind run resolves REAL keys — green in CI
 * (no .env) and red on a laptop (verified 2026-08-09). A gate whose verdict
 * depends on an untracked file is not a gate.
 *
 * THE TRIPWIRE TABLE IS IMPORTED, NOT RESTATED. It comes from
 * scripts/ota/verify-published-manifest.mjs so the repo holds exactly ONE
 * expectation table. If the post-publish check's table and this gate's table
 * could drift, this gate would be certifying the falsifiability of a table
 * nobody uses.
 *
 * WHAT THIS GATE DOES NOT CATCH — read before citing it as proof.
 *   - It does NOT boot the app. The #990 failure was a runtime throw during
 *     render; this gate would have caught the pk VALUE that caused it, but not a
 *     boot-time throw arising from anything else. A real release-mode boot gate
 *     is not achievable per-PR at reasonable cost (SPEC §6.1) and is deliberately
 *     a documented human step instead (handbook §7.6).
 *   - It does NOT prove the published bundle carries the values. That is the
 *     post-publish served-manifest check, and only that.
 *   - It does NOT exercise `--environment production` against EAS servers.
 *     There is no EAS auth in CI. It proves the config's env -> `extra`
 *     plumbing, not the CLI's environment resolution.
 *   - It does NOT cover bundle-inlined-only keys (`EXPO_PUBLIC_SENTRY_DSN`,
 *     `EXPO_PUBLIC_MIXPANEL_TOKEN`) — they never reach `extra`.
 *   - It does NOT run Hermes, minification, or any release transform.
 */
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { EXPECTATIONS, MIN_EXTRA_KEYS } from "../../../scripts/ota/verify-published-manifest.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Matrix values -> the expectation-table id in the verifier module. */
export const APP_DIRS = {
  "app-mobile": "consumer",
  "mingla-business": "business",
};

/**
 * Obviously-fake values. They carry no secret and could not work against any
 * real service, which is the point — a sentinel that looked real would be a
 * credential in a workflow file.
 */
export const SENTINELS = {
  EXPO_PUBLIC_POSTHOG_KEY: "phc_MINGLA994SENTINEL",
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_MINGLA994SENTINEL",
  EXPO_PUBLIC_GIPHY_API_KEY: "gk_MINGLA994SENTINEL",
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: "pk.MINGLA994SENTINEL",
};

/**
 * S-4 overrides. A tripwire listed here is EXEMPT from S-1 and is asserted
 * against this blind-run prefix instead. See the header.
 */
export const BLIND_PREFIX_OVERRIDES = {
  business: { EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_" },
};

/** Every variable the sanitiser removes on top of the `EXPO_PUBLIC_*` sweep. */
export const EXTRA_SANITISED = [
  "EAS_BUILD_PROFILE",
  "VERCEL_ENV",
  "MINGLA_STRIPE_MODE",
];

export class SmokeVacuityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeVacuityError";
    this.exitCode = 2;
  }
}

/** The unset signature, as it appears in resolved config JSON. */
export function isUnsetSignature(value) {
  return (
    value === null ||
    value === undefined ||
    JSON.stringify(value) === "{}"
  );
}

/**
 * @param {string} stdout raw stdout of `expo config --json --type public`
 * @returns {Record<string, unknown>} the resolved `extra`
 * @throws {SmokeVacuityError}
 */
export function parseConfigStdout(stdout) {
  let doc;
  try {
    doc = JSON.parse(stdout);
  } catch (err) {
    throw new SmokeVacuityError(
      `VACUOUS: \`expo config --json\` stdout is not parseable JSON (${err.message}). ` +
        "Nothing below was actually resolved.",
    );
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new SmokeVacuityError(
      "VACUOUS: `expo config --json` did not print a JSON object.",
    );
  }
  const extra = doc.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    throw new SmokeVacuityError(
      "VACUOUS: the resolved config carries no `extra` object, so no tripwire could be read.",
    );
  }
  return extra;
}

/**
 * Pure evaluator — all process spawning is injected, so the self-test drives
 * every assertion with fixtures.
 *
 * @param {object} a
 * @param {string} a.app                    expectation-table id ("consumer"|"business")
 * @param {Record<string,unknown>} a.blindExtra
 * @param {Record<string,unknown>} a.appliedExtra
 * @param {{name:string}[]} [a.tripwires]   defaults to EXPECTATIONS[app]
 * @returns {{code:number, messages:string[]}}
 */
export function evaluateRuns({ app, blindExtra, appliedExtra, tripwires }) {
  const table = tripwires ?? EXPECTATIONS[app];
  if (!Array.isArray(table) || table.length === 0) {
    return {
      code: 2,
      messages: [
        `VACUOUS: the tripwire table for "${app}" is EMPTY. A loop over zero tripwires ` +
          "certifies nothing — refusing to report success.",
      ],
    };
  }
  for (const [label, extra] of [
    ["blind", blindExtra],
    ["applied", appliedExtra],
  ]) {
    if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
      return {
        code: 2,
        messages: [`VACUOUS: the ${label} run produced no \`extra\` object.`],
      };
    }
    if (Object.keys(extra).length < MIN_EXTRA_KEYS) {
      return {
        code: 2,
        messages: [
          `VACUOUS: the ${label} run's \`extra\` holds ${Object.keys(extra).length} keys ` +
            `(floor ${MIN_EXTRA_KEYS}); the config did not really resolve.`,
        ],
      };
    }
  }

  const failures = [];
  const notes = [];
  const overrides = BLIND_PREFIX_OVERRIDES[app] ?? {};

  for (const exp of table) {
    const name = exp.name;
    const blind = Object.prototype.hasOwnProperty.call(blindExtra, name)
      ? blindExtra[name]
      : undefined;
    const applied = Object.prototype.hasOwnProperty.call(appliedExtra, name)
      ? appliedExtra[name]
      : undefined;
    const override = overrides[name];

    // S-4 / S-1 on the blind run.
    if (override) {
      if (typeof blind !== "string" || !blind.startsWith(override)) {
        failures.push(
          `S-4 ${name}: the BLIND run resolved ${JSON.stringify(blind)}, but the pinned #990 ` +
            `hazard is a value starting "${override}" (the committed sandbox literal). ` +
            "This assertion pins CURRENT behaviour on purpose: if the config's local branch " +
            "changed, that is a deliberate decision that belongs in a PR with a reason, not a " +
            "surprise discovered in production.",
        );
      } else {
        notes.push(`  S-4 OK ${name}: blind run pinned at "${override}…" as expected.`);
      }
    } else if (!isUnsetSignature(blind)) {
      failures.push(
        `S-1 ${name}: the BLIND run resolved ${JSON.stringify(blind)} instead of the unset ` +
          "signature. This key no longer distinguishes a blind publish from a correct one — " +
          "the #994 post-publish manifest check has become unfalsifiable, and would have " +
          "passed on 2026-08-06.",
      );
    } else {
      notes.push(`  S-1 OK ${name}: blind run resolves to the unset signature.`);
    }

    // S-2 on the applied run.
    const sentinel = SENTINELS[name];
    if (sentinel === undefined) {
      failures.push(
        `S-2 ${name}: no sentinel is defined for this tripwire, so the applied run cannot be ` +
          "checked. Add one to SENTINELS — an unchecked tripwire is not a tripwire.",
      );
    } else if (applied !== sentinel) {
      failures.push(
        `S-2 ${name}: the APPLIED run resolved ${JSON.stringify(applied)}, expected the ` +
          `sentinel ${JSON.stringify(sentinel)} verbatim. The environment -> \`extra\` plumbing ` +
          "is broken, so S-1 above would pass for the wrong reason.",
      );
    } else {
      notes.push(`  S-2 OK ${name}: applied run carries the sentinel verbatim.`);
    }
  }

  // S-3 non-degeneracy.
  const keys = new Set([...Object.keys(blindExtra), ...Object.keys(appliedExtra)]);
  let differing = 0;
  for (const k of keys) {
    if (JSON.stringify(blindExtra[k]) !== JSON.stringify(appliedExtra[k])) differing += 1;
  }
  if (differing === 0) {
    failures.push(
      "S-3: the blind and applied runs resolved IDENTICAL `extra` objects. The harness varied " +
        "nothing, so every assertion above passed for the wrong reason.",
    );
  } else {
    notes.push(`  S-3 OK: the two runs differ on ${differing} key(s).`);
  }

  if (failures.length) {
    return {
      code: 1,
      messages: [
        `FAIL [I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND / env-resolution, app=${app}]:`,
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `OK [I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND / env-resolution, app=${app}]: ` +
        `${table.length} tripwire(s) still falsifiable; blind extra ` +
        `${Object.keys(blindExtra).length} keys, applied extra ${Object.keys(appliedExtra).length} keys.`,
      ...notes,
    ],
  };
}

/** Build the sanitised child environment. `applied` adds the sentinels. */
export function childEnv(applied) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("EXPO_PUBLIC_")) continue;
    if (EXTRA_SANITISED.includes(k)) continue;
    env[k] = v;
  }
  // Expo auto-loads .env files. Without this the blind run silently reads the
  // operator's local .env and stops being blind. See the header.
  env.EXPO_NO_DOTENV = "1";
  env.CI = "1";
  if (applied) {
    for (const [k, v] of Object.entries(SENTINELS)) env[k] = v;
    env.MINGLA_STRIPE_MODE = "live";
  }
  return env;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
function selfTest() {
  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };
  const expectMsg = (label, messages, needle) => {
    if (!messages.some((m) => m.includes(needle))) {
      problems.push(`${label}: no message contained "${needle}"`);
    }
  };
  const pad = (o) => ({ a: 1, b: 2, c: 3, d: 4, e: 5, ...o });

  // ---- consumer ----
  const consumerBlind = () => pad({ EXPO_PUBLIC_POSTHOG_KEY: {} });
  const consumerApplied = () =>
    pad({ EXPO_PUBLIC_POSTHOG_KEY: SENTINELS.EXPO_PUBLIC_POSTHOG_KEY });

  // 1 — blind run with the tripwire unset, applied run carrying the sentinel.
  expect(
    "1 consumer clean",
    evaluateRuns({
      app: "consumer",
      blindExtra: consumerBlind(),
      appliedExtra: consumerApplied(),
    }).code,
    0,
  );
  // 2 — S-1: the tripwire resolves to a real value in the BLIND run.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: pad({ EXPO_PUBLIC_POSTHOG_KEY: "phc_committedliteral" }),
      appliedExtra: consumerApplied(),
    });
    expect("2 S-1 tripwire gained a fallback", r.code, 1);
    expectMsg("2 S-1 tripwire gained a fallback", r.messages, "unfalsifiable");
  }
  // 3 — S-2: the applied run does not carry the sentinel.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: consumerBlind(),
      appliedExtra: pad({ EXPO_PUBLIC_POSTHOG_KEY: "phc_somethingelse" }),
    });
    expect("3 S-2 sentinel not plumbed through", r.code, 1);
    expectMsg("3 S-2 sentinel not plumbed through", r.messages, "S-2");
  }
  // 4 — S-3: identical A/B runs.
  {
    const same = pad({ EXPO_PUBLIC_POSTHOG_KEY: SENTINELS.EXPO_PUBLIC_POSTHOG_KEY });
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: same,
      appliedExtra: { ...same },
    });
    expect("4 S-3 identical runs", r.code, 1);
    expectMsg("4 S-3 identical runs", r.messages, "S-3");
  }
  // 4b — the tripwire resolving to `null` is also the unset signature.
  expect(
    "4b null is an unset signature",
    evaluateRuns({
      app: "consumer",
      blindExtra: pad({ EXPO_PUBLIC_POSTHOG_KEY: null }),
      appliedExtra: consumerApplied(),
    }).code,
    0,
  );
  // 4c — the tripwire absent entirely is also the unset signature.
  expect(
    "4c absent is an unset signature",
    evaluateRuns({
      app: "consumer",
      blindExtra: pad({}),
      appliedExtra: consumerApplied(),
    }).code,
    0,
  );

  // ---- business ----
  const bizBlind = (over = {}) =>
    pad({
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_51TTnt1sandboxliteral",
      EXPO_PUBLIC_GIPHY_API_KEY: {},
      ...over,
    });
  const bizApplied = (over = {}) =>
    pad({
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: SENTINELS.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      EXPO_PUBLIC_GIPHY_API_KEY: SENTINELS.EXPO_PUBLIC_GIPHY_API_KEY,
      ...over,
    });

  // 5 — business clean: S-4 pinned at pk_test_, GIPHY unset, sentinels applied.
  expect(
    "5 business clean",
    evaluateRuns({ app: "business", blindExtra: bizBlind(), appliedExtra: bizApplied() }).code,
    0,
  );
  // 6 — S-4: the blind run resolves a pk_live_ value (the pinned hazard changed).
  {
    const r = evaluateRuns({
      app: "business",
      blindExtra: bizBlind({ EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_realkey" }),
      appliedExtra: bizApplied(),
    });
    expect("6 S-4 blind run resolves pk_live_", r.code, 1);
    expectMsg("6 S-4 blind run resolves pk_live_", r.messages, "S-4");
  }
  // 6b — S-1 still governs the business GIPHY tripwire.
  {
    const r = evaluateRuns({
      app: "business",
      blindExtra: bizBlind({ EXPO_PUBLIC_GIPHY_API_KEY: "besogftLreal" }),
      appliedExtra: bizApplied(),
    });
    expect("6b S-1 business giphy gained a fallback", r.code, 1);
    expectMsg("6b S-1 business giphy gained a fallback", r.messages, "S-1");
  }

  // ---- vacuity, every one exit 2 ----
  // 7 — unparseable stdout.
  {
    let code = 0;
    try {
      parseConfigStdout("Starting Metro…\nnot json");
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("7 VACUITY unparseable stdout", code, 2);
  }
  // 7b — stdout parses but carries no `extra`.
  {
    let code = 0;
    try {
      parseConfigStdout(JSON.stringify({ name: "x" }));
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("7b VACUITY no extra object", code, 2);
  }
  // 8 — an `extra` too thin to have really resolved.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: { EXPO_PUBLIC_POSTHOG_KEY: {} },
      appliedExtra: consumerApplied(),
    });
    expect("8 VACUITY thin extra", r.code, 2);
  }
  // 9 — an empty tripwire table.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: consumerBlind(),
      appliedExtra: consumerApplied(),
      tripwires: [],
    });
    expect("9 VACUITY empty tripwire table", r.code, 2);
  }

  // ---- harness invariants ----
  // 10 — the sanitiser really removes what it claims, and pins EXPO_NO_DOTENV.
  {
    process.env.EXPO_PUBLIC_MINGLA994_PROBE = "leaked";
    process.env.VERCEL_ENV = "production";
    const blind = childEnv(false);
    const applied = childEnv(true);
    delete process.env.EXPO_PUBLIC_MINGLA994_PROBE;
    delete process.env.VERCEL_ENV;
    if (blind.EXPO_PUBLIC_MINGLA994_PROBE !== undefined) {
      problems.push("10 sanitiser leaked an EXPO_PUBLIC_ var into the blind run");
    }
    if (blind.VERCEL_ENV !== undefined) {
      problems.push("10 sanitiser leaked VERCEL_ENV into the blind run");
    }
    if (blind.EXPO_NO_DOTENV !== "1" || applied.EXPO_NO_DOTENV !== "1") {
      problems.push("10 EXPO_NO_DOTENV is not pinned in both runs — the blind run is not blind");
    }
    if (applied.EXPO_PUBLIC_POSTHOG_KEY !== SENTINELS.EXPO_PUBLIC_POSTHOG_KEY) {
      problems.push("10 applied run does not carry the sentinels");
    }
    if (applied.MINGLA_STRIPE_MODE !== "live") {
      problems.push("10 applied run does not set MINGLA_STRIPE_MODE=live");
    }
  }
  // 11 — every tripwire in every real table has a sentinel.
  for (const [app, table] of Object.entries(EXPECTATIONS)) {
    for (const exp of table) {
      if (SENTINELS[exp.name] === undefined) {
        problems.push(`11 EXPECTATIONS.${app} tripwire ${exp.name} has no sentinel`);
      }
    }
  }

  if (problems.length) {
    console.error("#994 OTA-ENV-RESOLUTION self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#994 OTA-ENV-RESOLUTION self-test PASS (14/14: 1/4b/4c/5 clean consumer+business incl. " +
      "null and absent unset signatures; 2/6b S-1 falsifiability lost; 3 S-2 plumbing broken; " +
      "4 S-3 degenerate A/B; 6 S-4 pinned #990 hazard changed; 7/7b/8/9 vacuity " +
      "(unparseable stdout, no extra, thin extra, empty table); 10 sanitiser + EXPO_NO_DOTENV " +
      "+ sentinel plumbing; 11 every real tripwire has a sentinel).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
function resolveConfig(appDir, applied) {
  const proc = spawnSync(
    "npx",
    ["expo", "config", "--json", "--type", "public"],
    {
      cwd: path.join(repoRoot, appDir),
      env: childEnv(applied),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const label = applied ? "applied" : "blind";
  if (proc.error) {
    throw new SmokeVacuityError(
      `VACUOUS: could not spawn \`expo config\` for the ${label} run (${proc.error.message}).`,
    );
  }
  if (proc.status !== 0) {
    throw new SmokeVacuityError(
      `VACUOUS: the ${label} run of \`expo config --json --type public\` in ${appDir} exited ` +
        `${proc.status}. Expected 0.\n--- stderr ---\n${(proc.stderr || "").trim()}`,
    );
  }
  return parseConfigStdout(proc.stdout);
}

function liveRun() {
  const i = process.argv.indexOf("--app");
  const appDir = i === -1 ? null : process.argv[i + 1];
  if (!appDir || !Object.prototype.hasOwnProperty.call(APP_DIRS, appDir)) {
    console.error(
      `usage: node .github/scripts/strict-grep/issue-994-ota-env-resolution-smoke.mjs --app <${Object.keys(APP_DIRS).join("|")}>`,
    );
    console.error("       node .github/scripts/strict-grep/issue-994-ota-env-resolution-smoke.mjs --self-test");
    process.exit(2);
  }
  const app = APP_DIRS[appDir];

  let blindExtra;
  let appliedExtra;
  try {
    blindExtra = resolveConfig(appDir, false);
    appliedExtra = resolveConfig(appDir, true);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? 2);
  }

  const result = evaluateRuns({ app, blindExtra, appliedExtra });
  if (result.code === 0) result.messages.forEach((m) => console.log(m));
  else result.messages.forEach((m) => console.error(m));
  process.exit(result.code);
}

if (process.argv.includes("--self-test")) selfTest();
else liveRun();
