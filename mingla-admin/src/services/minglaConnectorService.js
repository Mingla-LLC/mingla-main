// Issue #4294 — the ONLY caller of the mingla_connector_* server functions,
// and the plain rules the Connect page and the Company tools page share.
//
// Sign-in: Claude sends a teammate to #/connect with the request in the
// address fragment (a browser never sends a fragment to a server). The page
// keeps it in this tab's sessionStorage, under one key, until Approve or
// Cancel, and sends it to Mingla only as the approve function's arguments.
//
// Company tools: a key is typed once into a password box, sent once in the
// set-key request body over HTTPS, and never kept: not in state that
// outlives the form, not in a cache, not in a log, not in browser storage.
// No server answer here ever holds a key.
//
// Company sign-in (issue #4294): a tool that refuses keys (Mingla Studio) is
// connected by an owner pressing Connect. The page asks team-agent for the
// tool's sign-in address with the owner's own admin session, then sends the
// browser there. The tokens go from the tool's sign-in server straight to
// Mingla's server and Supabase Vault: no answer here ever holds one.
//
// The database client is loaded only when a request is made, so the rules
// below can be tested without it.

import { AREA } from "../lib/access.js";

export const CONNECT_STORAGE_KEY = "mingla:connect-request";

/** The apps that may sign in (the same pinned list as the server). */
export const CONNECT_CLIENTS = Object.freeze({
  "https://claude.ai/oauth/mcp-oauth-client-metadata": Object.freeze({ label: "Claude", loopback: false }),
  "https://claude.ai/oauth/claude-code-client-metadata": Object.freeze({ label: "Claude Code", loopback: true }),
});

export const ADMIN_ISSUER = "https://admin.usemingla.com";

export const CONNECT_WORDS = Object.freeze({
  invalid: "This sign-in link is not valid. Start again from Claude.",
  notMember: "Your account cannot connect Claude. Ask an owner.",
  network: "We couldn't reach Mingla. Check your connection and try again.",
  ownerOnly: "Only an owner can manage company tools.",
  keyRefused: "That key wasn't saved. Paste the whole key, between 8 and 4096 characters, on one line, and try again.",
  signinUnavailable: "The tool's sign-in could not start. Nothing changed. Try again later.",
  sessionExpired: "Your admin session expired. Sign in again to continue.",
  notConnected: "Not connected yet",
  reconnectNeeded: "Reconnect needed. The company sign-in was refused, so calls are stopped until an owner presses Reconnect.",
});

const CONNECT_FIELDS = ["client_id", "redirect_uri", "code_challenge", "state", "resource", "scope"];

/**
 * The sign-in request in an address like `#/connect?client_id=...`, or null
 * when the address is not a connect address. A field that repeats makes the
 * whole request invalid ({ invalid: true }).
 */
export function parseConnectHash(hash) {
  if (typeof hash !== "string" || !/^#\/connect(\?|$)/.test(hash)) return null;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (!query) return null;
  const params = new URLSearchParams(query);
  const out = {};
  for (const [k, v] of params) {
    if (!CONNECT_FIELDS.includes(k)) continue;
    if (Object.hasOwn(out, k)) return { invalid: true };
    out[k] = v;
  }
  return out;
}

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):([1-9][0-9]{3,4})\/callback$/;

/** Does a stored request name a known app and that app's own redirect? */
export function connectRequestValid(req) {
  if (!req || typeof req !== "object" || req.invalid) return false;
  const client = Object.hasOwn(CONNECT_CLIENTS, req.client_id) ? CONNECT_CLIENTS[req.client_id] : null;
  if (!client) return false;
  if (typeof req.redirect_uri !== "string") return false;
  if (client.loopback) {
    const m = LOOPBACK.exec(req.redirect_uri);
    if (!m || Number(m[2]) < 1024 || Number(m[2]) > 65535) return false;
  } else if (req.redirect_uri !== "https://claude.ai/api/mcp/auth_callback") {
    return false;
  }
  if (typeof req.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(req.code_challenge)) return false;
  if (req.state !== undefined && (typeof req.state !== "string" || req.state.length > 512)) return false;
  return true;
}

/** What the page shows: the app's name and where it will send you back. */
export function connectDisplay(req) {
  if (!connectRequestValid(req)) return null;
  return { app: CONNECT_CLIENTS[req.client_id].label, host: new URL(req.redirect_uri).host };
}

/** The Connect page's state from what is stored and who is signed in. */
export function connectPageState(req, access) {
  if (!connectRequestValid(req)) return { phase: "invalid" };
  if (!access || access.status !== "active" || !access.areas?.includes(AREA.CRM)) return { phase: "not_member" };
  return { phase: "ready", ...connectDisplay(req) };
}

/** Where the browser goes after Approve: the app's redirect with the code. */
export function approvedRedirect(req, code) {
  const to = new URL(req.redirect_uri);
  to.searchParams.set("code", code);
  if (typeof req.state === "string") to.searchParams.set("state", req.state);
  to.searchParams.set("iss", ADMIN_ISSUER);
  return to.toString();
}

/** Where the browser goes after Cancel: access_denied, back to the app. */
export function deniedRedirect(req) {
  const to = new URL(req.redirect_uri);
  to.searchParams.set("error", "access_denied");
  if (typeof req.state === "string") to.searchParams.set("state", req.state);
  to.searchParams.set("iss", ADMIN_ISSUER);
  return to.toString();
}

/** Keeps the request in this tab across sign-in. Storage that throws is ignored. */
export function keepConnectRequest(storage, req) {
  try {
    storage.setItem(CONNECT_STORAGE_KEY, JSON.stringify(req));
    return true;
  } catch {
    return false;
  }
}

export function readConnectRequest(storage) {
  try {
    const raw = storage.getItem(CONNECT_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function forgetConnectRequest(storage) {
  try {
    storage.removeItem(CONNECT_STORAGE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

export const SLUG_RULE = /^[a-z][a-z0-9]{1,19}$/;
export const TOOL_NAME_RULE = /^[A-Za-z0-9_.-]{1,64}$/;
export const ROLE_OPTIONS = Object.freeze([
  { id: "owner", label: "Owner" },
  { id: "admin", label: "Admin" },
  { id: "partner", label: "Founding partner" },
  { id: "growth", label: "Sales and marketing" },
]);

/**
 * The allow-list box: one tool per line. Returns { tools, errors }, each
 * error naming the line number. Exact names only; no wildcards.
 */
export function parseToolList(text) {
  const tools = [];
  const errors = [];
  String(text ?? "").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    if (!TOOL_NAME_RULE.test(t)) {
      errors.push(`Line ${i + 1}: a tool name is 1 to 64 letters, digits, dots, dashes or underscores.`);
    } else if (!tools.includes(t)) {
      tools.push(t);
    }
  });
  if (tools.length > 200) errors.push("At most 200 tools.");
  return { tools, errors };
}

/** Is a typed key worth sending? The server checks again. */
export function keyLooksUsable(key) {
  if (typeof key !== "string" || key.length < 8 || key.length > 4096) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }
  return true;
}

/** "Key set, last updated 7 Nov 2026 by Seth" or "No key yet". */
export function keyStatusLine(row, formatDate = (d) => new Date(d).toLocaleDateString()) {
  if (!row?.key_set) return "No key yet";
  const when = row.key_updated_at ? formatDate(row.key_updated_at) : "";
  const who = row.key_updated_by ? ` by ${row.key_updated_by}` : "";
  return `Key set, last updated ${when}${who}`.replace(/ {2,}/g, " ").trim();
}

/** The host part of a company tool's address, for the table. */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export class ConnectorError extends Error {
  constructor({ token, message }) {
    super(typeof message === "string" ? message : "");
    this.name = "ConnectorError";
    this.token = token;
  }
}

/** A server refusal as { token, message }. Never a request body. */
export function connectorErrorOf(err) {
  const raw = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.code === "string" ? err.code : "";
  const m = raw.match(/^([a-z][a-z_]{1,39}):\s*([\s\S]*)$/);
  if (m) return { token: m[1], message: m[2].trim() };
  if (code === "42501") return { token: "forbidden", message: "" };
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return { token: "network", message: "" };
  }
  return { token: "unknown", message: "" };
}

async function call(fn, args) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ConnectorError({ token: "network", message: "" });
  }
  const { supabase } = await import("../lib/supabase.js");
  let result;
  try {
    result = await supabase.rpc(fn, args);
  } catch (err) {
    // Only the kind of failure is logged: never the arguments.
    console.error("[connector] request failed:", err?.name || "error");
    throw new ConnectorError(connectorErrorOf(err));
  }
  if (result.error) throw new ConnectorError(connectorErrorOf(result.error));
  return result.data;
}

export function approveConnect(req) {
  return call("mingla_connector_oauth_approve", {
    p_client_id: req.client_id,
    p_redirect_uri: req.redirect_uri,
    p_code_challenge: req.code_challenge,
    p_resource: typeof req.resource === "string" ? req.resource : null,
  });
}

export const listConnections = () => call("mingla_connector_connections_mine", {});
export const disconnectConnection = (grantId) => call("mingla_connector_disconnect", { p_grant_id: grantId });
export const listCompanyTools = () => call("mingla_connector_registry_list", {});
export const saveCompanyTool = (row) => call("mingla_connector_registry_save", { p_row: row });
export const deleteCompanyTool = (slug) => call("mingla_connector_registry_delete", { p_slug: slug });
export const clearCompanyToolKey = (slug) => call("mingla_connector_clear_key", { p_slug: slug });
export const recentCompanyToolCalls = (limit = 20) => call("mingla_connector_calls_recent", { p_limit: limit });

/**
 * Sends a key once. The answer is only { key_set, key_updated_at }. A
 * refusal is turned into fixed words here, so nothing the person typed is
 * ever shown back or kept in an error.
 */
export async function setCompanyToolKey(slug, key) {
  try {
    return await call("mingla_connector_set_key", { p_slug: slug, p_key: key });
  } catch (err) {
    const token = err instanceof ConnectorError ? err.token : "unknown";
    throw new ConnectorError({
      token,
      message: token === "invalid_key" ? CONNECT_WORDS.keyRefused : token === "network" ? CONNECT_WORDS.network : "",
    });
  }
}

/**
 * A sign-in row's status line: "Connected as X on DATE by Y",
 * "Reconnect needed. ..." or "Not connected yet". Never a token.
 */
export function signinStatusLine(row, formatDate = (d) => new Date(d).toLocaleDateString()) {
  const s = row?.signin;
  if (!s?.connected) return CONNECT_WORDS.notConnected;
  if (s.reconnect_needed) return CONNECT_WORDS.reconnectNeeded;
  const as = s.account ? ` as ${s.account}` : "";
  const when = s.connected_at ? ` on ${formatDate(s.connected_at)}` : "";
  const who = s.connected_by ? ` by ${s.connected_by}` : "";
  return `Connected${as}${when}${who}`;
}

/** Can the On switch be used? A key row needs a key; a sign-in row a live sign-in. */
export function canTurnOn(row) {
  if (row?.auth_kind === "signin") return Boolean(row.signin?.connected && !row.signin?.reconnect_needed);
  return Boolean(row?.key_set);
}

export const HIDE_WORD_RULE = /^[A-Za-z0-9](?:[A-Za-z0-9 .&'-]{0,38}[A-Za-z0-9])?$/;

/** The hidden-words box: comma or line separated. Returns { words, errors }. */
export function parseHideWords(text) {
  const words = [];
  const errors = [];
  String(text ?? "").split(/[\n,]/).forEach((raw) => {
    const w = raw.trim();
    if (!w) return;
    if (!HIDE_WORD_RULE.test(w)) errors.push(`"${w.slice(0, 40)}": use 1 to 40 letters, digits, spaces, dots, dashes or apostrophes.`);
    else if (!words.some((x) => x.toLowerCase() === w.toLowerCase())) words.push(w);
  });
  if (words.length > 20) errors.push("At most 20 hidden words.");
  return { words, errors };
}

/** The daily limit box: a whole number from 0 to 10000, or null. */
export function parseDailyCap(text) {
  const t = String(text ?? "").trim();
  if (!/^[0-9]{1,5}$/.test(t)) return null;
  const n = Number(t);
  return n <= 10000 ? n : null;
}

export const disconnectCompanySignin = (slug) => call("mingla_connector_signin_disconnect", { p_slug: slug });
export const companySigninStatus = (slug) => call("mingla_connector_signin_status", { p_slug: slug });

/**
 * Connect: asks team-agent, with this owner's admin session, where to sign
 * in. Answers the tool's own sign-in address; the caller sends the browser
 * there. No token is ever in this answer.
 */
export async function startCompanySignin(slug) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ConnectorError({ token: "network", message: CONNECT_WORDS.network });
  }
  const { invokeWithRefresh, isSessionExpiredError } = await import("../lib/supabase.js");
  let result;
  try {
    result = await invokeWithRefresh("team-agent/oauth/upstream-start", { body: { slug } });
  } catch (err) {
    console.error("[connector] sign-in start failed:", err?.name || "error");
    throw new ConnectorError({ token: "network", message: CONNECT_WORDS.network });
  }
  if (result?.error) {
    if (isSessionExpiredError(result.error)) {
      throw new ConnectorError({ token: "session", message: CONNECT_WORDS.sessionExpired });
    }
    let body = null;
    try {
      body = await result.error?.context?.json?.();
    } catch {
      body = null;
    }
    const token = typeof body?.error === "string" ? body.error : "unknown";
    if (token === "forbidden") throw new ConnectorError({ token, message: CONNECT_WORDS.ownerOnly });
    const message = typeof body?.message === "string" && body.message.length <= 300 ? body.message : CONNECT_WORDS.signinUnavailable;
    throw new ConnectorError({ token, message });
  }
  const to = signinAddressOf(result?.data);
  if (!to) throw new ConnectorError({ token: "unknown", message: CONNECT_WORDS.signinUnavailable });
  return to;
}

/** The sign-in address in team-agent's answer, only if it is a plain https address. */
export function signinAddressOf(data) {
  const raw = typeof data?.authorize_url === "string" ? data.authorize_url : "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The On switch: saves at once and answers what the server now has. A
 * refused save answers the old position and the refusal, so the switch
 * never shows On before the server has it on.
 */
export async function switchCompanyTool(slug, next, save = saveCompanyTool) {
  try {
    const saved = await save({ slug, enabled: next });
    return { enabled: typeof saved?.enabled === "boolean" ? saved.enabled : next, error: null };
  } catch (err) {
    return { enabled: !next, error: err };
  }
}
