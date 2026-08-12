import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FRESHNESS_MS,
  deriveReadinessState,
  isIdentityResultStale,
  reasonCopy,
  validateIdentityPreflightResponse,
} from "../lib/adAppIdentityReadiness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const response = { app_key: "explorer", checked_at: "2026-08-12T01:55:00.000Z", overall: "ready", providers: [
  { provider: "meta", verdict: "ready", payer: { external_account_id: "2393570861066813" }, expected_identity: { username: "usemingla" }, matched_identity: { username: "usemingla" }, checks: [] },
  { provider: "tiktok", verdict: "ready", payer: { external_account_id: "7627974536397766673" }, expected_identity: { username: "usemingla" }, matched_identity: { username: "usemingla" }, checks: [] },
] };

test("#1928 accepts only exact app/provider order and fail-closed overall", () => {
  assert.equal(validateIdentityPreflightResponse(response, "explorer"), response);
  assert.equal(validateIdentityPreflightResponse({ ...response, app_key: "business" }, "explorer"), null);
  assert.equal(validateIdentityPreflightResponse({ ...response, providers: [...response.providers].reverse() }, "explorer"), null);
  const mixed = { ...response, overall: "ready", providers: [response.providers[0], { ...response.providers[1], verdict: "blocked" }] };
  assert.equal(validateIdentityPreflightResponse(mixed, "explorer"), null);
});

test("#1928 stale boundary is strict greater-than 15 minutes and never remains ready offline", () => {
  const checked = Date.parse(response.checked_at);
  assert.equal(FRESHNESS_MS, 900000);
  assert.equal(isIdentityResultStale(response.checked_at, checked + FRESHNESS_MS), false);
  assert.equal(isIdentityResultStale(response.checked_at, checked + FRESHNESS_MS + 1), true);
  assert.equal(deriveReadinessState({ phase: "ready", result: response }, { nowMs: checked + FRESHNESS_MS + 1 }), "stale");
  assert.equal(deriveReadinessState({ phase: "ready", result: response }, { online: false, nowMs: checked }), "offline");
});

test("#1928 maps every stable reason and keeps unknown reasons blocked", () => {
  const codes = ["app_registry_missing", "app_registry_inactive", "identity_registry_missing", "identity_registry_inactive", "identity_registry_invalid", "payer_connection_missing", "payer_connection_inactive", "payer_account_mismatch", "provider_unreachable", "provider_response_invalid", "identity_not_found", "identity_type_mismatch", "identity_username_mismatch", "identity_unavailable", "meta_page_not_authorized", "meta_instagram_mismatch", "meta_validate_only_failed"];
  for (const code of codes) assert.notEqual(reasonCopy(code, { appKey: "business", provider: "tiktok", username: "minglahost", expectedType: "BC_AUTH_TT" }).title, "Identity check blocked");
  assert.equal(reasonCopy("new_future_reason").title, "Identity check blocked");
});

test("#1928 panel implements all seven states, keyed cancellation, exact copy, and no persistence", () => {
  const panel = read("src/components/AppIdentityReadinessPanel.jsx");
  const page = read("src/pages/AdEnginePage.jsx");
  const service = read("src/services/adEngineService.js");
  for (const state of ["not_checked", "loading", "ready", "blocked", "error", "offline", "stale"]) assert.match(panel, new RegExp(`\\b${state}\\b`));
  assert.match(panel, /requestIds\.current\[requestedAppKey\]/);
  assert.match(panel, /controllers\.current\[outgoing\]\?\.abort\(\)/);
  assert.match(panel, /response app_key|validateIdentityPreflightResponse/);
  assert.match(panel, /This checks the public identity and shared payer only\. Native app campaigns are not enabled yet\./);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /aria-live="polite"/);
  assert.match(panel, /min-h-11/);
  assert.ok(page.indexOf("<AdConnectionsPanel />") < page.indexOf("<AppIdentityReadinessPanel />"));
  assert.ok(page.indexOf("<AppIdentityReadinessPanel />") < page.indexOf('title="Meta connection — detail"'));
  assert.match(service, /admin-ad-app-identity-preflight/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(panel, /Campaign ready|App install ready|Growth ready|Ready to launch/);
});
