/**
 * #2241 implementor proof.
 *
 * Load-bearing assertions include:
 * - unclassified imported environment read fails closed
 * - signed receipt replay is rejected
 * - configuration failures never render retry
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";

import {
  auditFunctionSecretContract,
  buildImportClosure,
  findCallBoundaryArguments,
  findLiteralCallNames,
  ISSUE_2241_EXTRA_NAMES,
  ISSUE_2241_FUNCTIONS,
  scanFunctionSources,
  validateFunctionEnvContract,
} from "./audit-function-secret-contract.mjs";
import {
  assertLiveNameParity,
  evaluateFunctionReadiness,
  ReadinessError,
  reduceLiveSecretNames,
} from "./preflight-function-secret-readiness.mjs";
import {
  createReceiptAuthority,
  ReconciliationError,
  reduceRemoteFunctionMetadata,
  runGovernedBundleDeployment,
  runIssue2241Reconciliation,
  validateDeliveryTransition,
  verifyDownloadedFunctionSources,
  verifyJwtPostures,
  verifyRemoteJwtPostures,
} from "./reconcile-governed-secrets.mjs";
import {
  applyPreparedGovernedBundle,
  BundleSetterError,
  loadSecureBundleInput,
  prepareGovernedBundle,
  serializeDotenvAssignment,
} from "./set-governed-secret-bundle.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
);
const contract = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/function-env.contract.json"), "utf8"),
);
const mergedCommit = "0123456789abcdef0123456789abcdef01234567";
const projectRef = "gqnoajqerqhnvulmnyvv";

function fixtureContract(functions, sharedModules = {}) {
  return {
    functions,
    non_secret_runtime_config: [],
    platform_managed: [],
    remediation: {
      allowed_extra_live_names: [...ISSUE_2241_EXTRA_NAMES].sort(),
      expires_after_merge_hours: 72,
      issue: 2241,
      production_ref: projectRef,
      selected_functions: [...ISSUE_2241_FUNCTIONS].sort(),
    },
    schema_version: 1,
    shared_modules: sharedModules,
  };
}

function functionRecord(overrides = {}) {
  return {
    migration_fallback_top_level: [],
    optional_top_level: [],
    required_bundle_fields: {},
    required_top_level: [],
    ...overrides,
  };
}

function withSourceFixture(files, callback) {
  const temp = mkdtempSync(resolve(tmpdir(), "mingla-2241-contract-test-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const absolute = resolve(temp, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, source);
    }
    return callback(temp);
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }
}

function deliveryObject(version, checkout = false) {
  return {
    schema_version: version,
    marketing_send_live_enabled: true,
    sms_live_enabled: { ng: false, us: true },
    payment_operations: {
      payout_hold_onboard_flip: false,
      payout_release_execute: true,
      source_refunds_post_disabled: false,
      paystack_payout_hold_onboard_flip: true,
      ...(version === 4 ? { checkout_revocation_execute: checkout } : {}),
    },
  };
}

function deliveryFields(version) {
  return [
    "marketing_send_live_enabled",
    "paystack_payout_hold_onboard_flip",
    "payout_hold_onboard_flip",
    "payout_release_execute",
    "source_refunds_post_disabled",
    ...(version === 4 ? ["checkout_revocation_execute"] : []),
    "sms_live_enabled.ng",
    "sms_live_enabled.us",
  ].sort();
}

function attestationsFor(fields, record) {
  const governed = new Map(
    record.bundle_fields.map((field) => [field.name, field]),
  );
  return Object.fromEntries(fields.map((field) => [
    field,
    {
      owner: governed.get(field)?.owner ?? "Synthetic Provider Owner",
      source_type: governed.get(field)?.source_type ??
        "synthetic_approved_source",
    },
  ]));
}

function bundleInputs() {
  const adRecord = manifest.secrets.find((record) =>
    record.name === "AD_CONVERSION_TOKENS"
  );
  const deliveryRecord = manifest.secrets.find((record) =>
    record.name === "MINGLA_DELIVERY_FLAGS_JSON"
  );
  const adFields = adRecord.bundle_fields.map((field) => field.name).sort();
  const adObject = Object.fromEntries(
    adFields.map((field) => [field, `synthetic-${field}`]),
  );
  adObject.NOTIFICATION_RECIPIENT_HMAC_SECRET = "h".repeat(32);
  adObject.ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT = "A".repeat(43);
  adObject.ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS = "B".repeat(43);
  adObject.BRAND_PERSON_ERASURE_CHALLENGE_SECRET = Buffer.alloc(32, 7)
    .toString("base64");
  const sourceRefundSlots = [
    [
      "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID",
      "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KID",
      "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_IP_CURRENT_KID",
      "SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KID",
      "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KEY_B64",
    ],
    [
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID",
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KID",
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KEY_B64",
    ],
  ];
  sourceRefundSlots.forEach(([kidField, keyField], index) => {
    adObject[kidField] = `k${index + 1}`;
    adObject[keyField] = Buffer.alloc(32, index + 1).toString("base64");
  });
  const previousStates = Object.fromEntries(
    adFields
      .filter((field) =>
        field.includes("_PREVIOUS_") || field.endsWith("_PREVIOUS")
      )
      .map((field) => [field, "present"]),
  );
  const v3Fields = deliveryFields(3);
  const v4Fields = deliveryFields(4);
  return {
    ad: {
      attestations: attestationsFor(adFields, adRecord),
      authoritativeExistingFieldNames: adFields,
      bundleName: "AD_CONVERSION_TOKENS",
      bundleObject: adObject,
      previousFieldStates: previousStates,
    },
    deliveryV3: {
      attestations: attestationsFor(v3Fields, deliveryRecord),
      authoritativeExistingFieldNames: v3Fields,
      bundleName: "MINGLA_DELIVERY_FLAGS_JSON",
      bundleObject: deliveryObject(3),
    },
    deliveryV4: {
      attestations: attestationsFor(v4Fields, deliveryRecord),
      authoritativeExistingFieldNames: v3Fields,
      bundleName: "MINGLA_DELIVERY_FLAGS_JSON",
      bundleObject: deliveryObject(4, false),
    },
  };
}

function receiptSet(nowMs = Date.parse("2026-08-31T12:00:00.000Z")) {
  const authority = createReceiptAuthority({
    now: () => nowMs,
    nonce: "synthetic-operation-nonce-2241",
  });
  const adFields = manifest.secrets
    .find((record) => record.name === "AD_CONVERSION_TOKENS")
    .bundle_fields.map((field) => field.name)
    .sort();
  const delivery = deliveryFields(4);
  const base = {
    projectRef,
    sourceOwnerAttestationPass: true,
    preservationPass: true,
    parserPass: true,
    mergedCommit,
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
  };
  return {
    authority,
    adFields,
    deliveryFields: delivery,
    receipts: [
      authority.createReceipt({
        ...base,
        kind: "applied_bundle",
        bundleName: "AD_CONVERSION_TOKENS",
        schemaVersion: null,
        fieldNames: adFields,
      }),
      authority.createReceipt({
        ...base,
        kind: "prepared_transition",
        bundleName: "MINGLA_DELIVERY_FLAGS_JSON",
        schemaVersion: 4,
        fieldNames: delivery,
      }),
    ],
  };
}

test("#2241 happy: checked contract classifies the complete production import graph", () => {
  assert.deepEqual(auditFunctionSecretContract(), []);
  assert.equal(Object.keys(contract.functions).length, 232);
  assert.equal(manifest.secrets.length, 88);
});

test("#2241 happy: every exact direct reader is bundle-first with only its matching fallback", () => {
  const readers = {
    "supabase/functions/attendance-claim-link/index.ts": [
      "resolveAttendanceClaimPepperRing",
    ],
    "supabase/functions/claim-attendance/index.ts": [
      "resolveAttendanceClaimPepperRing",
    ],
    "supabase/functions/attendance-claim-backfill/index.ts": [
      "resolveAttendanceClaimPepperRing",
    ],
    "supabase/functions/ticket-confirmation-dispatch/index.ts": [
      "resolveAttendanceClaimPepperRing",
    ],
    "supabase/functions/competitor-intel-worker/index.ts": [
      "META_COMPETITOR_IG_USER_ID",
      "META_COMPETITOR_ACCESS_TOKEN",
      "resolveGovernedAdField",
    ],
    "supabase/functions/resend-webhook/index.ts": [
      "RESEND_WEBHOOK_SECRET",
      "resolveGovernedAdField",
    ],
    "supabase/functions/checkout-sale-revocation/index.ts": [
      "resolveCheckoutRevocationExecute",
    ],
  };
  for (const [path, tokens] of Object.entries(readers)) {
    const source = readFileSync(resolve(ROOT, path), "utf8");
    for (const token of tokens) {
      assert(source.includes(token), `${path}:${token}`);
    }
    assert(
      !/Deno\.env\.get\("(?:ATTENDANCE_CLAIM_PEPPER|META_COMPETITOR_IG_USER_ID|META_COMPETITOR_ACCESS_TOKEN|RESEND_WEBHOOK_SECRET|CHECKOUT_REVOCATION_EXECUTE)"\)/
        .test(source),
    );
  }
});

test("#2241 adversarial: unclassified imported environment read fails closed", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": 'import "./shared.ts";\n',
    "supabase/functions/demo/shared.ts":
      'export const x = Deno.env.get("NEW_REQUIRED_SECRET");\n',
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract({ demo: functionRecord() }),
      manifest: { secrets: [] },
      scan,
    });
    assert(failures.includes("demo:NEW_REQUIRED_SECRET:unclassified_literal"));
  });
});

test("#2241 adversarial: required manifest and dynamic getter declarations fail closed", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts":
      'const name = "SYNTHETIC"; Deno.env.get(name); Deno.env.get("NEW_REQUIRED_SECRET");\n',
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract({
        demo: functionRecord({ required_top_level: ["NEW_REQUIRED_SECRET"] }),
      }),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.some((failure) => failure.includes("required_manifest_missing")),
    );
    assert(
      failures.some((failure) =>
        failure.includes("dynamic_getter_contract_missing")
      ),
    );
  });
});

test("#2241 adversarial: an approved dynamic getter rejects a new literal caller", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      function getEnv(name) { return Deno.env.get(name); }
      getEnv("DECLARED_SECRET");
      getEnv("declared_bundle_field");
      getEnv("undeclared_bundle_field");
      getEnv("UNDECLARED_SECRET");
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    assert.deepEqual(
      findLiteralCallNames(
        scan.module_sources["supabase/functions/demo/index.ts"],
        ["getEnv"],
      ),
      [
        "DECLARED_SECRET",
        "UNDECLARED_SECRET",
        "declared_bundle_field",
        "undeclared_bundle_field",
      ],
    );
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        {
          demo: functionRecord({ required_top_level: ["DECLARED_SECRET"] }),
        },
        {
          "supabase/functions/demo/index.ts": {
            allowed_bundle_fields: {
              SYNTHETIC_BUNDLE: ["declared_bundle_field"],
            },
            allowed_top_level: ["DECLARED_SECRET"],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: {
        secrets: [
          { name: "DECLARED_SECRET", bundle_fields: [] },
          {
            name: "SYNTHETIC_BUNDLE",
            bundle_fields: [{ name: "declared_bundle_field" }],
          },
        ],
      },
      scan,
    });
    assert(
      failures.includes(
        "supabase/functions/demo/index.ts:UNDECLARED_SECRET:dynamic_getter_name_undeclared",
      ),
    );
    assert(
      failures.includes(
        "supabase/functions/demo/index.ts:undeclared_bundle_field:dynamic_getter_name_undeclared",
      ),
    );
  });
});

test("#2241 adversarial: computed getter arguments require exact expression ownership", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      function getEnv(name) { return Deno.env.get(name); }
      const hidden = "NEW_REQUIRED_SECRET";
      const flag = true;
      getEnv(hidden);
      getEnv("NEW_" + "CONCATENATED_SECRET");
      getEnv(flag ? "CONDITIONAL_A" : "CONDITIONAL_B");
      getEnv(\`TEMPLATE_\${hidden}\`);
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const source = scan.module_sources["supabase/functions/demo/index.ts"];
    assert.deepEqual(
      findCallBoundaryArguments(source, ["getEnv"])
        .map(({ expression, literalName }) => ({ expression, literalName })),
      [
        { expression: '"NEW_" + "CONCATENATED_SECRET"', literalName: null },
        { expression: "`TEMPLATE_${hidden}`", literalName: null },
        {
          expression: 'flag ? "CONDITIONAL_A" : "CONDITIONAL_B"',
          literalName: null,
        },
        { expression: "hidden", literalName: null },
      ],
    );
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          "supabase/functions/demo/index.ts": {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    for (
      const expression of [
        'getEnv:"NEW_" + "CONCATENATED_SECRET"',
        "getEnv:`TEMPLATE_${hidden}`",
        'getEnv:flag ? "CONDITIONAL_A" : "CONDITIONAL_B"',
        "getEnv:hidden",
      ]
    ) {
      assert(
        failures.includes(
          `supabase/functions/demo/index.ts:${expression}:dynamic_call_expression_undeclared`,
        ),
      );
    }
  });
});

test("#2241 happy: an exact normalized computed getter expression is contract-owned", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      function getEnv(name) { return Deno.env.get(name); }
      getEnv(APPROVED_ENV_NAME);
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          "supabase/functions/demo/index.ts": {
            allowed_call_expressions: { getEnv: ["APPROVED_ENV_NAME"] },
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    assert.deepEqual(failures, []);
  });
});

test("#2241 adversarial: equivalent Deno env call syntax is always classified", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      const spaced = Deno.env /* gap */ . get("SPACED_SECRET");
      const bracket = Deno["env"]["get"]("BRACKET_SECRET");
      const optional = globalThis.Deno?.env?.["get"]?.("OPTIONAL_SECRET");
      const grouped = (Deno.env.get)("GROUPED_SECRET");
      const interpolated = \`value=\${Deno.env.get("TEMPLATE_SECRET")}\`;
      const regexFirst = \`value=\${/}/.test("}") ? Deno.env.get("REGEX_TEMPLATE_SECRET") : ""}\`;
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    assert.deepEqual(scan.failures, []);
    const failures = validateFunctionEnvContract({
      contract: fixtureContract({ demo: functionRecord() }),
      manifest: { secrets: [] },
      scan,
    });
    for (
      const name of [
        "BRACKET_SECRET",
        "GROUPED_SECRET",
        "OPTIONAL_SECRET",
        "REGEX_TEMPLATE_SECRET",
        "SPACED_SECRET",
        "TEMPLATE_SECRET",
      ]
    ) assert(failures.includes(`demo:${name}:unclassified_literal`), name);
  });
});

test("#2241 adversarial: indirect Deno env access and getter mutation fail closed", () => {
  const attacks = {
    destructured: 'const { get } = Deno.env; get("HIDDEN_SECRET");',
    env_alias: 'const alias = Deno.env; alias.get("HIDDEN_SECRET");',
    getter_alias: 'const alias = Deno.env.get; alias("HIDDEN_SECRET");',
    getter_assignment: "Deno.env.get = replacement;",
    getter_indirect_call: 'Deno.env.get.call(null, "HIDDEN_SECRET");',
    getter_reference: "consume(Deno.env.get);",
    runtime_alias: 'const runtime = Deno; runtime.env.get("HIDDEN_SECRET");',
  };
  for (const [label, attack] of Object.entries(attacks)) {
    withSourceFixture({
      "supabase/functions/demo/index.ts": `
        const replacement = () => undefined;
        const consume = (_value) => undefined;
        ${attack}
      `,
    }, (temp) => {
      const scan = scanFunctionSources({
        functionsRoot: resolve(temp, "supabase/functions"),
        repoRoot: temp,
      });
      assert(
        scan.failures.some((failure) =>
          failure.includes("unrecognized_deno_") ||
          failure.includes("indirect_deno_env_get")
        ),
        label,
      );
      const failures = validateFunctionEnvContract({
        contract: fixtureContract({ demo: functionRecord() }),
        manifest: { secrets: [] },
        scan,
      });
      assert(
        failures.some((failure) =>
          failure.includes("unrecognized_deno_") ||
          failure.includes("indirect_deno_env_get")
        ),
        label,
      );
    });
  }
});

test("#2241 adversarial: configured getter aliases and indirect references fail closed", () => {
  const attacks = {
    alias: 'const alias = getEnv; alias("HIDDEN_SECRET");',
    array_indirect: '[getEnv][0]("HIDDEN_SECRET");',
    assignment: "getEnv = replacement;",
    call_member: 'getEnv.call(null, "HIDDEN_SECRET");',
    passed_reference: "consume(getEnv);",
    sequence_indirect: '(0, getEnv)("HIDDEN_SECRET");',
  };
  for (const [label, attack] of Object.entries(attacks)) {
    withSourceFixture({
      "supabase/functions/demo/index.ts": `
        function getEnv(name) { return Deno.env.get(name); }
        const replacement = () => undefined;
        const consume = (_value) => undefined;
        ${attack}
      `,
    }, (temp) => {
      const scan = scanFunctionSources({
        functionsRoot: resolve(temp, "supabase/functions"),
        repoRoot: temp,
      });
      const failures = validateFunctionEnvContract({
        contract: fixtureContract(
          { demo: functionRecord() },
          {
            "supabase/functions/demo/index.ts": {
              allowed_bundle_fields: {},
              allowed_top_level: [],
              closure_call_identifiers: [],
              dynamic_getters: ["name"],
              local_call_identifiers: ["getEnv"],
            },
          },
        ),
        manifest: { secrets: [] },
        scan,
      });
      assert(
        failures.some((failure) =>
          failure.includes("dynamic_getter_reference_undeclared")
        ),
        label,
      );
    });
  }
});

test("#2241 adversarial: an imported configured getter alias cannot disappear", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      import { getEnv as alias } from "../_shared/getter.ts";
      alias("HIDDEN_SECRET");
    `,
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          "supabase/functions/_shared/getter.ts": {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.includes(
        "supabase/functions/_shared/getter.ts:HIDDEN_SECRET:dynamic_getter_name_undeclared",
      ),
    );
  });
});

test("#2241 happy: direct optional and parenthesized getters preserve ownership", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      const getEnv = (name) => Deno.env.get(name);
      (getEnv)?.("DECLARED_SECRET");
      (getEnv)(APPROVED_ENV_NAME);
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        {
          demo: functionRecord({ required_top_level: ["DECLARED_SECRET"] }),
        },
        {
          "supabase/functions/demo/index.ts": {
            allowed_call_expressions: { getEnv: ["APPROVED_ENV_NAME"] },
            allowed_bundle_fields: {},
            allowed_top_level: ["DECLARED_SECRET"],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: {
        secrets: [{ name: "DECLARED_SECRET", bundle_fields: [] }],
      },
      scan,
    });
    assert.deepEqual(failures, []);
  });
});

test("#2241 happy: regex lookalikes are not executable env or getter reads", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      const envPattern = /Deno\\.env\\.get\\("FAKE_ENV_SECRET"\\)/;
      const getterPattern = /getEnv\\("FAKE_GETTER_SECRET"\\)/;
      if (true) /Deno\\.env\\.get\\("FAKE_CONTROL_SECRET"\\)/.test("");
      function getEnv(name) { return Deno.env.get(name); }
      getEnv("DECLARED_SECRET");
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        {
          demo: functionRecord({ required_top_level: ["DECLARED_SECRET"] }),
        },
        {
          "supabase/functions/demo/index.ts": {
            allowed_bundle_fields: {},
            allowed_top_level: ["DECLARED_SECRET"],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: {
        secrets: [{ name: "DECLARED_SECRET", bundle_fields: [] }],
      },
      scan,
    });
    assert.deepEqual(failures, []);
  });
});

test("#2241 adversarial: escaped governed identifiers cannot bypass classification", () => {
  const source = String.raw`
    const direct = D\u0065no.env.get("ESCAPED_DENO_SECRET");
    function getEnv(name) { return Deno.env.get(name); }
    const throughGetter = g\u0065tEnv("ESCAPED_GETTER_SECRET");
  `;
  withSourceFixture({ "supabase/functions/demo/index.ts": source }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    assert.deepEqual(scan.failures, []);
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          "supabase/functions/demo/index.ts": {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.includes("demo:ESCAPED_DENO_SECRET:unclassified_literal"),
    );
    assert(
      failures.includes(
        "supabase/functions/demo/index.ts:ESCAPED_GETTER_SECRET:dynamic_getter_name_undeclared",
      ),
    );
  });
});

test("#2241 adversarial: invalid identifier escapes fail closed only in code", () => {
  for (
    const attack of [
      String.raw`const bad = D\x65no.env.get("HIDDEN_SECRET");`,
      String.raw`const bad = g\u{}etEnv("HIDDEN_SECRET");`,
      String.raw`const bad = g\u{110000}etEnv("HIDDEN_SECRET");`,
    ]
  ) {
    withSourceFixture({
      "supabase/functions/demo/index.ts": attack,
    }, (temp) => {
      const scan = scanFunctionSources({
        functionsRoot: resolve(temp, "supabase/functions"),
        repoRoot: temp,
      });
      assert(
        scan.failures.some((failure) =>
          failure.endsWith(":invalid_identifier_escape")
        ),
        attack,
      );
    });
  }

  const inert = [
    String.raw`const quoted = "D\x65no.env.get('FAKE')";`,
    String.raw`const pattern = /g\u{}etEnv\("FAKE"\)/;`,
    'const template = `g\\u{110000}etEnv("FAKE")`;',
    String.raw`// D\x65no.env.get("FAKE")`,
    String.raw`/* g\u{}etEnv("FAKE") */`,
  ].join("\n");
  withSourceFixture({ "supabase/functions/demo/index.ts": inert }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    assert.deepEqual(scan.failures, []);
  });
});

test("#2241 adversarial: every static import and re-export getter form stays governed", () => {
  withSourceFixture({
    "supabase/functions/_shared/bridge.ts": `
      export {
        default as forwardedDefault,
        getEnv as forwarded,
      } from "./getter.ts"
    `,
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
      export default getEnv;
    `,
    "supabase/functions/demo/index.ts": `
      import { getEnv as direct } from "../_shared/getter.ts"
      import defaultGetter from "../_shared/getter.ts"
      import * as envNamespace from "../_shared/getter.ts"
      import {
        forwarded,
        forwardedDefault,
      } from "../_shared/bridge.ts"

      direct("HIDDEN_DIRECT")
      defaultGetter("HIDDEN_DEFAULT")
      envNamespace.getEnv("HIDDEN_NAMESPACE")
      forwarded("HIDDEN_REEXPORTED")
      forwardedDefault("HIDDEN_REEXPORTED_DEFAULT")
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    assert.deepEqual(scan.failures, []);
    const owner = "supabase/functions/_shared/getter.ts";
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          [owner]: {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    for (
      const name of [
        "HIDDEN_DEFAULT",
        "HIDDEN_DIRECT",
        "HIDDEN_NAMESPACE",
        "HIDDEN_REEXPORTED",
        "HIDDEN_REEXPORTED_DEFAULT",
      ]
    ) {
      assert(
        failures.includes(`${owner}:${name}:dynamic_getter_name_undeclared`),
        `${name}\n${failures.join("\n")}`,
      );
    }
  });
});

test("#2241 adversarial: namespace bracket getters cannot disappear", () => {
  withSourceFixture({
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
    `,
    "supabase/functions/demo/index.ts": `
      import * as ns from "../_shared/getter.ts";
      ns["getEnv"]("HIDDEN_BRACKET");
      ns?.["getEnv"]?.("HIDDEN_OPTIONAL_BRACKET");
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const owner = "supabase/functions/_shared/getter.ts";
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          [owner]: {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    for (const name of ["HIDDEN_BRACKET", "HIDDEN_OPTIONAL_BRACKET"]) {
      assert(
        failures.includes(`${owner}:${name}:dynamic_getter_name_undeclared`),
        `${name}\n${failures.join("\n")}`,
      );
    }
  });
});

test("#2241 adversarial: computed namespace getter keys fail closed", () => {
  withSourceFixture({
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
    `,
    "supabase/functions/demo/index.ts": `
      import * as ns from "../_shared/getter.ts";
      const key = chooseGetter ? "getEnv" : "other";
      ns[key]("HIDDEN_COMPUTED");
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const owner = "supabase/functions/_shared/getter.ts";
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          [owner]: {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.some((failure) =>
        failure.includes("computed_namespace_member") &&
        failure.includes("dynamic_getter_reference_undeclared")
      ),
      failures,
    );
  });
});

test("#2241 happy: namespace dot bracket optional and grouped calls are equivalent", () => {
  const names = [
    "DECLARED_BRACKET",
    "DECLARED_DOT",
    "DECLARED_GROUPED",
    "DECLARED_OPTIONAL_BRACKET",
  ];
  withSourceFixture({
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
    `,
    "supabase/functions/demo/index.ts": `
      import * as ns from "../_shared/getter.ts";
      ns.getEnv("DECLARED_DOT");
      ns["getEnv"]("DECLARED_BRACKET");
      (ns?.["getEnv"])?.("DECLARED_OPTIONAL_BRACKET");
      ((ns).getEnv)("DECLARED_GROUPED");
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const owner = "supabase/functions/_shared/getter.ts";
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord({ required_top_level: names }) },
        {
          [owner]: {
            allowed_bundle_fields: {},
            allowed_top_level: names,
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: {
        secrets: names.map((name) => ({ bundle_fields: [], name })),
      },
      scan,
    });
    assert.deepEqual(failures, []);
  });
});

test("#2241 adversarial: unsupported governed import syntax fails closed", () => {
  withSourceFixture({
    "supabase/functions/_shared/getter.ts": `
      export function getEnv(name) { return Deno.env.get(name); }
    `,
    "supabase/functions/demo/index.ts": `
      import { getEnv as } from "../_shared/getter.ts"
    `,
  }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        { demo: functionRecord() },
        {
          "supabase/functions/_shared/getter.ts": {
            allowed_bundle_fields: {},
            allowed_top_level: [],
            closure_call_identifiers: ["getEnv"],
            dynamic_getters: ["name"],
            local_call_identifiers: ["getEnv"],
          },
        },
      ),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.some((failure) =>
        failure.endsWith(":module_binding_alias_invalid")
      ),
      failures,
    );
  });
});

test("#2241 adversarial: approved getter handoffs are site-bound and propagate", () => {
  const path = "supabase/functions/demo/index.ts";
  const source = `
    function defaultGetEnv(name) { return Deno.env.get(name); }
    function approved(getEnv = defaultGetEnv) {
      return getEnv("DECLARED_SECRET");
    }
    function evil(getEnv = defaultGetEnv) {
      return getEnv("HIDDEN_SECRET");
    }
  `;
  const approvedPosition = source.indexOf(
    "defaultGetEnv",
    source.indexOf("function approved"),
  );
  const evilPosition = source.indexOf(
    "defaultGetEnv",
    source.indexOf("function evil"),
  );
  const approvedReference =
    `${path}@${approvedPosition}:defaultGetEnv:parameter_default:getEnv=defaultGetEnv`;
  withSourceFixture({ [path]: source }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        {
          demo: functionRecord({ required_top_level: ["DECLARED_SECRET"] }),
        },
        {
          [path]: {
            allowed_bundle_fields: {},
            allowed_identifier_references: {
              defaultGetEnv: [approvedReference],
            },
            allowed_top_level: ["DECLARED_SECRET"],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["defaultGetEnv"],
          },
        },
      ),
      manifest: {
        secrets: [{ bundle_fields: [], name: "DECLARED_SECRET" }],
      },
      scan,
    });
    assert(
      failures.includes(
        `${path}:defaultGetEnv:${path}@${evilPosition}:defaultGetEnv:parameter_default:getEnv=defaultGetEnv:dynamic_getter_reference_undeclared:1`,
      ),
      failures,
    );
    assert(
      failures.includes(`${path}:HIDDEN_SECRET:dynamic_getter_name_undeclared`),
      failures,
    );
  });
});

test("#2241 happy: one exact getter handoff site and its receiving calls pass", () => {
  const path = "supabase/functions/demo/index.ts";
  const source = `
    function defaultGetEnv(name) { return Deno.env.get(name); }
    function approved(getEnv = defaultGetEnv) {
      return getEnv("DECLARED_SECRET");
    }
  `;
  const position = source.indexOf(
    "defaultGetEnv",
    source.indexOf("function approved"),
  );
  withSourceFixture({ [path]: source }, (temp) => {
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract(
        {
          demo: functionRecord({ required_top_level: ["DECLARED_SECRET"] }),
        },
        {
          [path]: {
            allowed_bundle_fields: {},
            allowed_identifier_references: {
              defaultGetEnv: [
                `${path}@${position}:defaultGetEnv:parameter_default:getEnv=defaultGetEnv`,
              ],
            },
            allowed_top_level: ["DECLARED_SECRET"],
            closure_call_identifiers: [],
            dynamic_getters: ["name"],
            local_call_identifiers: ["defaultGetEnv"],
          },
        },
      ),
      manifest: {
        secrets: [{ bundle_fields: [], name: "DECLARED_SECRET" }],
      },
      scan,
    });
    assert.deepEqual(failures, []);
  });
});

test("#2241 adversarial: dynamic import closure accepts only static literals", () => {
  withSourceFixture({
    "supabase/functions/demo/index.ts": `
      await import(\`./reader.ts\`, { with: { type: "javascript" } });
    `,
    "supabase/functions/demo/reader.ts":
      'export const configured = Deno.env.get("NEW_REQUIRED_SECRET");\n',
  }, (temp) => {
    const entrypoint = resolve(temp, "supabase/functions/demo/index.ts");
    const closure = buildImportClosure(entrypoint, temp);
    assert.deepEqual(closure.failures, []);
    assert.deepEqual(
      closure.files.map((path) => relative(temp, path)).sort(),
      [
        "supabase/functions/demo/index.ts",
        "supabase/functions/demo/reader.ts",
      ],
    );
    const scan = scanFunctionSources({
      functionsRoot: resolve(temp, "supabase/functions"),
      repoRoot: temp,
    });
    const failures = validateFunctionEnvContract({
      contract: fixtureContract({ demo: functionRecord() }),
      manifest: { secrets: [] },
      scan,
    });
    assert(
      failures.includes("demo:NEW_REQUIRED_SECRET:unclassified_literal"),
    );
  });

  for (
    const expression of [
      '"./" + "reader.ts"',
      'flag ? "./reader.ts" : "./other.ts"',
      "path",
      "`./${path}.ts`",
    ]
  ) {
    withSourceFixture({
      "supabase/functions/demo/index.ts":
        `const flag = true; const path = "./reader.ts"; import(${expression});\n`,
      "supabase/functions/demo/reader.ts": "export const reader = true;\n",
      "supabase/functions/demo/other.ts": "export const other = true;\n",
    }, (temp) => {
      const closure = buildImportClosure(
        resolve(temp, "supabase/functions/demo/index.ts"),
        temp,
      );
      assert(
        closure.failures.some((failure) =>
          failure.includes("dynamic_import_not_static")
        ),
        expression,
      );
    });
  }
});

test("#2241 adversarial: governed bundle reader inventory cannot disappear", () => {
  const changedManifest = structuredClone(manifest);
  changedManifest.secrets.find((record) =>
    record.name === "AD_CONVERSION_TOKENS"
  ).readers = [];
  const failures = validateFunctionEnvContract({
    contract,
    manifest: changedManifest,
    scan: scanFunctionSources(),
  });
  assert(
    failures.some((failure) =>
      failure.includes("AD_CONVERSION_TOKENS") &&
      failure.includes("bundle_reader_missing")
    ),
  );
});

test("#2241 happy: raw names-only reduction discards every non-name field", () => {
  const canary = "SYNTHETIC_SECRET_VALUE_2241";
  const names = reduceLiveSecretNames(JSON.stringify([
    { name: "SAFE_ONE", value: canary, digest: canary, updated_at: canary },
  ]));
  assert.deepEqual(names, ["SAFE_ONE"]);
  assert(!JSON.stringify(names).includes(canary));
});

test("#2241 happy: normal deploy accepts a selected function with every required top-level name", () => {
  const result = evaluateFunctionReadiness({
    contract,
    manifest,
    liveNames: manifest.secrets.map((record) => record.name),
    selectedFunctions: ["admin-place-search"],
    projectRef,
    mergedCommit,
  });
  assert.deepEqual(result.selected_functions, ["admin-place-search"]);
  assert.equal(result.live_user_managed_count, 88);
  assert.equal(result.bundle_receipts, 0);
});

test("#2241 happy: exact 93 remediation and protected receipt set pass once", () => {
  const set = receiptSet();
  const result = evaluateFunctionReadiness({
    contract,
    manifest,
    liveNames: [
      ...manifest.secrets.map((record) => record.name),
      ...ISSUE_2241_EXTRA_NAMES,
    ],
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
    projectRef,
    mergedCommit,
    mode: "issue-2241-remediation",
    receipts: set.receipts,
    expectedReceiptFields: {
      AD_CONVERSION_TOKENS: set.adFields,
      MINGLA_DELIVERY_FLAGS_JSON: set.deliveryFields,
    },
    verifyReceiptSet: set.authority.verifyReceiptSet,
  });
  assert.equal(result.live_user_managed_count, 93);
  assert.equal(result.selected_functions.length, 23);
  assert.throws(
    () =>
      evaluateFunctionReadiness({
        contract,
        manifest,
        liveNames: [
          ...manifest.secrets.map((record) => record.name),
          ...ISSUE_2241_EXTRA_NAMES,
        ],
        selectedFunctions: [...ISSUE_2241_FUNCTIONS],
        projectRef,
        mergedCommit,
        mode: "issue-2241-remediation",
        receipts: set.receipts,
        expectedReceiptFields: {
          AD_CONVERSION_TOKENS: set.adFields,
          MINGLA_DELIVERY_FLAGS_JSON: set.deliveryFields,
        },
        verifyReceiptSet: set.authority.verifyReceiptSet,
      }),
    /receipt_replay_rejected/,
    "signed receipt replay is rejected",
  );
});

test("#2241 adversarial: exact live/project/function sets and in-memory authority are mandatory", () => {
  const base = receiptSet();
  const live = [
    ...manifest.secrets.map((record) => record.name),
    ...ISSUE_2241_EXTRA_NAMES,
  ];
  const args = {
    contract,
    manifest,
    liveNames: live,
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
    projectRef,
    mergedCommit,
    mode: "issue-2241-remediation",
    receipts: base.receipts,
    expectedReceiptFields: {
      AD_CONVERSION_TOKENS: base.adFields,
      MINGLA_DELIVERY_FLAGS_JSON: base.deliveryFields,
    },
  };
  assert.throws(
    () => evaluateFunctionReadiness({ ...args, liveNames: live.slice(1) }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch",
  );
  assert.throws(
    () =>
      evaluateFunctionReadiness({
        ...args,
        liveNames: [...live, "UNAPPROVED_EXTRA"],
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch",
  );
  assert.throws(
    () =>
      evaluateFunctionReadiness({
        ...args,
        projectRef: "abcdefghijklmnopqrst",
      }),
    (error) =>
      error instanceof ReadinessError && error.code === "wrong_project",
  );
  assert.throws(
    () =>
      evaluateFunctionReadiness({
        ...args,
        selectedFunctions: ISSUE_2241_FUNCTIONS.slice(1),
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "remediation_function_set_mismatch",
  );
  assert.throws(
    () => evaluateFunctionReadiness(args),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "in_memory_receipt_authority_required",
    "a persisted receipt-shaped object alone cannot authorize deploy",
  );
});

test("#2241 adversarial: exact 88/93 cardinalities reject both off-by-one directions", () => {
  const normal = manifest.secrets.map((record) => record.name);
  const remediation = [...normal, ...ISSUE_2241_EXTRA_NAMES];
  for (const liveNames of [normal.slice(1), [...normal, "UNAPPROVED_EXTRA"]]) {
    assert.throws(
      () =>
        assertLiveNameParity({
          contract,
          manifest,
          liveNames,
          projectRef,
        }),
      (error) =>
        error instanceof ReadinessError &&
        error.code === "live_name_set_mismatch",
    );
  }
  for (
    const liveNames of [
      remediation.slice(1),
      [...remediation, "UNAPPROVED_EXTRA"],
    ]
  ) {
    assert.throws(
      () =>
        assertLiveNameParity({
          contract,
          manifest,
          liveNames,
          projectRef,
          mode: "issue-2241-remediation",
        }),
      (error) =>
        error instanceof ReadinessError &&
        error.code === "live_name_set_mismatch",
    );
  }
});

test("#2241 adversarial: altered/wrong-key/stale/wrong-context receipts fail", () => {
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const set = receiptSet(nowMs);
  const expected = {
    bundleName: "AD_CONVERSION_TOKENS",
    fieldNames: set.adFields,
    kinds: ["applied_bundle"],
    mergedCommit,
    projectRef,
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
  };
  const altered = structuredClone(set.receipts[0]);
  altered.payload.project_ref = "abcdefghijklmnopqrst";
  assert.throws(
    () => set.authority.verifyReceiptSet([{ receipt: altered, expected }]),
    /receipt_signature_invalid/,
  );
  const wrongKey = createReceiptAuthority({
    now: () => nowMs,
    nonce: "other-nonce",
  });
  assert.throws(
    () => wrongKey.verifyReceiptSet([{ receipt: set.receipts[0], expected }]),
    /receipt_signature_invalid/,
  );
  let staleClock = nowMs;
  const staleVerifier = createReceiptAuthority({
    now: () => staleClock,
    nonce: "stale-operation-nonce",
  });
  const staleReceipt = staleVerifier.createReceipt({
    kind: "applied_bundle",
    projectRef,
    bundleName: "AD_CONVERSION_TOKENS",
    schemaVersion: null,
    fieldNames: set.adFields,
    sourceOwnerAttestationPass: true,
    preservationPass: true,
    parserPass: true,
    mergedCommit,
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
  });
  staleClock += 16 * 60 * 1000;
  assert.throws(
    () => staleVerifier.verifyReceiptSet([{ receipt: staleReceipt, expected }]),
    /receipt_stale_or_invalid_window/,
  );
  const contextSet = receiptSet(nowMs);
  for (
    const mismatch of [
      { mergedCommit: "f".repeat(40) },
      { projectRef: "abcdefghijklmnopqrst" },
      { bundleName: "MINGLA_DELIVERY_FLAGS_JSON" },
      { selectedFunctions: ISSUE_2241_FUNCTIONS.slice(1) },
      { fieldNames: set.adFields.slice(1) },
    ]
  ) {
    assert.throws(
      () =>
        contextSet.authority.verifyReceiptSet([{
          receipt: contextSet.receipts[0],
          expected: { ...expected, ...mismatch },
        }]),
      /receipt_context_mismatch/,
    );
  }
  const forbiddenSet = receiptSet(nowMs);
  const forbidden = structuredClone(forbiddenSet.receipts[0]);
  forbidden.payload.value = "never-authoritative";
  assert.throws(
    () =>
      forbiddenSet.authority.verifyReceiptSet([{
        receipt: forbidden,
        expected,
      }]),
    /receipt_forbidden_metadata/,
  );
  const malformed = createReceiptAuthority({
    now: () => nowMs,
    nonce: "synthetic-operation-nonce-2241",
  });
  assert.throws(
    () =>
      malformed.createReceipt({
        kind: "applied_bundle",
        projectRef,
        bundleName: "AD_CONVERSION_TOKENS",
        schemaVersion: null,
        fieldNames: ["ATTENDANCE_CLAIM_PEPPER", "not allowed"],
        sourceOwnerAttestationPass: true,
        preservationPass: true,
        parserPass: true,
        mergedCommit,
        selectedFunctions: [...ISSUE_2241_FUNCTIONS],
      }),
    /receipt_shape_invalid/,
  );
});

test("#2241 happy: complete AD and delivery objects validate without value output", () => {
  const inputs = bundleInputs();
  const ad = prepareGovernedBundle({ ...inputs.ad, manifest });
  const v3 = prepareGovernedBundle({ ...inputs.deliveryV3, manifest });
  const v4 = prepareGovernedBundle({ ...inputs.deliveryV4, manifest });
  assert.equal(ad.parserPass, true);
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v4.schemaVersion, 4);
  assert.equal(
    validateDeliveryTransition(v3.bundleObject, v4.bundleObject),
    true,
  );
  let capturedInput = "";
  const result = applyPreparedGovernedBundle({
    prepared: ad,
    projectRef,
    liveNames: manifest.secrets.map((record) => record.name),
    spawn: (_command, args, options) => {
      capturedInput = options.input;
      assert.deepEqual(args.slice(-2), ["--env-file", "/dev/stdin"]);
      assert(!args.join(" ").includes("synthetic-ATTENDANCE_CLAIM_PEPPER"));
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.bundleName, "AD_CONVERSION_TOKENS");
  assert(capturedInput.includes("AD_CONVERSION_TOKENS="));
});

test("#2241 happy: godotenv v1.5.1 quoted transport round-trips metacharacters", () => {
  const opaque = {
    dollar: "$TOKEN and ${EXPAND_ME}",
    comment: "  # not a dotenv comment",
    quote: "double \" and single '",
    slash: "C:\\opaque\\credential",
    shell: "`command` ! bang",
    whitespace: "  leading and trailing  ",
    lines: "line one\nline two\rline three",
  };
  const assignment = serializeDotenvAssignment(
    "AD_CONVERSION_TOKENS",
    JSON.stringify(opaque),
  );
  assert.equal(assignment.split("\n").length, 2);
  const encoded = assignment.slice(
    assignment.indexOf('="') + 2,
    -2,
  );
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = encoded[++index];
    if (escaped === "n") decoded += "\n";
    else if (escaped === "r") decoded += "\r";
    else if (["\\", '"', "!", "$", "`"].includes(escaped)) {
      decoded += escaped;
    } else throw new Error(`unexpected godotenv escape: ${escaped}`);
  }
  assert.deepEqual(JSON.parse(decoded), opaque);
  assert(!/(?<!\\)\$TOKEN/.test(assignment));
  assert(!/(?<!\\)\$\{EXPAND_ME\}/.test(assignment));
});

test("#2241 adversarial: partial/unknown/oversized/pair-loss/preservation-loss bundles reject", () => {
  const inputs = bundleInputs();
  const partial = structuredClone(inputs.ad);
  delete partial.bundleObject.ATTENDANCE_CLAIM_PEPPER;
  delete partial.attestations.ATTENDANCE_CLAIM_PEPPER;
  assert.throws(
    () => prepareGovernedBundle({ ...partial, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "governed_field_missing",
  );
  const incompletePair = structuredClone(inputs.ad);
  incompletePair.previousFieldStates
    .SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64 = "intentionally_absent";
  delete incompletePair.bundleObject
    .SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64;
  assert.throws(
    () => prepareGovernedBundle({ ...incompletePair, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "previous_pair_incomplete",
  );
  const preservationLoss = structuredClone(inputs.ad);
  preservationLoss.authoritativeExistingFieldNames.push(
    "DYNAMIC_PROVIDER_FIELD",
  );
  assert.throws(
    () => prepareGovernedBundle({ ...preservationLoss, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "existing_field_omitted",
  );
  const unknown = structuredClone(inputs.deliveryV4);
  unknown.bundleObject.payment_operations.unknown = true;
  assert.throws(
    () => prepareGovernedBundle({ ...unknown, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "delivery_payment_operations_invalid",
  );
  const oversized = structuredClone(inputs.ad);
  oversized.bundleObject.DYNAMIC_PROVIDER_FIELD = "x".repeat(48 * 1024);
  oversized.attestations.DYNAMIC_PROVIDER_FIELD = {
    owner: "Synthetic Provider Owner",
    source_type: "synthetic_approved_source",
  };
  assert.throws(
    () => prepareGovernedBundle({ ...oversized, manifest }),
    (error) =>
      error instanceof BundleSetterError && error.code === "bundle_oversized",
  );
  const nonCanonical = structuredClone(inputs.ad);
  nonCanonical.bundleObject.SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64 =
    "not-canonical-base64";
  assert.throws(
    () => prepareGovernedBundle({ ...nonCanonical, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "ad_bundle_strict_parser_invalid" &&
      error.publicNames.includes(
        "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64",
      ),
  );
  const crossPurposeReuse = structuredClone(inputs.ad);
  crossPurposeReuse.bundleObject
    .SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64 =
      crossPurposeReuse.bundleObject
        .SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64;
  assert.throws(
    () => prepareGovernedBundle({ ...crossPurposeReuse, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "ad_bundle_strict_parser_invalid",
  );
});

test("#2241 adversarial: bundle files must be owner-only and JWT posture is exact", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "mingla-2241-input-test-"));
  try {
    const secure = resolve(temp, "secure.json");
    const insecure = resolve(temp, "insecure.json");
    writeFileSync(secure, '{"synthetic":true}\n');
    writeFileSync(insecure, '{"synthetic":true}\n');
    chmodSync(secure, 0o600);
    chmodSync(insecure, 0o640);
    assert.deepEqual(loadSecureBundleInput(secure), { synthetic: true });
    assert.throws(
      () => loadSecureBundleInput(insecure),
      (error) =>
        error instanceof BundleSetterError &&
        error.code === "input_file_mode_not_0600",
    );
  } finally {
    rmSync(temp, { force: true, recursive: true });
  }

  const config = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
  assert.equal(verifyJwtPostures([...ISSUE_2241_FUNCTIONS], config), true);
  const changed = config.replace(
    /\[functions\.attendance-claim-link\]([\s\S]*?)verify_jwt\s*=\s*false/,
    "[functions.attendance-claim-link]$1verify_jwt = true",
  );
  assert.notEqual(changed, config);
  assert.throws(
    () => verifyJwtPostures([...ISSUE_2241_FUNCTIONS], changed),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "jwt_posture_mismatch" &&
      error.publicNames.includes("attendance-claim-link"),
  );
});

test("#2241 adversarial: downloaded function source must match the merged source", () => {
  const functionName = "attendance-claim-link";
  const spawn = (_command, args) => {
    const workdir = args[args.indexOf("--workdir") + 1];
    const downloaded = resolve(
      workdir,
      "supabase/functions",
      functionName,
      "index.ts",
    );
    mkdirSync(dirname(downloaded), { recursive: true });
    writeFileSync(downloaded, "// deployed source drift\n");
    return { status: 0, stdout: "", stderr: "" };
  };
  assert.throws(
    () =>
      verifyDownloadedFunctionSources({
        projectRef,
        selectedFunctions: [functionName],
        spawn,
      }),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "deployed_source_closure_mismatch" &&
      error.publicNames.includes(functionName),
  );
});

test("#2241 happy: downloaded recursive import closure matches every local file", () => {
  const functionName = "attendance-claim-link";
  const localEntrypoint = resolve(
    ROOT,
    "supabase/functions",
    functionName,
    "index.ts",
  );
  const closure = buildImportClosure(localEntrypoint, ROOT);
  assert.deepEqual(closure.failures, []);
  const spawn = (_command, args) => {
    const workdir = args[args.indexOf("--workdir") + 1];
    for (const local of closure.files) {
      const repoPath = relative(ROOT, local);
      const downloaded = resolve(workdir, repoPath);
      mkdirSync(dirname(downloaded), { recursive: true });
      writeFileSync(downloaded, readFileSync(local, "utf8"));
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  assert.equal(
    verifyDownloadedFunctionSources({
      projectRef,
      selectedFunctions: [functionName],
      spawn,
    }),
    true,
  );
});

test("#2241 adversarial: shared drift and extra downloaded imports both fail", () => {
  const functionName = "attendance-claim-link";
  const localEntrypoint = resolve(
    ROOT,
    "supabase/functions",
    functionName,
    "index.ts",
  );
  const closure = buildImportClosure(localEntrypoint, ROOT);
  const makeSpawn = (mutate) => (_command, args) => {
    const workdir = args[args.indexOf("--workdir") + 1];
    for (const local of closure.files) {
      const repoPath = relative(ROOT, local);
      const downloaded = resolve(workdir, repoPath);
      mkdirSync(dirname(downloaded), { recursive: true });
      writeFileSync(downloaded, readFileSync(local, "utf8"));
    }
    mutate(workdir);
    return { status: 0, stdout: "", stderr: "" };
  };
  assert.throws(
    () =>
      verifyDownloadedFunctionSources({
        projectRef,
        selectedFunctions: [functionName],
        spawn: makeSpawn((workdir) => {
          writeFileSync(
            resolve(
              workdir,
              "supabase/functions/_shared/governedAdSecret.ts",
            ),
            "// remote shared reader drift\n",
          );
        }),
      }),
    /deployed_source_(?:closure_invalid|mismatch)/,
  );
  assert.throws(
    () =>
      verifyDownloadedFunctionSources({
        projectRef,
        selectedFunctions: [functionName],
        spawn: makeSpawn((workdir) => {
          const entry = resolve(
            workdir,
            "supabase/functions",
            functionName,
            "index.ts",
          );
          writeFileSync(
            entry,
            `${
              readFileSync(entry, "utf8")
            }\nawait import(\`./remote-only.ts\`, { with: { type: "javascript" } });\n`,
          );
          writeFileSync(
            resolve(dirname(entry), "remote-only.ts"),
            "export const remoteOnly = true;\n",
          );
        }),
      }),
    /deployed_source_closure_mismatch/,
  );
});

test("#2241 happy: remote JWT readback keeps names and booleans only", () => {
  const canary = "remote-metadata-must-be-discarded";
  assert.deepEqual(
    reduceRemoteFunctionMetadata(JSON.stringify([{
      slug: "attendance-claim-link",
      verify_jwt: false,
      source: canary,
    }])),
    [{ name: "attendance-claim-link", verify_jwt: false }],
  );
  assert.equal(
    verifyRemoteJwtPostures({
      projectRef,
      selectedFunctions: ["attendance-claim-link"],
      spawn: () => ({
        status: 0,
        stdout: JSON.stringify([{
          slug: "attendance-claim-link",
          verify_jwt: false,
          source: canary,
        }]),
        stderr: "",
      }),
    }),
    true,
  );
  assert.throws(
    () =>
      verifyRemoteJwtPostures({
        projectRef,
        selectedFunctions: ["attendance-claim-link"],
        spawn: () => ({
          status: 0,
          stdout: JSON.stringify([{
            slug: "attendance-claim-link",
            verify_jwt: true,
          }]),
          stderr: "",
        }),
      }),
    /remote_jwt_posture_mismatch/,
  );
});

test("#2241 adversarial: delivery transition may change only schema plus checkout", () => {
  const changed = deliveryObject(4, true);
  changed.payment_operations.payout_release_execute = false;
  assert.throws(
    () => validateDeliveryTransition(deliveryObject(3), changed),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "delivery_transition_existing_controls_changed",
  );
});

test("#2241 happy: the coordinator performs one exact ordered in-memory run", () => {
  const inputs = bundleInputs();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const calls = [];
  const liveNames = [
    ...manifest.secrets.map((record) => record.name),
    ...ISSUE_2241_EXTRA_NAMES,
  ];
  const result = runIssue2241Reconciliation({
    projectRef,
    mergedCommit,
    selectedFunctions: [...ISSUE_2241_FUNCTIONS],
    adInput: inputs.ad,
    deliveryV3Input: inputs.deliveryV3,
    deliveryV4Input: inputs.deliveryV4,
    now: () => nowMs,
    dependencies: {
      audit: () => [],
      gitState: () => ({
        clean: true,
        committedAtMs: nowMs - 60_000,
        head: mergedCommit,
        remoteMain: mergedCommit,
      }),
      listLiveNames: () => liveNames,
      applyBundle: ({ prepared }) => {
        calls.push(
          `apply:${prepared.bundleName}:v${prepared.schemaVersion ?? "open"}`,
        );
        return prepared;
      },
      deploy: ({ selectedFunctions }) => {
        calls.push(`deploy:${selectedFunctions.length}`);
      },
      verifyDeployed: ({ selectedFunctions }) => {
        calls.push(`verify:${selectedFunctions.length}`);
      },
      verifyRemoteJwt: ({ selectedFunctions }) => {
        calls.push(`jwt:${selectedFunctions.length}`);
      },
    },
  });
  assert.deepEqual(calls, [
    "apply:AD_CONVERSION_TOKENS:vopen",
    "deploy:23",
    "verify:23",
    "jwt:23",
    "apply:MINGLA_DELIVERY_FLAGS_JSON:v4",
  ]);
  assert.equal(result.preflight_passed, true);
});

test("#2241 happy: normal bundle-reader deploy is executable in one process", () => {
  const inputs = bundleInputs();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const calls = [];
  const result = runGovernedBundleDeployment({
    projectRef,
    mergedCommit,
    selectedFunctions: ["attendance-claim-link"],
    bundleInputs: { AD_CONVERSION_TOKENS: inputs.ad },
    now: () => nowMs,
    dependencies: {
      audit: () => [],
      gitState: () => ({
        clean: true,
        // Normal deployments stay usable after the one-time 72-hour
        // remediation window; current remote-main identity is the authority.
        committedAtMs: nowMs - 30 * 24 * 60 * 60 * 1000,
        head: mergedCommit,
        remoteMain: mergedCommit,
      }),
      listLiveNames: () => manifest.secrets.map((record) => record.name),
      applyBundle: ({ prepared }) => {
        calls.push(`apply:${prepared.bundleName}`);
        return prepared;
      },
      deploy: ({ selectedFunctions }) => {
        calls.push(`deploy:${selectedFunctions.join(",")}`);
      },
      verifyDeployed: () => calls.push("closure"),
      verifyRemoteJwt: () => calls.push("jwt"),
    },
  });
  assert.deepEqual(calls, [
    "apply:AD_CONVERSION_TOKENS",
    "deploy:attendance-claim-link",
    "closure",
    "jwt",
  ]);
  assert.deepEqual(result.applied_bundles, ["AD_CONVERSION_TOKENS"]);
  assert.equal(result.preflight_passed, true);
  assert.throws(
    () =>
      runGovernedBundleDeployment({
        projectRef,
        mergedCommit,
        selectedFunctions: ["attendance-claim-link"],
        bundleInputs: {},
        now: () => nowMs,
        dependencies: {
          audit: () => [],
          gitState: () => ({
            clean: true,
            committedAtMs: nowMs - 60_000,
            head: mergedCommit,
            remoteMain: mergedCommit,
          }),
        },
      }),
    /normal_bundle_input_set_mismatch/,
  );
});

test("#2241 adversarial: live-name drift causes zero normal or remediation mutations", () => {
  const inputs = bundleInputs();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const mutations = [];
  const baseDependencies = {
    audit: () => [],
    gitState: () => ({
      clean: true,
      committedAtMs: nowMs - 60_000,
      head: mergedCommit,
      remoteMain: mergedCommit,
    }),
    applyBundle: () => {
      mutations.push("apply");
      throw new Error("apply_must_not_run");
    },
    deploy: () => mutations.push("deploy"),
  };

  assert.throws(
    () =>
      runGovernedBundleDeployment({
        projectRef,
        mergedCommit,
        selectedFunctions: ["attendance-claim-link"],
        bundleInputs: { AD_CONVERSION_TOKENS: inputs.ad },
        now: () => nowMs,
        dependencies: {
          ...baseDependencies,
          listLiveNames: () => [
            ...manifest.secrets.map((record) => record.name),
            "UNRELATED_EXTRA",
          ],
        },
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch",
  );
  assert.deepEqual(mutations, []);

  assert.throws(
    () =>
      runIssue2241Reconciliation({
        projectRef,
        mergedCommit,
        selectedFunctions: [...ISSUE_2241_FUNCTIONS],
        adInput: inputs.ad,
        deliveryV3Input: inputs.deliveryV3,
        deliveryV4Input: inputs.deliveryV4,
        now: () => nowMs,
        dependencies: {
          ...baseDependencies,
          listLiveNames: () => [
            ...manifest.secrets.map((record) => record.name),
            ...ISSUE_2241_EXTRA_NAMES.slice(1),
          ],
        },
      }),
    (error) =>
      error instanceof ReadinessError &&
      error.code === "live_name_set_mismatch",
  );
  assert.deepEqual(mutations, []);
});

test("#2241 adversarial: coordinator rejects dirty, wrong, and expired merged state", () => {
  const inputs = bundleInputs();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const liveNames = [
    ...manifest.secrets.map((record) => record.name),
    ...ISSUE_2241_EXTRA_NAMES,
  ];
  const baseDependencies = {
    audit: () => [],
    listLiveNames: () => liveNames,
    applyBundle: ({ prepared }) => prepared,
    deploy: () => true,
    verifyDeployed: () => true,
    verifyRemoteJwt: () => true,
  };
  const runWithState = (gitState) =>
    runIssue2241Reconciliation({
      projectRef,
      mergedCommit,
      selectedFunctions: [...ISSUE_2241_FUNCTIONS],
      adInput: inputs.ad,
      deliveryV3Input: inputs.deliveryV3,
      deliveryV4Input: inputs.deliveryV4,
      now: () => nowMs,
      dependencies: { ...baseDependencies, gitState: () => gitState },
    });
  assert.throws(
    () =>
      runWithState({
        clean: false,
        committedAtMs: nowMs - 60_000,
        head: mergedCommit,
        remoteMain: mergedCommit,
      }),
    /git_worktree_not_clean/,
  );
  assert.throws(
    () =>
      runWithState({
        clean: true,
        committedAtMs: nowMs - 60_000,
        head: "f".repeat(40),
        remoteMain: mergedCommit,
      }),
    /exact_merged_commit_required/,
  );
  assert.throws(
    () =>
      runWithState({
        clean: true,
        committedAtMs: nowMs - 60_000,
        head: mergedCommit,
        remoteMain: "e".repeat(40),
      }),
    /exact_merged_commit_required/,
    "a stale local tracking ref cannot substitute for current remote main",
  );
  assert.throws(
    () =>
      runWithState({
        clean: true,
        committedAtMs: nowMs - (73 * 60 * 60 * 1000),
        head: mergedCommit,
        remoteMain: mergedCommit,
      }),
    /remediation_window_expired/,
  );
});

test("#2241 happy: buyer configuration failure is terminal, exact, announced, and has no retry", () => {
  const service = readFileSync(
    resolve(ROOT, "mingla-business/src/services/attendanceClaimLinkService.ts"),
    "utf8",
  );
  const hook = readFileSync(
    resolve(ROOT, "mingla-business/src/hooks/useAttendanceClaimArm.ts"),
    "utf8",
  );
  const cta = readFileSync(
    resolve(
      ROOT,
      "mingla-business/src/components/checkout/DownloadMinglaCta.tsx",
    ),
    "utf8",
  );
  assert(
    service.includes('payload?.error === "claim_link_temporarily_unavailable"'),
  );
  assert(service.includes('AttendanceClaimLinkError("configuration")'));
  assert(hook.includes('code === "configuration"'));
  assert(hook.includes('? "unavailable"'));
  const unavailableArm = cta.slice(
    cta.indexOf('claimPhase === "unavailable"'),
    cta.indexOf(') : claimPhase === "error"'),
  );
  assert(unavailableArm.includes(
    "Your tickets are confirmed. You can open the app and sign in with your checkout email or phone.",
  ));
  assert(unavailableArm.includes('accessibilityLiveRegion="polite"'));
  assert(
    !unavailableArm.includes("onRetryClaim"),
    "configuration failures never render retry",
  );
  assert(cta.includes('name="externalLink" size={18}'));
  assert(cta.includes('width: "100%"'));
  assert(cta.includes("minHeight: 48"));
});

test("#2241 happy: production deploy-all is rejected", () => {
  const deploy = readFileSync(
    resolve(ROOT, "scripts/deploy-supabase-functions.sh"),
    "utf8",
  );
  assert(
    deploy.includes(
      "explicit --function selection required; deploy-all is forbidden",
    ),
  );
  assert(deploy.includes("--use-api"));
});

const ISSUE_2913_NEW_PLATFORM_DEFAULTS = Object.freeze([
  "SUPABASE_DB_URL",
  "SUPABASE_JWKS",
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SECRET_KEYS",
]);

const ISSUE_2913_EXACT_PLATFORM_MANAGED = Object.freeze([
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_JWKS",
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_SENTRY_DSN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
]);

test("#2913 happy: exact provider defaults preserve 88/93 user-managed parity", () => {
  assert.deepEqual(
    contract.platform_managed,
    ISSUE_2913_EXACT_PLATFORM_MANAGED,
  );
  const normalUserNames = manifest.secrets.map((record) => record.name);
  const normal = assertLiveNameParity({
    contract,
    manifest,
    liveNames: [...normalUserNames, ...contract.platform_managed],
    projectRef,
  });
  const remediation = assertLiveNameParity({
    contract,
    manifest,
    liveNames: [
      ...normalUserNames,
      ...ISSUE_2241_EXTRA_NAMES,
      ...contract.platform_managed,
    ],
    projectRef,
    mode: "issue-2241-remediation",
  });

  assert.equal(normal.liveUserManaged.length, 88);
  assert.equal(remediation.liveUserManaged.length, 93);
});

test("#2913 adversarial: each new provider default is required by exact name", () => {
  const liveNames = [
    ...manifest.secrets.map((record) => record.name),
    ...ISSUE_2241_EXTRA_NAMES,
    ...contract.platform_managed,
  ];
  for (const platformName of ISSUE_2913_NEW_PLATFORM_DEFAULTS) {
    const reverted = structuredClone(contract);
    reverted.platform_managed = reverted.platform_managed.filter((name) =>
      name !== platformName
    );
    assert.throws(
      () =>
        assertLiveNameParity({
          contract: reverted,
          manifest,
          liveNames,
          projectRef,
          mode: "issue-2241-remediation",
        }),
      (error) =>
        error instanceof ReadinessError &&
        error.code === "live_name_set_mismatch" &&
        error.details.includes(`unexpected:${platformName}`),
      platformName,
    );
  }
});

test("#2913 adversarial: no prefix bypass or user-managed set drift is accepted", () => {
  const normalUserNames = manifest.secrets.map((record) => record.name);
  const liveNames = [
    ...normalUserNames,
    ...ISSUE_2241_EXTRA_NAMES,
    ...contract.platform_managed,
  ];
  const expectMismatch = (changedLiveNames, detail) => {
    assert.throws(
      () =>
        assertLiveNameParity({
          contract,
          manifest,
          liveNames: changedLiveNames,
          projectRef,
          mode: "issue-2241-remediation",
        }),
      (error) =>
        error instanceof ReadinessError &&
        error.code === "live_name_set_mismatch" &&
        error.details.includes(detail),
      detail,
    );
  };

  expectMismatch(
    [...liveNames, "SUPABASE_FUTURE_DEFAULT"],
    "unexpected:SUPABASE_FUTURE_DEFAULT",
  );
  expectMismatch(
    liveNames.filter((name) => name !== normalUserNames[0]),
    `missing:${normalUserNames[0]}`,
  );
  expectMismatch(
    [...liveNames, "UNAPPROVED_EXTRA"],
    "unexpected:UNAPPROVED_EXTRA",
  );
});

test("#2913 tester adversarial: a governed user name cannot hide as platform-managed", () => {
  const governedUserName = manifest.secrets[0].name;
  assert(!contract.platform_managed.includes(governedUserName));
  const smuggled = structuredClone(contract);
  smuggled.platform_managed = [
    ...smuggled.platform_managed,
    governedUserName,
  ].sort();

  assert.throws(
    () =>
      assertLiveNameParity({
        contract: smuggled,
        manifest,
        liveNames: [
          ...manifest.secrets.map((record) => record.name),
          ...ISSUE_2241_EXTRA_NAMES,
          ...ISSUE_2913_EXACT_PLATFORM_MANAGED,
        ],
        projectRef,
        mode: "issue-2241-remediation",
      }),
    (error) => {
      assert(error instanceof ReadinessError);
      assert.equal(error.code, "live_name_set_mismatch");
      assert.deepEqual(error.details, [`missing:${governedUserName}`]);
      return true;
    },
  );
});
