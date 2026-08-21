#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const FILES = {
  appJson: "mingla-business/app.json",
  identity: "mingla-business/src/services/appVersionIdentity.ts",
  supabase: "mingla-business/src/services/supabase.ts",
  service: "mingla-business/src/services/brandPaystackService.ts",
  hook: "mingla-business/src/hooks/useBrandPaystack.ts",
  component:
    "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
  registry: "docs/QUERY_KEY_REGISTRY.md",
  workflow: ".github/workflows/issue-2418-bank-list-native-identity.yml",
};

const PROTECTED_FUNCTIONS = [
  "brand-paystack-onboard",
  "brand-stripe-onboard",
  "brand-stripe-account-session",
  "brand-stripe-tax-account-session",
];

const TESTS = [
  "src/services/__tests__/issue_2418_native_identity_and_bank_payload.test.ts",
  "src/hooks/__tests__/issue_2418_bank_query_contract.test.ts",
  "src/components/brand/__tests__/issue_2418_bank_picker_states.test.tsx",
];

function loadSources() {
  const sources = Object.fromEntries(
    Object.entries(FILES).map(([key, relative]) => [key, read(relative)]),
  );
  for (const functionName of PROTECTED_FUNCTIONS) {
    sources[`function:${functionName}`] = read(
      `supabase/functions/${functionName}/index.ts`,
    );
  }
  return sources;
}

function validate(sources) {
  const failures = [];
  const requireText = (key, needle, label) => {
    if (!sources[key].includes(needle)) failures.push(label);
  };

  let appJson;
  try {
    appJson = JSON.parse(sources.appJson);
  } catch {
    failures.push("Host app.json must remain valid JSON");
  }
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
      appJson?.expo?.version ?? "",
    )
  ) {
    failures.push("Host expo.version must remain strict SemVer");
  }
  for (const platform of ["ios", "android"]) {
    if (appJson?.expo?.[platform]?.runtimeVersion?.policy !== "appVersion") {
      failures.push(`${platform} runtimeVersion.policy must remain appVersion`);
    }
  }

  requireText(
    "identity",
    "isStrictSemver(Constants.nativeAppVersion)",
    "nativeAppVersion must remain the primary strict identity",
  );
  requireText(
    "identity",
    "const expoConfigVersion = Constants.expoConfig?.version",
    "Release identity must retain the Expo config fallback",
  );
  if (
    /__DEV__\s*&&\s*isStrictSemver\(expoConfigVersion\)/.test(sources.identity)
  ) {
    failures.push("Expo config fallback must not be development-only");
  }
  requireText(
    "identity",
    'outcome: "expo_config_fallback"',
    "fallback diagnostic must remain sanitized and classified",
  );
  requireText(
    "identity",
    'reportIdentityOutcome(platform, "unavailable")',
    "unavailable identity diagnostic must remain sanitized and classified",
  );
  requireText(
    "supabase",
    "global: { headers: getNativeAppVersionHeaders() }",
    "shared Supabase owner must install native identity globally",
  );

  const protectedOnDisk = [];
  const functionsRoot = path.join(ROOT, "supabase/functions");
  for (const entry of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(functionsRoot, entry.name, "index.ts");
    if (!fs.existsSync(indexPath)) continue;
    if (
      fs
        .readFileSync(indexPath, "utf8")
        .includes("evaluateBusinessNativeVersion(")
    ) {
      protectedOnDisk.push(entry.name);
    }
  }
  protectedOnDisk.sort();
  const expectedProtected = [...PROTECTED_FUNCTIONS].sort();
  if (JSON.stringify(protectedOnDisk) !== JSON.stringify(expectedProtected)) {
    failures.push(
      `bounded function set drifted: ${protectedOnDisk.join(",") || "none"}`,
    );
  }
  for (const functionName of PROTECTED_FUNCTIONS) {
    if (
      !sources[`function:${functionName}`].includes(
        "evaluateBusinessNativeVersion(",
      )
    ) {
      failures.push(`${functionName} lost native identity enforcement`);
    }
  }

  requireText(
    "service",
    "function parsePaystackBanks(value: unknown)",
    "Paystack catalogue must retain whole-payload validation",
  );
  requireText(
    "service",
    'throw new PaystackBankListError("invalid_response", null)',
    "malformed bank responses must throw a classified error",
  );
  if (sources.service.includes("return data?.banks ?? []")) {
    failures.push("malformed bank responses must never become empty data");
  }

  for (const dimension of ['"NG"', '"NGN"', '"nuban"']) {
    requireText("hook", dimension, `bank query key lost ${dimension}`);
  }
  requireText(
    "hook",
    "const enabled = isAuthReady && requestedEnabled",
    "bank query must wait for root auth readiness",
  );
  requireText(
    "hook",
    "gcTime: 1000 * 60 * 60 * 2",
    "bank catalogue must retain two-hour GC",
  );
  requireText(
    "hook",
    "retry: shouldRetryPaystackBankList",
    "bank catalogue must retain local terminal/retryable classification",
  );

  for (const copy of [
    "Finishing sign-in…",
    "Loading banks…",
    "Couldn't load banks",
    "Banks are unavailable right now.",
    "No banks are available right now.",
    "Couldn't refresh banks.",
  ]) {
    requireText("component", copy, `picker state copy drifted: ${copy}`);
  }
  requireText(
    "component",
    "terminalBankError ? (",
    "terminal Paystack failure branch must remain visible",
  );
  requireText(
    "component",
    "if (retryingBanks || bankRetryInFlightRef.current) return",
    "picker retry must synchronously reject overlapping activations",
  );
  requireText(
    "component",
    "bankRetryInFlightRef.current = true",
    "picker retry must claim its synchronous in-flight lock",
  );
  requireText(
    "component",
    "bankRetryInFlightRef.current = false",
    "picker retry must release its lock after the request settles",
  );
  if ((sources.component.match(/onPress=\{handleRetryBanks\}/g) ?? []).length !== 3) {
    failures.push("all three picker retry controls must share the mutex callback");
  }
  requireText(
    "component",
    "hasBanks && trimmedBankSearch.length > 0 && filteredBanks.length === 0",
    "search-empty copy must require a valid non-empty catalogue and trimmed query",
  );
  requireText(
    "component",
    "backgroundRefreshError ? (",
    "cached rows must retain a non-blocking refresh-error branch",
  );
  requireText(
    "component",
    'accessibilityLabel="Try loading banks again"',
    "retry accessibility contract must remain wired",
  );
  requireText(
    "registry",
    "['brand-paystack', 'banks', 'NG', 'NGN', 'nuban']",
    "query-key registry must name the exact catalogue dimensions",
  );

  for (const test of TESTS) {
    requireText("workflow", test, `workflow must explicitly execute ${test}`);
  }
  requireText(
    "workflow",
    "issue-2418-bank-list-native-identity.mjs --self-test",
    "workflow must execute the guard self-test",
  );
  requireText(
    "workflow",
    "ISSUE_2418_SIMULATE_IDENTITY_REVERT=1",
    "workflow must prove the release fallback can go red",
  );
  requireText(
    "workflow",
    "ISSUE_2418_SIMULATE_BANK_ERROR_REVERT=1",
    "workflow must prove the truthful error branch can go red",
  );
  requireText(
    "workflow",
    "ISSUE_2418_SIMULATE_AUTH_REVERT=1",
    "workflow must prove the auth-ready fold can go red",
  );
  return failures;
}

const sources = loadSources();

if (process.argv.includes("--self-test")) {
  const baseline = validate(sources);
  if (baseline.length > 0) {
    throw new Error(`baseline invalid: ${baseline.join("; ")}`);
  }
  const mutations = [
    [
      "release fallback",
      {
        ...sources,
        identity: sources.identity.replace(
          "if (isStrictSemver(expoConfigVersion))",
          "if (__DEV__ && isStrictSemver(expoConfigVersion))",
        ),
      },
    ],
    [
      "ios runtime policy",
      {
        ...sources,
        appJson: sources.appJson.replace(
          '"policy": "appVersion"',
          '"policy": "nativeVersion"',
        ),
      },
    ],
    [
      "android runtime policy",
      {
        ...sources,
        appJson: sources.appJson.replace(
          /("android"[\s\S]*?"policy": )"appVersion"/,
          '$1"nativeVersion"',
        ),
      },
    ],
    [
      "global headers",
      {
        ...sources,
        supabase: sources.supabase.replace(
          "global: { headers: getNativeAppVersionHeaders() }",
          "global: { headers: {} }",
        ),
      },
    ],
    [
      "Paystack error branch",
      {
        ...sources,
        component: sources.component.replace(
          "terminalBankError ? (",
          "false ? (",
        ),
      },
    ],
    [
      "Paystack retry mutex",
      {
        ...sources,
        component: sources.component.replace(
          "if (retryingBanks || bankRetryInFlightRef.current) return;",
          "if (retryingBanks) return;",
        ),
      },
    ],
    [
      "Paystack payload validation",
      {
        ...sources,
        service: sources.service.replace(
          "return parsePaystackBanks(data);",
          "return data?.banks ?? [];",
        ),
      },
    ],
    [
      "auth-ready fold",
      {
        ...sources,
        hook: sources.hook.replace(
          "const enabled = isAuthReady && requestedEnabled",
          "const enabled = requestedEnabled",
        ),
      },
    ],
    [
      "guarded Stripe dependency",
      {
        ...sources,
        "function:brand-stripe-onboard": sources[
          "function:brand-stripe-onboard"
        ].replace(
          "evaluateBusinessNativeVersion(",
          "evaluateBusinessNativeVersionRemoved(",
        ),
      },
    ],
  ];
  for (const [label, mutated] of mutations) {
    if (validate(mutated).length === 0) {
      throw new Error(`self-test failed: ${label} mutation passed`);
    }
  }
  console.log("#2418 bank-list/native-identity strict gate self-test: PASS");
  process.exit(0);
}

if (process.env.ISSUE_2418_SIMULATE_IDENTITY_REVERT === "1") {
  sources.identity = sources.identity.replace(
    "if (isStrictSemver(expoConfigVersion))",
    "if (__DEV__ && isStrictSemver(expoConfigVersion))",
  );
}
if (process.env.ISSUE_2418_SIMULATE_BANK_ERROR_REVERT === "1") {
  sources.component = sources.component.replace(
    "terminalBankError ? (",
    "false ? (",
  );
}
if (process.env.ISSUE_2418_SIMULATE_AUTH_REVERT === "1") {
  sources.hook = sources.hook.replace(
    "const enabled = isAuthReady && requestedEnabled",
    "const enabled = requestedEnabled",
  );
}

const failures = validate(sources);
if (failures.length > 0) {
  for (const failure of failures) console.error(`#2418: ${failure}`);
  process.exit(1);
}
console.log("#2418 bank-list/native-identity structural contract: PASS");
