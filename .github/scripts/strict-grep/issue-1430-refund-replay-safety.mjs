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
  workflow: ".github/workflows/issue-1430-refund-replay-tests.yml",
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
  if (manifest.rollout?.expected_user_managed_count !== 85) {
    failures.push("manifest: expected user-managed count must be 85");
  }
  if (manifest.policy?.normal_ceiling !== 85) {
    failures.push("manifest: normal ceiling must remain 85");
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
  if (records.size !== 85) {
    failures.push(
      `manifest: exact record count must be 85, got ${records.size}`,
    );
  }
  if (!Array.isArray(manifest.exceptions) || manifest.exceptions.length !== 0) {
    failures.push("manifest: #1430 capacity exception must be absent");
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

  const workflow = files.workflow ?? "";
  for (
    const token of [
      '"supabase/functions/_shared/paystackRefunds.ts"',
      '"supabase/functions/_shared/sourceRefundControlPlane.ts"',
      '".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs"',
      '".github/workflows/issue-1430-refund-replay-tests.yml"',
      "issue_1430_refund_replay_happy.test.ts",
      "issue_1430_refund_replay.tester.adversarial.test.ts",
      "deno-version: v2.7.14",
      "deno test --allow-env --allow-read --allow-net=deno.land,esm.sh",
    ]
  ) {
    requireToken(workflow, token, "blocking runtime CI wiring", failures);
  }
  forbidToken(
    workflow,
    "continue-on-error:",
    "blocking runtime CI wiring",
    failures,
  );
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
        '"expected_user_managed_count": 85',
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
        '"exceptions": [],',
        '"exceptions": [{"issue":1430}],',
      ),
      expected: "#1430 capacity exception must be absent",
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
    {
      key: "workflow",
      value: valid.workflow.replaceAll(
        "issue_1430_refund_replay_happy.test.ts",
        "issue_1430_refund_replay_happy.disabled.ts",
      ),
      expected: "issue_1430_refund_replay_happy.test.ts",
    },
    {
      key: "workflow",
      value: valid.workflow.replaceAll(
        "issue_1430_refund_replay.tester.adversarial.test.ts",
        "issue_1430_refund_replay.tester.adversarial.disabled.ts",
      ),
      expected: "issue_1430_refund_replay.tester.adversarial.test.ts",
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
    "issue-1430 refund replay safety gate PASS (provider identity, dark Stripe failure, bundled authority, exact 85-name manifest)",
  );
}
