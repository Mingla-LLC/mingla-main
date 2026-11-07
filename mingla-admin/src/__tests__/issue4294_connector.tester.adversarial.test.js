// Issue #4294 — tester adversarial suite for the Mingla connector in Mingla
// Admin.
//
// The implementor suite proves the screens draw and the happy path works.
// This one attacks what a crafted link, a tampered tab or a drifting copy can
// do:
//   X-1  three copies of the pinned app list and redirect rule (edge, Admin,
//        database seed) agree exactly, so no surface accepts what another
//        refuses
//   X-2  a crafted #/connect link: duplicated, look-alike, prototype and
//        oversized values are never shown as approvable
//   X-3  Approve and Cancel go back only to the stored redirect, and a hostile
//        state cannot add a second code, an error or another host
//   X-4  a request tampered with in sessionStorage after it was kept is
//        refused; storage that throws never breaks the page
//   X-5  people who must not approve: removed, invited, no pipelines area
//   X-6  the write-only key: every control character refused, nothing in
//        the page source ever hands the typed value to a toast, a log, the
//        address, storage or Sentry; a refused key never echoes
//   X-7  Sentry: every connector request's breadcrumb is dropped, by every
//        transport shape, and nothing else is
//   X-8  the issuer, endpoints and supported methods agree between the
//        static document, the edge and Admin
//   X-9  retest: the anti-framing headers cover every served path, restrict
//        nothing but framing, are set by one rule only, leave the
//        authorization server document's CORS intact, and no other Mingla
//        surface frames an Admin page
//
// Invariant exercised: I-4294-2 (Admin side).
// Also exercises I-4294-2 (declared in supabase/migrations/__tests__/issue_4294_mingla_connector.implementor.happy.pg17.test.sql).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_ISSUER,
  CONNECT_CLIENTS,
  CONNECT_STORAGE_KEY,
  CONNECT_WORDS,
  approvedRedirect,
  connectPageState,
  connectRequestValid,
  connectorErrorOf,
  deniedRedirect,
  keepConnectRequest,
  keyLooksUsable,
  keyStatusLine,
  parseConnectHash,
  parseToolList,
  readConnectRequest,
} from "../services/minglaConnectorService.js";
import { dropConnectorBreadcrumb } from "../diagnostics/sentry.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = path.resolve(SRC, "..");
const REPO = path.resolve(ADMIN, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CC = "https://claude.ai/oauth/claude-code-client-metadata";
const APP_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9";
const GOOD = { client_id: APP, redirect_uri: APP_REDIRECT, code_challenge: CHALLENGE, state: "st-x" };
const MEMBER = { role: "growth", status: "active", areas: ["crm", "role_home"] };

const LOOK_ALIKES = [
  [APP, APP_REDIRECT + "?x=1"],
  [APP, APP_REDIRECT + "#x"],
  [APP, APP_REDIRECT + "/"],
  [APP, "https://claude.ai/api/mcp/auth_callback/../x"],
  [APP, "https://CLAUDE.AI/api/mcp/auth_callback"],
  [APP, "https://claude.ai:443/api/mcp/auth_callback"],
  [APP, "https://claude.ai.evil.com/api/mcp/auth_callback"],
  [APP, "https://claude.ai@evil.com/api/mcp/auth_callback"],
  [APP, "https://evil.com/?https://claude.ai/api/mcp/auth_callback"],
  [APP, "javascript:alert(1)//https://claude.ai/api/mcp/auth_callback"],
  [APP, "http://127.0.0.1:5000/callback"],
  [CC, APP_REDIRECT],
  [CC, "http://localhost.evil.com/callback"],
  [CC, "http://127.0.0.1.evil.com:5000/callback"],
  [CC, "http://127.0.0.1:0/callback"],
  [CC, "http://127.0.0.1:1023/callback"],
  [CC, "http://127.0.0.1:65536/callback"],
  [CC, "http://127.0.0.1:05000/callback"],
  [CC, "http://[::1]:5000/callback"],
  [CC, "http://127.0.0.1:5000/callback/"],
  [CC, "HTTP://LOCALHOST:5000/callback"],
  [CC, "http://127.0.0.1:5000/%63allback"],
  [CC, "http://user@localhost:5000/callback"],
  [CC, "http://0x7f.0.0.1:5000/callback"],
  [CC, "javascript:alert(1)"],
  ["__proto__", APP_REDIRECT],
  ["constructor", APP_REDIRECT],
  ["hasOwnProperty", APP_REDIRECT],
  ["toString", APP_REDIRECT],
  [APP.toUpperCase(), APP_REDIRECT],
  [APP + "/", APP_REDIRECT],
];

describe("#4294 X-1: the edge, Admin and the database pin the same apps and redirect rule", () => {
  const edge = read("supabase/functions/_shared/minglaConnectorOAuth.ts");
  const sql = read("supabase/migrations/20280425004294_issue_4294_mingla_connector.sql");
  const service = read("mingla-admin/src/services/minglaConnectorService.js");

  it("the same two client ids, with the same loopback flag, everywhere", () => {
    const edgeIds = [...edge.matchAll(/"(https:\/\/claude\.ai\/oauth\/[a-z-]+)":\s*\{[^}]*loopback:\s*(true|false)/g)]
      .map((m) => `${m[1]}|${m[2]}`).sort();
    const sqlIds = [...sql.matchAll(/\('(https:\/\/claude\.ai\/oauth\/[a-z-]+)',\s*'claude_(?:app|code)',\s*'[^']+',\s*(?:ARRAY\[[^\]]*\]|'\{\}'),\s*(true|false)\)/g)]
      .map((m) => `${m[1]}|${m[2]}`).sort();
    const adminIds = Object.entries(CONNECT_CLIENTS).map(([id, c]) => `${id}|${c.loopback}`).sort();
    assert.deepEqual(edgeIds, [`${APP}|false`, `${CC}|true`].sort());
    assert.deepEqual(sqlIds, edgeIds, "database seed");
    assert.deepEqual(adminIds, edgeIds, "Admin");
  });

  it("the same exact Claude redirect and the same loopback pattern everywhere", () => {
    assert.ok(edge.includes(`redirect: "${APP_REDIRECT}"`));
    assert.ok(sql.includes(`ARRAY['${APP_REDIRECT}']`));
    assert.ok(service.includes(`"${APP_REDIRECT}"`));
    const loop = "^http:\\/\\/(localhost|127\\.0\\.0\\.1):([1-9][0-9]{3,4})\\/callback$";
    assert.ok(edge.includes(`/${loop}/`), "edge pattern");
    assert.ok(service.includes(`/${loop}/`), "Admin pattern");
    assert.ok(sql.includes("'^http://(localhost|127\\.0\\.0\\.1):([1-9][0-9]{3,4})/callback$'"), "database pattern");
    for (const src of [edge, service, sql]) {
      assert.match(src, /1024/);
      assert.match(src, /65535/);
    }
  });

  it("the same challenge shape everywhere: exactly 43 URL-safe characters", () => {
    assert.ok(edge.includes("/^[A-Za-z0-9_-]{43}$/"));
    assert.ok(service.includes("/^[A-Za-z0-9_-]{43}$/"));
    assert.ok(sql.includes("'^[A-Za-z0-9_-]{43}$'"));
  });
});

describe("#4294 X-2: a crafted #/connect link is never approvable", () => {
  it("every look-alike redirect or unknown app is refused", () => {
    for (const [client_id, redirect_uri] of LOOK_ALIKES) {
      const req = { ...GOOD, client_id, redirect_uri };
      assert.equal(connectRequestValid(req), false, `${client_id} -> ${redirect_uri}`);
      assert.equal(connectPageState(req, MEMBER).phase, "invalid", `${client_id} -> ${redirect_uri}`);
    }
  });

  it("repeated fields make the whole link invalid, whichever comes first", () => {
    for (const hash of [
      `#/connect?client_id=${encodeURIComponent(APP)}&redirect_uri=${encodeURIComponent(APP_REDIRECT)}&redirect_uri=${encodeURIComponent("https://evil.com/cb")}&code_challenge=${CHALLENGE}`,
      `#/connect?redirect_uri=${encodeURIComponent("https://evil.com/cb")}&client_id=${encodeURIComponent(APP)}&redirect_uri=${encodeURIComponent(APP_REDIRECT)}&code_challenge=${CHALLENGE}`,
      `#/connect?client_id=${encodeURIComponent(APP)}&client_id=${encodeURIComponent(CC)}&redirect_uri=${encodeURIComponent(APP_REDIRECT)}&code_challenge=${CHALLENGE}`,
      `#/connect?client_id=${encodeURIComponent(APP)}&redirect_uri=${encodeURIComponent(APP_REDIRECT)}&code_challenge=${CHALLENGE}&state=a&state=b`,
    ]) {
      const parsed = parseConnectHash(hash);
      assert.equal(connectRequestValid(parsed), false, hash);
    }
  });

  it("other routes, look-alike routes and unknown fields are not a connect request", () => {
    assert.equal(parseConnectHash("#/connectx?client_id=a"), null);
    assert.equal(parseConnectHash("#/agent?client_id=a"), null);
    assert.equal(parseConnectHash("#/x/#/connect?client_id=a"), null);
    assert.equal(parseConnectHash(undefined), null);
    const parsed = parseConnectHash(`#/connect?client_id=${encodeURIComponent(APP)}&code=mglo_x&access_token=y&__proto__=z`);
    assert.deepEqual(Object.keys(parsed), ["client_id"], "only the six known fields are kept");
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype, "no prototype was set from the link");
  });

  it("a challenge that is padded, hex, standard base64 or one character off is refused", () => {
    for (const code_challenge of [CHALLENGE + "=", "A".repeat(64), "+/" + CHALLENGE.slice(2), CHALLENGE.slice(1), CHALLENGE + "a", "", null]) {
      assert.equal(connectRequestValid({ ...GOOD, code_challenge }), false, String(code_challenge));
    }
  });

  it("an oversized or non-text state is refused", () => {
    assert.equal(connectRequestValid({ ...GOOD, state: "s".repeat(513) }), false);
    assert.equal(connectRequestValid({ ...GOOD, state: { a: 1 } }), false);
    assert.equal(connectRequestValid({ ...GOOD, state: "s".repeat(512) }), true);
  });
});

describe("#4294 X-3: Approve and Cancel go back only to the stored redirect", () => {
  const hostile = "x&code=mglo_EVIL&error=none&iss=https%3A%2F%2Fevil.example#frag";
  it("a hostile state cannot add a second code, an error, another issuer or a fragment", () => {
    const req = { ...GOOD, state: hostile };
    const ok = new URL(approvedRedirect(req, "mglo_" + "R".repeat(43)));
    assert.equal(ok.origin + ok.pathname, APP_REDIRECT);
    assert.deepEqual(ok.searchParams.getAll("code"), ["mglo_" + "R".repeat(43)]);
    assert.deepEqual(ok.searchParams.getAll("state"), [hostile]);
    assert.deepEqual(ok.searchParams.getAll("iss"), [ADMIN_ISSUER]);
    assert.equal(ok.searchParams.has("error"), false);
    assert.equal(ok.hash, "");
    const no = new URL(deniedRedirect(req));
    assert.equal(no.origin + no.pathname, APP_REDIRECT);
    assert.deepEqual(no.searchParams.getAll("error"), ["access_denied"]);
    assert.equal(no.searchParams.has("code"), false);
    assert.deepEqual(no.searchParams.getAll("iss"), [ADMIN_ISSUER]);
  });

  it("Claude Code goes back to its own loopback port only", () => {
    const req = { ...GOOD, client_id: CC, redirect_uri: "http://127.0.0.1:49152/callback" };
    const ok = new URL(approvedRedirect(req, "mglo_" + "R".repeat(43)));
    assert.equal(ok.origin + ok.pathname, "http://127.0.0.1:49152/callback");
  });

  it("the Connect screen leaves only by those two addresses, after the request is checked", () => {
    const screen = strip(read("mingla-admin/src/components/ConnectScreen.jsx"));
    const exits = [...screen.matchAll(/window\.location\.(assign|replace|href)\s*\(?\s*([^;\n]*)/g)].map((m) => m[2].trim());
    for (const e of exits) {
      assert.match(e, /^(approvedRedirect|deniedRedirect)\(req/, `an exit not through the checked builders: ${e}`);
    }
    assert.ok(exits.length >= 2);
    assert.match(screen, /connectRequestValid\(req\)\)\s*window\.location\.assign\(deniedRedirect\(req\)\)/,
      "Cancel goes back only for a valid request");
  });
});

describe("#4294 X-4: a tampered tab", () => {
  function storage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      raw: m,
    };
  }
  it("a request changed in sessionStorage after it was kept is refused", () => {
    const s = storage();
    keepConnectRequest(s, GOOD);
    const kept = JSON.parse(s.raw.get(CONNECT_STORAGE_KEY));
    s.setItem(CONNECT_STORAGE_KEY, JSON.stringify({ ...kept, redirect_uri: "https://evil.com/cb" }));
    assert.equal(connectPageState(readConnectRequest(s), MEMBER).phase, "invalid");
    s.setItem(CONNECT_STORAGE_KEY, JSON.stringify({ ...kept, client_id: "__proto__" }));
    assert.equal(connectPageState(readConnectRequest(s), MEMBER).phase, "invalid");
    s.setItem(CONNECT_STORAGE_KEY, "[1,2,3]");
    assert.equal(connectPageState(readConnectRequest(s), MEMBER).phase, "invalid");
    s.setItem(CONNECT_STORAGE_KEY, "{not json");
    assert.equal(readConnectRequest(s), null);
    s.setItem(CONNECT_STORAGE_KEY, JSON.stringify({ ...kept, invalid: true }));
    assert.equal(connectRequestValid(readConnectRequest(s)), false);
  });
  it("storage that throws never breaks the page", () => {
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("x"); } };
    assert.equal(keepConnectRequest(broken, GOOD), false);
    assert.equal(readConnectRequest(broken), null);
  });
});

describe("#4294 X-5: people who must not approve", () => {
  it("removed, invited, no pipelines area or no access at all", () => {
    for (const access of [
      null,
      undefined,
      { role: "growth", status: "revoked", areas: ["crm"] },
      { role: "growth", status: "invited", areas: ["crm"] },
      { role: "growth", status: "active", areas: ["role_home"] },
      { role: "owner", status: "active", areas: [] },
      { role: "owner", status: "active" },
    ]) {
      assert.equal(connectPageState(GOOD, access).phase, "not_member", JSON.stringify(access));
    }
  });
});

describe("#4294 X-6: the write-only key", () => {
  it("every control character and every size outside 8..4096 is refused", () => {
    for (let c = 0; c < 32; c++) assert.equal(keyLooksUsable("abcdefgh" + String.fromCharCode(c)), false, `char ${c}`);
    assert.equal(keyLooksUsable("abcdefgh\u007f"), false);
    assert.equal(keyLooksUsable("a".repeat(7)), false);
    assert.equal(keyLooksUsable("a".repeat(4097)), false);
    assert.equal(keyLooksUsable(["a".repeat(10)]), false);
    assert.equal(keyLooksUsable("a".repeat(4096)), true);
  });

  it("a refused key is never echoed back, even if the server's words carried it", () => {
    const marker = "TSTMRK4294-p8Hq2Zx5Lw0Vb7Nc3Kj6Fd9Ga1Sr4Ue";
    const svc = read("mingla-admin/src/services/minglaConnectorService.js");
    const setKey = svc.slice(svc.indexOf("export async function setCompanyToolKey"));
    assert.doesNotMatch(strip(setKey), /err\.message|error\.message/, "setCompanyToolKey never forwards a server message");
    assert.match(setKey, /CONNECT_WORDS\.keyRefused/);
    assert.equal(CONNECT_WORDS.keyRefused.includes(marker), false);
    // The general error reader keeps a server's own words for other calls; it never invents a token from a key.
    assert.deepEqual(connectorErrorOf({ message: marker }), { token: "unknown", message: "" });
  });

  it("the typed value never reaches a toast, a log, the address, storage or Sentry", () => {
    const page = strip(read("mingla-admin/src/pages/CompanyToolsPage.jsx"));
    const form = page.slice(page.indexOf("function KeyForm"), page.indexOf("function", page.indexOf("function KeyForm") + 10));
    assert.match(form, /type="password"/);
    assert.doesNotMatch(form, /type=\{/, "the box type is never switched (no reveal)");
    assert.doesNotMatch(form, /addToast|console\.|localStorage|sessionStorage|location|captureException|Sentry|navigator\.clipboard/);
    // The only place the value goes is the set-key call, and it is emptied on every path.
    const uses = [...form.matchAll(/\bvalue\b/g)].length;
    assert.ok(uses >= 3);
    assert.match(form, /setCompanyToolKey\(row\.slug, value\)/);
    assert.equal((form.match(/setValue\(""\)/g) || []).length >= 3, true, "emptied on save, error, cancel and unmount");
    assert.doesNotMatch(form, /setError\([^)]*value/, "an error never includes the value");
    for (const f of ["mingla-admin/src/services/minglaConnectorService.js", "mingla-admin/src/hooks/useMinglaConnector.js", "mingla-admin/src/pages/CompanyToolsPage.jsx"]) {
      const src = strip(read(f));
      for (const m of src.matchAll(/console\.(log|warn|error|info|debug)\(([^)]*)\)/g)) {
        assert.doesNotMatch(m[2], /\b(key|value|args|p_key|row)\b/, `${f} logs ${m[2]}`);
      }
      assert.doesNotMatch(src, /localStorage/, `${f} uses localStorage`);
    }
  });

  it("the status line shows only a date and a name, whatever else the row carries", () => {
    const row = { key_set: true, key_updated_at: "2026-11-06T00:00:00Z", key_updated_by: "Seth", key: "SECRET-should-never-show", vault_secret_id: "abc" };
    const line = keyStatusLine(row, () => "6 Nov 2026");
    assert.equal(line, "Key set, last updated 6 Nov 2026 by Seth");
  });

  it("the allow-list box takes exact plain names only", () => {
    const { tools, errors } = parseToolList(["exec", "EXEC", "е" + "xec", "ex*", "exec​", "a b", "tools/list", "x".repeat(65), "  exec  "].join("\n"));
    assert.deepEqual(tools, ["exec", "EXEC"]);
    assert.equal(errors.length, 6);
    const many = parseToolList(Array.from({ length: 201 }, (_, i) => `t${i}`).join("\n"));
    assert.ok(many.errors.includes("At most 200 tools."));
  });
});

describe("#4294 X-7: Sentry drops every connector breadcrumb, and only those", () => {
  const base = "https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/";
  it("fetch and xhr breadcrumbs of every connector function are dropped", () => {
    for (const fn of ["mingla_connector_set_key", "mingla_connector_oauth_approve", "mingla_connector_clear_key",
      "mingla_connector_registry_save", "mingla_connector_disconnect"]) {
      for (const category of ["fetch", "xhr"]) {
        assert.equal(dropConnectorBreadcrumb({ category, data: { url: base + fn, method: "POST" } }), null, `${category} ${fn}`);
        assert.equal(dropConnectorBreadcrumb({ category, data: { url: base + fn + "?select=*", method: "POST" } }), null, `${category} ${fn}?`);
      }
    }
  });
  it("other breadcrumbs are kept, and odd ones never throw", () => {
    const other = { category: "fetch", data: { url: base + "team_agent_keys_mine" } };
    assert.equal(dropConnectorBreadcrumb(other), other);
    for (const b of [{}, { data: null }, { data: { url: 42 } }, { category: "console", message: "x" }]) {
      assert.equal(dropConnectorBreadcrumb(b), b);
    }
    assert.equal(dropConnectorBreadcrumb(undefined), undefined);
  });
  it("is wired into the one Sentry start", () => {
    const src = strip(read("mingla-admin/src/diagnostics/sentry.js"));
    assert.match(src, /beforeBreadcrumb:\s*dropConnectorBreadcrumb/);
  });
});

describe("#4294 X-8: the issuer and endpoints agree across the static document, the edge and Admin", () => {
  const doc = JSON.parse(read("mingla-admin/public/.well-known/oauth-authorization-server"));
  const edge = read("supabase/functions/_shared/minglaConnectorOAuth.ts");
  const sql = read("supabase/migrations/20280425004294_issue_4294_mingla_connector.sql");
  it("one issuer", () => {
    assert.equal(doc.issuer, ADMIN_ISSUER);
    assert.ok(edge.includes(`export const ADMIN_ISSUER = "${ADMIN_ISSUER}"`));
  });
  it("the endpoints are the connector's own, at the address the database pins as the resource", () => {
    const resource = /"resource":\s*"([^"]+)"/.exec(sql)[1];
    assert.equal(doc.authorization_endpoint, `${resource}/oauth/authorize`);
    assert.equal(doc.token_endpoint, `${resource}/oauth/token`);
  });
  it("only S256, only public clients, no registration, no implicit or password grants", () => {
    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(doc.token_endpoint_auth_methods_supported, ["none"]);
    assert.deepEqual(doc.response_types_supported, ["code"]);
    assert.deepEqual([...doc.grant_types_supported].sort(), ["authorization_code", "refresh_token"]);
    assert.equal("registration_endpoint" in doc, false);
    assert.equal(doc.client_id_metadata_document_supported, true);
  });
});

describe("#4294 X-9: the anti-framing headers cover all of Admin and break nothing", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ADMIN, "vercel.json"), "utf8"));
  // Vercel sources are path-to-regexp; "/(.*)" is a plain group here.
  const matches = (source, p) => new RegExp("^" + source + "$").test(p);
  const setting = (key) => vercel.headers.filter((r) => r.headers.some((h) => h.key.toLowerCase() === key.toLowerCase()));

  it("every path Admin serves gets both headers", () => {
    for (const p of ["/", "/index.html", "/assets/index-abc123.js", "/favicon.ico", "/.well-known/oauth-authorization-server", "/connect"]) {
      for (const key of ["X-Frame-Options", "Content-Security-Policy"]) {
        assert.ok(setting(key).some((r) => matches(r.source, p)), `${key} on ${p}`);
      }
    }
  });

  it("one rule sets them, and the policy restricts framing only", () => {
    assert.equal(setting("X-Frame-Options").length, 1);
    assert.equal(setting("Content-Security-Policy").length, 1);
    const csp = setting("Content-Security-Policy")[0].headers.find((h) => h.key === "Content-Security-Policy").value;
    const directives = csp.split(";").map((d) => d.trim()).filter(Boolean);
    assert.deepEqual(directives, ["frame-ancestors 'none'"], "no script, style, connect or frame-src limit that could break Admin");
    assert.equal(setting("X-Frame-Options")[0].headers.find((h) => h.key === "X-Frame-Options").value, "DENY");
    // No page-level policy that would disagree with the header.
    const html = fs.readFileSync(path.join(ADMIN, "index.html"), "utf8");
    assert.equal(/http-equiv\s*=\s*["']?(content-security-policy|x-frame-options)/i.test(html), false);
  });

  it("the authorization server document keeps its CORS and JSON type", () => {
    const doc = vercel.headers.find((h) => h.source === "/.well-known/oauth-authorization-server");
    const v = (k) => doc.headers.find((h) => h.key === k)?.value;
    assert.equal(v("Access-Control-Allow-Origin"), "*");
    assert.equal(v("Content-Type"), "application/json");
  });

  it("no other Mingla surface frames an Admin page", () => {
    const roots = ["app-mobile/src", "mingla-business/src", "mingla-business/app", "mingla-marketing/app", "mingla-marketing/src",
      "mingla-sites/src", "mingla-site-cms/src"].map((r) => path.join(REPO, r)).filter((r) => fs.existsSync(r));
    assert.ok(roots.length >= 4, "the surfaces were found");
    let scanned = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== "__tests__") walk(p);
        } else if (/\.(jsx?|tsx?|mjs|html)$/.test(e.name)) {
          scanned++;
          const src = fs.readFileSync(p, "utf8");
          if (!/admin\.usemingla\.com|mingla-admin/.test(src)) continue;
          for (const m of src.matchAll(/<(iframe|frame|embed|object|WebView)\b[^>]*>/gi)) {
            assert.equal(/admin\.usemingla\.com|mingla-admin/.test(m[0]), false, `${p} frames Admin`);
          }
        }
      }
    };
    roots.forEach(walk);
    assert.ok(scanned > 500, `scanned ${scanned} files`);
  });
});
