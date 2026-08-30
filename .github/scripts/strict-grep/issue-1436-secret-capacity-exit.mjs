#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const paths = {
  manifest: "supabase/secrets.manifest.json",
  capacity: ".github/scripts/strict-grep/issue-1203-secret-capacity.mjs",
  refund: ".github/scripts/strict-grep/issue-1430-refund-replay-safety.mjs",
  runbook: "docs/runbooks/SUPABASE_SECRET_CAPACITY.md",
  invariant: "docs/INVARIANT_REGISTRY.md",
  test: "scripts/secrets/issue_1436_secret_capacity_exit.test.mjs",
  adversarialTest:
    "scripts/secrets/issue_1436_secret_capacity_exit.adversarial.test.mjs",
  workflow: ".github/workflows/supabase-secret-budget.yml",
};

const retiredDirectNames = [
  "CONTENT_SHARE_V1_CREATE_ENABLED",
  "NOTIFICATION_RECIPIENT_HMAC_SECRET",
  "PAYOUT_HOLD_ONBOARD_FLIP",
  "PAYOUT_RELEASE_EXECUTE",
  "SOURCE_REFUNDS_POST_DISABLED",
];
const paymentFields = [
  "payout_hold_onboard_flip",
  "payout_release_execute",
  "source_refunds_post_disabled",
];
const sitesFieldNames = [
  "schema_version",
  "core_to_cms_current_kid",
  "core_to_cms_current_key_b64",
  "core_to_cms_previous_kid",
  "core_to_cms_previous_key_b64",
  "cms_to_core_current_kid",
  "cms_to_core_current_key_b64",
  "cms_to_core_previous_kid",
  "cms_to_core_previous_key_b64",
  "runtime_to_core_current_kid",
  "runtime_to_core_current_key_b64",
  "runtime_to_core_previous_kid",
  "runtime_to_core_previous_key_b64",
  "attribution_pepper_b64",
];
const sitesException = {
  issue: 2830,
  owner: "Platform Security",
  approved_by: "Seth Ogieva (@sethogieva)",
  approved_at: "2026-08-30T03:40:33Z",
  first_set_not_before: "2026-08-30T03:40:33Z",
  next_review_at: "2026-09-29T03:40:33Z",
  expires_at: "2026-11-28T03:40:33Z",
  primary_owner_ack: "Platform Security, founder-approved",
  backup_owner_ack: "Platform Engineering, founder-approved",
};

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

export function violations(files) {
  const failures = [];
  let manifest;
  try {
    manifest = JSON.parse(files.manifest ?? "");
  } catch {
    failures.push("manifest: invalid JSON");
    return failures;
  }

  const records = new Map(
    (manifest.secrets ?? []).map((entry) => [entry.name, entry]),
  );
  if (
    manifest.rollout?.live_audit_mode !== "enforced" ||
    manifest.rollout?.transition_stage !== "complete" ||
    manifest.rollout?.expected_user_managed_count !== 88
  ) {
    failures.push("manifest: final enforced 88-name rollout missing");
  }
  if (
    manifest.policy?.normal_ceiling !== 87 ||
    manifest.policy?.absolute_ceiling !== 90
  ) {
    failures.push("manifest: 87/90 policy changed");
  }
  if (records.size !== 88 || manifest.secrets?.length !== 88) {
    failures.push("manifest: exactly 88 unique records required");
  }
  if (
    !Array.isArray(manifest.exceptions) || manifest.exceptions.length !== 1 ||
    JSON.stringify(manifest.exceptions[0]) !== JSON.stringify(sitesException)
  ) {
    failures.push("manifest: exact founder-approved #2830 slot-88 exception missing");
  }
  for (const name of retiredDirectNames) {
    if (records.has(name)) {
      failures.push(`manifest: retired direct name present: ${name}`);
    }
  }

  const delivery = records.get("MINGLA_DELIVERY_FLAGS_JSON");
  const deliveryFields = new Set(
    delivery?.bundle_fields?.map((entry) => entry.name) ?? [],
  );
  for (const field of paymentFields) {
    if (!deliveryFields.has(field)) {
      failures.push(`manifest: delivery v2 field missing: ${field}`);
    }
  }
  for (
    const reader of [
      "supabase/functions/_shared/secretBundle.ts",
      "supabase/functions/_shared/sourceRefundControlPlane.ts",
      "supabase/functions/brand-stripe-onboard/index.ts",
      "supabase/functions/payout-release-sweep/index.ts",
    ]
  ) {
    if (!delivery?.readers?.includes(reader)) {
      failures.push(`manifest: delivery reader missing: ${reader}`);
    }
  }

  const offeringPepper = records.get("OFFERING_INVITE_TOKEN_PEPPER");
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
    failures.push("manifest: offering invite token pepper contract missing");
  }

  const runtimeConfig = records.get("MINGLA_RUNTIME_CONFIG_JSON");
  if (
    !runtimeConfig?.bundle_fields?.some((entry) =>
      entry.name === "content_share_v1_create_enabled" &&
      entry.owner === "Platform Engineering" &&
      entry.source_type === "approved_feature_operating_record"
    )
  ) {
    failures.push("manifest: content-share runtime field missing");
  }

  const sitesSecurity = records.get("MINGLA_SITES_SECURITY_JSON");
  if (
    sitesSecurity?.class !== "credential_bundle" ||
    sitesSecurity?.owner !== "Platform Security" ||
    sitesSecurity?.backup_owner !== "Platform Engineering" ||
    sitesSecurity?.source_type !== "secure_vault" ||
    sitesSecurity?.rotation_or_review_days !== 30 ||
    sitesSecurity?.expires_at !== sitesException.expires_at ||
    sitesSecurity?.issue !== 2830 ||
    JSON.stringify(sitesSecurity?.readers) !== JSON.stringify([
      "supabase/functions/_shared/sitesSecurity.ts",
    ]) ||
    JSON.stringify(sitesSecurity?.bundle_fields?.map((entry) => entry.name)) !==
      JSON.stringify(sitesFieldNames)
  ) {
    failures.push("manifest: exact MINGLA_SITES_SECURITY_JSON slot-88 contract missing");
  }

  const conversion = records.get("AD_CONVERSION_TOKENS");
  if (
    !conversion?.bundle_fields?.some((entry) =>
      entry.name === "NOTIFICATION_RECIPIENT_HMAC_SECRET" &&
      entry.owner === "Messaging Engineering" &&
      entry.source_type === "secure_vault"
    )
  ) {
    failures.push("manifest: notification HMAC bundle field missing");
  }
  for (
    const reader of [
      "supabase/functions/_shared/notificationRecipientHmac.ts",
      "supabase/functions/notify-dispatch/index.ts",
    ]
  ) {
    if (!conversion?.readers?.includes(reader)) {
      failures.push(`manifest: notification HMAC reader missing: ${reader}`);
    }
  }

  for (const [token, label] of [
    ["target_must_be_88_unique_names", "capacity gate"],
    ['["content_share_v1_create_enabled", "CONTENT_SHARE_V1_CREATE_ENABLED"]', "capacity gate"],
    ['["payout_hold_onboard_flip", "PAYOUT_HOLD_ONBOARD_FLIP"]', "capacity gate"],
    ['["payout_release_execute", "PAYOUT_RELEASE_EXECUTE"]', "capacity gate"],
    ['["source_refunds_post_disabled", "SOURCE_REFUNDS_POST_DISABLED"]', "capacity gate"],
  ]) {
    requireToken(files.capacity ?? "", token, label, failures);
  }
  for (const token of [
    "retired direct compatibility name present",
    "bundled payment authority missing",
    "bundled notification HMAC authority missing",
    "exact 88-name manifest",
  ]) {
    requireToken(files.refund ?? "", token, "refund guard", failures);
  }
  for (const token of [
    "schema v2",
    "NOTIFICATION_RECIPIENT_HMAC_SECRET",
    "SOURCE_REFUNDS_POST_DISABLED",
    "PAYOUT_RELEASE_EXECUTE",
    "PAYOUT_HOLD_ONBOARD_FLIP",
    "exactly 88",
    "content_share_v1_create_enabled",
    "CONTENT_SHARE_V1_CREATE_ENABLED",
  ]) {
    requireToken(files.runbook ?? "", token, "capacity runbook", failures);
  }
  requireToken(
    files.invariant ?? "",
    "I-PROPOSED-1436-SECRET-CAPACITY-EXIT (ACTIVE)",
    "invariant registry",
    failures,
  );
  for (const token of [
    "scripts/secrets/issue_1436_*.test.mjs",
    "supabase/functions/_shared/issue_1437_*.test.ts",
    "issue-1436-secret-capacity-exit.mjs --self-test",
    "issue-1436-secret-capacity-exit.mjs",
  ]) {
    requireToken(files.workflow ?? "", token, "blocking workflow", failures);
  }
  requireToken(
    files.test ?? "",
    "any retired direct-name return fails closed",
    "final-state regression test",
    failures,
  );
  requireToken(
    files.adversarialTest ?? "",
    "same-count direct-name substitution cannot bypass exact-set parity",
    "tester adversarial regression test",
    failures,
  );
  if ((files.workflow ?? "").includes("continue-on-error:")) {
    failures.push("blocking workflow: continue-on-error forbidden");
  }
  const hmacReaders = (files.productionSources ?? []).filter(({ source }) =>
    source.includes("resolveNotificationRecipientHmacSecret")
  );
  const readerPaths = hmacReaders.map(({ path: sourcePath }) => sourcePath)
    .sort();
  if (
    JSON.stringify(readerPaths) !== JSON.stringify([
      "supabase/functions/_shared/notificationRecipientHmac.ts",
      "supabase/functions/notify-dispatch/index.ts",
    ])
  ) {
    failures.push("notification HMAC: second reader or missing canonical reader");
  }
  for (const { path: sourcePath, source } of files.productionSources ?? []) {
    if (
      sourcePath !== "supabase/functions/_shared/runtimeConfig.ts" &&
      source.includes('Deno.env.get("CONTENT_SHARE_V1_CREATE_ENABLED")')
    ) {
      failures.push(`content share: retired direct reader forbidden: ${sourcePath}`);
    }
    if (
      sourcePath !==
        "supabase/functions/_shared/notificationRecipientHmac.ts" &&
      source.includes("NOTIFICATION_RECIPIENT_HMAC_SECRET")
    ) {
      failures.push(`notification HMAC: direct/oracle source forbidden: ${sourcePath}`);
    }
  }
  return failures;
}

function productionSources() {
  const base = path.join(root, "supabase/functions");
  const rows = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(absolute);
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.includes(".test.") &&
        !entry.name.includes(".adversarial.")
      ) {
        const source = fs.readFileSync(absolute, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        rows.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          source,
        });
      }
    }
  };
  walk(base);
  return rows;
}

function readFiles() {
  return {
    ...Object.fromEntries(
    Object.entries(paths).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
    ),
    productionSources: productionSources(),
  };
}

function fixtureManifest() {
  const filler = Array.from({ length: 83 }, (_, index) => ({
    name: `SAFE_${String(index).padStart(2, "0")}`,
    readers: [],
    bundle_fields: [],
  }));
  return {
    policy: { normal_ceiling: 87, absolute_ceiling: 90 },
    rollout: {
      live_audit_mode: "enforced",
      transition_stage: "complete",
      expected_user_managed_count: 88,
    },
    exceptions: [sitesException],
    secrets: [
      {
        name: "AD_CONVERSION_TOKENS",
        readers: [
          "supabase/functions/_shared/notificationRecipientHmac.ts",
          "supabase/functions/notify-dispatch/index.ts",
        ],
        bundle_fields: [{
          name: "NOTIFICATION_RECIPIENT_HMAC_SECRET",
          owner: "Messaging Engineering",
          source_type: "secure_vault",
        }],
      },
      {
        name: "MINGLA_DELIVERY_FLAGS_JSON",
        readers: [
          "supabase/functions/_shared/secretBundle.ts",
          "supabase/functions/_shared/sourceRefundControlPlane.ts",
          "supabase/functions/brand-stripe-onboard/index.ts",
          "supabase/functions/payout-release-sweep/index.ts",
        ],
        bundle_fields: paymentFields.map((name) => ({ name })),
      },
      {
        name: "MINGLA_RUNTIME_CONFIG_JSON",
        readers: ["supabase/functions/_shared/runtimeConfig.ts"],
        bundle_fields: [{
          name: "content_share_v1_create_enabled",
          owner: "Platform Engineering",
          source_type: "approved_feature_operating_record",
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
        bundle_fields: [],
      },
      {
        name: "MINGLA_SITES_SECURITY_JSON",
        class: "credential_bundle",
        owner: "Platform Security",
        backup_owner: "Platform Engineering",
        source_type: "secure_vault",
        rotation_or_review_days: 30,
        expires_at: sitesException.expires_at,
        issue: 2830,
        readers: ["supabase/functions/_shared/sitesSecurity.ts"],
        bundle_fields: sitesFieldNames.map((name) => ({ name })),
      },
      ...filler,
    ],
  };
}

function selfTest() {
  const clean = {
    manifest: JSON.stringify(fixtureManifest()),
    capacity:
      'target_must_be_88_unique_names; ["content_share_v1_create_enabled", "CONTENT_SHARE_V1_CREATE_ENABLED"]; ["payout_hold_onboard_flip", "PAYOUT_HOLD_ONBOARD_FLIP"]; ["payout_release_execute", "PAYOUT_RELEASE_EXECUTE"]; ["source_refunds_post_disabled", "SOURCE_REFUNDS_POST_DISABLED"]',
    refund:
      "retired direct compatibility name present; bundled payment authority missing; bundled notification HMAC authority missing; exact 88-name manifest",
    runbook:
      "schema v2 NOTIFICATION_RECIPIENT_HMAC_SECRET SOURCE_REFUNDS_POST_DISABLED PAYOUT_RELEASE_EXECUTE PAYOUT_HOLD_ONBOARD_FLIP exactly 88 content_share_v1_create_enabled CONTENT_SHARE_V1_CREATE_ENABLED",
    invariant: "I-PROPOSED-1436-SECRET-CAPACITY-EXIT (ACTIVE)",
    test: "any retired direct-name return fails closed",
    adversarialTest:
      "same-count direct-name substitution cannot bypass exact-set parity",
    workflow:
      "scripts/secrets/issue_1436_*.test.mjs supabase/functions/_shared/issue_1437_*.test.ts issue-1436-secret-capacity-exit.mjs --self-test issue-1436-secret-capacity-exit.mjs",
    productionSources: [
      {
        path: "supabase/functions/_shared/notificationRecipientHmac.ts",
        source:
          'export function resolveNotificationRecipientHmacSecret() { return "private"; } const FIELD_NAME = "NOTIFICATION_RECIPIENT_HMAC_SECRET";',
      },
      {
        path: "supabase/functions/notify-dispatch/index.ts",
        source:
          'import { resolveNotificationRecipientHmacSecret } from "../_shared/notificationRecipientHmac.ts"; resolveNotificationRecipientHmacSecret();',
      },
    ],
  };
  if (violations(clean).length !== 0) throw new Error("clean fixture failed");

  const reversions = [
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        rollout: {
          ...fixtureManifest().rollout,
          expected_user_managed_count: 89,
        },
      }),
      expected: "final enforced 88-name rollout missing",
    },
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        exceptions: [{ issue: 1430 }],
      }),
      expected: "exact founder-approved #2830 slot-88 exception missing",
    },
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        secrets: [
          ...fixtureManifest().secrets.slice(0, -1),
          { name: "SOURCE_REFUNDS_POST_DISABLED" },
        ],
      }),
      expected: "retired direct name present",
    },
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        secrets: fixtureManifest().secrets.map((entry) =>
          entry.name === "MINGLA_DELIVERY_FLAGS_JSON"
            ? {
              ...entry,
              bundle_fields: entry.bundle_fields.filter((field) =>
                field.name !== "source_refunds_post_disabled"
              ),
            }
            : entry
        ),
      }),
      expected: "delivery v2 field missing",
    },
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        secrets: fixtureManifest().secrets.map((entry) =>
          entry.name === "AD_CONVERSION_TOKENS"
            ? { ...entry, bundle_fields: [] }
            : entry
        ),
      }),
      expected: "notification HMAC bundle field missing",
    },
    {
      key: "manifest",
      value: JSON.stringify({
        ...fixtureManifest(),
        secrets: fixtureManifest().secrets.map((entry) =>
          entry.name === "MINGLA_RUNTIME_CONFIG_JSON"
            ? { ...entry, bundle_fields: [] }
            : entry
        ),
      }),
      expected: "content-share runtime field missing",
    },
    {
      key: "workflow",
      value: `${clean.workflow}\ncontinue-on-error: true`,
      expected: "continue-on-error forbidden",
    },
    {
      key: "productionSources",
      value: [
        ...clean.productionSources,
        {
          path: "supabase/functions/shared-card/index.ts",
          source: 'Deno.env.get("CONTENT_SHARE_V1_CREATE_ENABLED")',
        },
      ],
      expected: "retired direct reader forbidden",
    },
    {
      key: "productionSources",
      value: [
        ...clean.productionSources,
        {
          path: "supabase/functions/leak-secret/index.ts",
          source:
            'Deno.env.get("NOTIFICATION_RECIPIENT_HMAC_SECRET"); resolveNotificationRecipientHmacSecret();',
        },
      ],
      expected: "second reader or missing canonical reader",
    },
  ];
  for (const reversion of reversions) {
    const failures = violations({ ...clean, [reversion.key]: reversion.value });
    if (!failures.some((failure) => failure.includes(reversion.expected))) {
      throw new Error(`reversion not caught: ${reversion.expected}`);
    }
  }
  console.log(
    `issue-1436 secret-capacity exit self-test PASS (${reversions.length} true-source reversions)`,
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
    "issue-1436 secret-capacity exit gate PASS (88 names, bundled authority, exact #2830 slot-88 exception)",
  );
}
