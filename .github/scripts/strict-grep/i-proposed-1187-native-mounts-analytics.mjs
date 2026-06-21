#!/usr/bin/env node

/**
 * I-PROPOSED-1187-NATIVE-MOUNTS-ANALYTICS
 *   (META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 native)
 *
 * WHY (§9 native fails-on-revert): the PostHog native integration is only live
 * if (a) each app's root layout mounts the PostHog provider, and (b) the native
 * postHogService creates the client with masked session replay enabled. This is
 * the structural fails-on-revert safeguard for the native leg — the sibling of
 * the marketing-layout-mounts-analytics gate. If a developer reverts the
 * provider mount, or strips replay masking from the client constructor, this
 * gate FAILS.
 *
 * GATE:
 *   1. app-mobile/app/_layout.tsx AND mingla-business/app/_layout.tsx each mount
 *      <PostHogAnalyticsProvider>.
 *   2. Each native postHogService.ts enables session replay with masking
 *      (`enableSessionReplay: true` + `maskAllTextInputs: true` +
 *      `maskAllImages: true`).
 *
 * FAILS-ON-REVERT: deleting the provider mount or the masked-replay client
 * config fails this gate; restoring it passes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const errors = [];

function read(rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}

// (1) Provider mounted at each root layout.
for (const rel of ["app-mobile/app/_layout.tsx", "mingla-business/app/_layout.tsx"]) {
  const c = read(rel);
  if (c === null) {
    errors.push(`${rel}: MISSING — root layout must mount the PostHog provider.`);
    continue;
  }
  if (!/<PostHogAnalyticsProvider[\s>]/.test(c)) {
    errors.push(
      `${rel}: does not mount <PostHogAnalyticsProvider> — PostHog autocapture + ` +
        `session replay require the provider at the app root (META-ORCH-1187 §4.C).`,
    );
  }
}

// (2) Native service enables masked replay in the client constructor.
for (const rel of [
  "app-mobile/src/services/postHogService.ts",
  "mingla-business/src/services/postHogService.ts",
]) {
  const c = read(rel);
  if (c === null) {
    errors.push(`${rel}: MISSING — native PostHog service must exist.`);
    continue;
  }
  const enablesReplay = /enableSessionReplay\s*:\s*true/.test(c);
  const masksText = /maskAllTextInputs\s*:\s*true/.test(c);
  const masksImages = /maskAllImages\s*:\s*true/.test(c);
  if (!enablesReplay || !masksText || !masksImages) {
    errors.push(
      `${rel}: native session replay must be enabled WITH masking ` +
        `(enableSessionReplay:true + maskAllTextInputs:true + maskAllImages:true). ` +
        `A replay capturing PII is an AUTOMATIC FAIL (META-ORCH-1187 §4.H).`,
    );
  }
}

if (errors.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-NATIVE-MOUNTS-ANALYTICS violated");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "OK: I-PROPOSED-1187-NATIVE-MOUNTS-ANALYTICS — both apps mount the provider + masked native replay",
);
