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
 *   S-5 RELEASE-BOUND FAIL-CLOSED (#1732 / #1733). A THIRD run, sanitised but
 *       carrying `EAS_BUILD_PROFILE=production` + `MINGLA_STRIPE_MODE=live`,
 *       must EXIT NON-ZERO for BOTH apps, and the failure must NAME
 *       `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
 *
 *   S-5 is the executed counterpart of S-4, and the two are not in tension —
 *   they assert different environments. S-4 pins what LOCAL DEV resolves
 *   (`EAS_BUILD_PROFILE` undefined -> the committed sandbox literal, exit 0), and
 *   that is deliberately unchanged. S-5 pins what a RELEASE BUILD does with the
 *   same absent environment: refuse. Before #1732 a native `mingla-business`
 *   build with the env absent silently shipped the sandbox `pk_test_` literal
 *   against the live backend (the #990 brick), because the mode DEFAULTS to
 *   live and only pk_live-under-test was rejected; before #1733 `app-mobile`
 *   shipped no payment key at all. `EAS_BUILD_PROFILE` is the discriminator,
 *   which is exactly why the sanitiser strips it — a gate that could not turn
 *   the discriminator on could not test the guard.
 *
 *   The masks (`RELEASE_BOUND_MASKS`) exist so the S-5 verdict cannot be earned
 *   by the WRONG guard: both configs carry sibling release-bound fail-loud
 *   guards (AppsFlyer on both, GIPHY on business) that would otherwise throw
 *   first and make a non-zero exit meaningless. The Stripe key is the one value
 *   deliberately left absent, and the message check proves it is the one that
 *   spoke.
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

/** S-5 — the EAS profile used to turn the release-bound guards ON. */
export const RELEASE_BOUND_PROFILE = "production";

/**
 * S-5 — obviously-fake values for the SIBLING release-bound guards only.
 *
 * `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is deliberately NOT here: it is the
 * subject under test. Without these masks the AppsFlyer guard (both apps) or
 * the GIPHY guard (business) throws first, the run still exits non-zero, and
 * S-5 would pass while proving nothing about the payment key.
 */
export const RELEASE_BOUND_MASKS = {
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "af_MINGLA1732SENTINEL",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "id0000000000",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.example.mingla1732sentinel",
  EXPO_PUBLIC_GIPHY_API_KEY: "gk_MINGLA1732SENTINEL",
};

/** The payment key S-5 asserts on. */
export const STRIPE_KEY_NAME = "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY";

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

/**
 * S-5 — the sanitised environment PLUS a release-bound EAS profile and live
 * mode, with every sibling release-bound guard masked. This is precisely the
 * environment a blind `eas update`/EAS build sees on a production profile.
 */
export function releaseBoundEnv() {
  const env = childEnv(false);
  for (const [k, v] of Object.entries(RELEASE_BOUND_MASKS)) env[k] = v;
  env.EAS_BUILD_PROFILE = RELEASE_BOUND_PROFILE;
  env.MINGLA_STRIPE_MODE = "live";
  return env;
}

/**
 * S-5 — pure evaluator. All spawning is injected so the self-test drives every
 * branch with fixtures.
 *
 * @param {object} a
 * @param {string} a.app                expectation-table id ("consumer"|"business")
 * @param {number|null|undefined} a.status  child exit status (null = never ran)
 * @param {string} a.output             the child's combined stdout+stderr
 * @returns {{code:number, messages:string[]}}
 */
export function evaluateReleaseBound({ app, status, output }) {
  if (status === null || status === undefined) {
    return {
      code: 2,
      messages: [
        `VACUOUS: the release-bound run for "${app}" produced no exit status, so nothing was ` +
          "measured. A check that could not run is never a pass.",
      ],
    };
  }
  const text = String(output ?? "");
  if (status === 0) {
    return {
      code: 1,
      messages: [
        `S-5 ${app}: a RELEASE-BOUND config read (EAS_BUILD_PROFILE=${RELEASE_BOUND_PROFILE}, ` +
          `MINGLA_STRIPE_MODE=live) with ${STRIPE_KEY_NAME} ABSENT exited 0. The fail-closed ` +
          "guard is gone. On mingla-business that means the committed pk_test_ sandbox literal " +
          "ships against the live backend and the app sticks on its splash screen (#990); on " +
          "app-mobile it means the published update carries no payment key at all, so the #994 " +
          "post-publish check has nothing to assert (2026-08-06).",
      ],
    };
  }
  if (!text.includes(STRIPE_KEY_NAME)) {
    return {
      code: 1,
      messages: [
        `S-5 ${app}: the release-bound run exited ${status}, but its output never names ` +
          `${STRIPE_KEY_NAME}. Something ELSE refused first — a sibling release-bound guard, or ` +
          "the config failing to load at all — so this non-zero exit is not evidence about the " +
          "payment key. Add the missing sibling to RELEASE_BOUND_MASKS rather than accepting a " +
          `verdict earned by the wrong guard.\n--- output ---\n${text.trim().slice(0, 1200)}`,
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `  S-5 OK ${app}: a release-bound config read with ${STRIPE_KEY_NAME} absent exits ` +
        `${status} and names the payment key.`,
    ],
  };
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
  // #1733: app-mobile now emits the payment key into `extra`, so the consumer
  // table carries TWO tripwires and every consumer fixture must exercise both.
  const consumerBlind = (over = {}) =>
    pad({
      EXPO_PUBLIC_POSTHOG_KEY: {},
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: {},
      ...over,
    });
  const consumerApplied = (over = {}) =>
    pad({
      EXPO_PUBLIC_POSTHOG_KEY: SENTINELS.EXPO_PUBLIC_POSTHOG_KEY,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: SENTINELS.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      ...over,
    });

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
      blindExtra: consumerBlind({ EXPO_PUBLIC_POSTHOG_KEY: "phc_committedliteral" }),
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
      appliedExtra: consumerApplied({ EXPO_PUBLIC_POSTHOG_KEY: "phc_somethingelse" }),
    });
    expect("3 S-2 sentinel not plumbed through", r.code, 1);
    expectMsg("3 S-2 sentinel not plumbed through", r.messages, "S-2");
  }
  // 4 — S-3: identical A/B runs.
  {
    const same = consumerApplied();
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
      blindExtra: consumerBlind({ EXPO_PUBLIC_POSTHOG_KEY: null }),
      appliedExtra: consumerApplied(),
    }).code,
    0,
  );
  // 4d (#1733) — S-1 on the SECOND consumer tripwire: the payment key resolving
  // to a real value in the blind run means app.config.js handed it a committed
  // literal fallback, which is the one thing Corollary 4 forbids.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: consumerBlind({
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_committedliteral",
      }),
      appliedExtra: consumerApplied(),
    });
    expect("4d S-1 consumer payment tripwire gained a fallback", r.code, 1);
    expectMsg("4d S-1 consumer payment tripwire gained a fallback", r.messages, "unfalsifiable");
  }
  // 4e (#1733) — S-2 on the SECOND consumer tripwire: the applied run failing to
  // carry the sentinel means app.config.js stopped EMITTING the payment key into
  // `extra`, which is exactly the state #1733 fixed.
  {
    const r = evaluateRuns({
      app: "consumer",
      blindExtra: consumerBlind(),
      appliedExtra: consumerApplied({ EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined }),
    });
    expect("4e S-2 consumer payment key no longer emitted into extra", r.code, 1);
    expectMsg("4e S-2 consumer payment key no longer emitted into extra", r.messages, "S-2");
  }
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
  // 11b (#1733) — the consumer table must carry BOTH tripwires. One tripwire is
  // a single point of failure for the whole consumer half of #994.
  for (const name of ["EXPO_PUBLIC_POSTHOG_KEY", STRIPE_KEY_NAME]) {
    if (!EXPECTATIONS.consumer.some((e) => e.name === name)) {
      problems.push(`11b EXPECTATIONS.consumer lost the ${name} tripwire`);
    }
  }

  // ---- S-5, release-bound fail-closed (#1732 / #1733), cases 12-15 ----
  // 12 — the shipped shape: a non-zero exit whose output names the payment key.
  for (const app of ["consumer", "business"]) {
    const r = evaluateReleaseBound({
      app,
      status: 1,
      output: `Error: ${STRIPE_KEY_NAME} is required for the production EAS_BUILD_PROFILE build`,
    });
    expect(`12 S-5 ${app} fails closed and names the key`, r.code, 0);
  }
  // 13 — THE FAILS-ON-REVERT CASE. Delete either config guard and the release-
  //      bound read succeeds again; that must be a hard failure, not a pass.
  {
    const r = evaluateReleaseBound({ app: "business", status: 0, output: '{"extra":{}}' });
    expect("13 S-5 release-bound read exits 0 (guard deleted)", r.code, 1);
    expectMsg("13 S-5 release-bound read exits 0 (guard deleted)", r.messages, "fail-closed guard is gone");
  }
  // 14 — VERDICT EARNED BY THE WRONG GUARD. A sibling release-bound guard
  //      (AppsFlyer / GIPHY) throwing first also exits non-zero. Accepting that
  //      would let the payment guard be deleted while S-5 stayed green — the
  //      unfalsifiable-gate mode this whole issue exists to prevent.
  {
    const r = evaluateReleaseBound({
      app: "business",
      status: 1,
      output: "Error: EXPO_PUBLIC_APPSFLYER_DEV_KEY ... are required for the production build",
    });
    expect("14 S-5 non-zero exit from the wrong guard", r.code, 1);
    expectMsg("14 S-5 non-zero exit from the wrong guard", r.messages, "Something ELSE refused first");
  }
  // 15 — VACUITY: the child never produced a status, so nothing was measured.
  {
    const r = evaluateReleaseBound({ app: "consumer", status: null, output: "" });
    expect("15 S-5 VACUITY no exit status", r.code, 2);
  }
  // 15b — the release-bound env must actually turn the discriminator ON, must
  //       keep the payment key ABSENT, and must mask the siblings.
  {
    const env = releaseBoundEnv();
    if (env.EAS_BUILD_PROFILE !== RELEASE_BOUND_PROFILE) {
      problems.push("15b releaseBoundEnv does not set a release-bound EAS_BUILD_PROFILE");
    }
    if (env.MINGLA_STRIPE_MODE !== "live") {
      problems.push("15b releaseBoundEnv does not pin MINGLA_STRIPE_MODE=live");
    }
    if (env[STRIPE_KEY_NAME] !== undefined) {
      problems.push(
        `15b releaseBoundEnv leaks ${STRIPE_KEY_NAME} into the child — the subject under test ` +
          "must be the one value that is absent",
      );
    }
    for (const k of Object.keys(RELEASE_BOUND_MASKS)) {
      if (env[k] !== RELEASE_BOUND_MASKS[k]) {
        problems.push(`15b releaseBoundEnv does not mask the sibling guard variable ${k}`);
      }
    }
    if (env.EXPO_NO_DOTENV !== "1") {
      problems.push("15b releaseBoundEnv is not dotenv-blind, so a local .env could supply the key");
    }
  }

  if (problems.length) {
    console.error("#994 OTA-ENV-RESOLUTION self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#994 OTA-ENV-RESOLUTION self-test PASS (22/22: 1/4b/4c/5 clean consumer+business incl. " +
      "null and absent unset signatures; 2/6b S-1 falsifiability lost; 3 S-2 plumbing broken; " +
      "4 S-3 degenerate A/B; 6 S-4 pinned #990 hazard changed; 7/7b/8/9 vacuity " +
      "(unparseable stdout, no extra, thin extra, empty table); 10 sanitiser + EXPO_NO_DOTENV " +
      "+ sentinel plumbing; 11 every real tripwire has a sentinel; " +
      "4d/4e/11b (#1733) the SECOND consumer tripwire — the payment key gaining a literal " +
      "fallback, the payment key no longer emitted into `extra`, and the table keeping both; " +
      "12-15b (#1732/#1733) S-5 release-bound fail-closed — both apps refuse and name the " +
      "payment key, a release-bound read that exits 0 is a hard failure, a non-zero exit earned " +
      "by a SIBLING guard is rejected, a missing exit status is vacuity, and the release-bound " +
      "env really flips the discriminator while keeping the payment key absent).",
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

/**
 * S-5 — the release-bound run. Deliberately NOT `--json`: with `--json` the Expo
 * CLI prints NOTHING on a config-evaluation error (verified 2026-08-09, both
 * apps, empty stdout AND empty stderr, exit 1), so the message check that keeps
 * this assertion honest would have nothing to read. Plain mode puts the config's
 * own error on stderr.
 */
function resolveConfigReleaseBound(appDir) {
  const proc = spawnSync("npx", ["expo", "config", "--type", "public"], {
    cwd: path.join(repoRoot, appDir),
    env: releaseBoundEnv(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (proc.error) {
    throw new SmokeVacuityError(
      `VACUOUS: could not spawn \`expo config\` for the release-bound run (${proc.error.message}).`,
    );
  }
  return { status: proc.status, output: `${proc.stdout || ""}\n${proc.stderr || ""}` };
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
  let releaseBound;
  try {
    blindExtra = resolveConfig(appDir, false);
    appliedExtra = resolveConfig(appDir, true);
    releaseBound = resolveConfigReleaseBound(appDir);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? 2);
  }

  const result = evaluateRuns({ app, blindExtra, appliedExtra });
  const s5 = evaluateReleaseBound({ app, ...releaseBound });
  // Vacuity in either half wins; otherwise a failure in either half fails.
  const code = Math.max(result.code === 2 || s5.code === 2 ? 2 : 0, result.code, s5.code);
  const messages = [...result.messages, ...s5.messages];
  if (code === 0) messages.forEach((m) => console.log(m));
  else messages.forEach((m) => console.error(m));
  process.exit(code);
}

if (process.argv.includes("--self-test")) selfTest();
else liveRun();
