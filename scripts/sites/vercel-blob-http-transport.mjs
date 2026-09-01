#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const BUNDLE_PATHNAME =
  /^recovery\/sites\/mingla-sites-[0-9a-f-]{36}-[0-9TZ]+-[0-9a-f]{64}\.msbk$/;
const API_ORIGIN = "https://vercel.com";
const API_PATH = "/api/blob/";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function blobIdentity(env, pathname) {
  const token = String(env.BLOB_READ_WRITE_TOKEN || "");
  const match = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_[A-Za-z0-9_-]+$/);
  if (!match || token.length < 32) fail("PRIVATE_CREDENTIAL_MISSING");
  if (!BUNDLE_PATHNAME.test(String(pathname || ""))) fail("PRIVATE_PATH_REJECTED");
  return { token, storeId: match[1] };
}

export function classifyBlobHttpStatus(status) {
  if (status === 401 || status === 403) return "PRIVATE_AUTHORIZATION_FAILED";
  if (status === 404) return "PRIVATE_STORE_OR_OBJECT_NOT_FOUND";
  if (status === 409 || status === 412) return "PRIVATE_IMMUTABLE_CONFLICT";
  if (status === 413) return "PRIVATE_FILE_TOO_LARGE";
  if (status === 415 || status === 422) return "PRIVATE_CONTENT_REJECTED";
  if (status === 429) return "PRIVATE_RATE_LIMITED";
  if (status >= 500 && status <= 599) return "PRIVATE_SERVICE_UNAVAILABLE";
  return "PRIVATE_PROVIDER_HTTP_REJECTED";
}

async function fetchBounded(fetchImpl, url, init) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchImpl(url, init);
    } catch {
      if (attempt === 2) fail("PRIVATE_NETWORK_FAILED");
      continue;
    }
    if (response.status < 500 || attempt === 2) return response;
  }
  return response;
}

function requestHeaders(token, storeId) {
  return {
    authorization: `Bearer ${token}`,
    "x-api-blob-request-id": `${storeId}:${Date.now()}:${randomUUID()}`,
    "x-api-blob-request-attempt": "0",
    "x-api-version": "12",
    "x-vercel-blob-store-id": storeId,
  };
}

function validatePrivateBlob(value, pathname) {
  let url;
  let downloadUrl;
  try {
    url = new URL(value?.url);
    downloadUrl = new URL(value?.downloadUrl);
  } catch {
    fail("PRIVATE_PROVIDER_RESPONSE_INVALID");
  }
  if (
    value?.pathname !== pathname ||
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".private.blob.vercel-storage.com") ||
    url.pathname.slice(1) !== pathname ||
    downloadUrl.protocol !== "https:" ||
    downloadUrl.hostname !== url.hostname ||
    downloadUrl.pathname !== url.pathname ||
    value?.contentType !== "application/octet-stream" ||
    typeof value?.etag !== "string" || value.etag.length < 1
  ) fail("PRIVATE_PROVIDER_RESPONSE_INVALID");
  return { url: url.toString(), pathname, etag: value.etag };
}

export async function runBlobHttpTransport({
  operation,
  sourcePath,
  pathname,
  outputPath,
  metadataPath,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const { token, storeId } = blobIdentity(env, pathname);
  if (operation === "put") {
    const source = resolve(String(sourcePath || ""));
    if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size < 1) {
      fail("PRIVATE_INPUT_UNREADABLE");
    }
    const apiUrl = new URL(API_PATH, API_ORIGIN);
    apiUrl.searchParams.set("pathname", pathname);
    const response = await fetchBounded(fetchImpl, apiUrl, {
      method: "PUT",
      headers: {
        ...requestHeaders(token, storeId),
        "x-vercel-blob-access": "private",
        "x-content-type": "application/octet-stream",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "0",
      },
      body: readFileSync(source),
    });
    if (!response.ok) fail(classifyBlobHttpStatus(response.status));
    let value;
    try {
      value = await response.json();
    } catch {
      fail("PRIVATE_PROVIDER_RESPONSE_INVALID");
    }
    const metadata = validatePrivateBlob(value, pathname);
    const metadataOutput = resolve(String(metadataPath || ""));
    if (!metadataPath || existsSync(metadataOutput)) fail("PRIVATE_OUTPUT_EXISTS");
    writeFileSync(metadataOutput, `${JSON.stringify(metadata)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(metadataOutput, 0o600);
  } else if (operation === "get") {
    const output = resolve(String(outputPath || ""));
    if (existsSync(output)) fail("PRIVATE_OUTPUT_EXISTS");
    const metadataInput = resolve(String(metadataPath || ""));
    if (!metadataPath || !existsSync(metadataInput) || !statSync(metadataInput).isFile()) {
      fail("PRIVATE_UPLOAD_METADATA_MISSING");
    }
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(metadataInput, "utf8"));
    } catch {
      fail("PRIVATE_UPLOAD_METADATA_INVALID");
    }
    const validated = validatePrivateBlob({
      ...metadata,
      downloadUrl: `${metadata?.url}?download=1`,
      contentType: "application/octet-stream",
    }, pathname);
    const privateUrl = new URL(validated.url);
    const response = await fetchBounded(fetchImpl, privateUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) fail(classifyBlobHttpStatus(response.status));
    if (!response.body) fail("PRIVATE_READBACK_MISSING");
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
      );
      chmodSync(output, 0o600);
      if (!statSync(output).isFile() || statSync(output).size < 1) {
        fail("PRIVATE_READBACK_MISSING");
      }
    } catch (error) {
      rmSync(output, { force: true });
      if (error?.code && /^PRIVATE_[A-Z0-9_]+$/.test(error.code)) throw error;
      fail("PRIVATE_READBACK_WRITE_FAILED");
    }
  } else {
    fail("PRIVATE_OPERATION_INVALID");
  }
  process.stdout.write(`SITES_BLOB_HTTP_OK operation=${operation}\n`);
}

function safeFailure(error) {
  const code = /^[A-Z0-9_]+$/.test(String(error?.code || ""))
    ? error.code
    : "PRIVATE_UNEXPECTED_FAILURE";
  process.stderr.write(`SITES_BLOB_ERROR code=${code}\n`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [operation, first, second, third] = process.argv.slice(2);
  try {
    await runBlobHttpTransport({
      operation,
      sourcePath: operation === "put" ? first : undefined,
      pathname: operation === "put" ? second : first,
      outputPath: operation === "get" ? second : undefined,
      metadataPath: third,
    });
  } catch (error) {
    safeFailure(error);
  }
}
