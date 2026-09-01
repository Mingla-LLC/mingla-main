#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const paths = {
  paystack: "supabase/functions/_shared/paystackRefunds.ts",
  control: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  manifest: "supabase/secrets.manifest.json",
  happy:
    "supabase/functions/_shared/__tests__/issue_1430_refund_replay_happy.test.ts",
  adversarial:
    "supabase/functions/_shared/__tests__/issue_1430_refund_replay.tester.adversarial.test.ts",
  // [#2439 SC-15 item 1] Was ".github/workflows/issue-1430-refund-replay-tests.yml".
  // Phase 3C deletes that wrapper at cutover, and this file reads every entry in
  // `paths` eagerly — so the read would have thrown ENOENT and taken the whole
  // gate down with an unhandled crash instead of a verdict. It now reads the CI
  // registry, which is where #1430's triggers and its exact Deno command live,
  // and asserts the SAME eight protections plus the ones a text read could not
  // see: provider identity, wave, cwd, action pin and environment.
  registry: ".github/ci-batch/MANIFEST.json",
};

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbidToken(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

function requireOrder(source, tokens, label, failures) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    if (index < 0) {
      failures.push(`${label}: order missing ${token}`);
      return;
    }
    cursor = index;
  }
}

export function violations(files) {
  const failures = [];
  const paystack = files.paystack ?? "";
  requireOrder(
    paystack,
    [
      "async function resolveTransactionIdentity",
      "/transaction/verify/",
      "async function findExistingRefund",
      "transaction: String(params.transactionId)",
      "async function resolveAndFindExistingRefund",
      "const identity = await resolveTransactionIdentity",
      "const existing = await findExistingRefund",
      "export async function reconcilePaystackRefund",
      "export async function createPaystackRefund",
      "const reconciliation = await resolveAndFindExistingRefund(params)",
      "if (reconciliation.existing) return reconciliation.existing",
      'if (reconciliation.identity.state !== "success")',
      "fetch(`${PAYSTACK_BASE_URL}/refund`",
    ],
    "paystack verify -> approved-state list -> success-only POST",
    failures,
  );
  for (
    const token of [
      'type PaystackRefundReconciliationState =\n  | "success"\n  | "reversal-pending"\n  | "reversed"',
      '>(["success", "reversal-pending", "reversed"])',
      "state === null",
      "!PAYSTACK_REFUND_RECONCILIATION_STATES.has(",
      "providerTransactionId(row.transaction) === params.transactionId",
      "row.merchant_note === params.merchantNote",
      "Number(row.amount ?? NaN) === params.amountSubunits",
      '"paystack_refund_transaction_state_ambiguous"',
      "isDuplicateRefundSignal(res.status, providerCode, message)",
      "const duplicateReconciliation = await resolveAndFindExistingRefund(",
      'if (duplicateReconciliation.identity.state !== "success")',
      '"paystack_refund_duplicate_ambiguous"',
      "error.status === 409",
    ]
  ) {
    requireToken(
      paystack,
      token,
      "paystack state and replay authority",
      failures,
    );
  }

  const control = files.control ?? "";
  requireOrder(
    control,
    [
      "try {",
      "feeId = await proveStripeApplicationFee(client, operation)",
      "if (!isStripeFeeIdentityPermissionDenied(error)) throw error",
      '"stripe_fee_identity_permission_denied"',
      "return;",
      'if (operation.buyer_state !== "processed")',
      "stripe.refunds.create",
    ],
    "Stripe permission denial must return before buyer POST",
    failures,
  );
  for (
    const token of [
      'row.type === "StripePermissionError"',
      "row.statusCode === 401",
      "row.statusCode === 403",
      '"needs_attention"',
      "0,",
      "null,",
    ]
  ) {
    requireToken(control, token, "Stripe durable denial", failures);
  }

  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("manifest: invalid JSON");
    manifest = {};
  }
  if (manifest.rollout?.expected_user_managed_count !== 88) {
    failures.push("manifest: expected user-managed count must be 88");
  }
  if (manifest.policy?.normal_ceiling !== 87) {
    failures.push("manifest: normal ceiling must remain 87");
  }
  if (manifest.policy?.absolute_ceiling !== 90) {
    failures.push("manifest: absolute ceiling must remain 90");
  }
  const records = new Map(
    (manifest.secrets ?? []).map((record) => [record.name, record]),
  );
  const retiredDirectNames = [
    "NOTIFICATION_RECIPIENT_HMAC_SECRET",
    "PAYOUT_HOLD_ONBOARD_FLIP",
    "PAYOUT_RELEASE_EXECUTE",
    "SOURCE_REFUNDS_POST_DISABLED",
  ];
  for (const name of retiredDirectNames) {
    if (records.has(name)) {
      failures.push(`manifest: retired direct compatibility name present: ${name}`);
    }
  }
  const delivery = records.get("MINGLA_DELIVERY_FLAGS_JSON");
  for (
    const field of [
      "payout_hold_onboard_flip",
      "payout_release_execute",
      "source_refunds_post_disabled",
    ]
  ) {
    if (!delivery?.bundle_fields?.some((entry) => entry.name === field)) {
      failures.push(`manifest: bundled payment authority missing: ${field}`);
    }
  }
  const conversion = records.get("AD_CONVERSION_TOKENS");
  if (
    !conversion?.bundle_fields?.some((entry) =>
      entry.name === "NOTIFICATION_RECIPIENT_HMAC_SECRET"
    )
  ) {
    failures.push("manifest: bundled notification HMAC authority missing");
  }
  if (records.size !== 88) {
    failures.push(
      `manifest: exact record count must be 88, got ${records.size}`,
    );
  }
  if (
    !Array.isArray(manifest.exceptions) || manifest.exceptions.length !== 1 ||
    manifest.exceptions[0]?.issue !== 2830
  ) {
    failures.push("manifest: #2830 must be the sole capacity exception");
  }

  const happy = files.happy ?? "";
  for (
    const token of [
      "replays without a second POST",
      'providerVisible ? "reversal-pending" : "success"',
      "assertEquals(calls.map((call) => call.method), [",
      "duplicate ambiguity reconciles exact identity",
      "mismatched duplicate remains retryable ambiguity",
      "identity mismatch fails before refund reconciliation or POST",
      "null fee identity proves the connected-account chain",
      "permission denial records a safe fee state before any buyer refund POST",
    ]
  ) {
    requireToken(happy, token, "runtime regression guard", failures);
  }

  const adversarial = files.adversarial ?? "";
  for (
    const token of [
      "substituted transaction identity stays ambiguous with no extra POST",
      "persisted refund identity cannot be substituted during read-only adoption",
      "reversal-pending exact identity is read-only adopted",
      "reversal-pending empty and mismatched rows stay retryable with zero POST",
      "reversed exact row adopts while absent identity never POSTs",
      "success with no exact row is the sole fresh POST authority",
      "unknown or malformed identity fails before list and POST",
      "duplicate recovery re-verifies reversal-pending and adopts only exact identity",
      "assertEquals(posts, 1)",
      'assertEquals(methods, ["GET", "GET", "POST", "GET", "GET"])',
      'providerRefundId: "provider-refund-authoritative"',
      "assertEquals(match, null)",
    ]
  ) {
    requireToken(
      adversarial,
      token,
      "tester provider-identity adversarial guard",
      failures,
    );
  }

  failures.push(...ciWiring(JSON.parse(files.registry ?? "{}")));
  return failures;
}

const SUITE_ID = "issue-1430-refund-replay-tests";
const ORIGIN = ".github/workflows/issue-1430-refund-replay-tests.yml";
const WAVE = "phase3c-deno-wave";
const DENO_2_7_14_ACTION = "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed";
const GUARDED_TRIGGER_PATHS = [
  "supabase/functions/_shared/paystackRefunds.ts",
  "supabase/functions/_shared/sourceRefundControlPlane.ts",
  ".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs",
];
const EXECUTED_SUITES = [
  "supabase/functions/_shared/__tests__/issue_1430_refund_replay_happy.test.ts",
  "supabase/functions/_shared/__tests__/issue_1430_refund_replay.tester.adversarial.test.ts",
];
const EXACT_DENO_COMMAND =
  `deno test --allow-env --allow-read --allow-net=deno.land,esm.sh ${EXECUTED_SUITES[0]} ${EXECUTED_SUITES[1]}`;

/**
 * [#2439 SC-15.1] The same blocking-CI-wiring protections the workflow text read
 * enforced, expressed against the registry that production actually executes.
 * Pure: takes the parsed registry so every self-test mutant runs in memory.
 *
 * @param {object} registry parsed `.github/ci-batch/MANIFEST.json`
 * @returns {string[]} failures
 */
export function ciWiring(registry) {
  const failures = [];
  const suites = (registry.suites || []).filter((suite) => suite.id === SUITE_ID);
  if (suites.length !== 1) {
    failures.push(`blocking runtime CI wiring: expected exactly one ${SUITE_ID} suite, got ${suites.length}`);
    return failures;
  }
  const [suite] = suites;
  if (suite.migrationWave !== WAVE) failures.push("blocking runtime CI wiring: suite is not owned by phase3c-deno-wave");
  if (suite.origin !== ORIGIN) failures.push(`blocking runtime CI wiring: provider identity drifted: ${suite.origin}`);
  const pathLists = [suite.triggerContract?.push?.paths, suite.triggerContract?.pullRequest?.paths]
    .map((list) => (Array.isArray(list) ? list : []));
  for (const guarded of [...GUARDED_TRIGGER_PATHS, ...EXECUTED_SUITES]) {
    if (pathLists.filter((list) => list.includes(guarded)).length !== 2) {
      failures.push(`blocking runtime CI wiring: missing ${guarded} from both trigger path lists`);
    }
  }
  const leaves = (suite.steps || []).flatMap((step) => (step.children || []).map((child) => ({ step, child })));
  const exact = leaves.find(({ child }) => (child.invocation?.argv?.[1] || "") === EXACT_DENO_COMMAND);
  if (!exact) {
    failures.push(`blocking runtime CI wiring: missing ${EXACT_DENO_COMMAND}`);
  } else {
    if ((exact.child.cwd ?? exact.step.cwd ?? ".") !== ".") failures.push("blocking runtime CI wiring: the Deno command moved out of the repository root");
    if (exact.child.predicate?.kind !== "always") failures.push("blocking runtime CI wiring: continue-on-error — the Deno command became conditional");
  }
  for (const { child } of leaves) {
    const command = child.invocation?.argv?.[1] || "";
    if (/\|\|\s*true|;\s*exit\s+0/.test(command)) failures.push("blocking runtime CI wiring: continue-on-error — a leaf swallows its own failure");
  }
  const runtime = suite.runtime || {};
  if (runtime.deno?.version !== "v2.7.14" || runtime.deno?.action !== DENO_2_7_14_ACTION) {
    failures.push(`blocking runtime CI wiring: missing deno-version: v2.7.14 (${JSON.stringify(runtime.deno || null)})`);
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
    failures.push("blocking runtime CI wiring: legacy origin does not name the sole provider for this lifecycle");
  }
  if ((suite.envNames || []).length) failures.push("blocking runtime CI wiring: suite gained an environment capability");
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
      key: "paystack",
      value: valid.paystack.replace(
        "/transaction/verify/",
        "/transaction/reference/",
      ),
      expected: "/transaction/verify/",
    },
    {
      key: "paystack",
      value: valid.paystack.replace(
        "providerTransactionId(row.transaction) === params.transactionId",
        "providerTransactionId(row.transaction) !== params.transactionId",
      ),
      expected: "providerTransactionId(row.transaction)",
    },
    {
      key: "paystack",
      value: valid.paystack.replace(
        '>(["success", "reversal-pending", "reversed"])',
        '>(["success"])',
      ),
      expected: "reversal-pending",
    },
    {
      key: "paystack",
      value: valid.paystack.replace(
        'if (reconciliation.identity.state !== "success")',
        'if (reconciliation.identity.state !== "reversal-pending")',
      ),
      expected: 'reconciliation.identity.state !== "success"',
    },
    {
      key: "paystack",
      value: valid.paystack.replace(
        'if (duplicateReconciliation.identity.state !== "success")',
        'if (duplicateReconciliation.identity.state !== "reversed")',
      ),
      expected: 'duplicateReconciliation.identity.state !== "success"',
    },
    {
      key: "control",
      value: valid.control.replace(
        '"stripe_fee_identity_permission_denied"',
        '"application_fee_identity_unproven"',
      ),
      expected: "stripe_fee_identity_permission_denied",
    },
    {
      key: "control",
      value: valid.control.replace(
        "row.statusCode === 403",
        "row.statusCode === 418",
      ),
      expected: "row.statusCode === 403",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"expected_user_managed_count": 88',
        '"expected_user_managed_count": 89',
      ),
      expected: "expected user-managed count",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"name":"source_refunds_post_disabled"',
        '"name":"source_refunds_post_enabled"',
      ),
      expected: "bundled payment authority missing",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"secrets": [',
        '"secrets": [{"name":"SOURCE_REFUNDS_POST_DISABLED","readers":[]},',
      ),
      expected: "retired direct compatibility name present",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"issue":2830,"owner":"Platform Security"',
        '"issue":1430,"owner":"Platform Security"',
      ),
      expected: "#2830 must be the sole capacity exception",
    },
    {
      key: "happy",
      value: valid.happy.replace(
        'providerVisible ? "reversal-pending" : "success"',
        '"success"',
      ),
      expected: 'providerVisible ? "reversal-pending" : "success"',
    },
    {
      key: "adversarial",
      value: valid.adversarial.replace(
        "reversal-pending exact identity is read-only adopted",
        "reversal-pending exact identity is disabled",
      ),
      expected: "reversal-pending exact identity is read-only adopted",
    },
    // [#2439 SC-15.1] The two workflow-text reversions become registry
    // reversions attacking the same two properties, plus five more for the
    // protections a filename read could never see. The registry is JSON and one
    // identity appears in both trigger path lists AND a leaf argv, so a registry
    // reversion must replace EVERY occurrence: a first-occurrence-only mutant
    // would leave the assertion it was written to attack still satisfied.
    {
      key: "registry",
      value: valid.registry.split("issue_1430_refund_replay_happy.test.ts").join("issue_1430_refund_replay_happy.disabled.ts"),
      expected: "issue_1430_refund_replay_happy.test.ts",
    },
    {
      key: "registry",
      value: valid.registry.split("issue_1430_refund_replay.tester.adversarial.test.ts").join("issue_1430_refund_replay.tester.adversarial.disabled.ts"),
      expected: "issue_1430_refund_replay.tester.adversarial.test.ts",
    },
    {
      key: "registry",
      value: valid.registry.split("--allow-env --allow-read --allow-net=deno.land,esm.sh supabase/functions/_shared/__tests__/issue_1430_refund_replay_happy.test.ts")
        .join("--allow-env --allow-read --allow-net supabase/functions/_shared/__tests__/issue_1430_refund_replay_happy.test.ts"),
      expected: EXACT_DENO_COMMAND,
    },
    {
      key: "registry",
      value: valid.registry.split('"' + ORIGIN + '"').join('".github/workflows/not-a-real-workflow-identity"'),
      expected: "provider identity drifted",
    },
    {
      key: "registry",
      value: valid.registry.split(DENO_2_7_14_ACTION).join("denoland/setup-deno@v2"),
      expected: "deno-version: v2.7.14",
    },
    {
      key: "registry",
      value: valid.registry.split('".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs"').join('".github/scripts/strict-grep/gone.mjs"'),
      expected: "missing .github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs",
    },
    {
      key: "registry",
      value: valid.registry.split('"' + SUITE_ID + '"').join('"' + SUITE_ID + '-renamed"'),
      expected: `expected exactly one ${SUITE_ID} suite`,
    },
    {
      key: "registry",
      // Inverts rather than pins: a lifecycle mutant fixed at one value is a
      // mutant that cannot fail once the wave reaches that value.
      value: (() => {
        const value = JSON.parse(valid.registry);
        const suite = value.suites.find((item) => item.id === SUITE_ID);
        suite.lifecycle = suite.lifecycle === "batched-historical" ? "shadow-active" : "batched-historical";
        return JSON.stringify(value);
      })(),
      expected: "legacy origin does not name the sole provider for this lifecycle",
    },
  ];
  for (const reversion of reversions) {
    const broken = { ...valid, [reversion.key]: reversion.value };
    if (
      !violations(broken).some((failure) =>
        failure.includes(reversion.expected)
      )
    ) {
      throw new Error(`source reversion not caught: ${reversion.expected}`);
    }
  }
  console.log(
    `issue-1430 self-test PASS (${reversions.length} true-source reversions)`,
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = violations(readFiles());
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(
    "issue-1430 refund replay safety gate PASS (provider identity, dark Stripe failure, bundled authority, exact 88-name manifest)",
  );
}
