// Issue #4294 — company sign-in in Mingla Admin (Company tools).
//
//   K-1  the On switch saves itself: it shows what the server has, and goes
//        back with the reason when the save is refused (the old switch
//        showed On before anything was saved)
//   K-2  a sign-in row: Connect / Reconnect / Disconnect, and the status
//        line "Connected as X on DATE by Y" or "Reconnect needed"
//   K-3  the display name, hidden words, generation tools and daily limit
//        boxes, and what Save sends
//   K-4  Connect asks team-agent with the owner's own session and sends the
//        browser to the tool's sign-in page; no token is ever read here
//   K-5  key rows keep working as before
//   K-6  Mingla's client metadata document and its header
//
// Declared here:
// MINGLA-INVARIANT: I-4294-15 | issue #4294 | The Company tools On switch shows On only after the server has saved it on; a refused save puts it back and says why.
// Also exercises I-4294-9 and I-4294-14 (declared in supabase/migrations/__tests__/issue_4294_company_signin.implementor.happy.pg17.test.sql and supabase/functions/team-agent/__tests__/signin.issue4294.implementor.happy.test.ts).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONNECT_WORDS,
  canTurnOn,
  parseDailyCap,
  parseHideWords,
  signinAddressOf,
  signinStatusLine,
  switchCompanyTool,
} from "../services/minglaConnectorService.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = path.resolve(SRC, "..");
const REPO = path.resolve(ADMIN, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const page = strip(read("pages/CompanyToolsPage.jsx"));
const service = strip(read("services/minglaConnectorService.js"));

describe("#4294 K-1: the On switch saves itself", () => {
  it("turns on only with what the server saved", async () => {
    const sent = [];
    const result = await switchCompanyTool("studio", true, async (row) => {
      sent.push(row);
      return { slug: "studio", enabled: true };
    });
    assert.deepEqual(sent, [{ slug: "studio", enabled: true }], "it sends only the switch, at once");
    assert.deepEqual(result, { enabled: true, error: null });
  });
  it("goes back and says why when the save is refused", async () => {
    const refusal = { token: "not_connected", message: "Connect the company account before turning this tool on." };
    const result = await switchCompanyTool("studio", true, async () => {
      throw refusal;
    });
    assert.equal(result.enabled, false, "the switch is back to Off");
    assert.equal(result.error, refusal);
  });
  it("shows the server's answer when it differs (an address change turned it off)", async () => {
    assert.deepEqual(await switchCompanyTool("x", true, async () => ({ enabled: false })), { enabled: false, error: null });
  });
  it("the page wires the switch to the save, not to local state", () => {
    const row = page.slice(page.indexOf("function ToolRow"), page.indexOf("function AddTool"));
    assert.match(row, /onChange=\{toggle\}/);
    assert.equal(/onChange=\{setEnabled\}/.test(row), false, "the old switch only changed what the page showed");
    assert.match(row, /const result = await switchCompanyTool\(row\.slug, next\);\s*setEnabled\(result\.enabled\);/);
    assert.match(row, /Saves at once/);
    const save = row.slice(row.indexOf("const save = async"), row.indexOf("const removeKey"));
    assert.equal(/enabled/.test(save), false, "Save no longer sends the switch");
  });
  it("can be turned on only when a key or a live sign-in is there; can always be turned off", () => {
    assert.equal(canTurnOn({ auth_kind: "key", key_set: true }), true);
    assert.equal(canTurnOn({ auth_kind: "key", key_set: false }), false);
    assert.equal(canTurnOn({ key_set: true }), true, "a row from before kinds is a key row");
    assert.equal(canTurnOn({ auth_kind: "signin", signin: { connected: true, reconnect_needed: false } }), true);
    assert.equal(canTurnOn({ auth_kind: "signin", signin: { connected: true, reconnect_needed: true } }), false);
    assert.equal(canTurnOn({ auth_kind: "signin", signin: { connected: false } }), false);
    assert.match(page, /disabled=\{\(!enabled && !canTurnOn\(row\)\) \|\| saving \|\| toggling\}/);
  });
});

describe("#4294 K-2: a sign-in row", () => {
  it("says who connected it, when, as which account, or that it needs a reconnect", () => {
    const row = {
      signin: { connected: true, reconnect_needed: false, account: "ads@mingla.test", connected_at: "2026-11-07T10:00:00Z", connected_by: "Seth" },
    };
    assert.equal(signinStatusLine(row, () => "7 Nov 2026"), "Connected as ads@mingla.test on 7 Nov 2026 by Seth");
    assert.equal(signinStatusLine({ signin: { connected: true, reconnect_needed: true } }), CONNECT_WORDS.reconnectNeeded);
    assert.match(CONNECT_WORDS.reconnectNeeded, /^Reconnect needed\./);
    assert.equal(signinStatusLine({ signin: { connected: false } }), "Not connected yet");
    assert.equal(signinStatusLine({}), "Not connected yet");
  });
  it("shows Connect, Reconnect and Disconnect (asked first) instead of the key box", () => {
    const panel = page.slice(page.indexOf("function SigninPanel"), page.indexOf("function ToolRow"));
    assert.match(panel, /\{connected \? "Reconnect" : "Connect"\}/);
    assert.match(panel, /Disconnect and turn off/);
    assert.match(panel, /setConfirmDisconnect\(true\)/);
    assert.match(panel, /await disconnectCompanySignin\(row\.slug\)/);
    assert.match(panel, /signinStatusLine\(row, fmtDate\)/);
    const row = page.slice(page.indexOf("function ToolRow"), page.indexOf("function AddTool"));
    assert.match(row, /\{isSignin \? \(\s*<SigninPanel row=\{row\} onChanged=\{onChanged\} \/>\s*\) : \(/);
  });
  it("a new company tool can be a key or a company sign-in", () => {
    const add = page.slice(page.indexOf("function AddTool"));
    assert.match(add, /auth_kind: kind/);
    assert.match(add, /Company sign-in \(no key\)/);
  });
});

describe("#4294 K-3: name, hidden words, generation tools, daily limit", () => {
  it("parses the hidden words box", () => {
    assert.deepEqual(parseHideWords("Magnific, Freepik\nmagnific"), { words: ["Magnific", "Freepik"], errors: [] });
    assert.equal(parseHideWords("Mag(nific").errors.length, 1);
    assert.equal(parseHideWords(Array.from({ length: 21 }, (_, i) => `w${i}`).join(",")).errors.at(-1), "At most 20 hidden words.");
  });
  it("parses the daily limit", () => {
    assert.equal(parseDailyCap("40"), 40);
    assert.equal(parseDailyCap(" 0 "), 0);
    assert.equal(parseDailyCap("10001"), null);
    assert.equal(parseDailyCap("4.5"), null);
    assert.equal(parseDailyCap(""), null);
  });
  it("Save sends them for a sign-in row only", () => {
    const row = page.slice(page.indexOf("function ToolRow"), page.indexOf("function AddTool"));
    assert.match(row, /if \(isSignin\) \{\s*Object\.assign\(fields, \{\s*display_label: displayLabel\.trim\(\),\s*hide_words: hide\.words,\s*generation_tools: gen\.tools,\s*daily_generation_cap: cap,/);
    assert.match(row, /label="Name Claude sees"/);
    assert.match(row, /label="Words to hide"/);
    assert.match(row, /label="Generation calls per person per day"/);
  });
});

describe("#4294 K-4: Connect", () => {
  it("asks team-agent with the owner's session, then goes to the tool's sign-in page", () => {
    const start = service.slice(service.indexOf("export async function startCompanySignin"), service.indexOf("export function signinAddressOf"));
    assert.match(start, /invokeWithRefresh\("team-agent\/oauth\/upstream-start", \{ body: \{ slug \} \}\)/);
    const panel = page.slice(page.indexOf("function SigninPanel"), page.indexOf("function ToolRow"));
    assert.match(panel, /const to = await startCompanySignin\(row\.slug\);\s*window\.location\.assign\(to\);/);
  });
  it("follows only a plain https address", () => {
    assert.equal(signinAddressOf({ authorize_url: "https://auth.magnific.com/realms/mcp/auth?x=1" }), "https://auth.magnific.com/realms/mcp/auth?x=1");
    assert.equal(signinAddressOf({ authorize_url: "javascript:alert(1)" }), null);
    assert.equal(signinAddressOf({ authorize_url: "http://auth.example/x" }), null);
    assert.equal(signinAddressOf({}), null);
  });
  it("never reads, keeps or shows a token", () => {
    for (const text of [page, service]) {
      assert.equal(/access_token|refresh_token|code_verifier|signin_vault_id/.test(text), false);
      assert.equal(/localStorage/.test(text), false);
    }
  });
});

describe("#4294 K-5: key rows as before", () => {
  it("still have Set key, Replace key and Remove key", () => {
    assert.match(page, /\{row\.key_set \? "Replace key" : "Set key"\}/);
    assert.match(page, /Remove key and turn off/);
    assert.match(page, /<KeyForm/);
  });
});

describe("#4294 K-6: Mingla's client metadata document", () => {
  const docPath = path.join(ADMIN, "public", "oauth", "mingla-connector-client.json");
  const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
  it("names itself and only team-agent's callback, as a public client", () => {
    assert.equal(doc.client_id, "https://admin.usemingla.com/oauth/mingla-connector-client.json");
    assert.deepEqual(doc.redirect_uris, ["https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback"]);
    assert.equal(doc.token_endpoint_auth_method, "none");
    assert.deepEqual(doc.grant_types, ["authorization_code", "refresh_token"]);
    assert.equal("client_secret" in doc || "jwks" in doc, false);
  });
  it("matches the server's own client id and callback", () => {
    const signin = fs.readFileSync(path.join(REPO, "supabase/functions/_shared/minglaConnectorSignin.ts"), "utf8");
    assert.match(signin, new RegExp(`SIGNIN_CLIENT_ID = "${doc.client_id.replace(/[.]/g, "\\.")}"`));
    const migration = fs.readFileSync(path.join(REPO, "supabase/migrations/20280428024294_issue_4294_company_signin.sql"), "utf8");
    assert.ok(migration.includes(`"client_id": "${doc.client_id}"`));
    assert.ok(migration.includes(`"redirect_uri": "${doc.redirect_uris[0]}"`));
  });
  it("is served as JSON that any sign-in server may read", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ADMIN, "vercel.json"), "utf8"));
    const rule = vercel.headers.find((h) => h.source === "/oauth/mingla-connector-client.json");
    assert.ok(rule);
    const h = Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
    assert.equal(h["Content-Type"], "application/json");
    assert.equal(h["Access-Control-Allow-Origin"], "*");
  });
});
