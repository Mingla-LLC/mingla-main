#!/usr/bin/env node
/**
 * #426 G3 — CI contract: Sentry live gate scaffolding present.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const paths = {
  layout: join(root, "mingla-business/app/_layout.tsx"),
  appConfig: join(root, "mingla-business/app.config.ts"),
  envExample: join(root, "mingla-business/.env.example"),
  eas: join(root, "mingla-business/eas.json"),
  sentryEdge: join(root, "supabase/functions/_shared/sentryEdge.ts"),
  structuredLog: join(root, "supabase/functions/_shared/structuredLog.ts"),
  evidence: join(root, "docs/evidence/g3-sentry/README.md"),
  deploy: join(root, "scripts/ops/deploy-g3-sentry.sh"),
};

const layout = readFileSync(paths.layout, "utf8");
const appConfig = readFileSync(paths.appConfig, "utf8");
const envExample = readFileSync(paths.envExample, "utf8");
const eas = readFileSync(paths.eas, "utf8");
const sentryEdge = readFileSync(paths.sentryEdge, "utf8");
const structuredLog = readFileSync(paths.structuredLog, "utf8");

const checks = [
  [layout.includes("EXPO_PUBLIC_SENTRY_DSN"), "mingla-business DSN env guard"],
  [layout.includes("Sentry.init"), "mingla-business Sentry.init"],
  [layout.includes("environment:"), "mingla-business Sentry environment tag"],
  [appConfig.includes('organization: "mingla-llc"'), "Sentry org in expo plugin"],
  [appConfig.includes('project: "mingla-business"'), "Sentry project in expo plugin"],
  [envExample.includes("EXPO_PUBLIC_SENTRY_DSN"), "DSN documented in .env.example"],
  [eas.includes('"SENTRY_DISABLE_AUTO_UPLOAD": "false"'), "production source map upload enabled"],
  [sentryEdge.includes("captureEdgeException"), "edge Sentry capture helper"],
  [sentryEdge.includes("SENTRY_DSN"), "edge SENTRY_DSN secret hook"],
  [structuredLog.includes("captureEdgeException"), "structuredLog forwards errors to Sentry"],
  [readFileSync(paths.evidence, "utf8").includes("G3"), "G3 evidence README"],
  [readFileSync(paths.deploy, "utf8").includes("SENTRY_DSN"), "G3 deploy runbook"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL g3-sentry-contract: missing ${label}`);
    failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log("OK g3-sentry-contract");
