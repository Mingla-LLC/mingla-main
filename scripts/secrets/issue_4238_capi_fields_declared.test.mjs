// MINGLA-INVARIANT: I-4238-CAPI-KEYS-DECLARED | issue #4238 | every env-var name a CAPI sender resolves by default for the consumer lane (resolveSenderConnection in supabase/functions/_shared/adConversionFire.ts) is a required field of AD_CONVERSION_TOKENS in supabase/secrets.manifest.json, so a governed rewrite that drops one is refused with governed_field_missing before any write.
/**
 * #4238 W1-1 (D1). On 30 Oct a governed rewrite of AD_CONVERSION_TOKENS
 * carried only the declared fields and silently deleted the four consumer
 * CAPI tokens, because they were never declared. These tests pin:
 *   (a) the consumer default token names in adConversionFire.ts are declared;
 *   (b) the setter refuses a payload that omits one of them;
 *   (c) the CI strict-grep gate lists them, so removing them reds CI.
 * Synthetic values only. No real secret value is read or written.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundleSetterError,
  prepareGovernedBundle,
} from "./set-governed-secret-bundle.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
);
const adRecord = manifest.secrets.find((record) =>
  record.name === "AD_CONVERSION_TOKENS"
);
const declared = new Set(adRecord.bundle_fields.map((field) => field.name));

/** Consumer-lane default token names, parsed from resolveSenderConnection. */
function consumerDefaultTokenNames() {
  const source = readFileSync(
    resolve(ROOT, "supabase/functions/_shared/adConversionFire.ts"),
    "utf8",
  );
  const start = source.indexOf("async function resolveSenderConnection(");
  assert.ok(start >= 0, "resolveSenderConnection not found");
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end);
  const names = new Set(
    [...body.matchAll(/"([A-Z][A-Z0-9_]*_TOKEN)"/g)].map((match) => match[1]),
  );
  // The business lane (MINGLABIZ) is deliberately not declared (spec W1-1, A4).
  return [...names].filter((name) => !name.includes("MINGLABIZ")).sort();
}

test("the four consumer CAPI token names are parsed from the sender resolver", () => {
  assert.deepEqual(consumerDefaultTokenNames(), [
    "META_CAPI_ACCESS_TOKEN",
    "REDDIT_ADS_CAPI_TOKEN",
    "SNAPCHAT_CAPI_TOKEN",
    "TIKTOK_EVENTS_ACCESS_TOKEN",
  ]);
});

test("every consumer default token name is a governed AD_CONVERSION_TOKENS field", () => {
  for (const name of consumerDefaultTokenNames()) {
    assert.ok(declared.has(name), `${name} is not a declared bundle field`);
    const field = adRecord.bundle_fields.find((entry) => entry.name === name);
    assert.equal(field.owner, "Growth Engineering");
    assert.equal(field.source_type, "provider_dashboard_and_secure_vault");
    assert.ok(!name.includes("_PREVIOUS"), `${name} would be optional`);
  }
  const names = adRecord.bundle_fields.map((field) => field.name);
  assert.deepEqual(names, [...names].sort(), "bundle_fields stay sorted");
});

function syntheticAdPayload() {
  const fields = [...declared].sort();
  const object = Object.fromEntries(
    fields.map((field) => [field, `synthetic-${field}`]),
  );
  object.NOTIFICATION_RECIPIENT_HMAC_SECRET = "h".repeat(32);
  object.ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT = "A".repeat(43);
  object.ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS = "B".repeat(43);
  object.BRAND_PERSON_ERASURE_CHALLENGE_SECRET = Buffer.alloc(32, 7)
    .toString("base64");
  const keyRings = [
    "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT",
    "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS",
    "SOURCE_REFUND_ATTENTION_IP_CURRENT",
    "SOURCE_REFUND_ATTENTION_IP_PREVIOUS",
    "SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT",
    "SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS",
    "VENUE_RESERVATION_MANAGE_TOKEN_CURRENT",
    "VENUE_RESERVATION_MANAGE_TOKEN_PREVIOUS",
  ];
  keyRings.forEach((prefix, index) => {
    object[`${prefix}_KID`] = `k${index + 1}`;
    object[`${prefix}_KEY_B64`] = Buffer.alloc(32, index + 1).toString(
      "base64",
    );
  });
  return object;
}

function prepare(bundleObject) {
  const fields = Object.keys(bundleObject).sort();
  const governed = new Map(
    adRecord.bundle_fields.map((field) => [field.name, field]),
  );
  return prepareGovernedBundle({
    bundleName: "AD_CONVERSION_TOKENS",
    bundleObject,
    attestations: Object.fromEntries(fields.map((field) => [field, {
      owner: governed.get(field).owner,
      source_type: governed.get(field).source_type,
    }])),
    previousFieldStates: Object.fromEntries(
      fields
        .filter((field) =>
          field.includes("_PREVIOUS_") || field.endsWith("_PREVIOUS")
        )
        .map((field) => [field, "present"]),
    ),
    authoritativeExistingFieldNames: fields,
    manifest,
  });
}

test("a complete payload carrying the four CAPI tokens is accepted", () => {
  const prepared = prepare(syntheticAdPayload());
  for (const name of consumerDefaultTokenNames()) {
    assert.ok(prepared.fieldNames.includes(name));
  }
});

test("a rewrite that drops META_CAPI_ACCESS_TOKEN is refused before any write", () => {
  const payload = syntheticAdPayload();
  delete payload.META_CAPI_ACCESS_TOKEN;
  assert.throws(() => prepare(payload), (error) => {
    assert.ok(error instanceof BundleSetterError);
    assert.equal(error.code, "governed_field_missing");
    assert.deepEqual(error.publicNames, ["META_CAPI_ACCESS_TOKEN"]);
    return true;
  });
});

test("a rewrite that drops all four CAPI tokens names all four", () => {
  const payload = syntheticAdPayload();
  for (const name of consumerDefaultTokenNames()) delete payload[name];
  assert.throws(() => prepare(payload), (error) => {
    assert.equal(error.code, "governed_field_missing");
    assert.deepEqual(error.publicNames, consumerDefaultTokenNames());
    return true;
  });
});

test("the 2241 strict-grep gate requires the four CAPI tokens", () => {
  const gate = readFileSync(
    resolve(ROOT, ".github/scripts/strict-grep/issue-2241-secret-readiness.mjs"),
    "utf8",
  );
  for (const name of consumerDefaultTokenNames()) {
    assert.match(gate, new RegExp(`"${name}"`));
  }
});
