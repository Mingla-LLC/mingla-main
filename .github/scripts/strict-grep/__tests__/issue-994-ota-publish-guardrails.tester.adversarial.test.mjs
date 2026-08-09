// Issue #994 — TESTER ADVERSARIAL against the OTA publish guardrails.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// #994 shipped three artifacts to close the env-blind-publish class:
//   · .github/scripts/strict-grep/issue-994-ota-publish-guardrails.mjs (source gate)
//   · scripts/ota/verify-published-manifest.mjs                        (post-publish check)
//   · <app>/scripts/ota/publish-production-ota.sh  x2                  (wrappers)
//
// The implementor's own numbered self checks (30/30, 25/25, 14/14) plant the
// shapes they already know about, so they can only ever confirm the imagination
// that wrote them. SPEC §8.2 therefore reserved three angles for an independent
// tester, and this suite is those three angles:
//
//   A-1  scanner evasion — can a genuinely unsafe production publish command be
//        written so the source gate does not see it?
//   A-2  the REAL served manifest — the verifier's fetch path had never executed
//        against a real u.expo.dev response when it was reported complete.
//   A-3  hostile-input drive of both wrappers — can either be made to proceed
//        past a failed step, or report success when a step failed?
//
// ===========================================================================
// TWO KINDS OF ASSERTION LIVE HERE, AND THEY ARE LABELLED
// ===========================================================================
//   PROOF        a property the code genuinely has today. Green now, and it
//                stays green forever or something regressed.
//
//   ACCEPTANCE   a property the code MUST have and does NOT. RED on the branch
//                that shipped it, by design, because the tester verdict on #994
//                is FAIL. It turns green when the defect is fixed and never
//                again. DO NOT delete, skip, or soften one of these to get a
//                green board — the code is wrong, not the test.
//
//   PIN          an evasion the gate does not catch, held visible in CI at the
//                behaviour it actually has, so the ceiling cannot be buried in
//                a report. IF A PIN STARTS FAILING, THE GATE GOT STRONGER:
//                flip the pin to the caught behaviour. NEVER weaken the gate to
//                keep a pin green.
//
// ===========================================================================
// TWO HOUSE CONSTRAINTS THIS FILE OBEYS, AND WHY
// ===========================================================================
//  1. It NEVER writes the self-check flag as a literal token. MANIFEST parity
//     P6 decides whether a file "supports" a self check with a raw
//     `src.includes(...)` over the whole file, comments included. This file is
//     registered selfTest:"none"; naming the token would make P6 believe
//     otherwise and push the row into the capable-unwired bucket, whose cap is
//     FULL at 23. Same assert-a-token-as-a-proxy class as #1553.
//
//  2. It NEVER writes an unsafe publish command as a contiguous literal. This
//     file lives under .github/scripts/strict-grep/, which the #994 gate walks,
//     and the gate self-excludes exactly ONE path — its own. A literal fixture
//     here would turn the live gate red on the real tree. Every command string
//     below is therefore assembled from fragments at runtime. (That fragility
//     is itself finding T-994-NO-TEST-EXCLUSION.)
//
// No network egress: A-2 replays a wire shape captured read-only from
// u.expo.dev, and A-3 serves it from 127.0.0.1. Nothing here publishes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  extractManifestBody,
  evaluateResponse,
  parseUpdateJson,
  EXPECTATIONS,
} from "../../../../scripts/ota/verify-published-manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const GATE_REL = ".github/scripts/strict-grep/issue-994-ota-publish-guardrails.mjs";
const GATE_ABS = path.join(repoRoot, GATE_REL);

// Fragment assembly — see house constraint 2 above.
const EAS = "eas" + " update";
const easCli = (v) => "eas-cli" + (v ? "@" + v : "") + " update";
const BRANCH_PROD = "--bran" + "ch production";
const ENV_PROD = "--environ" + "ment production";

// ===========================================================================
// A-1 — scanner evasion, driven against the REAL gate binary as a subprocess.
// ===========================================================================
// A synthetic repo tree is built once, with a VERBATIM COPY of the real gate at
// the real relative path, so the gate resolves its own repoRoot to the temp tree
// and self-excludes by path exactly as it does in production. Each case rewrites
// one runbook file and re-runs the real binary. Nothing is stubbed and the gate
// is never doctored — only its input is.

const FILLER_JS = "const filler = 1; ".repeat(30);

function buildSyntheticTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue994-a1-"));
  const mk = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };

  fs.mkdirSync(path.join(root, ".github/scripts/strict-grep"), { recursive: true });
  fs.copyFileSync(GATE_ABS, path.join(root, GATE_REL));

  const wrapper = (easBinDefault, verifyApp) =>
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `MINGLA_EAS_BIN="\${MINGLA_EAS_BIN:-${easBinDefault}}"`,
      'VERIFIER="${REPO_ROOT}/scripts/ota/verify-published-manifest.mjs"',
      "preflight_key() { echo checking; }",
      "preflight_key EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY required pk_live_",
      "if ! ${MINGLA_EAS_BIN} update \\",
      `  ${BRANCH_PROD} \\`,
      `  ${ENV_PROD} \\`,
      '  --platform "${PLATFORM}" \\',
      '  --message "${MESSAGE}" \\',
      '  --json --non-interactive >"${JSONLOG}"; then exit 1; fi',
      `node "\${VERIFIER}" --update-json "\${JSONLOG}" --app ${verifyApp} --platform "\${PLATFORM}"`,
      `echo "${FILLER_JS}"`,
    ].join("\n");

  mk("mingla-business/scripts/ota/publish-production-ota.sh", wrapper("eas", "business"));
  mk("app-mobile/scripts/ota/publish-production-ota.sh", wrapper("npx -y eas-cli@latest", "consumer"));
  mk(
    "app-mobile/app.config.ts",
    [
      "export default { extra: {",
      "  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? null,",
      "} };",
      FILLER_JS,
    ].join("\n"),
  );
  mk(
    "mingla-business/app.config.ts",
    [
      "export default { extra: {",
      "  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null,",
      "} };",
      FILLER_JS,
    ].join("\n"),
  );
  // The handbook supplies the two SAFE production shapes the gate's P-V2 floor
  // requires, so a case that finds nothing fails as vacuous rather than passing.
  mk(
    "docs/MINGLA_ENGINEERING_HANDBOOK.md",
    [
      "### 7.6 EAS OTA",
      'app-mobile/scripts/ota/publish-production-ota.sh ios "<summary>"',
      'mingla-business/scripts/ota/publish-production-ota.sh ios "<summary>"',
      `npx -y ${easCli("latest")} ${BRANCH_PROD} ${ENV_PROD} --platform ios --message "<summary>"`,
      `npx -y ${easCli("latest")} ${BRANCH_PROD} ${ENV_PROD} --platform android --message "<summary>"`,
      '"EXPO_PUBLIC_POSTHOG_KEY":{}',
      FILLER_JS,
    ].join("\n"),
  );
  for (let i = 0; i < 520; i += 1) mk(`src/filler/f${i}.ts`, "export const x = 1;\n");
  return root;
}

const A1_ROOT = buildSyntheticTree();
process.on("exit", () => {
  try {
    fs.rmSync(A1_ROOT, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Plant `text` as a tracked runbook and run the REAL gate. Returns its exit code. */
function gateExitFor(text) {
  fs.writeFileSync(path.join(A1_ROOT, "docs/OTA_RUNBOOK.md"), text + "\n");
  const r = spawnSync(process.execPath, [path.join(A1_ROOT, GATE_REL)], {
    encoding: "utf8",
    cwd: A1_ROOT,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("A-1 PROOF — the synthetic harness is not vacuous: a clean tree passes and the control violation fails", () => {
  const clean = gateExitFor("Nothing to see here.");
  assert.equal(clean.code, 0, `clean synthetic tree must pass; got:\n${clean.out}`);
  const control = gateExitFor(`${EAS} ${BRANCH_PROD} --platform ios --message "x"`);
  assert.equal(control.code, 1, `the plain unsafe command must be caught; got:\n${control.out}`);
  assert.match(control.out, /PRODUCTION PUBLISH command carries no/);
});

test("A-1 PROOF — the shapes the gate genuinely catches", () => {
  const caught = [
    ["equals form", `${EAS} --bran` + `ch=production --platform ios`],
    ["channel instead of branch", `${EAS} --chan` + `nel production --platform ios`],
    ["channel equals form", `${EAS} --chan` + `nel=production --platform ios`],
    ["pinned CLI version", `npx ${easCli("19.1.0")} ${BRANCH_PROD} --platform ios`],
    ["pnpm dlx", `pnpm dlx ${easCli("")} ${BRANCH_PROD} --platform ios`],
    ["bare eas-cli", `${easCli("")} ${BRANCH_PROD} --platform ios`],
    ["env-var prefix", `EAS_NO_VCS=1 ${EAS} ${BRANCH_PROD} --platform ios`],
    ["node_modules/.bin path", `./node_modules/.bin/${EAS} ${BRANCH_PROD} --platform ios`],
    ["collapsed whitespace", `${EAS} --bran` + `ch    production   --platform ios`],
    //   is a non-breaking space: JS \s matches it, so collapse() normalises it.
    ["non-breaking space", `${EAS} --bran` + `ch production --platform ios`],
    ["flag through $FLAGS indirection", `FLAGS="${ENV_PROD}"\n${EAS} ${BRANCH_PROD} --platform ios $FLAGS`],
    ["en-dash mangling of the env flag", `${EAS} ${BRANCH_PROD} ––environment production --platform ios`],
    ["hidden inside an HTML comment", `<!-- ${EAS} ${BRANCH_PROD} --platform ios -->`],
    ["command split by a real line break", `${EAS} ${BRANCH_PROD} --platform ios\n${ENV_PROD}`],
  ];
  for (const [label, text] of caught) {
    const r = gateExitFor(text);
    assert.equal(r.code, 1, `A-1 "${label}" must be caught (exit 1), got ${r.code}:\n${r.out}`);
  }
});

test("A-1 PROOF — the shapes the gate correctly ALLOWS (no false positives)", () => {
  const allowed = [
    ["colon subcommand: rollback", `${EAS}:roll-back-to-embedded ${BRANCH_PROD} --platform ios`],
    ["colon subcommand: list", `${EAS}:list --bran` + `ch production --json`],
    ["colon subcommand: republish", `${EAS}:republish ${BRANCH_PROD} --group g`],
    ["prose warning", `Never run a bare \`${EAS}\` by hand.`],
    [
      "line-continued safe invocation",
      `${EAS} \\\n  ${BRANCH_PROD} \\\n  ${ENV_PROD} \\\n  --platform ios --json`,
    ],
    ["equals form on both flags", `${EAS} --bran` + `ch=production --environ` + `ment=production --platform ios`],
    ["non-production branch", `${EAS} --bran` + `ch staging --platform ios`],
  ];
  for (const [label, text] of allowed) {
    const r = gateExitFor(text);
    assert.equal(r.code, 0, `A-1 "${label}" must be allowed (exit 0), got ${r.code}:\n${r.out}`);
  }
});

test("A-1 PROOF — the ten evasions of T-994-RULE1-EVASION, now CLOSED (was a PIN)", () => {
  // FLIPPED FROM PIN TO PROOF at the #994 REWORK, under the rule this file
  // states above: "IF A PIN STARTS FAILING, THE GATE GOT STRONGER: flip the pin
  // to the caught behaviour." All ten started failing because the gate was
  // rebuilt to tokenise the command instead of substring-matching it, to end a
  // command at an unquoted separator, to require the continuation backslash to
  // be the final character of the line, to follow shell-function aliases, and
  // to treat `--auto` and an indirect branch value as production shapes.
  //
  // Not one case string below was changed — only the expected exit code, from
  // 0 (evaded) to 1 (caught). Each entry is still a command a human could paste
  // into a terminal that WOULD publish a production OTA with the environment
  // unresolved; the gate now refuses every one of them.
  const evading = [
    // The value is quoted, so the literal `--branch production` substring never
    // appears and the command is not classified as a production publish at all.
    // This is the highest-realism gap: quoting a flag value is idiomatic shell.
    ["quoted branch value (double)", `${EAS} --bran` + `ch "production" --platform ios --message "x"`],
    ["quoted branch value (single)", `${EAS} --bran` + `ch 'production' --platform ios --message "x"`],
    ["quoted equals form", `${EAS} --bran` + `ch="production" --platform ios --message "x"`],
    ["branch value via a shell variable", `BRANCH=production\n${EAS} --bran` + `ch "$BRANCH" --platform ios`],
    // The command text runs to end-of-logical-line, so a later *sibling* command
    // on the same line donates its flag to the earlier unsafe one.
    [
      "two commands on one line, only the second safe",
      `${EAS} ${BRANCH_PROD} --platform ios --message "x" && ${EAS} ${BRANCH_PROD} ${ENV_PROD} --platform android`,
    ],
    // The flag appears only inside the human-readable message.
    [
      "flag mentioned inside --message",
      `${EAS} ${BRANCH_PROD} --platform ios --message "remember ${ENV_PROD}"`,
    ],
    // A backslash followed by whitespace is NOT a shell line continuation: bash
    // runs line one alone, env-blind. The gate joins the lines anyway and passes.
    // The gate is more permissive than the shell it is policing.
    ["trailing whitespace after the continuation backslash", `${EAS} ${BRANCH_PROD} --platform ios \\ \n  ${ENV_PROD}`],
    ["wrapped in a shell function", `publish() { ${EAS} "$@"; }\npublish ${BRANCH_PROD} --platform ios`],
    // --auto takes the branch from the current git branch, so a production
    // publish can carry no --branch flag at all.
    ["--auto on a production git branch", `git checkout production && ${EAS} --auto --platform ios`],
    ["en-dash mangling of --branch", `${EAS} ––branch production --platform ios`],
  ];
  for (const [label, text] of evading) {
    const r = gateExitFor(text);
    assert.equal(
      r.code,
      1,
      `"${label}" is a runnable env-blind production publish and the gate returned ${r.code}. ` +
        `This evasion was closed at the #994 REWORK and must stay closed.\n${r.out}`,
    );
  }
});

test("A-1 PROOF — the file classes of T-994-SCAN-SET-GAP are now walked (was a PIN)", () => {
  // FLIPPED FROM PIN TO PROOF at the #994 REWORK. SCAN_EXTS was widened and an
  // extensionless-basename allowlist added, so a runbook carrying the unsafe
  // command in any of these classes is now opened and caught rather than
  // skipped in silence. The file list is unchanged; only the expectation moved
  // from 0 (invisible) to 1 (caught).
  const unscanned = ["Makefile", "runbook.mdx", "publish.py", "deploy.toml", "index.html", "notes.rst", "publish.mts"];
  const unsafe = `${EAS} ${BRANCH_PROD} --platform ios --message "x"`;
  for (const name of unscanned) {
    fs.writeFileSync(path.join(A1_ROOT, name), unsafe + "\n");
  }
  const r = gateExitFor("Nothing to see here.");
  for (const name of unscanned) fs.rmSync(path.join(A1_ROOT, name));
  assert.equal(
    r.code,
    1,
    `the walker must open ${unscanned.join(", ")} — the 2026-08-06 landmine was a document, ` +
      `and these are exactly where the next runbook goes.\n${r.out}`,
  );
});

// ===========================================================================
// A-2 — the REAL served manifest.
// ===========================================================================
// The wire shape below was captured READ-ONLY on 2026-08-09 from six genuine
// production permalinks (no publish, no write):
//   consumer ios     019fe873-bf46-721f-9765-58683f10c6bf  (rt 1.1.3, #1719)
//   consumer android 019fdd87-afc9-7238-bdaf-a516dc7f1975  (rt 1.1.2, #1699)
//   consumer ios     019fd7e3-bcdb-7c96-91e9-e538331ca1e1  (rt 1.1.2, 08-06 republish)
//   consumer android 019fd7e4-7afd-7036-a1c6-9c29f214227d  (rt 1.1.2, 08-06 republish)
//   business ios     019fd32a-5778-7bfc-976f-33b51b4bafd8  (rt 1.1.2, #1616)
//   business android 019fd32b-05e5-7342-94d8-cb3ece1dc85b  (rt 1.1.2, #1616)
//
// All six answered HTTP 200 with `multipart/mixed`, and in ALL six the app
// config's `extra` is nested at `manifest.extra.expoClient.extra`. The manifest's
// OWN top-level `extra` holds exactly three keys — expoClient, eas, scopeKey —
// and never holds an EXPO_PUBLIC_* value. Values below are fakes; only the
// STRUCTURE is real.

const REAL_APP_EXTRA = (posthog) => ({
  ANDROID_CLIENT_ID: "1691-android.apps.googleusercontent.com",
  EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.example.app",
  EXPO_PUBLIC_APPSFLYER_DEV_KEY: "FAKEDEVKEYFAKEDEVKEY00",
  EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "6760000000",
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "1691-web.apps.googleusercontent.com",
  EXPO_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
  EXPO_PUBLIC_POSTHOG_KEY: posthog,
  GOOGLE_ANDROID_CLIENT_ID: "1691-a.apps.googleusercontent.com",
  GOOGLE_IOS_CLIENT_SECRET: "",
  GOOGLE_PROJECT_ID: "example-project",
  GOOGLE_WEB_CLIENT_SECRET: "",
  IOS_CLIENT_ID: "1691-i.apps.googleusercontent.com",
  eas: { build: {}, projectId: "00000000-0000-0000-0000-000000000000" },
  googleWebClientId: "1691-web.apps.googleusercontent.com",
  router: {},
});

/** The real u.expo.dev manifest object: app config extra nested under expoClient. */
const realManifest = (posthog) => ({
  id: "019fe873-0000-0000-0000-000000000000",
  createdAt: "2026-08-09T21:35:27.558Z",
  runtimeVersion: "1.1.3",
  launchAsset: { hash: "h", key: "k", contentType: "application/javascript", url: "https://assets.example/x" },
  assets: [],
  metadata: {},
  extra: {
    expoClient: { name: "Mingla", slug: "mingla", extra: REAL_APP_EXTRA(posthog) },
    eas: {},
    scopeKey: "@example/mingla",
  },
});

/** The real multipart framing: `--` + boundary, CRLF headers, `name="manifest"`. */
const REAL_BOUNDARY = "-----ExpoManifestBoundary-AZ_oc79Gch-XZVhoPxDGvw";
const REAL_CONTENT_TYPE = `multipart/mixed; boundary=${REAL_BOUNDARY}`;
const realBody = (manifest) =>
  `--${REAL_BOUNDARY}\r\n` +
  `Content-Disposition: form-data; name="manifest"\r\n` +
  `Content-Type: application/json\r\n\r\n` +
  `${JSON.stringify(manifest)}\r\n` +
  `--${REAL_BOUNDARY}--\r\n`;

test("A-2 PROOF — the multipart extractor handles the real u.expo.dev framing", () => {
  const text = extractManifestBody(REAL_CONTENT_TYPE, realBody(realManifest("phc_fake")));
  const parsed = JSON.parse(text);
  assert.equal(parsed.id, "019fe873-0000-0000-0000-000000000000");
  assert.deepEqual(Object.keys(parsed.extra), ["expoClient", "eas", "scopeKey"]);
});

test("A-2 PROOF — a served manifest that is not a manifest, and an unusable update json, are vacuities", () => {
  assert.equal(
    evaluateResponse({
      status: 500,
      contentType: "text/plain",
      rawBody: "upstream boom",
      expectations: EXPECTATIONS.consumer,
    }).code,
    2,
  );
  assert.throws(() => parseUpdateJson("[]", "ios"), (e) => e.exitCode === 2);
  assert.throws(
    () => parseUpdateJson(JSON.stringify([{ platform: "android", manifestPermalink: "https://x" }]), "ios"),
    (e) => e.exitCode === 2,
  );
});

test("A-2 ACCEPTANCE — a CORRECT production manifest in the real wire shape must VERIFY (P0-994-1)", () => {
  // Captured reality: every genuine permalink nests the app config extra at
  // extra.expoClient.extra. The verifier reads manifest.extra, which holds three
  // keys, so V-3 fires and the check exits 2 on every correct publish — the
  // canonical publish path can never succeed. Red until the verifier reads the
  // real path. DO NOT satisfy this by lowering MIN_EXTRA_KEYS: that would make
  // the check report "EXPO_PUBLIC_POSTHOG_KEY is absent" on a healthy publish.
  for (const app of ["consumer", "business"]) {
    const extra = REAL_APP_EXTRA("phc_fakebutwellformedvalue0000000000000000");
    if (app === "business") {
      extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_fakebutwellformed";
      extra.EXPO_PUBLIC_GIPHY_API_KEY = "fakegiphykeyfakegiphykey";
    }
    const manifest = realManifest("phc_fakebutwellformedvalue0000000000000000");
    manifest.extra.expoClient.extra = extra;
    const r = evaluateResponse({
      status: 200,
      contentType: REAL_CONTENT_TYPE,
      rawBody: realBody(manifest),
      expectations: EXPECTATIONS[app],
    });
    assert.equal(
      r.code,
      0,
      `${app}: a correct production manifest in the REAL wire shape must verify (exit 0), got ` +
        `${r.code}: ${r.messages.join(" | ")}`,
    );
  }
});

test("A-2 ACCEPTANCE — the UNSET SIGNATURE in the real wire shape must be CAUGHT (P0-994-1)", () => {
  // This is the exact 2026-08-06 incident body: a real manifest whose tripwire
  // serialised to {}. As shipped, the verifier produces byte-identical output
  // for this and for the healthy manifest above (both exit 2, V-3), so it cannot
  // tell a correct publish from the incident it was built to detect.
  const r = evaluateResponse({
    status: 200,
    contentType: REAL_CONTENT_TYPE,
    rawBody: realBody(realManifest({})),
    expectations: EXPECTATIONS.consumer,
  });
  assert.equal(r.code, 1, `the unset signature must fail with exit 1, got ${r.code}: ${r.messages.join(" | ")}`);
  assert.ok(
    r.messages.some((m) => m.includes("UNSET SIGNATURE")),
    `the failure must be named UNSET SIGNATURE; got: ${r.messages.join(" | ")}`,
  );
});

test("A-2 ACCEPTANCE — a healthy and an incident manifest must not produce the same verdict (P0-994-1)", () => {
  // The falsifiability check. Independent of which path is read, these two
  // bodies MUST diverge, or the check is decoration.
  const healthy = evaluateResponse({
    status: 200,
    contentType: REAL_CONTENT_TYPE,
    rawBody: realBody(realManifest("phc_fakebutwellformedvalue0000000000000000")),
    expectations: EXPECTATIONS.consumer,
  });
  const incident = evaluateResponse({
    status: 200,
    contentType: REAL_CONTENT_TYPE,
    rawBody: realBody(realManifest({})),
    expectations: EXPECTATIONS.consumer,
  });
  assert.notDeepEqual(
    { code: healthy.code, messages: healthy.messages },
    { code: incident.code, messages: incident.messages },
    "a healthy manifest and the 2026-08-06 incident manifest produced IDENTICAL verdicts — " +
      "the post-publish check cannot distinguish them and is unfalsifiable",
  );
});

// ===========================================================================
// A-3 — hostile-input drive of both wrappers.
// ===========================================================================
// Driven under bash with `set -euo pipefail`, through the MINGLA_EAS_BIN seam
// pointed at a stub that talks to nothing and refuses to publish. The question
// that matters is not whether the messages are pretty; it is whether either
// wrapper can be made to PROCEED past a failed step, or to report success when
// a step failed. Every case below asserts a NON-ZERO exit.

const BASH = fs.existsSync("/bin/bash") ? "/bin/bash" : "bash";
const WRAPPERS = {
  consumer: "app-mobile/scripts/ota/publish-production-ota.sh",
  business: "mingla-business/scripts/ota/publish-production-ota.sh",
};

const STUB_SRC = `#!/usr/bin/env bash
SUB="$1"; shift || true
case "$SUB" in
  env:list)
    if [ "\${STUB_ENVLIST_EXIT:-0}" != "0" ]; then echo "stub: env:list failed" >&2; exit "\${STUB_ENVLIST_EXIT}"; fi
    printf '%s' "\${STUB_ENVLIST:-}" ;;
  env:get)
    NAME=""
    while [ $# -gt 0 ]; do case "$1" in --variable-name) NAME="$2"; shift 2 ;; *) shift ;; esac; done
    if [ "\${STUB_ENVGET_EXIT:-0}" != "0" ]; then echo "stub: secret" >&2; exit "\${STUB_ENVGET_EXIT}"; fi
    printf '%s\\n' "\${STUB_VALUES:-}" | grep "^\${NAME}=" || true ;;
  update)
    echo "stub: NEVER PUBLISHES. args: $*" >&2
    if [ "\${STUB_UPDATE_EXIT:-0}" != "0" ]; then exit "\${STUB_UPDATE_EXIT}"; fi
    printf '%s' "\${STUB_UPDATE_JSON:-[]}" ;;
  *) echo "stub: unknown $SUB" >&2; exit 127 ;;
esac
`;

const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "issue994-a3-"));
const STUB = path.join(STUB_DIR, "stub-eas.sh");
fs.writeFileSync(STUB, STUB_SRC, { mode: 0o755 });
process.on("exit", () => {
  try {
    fs.rmSync(STUB_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const HEALTHY_ENV = {
  consumer: [
    "Environment: production",
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stub",
    "EXPO_PUBLIC_POSTHOG_KEY=phc_stub",
    "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stub",
    "",
  ].join("\n"),
  business: [
    "Environment: production",
    "EXPO_PUBLIC_SENTRY_DSN=https://k@o1.ingest.us.sentry.io/2",
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stub",
    "EXPO_PUBLIC_GIPHY_API_KEY=g_stub",
    "EXPO_PUBLIC_POSTHOG_KEY=phc_stub",
    "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stub",
    "",
  ].join("\n"),
};
const HEALTHY_VALUES = {
  consumer: [
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stubvalue123",
    "EXPO_PUBLIC_POSTHOG_KEY=phc_stubvalue123",
    "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stubvalue123",
  ].join("\n"),
  business: [
    "EXPO_PUBLIC_SENTRY_DSN=https://key@o4511136062701568.ingest.us.sentry.io/4511",
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_stubvalue123",
    "EXPO_PUBLIC_GIPHY_API_KEY=g_stubvalue1234567890",
    "EXPO_PUBLIC_POSTHOG_KEY=phc_stubvalue123",
    "EXPO_PUBLIC_MIXPANEL_TOKEN=mx_stubvalue123",
  ].join("\n"),
};

function drive(app, args, env = {}, opts = {}) {
  const r = spawnSync(BASH, [path.join(repoRoot, WRAPPERS[app]), ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? repoRoot,
    env: {
      ...process.env,
      MINGLA_EAS_BIN: STUB,
      STUB_ENVLIST: HEALTHY_ENV[app],
      STUB_VALUES: HEALTHY_VALUES[app],
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Same as drive(), but non-blocking, for cases whose server lives in-process. */
function driveAsync(app, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [path.join(repoRoot, WRAPPERS[app]), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MINGLA_EAS_BIN: STUB,
        STUB_ENVLIST: HEALTHY_ENV[app],
        STUB_VALUES: HEALTHY_VALUES[app],
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("A-3 PROOF — argument validation rejects every malformed invocation, both wrappers", () => {
  for (const app of ["consumer", "business"]) {
    const cases = [
      ["no arguments", []],
      ["empty message", ["ios", ""]],
      ["uppercase platform", ["IOS", "msg"]],
      ["web platform", ["web", "msg"]],
      ["combined platform", ["ios android", "msg"]],
      ["platform carrying a shell metacharacter", ["ios;id", "msg"]],
      ["platform carrying a command substitution", ["$(id)", "msg"]],
      ["platform carrying a backtick", ["`id`", "msg"]],
    ];
    for (const [label, args] of cases) {
      const r = drive(app, args);
      assert.notEqual(r.code, 0, `${app} "${label}" must exit non-zero, got 0:\n${r.out}`);
      assert.doesNotMatch(r.out, /uid=\d+/, `${app} "${label}" EXECUTED the injected argument:\n${r.out}`);
      assert.doesNotMatch(r.out, /NEVER PUBLISHES/, `${app} "${label}" reached the publish step:\n${r.out}`);
    }
  }
});

test("A-3 PROOF — a failed pre-flight step never reaches the publish step, both wrappers", () => {
  for (const app of ["consumer", "business"]) {
    const cases = [
      ["environment listing errors", { STUB_ENVLIST_EXIT: "1" }],
      ["environment listing is empty", { STUB_ENVLIST: "" }],
      ["a required key is absent", { STUB_ENVLIST: "Environment: production\nEXPO_PUBLIC_POSTHOG_KEY=phc_x\n" }],
      [
        "a required key is present but empty",
        { STUB_VALUES: HEALTHY_VALUES[app].replace(/pk_live_stubvalue123/, "") },
      ],
      [
        "a required key has the wrong prefix",
        { STUB_VALUES: HEALTHY_VALUES[app].replace(/pk_live_stubvalue123/, "pk_test_wrongmode123") },
      ],
    ];
    for (const [label, env] of cases) {
      const r = drive(app, ["ios", "tester probe"], env);
      assert.notEqual(r.code, 0, `${app} "${label}" must exit non-zero, got 0:\n${r.out}`);
      assert.doesNotMatch(
        r.out,
        /NEVER PUBLISHES/,
        `${app} "${label}" PROCEEDED PAST a failed pre-flight and reached the publish step:\n${r.out}`,
      );
    }
  }
});

test("A-3 PROOF — a failed publish or an unusable publish result never reports success, both wrappers", () => {
  for (const app of ["consumer", "business"]) {
    const cases = [
      ["publish exits non-zero", { STUB_UPDATE_EXIT: "17" }],
      ["publish emits nothing", { STUB_UPDATE_JSON: "" }],
      ["publish emits non-JSON", { STUB_UPDATE_JSON: "Update published!" }],
      ["publish emits an empty array", { STUB_UPDATE_JSON: "[]" }],
      ["publish emits an object, not an array", { STUB_UPDATE_JSON: '{"id":"u1"}' }],
      [
        "publish emits the wrong platform",
        {
          STUB_UPDATE_JSON:
            '[{"id":"u1","group":"g1","runtimeVersion":"1.1.3","platform":"android","manifestPermalink":"https://u.expo.dev/update/u1"}]',
        },
      ],
      [
        "publish emits an empty permalink",
        {
          STUB_UPDATE_JSON:
            '[{"id":"u1","group":"g1","runtimeVersion":"1.1.3","platform":"ios","manifestPermalink":""}]',
        },
      ],
      [
        "the permalink host is unroutable",
        {
          STUB_UPDATE_JSON:
            '[{"id":"u1","group":"g1","runtimeVersion":"1.1.3","platform":"ios","manifestPermalink":"http://127.0.0.1:1/update/u1"}]',
        },
      ],
    ];
    for (const [label, env] of cases) {
      const r = drive(app, ["ios", "tester probe"], env);
      assert.notEqual(r.code, 0, `${app} "${label}" must exit non-zero, got 0:\n${r.out}`);
      assert.doesNotMatch(
        r.out,
        /\[done\] update group/,
        `${app} "${label}" printed the SUCCESS line after a failed step:\n${r.out}`,
      );
    }
  }
});

test("A-3 PROOF — a hostile update message is never executed and never truncates the run", () => {
  const nasty = 'he said "go" `id` $(id) & ; | \\ \n second line émoji';
  for (const app of ["consumer", "business"]) {
    const r = drive(app, ["ios", nasty], {
      STUB_UPDATE_JSON:
        '[{"id":"u1","group":"g1","runtimeVersion":"1.1.3","platform":"ios","manifestPermalink":"http://127.0.0.1:1/update/u1"}]',
    });
    assert.doesNotMatch(r.out, /uid=\d+/, `${app}: the message was EXECUTED:\n${r.out}`);
    assert.match(r.out, /NEVER PUBLISHES/, `${app}: the run did not reach the publish step:\n${r.out}`);
    assert.notEqual(r.code, 0, `${app}: an unverifiable publish must not report success:\n${r.out}`);
  }
});

test("A-3 PROOF — a hostile ambient environment cannot make either wrapper report success", () => {
  const unverifiable = {
    STUB_UPDATE_JSON:
      '[{"id":"u1","group":"g1","runtimeVersion":"1.1.3","platform":"ios","manifestPermalink":"http://127.0.0.1:1/update/u1"}]',
  };
  for (const app of ["consumer", "business"]) {
    const fromRoot = drive(app, ["ios", "tester probe"], unverifiable, { cwd: path.parse(repoRoot).root });
    assert.notEqual(fromRoot.code, 0, `${app}: invoked from the filesystem root:\n${fromRoot.out}`);

    const hostileIfs = drive(app, ["ios", "tester probe"], { ...unverifiable, IFS: ":" });
    assert.notEqual(hostileIfs.code, 0, `${app}: hostile IFS:\n${hostileIfs.out}`);

    const noHome = { ...process.env };
    delete noHome.HOME;
    const r = spawnSync(BASH, [path.join(repoRoot, WRAPPERS[app]), "ios", "tester probe"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: {
        ...noHome,
        MINGLA_EAS_BIN: STUB,
        STUB_ENVLIST: HEALTHY_ENV[app],
        STUB_VALUES: HEALTHY_VALUES[app],
        ...unverifiable,
      },
    });
    assert.notEqual(r.status, 0, `${app}: HOME unset:\n${r.stdout}${r.stderr}`);
  }
});

test("A-3 PROOF — a symlinked invocation fails closed rather than publishing unverified", () => {
  const link = path.join(STUB_DIR, "linked-publish.sh");
  for (const app of ["consumer", "business"]) {
    try {
      fs.rmSync(link, { force: true });
    } catch {
      /* ignore */
    }
    fs.symlinkSync(path.join(repoRoot, WRAPPERS[app]), link);
    const r = spawnSync(BASH, [link, "ios", "tester probe"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: { ...process.env, MINGLA_EAS_BIN: STUB, STUB_ENVLIST: HEALTHY_ENV[app], STUB_VALUES: HEALTHY_VALUES[app] },
    });
    assert.notEqual(r.status, 0, `${app}: a symlinked invocation must not publish:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /NEVER PUBLISHES/, `${app}: reached publish via a symlink`);
  }
});

test("A-3 PROOF — a whitespace-only update message is rejected, T-994-BLANK-MESSAGE closed (was a PIN)", () => {
  // FLIPPED FROM PIN TO PROOF at the #994 REWORK. SC-1 says the wrapper rejects
  // an empty message; `-z` is satisfied by a single space, so a run labelled
  // "   " used to reach pre-flight and would have published with a blank
  // message, costing the update list its audit trail. Both wrappers now strip
  // whitespace before the emptiness test, so the run is rejected up front and
  // never reaches pre-flight at all.
  const r = drive("consumer", ["ios", "   "], { STUB_ENVLIST_EXIT: "1" });
  assert.notEqual(r.code, 0, `a whitespace-only message must be rejected:\n${r.out}`);
  assert.match(
    r.out,
    /non-empty update message is required/,
    `the whitespace-only message must be rejected as a bad argument:\n${r.out}`,
  );
  assert.doesNotMatch(
    r.out,
    /could not list the EAS 'production' environment/,
    `rejection must happen BEFORE pre-flight, not as a side effect of it:\n${r.out}`,
  );
});

test("A-3 ACCEPTANCE — an end-to-end run against a REAL-SHAPE served manifest must succeed (P0-994-1)", async () => {
  // The whole point, driven end to end: stub CLI reports a successful publish,
  // a local server answers the permalink with the exact wire shape u.expo.dev
  // returns, every expected key carries a real value. The wrapper must exit 0.
  // As shipped it exits 2 and prints "Treat this OTA as broken", so no correct
  // publish can ever complete through the canonical path.
  const manifest = realManifest("phc_fakebutwellformedvalue0000000000000000");
  const body = realBody(manifest);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": REAL_CONTENT_TYPE });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    // Driven ASYNCHRONOUSLY on purpose: the manifest server lives in this
    // process, so a synchronous spawn would block the event loop and the fetch
    // would time out against a server that never got to answer — a false red.
    const r = await driveAsync("consumer", ["ios", "tester end-to-end"], {
      STUB_UPDATE_JSON: JSON.stringify([
        {
          id: "u-tester",
          group: "g-tester",
          runtimeVersion: "1.1.3",
          platform: "ios",
          manifestPermalink: `http://127.0.0.1:${port}/update/u-tester`,
          gitCommitHash: "deadbeef",
        },
      ]),
    });
    assert.equal(
      r.code,
      0,
      "a correct publish whose served manifest carries every expected key must exit 0; " +
        `the canonical publish path currently cannot succeed:\n${r.out}`,
    );
  } finally {
    server.close();
  }
});
