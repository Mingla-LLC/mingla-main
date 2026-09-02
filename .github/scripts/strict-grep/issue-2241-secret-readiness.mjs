#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  audit: "scripts/secrets/audit-function-secret-contract.mjs",
  claimFunction: "supabase/functions/attendance-claim-link/index.ts",
  componentTest:
    "mingla-business/src/components/checkout/__tests__/issue2241DownloadMinglaCta.render.test.tsx",
  contract: "supabase/function-env.contract.json",
  coordinator: "scripts/secrets/reconcile-governed-secrets.mjs",
  cta: "mingla-business/src/components/checkout/DownloadMinglaCta.tsx",
  deploy: "scripts/deploy-supabase-functions.sh",
  hook: "mingla-business/src/hooks/useAttendanceClaimArm.ts",
  hookTest:
    "mingla-business/src/hooks/__tests__/issue2241AttendanceUnavailable.render.test.tsx",
  icon: "mingla-business/src/components/ui/Icon.tsx",
  manifest: "supabase/secrets.manifest.json",
  preflight: "scripts/secrets/preflight-function-secret-readiness.mjs",
  resolver: "supabase/functions/_shared/governedAdSecret.ts",
  service: "mingla-business/src/services/attendanceClaimLinkService.ts",
  serviceTest:
    "mingla-business/src/services/__tests__/issue2241AttendanceClaimUnavailable.behavior.test.ts",
  setter: "scripts/secrets/set-governed-secret-bundle.mjs",
  test: "scripts/secrets/issue_2241_secret_readiness.test.mjs",
  workflow: ".github/workflows/supabase-secret-budget.yml",
};

function requireTokens(source, tokens, label, failures) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${label}:missing:${token}`);
  }
}

export function violations(files) {
  const failures = [];
  let contract;
  let manifest;
  try {
    contract = JSON.parse(files.contract);
    manifest = JSON.parse(files.manifest);
  } catch {
    return ["contract_or_manifest_invalid_json"];
  }
  if (manifest.secrets?.length !== 88) failures.push("manifest:not_exact_88");
  const records = new Map(
    manifest.secrets?.map((record) => [record.name, record]),
  );
  const adFields = new Set(
    records.get("AD_CONVERSION_TOKENS")?.bundle_fields?.map((field) =>
      field.name
    ),
  );
  for (
    const field of [
      "ATTENDANCE_CLAIM_PEPPER",
      "META_COMPETITOR_ACCESS_TOKEN",
      "META_COMPETITOR_IG_USER_ID",
      "RESEND_WEBHOOK_SECRET",
    ]
  ) {
    if (!adFields.has(field)) {
      failures.push(`manifest:ad_field_missing:${field}`);
    }
  }
  const deliveryFields = new Set(
    records.get("MINGLA_DELIVERY_FLAGS_JSON")?.bundle_fields?.map((field) =>
      field.name
    ),
  );
  if (!deliveryFields.has("checkout_revocation_execute")) {
    failures.push("manifest:checkout_field_missing");
  }
  if (
    contract.schema_version !== 1 ||
    contract.remediation?.issue !== 2241 ||
    contract.remediation?.production_ref !== "gqnoajqerqhnvulmnyvv" ||
    contract.remediation?.expires_after_merge_hours !== 72 ||
    contract.remediation?.allowed_extra_live_names?.length !== 2 ||
    contract.remediation?.selected_functions?.length !== 23
  ) failures.push("contract:remediation_contract_invalid");
  for (
    const [path, declaration] of Object.entries(contract.shared_modules ?? {})
  ) {
    if (
      !Array.isArray(declaration.dynamic_getters) ||
      !Array.isArray(declaration.allowed_top_level) ||
      !Array.isArray(declaration.local_call_identifiers) ||
      !Array.isArray(declaration.closure_call_identifiers) ||
      declaration.allowed_bundle_fields === null ||
      typeof declaration.allowed_bundle_fields !== "object" ||
      Array.isArray(declaration.allowed_bundle_fields) ||
      (declaration.allowed_identifier_references !== undefined &&
        (declaration.allowed_identifier_references === null ||
          typeof declaration.allowed_identifier_references !== "object" ||
          Array.isArray(declaration.allowed_identifier_references)))
    ) failures.push(`contract:dynamic_boundary_incomplete:${path}`);
  }

  requireTokens(
    files.audit,
    [
      "findCallBoundaryArguments",
      "dynamic_call_expression_undeclared",
      "dynamic_call_expression_unused",
      "dynamic_import_not_static",
      "callArgumentsAt",
      "tokenizeSyntax",
      "decodeIdentifierEscape",
      "invalid_identifier_escape",
      "skipRegexLiteral",
      "parseModuleLinkage",
      "buildGovernedBindingPlan",
      "parameterDefaultReceiver",
      "IDENTIFIER_REFERENCE_SITE",
      "computed_namespace_member",
      "consumedMemberPositions",
      "unrecognized_deno_env_access",
      "indirect_deno_env_get",
      "dynamic_getter_reference_undeclared",
      "allowed_identifier_references",
    ],
    "contract-audit",
    failures,
  );
  requireTokens(
    files.resolver,
    [
      "AD_CONVERSION_TOKENS",
      "governed_ad_bundle_invalid",
      "governed_ad_legacy_fallback",
      "legacyName !== LEGACY_NAMES[field]",
    ],
    "resolver",
    failures,
  );
  requireTokens(
    files.claimFunction,
    [
      "json(503",
      '"claim_link_temporarily_unavailable"',
      "resolveAttendanceClaimPepperRing",
      "issue_order_attendance_claim_proof_v2",
      "p_generation: pepperRing.current.generation",
      "p_allow_retry_rotation: true",
    ],
    "attendance-claim-link",
    failures,
  );
  requireTokens(
    files.service,
    [
      '"claim_link_temporarily_unavailable"',
      'AttendanceClaimLinkError("configuration")',
    ],
    "buyer-service",
    failures,
  );
  requireTokens(
    files.hook,
    ['| "unavailable"', 'code === "configuration"'],
    "buyer-hook",
    failures,
  );
  requireTokens(
    files.cta,
    [
      'claimPhase === "unavailable"',
      "Your tickets are confirmed. You can open the app and sign in with your checkout email or phone.",
      'name="externalLink" size={18}',
      'width: "100%"',
      "minHeight: 48",
      "borderRadius: radius.md",
      "opacity: 0.94",
      "opacity: 0.88",
      'transitionDuration: reducedMotion ? "0ms" : "150ms"',
      'accessibilityLiveRegion="polite"',
      'role="status"',
    ],
    "buyer-cta",
    failures,
  );
  requireTokens(
    files.icon,
    ['| "externalLink"', "externalLink: () =>"],
    "icon",
    failures,
  );
  requireTokens(
    files.preflight,
    [
      "live_name_set_mismatch",
      "in_memory_receipt_authority_required",
      "remediation_requires_exact_90",
      "remediation_function_set_mismatch",
      "assertLiveNameParity",
    ],
    "preflight",
    failures,
  );
  requireTokens(
    files.setter,
    [
      '"/dev/stdin"',
      "existing_field_omitted",
      "previous_pair_incomplete",
      "bundle_oversized",
      "serializeDotenvAssignment",
      'encoded += "\\\\$"',
    ],
    "setter",
    failures,
  );
  requireTokens(
    files.coordinator,
    [
      'generateKeyPairSync("ed25519")',
      "randomBytes(32)",
      "receipt_replay_rejected",
      "RECEIPT_TTL_MS = 15 * 60 * 1000",
      "verifyDownloadedFunctionSources",
      "verifyJwtPostures",
      "runGovernedBundleDeployment",
      "verifyRemoteJwtPostures",
      "buildImportClosure",
      '"ls-remote"',
      "assertLiveNameParity",
    ],
    "coordinator",
    failures,
  );
  requireTokens(
    files.deploy,
    [
      "explicit --function selection required; deploy-all is forbidden",
      "preflight-function-secret-readiness.mjs",
      "--use-api",
      "reconcile-governed-secrets.mjs",
      "--normal-governed-deploy",
      "--delivery-input",
    ],
    "deploy",
    failures,
  );
  requireTokens(
    files.workflow,
    [
      "required live-audit credential is missing",
      "exit 1",
      "audit-function-secret-contract.mjs",
      "issue_2241_*.test.mjs",
      "issue-2241-secret-readiness.mjs --self-test",
      "scripts/deploy-supabase-functions.sh",
      "issue2241*.test.ts?(x)",
    ],
    "workflow",
    failures,
  );
  if (/Audit live secret names[\s\S]{0,180}\n\s+if:/.test(files.workflow)) {
    failures.push("workflow:live_audit_green_skip_present");
  }
  requireTokens(
    files.test,
    [
      "unclassified imported environment read fails closed",
      "signed receipt replay is rejected",
      "configuration failures never render retry",
      "approved dynamic getter rejects a new literal caller",
      "godotenv v1.5.1 quoted transport round-trips metacharacters",
      "normal bundle-reader deploy is executable in one process",
      "computed getter arguments require exact expression ownership",
      "dynamic import closure accepts only static literals",
      "live-name drift causes zero normal or remediation mutations",
      "equivalent Deno env call syntax is always classified",
      "indirect Deno env access and getter mutation fail closed",
      "configured getter aliases and indirect references fail closed",
      "an imported configured getter alias cannot disappear",
      "direct optional and parenthesized getters preserve ownership",
      "regex lookalikes are not executable env or getter reads",
      "escaped governed identifiers cannot bypass classification",
      "invalid identifier escapes fail closed only in code",
      "every static import and re-export getter form stays governed",
      "unsupported governed import syntax fails closed",
      "approved getter handoffs are site-bound and propagate",
      "one exact getter handoff site and its receiving calls pass",
      "namespace bracket getters cannot disappear",
      "computed namespace getter keys fail closed",
      "namespace dot bracket optional and grouped calls are equivalent",
    ],
    "regression-test",
    failures,
  );
  requireTokens(
    files.serviceTest,
    ["a real 503 payload becomes the bounded configuration error"],
    "buyer-service-test",
    failures,
  );
  requireTokens(
    files.hookTest,
    ["real 503 → service → hook → CTA", 'node.props.role === "status"'],
    "buyer-hook-test",
    failures,
  );
  requireTokens(
    files.componentTest,
    [
      'for (const os of ["web", "ios", "android"]',
      "all seven phases keep a working primary action",
      "only a transient error renders the retry control",
      "reduced motion resolves the transition duration to zero",
      'expect(typeof mounted.primary.props.onPress).toBe("function")',
      "expect(navigationsAfter).toBe(navigationsBefore + 1)",
    ],
    "buyer-component-test",
    failures,
  );
  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(PATHS).map((
      [key, path],
    ) => [key, readFileSync(resolve(ROOT, path), "utf8")]),
  );
}

function fixture() {
  const filler = Array.from(
    { length: 86 },
    (_, index) => ({ name: `SAFE_${index}` }),
  );
  return {
    audit:
      "findCallBoundaryArguments dynamic_call_expression_undeclared dynamic_call_expression_unused dynamic_import_not_static callArgumentsAt tokenizeSyntax decodeIdentifierEscape invalid_identifier_escape skipRegexLiteral parseModuleLinkage buildGovernedBindingPlan parameterDefaultReceiver IDENTIFIER_REFERENCE_SITE computed_namespace_member consumedMemberPositions unrecognized_deno_env_access indirect_deno_env_get dynamic_getter_reference_undeclared allowed_identifier_references",
    claimFunction:
      'resolveAttendanceClaimPepperRing; issue_order_attendance_claim_proof_v2; p_generation: pepperRing.current.generation; p_allow_retry_rotation: true; json(503; "claim_link_temporarily_unavailable"',
    componentTest:
      'for (const os of ["web", "ios", "android"] all seven phases keep a working primary action only a transient error renders the retry control reduced motion resolves the transition duration to zero expect(typeof mounted.primary.props.onPress).toBe("function") expect(navigationsAfter).toBe(navigationsBefore + 1)',
    contract: JSON.stringify({
      schema_version: 1,
      shared_modules: {
        "safe.ts": {
          dynamic_getters: ["name"],
          allowed_top_level: ["SAFE"],
          allowed_bundle_fields: {},
          local_call_identifiers: ["getEnv"],
          closure_call_identifiers: [],
        },
      },
      remediation: {
        issue: 2241,
        production_ref: "gqnoajqerqhnvulmnyvv",
        expires_after_merge_hours: 72,
        allowed_extra_live_names: ["A", "B"],
        selected_functions: Array.from(
          { length: 23 },
          (_, index) => `f${index}`,
        ),
      },
    }),
    coordinator:
      'generateKeyPairSync("ed25519") randomBytes(32) receipt_replay_rejected RECEIPT_TTL_MS = 15 * 60 * 1000 verifyDownloadedFunctionSources verifyJwtPostures runGovernedBundleDeployment verifyRemoteJwtPostures buildImportClosure "ls-remote" assertLiveNameParity',
    cta:
      'claimPhase === "unavailable" Your tickets are confirmed. You can open the app and sign in with your checkout email or phone. name="externalLink" size={18} width: "100%" minHeight: 48 borderRadius: radius.md opacity: 0.94 opacity: 0.88 transitionDuration: reducedMotion ? "0ms" : "150ms" accessibilityLiveRegion="polite" role="status"',
    deploy:
      "explicit --function selection required; deploy-all is forbidden preflight-function-secret-readiness.mjs --use-api reconcile-governed-secrets.mjs --normal-governed-deploy --delivery-input",
    hook: '| "unavailable" code === "configuration"',
    hookTest: 'real 503 → service → hook → CTA node.props.role === "status"',
    icon: '| "externalLink" externalLink: () =>',
    manifest: JSON.stringify({
      secrets: [
        {
          name: "AD_CONVERSION_TOKENS",
          bundle_fields: [
            "ATTENDANCE_CLAIM_PEPPER",
            "META_COMPETITOR_ACCESS_TOKEN",
            "META_COMPETITOR_IG_USER_ID",
            "RESEND_WEBHOOK_SECRET",
          ].map((name) => ({ name })),
        },
        {
          name: "MINGLA_DELIVERY_FLAGS_JSON",
          bundle_fields: [{ name: "checkout_revocation_execute" }],
        },
        ...filler,
      ],
    }),
    preflight:
      "live_name_set_mismatch in_memory_receipt_authority_required remediation_requires_exact_90 remediation_function_set_mismatch assertLiveNameParity",
    resolver:
      "AD_CONVERSION_TOKENS governed_ad_bundle_invalid governed_ad_legacy_fallback legacyName !== LEGACY_NAMES[field]",
    service:
      '"claim_link_temporarily_unavailable" AttendanceClaimLinkError("configuration")',
    serviceTest: "a real 503 payload becomes the bounded configuration error",
    setter:
      '"/dev/stdin" existing_field_omitted previous_pair_incomplete bundle_oversized serializeDotenvAssignment encoded += "\\\\$"',
    test:
      "unclassified imported environment read fails closed signed receipt replay is rejected configuration failures never render retry approved dynamic getter rejects a new literal caller godotenv v1.5.1 quoted transport round-trips metacharacters normal bundle-reader deploy is executable in one process computed getter arguments require exact expression ownership dynamic import closure accepts only static literals live-name drift causes zero normal or remediation mutations equivalent Deno env call syntax is always classified indirect Deno env access and getter mutation fail closed configured getter aliases and indirect references fail closed an imported configured getter alias cannot disappear direct optional and parenthesized getters preserve ownership regex lookalikes are not executable env or getter reads escaped governed identifiers cannot bypass classification invalid identifier escapes fail closed only in code every static import and re-export getter form stays governed unsupported governed import syntax fails closed approved getter handoffs are site-bound and propagate one exact getter handoff site and its receiving calls pass namespace bracket getters cannot disappear computed namespace getter keys fail closed namespace dot bracket optional and grouped calls are equivalent",
    workflow:
      "required live-audit credential is missing exit 1 audit-function-secret-contract.mjs issue_2241_*.test.mjs issue-2241-secret-readiness.mjs --self-test scripts/deploy-supabase-functions.sh issue2241*.test.ts?(x)",
  };
}

function selfTest() {
  const clean = fixture();
  if (violations(clean).length > 0) throw new Error("clean fixture rejected");
  const cases = [
    ["audit", "dynamic_import_not_static", "contract-audit"],
    ["audit", "tokenizeSyntax", "contract-audit"],
    ["audit", "dynamic_getter_reference_undeclared", "contract-audit"],
    ["audit", "decodeIdentifierEscape", "contract-audit"],
    ["audit", "parseModuleLinkage", "contract-audit"],
    ["audit", "parameterDefaultReceiver", "contract-audit"],
    ["audit", "computed_namespace_member", "contract-audit"],
    ["resolver", "legacyName !== LEGACY_NAMES[field]", "resolver"],
    ["claimFunction", "json(503", "attendance-claim-link"],
    ["cta", 'name="externalLink" size={18}', "buyer-cta"],
    ["componentTest", "all seven phases", "buyer-component-test"],
    ["componentTest", "navigationsAfter", "buyer-component-test"],
    ["preflight", "remediation_requires_exact_90", "preflight"],
    ["setter", "existing_field_omitted", "setter"],
    ["coordinator", "receipt_replay_rejected", "coordinator"],
    ["coordinator", "assertLiveNameParity", "coordinator"],
    ["deploy", "--use-api", "deploy"],
    ["workflow", "exit 1", "workflow"],
    ["test", "signed receipt replay is rejected", "regression-test"],
    ["test", "equivalent Deno env call syntax", "regression-test"],
    ["test", "regex lookalikes", "regression-test"],
    ["test", "escaped governed identifiers", "regression-test"],
    ["test", "static import and re-export", "regression-test"],
    ["test", "site-bound and propagate", "regression-test"],
    ["test", "namespace bracket getters", "regression-test"],
    ["test", "computed namespace getter", "regression-test"],
  ];
  for (const [key, token, expected] of cases) {
    const broken = { ...clean, [key]: clean[key].replace(token, "") };
    if (!violations(broken).some((failure) => failure.includes(expected))) {
      throw new Error(`reversion not caught: ${key}:${token}`);
    }
  }
  const manifest = JSON.parse(clean.manifest);
  for (const secrets of [
    manifest.secrets.slice(1),
    [...manifest.secrets, { name: "UNAPPROVED_EXTRA" }],
  ]) {
    const broken = { ...clean, manifest: JSON.stringify({ secrets }) };
    if (
      !violations(broken).some((failure) =>
        failure.includes("manifest:not_exact_88")
      )
    ) throw new Error("manifest cardinality reversion not caught");
  }
  console.log(
    `issue-2241 secret-readiness self-test PASS (${cases.length + 2} reversions)`,
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
  console.log("issue-2241 secret-readiness gate PASS");
}
