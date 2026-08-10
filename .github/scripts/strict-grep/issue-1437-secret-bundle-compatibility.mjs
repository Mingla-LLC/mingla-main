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
  payout: "supabase/functions/payout-release-sweep/index.ts",
  refunds: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  test:
    "supabase/functions/_shared/issue_1437_secret_bundle_compatibility.test.ts",
  manifest: "supabase/secrets.manifest.json",
  workflow:
    ".github/workflows/issue-1437-secret-bundle-compatibility-tests.yml",
};

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
      "if (version !== 1 && version !== 2)",
      '...(version === 2 ? ["payment_operations"] : [])',
      "export function resolvePaymentOperationFlagValue",
      "result.value.schema_version === 2",
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

  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("manifest: invalid JSON");
    manifest = {};
  }
  // [TEST-MOD-APPROVED #1770] The approved offering-invite pepper advances the
  // exact capacity baseline while remaining a standalone cryptographic secret.
  if (manifest.rollout?.expected_user_managed_count !== 87) {
    failures.push("manifest: Phase B must enforce expected count at 87");
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
      "payout_release_execute",
      "source_refunds_post_disabled",
    ]
  ) {
    if (!delivery?.bundle_fields?.some((entry) => entry.name === field)) {
      failures.push(`manifest: Phase B payment field missing: ${field}`);
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

  const workflow = files.workflow ?? "";
  for (
    const token of [
      "issue_1437_secret_bundle_compatibility.test.ts",
      "issue_1203_secret_bundles.test.ts",
      "issue_1221_source_refund_control_plane.test.ts",
      "issue_1173_onboard_dark_default.test.ts",
      "issue_1172_stripe_payout_execution.test.ts",
      "issue_1221_source_refund_safe_boundary.test.ts",
      "issue-1437-secret-bundle-compatibility.mjs --self-test",
      "issue-1437-secret-bundle-compatibility.mjs",
      "deno-version: v2.7.14",
    ]
  ) {
    requireToken(workflow, token, "blocking CI wiring", failures);
  }
  forbidToken(workflow, "continue-on-error:", "blocking CI wiring", failures);
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
        "if (version !== 1 && version !== 2)",
        "if (version !== 1)",
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
    {
      key: "workflow",
      value: `${valid.workflow}\ncontinue-on-error: true\n`,
      expected: "continue-on-error",
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
}

const files = readFiles();
if (process.argv.includes("--self-test")) selfTest();
const failures = violations(files);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("issue-1437-secret-bundle-compatibility: PASS");
