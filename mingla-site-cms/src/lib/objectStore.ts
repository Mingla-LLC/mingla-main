import { cmsConfig } from "./config";
import { sha256 } from "./crypto";

const encoder = new TextEncoder();
const EMPTY_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
async function hmacBytes(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)),
  );
}
async function signingKey(
  secret: string,
  date: string,
  region: string,
): Promise<Uint8Array> {
  const kDate = await hmacBytes(encoder.encode(`AWS4${secret}`), date);
  const kRegion = await hmacBytes(kDate, region);
  const kService = await hmacBytes(kRegion, "s3");
  return hmacBytes(kService, "aws4_request");
}
function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}
function timestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function objectUrl(bucket: string, key: string): URL {
  const config = cmsConfig();
  return new URL(
    `${config.storageEndpoint}/${encodeURIComponent(bucket)}/${encodePath(key)}`,
  );
}

export async function presignedQuarantinePut(
  bucket: string,
  key: string,
  contentType: string,
  expiresSeconds = 300,
): Promise<{ url: string; headers: Record<string, string> }> {
  const config = cmsConfig();
  const url = objectUrl(bucket, key);
  const now = new Date();
  const stamp = timestamp(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.storageRegion}/s3/aws4_request`;
  const signedHeaders = "content-type;host;if-none-match";
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set(
    "X-Amz-Credential",
    `${config.storageAccessKeyId}/${scope}`,
  );
  url.searchParams.set("X-Amz-Date", stamp);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const canonical = `PUT\n${url.pathname}\n${query}\ncontent-type:${contentType}\nhost:${url.host}\nif-none-match:*\n\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;
  url.searchParams.set(
    "X-Amz-Signature",
    hex(
        await hmacBytes(
          await signingKey(
            config.storageSecretAccessKey,
            date,
            config.storageRegion,
          ),
          toSign,
        ),
    ),
  );
  return {
    url: url.toString(),
    headers: {
      "content-type": contentType,
      "if-none-match": "*",
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
  };
}

async function signedRequest(
  method: string,
  bucket: string,
  key: string,
  body: Uint8Array | null,
  contentType?: string,
  createOnly = false,
): Promise<Response> {
  const config = cmsConfig();
  const url = objectUrl(bucket, key);
  const now = new Date();
  const stamp = timestamp(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.storageRegion}/s3/aws4_request`;
  const payloadHash = body ? await sha256(body) : EMPTY_HASH;
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (contentType) headers["content-type"] = contentType;
  if (createOnly) headers["if-none-match"] = "*";
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const canonical = `${method}\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;
  const signature = hex(
      await hmacBytes(
        await signingKey(
          config.storageSecretAccessKey,
          date,
          config.storageRegion,
        ),
        toSign,
      ),
  );
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.storageAccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host;
  return fetch(url, {
    method,
    headers,
    body: body ? Buffer.from(body) : undefined,
    cache: "no-store",
  });
}

export async function readObject(
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const response = await signedRequest("GET", bucket, key, null);
  if (!response.ok) throw new Error("STORAGE_UNAVAILABLE");
  return new Uint8Array(await response.arrayBuffer());
}
export async function writeObject(
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await signedRequest(
    "PUT",
    bucket,
    key,
    bytes,
    contentType,
    true,
  );
  if (response.ok) return;
  if (response.status === 412) {
    const existing = await readObject(bucket, key);
    if (await sha256(existing) === await sha256(bytes)) return;
  }
  throw new Error("STORAGE_UNAVAILABLE");
}
export async function deleteObject(bucket: string, key: string): Promise<void> {
  const response = await signedRequest("DELETE", bucket, key, null);
  if (!response.ok && response.status !== 404)
    throw new Error("STORAGE_UNAVAILABLE");
}
