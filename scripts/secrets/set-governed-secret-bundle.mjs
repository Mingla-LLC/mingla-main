#!/usr/bin/env node
/**
 * Complete-object, value-silent governed bundle setter (#2241).
 *
 * Production callers use the in-memory coordinator. This module intentionally
 * has no standalone production CLI that could turn a persisted receipt into
 * deploy authority.
 */

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyProductionAuthority } from "../ops/verify-production-supabase-authority.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_MANIFEST = resolve(
  REPO_ROOT,
  "supabase",
  "secrets.manifest.json",
);
const MAX_BUNDLE_BYTES = 48 * 1024;
const SAFE_AD_FIELD = /^[A-Z][A-Z0-9_]{1,127}$/;
const PRESENCE = new Set(["present", "intentionally_absent"]);
const KID = /^[a-z0-9_-]{1,16}$/;
const ONE_SIGNAL_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

export class BundleSetterError extends Error {
  constructor(code, publicNames = []) {
    super(code);
    this.name = "BundleSetterError";
    this.code = code;
    this.publicNames = [...new Set(publicNames)].sort();
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function exactSet(left, right) {
  return JSON.stringify(sortedUnique(left)) ===
    JSON.stringify(sortedUnique(right));
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function manifestRecord(manifest, bundleName) {
  const records = manifest.secrets.filter((record) =>
    record.name === bundleName
  );
  if (records.length !== 1 || records[0].bundle_fields.length === 0) {
    throw new BundleSetterError("governed_bundle_manifest_missing", [
      bundleName,
    ]);
  }
  return records[0];
}

function previousFields(record) {
  return record.bundle_fields
    .map((field) => field.name)
    .filter((name) =>
      name.includes("_PREVIOUS_") || name.endsWith("_PREVIOUS")
    );
}

function validatePreviousPairing(fields, states, object) {
  for (const field of fields) {
    const state = states?.[field];
    if (!PRESENCE.has(state)) {
      throw new BundleSetterError("previous_field_attestation_missing", [
        field,
      ]);
    }
    if (state === "present" && !Object.hasOwn(object, field)) {
      throw new BundleSetterError("previous_field_marked_present_but_missing", [
        field,
      ]);
    }
    if (state === "intentionally_absent" && Object.hasOwn(object, field)) {
      throw new BundleSetterError("previous_field_marked_absent_but_present", [
        field,
      ]);
    }
    const pair = field.endsWith("_KID")
      ? `${field.slice(0, -4)}_KEY_B64`
      : field.endsWith("_KEY_B64")
      ? `${field.slice(0, -8)}_KID`
      : null;
    if (pair !== null && fields.includes(pair) && states?.[pair] !== state) {
      throw new BundleSetterError("previous_pair_incomplete", [field, pair]);
    }
  }
}

function decodeCanonicalBase64(value, minimumBytes, maximumBytes, field) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
      .test(value)
  ) throw new BundleSetterError("ad_bundle_strict_parser_invalid", [field]);
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    decoded.byteLength < minimumBytes ||
    decoded.byteLength > maximumBytes
  ) throw new BundleSetterError("ad_bundle_strict_parser_invalid", [field]);
  return decoded;
}

function validateExistingAdParsers(bundleObject) {
  if (
    bundleObject.NOTIFICATION_RECIPIENT_HMAC_SECRET.trim().length < 32
  ) {
    throw new BundleSetterError("ad_bundle_strict_parser_invalid", [
      "NOTIFICATION_RECIPIENT_HMAC_SECRET",
    ]);
  }

  const oneSignalCurrent = bundleObject.ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT;
  const oneSignalPrevious = bundleObject.ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS;
  if (
    !ONE_SIGNAL_TOKEN.test(oneSignalCurrent) ||
    (oneSignalPrevious !== undefined &&
      !ONE_SIGNAL_TOKEN.test(oneSignalPrevious)) ||
    oneSignalPrevious === oneSignalCurrent
  ) {
    throw new BundleSetterError("ad_bundle_strict_parser_invalid", [
      "ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT",
      "ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS",
    ]);
  }

  const slots = [
    [
      "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID",
      "SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KID",
      "SOURCE_REFUND_ATTENTION_TOKEN_PREVIOUS_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_IP_CURRENT_KID",
      "SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KID",
      "SOURCE_REFUND_ATTENTION_IP_PREVIOUS_KEY_B64",
    ],
    [
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID",
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64",
    ],
    [
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KID",
      "SOURCE_REFUND_NOTIFICATION_RECIPIENT_PREVIOUS_KEY_B64",
    ],
  ].flatMap(([kidField, keyField]) => {
    const kid = bundleObject[kidField];
    const encoded = bundleObject[keyField];
    if (kid === undefined && encoded === undefined) return [];
    if (typeof kid !== "string" || !KID.test(kid)) {
      throw new BundleSetterError("ad_bundle_strict_parser_invalid", [
        kidField,
      ]);
    }
    return [{
      kid,
      kidField,
      key: decodeCanonicalBase64(encoded, 32, 32, keyField),
      keyField,
    }];
  });
  for (let left = 0; left < slots.length; left += 1) {
    for (let right = left + 1; right < slots.length; right += 1) {
      if (
        slots[left].kid === slots[right].kid ||
        slots[left].key.equals(slots[right].key)
      ) {
        throw new BundleSetterError("ad_bundle_strict_parser_invalid", [
          slots[left].kidField,
          slots[left].keyField,
          slots[right].kidField,
          slots[right].keyField,
        ]);
      }
    }
  }

  decodeCanonicalBase64(
    bundleObject.BRAND_PERSON_ERASURE_CHALLENGE_SECRET,
    32,
    64,
    "BRAND_PERSON_ERASURE_CHALLENGE_SECRET",
  );
}

function validateAttestations(
  { objectFields, record, attestations, absentPrevious },
) {
  if (!isRecord(attestations)) {
    throw new BundleSetterError("attestations_missing");
  }
  const governed = new Map(
    record.bundle_fields.map((field) => [field.name, field]),
  );
  const expected = sortedUnique([...objectFields, ...absentPrevious]);
  if (!exactSet(Object.keys(attestations), expected)) {
    throw new BundleSetterError("attestation_field_set_mismatch");
  }
  for (const field of expected) {
    const attestation = attestations[field];
    if (
      !isRecord(attestation) ||
      Object.keys(attestation).sort().join(",") !== "owner,source_type" ||
      typeof attestation.owner !== "string" ||
      attestation.owner.length === 0 ||
      typeof attestation.source_type !== "string" ||
      attestation.source_type.length === 0
    ) throw new BundleSetterError("source_owner_attestation_invalid", [field]);
    const governedField = governed.get(field);
    if (
      governedField &&
      (attestation.owner !== governedField.owner ||
        attestation.source_type !== governedField.source_type)
    ) throw new BundleSetterError("source_owner_attestation_mismatch", [field]);
  }
}

function validateAdBundle({ bundleObject, record, previousFieldStates }) {
  const fields = Object.keys(bundleObject);
  if (
    fields.length === 0 ||
    fields.some((field) => !SAFE_AD_FIELD.test(field)) ||
    Object.values(bundleObject).some((value) =>
      typeof value !== "string" || value.length === 0
    )
  ) throw new BundleSetterError("ad_bundle_shape_invalid");
  const previous = previousFields(record);
  validatePreviousPairing(previous, previousFieldStates, bundleObject);
  const optionalPrevious = new Set(
    previous.filter((field) =>
      previousFieldStates[field] === "intentionally_absent"
    ),
  );
  const missing = record.bundle_fields
    .map((field) => field.name)
    .filter((field) =>
      !optionalPrevious.has(field) && !Object.hasOwn(bundleObject, field)
    );
  if (missing.length > 0) {
    throw new BundleSetterError("governed_field_missing", missing);
  }
  validateExistingAdParsers(bundleObject);
  return {
    absentPrevious: [...optionalPrevious].sort(),
    fieldNames: fields.sort(),
  };
}

const V3_PAYMENT_FIELDS = [
  "paystack_payout_hold_onboard_flip",
  "payout_hold_onboard_flip",
  "payout_release_execute",
  "source_refunds_post_disabled",
];
const V4_PAYMENT_FIELDS = [
  ...V3_PAYMENT_FIELDS,
  "checkout_revocation_execute",
].sort();

function validateDeliveryBundle(bundleObject) {
  if (!isRecord(bundleObject)) {
    throw new BundleSetterError("delivery_not_object");
  }
  const version = bundleObject.schema_version;
  if (version !== 3 && version !== 4) {
    throw new BundleSetterError("delivery_schema_version_invalid");
  }
  if (
    !exactSet(Object.keys(bundleObject), [
      "schema_version",
      "marketing_send_live_enabled",
      "sms_live_enabled",
      "payment_operations",
    ]) ||
    typeof bundleObject.marketing_send_live_enabled !== "boolean" ||
    !isRecord(bundleObject.sms_live_enabled) ||
    !exactSet(Object.keys(bundleObject.sms_live_enabled), ["ng", "us"]) ||
    typeof bundleObject.sms_live_enabled.ng !== "boolean" ||
    typeof bundleObject.sms_live_enabled.us !== "boolean" ||
    !isRecord(bundleObject.payment_operations)
  ) throw new BundleSetterError("delivery_shape_invalid");
  const expectedPayment = version === 4 ? V4_PAYMENT_FIELDS : V3_PAYMENT_FIELDS;
  if (
    !exactSet(Object.keys(bundleObject.payment_operations), expectedPayment) ||
    expectedPayment.some((field) =>
      typeof bundleObject.payment_operations[field] !== "boolean"
    )
  ) throw new BundleSetterError("delivery_payment_operations_invalid");
  return {
    absentPrevious: [],
    fieldNames: [
      "marketing_send_live_enabled",
      ...expectedPayment,
      "sms_live_enabled.ng",
      "sms_live_enabled.us",
    ].sort(),
  };
}

/** Validate a complete authoritative bundle without writing or logging it. */
export function prepareGovernedBundle({
  bundleName,
  bundleObject,
  attestations,
  previousFieldStates = {},
  authoritativeExistingFieldNames,
  manifest,
}) {
  if (!isRecord(bundleObject)) throw new BundleSetterError("bundle_not_object");
  if (serializedBytes(bundleObject) >= MAX_BUNDLE_BYTES) {
    throw new BundleSetterError("bundle_oversized", [bundleName]);
  }
  const record = manifestRecord(manifest, bundleName);
  let result;
  if (bundleName === "AD_CONVERSION_TOKENS") {
    result = validateAdBundle({ bundleObject, record, previousFieldStates });
  } else if (bundleName === "MINGLA_DELIVERY_FLAGS_JSON") {
    result = validateDeliveryBundle(bundleObject);
  } else throw new BundleSetterError("bundle_not_supported", [bundleName]);

  if (!Array.isArray(authoritativeExistingFieldNames)) {
    throw new BundleSetterError("preservation_attestation_missing", [
      bundleName,
    ]);
  }
  const missingExisting = authoritativeExistingFieldNames.filter((field) =>
    !result.fieldNames.includes(field)
  );
  if (missingExisting.length > 0) {
    throw new BundleSetterError("existing_field_omitted", missingExisting);
  }
  validateAttestations({
    objectFields: result.fieldNames,
    record,
    attestations,
    absentPrevious: result.absentPrevious,
  });
  return {
    bundleName,
    bundleObject,
    fieldNames: result.fieldNames,
    parserPass: true,
    preservationPass: true,
    schemaVersion: typeof bundleObject.schema_version === "number"
      ? bundleObject.schema_version
      : null,
    sourceOwnerAttestationPass: true,
  };
}

/**
 * Encode one value exactly as github.com/joho/godotenv v1.5.1 Marshal does.
 * Supabase CLI v2.98.2 parses --env-file through that library. Double quoting
 * plus escaping its complete special-character set prevents interpolation,
 * comment parsing, or whitespace trimming from changing opaque credentials.
 */
export function serializeDotenvAssignment(name, value) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== "string") {
    throw new BundleSetterError("dotenv_assignment_invalid", [name]);
  }
  let encoded = "";
  for (const character of value) {
    if (character === "\\") encoded += "\\\\";
    else if (character === "\n") encoded += "\\n";
    else if (character === "\r") encoded += "\\r";
    else if (character === '"') encoded += '\\"';
    else if (character === "!") encoded += "\\!";
    else if (character === "$") encoded += "\\$";
    else if (character === "`") encoded += "\\`";
    else encoded += character;
  }
  return `${name}="${encoded}"\n`;
}

/** Apply exactly one already-prepared existing secret via stdin, never argv. */
export function applyPreparedGovernedBundle({
  prepared,
  projectRef,
  liveNames,
  spawn = spawnSync,
}) {
  verifyProductionAuthority({ targetRef: projectRef });
  if (!Array.isArray(liveNames) || !liveNames.includes(prepared.bundleName)) {
    throw new BundleSetterError("named_existing_secret_missing", [
      prepared.bundleName,
    ]);
  }
  const dotenv = serializeDotenvAssignment(
    prepared.bundleName,
    JSON.stringify(prepared.bundleObject),
  );
  const result = spawn(
    "supabase",
    [
      "secrets",
      "set",
      "--project-ref",
      projectRef,
      "--env-file",
      "/dev/stdin",
    ],
    {
      input: dotenv,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new BundleSetterError("bundle_set_failed", [prepared.bundleName]);
  }
  return {
    bundleName: prepared.bundleName,
    fieldNames: prepared.fieldNames,
    parserPass: prepared.parserPass,
    preservationPass: prepared.preservationPass,
    schemaVersion: prepared.schemaVersion,
    sourceOwnerAttestationPass: prepared.sourceOwnerAttestationPass,
  };
}

export function loadSecureBundleInput(path) {
  if (path === "-") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0) {
    throw new BundleSetterError("input_file_mode_not_0600");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadManifest(path = DEFAULT_MANIFEST) {
  return JSON.parse(readFileSync(path, "utf8"));
}
