#!/usr/bin/env node
// #994 — WHY THIS GATE EXISTS.
//
// Five production over-the-air updates have been published without
// `--environment production`. The CLI resolves every EXPO_PUBLIC_* value from
// the operator's LOCAL .env instead of the EAS 'production' environment, and
// then exits 0. Twice it shipped: mingla-business stuck on its splash screen
// (#990, noticed in minutes) and app-mobile looked completely normal for forty
// minutes while checkout was silently dead (2026-08-06).
//
// The canonical wrapper scripts existed for the business app the whole time.
// Nothing prevented bypassing them, and the 2026-08-06 landmine was a DOCUMENT:
// a runbook that told a human to run the raw command. So the enforcement
// mechanism is a human reading a runbook, and this gate is what keeps the
// runbook true.
//
// THREE LESSONS FROM THE REPO'S OWN RISK REGISTER ARE BUILT IN:
//   #1550 R2 — a gate that SKIPS a missing/unreadable file is not a gate. Every
//        such case here is exit 2, never a pass. The ONE deliberate exception is
//        a missing WRAPPER SCRIPT: its absence is the bug itself (Rule 2, exit
//        1), not a broken scan.
//   #1518/#1529 — assert the scan OBSERVED something before evaluating any
//        violation. A clean tree and a broken walker look identical otherwise.
//   feedback_unfalsifiable_test_bug_class — Rule 4 guards the GUARD: if the one
//        value that can distinguish a blind publish from a correct one ever
//        acquires a literal fallback, the post-publish check silently becomes
//        vacuous. That must be a red build, not a quiet forever-pass.
/**
 * #994 [ota-publish-guardrails] — I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND
 * (DRAFT; flips ACTIVE at CLOSE). SPEC §5.
 *
 * WHAT IT ENFORCES
 *   1. NO ENV-BLIND PRODUCTION PUBLISH ANYWHERE TRACKED. Every tracked text
 *      file is scanned. Shell line-continuations are joined first, so a command
 *      split across lines is judged as ONE command. Inside each logical line,
 *      every `eas update` / `eas-cli update` / `eas-cli@<ver> update` (but NOT
 *      the `eas update:<subcommand>` colon forms) starts a command; the command
 *      text runs to the end of that logical line. A command is a PRODUCTION
 *      PUBLISH SHAPE if it carries `--branch production`, `--branch=production`,
 *      `--channel production` or `--channel=production`. Every production
 *      publish shape MUST also carry `--environment production` (or the `=`
 *      form) in the SAME command text.
 *   2. BOTH CANONICAL WRAPPERS EXIST AND ARE SAFE. Both
 *      `<app>/scripts/ota/publish-production-ota.sh` must exist, and each must
 *      carry `--branch production`, `--environment production` and
 *      `--platform "${PLATFORM}"` — and must NOT carry the combined-platform
 *      form, which fails on the web bundle.
 *   3. THE GUARDRAILS CANNOT BE SILENTLY DELETED. Each wrapper must still name
 *      `preflight_key`, must still call `scripts/ota/verify-published-manifest.mjs`,
 *      and must still pass `--json`. Each must declare `MINGLA_EAS_BIN` with a
 *      default that is the REAL binary, so the tester's seam cannot be
 *      repurposed as a bypass, and neither may grow a rehearsal / no-op mode.
 *   4. TRIPWIRE INTEGRITY. `app-mobile/app.config.ts` must keep
 *      `EXPO_PUBLIC_POSTHOG_KEY: process.env.… ?? null` — with NO string
 *      literal fallback — and `mingla-business/app.config.ts` must keep
 *      `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.… ?? null`.
 *   5. THE HANDBOOK KEEPS POINTING AT THE TRUTH. §7.6 must name BOTH wrapper
 *      scripts and must keep the literal `"EXPO_PUBLIC_POSTHOG_KEY":{}` — the
 *      unset signature a human has to be able to recognise.
 *
 * GRANDFATHERED / ALLOWED SHAPES — enumerated so they are not re-litigated:
 *   · prose such as `never bare \`eas update\`` — no `--branch/--channel
 *     production` in the command text, so it is not a production publish shape;
 *   · `eas update:roll-back-to-embedded`, `update:list`, `update:republish`,
 *     `update:view`, `update:configure`, `update:delete`, `update:edit` — the
 *     colon forms are not publishes and are excluded by the extractor;
 *   · the handbook's two consumer commands — they carry the flag;
 *   · a line-continued invocation — continuations are joined before matching;
 *   · this gate file itself — self-excluded BY PATH, because its fixtures
 *     contain violating strings by construction.
 *
 * EXPLICITLY NOT ALLOWED: the flag reaching the CLI through indirection
 * (`$FLAGS`, `${EAS_FLAGS}`, an array expansion, a `.env` var). The flag must be
 * literal and visible at the call site. A gate that accepts indirection cannot
 * tell a correct command from a broken one, and the actual enforcement
 * mechanism here is a human reading the command.
 *
 * WHAT THIS GATE DOES NOT CATCH — read before citing it as proof.
 *   - It is a SOURCE-SHAPE gate. It proves no tracked file INSTRUCTS an
 *     env-blind production publish and that the wrappers still carry their
 *     guardrails. It cannot stop a human typing the raw command into a terminal,
 *     and it cannot see `.claude/**`, which is gitignored — that surface is a
 *     permanent manual-review item, recorded in the invariant.
 *   - The wrappers call the CLI through the `MINGLA_EAS_BIN` seam, so their own
 *     invocations are NOT production publish shapes under Rule 1's literal
 *     regex. They are policed by Rules 2 and 3 instead, over comment-stripped
 *     dense source, which is strictly stricter for those two files.
 *   - Rules 2 and 3 are WHOLE-FILE presence checks, not per-invocation ones.
 *     Each wrapper passes `--platform "${PLATFORM}"` to BOTH the publish command
 *     and the verifier, so deleting it from the publish command alone would not
 *     fire Rule 2. The shape that actually breaks a publish — the
 *     combined-platform form — is a forbidden needle and does fire.
 *   - It does NOT prove any published update is correct. That is the
 *     post-publish served-manifest check (scripts/ota/verify-published-manifest.mjs),
 *     and only that.
 *   - It does NOT prove the app boots.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Rule 2/3/4/5 targets. Keys are used by runGate's `targets` map. */
const PATHS = {
  bizScript: "mingla-business/scripts/ota/publish-production-ota.sh",
  consumerScript: "app-mobile/scripts/ota/publish-production-ota.sh",
  consumerConfig: "app-mobile/app.config.ts",
  bizConfig: "mingla-business/app.config.ts",
  handbook: "docs/MINGLA_ENGINEERING_HANDBOOK.md",
};

/** This gate's own path — self-excluded from the Rule 1 scan (see header). */
const SELF_REL = ".github/scripts/strict-grep/issue-994-ota-publish-guardrails.mjs";

const PRUNE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "web-build",
  ".expo",
  "coverage",
  "Pods",
  ".next",
  ".gradle",
]);
/** Path fragments pruned as whole subtrees (dir names alone are too broad). */
const PRUNE_RELS = new Set([
  "ios/Pods",
  "android/build",
  "android/.gradle",
  "Mingla_Artifacts/archive",
]);
const SCAN_EXTS = new Set([
  ".md", ".sh", ".bash", ".zsh", ".yml", ".yaml", ".mjs", ".cjs",
  ".js", ".jsx", ".ts", ".tsx", ".json", ".txt",
]);

/** P-V1 — a walker that found this few files is broken, not a clean tree. */
export const MIN_SCANNED_FILES = 500;
/** P-V2 — the extractor must observe real production publish shapes to prove itself. */
export const MIN_PRODUCTION_SHAPES = 2;
/** P-V4 — a target this small after comment-stripping cannot be asserted against. */
export const MIN_DENSE_CHARS = 200;

/** Comments stripped (the `[^:]` guard keeps `https://` intact), whitespace removed. */
export const denseJs = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");

/**
 * Strip shell `#` comments, quote-aware, then remove all whitespace. A `#`
 * inside quotes (`"[#994 preflight]"`, a sed expression) is NOT a comment, and
 * treating it as one would silently delete the code the rules assert on.
 */
export const denseShell = (src) =>
  src
    .split("\n")
    .map((line) => {
      let inS = false;
      let inD = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inD) inS = !inS;
        else if (c === '"' && !inS) inD = !inD;
        else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n")
    .replace(/\s+/g, "");

/**
 * Join shell line-continuations so a command split across lines is judged as
 * ONE command. Nothing else is joined — a plain markdown line break is a real
 * command boundary.
 * @param {string} text
 * @returns {string[]}
 */
export function assembleLogicalLines(text) {
  const out = [];
  let buf = null;
  for (const line of text.split("\n")) {
    const continued = /\\[ \t]*$/.test(line);
    const body = continued ? line.replace(/\\[ \t]*$/, "") : line;
    buf = buf === null ? body : buf + " " + body;
    if (!continued) {
      out.push(buf);
      buf = null;
    }
  }
  if (buf !== null) out.push(buf);
  return out;
}

/**
 * `eas update`, `eas-cli update`, `eas-cli@latest update`, `eas-cli@19.1.0
 * update` — but never `eas update:` (the colon subcommands are not publishes).
 */
const EAS_UPDATE_RE = /\beas(?:-cli(?:@[^\s]+)?)?\s+update\b(?!:)/g;

/**
 * Every publish-command text in a logical line: from each match to the end of
 * that logical line.
 * @param {string} logicalLine
 * @returns {string[]}
 */
export function extractCommands(logicalLine) {
  const cmds = [];
  EAS_UPDATE_RE.lastIndex = 0;
  let m;
  while ((m = EAS_UPDATE_RE.exec(logicalLine)) !== null) {
    cmds.push(logicalLine.slice(m.index));
  }
  return cmds;
}

/** Whitespace-collapsed, so `--branch   production` compares equal. */
const collapse = (s) => s.replace(/\s+/g, " ");

/** @param {string} cmd */
export function isProductionPublishShape(cmd) {
  const c = collapse(cmd);
  return (
    c.includes("--branch production") ||
    c.includes("--branch=production") ||
    c.includes("--channel production") ||
    c.includes("--channel=production")
  );
}

/** @param {string} cmd */
export function hasEnvironmentProduction(cmd) {
  const c = collapse(cmd);
  return (
    c.includes("--environment production") || c.includes("--environment=production")
  );
}

/**
 * Per-wrapper Rule 2/3 contract. Needles are matched against comment-stripped
 * DENSE shell source, so reformatting cannot disarm them and a needle cannot be
 * split across a line break to slip past.
 */
const WRAPPER_CONTRACT = {
  bizScript: {
    app: "mingla-business",
    easBinNeedle: 'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"',
    easBinHuman: '${MINGLA_EAS_BIN:-eas}',
  },
  consumerScript: {
    app: "app-mobile",
    easBinNeedle: 'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-npx-yeas-cli@latest}"',
    easBinHuman: '${MINGLA_EAS_BIN:-npx -y eas-cli@latest}',
  },
};

/** Rule 2 — present in every wrapper, dense. */
const WRAPPER_REQUIRED = [
  ["--branchproduction", "the production branch flag"],
  ["--environmentproduction", "`--environment production`, the flag five incidents were missing"],
  ['--platform"${PLATFORM}"', "the per-platform flag"],
];
/** Rule 3 — present in every wrapper, dense. */
const GUARDRAIL_REQUIRED = [
  ["preflight_key", "the pre-flight key checker (SPEC §3.2)"],
  [
    "scripts/ota/verify-published-manifest.mjs",
    "the post-publish served-manifest verification (SPEC §4.3)",
  ],
  ["--json", "`--json`, without which the update group is scraped from human text"],
];
/** Rule 2/3 — forbidden in every wrapper, dense. */
const WRAPPER_FORBIDDEN = [
  ["--platformall", "the combined-platform form, which fails on the web bundle"],
  ["--dry-run", "a rehearsal mode, which would itself become the thing people run"],
  ["MINGLA_OTA_DRY_RUN", "a rehearsal mode, which would itself become the thing people run"],
];

/** Rule 4 — the tripwires the post-publish check depends on. */
const TRIPWIRE_REQUIRED = {
  consumerConfig: [
    "EXPO_PUBLIC_POSTHOG_KEY:process.env.EXPO_PUBLIC_POSTHOG_KEY??null",
  ],
  bizConfig: [
    "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN:process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN??null",
  ],
};
/** Rule 4 — a literal fallback on the consumer tripwire disarms everything. */
const TRIPWIRE_FORBIDDEN = {
  consumerConfig: [
    'EXPO_PUBLIC_POSTHOG_KEY:process.env.EXPO_PUBLIC_POSTHOG_KEY??"',
    "EXPO_PUBLIC_POSTHOG_KEY:process.env.EXPO_PUBLIC_POSTHOG_KEY??'",
  ],
};

/** Rule 5 — raw source, because the artifact this rule governs IS prose. */
const HANDBOOK_REQUIRED = [
  PATHS.consumerScript,
  PATHS.bizScript,
  '"EXPO_PUBLIC_POSTHOG_KEY":{}',
];

/**
 * Pure so the self-test can plant fixtures.
 *
 * @param {object} input
 * @param {{path:string, text:string}[]} input.scanned   Rule 1 scan set
 * @param {Record<string,string|null>} input.targets     PATHS key -> source, null = missing
 * @returns {{code:number, messages:string[]}}
 */
export function runGate({ scanned, targets }) {
  // ---- P-V1: the walker must have observed a real tree. ----
  if (!Array.isArray(scanned) || scanned.length < MIN_SCANNED_FILES) {
    return {
      code: 2,
      messages: [
        `#994 gate VACUOUS — scanned ${Array.isArray(scanned) ? scanned.length : 0} files, ` +
          `below the floor ${MIN_SCANNED_FILES}. The walker is broken; a clean tree and a ` +
          "broken scan look identical, so this is exit 2, never a pass.",
      ],
    };
  }

  // ---- P-V3/P-V4 on the Rule-4/5 targets. A missing config or handbook makes
  //      those rules unevaluable. A missing WRAPPER is different: its absence is
  //      the bug Rule 2 exists to name, so it is handled below as exit 1. ----
  const dense = {};
  for (const key of ["consumerConfig", "bizConfig"]) {
    const src = targets[key];
    if (src === null || src === undefined) {
      return {
        code: 2,
        messages: [
          `#994 gate FAIL — ${PATHS[key]} is missing or unreadable, so the tripwire-integrity ` +
            "rule cannot be evaluated. A gate that SKIPS a missing file is not a gate (#1550 R2).",
        ],
      };
    }
    dense[key] = denseJs(src);
    if (dense[key].length < MIN_DENSE_CHARS) {
      return {
        code: 2,
        messages: [
          `#994 gate VACUOUS — ${PATHS[key]} has only ${dense[key].length} chars of real code after ` +
            "comment-stripping; every assertion below would pass for the wrong reason.",
        ],
      };
    }
  }
  if (targets.handbook === null || targets.handbook === undefined) {
    return {
      code: 2,
      messages: [
        `#994 gate FAIL — ${PATHS.handbook} is missing or unreadable, so the documentation rule ` +
          "cannot be evaluated. A gate that SKIPS a missing file is not a gate (#1550 R2).",
      ],
    };
  }

  const failures = [];

  // ---- Rule 1: no env-blind production publish anywhere tracked. ----
  let productionShapes = 0;
  for (const file of scanned) {
    if (file.path === SELF_REL) continue; // self-exclusion (see header)
    for (const logical of assembleLogicalLines(file.text)) {
      for (const cmd of extractCommands(logical)) {
        if (!isProductionPublishShape(cmd)) continue;
        productionShapes += 1;
        if (hasEnvironmentProduction(cmd)) continue;
        failures.push(
          `${file.path}: a PRODUCTION PUBLISH command carries no \`--environment production\`:\n` +
            `        ${collapse(cmd).slice(0, 180)}\n` +
            "        Without it the CLI inlines EXPO_PUBLIC_* from the LOCAL .env and exits 0. " +
            "That has shipped five production incidents (#990, 2026-08-06). The flag must be " +
            "literal and visible on this command — indirection does not satisfy the rule.",
        );
      }
    }
  }

  // ---- P-V2: the extractor must have proven itself on real shapes. ----
  if (productionShapes < MIN_PRODUCTION_SHAPES) {
    return {
      code: 2,
      messages: [
        `#994 gate VACUOUS — only ${productionShapes} production publish shape(s) found across ` +
          `${scanned.length} scanned files, below the floor ${MIN_PRODUCTION_SHAPES}. Either the ` +
          "extractor is broken or the handbook's documented publish commands were deleted. " +
          "A rule that matched nothing must fail, not pass.",
      ],
    };
  }

  // ---- Rules 2 + 3: both wrappers exist and keep their guardrails. ----
  for (const [key, contract] of Object.entries(WRAPPER_CONTRACT)) {
    const src = targets[key];
    if (src === null || src === undefined) {
      failures.push(
        `${PATHS[key]}: the canonical ${contract.app} production OTA wrapper is MISSING. ` +
          "Its absence IS the bug (#994 WP1): without it the documented path is a raw command " +
          "and the flag is somebody's memory again.",
      );
      continue;
    }
    const d = denseShell(src);
    if (d.length < MIN_DENSE_CHARS) {
      return {
        code: 2,
        messages: [
          `#994 gate VACUOUS — ${PATHS[key]} has only ${d.length} chars of real code after ` +
            "comment-stripping; every assertion below would pass for the wrong reason.",
        ],
      };
    }
    for (const [needle, why] of WRAPPER_REQUIRED) {
      if (!d.includes(needle)) {
        failures.push(
          `${PATHS[key]}: the publish invocation no longer carries ${why} (\`${needle}\` absent ` +
            "from comment-stripped source). The wrapper is the ONLY documented publish path, so " +
            "this is the five-incident failure re-armed.",
        );
      }
    }
    for (const [needle, why] of GUARDRAIL_REQUIRED) {
      if (!d.includes(needle)) {
        failures.push(
          `${PATHS[key]}: ${why} has been removed (\`${needle}\` absent from comment-stripped ` +
            "source). The wrapper would still publish, and would still exit 0, with nothing " +
            "checking what it shipped.",
        );
      }
    }
    for (const [needle, why] of WRAPPER_FORBIDDEN) {
      if (d.includes(needle)) {
        failures.push(
          `${PATHS[key]}: contains \`${needle}\` — ${why}.`,
        );
      }
    }
    if (!d.includes(contract.easBinNeedle)) {
      failures.push(
        `${PATHS[key]}: MINGLA_EAS_BIN no longer defaults to the real binary ` +
          `(\`${contract.easBinHuman}\` absent from comment-stripped source). That variable is a ` +
          "TEST SEAM. If its default stops being the real CLI, the wrapper silently stops " +
          "publishing — or publishes through something else — and the seam has become the bypass.",
      );
    }
  }

  // ---- Rule 4: tripwire integrity — guard the guard. ----
  for (const [key, needles] of Object.entries(TRIPWIRE_REQUIRED)) {
    for (const needle of needles) {
      if (!dense[key].includes(needle)) {
        failures.push(
          `${PATHS[key]}: the #994 manifest tripwire \`${needle}\` is gone. ` +
            "The post-publish check reads this value out of the served manifest to decide whether " +
            "`--environment production` took effect at all; without it there is nothing to read.",
        );
      }
    }
  }
  for (const [key, needles] of Object.entries(TRIPWIRE_FORBIDDEN)) {
    for (const needle of needles) {
      if (dense[key].includes(needle)) {
        failures.push(
          `${PATHS[key]}: the consumer app's ONLY manifest tripwire has acquired a literal ` +
            "fallback — the #994 post-publish check is now unfalsifiable and would have passed on " +
            "2026-08-06. A key with a committed fallback resolves identically on a blind publish " +
            "and on a correct one, so it cannot tell them apart.",
        );
      }
    }
  }

  // ---- Rule 5: the handbook keeps pointing at the truth (RAW source). ----
  for (const needle of HANDBOOK_REQUIRED) {
    if (!targets.handbook.includes(needle)) {
      failures.push(
        `${PATHS.handbook}: §7.6 no longer contains \`${needle}\`. ` +
          "The runbook IS the enforcement mechanism for a human at a terminal — a handbook that " +
          "stops naming the wrappers, or stops showing the unset signature, is how the " +
          "2026-08-06 landmine got planted.",
      );
    }
  }

  if (failures.length > 0) {
    return {
      code: 1,
      messages: [
        "FAIL [I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND]:",
        ...failures.map((f) => `  x ${f}`),
      ],
    };
  }
  return {
    code: 0,
    messages: [
      `OK [I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND]: ${scanned.length} files scanned; ` +
        `${productionShapes} production publish shape(s) found and every one carries ` +
        "`--environment production`; both canonical wrappers present with their preflight, " +
        "served-manifest verification, `--json` and real MINGLA_EAS_BIN default intact; " +
        "both app.config.ts tripwires still fall back to null; the handbook still names both " +
        "wrappers and the unset signature.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Live-mode walker
// ---------------------------------------------------------------------------
function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function walkScanSet(root) {
  const files = [];
  let binaries = 0;
  const visit = (abs, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const en of entries) {
      const childRel = rel ? `${rel}/${en.name}` : en.name;
      if (PRUNE_RELS.has(childRel)) continue;
      if (en.isSymbolicLink()) continue;
      if (en.isDirectory()) {
        if (PRUNE_DIRS.has(en.name)) continue;
        visit(path.join(abs, en.name), childRel);
        continue;
      }
      if (!en.isFile()) continue;
      const ext = path.extname(en.name);
      let buf;
      try {
        buf = fs.readFileSync(path.join(abs, en.name));
      } catch {
        continue;
      }
      if (isBinary(buf)) {
        binaries += 1;
        continue;
      }
      const text = buf.toString("utf8");
      if (!SCAN_EXTS.has(ext)) {
        if (ext !== "") continue;
        const firstLine = text.slice(0, text.indexOf("\n") === -1 ? 200 : text.indexOf("\n"));
        if (!(firstLine.startsWith("#!") && firstLine.includes("sh"))) continue;
      }
      files.push({ path: childRel, text });
    }
  };
  visit(root, "");
  return { files, binaries };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const filler = "const filler = 1; ".repeat(30);

  const cleanBizScript = () =>
    [
      "#!/usr/bin/env bash",
      "# #994 canonical wrapper. Never run the raw command.",
      "set -euo pipefail",
      'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"',
      'VERIFIER="${REPO_ROOT}/scripts/ota/verify-published-manifest.mjs"',
      "preflight_key() { echo checking; }",
      "preflight_key EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY required pk_live_",
      "if ! ${MINGLA_EAS_BIN} update \\",
      "  --branch production \\",
      "  --environment production \\",
      '  --platform "${PLATFORM}" \\',
      '  --message "${MESSAGE}" \\',
      '  --json --non-interactive >"${JSONLOG}"; then exit 1; fi',
      'node "${VERIFIER}" --update-json "${JSONLOG}" --app business --platform "${PLATFORM}"',
      `# ${filler}`,
      `echo "${filler}"`,
    ].join("\n");

  const cleanConsumerScript = () =>
    cleanBizScript()
      .replace(
        'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"',
        'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-npx -y eas-cli@latest}"',
      )
      .replace("--app business", "--app consumer");

  const cleanConsumerConfig = () =>
    [
      "export default {",
      "  extra: {",
      "    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? null,",
      '    EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",',
      "  },",
      "};",
      filler,
    ].join("\n");

  const cleanBizConfig = () =>
    [
      "export default {",
      "  extra: {",
      "    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN:",
      "      process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null,",
      '    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "phc_committedliteral",',
      "  },",
      "};",
      filler,
    ].join("\n");

  const cleanHandbook = () =>
    [
      "### 7.6 EAS OTA",
      "Business — via the canonical script ONLY (never bare `eas update`):",
      "```bash",
      "mingla-business/scripts/ota/publish-production-ota.sh ios     \"<summary>\"",
      "app-mobile/scripts/ota/publish-production-ota.sh ios     \"<summary>\"",
      "```",
      "```bash",
      "cd app-mobile && npx -y eas-cli@latest update --branch production --environment production --platform ios     --message \"<summary>\"",
      "cd app-mobile && npx -y eas-cli@latest update --branch production --environment production --platform android  --message \"<summary>\"",
      "```",
      "Keep `eas update:roll-back-to-embedded --branch production` ready.",
      '"EXPO_PUBLIC_POSTHOG_KEY":{}     <- unset. The publish was blind.',
      filler,
    ].join("\n");

  const padScan = (extra = []) => {
    const files = [...extra];
    for (let i = files.length; i < MIN_SCANNED_FILES + 20; i++) {
      files.push({ path: `filler/${i}.ts`, text: "export const x = 1;\n" });
    }
    return files;
  };

  const clean = () => {
    const targets = {
      bizScript: cleanBizScript(),
      consumerScript: cleanConsumerScript(),
      consumerConfig: cleanConsumerConfig(),
      bizConfig: cleanBizConfig(),
      handbook: cleanHandbook(),
    };
    const scanned = padScan(
      Object.entries(targets).map(([k, text]) => ({ path: PATHS[k], text })),
    );
    return { scanned, targets };
  };

  /** Re-derive the scan set from the (possibly mutated) targets. */
  const sync = (f) => {
    f.scanned = padScan(
      Object.entries(f.targets)
        .filter(([, text]) => text !== null)
        .map(([k, text]) => ({ path: PATHS[k], text })),
    );
    return f;
  };

  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };

  // 1 — clean fixture passes.
  expect("1 clean", runGate(clean()).code, 0);

  // ---- THE FIVE FAILS-ON-REVERT CASES (SPEC §8.1) ----
  // 2 — R-1: a literal revert of the handbook fix (d942a9281): the consumer
  //     commands lose `--environment production`.
  {
    const f = clean();
    f.targets.handbook = f.targets.handbook.replace(
      / --environment production/g,
      "",
    );
    expect("2 R-1 handbook loses --environment production", runGate(sync(f)).code, 1);
  }
  // 3 — R-2: the consumer wrapper is absent. Exit 1 (Rule 2), NOT exit 2: its
  //     absence is the bug, not a broken scan.
  {
    const f = clean();
    f.targets.consumerScript = null;
    expect("3 R-2 consumer wrapper absent", runGate(sync(f)).code, 1);
  }
  // 4 — R-3: the business wrapper loses `--environment production`.
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript.replace(
      "  --environment production \\\n",
      "",
    );
    expect("4 R-3 business wrapper loses the env flag", runGate(sync(f)).code, 1);
  }
  // 5 — R-4: the post-publish verification call is removed (business).
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript
      .split("\n")
      .filter((l) => !l.includes("verify-published-manifest.mjs"))
      .join("\n");
    expect("5 R-4 business drops the verifier call", runGate(sync(f)).code, 1);
  }
  // 5b — R-4 on the consumer wrapper.
  {
    const f = clean();
    f.targets.consumerScript = f.targets.consumerScript
      .split("\n")
      .filter((l) => !l.includes("verify-published-manifest.mjs"))
      .join("\n");
    expect("5b R-4 consumer drops the verifier call", runGate(sync(f)).code, 1);
  }
  // 6 — R-5: the consumer tripwire acquires a string literal fallback.
  {
    const f = clean();
    f.targets.consumerConfig = f.targets.consumerConfig.replace(
      "process.env.EXPO_PUBLIC_POSTHOG_KEY ?? null",
      'process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "phc_kiBp4PLw8j"',
    );
    expect("6 R-5 consumer tripwire gains a literal fallback", runGate(sync(f)).code, 1);
  }

  // ---- allowed shapes must NOT fire ----
  // 7 — a line-continued safe invocation.
  {
    const f = clean();
    f.targets.handbook +=
      "\n```bash\neas update \\\n  --branch production \\\n  --environment production\n```\n";
    expect("7 line-continued safe invocation", runGate(sync(f)).code, 0);
  }
  // 8 — the colon form is not a publish, even with --branch production.
  {
    const f = clean();
    f.targets.handbook +=
      "\neas update:roll-back-to-embedded --branch production --platform ios\n";
    expect("8 colon subcommand", runGate(sync(f)).code, 0);
  }
  // 9 — prose that names the raw command without targeting production.
  {
    const f = clean();
    f.targets.handbook += "\nnever bare `eas update` — always the wrapper.\n";
    expect("9 prose mention", runGate(sync(f)).code, 0);
  }

  // ---- wrapper-integrity violations ----
  // 10 — the combined-platform form appears in a wrapper.
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript.replace(
      '  --platform "${PLATFORM}" \\',
      '  --platform all \\\n  --platform "${PLATFORM}" \\',
    );
    expect("10 combined-platform form present", runGate(sync(f)).code, 1);
  }
  // 11 — the MINGLA_EAS_BIN default stops being the real binary (business).
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript.replace(
      'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"',
      'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-echo}"',
    );
    expect("11 business seam default changed", runGate(sync(f)).code, 1);
  }
  // 11b — the same on the consumer wrapper.
  {
    const f = clean();
    f.targets.consumerScript = f.targets.consumerScript.replace(
      'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-npx -y eas-cli@latest}"',
      'MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"',
    );
    expect("11b consumer seam default changed", runGate(sync(f)).code, 1);
  }
  // 12 — a rehearsal mode is introduced.
  {
    const f = clean();
    f.targets.consumerScript += '\nif [ -n "${MINGLA_OTA_DRY_RUN}" ]; then exit 0; fi\n';
    expect("12 rehearsal mode introduced", runGate(sync(f)).code, 1);
  }
  // 13 — the preflight function is deleted.
  {
    const f = clean();
    f.targets.consumerScript = f.targets.consumerScript
      .split("\n")
      .filter((l) => !l.includes("preflight_key"))
      .join("\n");
    expect("13 preflight_key removed", runGate(sync(f)).code, 1);
  }
  // 14 — `--json` is dropped, so the group is scraped from human text again.
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript.replace(
      "  --json --non-interactive",
      "  --non-interactive",
    );
    expect("14 --json dropped", runGate(sync(f)).code, 1);
  }
  // 15 — the per-platform flag is dropped from the wrapper entirely.
  //      NOTE the deliberate limit recorded in the header: the needle is a
  //      whole-file presence check, and the wrapper passes the same flag to the
  //      verifier, so removing it from the publish invocation ALONE does not
  //      fire this rule. Case 10 (combined-platform form) covers the shape that
  //      actually breaks a publish.
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript
      .split("\n")
      .filter((l) => !l.includes('--platform "${PLATFORM}"'))
      .join("\n");
    expect("15 per-platform flag dropped", runGate(sync(f)).code, 1);
  }

  // ---- Rule 1 evasion shapes ----
  // 16 — the `=` form of --branch, with no environment flag.
  {
    const f = clean();
    f.targets.handbook += "\neas update --branch=production --platform ios\n";
    expect("16 --branch=production without env", runGate(sync(f)).code, 1);
  }
  // 17 — --channel instead of --branch.
  {
    const f = clean();
    f.targets.handbook += "\neas update --channel production --platform ios\n";
    expect("17 --channel production without env", runGate(sync(f)).code, 1);
  }
  // 18 — a violation in a file that is NOT one of the rule targets.
  {
    const f = clean();
    f.scanned = padScan([
      ...Object.entries(f.targets).map(([k, text]) => ({ path: PATHS[k], text })),
      {
        path: "scripts/ops/some-runbook.md",
        text: "npx eas-cli@19.1.0 update --branch production --platform android\n",
      },
    ]);
    expect("18 violation in an unrelated tracked file", runGate(f).code, 1);
  }

  // ---- Rule 4 / Rule 5 ----
  // 19 — the business Mapbox tripwire loses its null fallback.
  {
    const f = clean();
    f.targets.bizConfig = f.targets.bizConfig.replace(
      "process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null",
      'process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "pk.committed"',
    );
    expect("19 business mapbox tripwire loses null", runGate(sync(f)).code, 1);
  }
  // 20 — the handbook stops naming a wrapper script.
  {
    const f = clean();
    f.targets.handbook = f.targets.handbook.replace(
      /app-mobile\/scripts\/ota\/publish-production-ota\.sh/g,
      "the consumer script",
    );
    expect("20 handbook drops the consumer wrapper path", runGate(sync(f)).code, 1);
  }
  // 21 — the handbook loses the unset signature a human has to recognise.
  {
    const f = clean();
    f.targets.handbook = f.targets.handbook.replace('"EXPO_PUBLIC_POSTHOG_KEY":{}', "");
    expect("21 handbook drops the unset signature", runGate(sync(f)).code, 1);
  }

  // ---- vacuity: every one exit 2, never 0 ----
  // 22 — too few files scanned.
  {
    const f = clean();
    f.scanned = f.scanned.slice(0, 100);
    expect("22 VACUITY under-scan", runGate(f).code, 2);
  }
  // 23 — no production publish shape anywhere: the extractor cannot prove itself.
  {
    const f = clean();
    f.targets.handbook = f.targets.handbook
      .split("\n")
      .filter((l) => !l.includes("--branch production"))
      .join("\n");
    expect("23 VACUITY no production shapes", runGate(sync(f)).code, 2);
  }
  // 24 — a Rule-4 target is missing.
  {
    const f = clean();
    f.targets.bizConfig = null;
    expect("24 VACUITY rule-4 target missing", runGate(sync(f)).code, 2);
  }
  // 24b — the Rule-5 target is missing.
  {
    const f = clean();
    f.targets.handbook = null;
    expect("24b VACUITY handbook missing", runGate(sync(f)).code, 2);
  }
  // 25 — a target is comment-stripped down to nothing (the #1518 shape).
  {
    const f = clean();
    f.targets.consumerConfig = "// everything real was deleted\n/* and this too */";
    expect("25 VACUITY comment-only config", runGate(sync(f)).code, 2);
  }
  // 25b — a wrapper is comment-stripped down to nothing.
  {
    const f = clean();
    f.targets.bizScript = "#!/usr/bin/env bash\n# everything real was deleted\n";
    expect("25b VACUITY comment-only wrapper", runGate(sync(f)).code, 2);
  }

  // ---- matching robustness ----
  // 26 — reformatting the wrapper must NOT disarm Rules 2/3 (dense matching).
  {
    const f = clean();
    f.targets.bizScript = f.targets.bizScript.replace(
      '  --platform "${PLATFORM}" \\',
      '  --platform\n  "${PLATFORM}" \\',
    );
    expect("26 reformatted wrapper still passes", runGate(sync(f)).code, 0);
  }
  // 27 — a violating string inside a SHELL COMMENT must not fire Rules 2/3
  //      (comments are stripped for those files) — but Rule 1 reads raw text,
  //      so the comment must not look like a production publish either.
  {
    const f = clean();
    f.targets.bizScript += "\n# we used to pass --platform all here\n";
    expect("27 forbidden needle only in a shell comment", runGate(sync(f)).code, 0);
  }
  // 28 — extra whitespace between flag and value still matches Rule 1.
  {
    const f = clean();
    f.targets.handbook += "\neas update --branch   production --platform ios\n";
    expect("28 whitespace-collapsed --branch match", runGate(sync(f)).code, 1);
  }

  if (problems.length) {
    console.error("#994 OTA-PUBLISH-GUARDRAILS self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#994 OTA-PUBLISH-GUARDRAILS self-test PASS (28/28: 1 clean; " +
      "2-6 the five fails-on-revert cases R-1..R-5 (+R-4 on both wrappers); " +
      "7-9 grandfathered shapes (line continuation, colon subcommand, prose); " +
      "10-15 wrapper integrity (combined platform, both seam defaults, rehearsal mode, " +
      "preflight_key, --json, per-platform flag); 16-18 Rule 1 evasion shapes " +
      "(--branch=, --channel, unrelated file); 19-21 tripwire + handbook rules; " +
      "22-25b vacuity (under-scan, no shapes, missing rule-4/5 target, comment-only " +
      "config and wrapper); 26-28 robustness (reformatting, comment-only needle, " +
      "collapsed whitespace)).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const { files, binaries } = walkScanSet(repoRoot);
const targets = {};
for (const [key, rel] of Object.entries(PATHS)) {
  const abs = path.join(repoRoot, rel);
  targets[key] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}
const result = runGate({ scanned: files, targets });
if (result.code === 0) {
  result.messages.forEach((m) => console.log(m));
  console.log(`  (${binaries} binary file(s) skipped.)`);
} else {
  result.messages.forEach((m) => console.error(m));
}
process.exit(result.code);
