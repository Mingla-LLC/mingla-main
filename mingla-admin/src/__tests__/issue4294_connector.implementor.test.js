// Issue #4294 — the Mingla connector in Mingla Admin.
//
//   C-1  #/connect: the request from Claude is read from the address
//        fragment, kept in this tab's sessionStorage only, and sent to Mingla
//        only as the approve function's four arguments
//   C-2  the Connect screen's states: link not valid, not a team member,
//        ready (app name and where you go back), approving, network + retry;
//        Approve returns the code with state and iss; Cancel returns
//        access_denied
//   C-3  Company tools: owner only; loading, error (nothing editable),
//        empty, populated; the allow-list box; the key is write-only
//   C-4  My agent's Claude app card: loading, empty, error, populated,
//        Disconnect asks first
//   C-5  the static authorization-server document and its header
//   C-6  no key in a breadcrumb, a toast, the address or browser storage
//
// Invariant declared here:
//   I-4294-2 (Admin side) A company key is typed into a password box with
//            no reveal and no autofill, sent once in the set-key request,
//            emptied after, and never shown, stored or logged: no answer
//            the page reads has a key in it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONNECT_STORAGE_KEY,
  CONNECT_WORDS,
  approvedRedirect,
  connectPageState,
  connectRequestValid,
  deniedRedirect,
  forgetConnectRequest,
  keepConnectRequest,
  keyLooksUsable,
  keyStatusLine,
  parseConnectHash,
  parseToolList,
  readConnectRequest,
} from "../services/minglaConnectorService.js";
// {"invariant":"I-4294-2","issue":4294,"status":"ACTIVE","enforced_by":["mingla-admin/src/__tests__/issue4294_connector.implementor.test.js","supabase/migrations/__tests__/issue_4294_mingla_connector.implementor.happy.pg17.test.sql"]}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = path.resolve(SRC, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const CHALLENGE = "a".repeat(43);
const GOOD = {
  client_id: APP,
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_challenge: CHALLENGE,
  state: "st-1",
};
const MEMBER = { role: "growth", status: "active", areas: ["crm", "role_home"] };

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

describe("#4294 C-1: the sign-in request stays in this tab", () => {
  it("reads the request from the fragment", () => {
    const hash = `#/connect?${new URLSearchParams({ ...GOOD, resource: "r", scope: "mingla" })}`;
    assert.deepEqual(parseConnectHash(hash), { ...GOOD, resource: "r", scope: "mingla" });
    assert.equal(parseConnectHash("#/agent"), null);
    assert.equal(parseConnectHash("#/connect"), null);
    assert.deepEqual(parseConnectHash("#/connect?client_id=a&client_id=b"), { invalid: true });
  });

  it("keeps it in sessionStorage under one key, and forgets it", () => {
    const s = memoryStorage();
    assert.equal(keepConnectRequest(s, GOOD), true);
    assert.deepEqual([...s.map.keys()], [CONNECT_STORAGE_KEY]);
    assert.deepEqual(readConnectRequest(s), GOOD);
    forgetConnectRequest(s);
    assert.equal(readConnectRequest(s), null);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    assert.equal(keepConnectRequest(broken, GOOD), false);
    assert.equal(readConnectRequest(broken), null);
    assert.doesNotThrow(() => forgetConnectRequest(broken));
  });

  it("App takes it out of the address at once and keeps it only in sessionStorage", () => {
    const app = strip(read("App.jsx"));
    assert.match(app, /keepConnectRequest\(window\.sessionStorage, req\)/);
    assert.match(app, /window\.history\.replaceState\(null, "", "#\/connect"\)/);
    assert.equal(/localStorage/.test(app), false);
    assert.match(app, /if \(connectOpen\) \{\s*return <ConnectScreen \/>;/);
  });

  it("the request reaches Mingla only as the approve function's four arguments", () => {
    const service = strip(read("services/minglaConnectorService.js"));
    const approve = service.slice(service.indexOf("export function approveConnect"), service.indexOf("export const listConnections"));
    assert.deepEqual([...approve.matchAll(/\b(p_[a-z_]+):/g)].map((m) => m[1]), ["p_client_id", "p_redirect_uri", "p_code_challenge", "p_resource"]);
    assert.equal(/state|scope/.test(approve.replace(/req\.resource/g, "")), false, "state and scope are never sent");
    const screen = strip(read("components/ConnectScreen.jsx"));
    assert.equal(/\bfetch\s*\(|supabase|localStorage/.test(screen), false, "the screen makes no request of its own");
    assert.deepEqual([...screen.matchAll(/await (\w+)\(/g)].map((m) => m[1]), ["approveConnect"]);
  });
});

describe("#4294 C-2: the Connect screen's states", () => {
  it("a link that is not valid says so", () => {
    assert.deepEqual(connectPageState(null, MEMBER), { phase: "invalid" });
    assert.deepEqual(connectPageState({ ...GOOD, client_id: "https://evil.example/c" }, MEMBER), { phase: "invalid" });
    assert.deepEqual(connectPageState({ ...GOOD, redirect_uri: "https://evil.example/cb" }, MEMBER), { phase: "invalid" });
    assert.deepEqual(connectPageState({ ...GOOD, code_challenge: "short" }, MEMBER), { phase: "invalid" });
    assert.deepEqual(connectPageState({ invalid: true }, MEMBER), { phase: "invalid" });
  });
  it("someone without the pipelines area cannot connect", () => {
    assert.deepEqual(connectPageState(GOOD, null), { phase: "not_member" });
    assert.deepEqual(connectPageState(GOOD, { ...MEMBER, areas: ["role_home"] }), { phase: "not_member" });
    assert.deepEqual(connectPageState(GOOD, { ...MEMBER, status: "invited" }), { phase: "not_member" });
  });
  it("ready names the app and where it sends you back", () => {
    assert.deepEqual(connectPageState(GOOD, MEMBER), { phase: "ready", app: "Claude", host: "claude.ai" });
    const cc = { client_id: CODE, redirect_uri: "http://127.0.0.1:53682/callback", code_challenge: CHALLENGE };
    assert.deepEqual(connectPageState(cc, MEMBER), { phase: "ready", app: "Claude Code", host: "127.0.0.1:53682" });
    assert.equal(connectRequestValid({ ...cc, redirect_uri: "http://localhost:80/callback" }), false);
  });
  it("Approve returns the code with state and iss; Cancel returns access_denied", () => {
    const to = new URL(approvedRedirect(GOOD, "mglo_x"));
    assert.equal(to.origin + to.pathname, GOOD.redirect_uri);
    assert.equal(to.searchParams.get("code"), "mglo_x");
    assert.equal(to.searchParams.get("state"), "st-1");
    assert.equal(to.searchParams.get("iss"), "https://admin.usemingla.com");
    const back = new URL(deniedRedirect(GOOD));
    assert.equal(back.searchParams.get("error"), "access_denied");
    assert.equal(back.searchParams.get("state"), "st-1");
  });
  it("the screen draws loading, ready, approving and every error in plain words", () => {
    const screen = read("components/ConnectScreen.jsx");
    assert.match(screen, /aria-busy="true"/);
    assert.match(screen, /\{app\} wants to act as you in Mingla/);
    assert.match(screen, /loading=\{shown === "approving"\}/);
    assert.match(screen, /disabled=\{shown === "approving"\}/);
    assert.match(screen, /CONNECT_WORDS\.invalid/);
    assert.match(screen, /CONNECT_WORDS\.notMember/);
    assert.match(screen, /CONNECT_WORDS\.network/);
    assert.match(screen, /"Try again" : "Approve"/);
    assert.equal(CONNECT_WORDS.invalid, "This sign-in link is not valid. Start again from Claude.");
    assert.equal(CONNECT_WORDS.notMember, "Your account cannot connect Claude. Ask an owner.");
    assert.match(screen, /forgetConnectRequest\(store\);\s*window\.location\.assign\(approvedRedirect/);
    assert.match(screen, /forgetConnectRequest\(store\);\s*if \(connectRequestValid\(req\)\) window\.location\.assign\(deniedRedirect/);
  });
});

describe("#4294 C-3: Company tools", () => {
  const page = read("pages/CompanyToolsPage.jsx");
  it("is owner only, and says so to anyone else", () => {
    assert.match(page, /const isOwner = access\?\.role === "owner";/);
    assert.match(page, /if \(!isOwner\) \{[\s\S]*?CONNECT_WORDS\.ownerOnly/);
    assert.equal(CONNECT_WORDS.ownerOnly, "Only an owner can manage company tools.");
  });
  it("draws loading, error (Retry, nothing editable), empty and populated", () => {
    assert.match(page, /aria-busy="true"/);
    assert.match(page, /tools\.error \? \(\s*<LoadError title="Couldn't load company tools" onRetry=\{tools\.refetch\} \/>/);
    assert.match(page, /No company tools yet\./);
    assert.match(page, /tools\.rows\.map\(\(row\) =>/);
    assert.match(page, /\{!tools\.loading && !tools\.error && <AddTool/);
  });
  it("the key box is write-only: password, no reveal, no autofill, emptied after", () => {
    const form = page.slice(page.indexOf("function KeyForm"), page.indexOf("function ToolRow"));
    assert.match(form, /type="password"/);
    assert.match(form, /autoComplete="new-password"/);
    assert.equal(/<Input\b/.test(form), false, "the shared Input has a reveal button; the key box does not use it");
    assert.equal(/Eye|showPassword|type=\{/.test(form), false, "no reveal");
    assert.match(form, /useEffect\(\(\) => \(\) => setValue\(""\), \[\]\)/);
    assert.equal((form.match(/setValue\(""\)/g) || []).length, 4, "emptied on leave, save, failure and cancel");
    assert.match(form, /disabled=\{!value\}/);
    assert.equal(/localStorage|sessionStorage|console\./.test(strip(page)), false);
  });
  it("the status line never holds a key", () => {
    const row = { key_set: true, key_updated_at: "2026-11-07T10:00:00Z", key_updated_by: "Seth" };
    assert.equal(keyStatusLine(row, () => "7 Nov 2026"), "Key set, last updated 7 Nov 2026 by Seth");
    assert.equal(keyStatusLine({ key_set: false }), "No key yet");
    assert.equal(keyLooksUsable("short"), false);
    assert.equal(keyLooksUsable("a".repeat(8)), true);
    assert.equal(keyLooksUsable("abcdefgh\n"), false);
    assert.equal(keyLooksUsable("a".repeat(4097)), false);
  });
  it("a refused key is told in fixed words, never what was typed", () => {
    const service = strip(read("services/minglaConnectorService.js"));
    const setKey = service.slice(service.indexOf("export async function setCompanyToolKey"));
    assert.match(setKey, /CONNECT_WORDS\.keyRefused/);
    assert.equal(/err\.message/.test(setKey), false);
  });
  it("the allow-list box takes exact names, one per line", () => {
    assert.deepEqual(parseToolList("exec\n\n  read_things \nexec"), { tools: ["exec", "read_things"], errors: [] });
    assert.deepEqual(parseToolList("posthog__*\nok").errors, ["Line 1: a tool name is 1 to 64 letters, digits, dots, dashes or underscores."]);
    assert.equal(parseToolList(Array.from({ length: 201 }, (_, i) => `t${i}`).join("\n")).errors.at(-1), "At most 200 tools.");
  });
  it("is a menu page under System", () => {
    const constants = read("lib/constants.js");
    assert.match(constants, /\{ id: "company-tools",\s+label: "Company tools",\s+icon: "KeyRound" \}/);
    assert.match(read("App.jsx"), /"company-tools": CompanyToolsPage,/);
  });
});

describe("#4294 C-4: My agent's Claude app card", () => {
  const page = read("pages/AgentPage.jsx");
  const card = page.slice(page.indexOf("function ClaudeAppCard"), page.indexOf("/** While a key or a setup message"));
  it("draws loading, error with retry, empty and populated", () => {
    assert.match(card, /aria-label="Loading Claude app connections"/);
    assert.match(card, /Couldn&apos;t load your Claude app connections\./);
    assert.match(card, /Not connected\. Add the Mingla connector in Claude and sign in\./);
    assert.match(card, /connections\.rows\.map/);
    assert.match(page, /<ClaudeAppCard \/>/);
  });
  it("Disconnect asks first", () => {
    assert.match(card, /setConfirming\(c\.grant_id\)/);
    assert.match(card, /onClick=\{\(\) => disconnect\(c\.grant_id, c\.label\)\}/);
  });
});

describe("#4294 C-5: the authorization server's document", () => {
  it("is served as JSON from Mingla Admin with the fields Claude reads", () => {
    const doc = JSON.parse(fs.readFileSync(path.join(ADMIN, "public/.well-known/oauth-authorization-server"), "utf8"));
    assert.equal(doc.issuer, "https://admin.usemingla.com");
    assert.equal(doc.authorization_endpoint, "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/authorize");
    assert.equal(doc.token_endpoint, "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/token");
    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(doc.token_endpoint_auth_methods_supported, ["none"]);
    assert.equal(doc.client_id_metadata_document_supported, true);
    assert.deepEqual(doc.grant_types_supported, ["authorization_code", "refresh_token"]);
    assert.equal(doc.authorization_response_iss_parameter_supported, true);
    assert.equal("registration_endpoint" in doc, false);
    const vercel = JSON.parse(fs.readFileSync(path.join(ADMIN, "vercel.json"), "utf8"));
    const rule = vercel.headers.find((h) => h.source === "/.well-known/oauth-authorization-server");
    assert.deepEqual(rule.headers.find((h) => h.key === "Content-Type"), { key: "Content-Type", value: "application/json" });
  });
});

describe("#4294 C-6: no key in a breadcrumb", () => {
  it("drops every breadcrumb of a mingla_connector_ request", async () => {
    const { dropConnectorBreadcrumb } = await import("../diagnostics/sentry.js");
    assert.equal(dropConnectorBreadcrumb({ data: { url: "https://x.supabase.co/rest/v1/rpc/mingla_connector_set_key" } }), null);
    const other = { data: { url: "https://x.supabase.co/rest/v1/rpc/team_agent_keys_mine" } };
    assert.equal(dropConnectorBreadcrumb(other), other);
    assert.match(read("diagnostics/sentry.js"), /beforeBreadcrumb: dropConnectorBreadcrumb/);
  });
});
