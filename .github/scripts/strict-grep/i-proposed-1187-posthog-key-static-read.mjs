#!/usr/bin/env node

/**
 * I-PROPOSED-1187-POSTHOG-KEY-STATIC-READ
 *   (META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 native)
 *
 * WHY (COMMS-0028 env reachability): on the Expo native apps a DYNAMIC
 * `process.env[<var>]` bracket read is NOT inlined by babel-preset-expo and is
 * `undefined` in Hermes standalone / OTA builds. The PostHog key MUST therefore
 * be read either from `Constants.expoConfig.extra` (which the app.config.ts
 * emits and survives Hermes/OTA) or via a STATIC `process.env.EXPO_PUBLIC_*`
 * member access (which IS inlined) — never a dynamic bracket lookup. This mirrors
 * the supabase/giphy/mapbox key-reachability contract.
 *
 * GATE: in the native postHogService modules (app-mobile + mingla-business), the
 * PostHog key/host MUST NOT be read via a dynamic `process.env[...]` bracket
 * access, AND a static `Constants.expoConfig?.extra` read MUST be present.
 *
 * SCOPE: the two native postHogService.ts files (the single key-resolution
 * owner per app). Tests / artifacts exempt.
 *
 * FAILS-ON-REVERT: switching the key read to `process.env[name]` (or deleting
 * the Constants.expoConfig.extra read) fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TARGETS = [
  "app-mobile/src/services/postHogService.ts",
  "mingla-business/src/services/postHogService.ts",
];

// Dynamic bracket read of process.env — the COMMS-0028 footgun.
const DYNAMIC_PROCESS_ENV = /process\.env\s*\[/;
// The required runtime-safe extra read.
const EXTRA_READ = /Constants\.expoConfig\?\.extra/;

// Strip comments so doc-comment prose (e.g. "never a dynamic process.env[name]
// read") does not trip the dynamic-read detector — only real CODE is checked.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const errors = [];

for (const rel of TARGETS) {
  const full = path.join(repoRoot, rel);
  let raw;
  try {
    raw = fs.readFileSync(full, "utf8");
  } catch {
    errors.push(`${rel}: MISSING — the native PostHog key-resolution owner must exist.`);
    continue;
  }
  const contents = stripComments(raw);
  if (DYNAMIC_PROCESS_ENV.test(contents)) {
    errors.push(
      `${rel}: dynamic process.env[...] read of the PostHog key — NOT inlined by ` +
        `babel-preset-expo, undefined in Hermes/OTA (COMMS-0028). Use ` +
        `Constants.expoConfig.extra or a STATIC process.env.EXPO_PUBLIC_X member access.`,
    );
  }
  if (!EXTRA_READ.test(contents)) {
    errors.push(
      `${rel}: missing the Constants.expoConfig?.extra key read — the runtime-safe ` +
        `path (mirrors supabase.ts). The key must survive Hermes standalone / OTA builds.`,
    );
  }
}

if (errors.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-POSTHOG-KEY-STATIC-READ violated (COMMS-0028)");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nThe native PostHog key MUST be read statically (Constants.expoConfig.extra / " +
      "static process.env) — never a dynamic process.env[...] bracket lookup. (META-ORCH-1187)",
  );
  process.exit(1);
}

console.log(
  "OK: I-PROPOSED-1187-POSTHOG-KEY-STATIC-READ — both native postHogService modules read the key safely",
);
