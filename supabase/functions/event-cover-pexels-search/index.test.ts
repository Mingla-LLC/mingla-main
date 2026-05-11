import {
  handleEventCoverPexelsSearch,
  normalizeSearchRequest,
} from "./index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const originalFetch = globalThis.fetch;

const setEnv = (values: Record<string, string | null>): void => {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
};

const restoreTestState = (): void => {
  globalThis.fetch = originalFetch;
  setEnv({
    PEXELS_API_KEY: null,
    SUPABASE_SERVICE_ROLE_KEY: null,
    SUPABASE_URL: null,
  });
};

const authAndPexelsFetch = (
  pexelsResponse: Response,
  onPexelsRequest?: (input: RequestInfo | URL, init?: RequestInit) => void,
): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.startsWith("https://api.pexels.com/v1/search")) {
      onPexelsRequest?.(input, init);
      return pexelsResponse;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

Deno.test("Pexels cover search normalizes query clamps", () => {
  const normalized = normalizeSearchRequest({
    query: " supper club ",
    page: 99,
    perPage: 2,
  });

  assert(normalized.ok, "expected valid normalized request");
  if (normalized.ok) {
    assert(normalized.query === "supper club", "expected trimmed query");
    assert(normalized.page === 50, "expected clamped page");
    assert(normalized.perPage === 6, "expected clamped perPage");
  }
  assert(!normalizeSearchRequest({ query: "x" }).ok, "expected invalid short query");
});

Deno.test("Pexels cover search rejects missing auth", async () => {
  const response = await handleEventCoverPexelsSearch(
    new Request("https://edge.test", {
      method: "POST",
      body: JSON.stringify({ query: "supper club" }),
    }),
  );
  const body = await response.json();

  assert(response.status === 401, "expected auth status");
  assert(body.error === "auth_required", "expected auth_required error");
});

Deno.test("Pexels cover search proxies authenticated landscape search with server authorization", async () => {
  restoreTestState();
  setEnv({
    PEXELS_API_KEY: "server-side-pexels-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-for-auth-check",
    SUPABASE_URL: "https://supabase.test",
  });

  const captured: { pexelsUrl?: URL; pexelsAuthorization?: string | null } = {};
  globalThis.fetch = authAndPexelsFetch(
    new Response(
      JSON.stringify({
        photos: [
          {
            id: 101,
            width: 1600,
            height: 900,
            url: "https://www.pexels.com/photo/101/",
            photographer: "Jane Photographer",
            photographer_url: "https://www.pexels.com/@jane",
            avg_color: "#123456",
            alt: "Guests at a supper club",
            src: {
              landscape: "https://images.pexels.com/photos/101/landscape.jpeg",
              original: "https://images.pexels.com/photos/101/original.jpeg",
            },
          },
          {
            id: 102,
            width: 800,
            height: 600,
            url: "https://www.pexels.com/photo/102/",
            photographer: "Ignored Missing Landscape",
            photographer_url: "https://www.pexels.com/@ignored",
            src: {},
          },
        ],
        next_page: "https://api.pexels.com/v1/search?page=51",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": "200",
          "x-ratelimit-remaining": "199",
          "x-ratelimit-reset": "12345",
        },
      },
    ),
    (input, init) => {
      captured.pexelsUrl = new URL(String(input));
      captured.pexelsAuthorization = new Headers(init?.headers).get("Authorization");
    },
  );

  try {
    const response = await handleEventCoverPexelsSearch(
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer user-access-token" },
        body: JSON.stringify({ query: " supper club ", page: 99, perPage: 2 }),
      }),
    );
    const body = await response.json();

    assert(response.status === 200, "expected success status");
    if (!(captured.pexelsUrl instanceof URL)) {
      throw new Error("expected Pexels provider request");
    }
    const pexelsUrl = captured.pexelsUrl;
    assert(pexelsUrl.searchParams.get("query") === "supper club", "expected trimmed query");
    assert(pexelsUrl.searchParams.get("orientation") === "landscape", "expected landscape orientation");
    assert(pexelsUrl.searchParams.get("page") === "50", "expected clamped page");
    assert(pexelsUrl.searchParams.get("per_page") === "6", "expected clamped per_page");
    assert(captured.pexelsAuthorization === "server-side-pexels-key", "expected server Authorization");
    assert(body.photos.length === 1, "expected only landscape photos");
    assert(
      body.photos[0].mediaUrl === "https://images.pexels.com/photos/101/landscape.jpeg",
      "expected landscape media URL",
    );
    assert(body.photos[0].sourceUrl === "https://www.pexels.com/photo/101/", "expected source URL");
    assert(body.photos[0].credit === "Jane Photographer", "expected photographer credit");
    assert(body.photos[0].creditUrl === "https://www.pexels.com/@jane", "expected credit URL");
    assert(body.photos[0].alt === "Guests at a supper club", "expected alt text");
    assert(body.photos[0].avgColor === "#123456", "expected avg color");
    assert(body.photos[0].width === 1600, "expected width");
    assert(body.photos[0].height === 900, "expected height");
    assert(body.nextPage === 51, "expected next page");
    assert(body.rateLimit.limit === 200, "expected rate limit");
    assert(body.rateLimit.remaining === 199, "expected remaining rate limit");
    assert(body.rateLimit.reset === "12345", "expected rate-limit reset");
  } finally {
    restoreTestState();
  }
});

Deno.test("Pexels cover search returns not configured without exposing key value", async () => {
  restoreTestState();
  setEnv({
    PEXELS_API_KEY: null,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-for-auth-check",
    SUPABASE_URL: "https://supabase.test",
  });
  globalThis.fetch = authAndPexelsFetch(new Response("unreachable", { status: 500 }));

  try {
    const response = await handleEventCoverPexelsSearch(
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer user-access-token" },
        body: JSON.stringify({ query: "supper club" }),
      }),
    );
    const body = await response.json();

    assert(response.status === 500, "expected not configured status");
    assert(body.error === "pexels_not_configured", "expected not configured code");
    assert(JSON.stringify(body).includes("server-side-pexels-key") === false, "must not expose key value");
  } finally {
    restoreTestState();
  }
});

Deno.test("Pexels cover search preserves provider rate limit errors", async () => {
  restoreTestState();
  setEnv({
    PEXELS_API_KEY: "server-side-pexels-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-for-auth-check",
    SUPABASE_URL: "https://supabase.test",
  });
  globalThis.fetch = authAndPexelsFetch(
    new Response(JSON.stringify({ error: "too many requests" }), {
      status: 429,
      headers: {
        "x-ratelimit-limit": "200",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "67890",
      },
    }),
  );

  try {
    const response = await handleEventCoverPexelsSearch(
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer user-access-token" },
        body: JSON.stringify({ query: "supper club" }),
      }),
    );
    const body = await response.json();

    assert(response.status === 429, "expected rate limited status");
    assert(body.error === "pexels_rate_limited", "expected rate limited code");
    assert(body.rateLimit.remaining === 0, "expected rate limit remaining");
    assert(body.rateLimit.reset === "67890", "expected rate limit reset");
  } finally {
    restoreTestState();
  }
});
