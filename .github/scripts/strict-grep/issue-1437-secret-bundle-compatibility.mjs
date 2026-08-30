#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const paths = {
  bundle: "supabase/functions/_shared/secretBundle.ts",
  hmac: "supabase/functions/_shared/notificationRecipientHmac.ts",
  notify: "supabase/functions/notify-dispatch/index.ts",
  onboard: "supabase/functions/brand-stripe-onboard/index.ts",
  paystackOnboard: "supabase/functions/brand-paystack-onboard/index.ts",
  payout: "supabase/functions/payout-release-sweep/index.ts",
  refunds: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  test:
    "supabase/functions/_shared/issue_1437_secret_bundle_compatibility.test.ts",
  issue1903BundleTest:
    "supabase/functions/_shared/issue_1903_delivery_bundle_v3.test.ts",
  issue1903OnboardTest:
    "supabase/functions/brand-paystack-onboard/issue_1903_paystack_auto_stamp.test.ts",
  manifest: "supabase/secrets.manifest.json",
  runbook: "docs/runbooks/SUPABASE_SECRET_CAPACITY.md",
  config: "supabase/config.toml",
  // [#2439 SC-15 item 2] Was
  // ".github/workflows/issue-1437-secret-bundle-compatibility-tests.yml". This
  // file calls readFiles() at MODULE LOAD, so once Phase 3C deletes that wrapper
  // the read throws ENOENT before a single assertion runs — a crash, not a
  // verdict. It now reads the CI registry, where #1437's triggers, its exact
  // eleven-target Deno command and its four strict-grep leaves actually live,
  // and asserts the SAME sixteen protections against it.
  registry: ".github/ci-batch/MANIFEST.json",
};

const EXPECTED_DELIVERY_RUNTIME_CLOSURE = [
  ["brand-paystack-onboard", true],
  ["brand-stripe-onboard", true],
  ["event-cancel-refund-fanout", false],
  ["guest-roster-actions", true],
  ["marketing-send", true],
  ["notify-dispatch", true],
  ["offering-invite-dispatch", true],
  ["payout-release-sweep", false],
  ["rsvp-contribution-refund", true],
  ["rsvp-notify", true],
  ["send-pair-request", true],
  ["send-phone-invite", true],
  ["send-venue-sms", true],
  ["source-refund-sweep", false],
  ["support-brand-person-erasure", true],
  ["ticket-confirmation-dispatch", true],
  ["venue-reservation-cancel", false],
];

function productionModule(relativePath) {
  return !relativePath.includes("/__tests__/") &&
    !relativePath.includes("/fixtures/") &&
    !relativePath.includes(".test.") &&
    !relativePath.endsWith(".d.ts");
}

function runtimeRelativeImports(source) {
  const imports = [];
  const staticImport = /^\s*import\s+(?!type\b)([^;]*?)(?:\s+from\s+)?["'](\.{1,2}\/[^"']+)["'][^;]*;/gm;
  for (const match of source.matchAll(staticImport)) {
    const clause = (match[1] ?? "").trim();
    if (/^\{\s*type\s+[A-Za-z_$][\w$]*(?:\s*,\s*type\s+[A-Za-z_$][\w$]*)*\s*\}$/.test(clause)) {
      continue;
    }
    imports.push(match[2]);
  }
  const reExport = /^\s*export\s+(?!type\b)[^;]*?\sfrom\s+["'](\.{1,2}\/[^"']+)["'][^;]*;/gm;
  for (const match of source.matchAll(reExport)) imports.push(match[1]);
  const dynamicImport = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicImport)) imports.push(match[1]);
  return imports;
}

function containsBundleResolutionCall(relativePath, source) {
  if (relativePath === "supabase/functions/_shared/secretBundle.ts") return false;
  const withoutImports = source
    .replace(/^\s*import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^\s*export\s+[^;]*?\sfrom\s+[^;]*;\s*$/gm, "");
  return /\b(?:resolveDeliveryFlagValue|resolvePaymentOperationFlagValue)\s*\(|\bresolvePaystackPayoutHoldOnboardFlip\b/.test(
    withoutImports,
  );
}

function resolveRuntimeImport(from, specifier, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const candidates = path.posix.extname(base)
    ? [base]
    : [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
    ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/**
 * Edge deployments bundle shared code at deployment time. Every executable
 * direct or transitive consumer must therefore be redeployed before a strict
 * new delivery-bundle schema is installed.
 */
export function deriveDeliveryRuntimeClosure(inputFiles) {
  const files = new Map(
    [...inputFiles.entries()].filter(([relativePath]) => productionModule(relativePath)),
  );
  const adjacency = new Map();
  const unresolved = new Map();
  for (const [relativePath, source] of files) {
    const edges = [];
    const missing = [];
    for (const specifier of runtimeRelativeImports(source)) {
      const resolved = resolveRuntimeImport(relativePath, specifier, files);
      if (resolved) edges.push(resolved);
      else missing.push(specifier);
    }
    adjacency.set(relativePath, [...new Set(edges)]);
    if (missing.length > 0) unresolved.set(relativePath, [...new Set(missing)]);
  }

  const reverse = new Map();
  for (const relativePath of files.keys()) reverse.set(relativePath, []);
  for (const [from, edges] of adjacency) {
    for (const to of edges) reverse.get(to)?.push(from);
  }
  const reachesSink = new Set(
    [...files].filter(([relativePath, source]) =>
      containsBundleResolutionCall(relativePath, source)
    ).map(([relativePath]) => relativePath),
  );
  const queue = [...reachesSink];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const parent of reverse.get(current) ?? []) {
      if (!reachesSink.has(parent)) {
        reachesSink.add(parent);
        queue.push(parent);
      }
    }
  }

  const entrypoints = [...files.keys()].filter((relativePath) =>
    /^supabase\/functions\/[^/]+\/index\.(?:ts|tsx|js)$/.test(relativePath)
  );
  const derived = entrypoints.filter((entry) => reachesSink.has(entry)).map((entry) =>
    entry.split("/")[2]
  ).sort();
  const relevantUnresolved = [];
  for (const entry of entrypoints.filter((candidate) => reachesSink.has(candidate))) {
    const seen = new Set();
    const visit = [entry];
    while (visit.length > 0) {
      const current = visit.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      if (reachesSink.has(current) && unresolved.has(current)) {
        for (const specifier of unresolved.get(current)) {
          relevantUnresolved.push(`${current}:${specifier}`);
        }
      }
      for (const child of adjacency.get(current) ?? []) visit.push(child);
    }
  }
  return {
    derived,
    relevantUnresolved: [...new Set(relevantUnresolved)].sort(),
  };
}

function trackedProductionFunctionFiles(repoRoot) {
  const functionsRoot = path.join(repoRoot, "supabase/functions");
  const files = new Map();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        const relative = path.relative(repoRoot, absolute).split(path.sep).join("/");
        if (productionModule(relative)) files.set(relative, fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(functionsRoot);
  return files;
}

function compareClosure(result, expectedInput) {
  const expectedNames = [...expectedInput].sort();
  const duplicateCount = expectedNames.length - new Set(expectedNames).size;
  const failures = [];
  if (duplicateCount > 0) failures.push("runtime_closure:duplicate_inventory");
  for (const unresolved of result.relevantUnresolved) {
    failures.push(`runtime_closure:unresolved_runtime_import:${unresolved}`);
  }
  if (
    result.derived.length !== expectedNames.length ||
    result.derived.length !== new Set(result.derived).size
  ) {
    failures.push(
      `runtime_closure:exact_count_mismatch:derived_${result.derived.length}:expected_${expectedNames.length}`,
    );
  }
  for (const name of result.derived.filter((name) => !expectedNames.includes(name))) {
    failures.push(`runtime_closure:unlisted_runtime_consumer:${name}`);
  }
  for (const name of expectedNames.filter((name) => !result.derived.includes(name))) {
    failures.push(`runtime_closure:stale_listed_consumer:${name}`);
  }
  return failures;
}

function closureViolations(repoRoot) {
  const expectedNames = EXPECTED_DELIVERY_RUNTIME_CLOSURE.map(([name]) => name);
  const result = deriveDeliveryRuntimeClosure(trackedProductionFunctionFiles(repoRoot));
  const failures = compareClosure(result, expectedNames);
  if (result.derived.length !== 17 || expectedNames.length !== 17) {
    failures.push(
      `runtime_closure:locked_count_mismatch:derived_${result.derived.length}:expected_${expectedNames.length}`,
    );
  }
  return { failures: [...new Set(failures)], result, expectedNames };
}

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbidToken(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

export function violations(files) {
  const failures = [];
  const bundle = files.bundle ?? "";
  for (
    const token of [
      "export type PaymentOperationFlagField",
      '"payout_hold_onboard_flip"',
      '"payout_release_execute"',
      '"source_refunds_post_disabled"',
      'payout_hold_onboard_flip: "PAYOUT_HOLD_ONBOARD_FLIP"',
      'payout_release_execute: "PAYOUT_RELEASE_EXECUTE"',
      'source_refunds_post_disabled: "SOURCE_REFUNDS_POST_DISABLED"',
      '"paystack_payout_hold_onboard_flip"',
      "if (version !== 1 && version !== 2 && version !== 3)",
      '...(version === 2 || version === 3 ? ["payment_operations"] : [])',
      "export function resolvePaymentOperationFlagValue",
      "export function resolvePaystackPayoutHoldOnboardFlip",
      "result.value.schema_version === 3",
      "return parseLegacyBoolean(legacy)",
    ]
  ) {
    requireToken(bundle, token, "strict v1/v2 delivery bundle", failures);
  }

  const hmac = files.hmac ?? "";
  for (
    const token of [
      'const BUNDLE_NAME = "AD_CONVERSION_TOKENS"',
      'const FIELD_NAME = "NOTIFICATION_RECIPIENT_HMAC_SECRET"',
      "value.trim().length >= MIN_SECRET_LENGTH",
      "return parsed[FIELD_NAME]",
      "return validSecret(direct) ? direct : undefined",
      '"notification_hmac_bundle_invalid"',
      '"notification_hmac_legacy_fallback"',
    ]
  ) {
    requireToken(hmac, token, "recipient HMAC bundle resolver", failures);
  }
  forbidToken(
    hmac,
    "return parsed[FIELD_NAME].trim()",
    "recipient HMAC byte preservation",
    failures,
  );
  forbidToken(hmac, "console.error(raw", "recipient HMAC redaction", failures);
  forbidToken(hmac, "console.warn(raw", "recipient HMAC redaction", failures);

  const notify = files.notify ?? "";
  requireToken(
    notify,
    "recipientHmacSecret: resolveNotificationRecipientHmacSecret() ?? \"\"",
    "notify dispatch compatibility",
    failures,
  );
  forbidToken(
    notify,
    'Deno.env.get("NOTIFICATION_RECIPIENT_HMAC_SECRET")',
    "notify dispatch compatibility",
    failures,
  );

  const onboard = files.onboard ?? "";
  for (
    const token of [
      'resolvePaymentOperationFlagValue(\n  "payout_hold_onboard_flip",',
      '"PAYOUT_HOLD_ONBOARD_FLIP",\n) ?? false',
    ]
  ) {
    requireToken(onboard, token, "onboarding safe default", failures);
  }

  const paystackOnboard = files.paystackOnboard ?? "";
  for (
    const token of [
      'import { resolvePaystackPayoutHoldOnboardFlip }',
      "await attemptPaystackOnboardStamp(",
      '"stamp_payout_hold_cutover"',
      "p_stripe_account_id: null",
      'result: "stamp_failed"',
      "prior_interval: null",
      "new_interval: null",
      'p_reason: "paystack_onboarding_auto_stamp"',
    ]
  ) requireToken(paystackOnboard, token, "Paystack post-write stamp boundary", failures);
  forbidToken(
    paystackOnboard,
    'Deno.env.get("PAYSTACK_PAYOUT_HOLD_ONBOARD_FLIP")',
    "Paystack bundle-only authority",
    failures,
  );
  const paystackBrandWrite = paystackOnboard.indexOf(
    "paystack_subaccount_code: subaccountCode",
  );
  const paystackWriteGuard = paystackOnboard.indexOf(
    "if (updErr)",
    paystackBrandWrite,
  );
  const paystackStampCall = paystackOnboard.indexOf(
    "await attemptPaystackOnboardStamp(",
    paystackWriteGuard,
  );
  const paystackResponse = paystackOnboard.indexOf(
    "subaccount_code: subaccountCode",
    paystackStampCall,
  );
  if (
    paystackBrandWrite < 0 || paystackWriteGuard < paystackBrandWrite ||
    paystackStampCall < paystackWriteGuard || paystackResponse < paystackStampCall ||
    paystackOnboard.indexOf("await attemptPaystackOnboardStamp(") !==
      paystackOnboard.lastIndexOf("await attemptPaystackOnboardStamp(")
  ) failures.push("Paystack post-write stamp boundary: sequencing invalid");
  const stampBlock = paystackOnboard.slice(paystackStampCall, paystackResponse);
  for (const forbidden of ["paystackUpdateSubaccount(", "rollback_payout_hold_cutover"] ) {
    forbidToken(stampBlock, forbidden, "Paystack stamp failure compensation", failures);
  }

  const payout = files.payout ?? "";
  for (
    const token of [
      'resolvePaymentOperationFlagValue(\n    "payout_release_execute",',
      '"PAYOUT_RELEASE_EXECUTE",\n    deps.env,\n  ) ?? false',
      "if (!payoutReleaseExecute)",
    ]
  ) {
    requireToken(payout, token, "payout safe default and DI", failures);
  }

  const refunds = files.refunds ?? "";
  for (
    const token of [
      'const KILL_SWITCH = "SOURCE_REFUNDS_POST_DISABLED"',
      'resolvePaymentOperationFlagValue(\n    "source_refunds_post_disabled",',
      "KILL_SWITCH,\n  ) ?? true",
      "return postsDisabled === false",
    ]
  ) {
    requireToken(refunds, token, "refund fail-safe default", failures);
  }

  const test = files.test ?? "";
  for (
    const token of [
      "all 64 schema-v2 switch combinations stay independent",
      "schema v1 and invalid v2 use only exact direct controls",
      "missing, wrong-type, and nested-unknown v2 fields reject without leaking values",
      "caller defaults are safe when no valid control exists",
      "HMAC bundle wins without transforming bytes",
      "invalid HMAC material fails closed and diagnostics redact values",
      "missing HMAC authority fails before claim or provider I/O",
      "await recipientFingerprint",
    ]
  ) {
    requireToken(test, token, "runtime compatibility proof", failures);
  }
  const issue1903BundleTest = files.issue1903BundleTest ?? "";
  for (
    const token of [
      "all 128 schema-v3 switches remain independent",
      "v1/v2 preserve established controls and keep Paystack dark",
      "every invalid or non-v3 Paystack authority fails false",
      "v3 does not couple Stripe and Paystack onboarding",
    ]
  ) requireToken(issue1903BundleTest, token, "#1903 bundle proof", failures);
  const issue1903OnboardTest = files.issue1903OnboardTest ?? "";
  for (
    const token of [
      "dark success makes zero stamp or cutover-row calls",
      "true calls once and preserves RPC concurrency truth",
      "stamp failure is truthful and never escapes onboarding",
      "record_failure",
    ]
  ) requireToken(issue1903OnboardTest, token, "#1903 onboarding proof", failures);

  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("manifest: invalid JSON");
    manifest = {};
  }
  // [TEST-MOD-APPROVED #1770] The approved offering-invite pepper advances the
  // exact capacity baseline while remaining a standalone cryptographic secret.
  // [TEST-MOD-APPROVED #2830] The established Phase B names remain bundled;
  // founder-approved Sites slot 88 is independently guarded by issue #2830.
  if (manifest.rollout?.expected_user_managed_count !== 88) {
    failures.push("manifest: Phase B plus approved Sites slot must enforce expected count at 88");
  }
  const records = new Map(
    (manifest.secrets ?? []).map((record) => [record.name, record]),
  );
  for (
    const name of [
      "NOTIFICATION_RECIPIENT_HMAC_SECRET",
      "PAYOUT_HOLD_ONBOARD_FLIP",
      "PAYOUT_RELEASE_EXECUTE",
      "SOURCE_REFUNDS_POST_DISABLED",
      "PAYSTACK_PAYOUT_HOLD_ONBOARD_FLIP",
    ]
  ) {
    if (records.has(name)) {
      failures.push(`manifest: Phase B retired direct name present: ${name}`);
    }
  }
  const delivery = records.get("MINGLA_DELIVERY_FLAGS_JSON");
  for (
    const field of [
      "payout_hold_onboard_flip",
      "paystack_payout_hold_onboard_flip",
      "payout_release_execute",
      "source_refunds_post_disabled",
    ]
  ) {
    if (!delivery?.bundle_fields?.some((entry) => entry.name === field)) {
      failures.push(`manifest: Phase B payment field missing: ${field}`);
    }
  }
  const paystackField = delivery?.bundle_fields?.find((entry) =>
    entry.name === "paystack_payout_hold_onboard_flip"
  );
  if (
    paystackField?.owner !== "Payments Engineering" ||
    paystackField?.source_type !== "operating_record"
  ) failures.push("manifest: Paystack payment field metadata invalid");

  const runbook = files.runbook ?? "";
  for (const token of ["schema v3", "bundle-only", "all 17", "schema v2"]) {
    requireToken(runbook, token, "#1903 value-blind rollout runbook", failures);
  }

  const config = files.config ?? "";
  const jwtByFunction = new Map();
  let currentFunction = null;
  for (const line of config.split("\n")) {
    const heading = line.match(/^\[functions\.([^\]]+)\]\s*$/);
    if (heading) {
      currentFunction = heading[1];
      continue;
    }
    const jwt = line.match(/^verify_jwt\s*=\s*(true|false)\s*$/);
    if (currentFunction && jwt) jwtByFunction.set(currentFunction, jwt[1] === "true");
  }
  for (const [functionName, expectedJwt] of EXPECTED_DELIVERY_RUNTIME_CLOSURE) {
    const actualJwt = jwtByFunction.get(functionName) ?? true;
    if (actualJwt !== expectedJwt) {
      failures.push(`rollout JWT inventory mismatch: ${functionName}`);
    }
  }
  const conversion = records.get("AD_CONVERSION_TOKENS");
  if (
    !conversion?.bundle_fields?.some((entry) =>
      entry.name === "NOTIFICATION_RECIPIENT_HMAC_SECRET"
    )
  ) {
    failures.push("manifest: Phase B notification HMAC field missing");
  }
  const offeringPepper = records.get("OFFERING_INVITE_TOKEN_PEPPER");
  if (
    offeringPepper?.class !== "cryptographic_secret" ||
    offeringPepper?.source_type !== "secure_vault" ||
    offeringPepper?.issue !== 1770 ||
    JSON.stringify(offeringPepper?.readers) !== JSON.stringify([
      "supabase/functions/_shared/offeringInviteToken.ts",
      "supabase/functions/marketing-send/index.ts",
      "supabase/functions/offering-invite-dispatch/index.ts",
    ])
  ) {
    failures.push("manifest: offering invite token pepper contract missing");
  }

  failures.push(...ciWiring(JSON.parse(files.registry ?? "{}")));
  return failures;
}

const SUITE_ID = "issue-1437-secret-bundle-compatibility-tests";
const ORIGIN = ".github/workflows/issue-1437-secret-bundle-compatibility-tests.yml";
const WAVE = "phase3c-deno-wave";
const DENO_2_7_14_ACTION = "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed";
// Every token the workflow read required, split by WHERE it actually lives now.
const EXECUTED_TOKENS = [
  "issue_1437_secret_bundle_compatibility.test.ts",
  "issue_1203_secret_bundles.test.ts",
  "issue_1221_source_refund_control_plane.test.ts",
  "issue_1173_onboard_dark_default.test.ts",
  "issue_1172_stripe_payout_execution.test.ts",
  "issue_1221_source_refund_safe_boundary.test.ts",
  "issue_1903_delivery_bundle_v3.test.ts",
  "issue_1903_paystack_auto_stamp.test.ts",
  "issue_1903_paystack_auto_stamp.tester.adversarial.test.ts",
  "issue-1437-secret-bundle-compatibility.mjs --self-test",
  "issue-1437-secret-bundle-compatibility.mjs",
  "issue-1203-secret-capacity.mjs --self-test",
  "issue-1203-secret-capacity.mjs",
];
const TRIGGER_TOKENS = ["supabase/functions/**", "supabase/config.toml"];

/**
 * [#2439 SC-15.1] The same blocking-CI-wiring protections, expressed against the
 * registry instead of the workflow text. Pure: takes the parsed registry so
 * every self-test mutant runs in memory.
 *
 * @param {object} registry parsed `.github/ci-batch/MANIFEST.json`
 * @returns {string[]} failures
 */
export function ciWiring(registry) {
  const failures = [];
  const suites = (registry.suites || []).filter((suite) => suite.id === SUITE_ID);
  if (suites.length !== 1) {
    failures.push(`blocking CI wiring: expected exactly one ${SUITE_ID} suite, got ${suites.length}`);
    return failures;
  }
  const [suite] = suites;
  if (suite.migrationWave !== WAVE) failures.push("blocking CI wiring: suite is not owned by phase3c-deno-wave");
  if (suite.origin !== ORIGIN) failures.push(`blocking CI wiring: provider identity drifted: ${suite.origin}`);
  const leaves = (suite.steps || []).flatMap((step) => (step.children || []).map((child) => ({ step, child })));
  const commands = leaves.map(({ child }) => child.invocation?.argv?.[1] || "");
  for (const token of EXECUTED_TOKENS) {
    if (!commands.some((command) => command.includes(token))) failures.push(`blocking CI wiring: missing ${token}`);
  }
  const pathLists = [suite.triggerContract?.push?.paths, suite.triggerContract?.pullRequest?.paths]
    .map((list) => (Array.isArray(list) ? list : []));
  for (const token of TRIGGER_TOKENS) {
    if (pathLists.filter((list) => list.includes(token)).length !== 2) failures.push(`blocking CI wiring: missing "${token}"`);
  }
  if (suite.runtime?.deno?.version !== "v2.7.14" || suite.runtime?.deno?.action !== DENO_2_7_14_ACTION) {
    failures.push(`blocking CI wiring: missing deno-version: v2.7.14 (${JSON.stringify(suite.runtime?.deno || null)})`);
  }
  if (!commands.some((command) => command.startsWith("deno test --allow-env --allow-read --allow-net=deno.land,esm.sh "))) {
    failures.push("blocking CI wiring: the exact host-scoped Deno permission set is gone");
  }
  for (const { step, child } of leaves) {
    if (child.predicate?.kind !== "always") failures.push(`blocking CI wiring: continue-on-error — ${child.id} became conditional`);
    if ((child.cwd ?? step.cwd ?? ".") !== ".") failures.push(`blocking CI wiring: ${child.id} moved out of the repository root`);
    const command = child.invocation?.argv?.[1] || "";
    if (/\|\|\s*true|;\s*exit\s+0/.test(command)) failures.push(`blocking CI wiring: continue-on-error — ${child.id} swallows its own failure`);
  }
  // [#2439 SC-15.1] Lifecycle consistency, asserted PURELY from the registry —
  // no filesystem coupling to a wrapper file, because re-coupling this guard to
  // `.github/workflows/<name>` is the very thing cutover removes. At shadow the
  // legacy origin names its own wrapper as sole provider; at terminal it must
  // NOT, because the batch umbrella is. A batched record still naming its
  // deleted wrapper is exactly the SC-18.3 attack this catches, and inverting
  // the lifecycle fires it on either side of cutover.
  const legacyOrigin = (registry.legacyOrigins || []).find((item) => `${item.stem}.${item.extension}` === ORIGIN.split("/").pop());
  const namesItself = legacyOrigin?.providerWorkflow === ORIGIN;
  if (!legacyOrigin || namesItself !== (suite.lifecycle !== "batched-historical")) {
    failures.push("blocking CI wiring: legacy origin does not name the sole provider for this lifecycle");
  }
  if ((suite.envNames || []).length) failures.push("blocking CI wiring: suite gained an environment capability");
  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(paths).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const valid = readFiles();
  const baseline = violations(valid);
  if (baseline.length > 0) {
    throw new Error(`self-test baseline invalid:\n${baseline.join("\n")}`);
  }
  const reversions = [
    {
      key: "bundle",
      value: valid.bundle.replace(
        "if (version !== 1 && version !== 2 && version !== 3)",
        "if (version !== 1 && version !== 2)",
      ),
      expected: "version",
    },
    {
      key: "bundle",
      value: valid.bundle.replace(
        'payout_release_execute: "PAYOUT_RELEASE_EXECUTE"',
        'payout_release_execute: "SOURCE_REFUNDS_POST_DISABLED"',
      ),
      expected: "PAYOUT_RELEASE_EXECUTE",
    },
    {
      key: "bundle",
      value: valid.bundle.replace(
        "export function resolvePaystackPayoutHoldOnboardFlip(",
        "function removedPaystackBundleOnlyResolver(",
      ),
      expected: "resolvePaystackPayoutHoldOnboardFlip",
    },
    {
      key: "paystackOnboard",
      value: valid.paystackOnboard.replace(
        "await attemptPaystackOnboardStamp(",
        "await removedPaystackOnboardStamp(",
      ),
      expected: "post-write stamp boundary",
    },
    {
      key: "notify",
      value: valid.notify.replace(
        "recipientHmacSecret: resolveNotificationRecipientHmacSecret() ?? \"\"",
        'recipientHmacSecret: Deno.env.get("NOTIFICATION_RECIPIENT_HMAC_SECRET") ?? ""',
      ),
      expected: "notify dispatch compatibility",
    },
    {
      key: "onboard",
      value: valid.onboard.replace(") ?? false;", ") ?? true;"),
      expected: "onboarding safe default",
    },
    {
      key: "payout",
      value: valid.payout.replace(
        '"PAYOUT_RELEASE_EXECUTE",\n    deps.env,',
        '"PAYOUT_RELEASE_EXECUTE",',
      ),
      expected: "payout safe default and DI",
    },
    {
      key: "refunds",
      value: valid.refunds.replace(") ?? true;", ") ?? false;"),
      expected: "refund fail-safe default",
    },
    {
      key: "hmac",
      value: valid.hmac.replace(
        "return parsed[FIELD_NAME];",
        "return parsed[FIELD_NAME].trim();",
      ),
      expected: "recipient HMAC byte preservation",
    },
    {
      key: "test",
      value: valid.test.replace(
        "all 64 schema-v2 switch combinations stay independent",
        "schema-v2 switches stay independent",
      ),
      expected: "runtime compatibility proof",
    },
    // [#2439 SC-15.1] The continue-on-error reversion now attacks the registry
    // form of the same property — a typed predicate that turns an unconditional
    // assertion into a skippable one — plus four more for protections the
    // workflow-text read could never see.
    {
      key: "registry",
      // Targeted through the parsed object: a first-occurrence text replace
      // would have hit another wave's leaf and left #1437's own assertion
      // untouched — a mutant that mutates the wrong thing is a mutant that
      // cannot fail.
      value: (() => {
        const value = JSON.parse(valid.registry);
        const suite = value.suites.find((item) => item.id === SUITE_ID);
        suite.steps[0].children[0].predicate = { kind: "file-exists", paths: ["supabase/config.toml"] };
        return JSON.stringify(value);
      })(),
      expected: "continue-on-error",
    },
    {
      key: "registry",
      value: valid.registry.split("issue_1903_paystack_auto_stamp.tester.adversarial.test.ts").join("issue_1903_paystack_auto_stamp.tester.adversarial.disabled.ts"),
      expected: "missing issue_1903_paystack_auto_stamp.tester.adversarial.test.ts",
    },
    {
      key: "registry",
      value: valid.registry.split("--allow-env --allow-read --allow-net=deno.land,esm.sh supabase/functions/_shared/issue_1437_secret_bundle_compatibility.test.ts")
        .join("--allow-env --allow-read --allow-net supabase/functions/_shared/issue_1437_secret_bundle_compatibility.test.ts"),
      expected: "the exact host-scoped Deno permission set is gone",
    },
    {
      key: "registry",
      value: valid.registry.split('"' + ORIGIN + '"').join('".github/workflows/not-a-real-workflow-identity"'),
      expected: "provider identity drifted",
    },
    {
      key: "registry",
      value: valid.registry.split(DENO_2_7_14_ACTION).join("denoland/setup-deno@v2"),
      expected: "missing deno-version: v2.7.14",
    },
    {
      key: "registry",
      // Inverts rather than pins, for the same reason: a lifecycle mutant fixed
      // at one value cannot fail once the wave reaches that value.
      value: (() => {
        const value = JSON.parse(valid.registry);
        const suite = value.suites.find((item) => item.id === SUITE_ID);
        suite.lifecycle = suite.lifecycle === "batched-historical" ? "shadow-active" : "batched-historical";
        return JSON.stringify(value);
      })(),
      expected: "legacy origin does not name the sole provider for this lifecycle",
    },
    {
      key: "config",
      value: valid.config.replace(
        "[functions.payout-release-sweep]\nverify_jwt = false",
        "[functions.payout-release-sweep]\nverify_jwt = true",
      ),
      expected: "rollout JWT inventory mismatch",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"secrets": [',
        '"secrets": [{"name":"NOTIFICATION_RECIPIENT_HMAC_SECRET"},',
      ),
      expected: "retired direct name present",
    },
  ];
  for (const reversion of reversions) {
    const mutated = { ...valid, [reversion.key]: reversion.value };
    const failures = violations(mutated);
    if (!failures.some((failure) => failure.includes(reversion.expected))) {
      throw new Error(
        `self-test missed ${reversion.key} reversion: ${reversion.expected}`,
      );
    }
  }

  const synthetic = (records) => new Map(records.map(([relativePath, source]) => [
    `supabase/functions/${relativePath}`,
    source,
  ]));
  const direct = deriveDeliveryRuntimeClosure(synthetic([
    ["direct/index.ts", 'import { resolveDeliveryFlagValue } from "../shared.ts";\nresolveDeliveryFlagValue();'],
    ["shared.ts", "export const shared = true;"],
  ]));
  if (JSON.stringify(direct.derived) !== JSON.stringify(["direct"])) {
    throw new Error("runtime_closure_direct_consumer_failed");
  }
  const multiHop = deriveDeliveryRuntimeClosure(synthetic([
    ["outer/index.ts", 'import "../inner/index.ts";'],
    ["inner/index.ts", 'import "../shared.ts";'],
    ["shared.ts", 'import "./cycle.ts";\nresolvePaymentOperationFlagValue();'],
    ["cycle.ts", 'import "./shared.ts";'],
    ["type-only/index.ts", 'import type { Config } from "../shared.ts"; export const ok = true;'],
  ]));
  if (
    JSON.stringify(multiHop.derived) !== JSON.stringify(["inner", "outer"]) ||
    multiHop.relevantUnresolved.length !== 0
  ) throw new Error("runtime_closure_multihop_cycle_or_type_exclusion_failed");
  const unresolved = deriveDeliveryRuntimeClosure(synthetic([
    ["broken/index.ts", 'import "../missing.ts";\nresolvePaystackPayoutHoldOnboardFlip();'],
  ]));
  if (unresolved.relevantUnresolved.length !== 1) {
    throw new Error("runtime_closure_unresolved_import_failed_open");
  }
  const unlisted = compareClosure(direct, []);
  if (!unlisted.some((failure) => failure.includes("unlisted_runtime_consumer"))) {
    throw new Error("runtime_closure_unlisted_consumer_not_rejected");
  }
  const stale = compareClosure({ derived: [], relevantUnresolved: [] }, ["stale"]);
  if (!stale.some((failure) => failure.includes("stale_listed_consumer"))) {
    throw new Error("runtime_closure_stale_consumer_not_rejected");
  }
  const countMismatch = compareClosure(direct, ["direct", "stale"]);
  if (!countMismatch.some((failure) => failure.includes("exact_count_mismatch"))) {
    throw new Error("runtime_closure_count_mismatch_not_rejected");
  }
}

const files = readFiles();
if (process.argv.includes("--self-test")) selfTest();
const closure = closureViolations(root);
const failures = [...violations(files), ...closure.failures];
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `issue-1437-secret-bundle-compatibility: PASS derived_count=${closure.result.derived.length} expected_count=${closure.expectedNames.length} set_match=true`,
);
