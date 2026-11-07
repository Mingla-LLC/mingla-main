// Issue #4294 — sign-in for the Mingla connector (OAuth 2.1, public clients,
// PKCE S256 only).
//
// The Claude apps and Claude Code find the sign-in from the connector's 401:
// its WWW-Authenticate header names the protected-resource document served
// here, which names Mingla Admin as the authorization server. Mingla Admin
// serves the server's own metadata as a static file and hosts the page where
// a teammate approves. The two endpoints that need the database live here:
//
//   GET  .../team-agent/oauth/authorize  checks the request and sends the
//        browser to Mingla Admin #/connect. A request from an unknown app or
//        with a redirect that is not that app's is answered with a plain 400
//        page and NEVER a redirect.
//   POST .../team-agent/oauth/token      exchanges a code + verifier, or a
//        refresh token, for a one-hour team-agent key and a new refresh
//        token. Only digests reach the database; nothing is logged.
//
// The database is the authority on every rule (it checks them all again).
// No client library is imported and the environment is not read: the
// database is reached through the injected `rpc`, so the whole file runs in
// a test with a stand-in.

/** Where Mingla Admin lives: the authorization server's issuer. */
export const ADMIN_ISSUER = "https://admin.usemingla.com";

/** The one scope. */
export const SCOPE = "mingla";

/** Largest token request body accepted, in bytes. */
export const MAX_TOKEN_BODY_BYTES = 8192;

export const CODE_PATTERN = /^mglo_[A-Za-z0-9_-]{43}$/;
export const REFRESH_PATTERN = /^mglr_[A-Za-z0-9_-]{43}$/;
export const ACCESS_PATTERN = /^mgla_c_[A-Za-z0-9_-]{43}$/;
export const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The apps that may sign in, pinned (no registration, no fetching). */
export const CLIENTS: Readonly<
  Record<string, { kind: string; label: string; redirect?: string; loopback: boolean }>
> = Object.freeze({
  "https://claude.ai/oauth/mcp-oauth-client-metadata": {
    kind: "claude_app",
    label: "Claude",
    redirect: "https://claude.ai/api/mcp/auth_callback",
    loopback: false,
  },
  "https://claude.ai/oauth/claude-code-client-metadata": {
    kind: "claude_code",
    label: "Claude Code",
    loopback: true,
  },
});

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):([1-9][0-9]{3,4})\/callback$/;

/**
 * Is this the exact redirect the app may use? Claude: one exact string.
 * Claude Code: http://localhost or http://127.0.0.1, a port 1024-65535, path
 * exactly /callback and nothing else. Compared as text, so look-alike forms
 * (case, encodings, user parts, dots, trailing slashes) never match.
 */
export function redirectAllowed(clientId: unknown, redirectUri: unknown): boolean {
  if (typeof clientId !== "string" || typeof redirectUri !== "string") return false;
  if (!Object.prototype.hasOwnProperty.call(CLIENTS, clientId)) return false;
  const client = CLIENTS[clientId];
  if (!client.loopback) return redirectUri === client.redirect;
  const m = LOOPBACK.exec(redirectUri);
  if (!m) return false;
  const port = Number(m[2]);
  return port >= 1024 && port <= 65535;
}

/** The address of the protected-resource document for a connector address. */
export function resourceMetadataUrl(resourceUrl: string): string {
  return resourceUrl + "/.well-known/oauth-protected-resource";
}

/** The connector's 401 header: where to find how to sign in. */
export function wwwAuthenticate(resourceUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(resourceUrl)}", scope="${SCOPE}"`;
}

/** The protected-resource document (RFC 9728). */
export function protectedResourceMetadata(resourceUrl: string, issuer = ADMIN_ISSUER) {
  return {
    resource: resourceUrl,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
  };
}

/** Which sign-in address a request is for, or null. */
export function oauthRoute(url: string): "metadata" | "authorize" | "token" | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch (_err) {
    return null;
  }
  if (path.endsWith("/team-agent/.well-known/oauth-protected-resource")) return "metadata";
  if (path.endsWith("/team-agent/oauth/authorize")) return "authorize";
  if (path.endsWith("/team-agent/oauth/token")) return "token";
  return null;
}

/** BASE64URL(SHA-256(verifier)), no padding. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Each name once; null when a name repeats. */
function single(params: URLSearchParams): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const [k, v] of params) {
    if (out.has(k)) return null;
    out.set(k, v);
  }
  return out;
}

export interface OAuthDeps {
  /** Calls one database function as the trusted server role. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** The connector's own address, exactly. */
  resourceUrl: string;
  issuer?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Every token refusal takes at least this long. 0 turns it off (tests). */
  minRefusalMs?: number;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const INVALID_LINK_WORDS =
  "This sign-in link is not valid. Start again from Claude.";

function invalidLinkPage(): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Mingla</title><p>${INVALID_LINK_WORDS}</p>\n`,
    {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    },
  );
}

function backTo(redirectUri: string, params: Record<string, string>): Response {
  const target = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), ...NO_STORE },
  });
}

/**
 * GET .../oauth/authorize. Answers 400 (never a redirect) unless the app and
 * its redirect are known; then any other problem goes back to the app with
 * `error`; a good request goes to Mingla Admin #/connect with its
 * parameters in the address fragment, which a browser never sends to a
 * server.
 */
export function handleAuthorize(req: Request, deps: OAuthDeps): { outcome: string; res: Response } {
  const issuer = deps.issuer ?? ADMIN_ISSUER;
  let params: Map<string, string> | null;
  try {
    params = single(new URL(req.url).searchParams);
  } catch (_err) {
    params = null;
  }
  if (
    !params || !redirectAllowed(params.get("client_id"), params.get("redirect_uri"))
  ) {
    return { outcome: "invalid_client", res: invalidLinkPage() };
  }
  const redirectUri = params.get("redirect_uri") as string;
  const state = params.get("state");
  const fail = (error: string) => {
    const back: Record<string, string> = { error, iss: issuer };
    if (state !== undefined && state !== null && state.length <= 512) back.state = state;
    return { outcome: error, res: backTo(redirectUri, back) };
  };
  if (state !== undefined && state !== null && state.length > 512) return fail("invalid_request");
  if (params.get("response_type") !== "code") return fail("unsupported_response_type");
  if (params.get("code_challenge_method") !== "S256") return fail("invalid_request");
  const challenge = params.get("code_challenge") ?? "";
  if (!CHALLENGE_PATTERN.test(challenge)) return fail("invalid_request");
  const resource = params.get("resource");
  if (
    resource !== undefined && resource !== null &&
    resource !== deps.resourceUrl && resource !== deps.resourceUrl + "/"
  ) {
    return fail("invalid_target");
  }
  const scope = params.get("scope");
  if (scope !== undefined && scope !== null) {
    const words = scope.split(" ").filter((w) => w !== "");
    if (words.some((w) => w !== SCOPE && w !== "offline_access")) return fail("invalid_scope");
  }
  const forward = new URLSearchParams();
  forward.set("client_id", params.get("client_id") as string);
  forward.set("redirect_uri", redirectUri);
  forward.set("code_challenge", challenge);
  if (state !== undefined && state !== null) forward.set("state", state);
  if (resource !== undefined && resource !== null) forward.set("resource", resource);
  if (scope !== undefined && scope !== null) forward.set("scope", scope);
  return {
    outcome: "ok",
    res: new Response(null, {
      status: 302,
      headers: { Location: `${issuer}/#/connect?${forward.toString()}`, ...NO_STORE },
    }),
  };
}

async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function tokenError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

/**
 * POST .../oauth/token, form-encoded only. Public clients only: a client
 * secret or an Authorization header is refused. Every refusal of a code or
 * refresh token is the same answer and takes the same minimum time.
 */
export async function handleToken(
  req: Request,
  deps: OAuthDeps,
): Promise<{ outcome: string; res: Response }> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  const minWait = deps.minRefusalMs ?? 250;
  const refuse = async (status: number, error: string) => {
    const wait = minWait - (now() - started);
    if (wait > 0) await sleep(wait);
    return { outcome: error, res: tokenError(status, error) };
  };

  if (req.headers.has("authorization")) return await refuse(401, "invalid_client");
  if (req.headers.has("origin")) return await refuse(400, "invalid_request");
  if (req.url.includes("?") || req.url.includes("#")) return await refuse(400, "invalid_request");
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return await refuse(400, "invalid_request");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_TOKEN_BODY_BYTES) {
    return await refuse(400, "invalid_request");
  }
  const raw = await readLimited(req, MAX_TOKEN_BODY_BYTES);
  if (raw === null) return await refuse(400, "invalid_request");
  let form: Map<string, string> | null;
  try {
    form = single(new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  } catch (_err) {
    form = null;
  }
  if (!form) return await refuse(400, "invalid_request");
  if (form.has("client_secret") || form.has("client_assertion")) {
    return await refuse(401, "invalid_client");
  }
  const clientId = form.get("client_id");
  if (!clientId) return await refuse(400, "invalid_request");
  if (!Object.prototype.hasOwnProperty.call(CLIENTS, clientId)) {
    return await refuse(401, "invalid_client");
  }

  let answer: unknown;
  const grantType = form.get("grant_type");
  try {
    if (grantType === "authorization_code") {
      const code = form.get("code");
      const redirectUri = form.get("redirect_uri");
      const verifier = form.get("code_verifier");
      if (!code || !redirectUri || !verifier) return await refuse(400, "invalid_request");
      if (!VERIFIER_PATTERN.test(verifier)) return await refuse(400, "invalid_grant");
      if (!CODE_PATTERN.test(code)) return await refuse(400, "invalid_grant");
      answer = await deps.rpc("mingla_connector_oauth_exchange", {
        p_code_hash: await sha256Hex(code),
        p_client_id: clientId,
        p_redirect_uri: redirectUri,
        p_challenge: await pkceChallenge(verifier),
        p_resource: form.get("resource") ?? null,
      });
    } else if (grantType === "refresh_token") {
      const refresh = form.get("refresh_token");
      if (!refresh) return await refuse(400, "invalid_request");
      if (!REFRESH_PATTERN.test(refresh)) return await refuse(400, "invalid_grant");
      answer = await deps.rpc("mingla_connector_oauth_refresh", {
        p_refresh_hash: await sha256Hex(refresh),
        p_client_id: clientId,
      });
    } else if (!grantType) {
      return await refuse(400, "invalid_request");
    } else {
      return await refuse(400, "unsupported_grant_type");
    }
  } catch (_err) {
    return { outcome: "server_error", res: tokenError(500, "server_error") };
  }

  const a = typeof answer === "object" && answer !== null && !Array.isArray(answer)
    ? answer as Record<string, unknown>
    : {};
  if (
    typeof a.access_token !== "string" || !ACCESS_PATTERN.test(a.access_token) ||
    typeof a.refresh_token !== "string" || !REFRESH_PATTERN.test(a.refresh_token)
  ) {
    if (a.error === "invalid_grant") return await refuse(400, "invalid_grant");
    return { outcome: "server_error", res: tokenError(500, "server_error") };
  }
  const expiresIn = Math.max(1, Math.min(3600, Math.floor(Number(a.expires_in) || 3600)));
  return {
    outcome: "ok",
    res: new Response(
      JSON.stringify({
        access_token: a.access_token,
        token_type: "Bearer",
        expires_in: expiresIn,
        refresh_token: a.refresh_token,
        scope: SCOPE,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...NO_STORE } },
    ),
  };
}
