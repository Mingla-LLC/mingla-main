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
): (bucket: string, key: string, cache: RequestCache) => Promise<Response> {
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
  ): Promise<Response> {
    return dependencies.fetch(url, {
      method: "GET",
      headers: {
        apikey: config.storageSupabaseAnonKey,
        authorization: `Bearer ${token.value}`,
      },
      cache,
    });
  }

  return async (bucket, key, cache) => {
    const url = objectUrl(config, bucket, key);
    const firstToken = await acquireAccessToken();
    const firstResponse = await objectFetch(url, cache, firstToken);
    if (firstResponse.status !== 401) return firstResponse;
    if (cachedToken?.value === firstToken.value) cachedToken = null;
    const replacementToken = await acquireAccessToken();
    return objectFetch(url, cache, replacementToken);
  };
}

let sharedReader:
  | ReturnType<typeof createPrivateObjectReader>
  | undefined;

export function readPrivateObject(
  bucket: string,
  key: string,
  cache: RequestCache,
): Promise<Response> {
  if (!sharedReader) sharedReader = createPrivateObjectReader(runtimeConfig());
  return sharedReader(bucket, key, cache);
}
