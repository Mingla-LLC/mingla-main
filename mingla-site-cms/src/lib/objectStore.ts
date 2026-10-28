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

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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

/**
 * #2829 — a time-limited GET link for one object (site exports: 24 hours).
 * The link names exactly one key; nothing about the bucket is listable.
 */
export async function presignedGet(
  bucket: string,
  key: string,
  expiresSeconds = 86_400,
): Promise<string> {
  const config = cmsConfig();
  const url = objectUrl(bucket, key);
  const stamp = timestamp(new Date());
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.storageRegion}/s3/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${config.storageAccessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", stamp);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonical = `GET\n${url.pathname}\n${query}\nhost:${url.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;
  url.searchParams.set(
    "X-Amz-Signature",
    hex(await hmacBytes(
      await signingKey(config.storageSecretAccessKey, date, config.storageRegion),
      toSign,
    )),
  );
  return url.toString();
}

async function signedRequest(
  method: string,
  bucket: string,
  key: string,
  body: Uint8Array | null,
  contentType?: string,
  createOnly = false,
  query: Record<string, string> = {},
): Promise<Response> {
  const config = cmsConfig();
  const url = objectUrl(bucket, key);
  // SigV4 canonical query: names and values URI-encoded, sorted by name.
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${awsEncode(name)}=${awsEncode(query[name])}`)
    .join("&");
  if (canonicalQuery) url.search = canonicalQuery;
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
  const canonical = `${method}\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
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

export type ListedObject = { key: string; lastModified: string };

/**
 * #2829 W11 — every object under a prefix (ListObjectsV2, followed page by
 * page). Used by the retention sweep to find offering-cover renditions no
 * publication refers to any more. Throws STORAGE_UNAVAILABLE on any error,
 * so a failed listing deletes nothing.
 */
export async function listObjects(bucket: string, prefix: string, maxPages = 50): Promise<ListedObject[]> {
  const listed: ListedObject[] = [];
  let token: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const response = await signedRequest("GET", bucket, "", null, undefined, false, query);
    if (!response.ok) throw new Error("STORAGE_UNAVAILABLE");
    const xml = await response.text();
    if (!/<ListBucketResult[\s>]/.test(xml)) throw new Error("STORAGE_UNAVAILABLE");
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1])?.[1];
      const lastModified = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(match[1])?.[1];
      if (!key || !lastModified) throw new Error("STORAGE_UNAVAILABLE");
      listed.push({ key: xmlText(key), lastModified });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    if (!truncated) return listed;
    token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
    if (!token) throw new Error("STORAGE_UNAVAILABLE");
    token = xmlText(token);
  }
  // More pages than allowed: refuse rather than act on a partial list.
  throw new Error("STORAGE_UNAVAILABLE");
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
