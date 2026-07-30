#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const paths = {
  paystack: "supabase/functions/_shared/paystackRefunds.ts",
  control: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  manifest: "supabase/secrets.manifest.json",
  happy:
    "supabase/functions/_shared/__tests__/issue_1430_refund_replay_happy.test.ts",
};

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
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
  requireOrder(paystack, [
    "async function resolveTransactionIdentity",
    "/transaction/verify/",
    "async function findExistingRefund",
    "transaction: String(params.transactionId)",
    "export async function reconcilePaystackRefund",
    "const identity = await resolveTransactionIdentity",
    "return await findExistingRefund",
    "export async function createPaystackRefund",
    "const existing = await reconcilePaystackRefund(params)",
    'fetch(`${PAYSTACK_BASE_URL}/refund`',
  ], "paystack verify -> numeric list -> conditional POST", failures);
  for (const token of [
    "providerTransactionId(row.transaction) === params.transactionId",
    "row.merchant_note === params.merchantNote",
    "Number(row.amount ?? NaN) === params.amountSubunits",
    "isDuplicateRefundSignal(res.status, providerCode, message)",
    "const reconciled = await reconcilePaystackRefund(params)",
    '"paystack_refund_duplicate_ambiguous"',
    "error.status === 409",
  ]) {
    requireToken(paystack, token, "paystack replay identity", failures);
  }

  const control = files.control ?? "";
  requireOrder(control, [
    "try {",
    "feeId = await proveStripeApplicationFee(client, operation)",
    "if (!isStripeFeeIdentityPermissionDenied(error)) throw error",
    '"stripe_fee_identity_permission_denied"',
    "return;",
    'if (operation.buyer_state !== "processed")',
    "stripe.refunds.create",
  ], "Stripe permission denial must return before buyer POST", failures);
  for (const token of [
    'row.type === "StripePermissionError"',
    "row.statusCode === 401",
    "row.statusCode === 403",
    '"needs_attention"',
    "0,",
    "null,",
  ]) {
    requireToken(control, token, "Stripe durable denial", failures);
  }

  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("manifest: invalid JSON");
    manifest = {};
  }
  if (manifest.rollout?.expected_user_managed_count !== 89) {
    failures.push("manifest: expected user-managed count must be 89");
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
  for (
    const [name, reader] of [
      [
        "NOTIFICATION_RECIPIENT_HMAC_SECRET",
        "supabase/functions/notify-dispatch/index.ts",
      ],
      [
        "PAYOUT_HOLD_ONBOARD_FLIP",
        "supabase/functions/brand-stripe-onboard/index.ts",
      ],
      [
        "PAYOUT_RELEASE_EXECUTE",
        "supabase/functions/payout-release-sweep/index.ts",
      ],
      [
        "SOURCE_REFUNDS_POST_DISABLED",
        "supabase/functions/_shared/sourceRefundControlPlane.ts",
      ],
    ]
  ) {
    const record = records.get(name);
    if (!record || !record.readers?.includes(reader)) {
      failures.push(`manifest: ${name} exact reader metadata missing`);
    }
  }
  if (records.size !== 89) {
    failures.push(`manifest: exact record count must be 89, got ${records.size}`);
  }
  const activeException = (manifest.exceptions ?? []).filter((exception) =>
    exception.issue === 1430 &&
    exception.owner === "Platform Engineering" &&
    exception.approved_by === "sethogieva" &&
    typeof exception.expires_at === "string"
  );
  if (activeException.length !== 1 || manifest.exceptions?.length !== 1) {
    failures.push("manifest: exact #1430 bounded exception missing");
  }

  const happy = files.happy ?? "";
  for (const token of [
    "replays without a second POST",
    "duplicate ambiguity reconciles exact identity",
    "mismatched duplicate remains retryable ambiguity",
    "identity mismatch fails before refund reconciliation or POST",
    "null fee identity proves the connected-account chain",
    "permission denial records a safe fee state before any buyer refund POST",
  ]) {
    requireToken(happy, token, "runtime regression guard", failures);
  }
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
        "const reconciled = await reconcilePaystackRefund(params)",
        "const reconciled = null",
      ),
      expected: "const reconciled = await reconcilePaystackRefund(params)",
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
        '"expected_user_managed_count": 89',
        '"expected_user_managed_count": 85',
      ),
      expected: "expected user-managed count",
    },
    {
      key: "manifest",
      value: valid.manifest.replace(
        '"name":"SOURCE_REFUNDS_POST_DISABLED"',
        '"name":"SOURCE_REFUNDS_POST_ENABLED"',
      ),
      expected: "SOURCE_REFUNDS_POST_DISABLED",
    },
    {
      key: "happy",
      value: valid.happy.replace(
        "replays without a second POST",
        "replays after another POST",
      ),
      expected: "replays without a second POST",
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
    "issue-1430 refund replay safety gate PASS (provider identity, dark Stripe failure, exact 89-name manifest)",
  );
}
