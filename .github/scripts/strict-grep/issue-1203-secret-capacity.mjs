#!/usr/bin/env node
/**
 * Issue #1203 — secret bundles remain bounded and audits remain value-blind.
 * Exit 0 clean, 1 violation, 2 inconclusive. Includes synthetic self-tests.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME_CONFIG = "supabase/functions/_shared/runtimeConfig.ts";
const AUDIT = "scripts/secrets/audit-supabase-secret-budget.mjs";
const MANIFEST = "supabase/secrets.manifest.json";
const CLIENT_ROOTS = ["app-mobile/", "mingla-business/", "mingla-admin/"];
const BACKEND_ROOT = "supabase/functions/";
const FORBIDDEN_DIRECT_PAYSTACK_CONTROL =
  "PAYSTACK_PAYOUT_HOLD_ONBOARD_FLIP";

const APPROVED_RUNTIME_FIELDS = [
  "bunny_storage_cap_bytes",
  "bunny_traffic_cap_bytes",
  "content_share_v1_create_enabled",
  "event_cover_video_provider",
  "google_ads_api_version",
  "meta_api_version",
  "mingla_footer_address",
  "mingla_logo_url",
  // #1840 — NG payout float forecast horizon. Bounded operational tunable, not
  // a credential; it rides the EXISTING runtime-config bundle so the 87-secret
  // budget is unchanged.
  "ng_payout_float_horizon_days",
  "offering_invite_sms_price_book_v1",
  "termii_base_url",
];
const BUNDLE_NAMES = [
  "MINGLA_PAYMENT_MODES_JSON",
  "MINGLA_EMAIL_SENDERS_JSON",
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_ALERT_RECIPIENTS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
];
const FORBIDDEN_RUNTIME_WORDS = [
  "token",
  "secret",
  "api_key",
  "account_id",
  "origin",
  "sender_id",
  "app_id",
  "webhook",
  "private_key",
];
const FIELD_LEGACY_MAPPINGS = [
  ["stripe_mode", "MINGLA_STRIPE_MODE"],
  ["paystack_mode", "PAYSTACK_MODE"],
  ["admin_from", "RESEND_ADMIN_FROM"],
  ["system_from", "RESEND_SYSTEM_FROM"],
  ["ticket_from", "RESEND_TICKET_FROM"],
  ["marketing_send_live_enabled", "MARKETING_SEND_LIVE_ENABLED"],
  ["sms_live_enabled.ng", "SMS_LIVE_ENABLED_NG"],
  ["sms_live_enabled.us", "SMS_LIVE_ENABLED_US"],
  ["payout_hold_onboard_flip", "PAYOUT_HOLD_ONBOARD_FLIP"],
  ["payout_release_execute", "PAYOUT_RELEASE_EXECUTE"],
  ["source_refunds_post_disabled", "SOURCE_REFUNDS_POST_DISABLED"],
  ["api_health", "API_HEALTH_ALERT_EMAILS"],
  ["stripe_disputes", "STRIPE_DISPUTE_ALERT_EMAILS"],
  ["stripe_webhook_failures", "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS"],
  ["bunny_storage_cap_bytes", "BUNNY_STORAGE_CAP_BYTES"],
  ["bunny_traffic_cap_bytes", "BUNNY_TRAFFIC_CAP_BYTES"],
  ["content_share_v1_create_enabled", "CONTENT_SHARE_V1_CREATE_ENABLED"],
  ["event_cover_video_provider", "EVENT_COVER_VIDEO_PROVIDER"],
  ["google_ads_api_version", "GOOGLE_ADS_API_VERSION"],
  ["meta_api_version", "META_API_VERSION"],
  ["mingla_footer_address", "MINGLA_FOOTER_ADDRESS"],
  ["mingla_logo_url", "MINGLA_LOGO_URL"],
  ["termii_base_url", "TERMII_BASE_URL"],
];
const CONSUMER_CONTRACTS = [
  ["supabase/functions/_shared/stripeMode.ts", "resolvePaymentModeValue"],
  ["supabase/functions/_shared/paystack.ts", "resolvePaymentModeValue"],
  ["supabase/functions/_shared/email/senders.ts", "resolveEmailSenderValue"],
  ["supabase/functions/marketing-send/index.ts", "resolveDeliveryFlagValue"],
  ["supabase/functions/_shared/adapters/smsAdapter.ts", "resolveDeliveryFlagValue"],
  ["supabase/functions/brand-stripe-onboard/index.ts", "resolvePaymentOperationFlagValue"],
  ["supabase/functions/brand-paystack-onboard/index.ts", "resolvePaystackPayoutHoldOnboardFlip"],
  ["supabase/functions/payout-release-sweep/index.ts", "resolvePaymentOperationFlagValue"],
  ["supabase/functions/_shared/sourceRefundControlPlane.ts", "resolvePaymentOperationFlagValue"],
  ["supabase/functions/api-health-probe/index.ts", "resolveAlertRecipientValue"],
  ["supabase/functions/_shared/stripeDisputeHandlers.ts", "resolveAlertRecipientValue"],
  ["supabase/functions/stripe-webhook/index.ts", "resolveAlertRecipientValue"],
  ["supabase/functions/_shared/adCreative.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/brandAssets.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/google.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/meta.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/metaCapi.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/email/index.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/email/experienceConfirmationEmail.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/email/tripConfirmationEmail.ts", "resolveRuntimeString"],
  ["supabase/functions/_shared/marketingEmailRender.ts", "resolveRuntimeString"],
  ["supabase/functions/event-cover-video-upload-intent/index.ts", "resolveRuntimeNumber"],
  ["supabase/functions/careers-apply/index.ts", "resolveRuntimeString"],
  ["supabase/functions/growth-tools-book/index.ts", "resolveRuntimeString"],
  ["supabase/functions/growth-tools-gate/index.ts", "resolveRuntimeString"],
  ["supabase/functions/invite-brand-member/index.ts", "resolveRuntimeString"],
  ["supabase/functions/partner-reissue-invitation/index.ts", "resolveRuntimeString"],
  ["supabase/functions/shared-card/index.ts", "resolveRuntimeBoolean"],
];

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

export function check({
  runtimeSource,
  auditSource,
  manifestText,
  clientFiles,
  backendFiles = [],
}) {
  const violations = [];
  const fieldMatch = runtimeSource.match(
    /RUNTIME_CONFIG_FIELDS:[^=]*=\s*\[([\s\S]*?)\];/,
  );
  if (!fieldMatch) {
    violations.push(`${RUNTIME_CONFIG}:approved_field_list_missing`);
  } else {
    const fields = [...fieldMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (JSON.stringify(fields) !== JSON.stringify(APPROVED_RUNTIME_FIELDS)) {
      violations.push(`${RUNTIME_CONFIG}:approved_field_list_changed`);
    }
    for (const field of fields) {
      if (FORBIDDEN_RUNTIME_WORDS.some((word) => field.includes(word))) {
        violations.push(`${RUNTIME_CONFIG}:forbidden_field_class`);
      }
    }
  }
  if (!auditSource.includes('stdio: ["ignore", "pipe", "pipe"]')) {
    violations.push(`${AUDIT}:raw_cli_output_not_captured`);
  }
  if (
    /console\.(?:log|error|warn)\s*\(\s*(?:result\.)?(?:stdout|stderr)\b/.test(auditSource) ||
    /stdio\s*:\s*["']inherit["']/.test(auditSource)
  ) {
    violations.push(`${AUDIT}:raw_cli_output_may_escape`);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    violations.push(`${MANIFEST}:invalid_json`);
  }
  if (manifest) {
    const names = manifest.secrets?.map((record) => record.name) ?? [];
    // [TEST-MOD-APPROVED #2830] Founder-approved slot 88 is a bounded
    // credential envelope protected by the unchanged 87/90 capacity policy.
    if (names.length !== 88 || new Set(names).size !== 88) {
      violations.push(`${MANIFEST}:target_must_be_88_unique_names`);
    }
    if (names.includes(FORBIDDEN_DIRECT_PAYSTACK_CONTROL)) {
      violations.push(`${MANIFEST}:standalone_paystack_control_forbidden`);
    }
    const deliveryBundle = manifest.secrets?.find((record) =>
      record.name === "MINGLA_DELIVERY_FLAGS_JSON"
    );
    const paystackOnboardField = deliveryBundle?.bundle_fields?.find((field) =>
      field.name === "paystack_payout_hold_onboard_flip"
    );
    if (
      paystackOnboardField?.owner !== "Payments Engineering" ||
      paystackOnboardField?.source_type !== "operating_record"
    ) {
      violations.push(`${MANIFEST}:paystack_onboard_bundle_field_invalid`);
    }
    const offeringPepper = manifest.secrets?.find((record) =>
      record.name === "OFFERING_INVITE_TOKEN_PEPPER"
    );
    if (
      offeringPepper?.class !== "cryptographic_secret" ||
      offeringPepper?.owner !== "Platform Security" ||
      offeringPepper?.source_type !== "secure_vault" ||
      offeringPepper?.issue !== 1770 ||
      JSON.stringify(offeringPepper?.readers) !== JSON.stringify([
        "supabase/functions/_shared/offeringInviteToken.ts",
        "supabase/functions/marketing-send/index.ts",
        "supabase/functions/offering-invite-dispatch/index.ts",
      ])
    ) {
      violations.push(`${MANIFEST}:offering_invite_token_pepper_contract_invalid`);
    }
    const runtimeConfig = manifest.secrets?.find((record) =>
      record.name === "MINGLA_RUNTIME_CONFIG_JSON"
    );
    const contentShareField = runtimeConfig?.bundle_fields?.find((field) =>
      field.name === "content_share_v1_create_enabled"
    );
    if (
      contentShareField?.owner !== "Platform Engineering" ||
      contentShareField?.source_type !== "approved_feature_operating_record"
    ) {
      violations.push(`${MANIFEST}:content_share_runtime_field_contract_invalid`);
    }
    const serializedKeys = [];
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        serializedKeys.push(key.toLowerCase());
        walk(child);
      }
    };
    walk(manifest);
    for (const key of ["value", "digest", "hash", "fingerprint", "raw"]) {
      if (serializedKeys.includes(key)) violations.push(`${MANIFEST}:forbidden_${key}_key`);
    }
  }
  for (const file of clientFiles) {
    for (const name of BUNDLE_NAMES) {
      if (file.text.includes(name)) violations.push(`${file.path}:client_bundle_exposure:${name}`);
    }
  }
  if (backendFiles.length > 0) {
    const byPath = new Map(backendFiles.map((file) => [file.path, file.text]));
    const productionFiles = backendFiles.filter((file) =>
      !file.path.includes(".test.") && !file.path.includes("/__tests__/")
    );
    const compactBackend = productionFiles.map((file) =>
      file.text.replace(/\s+/g, "")
    ).join("\n");
    for (const [field, legacy] of FIELD_LEGACY_MAPPINGS) {
      const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        !new RegExp(`${escapedField}.{0,80}"${legacy}"`).test(compactBackend) &&
        !new RegExp(`"${legacy}".{0,80}${escapedField}`).test(compactBackend)
      ) {
        violations.push(`${BACKEND_ROOT}:mapping_missing:${field}:${legacy}`);
      }
      const directRead = `Deno.env.get("${legacy}")`;
      for (const file of productionFiles) {
        if (executableSource(file.text).includes(directRead)) {
          violations.push(`${file.path}:legacy_direct_read:${legacy}`);
        }
      }
    }
    for (const file of productionFiles) {
      if (
        executableSource(file.text).includes(
          `Deno.env.get("${FORBIDDEN_DIRECT_PAYSTACK_CONTROL}")`,
        )
      ) {
        violations.push(`${file.path}:standalone_paystack_control_forbidden`);
      }
    }
    for (const [path, resolver] of CONSUMER_CONTRACTS) {
      const source = byPath.get(path);
      const occurrences = source?.split(resolver).length ?? 0;
      if (!source || occurrences < 3) {
        violations.push(`${path}:migrated_consumer_missing:${resolver}`);
      }
    }
    const sharedCard = executableSource(
      byPath.get("supabase/functions/shared-card/index.ts") ?? "",
    );
    const contentGate = sharedCard.indexOf("resolveRuntimeBoolean(");
    const contentCreate = sharedCard.indexOf("await createContentShareV1(");
    if (contentGate < 0 || contentCreate < 0 || contentGate > contentCreate) {
      violations.push(
        "supabase/functions/shared-card/index.ts:content_share_gate_must_precede_create",
      );
    }
  }
  return violations;
}

function selfTest() {
  const backendFiles = [
    {
      path: "supabase/functions/_shared/syntheticMappings.ts",
      text: FIELD_LEGACY_MAPPINGS.map(([field, legacy]) =>
        `map("${field}","${legacy}");`
      ).join("\n"),
    },
    ...CONSUMER_CONTRACTS.map(([path, resolver]) => ({
      path,
      text: path === "supabase/functions/shared-card/index.ts"
        ? `import { ${resolver} } from "./resolver.ts"; if (!${resolver}()) return; await createContentShareV1();`
        : `import { ${resolver} } from "./resolver.ts"; ${resolver}();`,
    })),
  ];
  const clean = {
    runtimeSource:
      `export const RUNTIME_CONFIG_FIELDS: readonly string[] = [${
        APPROVED_RUNTIME_FIELDS.map((field) => `"${field}"`).join(",")
      }];`,
    auditSource: 'spawnSync("supabase", [], { stdio: ["ignore", "pipe", "pipe"] });',
    manifestText: JSON.stringify({
      secrets: [
        {
          name: "MINGLA_RUNTIME_CONFIG_JSON",
          bundle_fields: [{
            name: "content_share_v1_create_enabled",
            owner: "Platform Engineering",
            source_type: "approved_feature_operating_record",
          }],
        },
        {
          name: "MINGLA_DELIVERY_FLAGS_JSON",
          bundle_fields: [{
            name: "paystack_payout_hold_onboard_flip",
            owner: "Payments Engineering",
            source_type: "operating_record",
          }],
        },
        {
          name: "OFFERING_INVITE_TOKEN_PEPPER",
          class: "cryptographic_secret",
          owner: "Platform Security",
          source_type: "secure_vault",
          issue: 1770,
          readers: [
            "supabase/functions/_shared/offeringInviteToken.ts",
            "supabase/functions/marketing-send/index.ts",
            "supabase/functions/offering-invite-dispatch/index.ts",
          ],
        },
        ...Array.from({ length: 85 }, (_, index) => ({ name: `SYNTH_${index}` })),
      ],
    }),
    clientFiles: [{ path: "app-mobile/src/ok.ts", text: "export const ok = true;" }],
    backendFiles,
  };
  if (check(clean).length !== 0) throw new Error("clean_fixture_failed");
  if (
    check({
      ...clean,
      runtimeSource:
        'export const RUNTIME_CONFIG_FIELDS: readonly string[] = ["api_key"];',
    }).length === 0
  ) throw new Error("credential_field_fixture_passed");
  if (
    check({
      ...clean,
      auditSource: 'spawnSync("supabase", [], { stdio: "inherit" });',
    }).length === 0
  ) throw new Error("raw_output_fixture_passed");
  if (
    check({
      ...clean,
      clientFiles: [{ path: "app-mobile/src/bad.ts", text: BUNDLE_NAMES[0] }],
    }).length === 0
  ) throw new Error("client_exposure_fixture_passed");
  if (
    check({
      ...clean,
      backendFiles: backendFiles.map((file) => ({
        ...file,
        text: file.text.replace('"stripe_mode","MINGLA_STRIPE_MODE"', '"stripe_mode","WRONG"'),
      })),
    }).every((violation) => !violation.includes("mapping_missing:stripe_mode"))
  ) throw new Error("mapping_regression_fixture_passed");
  if (
    check({
      ...clean,
      backendFiles: backendFiles.map((file) =>
        file.path === CONSUMER_CONTRACTS[0][0]
          ? { ...file, text: "export const reverted = true;" }
          : file
      ),
    }).every((violation) => !violation.includes("migrated_consumer_missing"))
  ) throw new Error("consumer_regression_fixture_passed");
  const manifestWithoutContentField = JSON.parse(clean.manifestText);
  manifestWithoutContentField.secrets.find((record) =>
    record.name === "MINGLA_RUNTIME_CONFIG_JSON"
  ).bundle_fields = [];
  if (
    check({
      ...clean,
      manifestText: JSON.stringify(manifestWithoutContentField),
    }).every((violation) =>
      !violation.includes("content_share_runtime_field_contract_invalid")
    )
  ) throw new Error("content_share_manifest_regression_fixture_passed");
  if (
    check({
      ...clean,
      backendFiles: [
        ...backendFiles,
        {
          path: "supabase/functions/commentedSentinel.ts",
          text: '// Deno.env.get("PAYOUT_RELEASE_EXECUTE")',
        },
      ],
    }).length !== 0
  ) throw new Error("commented_direct_reader_fixture_failed");
  if (
    check({
      ...clean,
      backendFiles: [
        ...backendFiles,
        {
          path: "supabase/functions/activeDirectReader.ts",
          text: 'Deno.env.get("PAYOUT_RELEASE_EXECUTE")',
        },
      ],
    }).every((violation) => !violation.includes("legacy_direct_read"))
  ) throw new Error("active_direct_reader_fixture_passed");
  if (
    check({
      ...clean,
      backendFiles: [
        ...backendFiles,
        {
          path: "supabase/functions/activePaystackDirectReader.ts",
          text: `Deno.env.get("${FORBIDDEN_DIRECT_PAYSTACK_CONTROL}")`,
        },
      ],
    }).every((violation) =>
      !violation.includes("standalone_paystack_control_forbidden")
    )
  ) throw new Error("paystack_direct_reader_fixture_passed");
  console.log("issue-1203 secret-capacity self-test OK (10/10 cases).");
}

function trackedClientFiles() {
  const paths = execFileSync("git", ["ls-files", ...CLIENT_ROOTS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).split("\n").filter(Boolean);
  return paths.filter((path) => /\.(?:ts|tsx|js|jsx|json|mjs|cjs)$/.test(path)).map((path) => ({
    path,
    text: readFileSync(resolve(REPO_ROOT, path), "utf8"),
  }));
}

function trackedBackendFiles() {
  const paths = execFileSync("git", ["ls-files", BACKEND_ROOT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).split("\n").filter(Boolean);
  return paths.filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path)).map((path) => ({
    path,
    text: readFileSync(resolve(REPO_ROOT, path), "utf8"),
  }));
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  let clientFiles;
  try {
    clientFiles = await trackedClientFiles();
  } catch (error) {
    console.error("issue-1203 secret-capacity: client scan failed", error.message);
    process.exit(2);
  }
  const violations = check({
    runtimeSource: readFileSync(resolve(REPO_ROOT, RUNTIME_CONFIG), "utf8"),
    auditSource: readFileSync(resolve(REPO_ROOT, AUDIT), "utf8"),
    manifestText: readFileSync(resolve(REPO_ROOT, MANIFEST), "utf8"),
    clientFiles,
    backendFiles: trackedBackendFiles(),
  });
  if (violations.length > 0) {
    violations.forEach((violation) =>
      console.error(`::error title=Issue 1203 secret capacity::${violation}`)
    );
    process.exit(1);
  }
  console.log("issue-1203 secret-capacity guard PASS.");
}

await main();
