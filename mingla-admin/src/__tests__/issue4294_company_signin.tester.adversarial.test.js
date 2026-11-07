// Issue #4294 — tester adversarial: Company tools company sign-in in Mingla Admin.
//
//   J-1  the On switch never shows a state the server did not answer: a
//        refusal (thrown, network, owner-only) reverts it, a server answer
//        that differs from the press wins, and a press that the server
//        turned into Off stays Off
//   J-2  Connect follows only a plain https address: javascript:, data:,
//        http, user-info (built at runtime) and garbage are refused
//   J-3  the boxes refuse what the database refuses: hidden words with
//        invisible characters, symbols or over 40 characters; daily limits
//        that are signed, fractional, exponent or over 10000
//   J-4  the status line never repeats a token-shaped field, even when a
//        row carries one, and Reconnect needed wins over Connected
//   J-5  the client metadata document and the server agree byte for byte on
//        the client id and the one callback, and the document is served
//        with a JSON content type and no frame block confusion
//
// Also exercises I-4294-15 (declared in issue4294_company_signin.implementor.test.js).
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

describe("#4294 J-1: the On switch shows only what the server answered", () => {
  it("reverts on every kind of refusal", async () => {
    for (const err of [new Error("network"), Object.assign(new Error("x"), { code: "42501" }), "plain string"]) {
      for (const next of [true, false]) {
        const got = await switchCompanyTool("studio", next, () => Promise.reject(err));
        assert.equal(got.enabled, !next, `a refused press to ${next} goes back`);
        assert.ok(got.error, "and carries the reason");
      }
    }
  });
  it("shows the server's answer, not the press, when they differ", async () => {
    const off = await switchCompanyTool("studio", true, () => Promise.resolve({ slug: "studio", enabled: false }));
    assert.deepEqual(off, { enabled: false, error: null });
    const on = await switchCompanyTool("studio", false, () => Promise.resolve({ slug: "studio", enabled: true }));
    assert.deepEqual(on, { enabled: true, error: null });
  });
  it("sends only the slug and the switch, never other fields", async () => {
    let sent = null;
    await switchCompanyTool("studio", true, (fields) => {
      sent = fields;
      return Promise.resolve({ enabled: true });
    });
    assert.deepEqual(sent, { slug: "studio", enabled: true });
  });
  it("a sign-in row that needs a reconnect, or was never connected, cannot be turned on", () => {
    assert.equal(canTurnOn({ auth_kind: "signin", key_set: true, signin: { connected: false } }), false, "a stray key_set does not count");
    assert.equal(canTurnOn({ auth_kind: "signin", signin: { connected: true, reconnect_needed: true } }), false);
    assert.equal(canTurnOn({ auth_kind: "signin", signin: null }), false);
    assert.equal(canTurnOn({ auth_kind: "key", signin: { connected: true } }), false, "a key row needs its key");
    assert.equal(canTurnOn(null), false);
  });
});

describe("#4294 J-2: Connect follows only a plain https address", () => {
  it("refuses every other scheme and user-info", () => {
    const userinfo = ["https:", "//", "owner", ":", "pw", "@", "auth.magnific.com/x"].join("");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "http://auth.magnific.com/auth",
      userinfo,
      "//auth.magnific.com/auth",
      "auth.magnific.com/auth",
      "",
      null,
      42,
    ]) {
      assert.equal(signinAddressOf({ authorize_url: bad }), null, String(bad));
    }
    assert.equal(signinAddressOf(null), null);
    assert.equal(signinAddressOf({}), null);
    const ok = "https://auth.magnific.com/realms/mcp/protocol/openid-connect/auth?state=abc&code_challenge_method=S256";
    assert.equal(signinAddressOf({ authorize_url: ok }), ok);
  });
});

describe("#4294 J-3: the boxes refuse what the database refuses", () => {
  it("hidden words", () => {
    for (const bad of ["Mag​nific", "Magnific!", "<b>", "a".repeat(41), "-Magnific", "Magnific-", "Ｍagnific"]) {
      assert.ok(parseHideWords(bad).errors.length > 0, JSON.stringify(bad));
    }
    const many = Array.from({ length: 21 }, (_, i) => `Word${i}`).join(",");
    assert.ok(parseHideWords(many).errors.some((e) => /20/.test(e)), "over 20 words");
    const dup = parseHideWords("Magnific, MAGNIFIC\nmagnific,  , Freepik");
    assert.deepEqual(dup, { words: ["Magnific", "Freepik"], errors: [] });
    assert.deepEqual(parseHideWords("Magnific's, AT&T, Dr. Who").words, ["Magnific's", "AT&T", "Dr. Who"]);
  });
  it("daily limits", () => {
    for (const bad of ["-1", "+5", "2.5", "1e3", "10001", "99999", "", "  ", "abc", "0x10", "100000", null, undefined]) {
      assert.equal(parseDailyCap(bad), null, String(bad));
    }
    assert.equal(parseDailyCap("0"), 0);
    assert.equal(parseDailyCap(" 40 "), 40);
    assert.equal(parseDailyCap("10000"), 10000);
    assert.equal(parseDailyCap("00040"), 40);
  });
});

describe("#4294 J-4: the status line never repeats a token", () => {
  it("ignores token-shaped fields a row might carry", () => {
    const row = {
      auth_kind: "signin",
      signin: {
        connected: true,
        reconnect_needed: false,
        account: "ads@mingla.test",
        connected_at: "2026-11-07T12:00:00Z",
        connected_by: "Seth",
        access_token: "AT-should-never-show",
        refresh_token: "RT-should-never-show",
      },
      signin_vault_id: "00000000-0000-4000-a000-000000000000",
    };
    const line = signinStatusLine(row, () => "7 Nov");
    assert.equal(line, "Connected as ads@mingla.test on 7 Nov by Seth");
    assert.equal(/should-never-show|00000000/.test(line), false);
  });
  it("Reconnect needed wins over Connected, and not connected is plain", () => {
    assert.equal(
      signinStatusLine({ signin: { connected: true, reconnect_needed: true, account: "x" } }),
      CONNECT_WORDS.reconnectNeeded,
    );
    assert.equal(signinStatusLine({ signin: { connected: false, reconnect_needed: true } }), CONNECT_WORDS.notConnected);
    assert.equal(signinStatusLine({}), CONNECT_WORDS.notConnected);
  });
});

describe("#4294 J-5: the client document and the server agree", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ADMIN, "public/oauth/mingla-connector-client.json"), "utf8"));
  const migration = fs.readFileSync(
    path.join(REPO, "supabase/migrations/20280428024294_issue_4294_company_signin.sql"),
    "utf8",
  );
  const signin = fs.readFileSync(path.join(REPO, "supabase/functions/_shared/minglaConnectorSignin.ts"), "utf8");
  it("one client id and one callback everywhere", () => {
    assert.equal(doc.client_id, "https://admin.usemingla.com/oauth/mingla-connector-client.json");
    assert.deepEqual(doc.redirect_uris, [
      "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent/oauth/upstream-callback",
    ]);
    assert.ok(migration.includes(`"client_id": "${doc.client_id}"`), "the database names the same client id");
    assert.ok(migration.includes(`"redirect_uri": "${doc.redirect_uris[0]}"`), "the database names the same callback");
    assert.ok(signin.includes(`SIGNIN_CLIENT_ID = "${doc.client_id}"`), "the edge names the same client id");
  });
  it("is a public client with no secret, no extra grant and no other address", () => {
    assert.equal(doc.token_endpoint_auth_method, "none");
    assert.deepEqual(doc.grant_types, ["authorization_code", "refresh_token"]);
    assert.deepEqual(doc.response_types, ["code"]);
    for (const k of ["client_secret", "jwks", "jwks_uri", "post_logout_redirect_uris"]) assert.equal(k in doc, false, k);
    const urls = JSON.stringify(doc).match(/https?:\/\/[^"]+/g);
    assert.ok(urls.every((u) => u.startsWith("https://")), "https only");
  });
  it("is served as JSON before the catch-all headers", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ADMIN, "vercel.json"), "utf8"));
    const i = vercel.headers.findIndex((h) => h.source === "/oauth/mingla-connector-client.json");
    const all = vercel.headers.findIndex((h) => h.source === "/(.*)");
    assert.ok(i >= 0 && all > i, "its own rule comes first");
    const type = vercel.headers[i].headers.find((h) => h.key === "Content-Type");
    assert.equal(type.value, "application/json");
    assert.equal(vercel.headers[all].headers.some((h) => h.key === "Content-Type"), false, "the catch-all never overrides it");
  });
});
