#!/usr/bin/env node
/**
 * Tester-owned #1770 adversarial guard.
 *
 * Different angle from the implementation guard: this verifies control-flow
 * ordering and branch isolation around the OneSignal point of no return. Mere
 * token presence is insufficient; unavailable authority must return while the
 * attempt is queued, and the sole claim hook must sit immediately before fetch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = {
  notify: "supabase/functions/_shared/notifyV2.ts",
  push: "supabase/functions/_shared/push-utils.ts",
  dispatch: "supabase/functions/offering-invite-dispatch/index.ts",
};

function position(source, token, label, failures) {
  const index = source.indexOf(token);
  if (index < 0) failures.push(`${label}: missing ${token}`);
  return index;
}

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  return start < 0 || end < 0 ? "" : source.slice(start, end);
}

export function violations(files) {
  const failures = [];
  const notifyFile = files.notify ?? "";
  const notify = between(
    notifyFile,
    "async function dispatchPersistedOfferingPush(",
    "export interface SourceRefundChannelInput",
  );
  const push = files.push ?? "";
  const dispatch = files.dispatch ?? "";

  const validate = position(notify, "validatePersistedOfferingPushV1(", "notify order", failures);
  const category = position(notify, 'client.from(\n    "notification_categories",', "notify order", failures);
  const inbox = position(notify, 'client.from("notifications").insert({', "notify order", failures);
  const policy = position(notify, 'client.rpc("can_send", {', "notify order", failures);
  const adapter = position(notify, "await pushAdapter.send({", "notify order", failures);
  const claim = position(notify, 'client.rpc("biz_claim_offering_push_provider_io", {', "notify order", failures);
  if (!(validate < category && category < inbox && inbox < policy && policy < adapter && adapter < claim)) {
    failures.push("notify order: payload -> category -> inbox -> policy -> adapter -> claim-hook drifted");
  }

  const categoryUnavailable = between(notify, "if (categoryError) {", "const category =");
  if (!categoryUnavailable.includes('reason: "category_lookup_unavailable"') ||
      categoryUnavailable.includes("recordOfferingPushResult") ||
      categoryUnavailable.includes("pushAdapter.send")) {
    failures.push("category unavailable: must return queued with no projector/adapter");
  }
  const policyUnavailable = between(notify, "if (policy.error) {", "if (policy.data !== true)");
  if (!policyUnavailable.includes('reason: "can_send_unavailable"') ||
      policyUnavailable.includes("recordOfferingPushResult") ||
      policyUnavailable.includes("pushAdapter.send")) {
    failures.push("policy unavailable: must return queued with no projector/adapter");
  }
  const reloadUnavailable = between(notify, "if (existing.error) {", "const row = existing.data");
  if (!reloadUnavailable.includes('reason: "inbox_unavailable"') ||
      reloadUnavailable.includes("recordOfferingPushResult")) {
    failures.push("inbox reload unavailable: must not fabricate a collision/result");
  }

  const requestBuilt = position(push, "const oneSignalPayload = {", "push order", failures);
  const hook = position(push, "claim = await payload.beforeProviderIo();", "push order", failures);
  const tuple = position(push, "claim.attemptId !== payload.offeringAttemptId", "push order", failures);
  const fetch = position(push, 'providerPromise = fetch("https://api.onesignal.com/notifications", {', "push order", failures);
  if (!(requestBuilt < hook && hook < tuple && tuple < fetch)) {
    failures.push("push order: request -> one hook -> tuple assertion -> fetch drifted");
  }
  if ((push.match(/claim = await payload\.beforeProviderIo\(\);/g) ?? []).length !== 1) {
    failures.push("push hook: offering claim hook must be invoked exactly once");
  }
  const hookToFetch = push.slice(hook, fetch)
    .replace("claim = await payload.beforeProviderIo();", "claim = payload.beforeProviderIo;")
    .replace(
    "} else await payload.beforeProviderIo?.();",
    "} else payload.beforeProviderIo;",
  );
  if (/\bawait\b/.test(hookToFetch) || /setTimeout\s*\(\s*async/.test(hookToFetch)) {
    failures.push("push boundary: async work exists between tuple assertion and fetch");
  }
  if (!push.includes("idempotency_key: payload.oneSignalIdempotencyKey") ||
      push.includes("idempotency_key: payload.internalProviderClaimKey")) {
    failures.push("push keys: OneSignal must receive only the canonical attempt UUID");
  }
  if (!dispatch.includes("offering_attempt_id: claimed.attemptId") ||
      !dispatch.includes("internal_provider_claim_key: claimed.internalProviderClaimKey") ||
      !dispatch.includes("onesignal_idempotency_key: claimed.oneSignalIdempotencyKey")) {
    failures.push("dispatch authority: explicit attempt and both distinct keys are required");
  }
  if (/split\([^\n]*offering|match\([^\n]*offering|replace\([^\n]*offering/.test(notify)) {
    failures.push("dispatch authority: attempt identity must not be parsed from a key");
  }
  return failures;
}

function readFiles() {
  return Object.fromEntries(Object.entries(FILES).map(([key, relative]) => [
    key,
    fs.readFileSync(path.join(ROOT, relative), "utf8"),
  ]));
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const mutations = [
    ["notify", "if (categoryError) {", "if (!catData) {", "category error collapsed into data"],
    ["notify", "if (policy.error) {", "if (policy.data !== true) {", "policy error collapsed into denial"],
    ["notify", 'return { success: false, reason: "inbox_unavailable" };', 'return { success: false, reason: "inbox_idempotency_collision" };', "reload outage fabricated collision"],
    ["push", "claim = await payload.beforeProviderIo();", "claim = await payload.beforeProviderIo();\n      await Promise.resolve();", "async gap after claim"],
    ["push", "idempotency_key: payload.oneSignalIdempotencyKey", "idempotency_key: payload.internalProviderClaimKey", "provider key swap"],
    ["dispatch", "offering_attempt_id: claimed.attemptId", "offering_attempt_id: claimed.internalProviderClaimKey", "explicit attempt authority removed"],
  ];
  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) throw new Error(`self-test fixture missing: ${label}`);
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }
  console.log("#1770 tester late-PONR self-test PASS (6 true mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1770 tester late-PONR guard PASS");
}
