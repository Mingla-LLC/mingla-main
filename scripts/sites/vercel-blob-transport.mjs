#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE_PATHNAME =
  /^recovery\/sites\/mingla-sites-[0-9a-f-]{36}-[0-9TZ]+-[0-9a-f]{64}\.msbk$/;

export function classifyBlobFailure(output) {
  const value = String(output || "").toLowerCase();
  if (
    /file doesn't exist|path to upload is not a file|error while reading file/.test(value)
  ) return "PRIVATE_INPUT_UNREADABLE";
  if (
    /no vercel blob credentials|no blob credentials|no read-write token/.test(value)
  ) return "PRIVATE_CREDENTIAL_MISSING";
  if (
    /access denied|valid token|this store does not exist|client token|forbidden|unauthorized/.test(value)
  ) return "PRIVATE_AUTHORIZATION_FAILED";
  if (/store has been suspended/.test(value)) return "PRIVATE_STORE_SUSPENDED";
  if (/content type mismatch/.test(value)) return "PRIVATE_CONTENT_REJECTED";
  if (/pathname mismatch/.test(value)) return "PRIVATE_PATH_REJECTED";
  if (
    /precondition failed|already exists|allowoverwrite/.test(value)
  ) return "PRIVATE_IMMUTABLE_CONFLICT";
  if (/too many requests|rate.?limit/.test(value)) return "PRIVATE_RATE_LIMITED";
  if (/service is currently not available|service unavailable/.test(value)) {
    return "PRIVATE_SERVICE_UNAVAILABLE";
  }
  if (
    /fetch failed|failed to fetch|network error|network request failed|internet connection|load failed|terminated|enotfound|econnreset|etimedout|socket/.test(value)
  ) return "PRIVATE_NETWORK_FAILED";
  return "PRIVATE_UNCLASSIFIED_FAILURE";
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function runBlobTransport({
  operation,
  sourcePath,
  pathname,
  outputPath,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const token = String(env.BLOB_READ_WRITE_TOKEN || "");
  if (token.length < 32) fail("PRIVATE_CREDENTIAL_MISSING");
  if (!BUNDLE_PATHNAME.test(String(pathname || ""))) fail("PRIVATE_PATH_REJECTED");

  let args;
  if (operation === "put") {
    const source = resolve(String(sourcePath || ""));
    if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size < 1) {
      fail("PRIVATE_INPUT_UNREADABLE");
    }
    args = [
      "--yes", "vercel@53.2.0", "blob", "put", source,
      "--access", "private",
      "--add-random-suffix", "false",
      "--allow-overwrite", "false",
      "--content-type", "application/octet-stream",
      "--pathname", pathname,
    ];
  } else if (operation === "get") {
    const output = resolve(String(outputPath || ""));
    args = [
      "--yes", "vercel@53.2.0", "blob", "get", pathname,
      "--access", "private",
      "--output", output,
    ];
  } else {
    fail("PRIVATE_OPERATION_INVALID");
  }

  const result = spawn("npx", args, {
    encoding: "utf8",
    env: { ...env, BLOB_READ_WRITE_TOKEN: token },
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(classifyBlobFailure(`${result.stdout || ""}\n${result.stderr || ""}`));
  }
  if (operation === "get") {
    const output = resolve(String(outputPath || ""));
    if (!existsSync(output) || !statSync(output).isFile() || statSync(output).size < 1) {
      fail("PRIVATE_READBACK_MISSING");
    }
  }
  process.stdout.write(`SITES_BLOB_OK operation=${operation}\n`);
}

function safeFailure(error) {
  const code = /^[A-Z0-9_]+$/.test(String(error?.code || ""))
    ? error.code
    : "PRIVATE_UNEXPECTED_FAILURE";
  process.stderr.write(`SITES_BLOB_ERROR code=${code}\n`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [operation, first, second] = process.argv.slice(2);
  try {
    runBlobTransport({
      operation,
      sourcePath: operation === "put" ? first : undefined,
      pathname: operation === "put" ? second : first,
      outputPath: operation === "get" ? second : undefined,
    });
  } catch (error) {
    safeFailure(error);
  }
}
