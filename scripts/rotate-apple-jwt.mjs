#!/usr/bin/env node
/**
 * Apple JWT auto-rotation script.
 *
 * Runs in GitHub Actions on a 5-month cron schedule (or manual trigger).
 * Generates a fresh 180-day Apple Sign in with Apple client_secret JWT,
 * PATCHes Supabase auth config to update external_apple_secret, verifies
 * the update by GET-checking the same field.
 *
 * Exit codes:
 *   0  success
 *   1  missing required env var
 *   2  JWT generation failed
 *   3  Supabase PAT auth failed (GET pre-flight returned 401/403)
 *   4  Supabase PATCH failed
 *   5  Supabase verification failed (PATCH succeeded but GET shows different value)
 *
 * Per ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
 * Spec: Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md
 * Investigation: Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md
 */

import jwt from "jsonwebtoken";

const REQUIRED_ENV = [
  "APPLE_P8_PRIVATE_KEY",
  "APPLE_TEAM_ID",
  "APPLE_SERVICE_ID",
  "APPLE_KEY_ID",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_MANAGEMENT_TOKEN",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("[fatal] missing env vars:", missing.join(", "));
  process.exit(1);
}

const {
  APPLE_P8_PRIVATE_KEY,
  APPLE_TEAM_ID,
  APPLE_SERVICE_ID,
  APPLE_KEY_ID,
  SUPABASE_PROJECT_REF,
  SUPABASE_MANAGEMENT_TOKEN,
} = process.env;

// ---------------------------------------------------------------------------
// Step 1: generate fresh JWT
// ---------------------------------------------------------------------------

let newJwt;
try {
  newJwt = jwt.sign({}, APPLE_P8_PRIVATE_KEY, {
    algorithm: "ES256",
    expiresIn: "180d",
    audience: "https://appleid.apple.com",
    issuer: APPLE_TEAM_ID,
    subject: APPLE_SERVICE_ID,
    keyid: APPLE_KEY_ID,
  });
} catch (err) {
  console.error("[fatal] JWT generation failed:", err.message);
  process.exit(2);
}

console.log("[info] JWT generated, length:", newJwt.length);

// ---------------------------------------------------------------------------
// Step 2: pre-flight — verify PAT works (GET auth config)
// ---------------------------------------------------------------------------

const baseUrl = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth`;
const headers = {
  Authorization: `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
  "Content-Type": "application/json",
};

const preflight = await fetch(baseUrl, { method: "GET", headers });
if (!preflight.ok) {
  console.error(
    `[fatal] Supabase PAT pre-flight failed: HTTP ${preflight.status} ${preflight.statusText}`,
  );
  console.error("[fatal] check that SUPABASE_MANAGEMENT_TOKEN is valid + not expired");
  process.exit(3);
}

console.log("[info] Supabase PAT verified (GET /config/auth returned 200)");

// ---------------------------------------------------------------------------
// Step 3: PATCH external_apple_secret
// ---------------------------------------------------------------------------

const patch = await fetch(baseUrl, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ external_apple_secret: newJwt }),
});

if (!patch.ok) {
  const errBody = await patch.text();
  console.error(
    `[fatal] PATCH /config/auth failed: HTTP ${patch.status} ${patch.statusText}`,
  );
  console.error("[fatal] response body:", errBody.slice(0, 1000));
  process.exit(4);
}

console.log("[info] PATCH succeeded");

// ---------------------------------------------------------------------------
// Step 4: verify — GET and confirm the JWT is in place
// ---------------------------------------------------------------------------
//
// Supabase masks/redacts the secret in the GET response (security best
// practice). We can't compare the full JWT verbatim. But we can confirm:
//   (a) external_apple_enabled is still true (not accidentally disabled)
//   (b) external_apple_client_id is still our Service ID (not blanked)
//   (c) external_apple_secret is non-empty and non-null
// If all three pass, the rotation took effect.

const verify = await fetch(baseUrl, { method: "GET", headers });
if (!verify.ok) {
  console.error(`[fatal] verification GET failed: HTTP ${verify.status}`);
  process.exit(5);
}
const cfg = await verify.json();

const expectedClientIdContains = APPLE_SERVICE_ID;
const enabled = cfg.external_apple_enabled === true;
const clientIdValid =
  typeof cfg.external_apple_client_id === "string" &&
  cfg.external_apple_client_id.includes(expectedClientIdContains);
const secretPresent =
  typeof cfg.external_apple_secret === "string" &&
  cfg.external_apple_secret.length > 0;

if (!enabled || !clientIdValid || !secretPresent) {
  console.error("[fatal] post-rotation verification failed:");
  console.error(`  external_apple_enabled: ${cfg.external_apple_enabled}`);
  console.error(`  external_apple_client_id: ${cfg.external_apple_client_id}`);
  console.error(
    `  external_apple_secret: ${secretPresent ? "<masked but present>" : "MISSING/EMPTY"}`,
  );
  process.exit(5);
}

console.log("[success] Apple JWT rotated. New expiry: 180 days from now.");
console.log("[success] external_apple_enabled:", enabled);
console.log("[success] external_apple_client_id:", cfg.external_apple_client_id);
console.log("[success] external_apple_secret: <masked but present>");

process.exit(0);
