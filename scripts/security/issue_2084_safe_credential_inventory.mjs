#!/usr/bin/env node

import { createHash, timingSafeEqual } from "node:crypto";
import { readSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_INPUT_BYTES = 1024 * 1024;

const SAFE_LABELS = new Set([
  "LIVE_CONNECT_WEBHOOK",
  "LIVE_PLATFORM_WEBHOOK",
  "TEST_CONNECT_WEBHOOK",
  "TEST_PLATFORM_WEBHOOK",
  "TEST_STANDARD_KEY",
  "UNNAMED_LEGACY_RAK",
  "RAK_ONBOARD_TEST",
  "RAK_WEBHOOK_TEST",
  "RAK_REFRESH_STATUS_TEST",
  "RAK_DETACH_TEST",
  "RAK_BALANCES_TEST",
  "RAK_KYC_REMINDER_TEST",
  "RAK_TICKET_CHECKOUT_TEST",
  "RAK_TICKET_REFUND_TEST",
  "STRIPE_CLI_CREDENTIAL",
]);

const SAFE_COMPARISON_SLOTS = new Set([
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_SECRET_PLATFORM",
  "STRIPE_RAK_ONBOARD_TEST",
  "STRIPE_RAK_WEBHOOK_TEST",
  "STRIPE_RAK_REFRESH_STATUS_TEST",
  "STRIPE_RAK_DETACH_TEST",
  "STRIPE_RAK_BALANCES_TEST",
  "STRIPE_RAK_KYC_REMINDER_TEST",
  "STRIPE_RAK_TICKET_CHECKOUT_TEST",
  "STRIPE_RAK_TICKET_REFUND_TEST",
  "STRIPE_STANDARD_TEST_KEY",
  "STRIPE_CLI_CREDENTIAL",
]);

export const SAFE_PATH_IDS = new Set([
  "MASTER_INVENTORY",
  "CODEX_SESSION",
  "STRIPE_CLI_CONFIG",
  "SHELL_HISTORY",
  "APPROVED_TEMP",
  "SUPABASE_SECRET_SLOT",
  "PROVIDER_DASHBOARD",
]);

const RECORD_KEYS = ["label", "path", "value"];
const COMPARISON_KEYS = ["left", "right", "slot"];
const ROOT_KEYS = ["comparisons", "records", "schemaVersion"];
const CREDENTIAL_PREFIXES = ["whsec_", "sk_test_", "sk_live_", "rk_test_", "rk_live_", "pk_test_", "pk_live_"];

class SafeInventoryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function containsControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function credentialLike(value) {
  const lower = value.toLowerCase();
  return CREDENTIAL_PREFIXES.some((prefix) => lower.includes(prefix))
    || /(?:authorization|x-api-key|api[_-]?key)\s*[:=]/iu.test(value)
    || /bearer\s+[a-z0-9._~-]{8,}/iu.test(value)
    || /https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=/iu.test(value);
}

export function detectCredentialClass(value) {
  if (/^whsec_[A-Za-z0-9_-]+$/u.test(value)) return "WEBHOOK_SIGNING";
  if (/^sk_(?:test|live)_[A-Za-z0-9_-]+$/u.test(value)) return "SECRET_API";
  if (/^rk_(?:test|live)_[A-Za-z0-9_-]+$/u.test(value)) return "RESTRICTED_API";
  if (/^pk_(?:test|live)_[A-Za-z0-9_-]+$/u.test(value)) return "PUBLISHABLE_API";
  if (/^Bearer\s+\S+$/iu.test(value)) return "BEARER";
  if (/^(?:eyJ[A-Za-z0-9_-]+)\.(?:[A-Za-z0-9_-]+)\.(?:[A-Za-z0-9_-]+)$/u.test(value)) return "JWT";
  if (/^(?:Authorization|X-Api-Key|Api-Key)\s*:\s*\S.+$/iu.test(value)) return "AUTHORIZATION_HEADER";
  if (/^https?:\/\/[^\s]+[?&](?:token|secret|key|signature)=[^&#\s]+/iu.test(value)) return "SENSITIVE_URL";
  if (credentialLike(value)) return "ERROR_PAYLOAD";
  throw new SafeInventoryError("UNKNOWN_CREDENTIAL_CLASS");
}

function safePath(path) {
  if (SAFE_PATH_IDS.has(path)) return path;
  if (containsControlCharacters(path)
    || path.includes("..")
    || credentialLike(path)
    || /(?:authorization|cookie|token|secret|signature|password|credential)/iu.test(path)
    || /[?&#=]/u.test(path)) {
    throw new SafeInventoryError("SENSITIVE_PATH_INPUT");
  }
  return "UNCLASSIFIED_PATH";
}

function safeDigest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

function valuesMatch(left, right) {
  const leftDigest = safeDigest(left);
  const rightDigest = safeDigest(right);
  try {
    const equal = timingSafeEqual(leftDigest, rightDigest);
    return equal;
  } finally {
    leftDigest.fill(0);
    rightDigest.fill(0);
  }
}

export function runInventory(input) {
  if (!exactKeys(input, ROOT_KEYS) || input.schemaVersion !== 1 || !Array.isArray(input.records) || !Array.isArray(input.comparisons)) {
    throw new SafeInventoryError("INVALID_SCHEMA");
  }

  const values = [];
  const records = input.records.map((record) => {
    if (!exactKeys(record, RECORD_KEYS)
      || !SAFE_LABELS.has(record.label)
      || typeof record.path !== "string"
      || typeof record.value !== "string"
      || containsControlCharacters(record.value)) {
      throw new SafeInventoryError("INVALID_RECORD");
    }
    const credentialClass = detectCredentialClass(record.value);
    const path = safePath(record.path);
    values.push(record.value);
    return { label: record.label, path, credentialClass };
  });

  const comparisons = input.comparisons.map((comparison) => {
    if (!exactKeys(comparison, COMPARISON_KEYS)
      || !Number.isInteger(comparison.left)
      || !Number.isInteger(comparison.right)
      || comparison.left < 0
      || comparison.right < 0
      || comparison.left >= values.length
      || comparison.right >= values.length
      || !SAFE_COMPARISON_SLOTS.has(comparison.slot)) {
      throw new SafeInventoryError("INVALID_COMPARISON");
    }
    return {
      slot: comparison.slot,
      result: valuesMatch(values[comparison.left], values[comparison.right]) ? "MATCH" : "NO_MATCH",
    };
  });

  values.fill("");
  return { ok: true, count: records.length, records, comparisons };
}

export function safeFailure(error) {
  const code = error instanceof SafeInventoryError ? error.code : "INVENTORY_FAILED";
  return { ok: false, error: code };
}

export function parseCliArgs(argv) {
  if (argv.length === 0) return 0;
  if (argv.length === 1 && /^--input-fd=(?:[3-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/u.test(argv[0])) {
    return Number(argv[0].slice("--input-fd=".length));
  }
  if (argv.some(credentialLike)) throw new SafeInventoryError("CREDENTIAL_LIKE_ARGUMENT");
  throw new SafeInventoryError("INVALID_ARGUMENTS");
}

function readBounded(fd) {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - total));
    const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_INPUT_BYTES) throw new SafeInventoryError("INPUT_TOO_LARGE");
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

export function executeCli(argv, writeOut, writeError) {
  try {
    const fd = parseCliArgs(argv);
    const raw = readBounded(fd);
    const input = JSON.parse(raw);
    writeOut(`${JSON.stringify(runInventory(input))}\n`);
    return 0;
  } catch (error) {
    writeError(`${JSON.stringify(safeFailure(error))}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = executeCli(
    process.argv.slice(2),
    (value) => process.stdout.write(value),
    (value) => process.stderr.write(value),
  );
}
