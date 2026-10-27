import { runtimeConfig, type RuntimeConfig } from "./config";

type ReaderConfig = Pick<
  RuntimeConfig,
  | "storageSupabaseUrl"
  | "storageSupabaseAnonKey"
  | "storageReaderEmail"
  | "storageReaderPassword"
>;

type AccessToken = {
  value: string;
  expiresAtMs: number;
};

/** #2829 W6 — an inclusive byte range to read (video chunks). */
export type ByteRange = { start: number; end: number };

type ReaderDependencies = {
  fetch: typeof fetch;
  now: () => number;
};

const TOKEN_EXPIRY_SKEW_MS = 30_000;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function objectUrl(config: ReaderConfig, bucket: string, key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(bucket)) {
    throw new Error("STORAGE_SCOPE_INVALID");
  }
  const segments = key.split("/");
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        containsControlCharacter(segment),
    )
  ) throw new Error("STORAGE_SCOPE_INVALID");
  return `${config.storageSupabaseUrl}/storage/v1/object/authenticated/${
    encodeURIComponent(bucket)
  }/${segments.map(encodeURIComponent).join("/")}`;
}

export function createPrivateObjectReader(
  config: ReaderConfig,
  dependencies: ReaderDependencies = { fetch, now: Date.now },
): (bucket: string, key: string, cache: RequestCache, range?: ByteRange) => Promise<Response> {
  let cachedToken: AccessToken | null = null;
  let tokenRequest: Promise<AccessToken> | null = null;

  async function acquireAccessToken(): Promise<AccessToken> {
    if (
      cachedToken &&
      cachedToken.expiresAtMs - dependencies.now() > TOKEN_EXPIRY_SKEW_MS
    ) return cachedToken;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const response = await dependencies.fetch(
        `${config.storageSupabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: config.storageSupabaseAnonKey,
            authorization: `Bearer ${config.storageSupabaseAnonKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: config.storageReaderEmail,
            password: config.storageReaderPassword,
          }),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("STORAGE_AUTH_UNAVAILABLE");
      const body: unknown = await response.json();
      const record =
        body && typeof body === "object" && !Array.isArray(body)
          ? body as Record<string, unknown>
          : null;
      const accessToken = record?.access_token;
      const expiresIn = record?.expires_in;
      if (
        typeof accessToken !== "string" ||
        accessToken.length < 20 ||
        typeof expiresIn !== "number" ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 30
      ) throw new Error("STORAGE_AUTH_INVALID");
      cachedToken = {
        value: accessToken,
        expiresAtMs: dependencies.now() + expiresIn * 1000,
      };
      return cachedToken;
    })();
    try {
      return await tokenRequest;
    } finally {
      tokenRequest = null;
    }
  }

  async function objectFetch(
    url: string,
    cache: RequestCache,
    token: AccessToken,
    range?: ByteRange,
  ): Promise<Response> {
    return dependencies.fetch(url, {
      method: "GET",
      headers: {
        apikey: config.storageSupabaseAnonKey,
        authorization: `Bearer ${token.value}`,
        ...(range ? { range: `bytes=${range.start}-${range.end}` } : {}),
      },
      // A ranged read is never put in the data cache (its key would not
      // carry the range); the response it builds is CDN-cached instead.
      cache: range ? "no-store" : cache,
    });
  }

  return async (bucket, key, cache, range) => {
    if (
      range &&
      (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)
    ) throw new Error("STORAGE_SCOPE_INVALID");
    const url = objectUrl(config, bucket, key);
    const firstToken = await acquireAccessToken();
    const firstResponse = await objectFetch(url, cache, firstToken, range);
    if (firstResponse.status !== 401) return firstResponse;
    if (cachedToken?.value === firstToken.value) cachedToken = null;
    const replacementToken = await acquireAccessToken();
    return objectFetch(url, cache, replacementToken, range);
  };
}

let sharedReader:
  | ReturnType<typeof createPrivateObjectReader>
  | undefined;

export function readPrivateObject(
  bucket: string,
  key: string,
  cache: RequestCache,
  range?: ByteRange,
): Promise<Response> {
  if (!sharedReader) sharedReader = createPrivateObjectReader(runtimeConfig());
  return sharedReader(bucket, key, cache, range);
}

/**
 * #2829 W6 — exactly bytes [start, end] of a stored object. A 206 must name
 * that range; a storage that ignores Range and answers 200 is sliced here, so
 * the bytes are right either way. Anything else is a storage failure.
 */
export async function readPrivateObjectRange(
  bucket: string,
  key: string,
  range: ByteRange,
  reader: (bucket: string, key: string, cache: RequestCache, range?: ByteRange) => Promise<Response> = readPrivateObject,
): Promise<Uint8Array> {
  const response = await reader(bucket, key, "no-store", range);
  if (response.status === 206) {
    const named = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get("content-range") ?? "");
    if (!named || Number(named[1]) !== range.start || Number(named[2]) !== range.end) throw new Error("STORAGE_RANGE_MISMATCH");
    return new Uint8Array(await response.arrayBuffer());
  }
  if (response.status === 200) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (range.end >= whole.byteLength) throw new Error("STORAGE_RANGE_MISMATCH");
    return whole.subarray(range.start, range.end + 1);
  }
  throw new Error("STORAGE_UNAVAILABLE");
}
