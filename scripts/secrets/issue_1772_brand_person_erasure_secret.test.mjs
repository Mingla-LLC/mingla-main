import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const manifest = JSON.parse(read("supabase/secrets.manifest.json"));
const FIELD = "BRAND_PERSON_ERASURE_CHALLENGE_SECRET";
const READER = "supabase/functions/support-brand-person-erasure/erasureContract.ts";
const EXISTING_READERS = [
  "supabase/functions/_shared/capiTokens.ts",
  "supabase/functions/_shared/notificationRecipientHmac.ts",
  "supabase/functions/_shared/oneSignalEventStreamAuth.ts",
  "supabase/functions/_shared/sourceRefundAttentionToken.ts",
  "supabase/functions/_shared/sourceRefundNotificationRecipient.ts",
  "supabase/functions/_shared/adAppReadinessProviders/appsflyer.ts",
  "supabase/functions/admin-ad-app-readiness/index.ts",
  "supabase/functions/notify-dispatch/index.ts",
  "supabase/functions/onesignal-event-stream/index.ts",
  "supabase/functions/source-refund-attention/index.ts",
  "supabase/functions/notify-outbox-drain/index.ts",
];
const EXISTING_FIELDS = [
  ["APPSFLYER_API_V2_TOKEN", "Growth Engineering", "provider_dashboard_and_secure_vault"],
  ["NOTIFICATION_RECIPIENT_HMAC_SECRET", "Messaging Engineering", "secure_vault"],
  ["ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT", "Messaging Engineering", "secure_vault"],
  ["ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS", "Messaging Engineering", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID", "Payments Engineering", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64", "Payments Engineering", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KID", "Payments Engineering", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64", "Payments Engineering", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_IP_CURRENT_KID", "Platform Security", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64", "Platform Security", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KID", "Platform Security", "secure_vault"],
  ["SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KEY_B64", "Platform Security", "secure_vault"],
  ["SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID", "Messaging Engineering", "secure_vault"],
  ["SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64", "Messaging Engineering", "secure_vault"],
  ["SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KID", "Messaging Engineering", "secure_vault"],
  ["SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KEY_B64", "Messaging Engineering", "secure_vault"],
].map(([name, owner, source_type]) => ({ name, owner, source_type }));

// [TEST-MOD-APPROVED #2830] — Sites appends the approved slot-88 bundled
// security envelope; #1772's erasure field, reader, and ordering remain intact.
test("#1772 keeps the exact governed 88-name envelope with no direct secret name", () => {
  const names = manifest.secrets.map((entry) => entry.name);
  assert.equal(names.length, 88);
  assert.equal(
    crypto.createHash("sha256").update(JSON.stringify(names)).digest("hex"),
    "d307cb63164cee4b1ec96a74d3b69c87f5dcee061d01f7145a2a97f030aada3b",
  );
  assert.equal(manifest.rollout.expected_user_managed_count, 88);
  assert.deepEqual(manifest.exceptions, [
    {
      issue: 2830,
      owner: "Platform Security",
      approved_by: "Seth Ogieva (@sethogieva)",
      approved_at: "2026-08-30T03:40:33Z",
      first_set_not_before: "2026-08-30T03:40:33Z",
      next_review_at: "2026-09-29T03:40:33Z",
      expires_at: "2026-11-28T03:40:33Z",
      primary_owner_ack: "Platform Security, founder-approved",
      backup_owner_ack: "Platform Engineering, founder-approved",
    },
  ]);
  assert.equal(names.includes(FIELD), false);
  assert.equal(manifest.rollout.legacy_names.includes(FIELD), false);
  assert.equal(manifest.rollout.pending_bundle_names.includes(FIELD), false);
});

test("#1772 appends exactly one governed reader and field without changing predecessors", () => {
  const envelope = manifest.secrets.find((entry) => entry.name === "AD_CONVERSION_TOKENS");
  assert.ok(envelope);
  assert.deepEqual(envelope.readers.slice(0, -1), EXISTING_READERS);
  assert.equal(envelope.readers.at(-1), READER);
  assert.equal(envelope.readers.filter((value) => value === READER).length, 1);
  assert.deepEqual(envelope.bundle_fields.slice(0, -1), EXISTING_FIELDS);
  assert.deepEqual(envelope.bundle_fields.at(-1), {
    name: FIELD,
    owner: "Platform Security",
    source_type: "secure_vault",
  });
  assert.equal(envelope.bundle_fields.filter((value) => value.name === FIELD).length, 1);
});

test("#1772 resolver accepts only canonical standard Base64 decoding to 32–64 bytes", () => {
  const contractUrl = pathToFileURL(path.join(ROOT, READER)).href;
  const program = `
    import { resolveErasureChallengeKey } from ${JSON.stringify(contractUrl)};
    const field = ${JSON.stringify(FIELD)};
    const encode = (bytes) => btoa(String.fromCharCode(...bytes));
    const resolve = (value) => resolveErasureChallengeKey((name) =>
      name === "AD_CONVERSION_TOKENS" ? value : undefined
    );
    const pass = (size) => {
      const bytes = new Uint8Array(size).map((_, index) => (index * 17 + 3) % 256);
      const actual = resolve(JSON.stringify({ [field]: encode(bytes) }));
      if (actual.length !== bytes.length || actual.some((value, index) => value !== bytes[index])) {
        throw new Error("byte_mismatch");
      }
    };
    const fail = (bundle) => {
      try { resolve(bundle); } catch (error) {
        if (error?.code === "erasure_temporarily_unavailable" && error?.message === "erasure_temporarily_unavailable") return;
        throw new Error("unsafe_error_contract");
      }
      throw new Error("accepted_invalid_secret");
    };
    pass(32);
    pass(64);
    for (const size of [31, 65]) fail(JSON.stringify({ [field]: encode(new Uint8Array(size)) }));
    const canonical = encode(new Uint8Array(32));
    fail(JSON.stringify({ [field]: " " + canonical }));
    fail(JSON.stringify({ [field]: canonical + "\\n" }));
    fail(JSON.stringify({ [field]: "-" + canonical.slice(1) }));
    fail(JSON.stringify({ [field]: canonical.slice(0, -2) + "B=" }));
    fail(JSON.stringify({ [field]: canonical.slice(0, -1) + "!" }));
    fail(JSON.stringify({}));
    fail(JSON.stringify({ [field]: 1 }));
    fail("not json");
    fail(JSON.stringify([]));
    fail(JSON.stringify({ [field]: canonical, padding: "x".repeat(49 * 1024) }));
    console.log("resolver-contract-pass");
  `;
  const result = spawnSync("deno", ["eval", program], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || "Deno resolver contract failed");
  assert.equal(result.stdout.trim(), "resolver-contract-pass");
});

test("#1772 sole bundle reader and fail-closed handler ordering precede every side effect", () => {
  const contract = read(READER);
  const handler = read("supabase/functions/support-brand-person-erasure/index.ts");
  assert.equal((contract.match(/Deno\.env\.get\(/g) ?? []).length, 1);
  assert.match(contract, /Deno\.env\.get\(name\)/);
  assert.doesNotMatch(contract, /Deno\.env\.get\(["']BRAND_PERSON_ERASURE_CHALLENGE_SECRET["']\)/);
  assert.doesNotMatch(handler, /Deno\.env\.get\(["']BRAND_PERSON_ERASURE_CHALLENGE_SECRET["']\)/);

  const create = handler.slice(
    handler.indexOf('if (body.action === "create_challenge")'),
    handler.indexOf('if (body.action === "execute")'),
  );
  const createResolve = create.indexOf("key = deps.resolveKey()");
  assert.ok(createResolve > create.indexOf("exactKeys(body"));
  for (const effect of ["deps.randomUuid()", "deps.randomCode()", "deps.hash(", "await deps.rpc(", "await deps.sendEmail(", "await deps.sendSms("]) {
    assert.ok(createResolve < create.indexOf(effect), `create must resolve before ${effect}`);
  }

  const execute = handler.slice(handler.indexOf('if (body.action === "execute")'));
  const executeResolve = execute.indexOf("key = deps.resolveKey()");
  assert.ok(executeResolve > execute.indexOf("exactKeys(body"));
  for (const effect of ["deps.hash(", "await deps.rpc("]) {
    assert.ok(executeResolve < execute.indexOf(effect), `execute must resolve before ${effect}`);
  }
  assert.match(handler, /errorResponse\(req, "erasure_temporarily_unavailable", 503\)/);
  assert.match(handler, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(handler, /response\([^)]*(?:destination|codeHash|verificationHash|keyBytes)/s);
});

test("#1772 existing provider executes the Node proof before both happy Deno suites", () => {
  const workflow = read(".github/workflows/supabase-migrations-and-stripe-deno.yml");
  const nodeCommand = "node --test scripts/secrets/issue_1772_brand_person_erasure_secret.test.mjs";
  const erasureDeno = "supabase/functions/support-brand-person-erasure/issue_1772_non_user_erasure.happy.test.ts";
  const workerDeno = "supabase/functions/brand-person-ingest-worker/issue_1772_erasure_tombstone.happy.test.ts";
  assert.ok(workflow.indexOf(nodeCommand) >= 0);
  assert.ok(workflow.indexOf(nodeCommand) < workflow.indexOf(erasureDeno));
  assert.ok(workflow.indexOf(nodeCommand) < workflow.indexOf(workerDeno));
});
