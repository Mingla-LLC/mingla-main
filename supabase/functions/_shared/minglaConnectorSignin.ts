// Issue #4294 — company sign-in for company tools that refuse a key.
//
// Some company MCP servers (Magnific's hosted MCP first) accept only an
// OAuth sign-in. An owner presses Connect in Company tools; Mingla signs in
// once as the company and keeps that sign-in in Supabase Vault, exactly like
// a key. Three pieces live here:
//
//   POST .../team-agent/oauth/upstream-start     (from Mingla Admin only)
//        Checks the owner through the database with their own admin session
//        (the same owner check every Company tools function uses), finds the
//        tool's sign-in server, makes a single-use state and a PKCE S256
//        verifier, records them (a digest of the state; the verifier sealed
//        with a key only the state can open), and answers the address to
//        send the owner's browser to. No token is involved yet.
//   GET  .../team-agent/oauth/upstream-callback  (the tool's sign-in server
//        sends the browser here) Claims the state once, exchanges the code
//        on the server with the verifier, and stores the tokens through the
//        server-only database step. The browser gets a plain result page and
//        never a token.
//   createSigninTokenSource: before a proxied call on a sign-in row, reads
//        the access token for that call and renews it shortly before it
//        ends, one renewer at a time per row (the database lease; a clash is
//        PT409 and is retried once). A refused renewal marks the row
//        Reconnect needed.
//
// Tokens are sent only as a form body to the tool's own token address, and
// only as the Authorization header to its MCP server (the proxy). They never
// reach a browser, Mingla Admin, Claude or a log. No client library is
// imported and the environment is not read: the database and the network
// are injected, so the whole file runs in a test.

import { pkceChallenge } from "./minglaConnectorOAuth.ts";
import { type FetchLike, readCapped, upstreamUrlAllowed } from "./minglaConnectorProxy.ts";

/** Mingla's published client identity (served by Mingla Admin). */
export const SIGNIN_CLIENT_ID = "https://admin.usemingla.com/oauth/mingla-connector-client.json";
/** The only browser origin the start address answers. */
export const ADMIN_ORIGIN = "https://admin.usemingla.com";

export const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SLUG_PATTERN = /^[a-z][a-z0-9]{1,19}$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,2000}$/;
const SCOPE_WORD = /^[A-Za-z0-9:._-]{1,60}$/;
const DEFAULT_SCOPES = ["openid", "profile", "email"];

/** Renew when the access token has less than this long left. */
export const REFRESH_AHEAD_MS = 60_000;
/** An old token is still used when renewal fails and it has this long left. */
export const STILL_GOOD_MS = 5_000;
export const SIGNIN_TIMEOUT_MS = 10_000;
export const MAX_SIGNIN_BYTES = 65_536;
const MAX_START_BODY_BYTES = 1024;

/** The words of the plain result pages. Never a token, never the tool's own text. */
export const SIGNIN_WORDS = Object.freeze({
  connected: (label: string, account: string | null) =>
    `${label} is connected${account ? ` as ${account}` : ""}. You can close this tab and go back to Company tools.`,
  expired: "This sign-in link has ended or was already used. Go back to Company tools and press Connect again.",
  cancelled: "The sign-in was cancelled or refused. Go back to Company tools and press Connect again.",
  failed: "The sign-in did not finish. Nothing was saved. Go back to Company tools and press Connect again.",
});

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Which company sign-in address a request is for, or null. */
export function upstreamSigninRoute(url: string): "start" | "callback" | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch (_err) {
    return null;
  }
  if (path.endsWith("/team-agent/oauth/upstream-start")) return "start";
  if (path.endsWith("/team-agent/oauth/upstream-callback")) return "callback";
  return null;
}

/** The callback address for a connector address. */
export function signinRedirectUri(resourceUrl: string): string {
  return resourceUrl.replace(/\/+$/, "") + "/oauth/upstream-callback";
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 32 random bytes as 43 URL-safe characters. */
export function random43(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function stateKey(state: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mingla-connector-pkce|" + state));
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** The verifier sealed with a key derived from the state (AES-GCM). */
export async function sealVerifier(state: string, verifier: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await stateKey(state), new TextEncoder().encode(verifier)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64url(out);
}

/** The verifier, or null when the box was not sealed with this state. */
export async function openVerifier(state: string, box: string): Promise<string | null> {
  try {
    const bytes = fromB64url(box);
    if (bytes.length < 13) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await stateKey(state),
      bytes.slice(12),
    );
    return new TextDecoder().decode(pt);
  } catch (_err) {
    return null;
  }
}

/** The last two labels of an https address's host, or null. */
export function siteOf(url: string): string | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    host = u.hostname;
  } catch (_err) {
    return null;
  }
  const m = /(?:^|\.)([a-z0-9-]+\.[a-z0-9-]+)$/.exec(host);
  return m ? m[1] : null;
}

/** GET one small JSON document from a public https address. */
async function getJson(url: string, fetchFn: FetchLike, timeoutMs: number): Promise<Json | null> {
  if (!upstreamUrlAllowed(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readCapped(res, MAX_SIGNIN_BYTES);
    if (text === null) return null;
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface SigninServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scope: string;
  resource: string;
}

/**
 * The tool's sign-in server, from its own well-known documents: the
 * protected-resource document (optional: scopes and the resource name) and
 * the authorization-server document (required). Refused unless both
 * endpoints are public https addresses on the tool's own site, PKCE S256 is
 * supported, and Mingla's client metadata document is accepted as a client
 * id. Null when any of that fails.
 */
export async function discoverSigninServer(
  mcpUrl: string,
  fetchFn: FetchLike,
  timeoutMs = SIGNIN_TIMEOUT_MS,
): Promise<SigninServer | null> {
  if (!upstreamUrlAllowed(mcpUrl)) return null;
  const origin = new URL(mcpUrl).origin;
  const site = siteOf(mcpUrl);
  const prm = await getJson(`${origin}/.well-known/oauth-protected-resource`, fetchFn, timeoutMs);
  let as = await getJson(`${origin}/.well-known/oauth-authorization-server`, fetchFn, timeoutMs);
  if (!as && prm && Array.isArray(prm.authorization_servers) && typeof prm.authorization_servers[0] === "string") {
    const named = prm.authorization_servers[0];
    if (siteOf(named) === site) {
      as = await getJson(`${named.replace(/\/+$/, "")}/.well-known/openid-configuration`, fetchFn, timeoutMs);
    }
  }
  if (!as) return null;
  const issuer = as.issuer;
  const authz = as.authorization_endpoint;
  const token = as.token_endpoint;
  if (typeof issuer !== "string" || typeof authz !== "string" || typeof token !== "string") return null;
  if (!upstreamUrlAllowed(authz) || !upstreamUrlAllowed(token)) return null;
  if (siteOf(issuer) !== site || siteOf(authz) !== site || siteOf(token) !== site) return null;
  if (!/^https:\/\/[a-z0-9.-]+(:443)?(\/[A-Za-z0-9._~/-]{0,200})?$/.test(issuer)) return null;
  const methods = Array.isArray(as.code_challenge_methods_supported) ? as.code_challenge_methods_supported : [];
  if (!methods.includes("S256")) return null;
  if (as.client_id_metadata_document_supported !== true) return null;
  const responseTypes = Array.isArray(as.response_types_supported) ? as.response_types_supported : ["code"];
  if (!responseTypes.includes("code")) return null;

  const offered = prm && Array.isArray(prm.scopes_supported)
    ? prm.scopes_supported.filter((s): s is string => typeof s === "string" && SCOPE_WORD.test(s))
    : [];
  const scopes = offered.length > 0 ? offered.slice(0, 20) : [...DEFAULT_SCOPES];
  const asScopes = Array.isArray(as.scopes_supported) ? as.scopes_supported : [];
  // offline_access keeps the sign-in alive between uses where the server allows it.
  if (asScopes.includes("offline_access") && !scopes.includes("offline_access")) scopes.push("offline_access");
  let resource = mcpUrl;
  if (prm && typeof prm.resource === "string" && upstreamUrlAllowed(prm.resource)) {
    try {
      if (new URL(prm.resource).origin === origin) resource = prm.resource;
    } catch (_err) {
      // Keep the MCP address itself.
    }
  }
  return { issuer, authorizationEndpoint: authz, tokenEndpoint: token, scope: scopes.join(" "), resource };
}

export type TokenAnswer =
  | { kind: "ok"; access: string; refresh: string | null; expiresIn: number; idToken: string | null }
  | { kind: "invalid_grant" }
  | { kind: "unavailable" };

const TOKEN_TEXT = /^[\x21-\x7E]{16,8192}$/;

/**
 * One form POST to the tool's token address (public client, no secret).
 * Redirects are never followed and the answer is capped. The tool's own
 * error text is never returned: only ok, invalid_grant or unavailable.
 */
export async function tokenRequest(
  tokenUrl: string,
  form: Record<string, string>,
  fetchFn: FetchLike,
  timeoutMs = SIGNIN_TIMEOUT_MS,
): Promise<TokenAnswer> {
  if (!upstreamUrlAllowed(tokenUrl)) return { kind: "unavailable" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await readCapped(res, MAX_SIGNIN_BYTES);
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_err) {
      body = null;
    }
    if (res.status === 200 && isObject(body) && typeof body.access_token === "string" &&
      TOKEN_TEXT.test(body.access_token)) {
      if (typeof body.token_type === "string" && body.token_type.toLowerCase() !== "bearer") {
        return { kind: "unavailable" };
      }
      const refresh = typeof body.refresh_token === "string" && TOKEN_TEXT.test(body.refresh_token)
        ? body.refresh_token
        : null;
      const n = Number(body.expires_in);
      return {
        kind: "ok",
        access: body.access_token,
        refresh,
        expiresIn: Number.isFinite(n) && n > 0 ? Math.floor(n) : 300,
        idToken: typeof body.id_token === "string" ? body.id_token : null,
      };
    }
    if ((res.status === 400 || res.status === 401) && isObject(body) && body.error === "invalid_grant") {
      return { kind: "invalid_grant" };
    }
    return { kind: "unavailable" };
  } catch (_err) {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Who signed in, for the status line: the id token's email, user name or
 * name (read, not trusted for anything else: it came straight from the
 * tool's token address over https). Null when there is none.
 */
export function accountOf(idToken: string | null): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (!isObject(claims)) return null;
    for (const k of ["email", "preferred_username", "name"]) {
      const v = claims[k];
      if (typeof v === "string") {
        const clean = v.replace(/[\x00-\x1F\x7F<>]/g, "").trim().slice(0, 120);
        if (clean) return clean;
      }
    }
  } catch (_err) {
    return null;
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The plain result page (the same shape as the invalid sign-in link page). */
export function resultPage(status: number, words: string): Response {
  return new Response(
    `<meta charset="utf-8"><title>Mingla</title><p>${escapeHtml(words)}</p>` +
      `<p><a href="${ADMIN_ORIGIN}/#/company-tools">Back to Company tools</a></p>\n`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        ...NO_STORE,
      },
    },
  );
}

export interface SigninDeps {
  /** A database function as the trusted server role. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** A database function as the person whose admin session this is. */
  userRpc?: (jwt: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch: FetchLike;
  /** The connector's own address, exactly. */
  resourceUrl: string;
  adminOrigin?: string;
  now?: () => number;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function startAnswer(status: number, body: Json, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...(origin ? corsHeaders(origin) : {}) },
  });
}

/** A database refusal's SQLSTATE and words, when it has them. */
function refusalOf(err: unknown): { code: string; message: string } {
  const e = err as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof e?.code === "string" ? e.code : "",
    message: typeof e?.message === "string" ? e.message : "",
  };
}

/**
 * POST .../oauth/upstream-start, from Mingla Admin. Body {"slug": "..."};
 * the owner's admin session as the bearer. Answers {"authorize_url"}.
 */
export async function handleSigninStart(req: Request, deps: SigninDeps): Promise<{ outcome: string; res: Response }> {
  const admin = deps.adminOrigin ?? ADMIN_ORIGIN;
  const origin = req.headers.get("origin");
  const allowed = origin === admin ? origin : null;
  if (req.method === "OPTIONS") {
    return allowed
      ? { outcome: "preflight", res: new Response(null, { status: 204, headers: corsHeaders(allowed) }) }
      : { outcome: "origin_refused", res: new Response(null, { status: 403 }) };
  }
  if (req.method !== "POST") {
    return { outcome: "method_not_allowed", res: new Response(null, { status: 405, headers: { Allow: "POST" } }) };
  }
  if (!allowed) return { outcome: "origin_refused", res: startAnswer(403, { error: "forbidden" }, null) };
  if (!deps.userRpc) return { outcome: "not_available", res: startAnswer(404, { error: "not_available" }, allowed) };
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!JWT_PATTERN.test(jwt)) return { outcome: "unauthorized", res: startAnswer(401, { error: "unauthorized" }, allowed) };
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_START_BODY_BYTES) {
    return { outcome: "too_large", res: startAnswer(400, { error: "invalid_request" }, allowed) };
  }
  let slug = "";
  try {
    const text = await req.text();
    if (text.length > MAX_START_BODY_BYTES) throw new Error("large");
    const body = JSON.parse(text);
    slug = isObject(body) && typeof body.slug === "string" ? body.slug : "";
  } catch (_err) {
    slug = "";
  }
  if (!SLUG_PATTERN.test(slug)) return { outcome: "invalid_request", res: startAnswer(400, { error: "invalid_request" }, allowed) };

  const refused = (err: unknown) => {
    const r = refusalOf(err);
    if (r.code === "42501") return { outcome: "forbidden", res: startAnswer(403, { error: "forbidden" }, allowed) };
    if (r.code === "PGRST301" || r.code === "PGRST302") {
      return { outcome: "unauthorized", res: startAnswer(401, { error: "unauthorized" }, allowed) };
    }
    if (r.code === "P0002") return { outcome: "not_found", res: startAnswer(404, { error: "not_found" }, allowed) };
    const m = /^([a-z][a-z_]{1,39}):\s*(.{1,300})$/.exec(r.message);
    if (r.code === "22023" && m) {
      return { outcome: m[1], res: startAnswer(400, { error: m[1], message: m[2] }, allowed) };
    }
    return { outcome: "server_error", res: startAnswer(500, { error: "server_error" }, allowed) };
  };

  // The owner check first: the same one every Company tools function uses.
  let status: unknown;
  try {
    status = await deps.userRpc(jwt, "mingla_connector_signin_status", { p_slug: slug });
  } catch (err) {
    return refused(err);
  }
  if (!isObject(status) || status.auth_kind !== "signin" || typeof status.mcp_url !== "string") {
    return {
      outcome: "key_only",
      res: startAnswer(400, { error: "key_only", message: "This company tool uses a key. Use Set key." }, allowed),
    };
  }
  const server = await discoverSigninServer(status.mcp_url, deps.fetch);
  if (!server) {
    return {
      outcome: "upstream_unavailable",
      res: startAnswer(502, {
        error: "upstream_unavailable",
        message: "The tool's sign-in server could not be used. Nothing changed. Try again later.",
      }, allowed),
    };
  }
  const state = random43();
  const verifier = random43() + random43();
  const redirectUri = signinRedirectUri(deps.resourceUrl);
  try {
    await deps.userRpc(jwt, "mingla_connector_signin_begin", {
      p_slug: slug,
      p_state_hash: await sha256Hex(state),
      p_verifier_box: await sealVerifier(state, verifier),
      p_issuer: server.issuer,
      p_token_url: server.tokenEndpoint,
      p_resource: server.resource,
      p_redirect_uri: redirectUri,
    });
  } catch (err) {
    return refused(err);
  }
  const to = new URL(server.authorizationEndpoint);
  to.searchParams.set("response_type", "code");
  to.searchParams.set("client_id", SIGNIN_CLIENT_ID);
  to.searchParams.set("redirect_uri", redirectUri);
  to.searchParams.set("scope", server.scope);
  to.searchParams.set("state", state);
  to.searchParams.set("code_challenge", await pkceChallenge(verifier));
  to.searchParams.set("code_challenge_method", "S256");
  to.searchParams.set("resource", server.resource);
  return { outcome: "ok", res: startAnswer(200, { authorize_url: to.toString() }, allowed) };
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

/**
 * GET .../oauth/upstream-callback. The state is claimed once whatever
 * happens next, so a cancelled, refused or failed sign-in cannot be replayed.
 */
export async function handleSigninCallback(req: Request, deps: SigninDeps): Promise<{ outcome: string; res: Response }> {
  if (req.method !== "GET") {
    return { outcome: "method_not_allowed", res: new Response(null, { status: 405, headers: { Allow: "GET" } }) };
  }
  let params: Map<string, string> | null;
  try {
    params = single(new URL(req.url).searchParams);
  } catch (_err) {
    params = null;
  }
  const state = params?.get("state") ?? "";
  if (!params || !STATE_PATTERN.test(state)) {
    return { outcome: "invalid_state", res: resultPage(400, SIGNIN_WORDS.expired) };
  }
  const stateHash = await sha256Hex(state);
  let claim: unknown;
  try {
    claim = await deps.rpc("mingla_connector_signin_claim", { p_state_hash: stateHash });
  } catch (_err) {
    return { outcome: "server_error", res: resultPage(500, SIGNIN_WORDS.failed) };
  }
  if (!isObject(claim) || claim.ok !== true) {
    return { outcome: "invalid_state", res: resultPage(400, SIGNIN_WORDS.expired) };
  }
  if (params.has("error")) {
    return { outcome: "cancelled", res: resultPage(400, SIGNIN_WORDS.cancelled) };
  }
  const code = params.get("code") ?? "";
  if (!/^[\x21-\x7E]{1,2048}$/.test(code)) {
    return { outcome: "invalid_request", res: resultPage(400, SIGNIN_WORDS.failed) };
  }
  // RFC 9207: when the server names itself, it must be the one we started with.
  const iss = params.get("iss");
  if (iss !== undefined && iss !== null && iss !== claim.issuer) {
    return { outcome: "issuer_mismatch", res: resultPage(400, SIGNIN_WORDS.failed) };
  }
  const box = typeof claim.verifier_box === "string" ? claim.verifier_box : "";
  const verifier = await openVerifier(state, box);
  const tokenUrl = typeof claim.token_url === "string" ? claim.token_url : "";
  const redirectUri = typeof claim.redirect_uri === "string" ? claim.redirect_uri : "";
  const resource = typeof claim.resource === "string" ? claim.resource : "";
  const clientId = typeof claim.client_id === "string" ? claim.client_id : SIGNIN_CLIENT_ID;
  if (!verifier || !tokenUrl || !redirectUri) {
    return { outcome: "invalid_state", res: resultPage(400, SIGNIN_WORDS.failed) };
  }
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  };
  if (resource) form.resource = resource;
  const got = await tokenRequest(tokenUrl, form, deps.fetch);
  if (got.kind !== "ok" || !got.refresh) {
    return { outcome: got.kind === "ok" ? "no_refresh_token" : got.kind, res: resultPage(502, SIGNIN_WORDS.failed) };
  }
  let done: unknown;
  try {
    done = await deps.rpc("mingla_connector_signin_complete", {
      p_state_hash: stateHash,
      p_access: got.access,
      p_refresh: got.refresh,
      p_expires_in: got.expiresIn,
      p_account: accountOf(got.idToken),
    });
  } catch (_err) {
    return { outcome: "server_error", res: resultPage(500, SIGNIN_WORDS.failed) };
  }
  if (!isObject(done) || done.ok !== true) {
    return { outcome: "not_saved", res: resultPage(400, SIGNIN_WORDS.expired) };
  }
  const label = typeof done.label === "string" ? done.label : "The company tool";
  const account = typeof done.account === "string" ? done.account : null;
  return { outcome: "connected", res: resultPage(200, SIGNIN_WORDS.connected(label, account)) };
}

export type SigninToken =
  | { ok: true; token: string; generation: number }
  | { ok: false; token: "not_allowed" | "upstream_key_rejected" | "upstream_unavailable" };

const isConflict = (err: unknown): boolean => refusalOf(err).code === "PT409";

/**
 * The access token for one running, allowed call on a sign-in row, renewed
 * shortly before it ends. One renewer at a time per row: the database lease
 * (refresh_begin) and the lease-checked store (refresh_store) raise PT409 on
 * a clash; this reads again and retries once.
 */
export function createSigninTokenSource(deps: {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  fetch: FetchLike;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}): (callId: string) => Promise<SigninToken> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  return async function tokenFor(callId: string): Promise<SigninToken> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let cred: unknown;
      try {
        cred = await deps.rpc("mingla_connector_signin_credential", { p_call_id: callId });
      } catch (_err) {
        return { ok: false, token: "upstream_unavailable" };
      }
      if (!isObject(cred) || cred.ok !== true || typeof cred.access_token !== "string") {
        return { ok: false, token: "not_allowed" };
      }
      const generation = Number(cred.generation);
      const endsAt = Date.parse(String(cred.expires_at ?? ""));
      const left = Number.isFinite(endsAt) ? endsAt - now() : 0;
      if (left > REFRESH_AHEAD_MS) return { ok: true, token: cred.access_token, generation };
      const stillGood = left > STILL_GOOD_MS ? { ok: true as const, token: cred.access_token, generation } : null;

      let lease: unknown;
      try {
        lease = await deps.rpc("mingla_connector_signin_refresh_begin", { p_call_id: callId, p_generation: generation });
      } catch (err) {
        if (isConflict(err)) {
          // Someone else is renewing or has just renewed: read again once.
          if (attempt === 0) continue;
          return stillGood ?? { ok: false, token: "upstream_unavailable" };
        }
        return stillGood ?? { ok: false, token: "upstream_unavailable" };
      }
      if (!isObject(lease) || lease.ok !== true || typeof lease.lease !== "string" ||
        typeof lease.refresh_token !== "string" || typeof lease.token_url !== "string") {
        return stillGood ?? { ok: false, token: "not_allowed" };
      }
      const form: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: lease.refresh_token,
        client_id: typeof lease.client_id === "string" ? lease.client_id : SIGNIN_CLIENT_ID,
      };
      if (typeof lease.resource === "string" && lease.resource) form.resource = lease.resource;
      const got = await tokenRequest(lease.token_url, form, deps.fetch);
      if (got.kind !== "ok") {
        const reason = got.kind === "invalid_grant" ? "invalid_grant" : "unavailable";
        try {
          await deps.rpc("mingla_connector_signin_refresh_fail", {
            p_call_id: callId,
            p_lease: lease.lease,
            p_reason: reason,
          });
        } catch (_err) {
          log({ fn: "team-agent", step: "signin_refresh_fail_not_recorded" });
        }
        log({ fn: "team-agent", step: "signin_renewal", outcome: reason });
        if (got.kind === "invalid_grant") return { ok: false, token: "upstream_key_rejected" };
        return stillGood ?? { ok: false, token: "upstream_unavailable" };
      }
      let stored: unknown;
      try {
        stored = await deps.rpc("mingla_connector_signin_refresh_store", {
          p_call_id: callId,
          p_lease: lease.lease,
          p_access: got.access,
          // A server that does not rotate keeps the refresh token it had.
          p_refresh: got.refresh ?? lease.refresh_token,
          p_expires_in: got.expiresIn,
        });
      } catch (err) {
        log({ fn: "team-agent", step: "signin_renewal", outcome: isConflict(err) ? "store_conflict" : "store_failed" });
        if (isConflict(err) && attempt === 0) continue;
        return { ok: false, token: "upstream_unavailable" };
      }
      if (!isObject(stored) || stored.ok !== true) return { ok: false, token: "upstream_unavailable" };
      log({ fn: "team-agent", step: "signin_renewal", outcome: "ok" });
      return { ok: true, token: got.access, generation: Number(stored.generation) };
    }
    return { ok: false, token: "upstream_unavailable" };
  };
}
