#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const FILES = {
  consumerRoot: "app-mobile/app/_layout.tsx",
  hostRoot: "mingla-business/app/_layout.tsx",
  consumerGate: "app-mobile/src/components/MandatoryUpdateGate.tsx",
  hostGate: "mingla-business/src/components/ui/MandatoryUpdateGate.tsx",
  consumerIdentity: "app-mobile/src/services/appVersionIdentity.ts",
  hostIdentity: "mingla-business/src/services/appVersionIdentity.ts",
  consumerSupabase: "app-mobile/src/services/supabase.ts",
  hostSupabase: "mingla-business/src/services/supabase.ts",
  evaluator: "supabase/functions/_shared/appVersionPolicy.ts",
  policyEndpoint: "supabase/functions/app-version-policy/index.ts",
  config: "supabase/config.toml",
  migration:
    "supabase/migrations/20270410001975_issue_2075_app_version_policies.sql",
};

const PROTECTED = [
  "brand-stripe-onboard",
  "brand-stripe-account-session",
  "brand-stripe-tax-account-session",
  "brand-paystack-onboard",
];
const FORBIDDEN = ["ticket-checkout-create", "ticket-checkout-confirm"];

function count(source, needle) {
  return source.split(needle).length - 1;
}

function validate(sources) {
  const failures = [];
  const requireText = (key, needle, label) => {
    if (!sources[key].includes(needle)) failures.push(label);
  };

  requireText("consumerRoot", "<MandatoryUpdateGate>", "Consumer root must mount MandatoryUpdateGate");
  requireText("hostRoot", "<MandatoryUpdateGate", "Host root must mount MandatoryUpdateGate");
  requireText("consumerGate", "MINGLA_WORDMARK", "Consumer gate must use canonical regular wordmark");
  requireText("hostGate", "MINGLA_WORDMARK", "Host gate must use canonical regular wordmark");
  requireText("consumerGate", "Update Mingla to continue", "Consumer approved title drifted");
  requireText("hostGate", "Update Host to continue", "Host approved title drifted");
  requireText("consumerGate", "borderRadius: 999", "Consumer update button must stay fully rounded");
  requireText("hostGate", "borderRadius: 999", "Host update button must stay fully rounded");
  requireText("consumerGate", "createAppVersionCoordinator", "Consumer gate must use bounded coordinator");
  requireText("hostGate", "foregroundEvent", "Host gate must consume the existing root lifecycle signal");
  if (sources.hostGate.includes("AppState.addEventListener")) {
    failures.push("Host gate must not add a duplicate AppState listener");
  }
  if (count(sources.hostRoot, "const handleAppStateChange =") !== 1) {
    failures.push("Host root must retain exactly one primary AppState change owner");
  }

  for (const key of ["consumerIdentity", "hostIdentity"]) {
    for (const header of [
      "X-Mingla-App-Id",
      "X-Mingla-App-Platform",
      "X-Mingla-App-Version",
    ]) {
      requireText(key, header, `${key} missing ${header}`);
    }
    requireText(key, "Constants.nativeAppVersion", `${key} must own installed native version truth`);
  }
  requireText("consumerSupabase", "getNativeAppVersionHeaders()", "Consumer Supabase must share version authority");
  requireText("hostSupabase", "getNativeAppVersionHeaders()", "Host Supabase must share version authority");

  requireText("evaluator", "isTrustedMinglaBrowserOrigin", "Edge evaluator must use explicit browser-origin trust");
  requireText("evaluator", 'status: 426', "Edge evaluator must return structured 426");
  requireText("policyEndpoint", "readAppVersionPolicy", "Public policy endpoint must read the private policy owner");
  requireText("config", "[functions.app-version-policy]", "Public policy endpoint must be registered in Supabase config");
  requireText("migration", "'1.1.4'", "Initial floor must remain the last verified public version");
  requireText("migration", "'observe'", "Selected Edge enforcement must seed dark in observe mode");

  for (const functionName of PROTECTED) {
    const source = sources[`protected:${functionName}`];
    const evaluatorIndex = source.indexOf("evaluateBusinessNativeVersion(");
    const authOrBodyIndex = Math.min(
      ...["requireUserId(req)", "req.json()", "decodeAndVerifyJwt(req)"]
        .map((needle) => source.indexOf(needle))
        .filter((index) => index >= 0),
    );
    if (evaluatorIndex < 0) failures.push(`${functionName} missing shared evaluator`);
    if (Number.isFinite(authOrBodyIndex) && evaluatorIndex > authOrBodyIndex) {
      failures.push(`${functionName} evaluator must run before auth/body/side effects`);
    }
  }
  for (const functionName of FORBIDDEN) {
    if (sources[`forbidden:${functionName}`].includes("evaluateBusinessNativeVersion")) {
      failures.push(`${functionName} must remain exempt from native version enforcement`);
    }
  }
  return failures;
}

function loadSources() {
  const sources = Object.fromEntries(
    Object.entries(FILES).map(([key, file]) => [key, read(file)]),
  );
  for (const name of PROTECTED) {
    sources[`protected:${name}`] = read(`supabase/functions/${name}/index.ts`);
  }
  for (const name of FORBIDDEN) {
    sources[`forbidden:${name}`] = read(`supabase/functions/${name}/index.ts`);
  }
  return sources;
}

const sources = loadSources();
if (process.argv.includes("--self-test")) {
  const baseline = validate(sources);
  if (baseline.length > 0) throw new Error(`baseline invalid: ${baseline.join("; ")}`);
  const reverted = {
    ...sources,
    consumerRoot: sources.consumerRoot.replace("<MandatoryUpdateGate>", "<React.Fragment>"),
  };
  if (!validate(reverted).some((failure) => failure.includes("Consumer root"))) {
    throw new Error("self-test failed: true gate revert was not detected");
  }
  console.log("#2075 force-update strict gate self-test: PASS");
  process.exit(0);
}

if (process.env.ISSUE_2075_SIMULATE_REVERT === "1") {
  sources.consumerRoot = sources.consumerRoot.replace(
    "<MandatoryUpdateGate>",
    "<React.Fragment>",
  );
}
const failures = validate(sources);
if (failures.length > 0) {
  for (const failure of failures) console.error(`#2075: ${failure}`);
  process.exit(1);
}
console.log("#2075 force-update structural contract: PASS");
